import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { execFile as nodeExecFile, spawn } from "node:child_process";
import { applyOpenVpnConfig, ensureManagedOpenVpnProcess } from "./openvpn-runtime.js";

export const OPENVPN_SHADOWSOCKS_RUNTIME_MODEL_VERSION =
  "lumen.node-agent.openvpn-shadowsocks-runtime.v1";
export const DEFAULT_OPENVPN_SHADOWSOCKS_CONFIG_PATH =
  "/var/lib/lumen-node/runtime/openvpn-shadowsocks/config.json";
export const DEFAULT_OPENVPN_SHADOWSOCKS_LOG_FILE =
  "/var/lib/lumen-node/runtime/openvpn-shadowsocks/ssserver.log";
export const DEFAULT_OPENVPN_SHADOWSOCKS_PID_FILE =
  "/var/lib/lumen-node/runtime/openvpn-shadowsocks/ssserver.pid";
export const DEFAULT_OPENVPN_SHADOWSOCKS_OPENVPN_DIR =
  "/var/lib/lumen-node/runtime/openvpn-shadowsocks/openvpn";
export const DEFAULT_OPENVPN_SHADOWSOCKS_BINARY = "ssserver";

const execFileAsync = promisify(nodeExecFile);
const FORBIDDEN_UNRESOLVED_FIELDS = new Set(["clientsRef", "credentialsRef"]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertNoUnresolvedRefs(value, path = "$", violations = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoUnresolvedRefs(item, `${path}[${index}]`, violations));
    return violations;
  }
  if (!isPlainObject(value)) {
    return violations;
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_UNRESOLVED_FIELDS.has(key)) {
      violations.push(`${path}.${key}`);
    }
    assertNoUnresolvedRefs(child, `${path}.${key}`, violations);
  }
  return violations;
}

function validatePort(value, path, errors) {
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    errors.push(`${path} must be an integer port in 1..65535`);
  }
}

function validateText(value, path, errors) {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${path} must be a non-empty string`);
  }
}

function validateBridgeConfig(config) {
  const errors = [];
  if (!isPlainObject(config)) {
    errors.push("openvpnShadowsocksConfig must be an object");
  }
  if (!isPlainObject(config?.openvpn)) {
    errors.push("openvpnShadowsocksConfig.openvpn must be an object");
  } else {
    validatePort(config.openvpn.listen_port, "openvpnShadowsocksConfig.openvpn.listen_port", errors);
    if (config.openvpn.proto !== "tcp-server") {
      errors.push("openvpnShadowsocksConfig.openvpn.proto must be tcp-server");
    }
    if (config.openvpn.local_address !== "127.0.0.1") {
      errors.push("openvpnShadowsocksConfig.openvpn.local_address must be 127.0.0.1");
    }
  }
  if (!isPlainObject(config?.shadowsocks)) {
    errors.push("openvpnShadowsocksConfig.shadowsocks must be an object");
  } else {
    validateText(config.shadowsocks.method, "openvpnShadowsocksConfig.shadowsocks.method", errors);
    validateText(config.shadowsocks.password, "openvpnShadowsocksConfig.shadowsocks.password", errors);
    validatePort(config.shadowsocks.listen_port, "openvpnShadowsocksConfig.shadowsocks.listen_port", errors);
  }
  const unresolved = assertNoUnresolvedRefs(config);
  if (unresolved.length > 0) {
    errors.push(`openvpnShadowsocksConfig contains unresolved refs: ${unresolved.join(", ")}`);
  }
  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }
}

function renderShadowsocksServerConfig(config) {
  validateBridgeConfig(config);
  return {
    server: String(config.shadowsocks.listen || "::"),
    server_port: config.shadowsocks.listen_port,
    method: config.shadowsocks.method,
    password: config.shadowsocks.password,
    mode: "tcp_only"
  };
}

export function createOpenVpnShadowsocksApplyPlan(input = {}) {
  const config = input.openvpnShadowsocksConfig ?? input.config;
  validateBridgeConfig(config);
  return Object.freeze({
    modelVersion: OPENVPN_SHADOWSOCKS_RUNTIME_MODEL_VERSION,
    id: input.id,
    config,
    configPath: input.configPath
  });
}

async function runExecFile(execFileImpl, command, args) {
  if (execFileImpl) {
    return await execFileImpl(command, args);
  }
  return await execFileAsync(command, args);
}

function readPid(pidFile) {
  try {
    const raw = readFileSync(pidFile, "utf8").trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function isPidRunning(pid) {
  if (!pid) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function stopPid(pidFile) {
  const pid = readPid(pidFile);
  if (!pid || !isPidRunning(pid)) {
    return false;
  }
  process.kill(pid, "SIGTERM");
  return true;
}

function startManagedProcess(binary, configPath, logPath, pidFile, spawnImpl = spawn) {
  mkdirSync(dirname(logPath), { recursive: true, mode: 0o700 });
  const stdout = openSync(logPath, "a", 0o600);
  const stderr = openSync(logPath, "a", 0o600);
  try {
    const child = spawnImpl(binary, ["-c", configPath], {
      detached: true,
      stdio: ["ignore", stdout, stderr]
    });
    child.unref();
    writeFileSync(pidFile, `${child.pid}\n`, { mode: 0o600 });
    return child.pid;
  } finally {
    closeSync(stdout);
    closeSync(stderr);
  }
}

function bridgeOpenVpnEnv(env, baseDir) {
  const openvpnDir = env.LUMEN_OPENVPN_SHADOWSOCKS_OPENVPN_DIR ??
    join(baseDir, "openvpn");
  return {
    ...env,
    LUMEN_OPENVPN_RELOAD_MODE: "process",
    LUMEN_OPENVPN_CONFIG_FILE: join(openvpnDir, "server.conf"),
    LUMEN_OPENVPN_AUTH_SCRIPT: join(openvpnDir, "auth-user-pass.sh"),
    LUMEN_OPENVPN_USERS_FILE: join(openvpnDir, "users.txt"),
    LUMEN_OPENVPN_LOG_FILE: join(openvpnDir, "openvpn.log"),
    LUMEN_OPENVPN_PID_FILE: join(openvpnDir, "openvpn.pid")
  };
}

export async function applyOpenVpnShadowsocksConfig(plan, input = {}) {
  const env = input.env ?? {};
  const configPath =
    plan.configPath ?? env.LUMEN_OPENVPN_SHADOWSOCKS_CONFIG_FILE ?? DEFAULT_OPENVPN_SHADOWSOCKS_CONFIG_PATH;
  const binary = env.LUMEN_OPENVPN_SHADOWSOCKS_BINARY ?? DEFAULT_OPENVPN_SHADOWSOCKS_BINARY;
  const runtimeConfig = renderShadowsocksServerConfig(plan.config);

  if (input.dryRun !== false) {
    return Object.freeze({
      implementationStatus: "openvpn-shadowsocks-dry-run",
      configPath
    });
  }

  const bridgeDir = dirname(configPath);
  const openvpn = await applyOpenVpnConfig(
    {
      id: plan.id,
      config: plan.config.openvpn,
      configPath: join(bridgeDir, "openvpn", "server.conf")
    },
    {
      dryRun: false,
      env: bridgeOpenVpnEnv(env, bridgeDir),
      execFileImpl: input.execFileImpl,
      isPidRunningImpl: input.isPidRunningImpl,
      processStartCheckMs: input.processStartCheckMs,
      spawnImpl: input.spawnImpl
    }
  );

  mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 });
  writeFileSync(configPath, `${JSON.stringify(runtimeConfig, null, 2)}\n`, { mode: 0o600 });
  await runExecFile(input.execFileImpl, binary, ["--version"]);
  const logPath = env.LUMEN_OPENVPN_SHADOWSOCKS_LOG_FILE ?? DEFAULT_OPENVPN_SHADOWSOCKS_LOG_FILE;
  const pidFile = env.LUMEN_OPENVPN_SHADOWSOCKS_PID_FILE ?? DEFAULT_OPENVPN_SHADOWSOCKS_PID_FILE;
  stopPid(pidFile);
  const pid = startManagedProcess(binary, configPath, logPath, pidFile, input.spawnImpl);
  return Object.freeze({
    implementationStatus: "openvpn-shadowsocks-managed-process-started",
    configPath,
    logPath,
    pid,
    openvpn,
    listenPort: plan.config.shadowsocks.listen_port,
    protocol: "tcp"
  });
}

export async function ensureManagedOpenVpnShadowsocksProcess(input = {}) {
  const env = input.env ?? {};
  const configPath = env.LUMEN_OPENVPN_SHADOWSOCKS_CONFIG_FILE ?? DEFAULT_OPENVPN_SHADOWSOCKS_CONFIG_PATH;
  if (!existsSync(configPath)) {
    return null;
  }
  const bridgeDir = dirname(configPath);
  const openvpn = await ensureManagedOpenVpnProcess({
    ...input,
    env: bridgeOpenVpnEnv(env, bridgeDir)
  });
  const binary = env.LUMEN_OPENVPN_SHADOWSOCKS_BINARY ?? DEFAULT_OPENVPN_SHADOWSOCKS_BINARY;
  const logPath = env.LUMEN_OPENVPN_SHADOWSOCKS_LOG_FILE ?? DEFAULT_OPENVPN_SHADOWSOCKS_LOG_FILE;
  const pidFile = env.LUMEN_OPENVPN_SHADOWSOCKS_PID_FILE ?? DEFAULT_OPENVPN_SHADOWSOCKS_PID_FILE;
  await runExecFile(input.execFileImpl, binary, ["--version"]);
  const pid = readPid(pidFile);
  if (isPidRunning(pid)) {
    return Object.freeze({
      implementationStatus: "openvpn-shadowsocks-managed-process-running",
      configPath,
      logPath,
      pid,
      openvpn
    });
  }
  const nextPid = startManagedProcess(binary, configPath, logPath, pidFile, input.spawnImpl);
  return Object.freeze({
    implementationStatus: "openvpn-shadowsocks-managed-process-restored",
    configPath,
    logPath,
    pid: nextPid,
    openvpn
  });
}
