import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { promisify } from "node:util";
import { execFile as nodeExecFile, spawn } from "node:child_process";

export const SHADOWSOCKS_PLUGIN_RUNTIME_MODEL_VERSION =
  "lumen.node-agent.shadowsocks-plugin-runtime.v1";
export const DEFAULT_SHADOWSOCKS_PLUGIN_CONFIG_PATH =
  "/var/lib/lumen-node/runtime/shadowsocks-plugin/config.json";
export const DEFAULT_SHADOWSOCKS_PLUGIN_LOG_FILE =
  "/var/lib/lumen-node/runtime/shadowsocks-plugin/ssserver.log";
export const DEFAULT_SHADOWSOCKS_PLUGIN_PID_FILE =
  "/var/lib/lumen-node/runtime/shadowsocks-plugin/ssserver.pid";
export const DEFAULT_SHADOWSOCKS_SERVER_BINARY = "ssserver";
export const SHADOWSOCKS_PLUGIN_RELOAD_MODE_PROCESS = "process";

const execFileAsync = promisify(nodeExecFile);
const FORBIDDEN_UNRESOLVED_FIELDS = new Set(["clientsRef", "credentialsRef"]);
const ALLOWED_PLUGINS = new Set(["v2ray-plugin", "obfs-server"]);

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

function validatePluginConfig(config) {
  const errors = [];
  if (!isPlainObject(config)) {
    errors.push("shadowsocksPluginConfig must be an object");
  }
  if (typeof config?.method !== "string" || config.method.length === 0) {
    errors.push("shadowsocksPluginConfig.method must be a non-empty string");
  }
  if (typeof config?.password !== "string" || config.password.length === 0) {
    errors.push("shadowsocksPluginConfig.password must be a non-empty string");
  }
  if (!Number.isInteger(config?.listen_port) || config.listen_port < 1 || config.listen_port > 65535) {
    errors.push("shadowsocksPluginConfig.listen_port must be an integer port in 1..65535");
  }
  if (!ALLOWED_PLUGINS.has(config?.plugin)) {
    errors.push(`shadowsocksPluginConfig.plugin must be one of: ${[...ALLOWED_PLUGINS].join(", ")}`);
  }
  if (typeof config?.plugin_opts !== "string" || config.plugin_opts.length === 0) {
    errors.push("shadowsocksPluginConfig.plugin_opts must be a non-empty string");
  }
  const unresolved = assertNoUnresolvedRefs(config);
  if (unresolved.length > 0) {
    errors.push(`shadowsocksPluginConfig contains unresolved refs: ${unresolved.join(", ")}`);
  }
  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }
}

function renderServerConfig(config) {
  validatePluginConfig(config);
  return {
    server: String(config.listen || "::"),
    server_port: config.listen_port,
    method: config.method,
    password: config.password,
    mode: String(config.mode || "tcp_only"),
    plugin: config.plugin,
    plugin_opts: config.plugin_opts
  };
}

function pluginValidationArgs(plugin) {
  if (plugin === "v2ray-plugin") {
    return ["--version"];
  }
  return ["--help"];
}

export function createShadowsocksPluginApplyPlan(input = {}) {
  const config = input.shadowsocksPluginConfig ?? input.config;
  validatePluginConfig(config);
  return Object.freeze({
    modelVersion: SHADOWSOCKS_PLUGIN_RUNTIME_MODEL_VERSION,
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

export async function ensureManagedShadowsocksPluginProcess(input = {}) {
  const env = input.env ?? {};
  if (env.LUMEN_SHADOWSOCKS_PLUGIN_RELOAD_MODE !== SHADOWSOCKS_PLUGIN_RELOAD_MODE_PROCESS) {
    return null;
  }
  const configPath = env.LUMEN_SHADOWSOCKS_PLUGIN_CONFIG_FILE ?? DEFAULT_SHADOWSOCKS_PLUGIN_CONFIG_PATH;
  if (!existsSync(configPath)) {
    return null;
  }
  const binary = env.LUMEN_SHADOWSOCKS_SERVER_BINARY ?? DEFAULT_SHADOWSOCKS_SERVER_BINARY;
  const runtimeConfig = JSON.parse(readFileSync(configPath, "utf8"));
  const logPath = env.LUMEN_SHADOWSOCKS_PLUGIN_LOG_FILE ?? DEFAULT_SHADOWSOCKS_PLUGIN_LOG_FILE;
  const pidFile = env.LUMEN_SHADOWSOCKS_PLUGIN_PID_FILE ?? DEFAULT_SHADOWSOCKS_PLUGIN_PID_FILE;
  await runExecFile(input.execFileImpl, binary, ["--version"]);
  await runExecFile(
    input.execFileImpl,
    runtimeConfig.plugin,
    pluginValidationArgs(runtimeConfig.plugin)
  );
  const pid = readPid(pidFile);
  if (isPidRunning(pid)) {
    return Object.freeze({
      implementationStatus: "shadowsocks-plugin-managed-process-running",
      configPath,
      logPath,
      pid
    });
  }
  const nextPid = startManagedProcess(binary, configPath, logPath, pidFile, input.spawnImpl);
  return Object.freeze({
    implementationStatus: "shadowsocks-plugin-managed-process-restored",
    configPath,
    logPath,
    pid: nextPid
  });
}

export async function applyShadowsocksPluginConfig(plan, input = {}) {
  const env = input.env ?? {};
  const configPath =
    plan.configPath ?? env.LUMEN_SHADOWSOCKS_PLUGIN_CONFIG_FILE ?? DEFAULT_SHADOWSOCKS_PLUGIN_CONFIG_PATH;
  const binary = env.LUMEN_SHADOWSOCKS_SERVER_BINARY ?? DEFAULT_SHADOWSOCKS_SERVER_BINARY;
  const runtimeConfig = renderServerConfig(plan.config);

  if (input.dryRun !== false) {
    return Object.freeze({
      implementationStatus: "shadowsocks-plugin-dry-run",
      configPath
    });
  }

  mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 });
  writeFileSync(configPath, `${JSON.stringify(runtimeConfig, null, 2)}\n`, { mode: 0o600 });
  await runExecFile(input.execFileImpl, binary, ["--version"]);
  await runExecFile(
    input.execFileImpl,
    runtimeConfig.plugin,
    pluginValidationArgs(runtimeConfig.plugin)
  );
  const logPath = env.LUMEN_SHADOWSOCKS_PLUGIN_LOG_FILE ?? DEFAULT_SHADOWSOCKS_PLUGIN_LOG_FILE;
  const pidFile = env.LUMEN_SHADOWSOCKS_PLUGIN_PID_FILE ?? DEFAULT_SHADOWSOCKS_PLUGIN_PID_FILE;
  stopPid(pidFile);
  const pid = startManagedProcess(binary, configPath, logPath, pidFile, input.spawnImpl);
  return Object.freeze({
    implementationStatus: "shadowsocks-plugin-managed-process-started",
    configPath,
    logPath,
    pid,
    testCommand: `${binary} --version`
  });
}
