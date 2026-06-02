import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { promisify } from "node:util";
import { execFile as nodeExecFile, spawn } from "node:child_process";

export const XRAY_RUNTIME_MODEL_VERSION = "lumen.node-agent.xray-runtime.v1";
export const DEFAULT_XRAY_CONFIG_PATH = "/var/lib/lumen-node/runtime/xray/config.json";
export const DEFAULT_XRAY_BINARY = "xray";
export const DEFAULT_XRAY_RELOAD_ARGV = Object.freeze(["systemctl", "reload", "xray"]);
export const XRAY_RELOAD_MODE_PROCESS = "process";

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

function parseArgv(value, fallback) {
  if (!value) {
    return [...fallback];
  }
  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.some((part) => typeof part !== "string" || part.length === 0)) {
    throw new Error("xray reload argv must be a JSON array of non-empty strings");
  }
  return parsed;
}

function summarizeArgv(argv) {
  return argv.join(" ");
}

function validateXrayConfig(config) {
  const errors = [];
  if (!isPlainObject(config)) {
    errors.push("xrayConfig must be an object");
  }
  if (!Array.isArray(config?.inbounds) || config.inbounds.length === 0) {
    errors.push("xrayConfig.inbounds must contain at least one inbound");
  }
  if (Array.isArray(config?.inbounds)) {
    config.inbounds.forEach((inbound, index) => {
      if (!isPlainObject(inbound)) {
        errors.push(`xrayConfig.inbounds[${index}] must be an object`);
        return;
      }
      if (typeof inbound.protocol !== "string" || inbound.protocol.length === 0) {
        errors.push(`xrayConfig.inbounds[${index}].protocol must be a non-empty string`);
      }
      if (!Number.isInteger(inbound.port) || inbound.port < 1 || inbound.port > 65535) {
        errors.push(`xrayConfig.inbounds[${index}].port must be an integer port`);
      }
      validateXrayStreamSettings(inbound.streamSettings, `xrayConfig.inbounds[${index}].streamSettings`, errors);
    });
  }
  const unresolved = assertNoUnresolvedRefs(config);
  if (unresolved.length > 0) {
    errors.push(`xrayConfig contains unresolved refs: ${unresolved.join(", ")}`);
  }
  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }
}

function requirePlainObject(value, path, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${path} must be an object`);
    return false;
  }
  return true;
}

function requireNonEmptyString(value, path, errors) {
  if (typeof value !== "string" || value.length === 0) {
    errors.push(`${path} must be a non-empty string`);
    return false;
  }
  return true;
}

function validateXrayStreamSettings(streamSettings, path, errors) {
  if (!requirePlainObject(streamSettings, path, errors)) {
    return;
  }
  const network = streamSettings.network;
  requireNonEmptyString(network, `${path}.network`, errors);
  if (!["tcp", "ws", "grpc", "httpupgrade", "xhttp"].includes(network)) {
    errors.push(`${path}.network is unsupported: ${network}`);
  }
  const security = streamSettings.security ?? "none";
  if (!["none", "tls", "reality"].includes(security)) {
    errors.push(`${path}.security is unsupported: ${security}`);
  }
  if (network === "ws") {
    if (requirePlainObject(streamSettings.wsSettings, `${path}.wsSettings`, errors)) {
      requireNonEmptyString(streamSettings.wsSettings.path, `${path}.wsSettings.path`, errors);
    }
  }
  if (network === "grpc") {
    if (requirePlainObject(streamSettings.grpcSettings, `${path}.grpcSettings`, errors)) {
      requireNonEmptyString(streamSettings.grpcSettings.serviceName, `${path}.grpcSettings.serviceName`, errors);
    }
  }
  if (network === "httpupgrade") {
    if (requirePlainObject(streamSettings.httpupgradeSettings, `${path}.httpupgradeSettings`, errors)) {
      requireNonEmptyString(streamSettings.httpupgradeSettings.path, `${path}.httpupgradeSettings.path`, errors);
    }
  }
  if (network === "xhttp") {
    if (requirePlainObject(streamSettings.xhttpSettings, `${path}.xhttpSettings`, errors)) {
      requireNonEmptyString(streamSettings.xhttpSettings.path, `${path}.xhttpSettings.path`, errors);
      requireNonEmptyString(streamSettings.xhttpSettings.mode, `${path}.xhttpSettings.mode`, errors);
    }
  }
  if (security === "tls") {
    if (requirePlainObject(streamSettings.tlsSettings, `${path}.tlsSettings`, errors)) {
      if (!Array.isArray(streamSettings.tlsSettings.certificates) || streamSettings.tlsSettings.certificates.length === 0) {
        errors.push(`${path}.tlsSettings.certificates must contain at least one certificate`);
      }
    }
  }
  if (security === "reality") {
    if (requirePlainObject(streamSettings.realitySettings, `${path}.realitySettings`, errors)) {
      requireNonEmptyString(streamSettings.realitySettings.privateKey, `${path}.realitySettings.privateKey`, errors);
      if (!Array.isArray(streamSettings.realitySettings.serverNames) || streamSettings.realitySettings.serverNames.length === 0) {
        errors.push(`${path}.realitySettings.serverNames must contain at least one name`);
      }
      if (!Array.isArray(streamSettings.realitySettings.shortIds)) {
        errors.push(`${path}.realitySettings.shortIds must be an array`);
      }
    }
  }
}

export function createXrayApplyPlan(input = {}) {
  const config = input.xrayConfig ?? input.config;
  validateXrayConfig(config);
  return Object.freeze({
    modelVersion: XRAY_RUNTIME_MODEL_VERSION,
    id: input.id,
    config,
    configPath: input.configPath,
    xrayBinary: input.xrayBinary,
    reloadArgv: input.reloadArgv
  });
}

async function runExecFile(execFileImpl, command, args) {
  if (execFileImpl) {
    return await execFileImpl(command, args);
  }
  return await execFileAsync(command, args);
}

async function stopManagedXray(execFileImpl) {
  try {
    await runExecFile(execFileImpl, "pkill", ["-TERM", "-x", "xray"]);
  } catch (error) {
    if (error?.code !== 1) {
      throw error;
    }
  }
}

async function isManagedXrayRunning(execFileImpl) {
  try {
    await runExecFile(execFileImpl, "pgrep", ["-x", "xray"]);
    return true;
  } catch (error) {
    if (error?.code === 1) {
      return false;
    }
    throw error;
  }
}

function startManagedXray(xrayBinary, configPath, logPath, spawnImpl = spawn) {
  mkdirSync(dirname(logPath), { recursive: true, mode: 0o700 });
  const stdout = openSync(logPath, "a", 0o600);
  const stderr = openSync(logPath, "a", 0o600);
  try {
    const child = spawnImpl(xrayBinary, ["run", "-config", configPath], {
      detached: true,
      stdio: ["ignore", stdout, stderr]
    });
    child.unref();
    return child.pid;
  } finally {
    closeSync(stdout);
    closeSync(stderr);
  }
}

export async function ensureManagedXrayProcess(input = {}) {
  const env = input.env ?? {};
  if (env.LUMEN_XRAY_RELOAD_MODE !== XRAY_RELOAD_MODE_PROCESS) {
    return null;
  }
  const configPath = env.LUMEN_XRAY_CONFIG_FILE ?? DEFAULT_XRAY_CONFIG_PATH;
  if (!existsSync(configPath)) {
    return null;
  }
  const xrayBinary = env.LUMEN_XRAY_BINARY ?? DEFAULT_XRAY_BINARY;
  const logPath = env.LUMEN_XRAY_LOG_FILE ?? "/var/lib/lumen-node/runtime/xray/xray.log";
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  validateXrayConfig(config);
  await runExecFile(input.execFileImpl, xrayBinary, ["-test", "-config", configPath]);
  if (await isManagedXrayRunning(input.execFileImpl)) {
    return Object.freeze({
      implementationStatus: "xray-managed-process-running",
      configPath,
      logPath
    });
  }
  const pid = startManagedXray(xrayBinary, configPath, logPath, input.spawnImpl);
  return Object.freeze({
    implementationStatus: "xray-managed-process-restored",
    configPath,
    logPath,
    pid
  });
}

export async function applyXrayConfig(plan, input = {}) {
  const env = input.env ?? {};
  const configPath = plan.configPath ?? env.LUMEN_XRAY_CONFIG_FILE ?? DEFAULT_XRAY_CONFIG_PATH;
  const xrayBinary = plan.xrayBinary ?? env.LUMEN_XRAY_BINARY ?? DEFAULT_XRAY_BINARY;
  const reloadMode = env.LUMEN_XRAY_RELOAD_MODE ?? "";
  const reloadArgv = plan.reloadArgv ?? parseArgv(env.LUMEN_XRAY_RELOAD_ARGV, DEFAULT_XRAY_RELOAD_ARGV);
  const testArgv = [xrayBinary, ["-test", "-config", configPath]];
  const reloadCommand = [reloadArgv[0], reloadArgv.slice(1)];

  validateXrayConfig(plan.config);

  if (input.dryRun !== false) {
    return Object.freeze({
      implementationStatus: "xray-dry-run",
      configPath,
      testCommand: summarizeArgv([testArgv[0], ...testArgv[1]]),
      reloadCommand: summarizeArgv(reloadArgv)
    });
  }

  mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 });
  writeFileSync(configPath, `${JSON.stringify(plan.config, null, 2)}\n`, { mode: 0o600 });
  await runExecFile(input.execFileImpl, testArgv[0], testArgv[1]);
  if (reloadMode === XRAY_RELOAD_MODE_PROCESS) {
    await stopManagedXray(input.execFileImpl);
    const logPath = env.LUMEN_XRAY_LOG_FILE ?? "/var/lib/lumen-node/runtime/xray/xray.log";
    const pid = startManagedXray(xrayBinary, configPath, logPath, input.spawnImpl);
    return Object.freeze({
      implementationStatus: "xray-managed-process-started",
      configPath,
      pid,
      logPath,
      testCommand: summarizeArgv([testArgv[0], ...testArgv[1]])
    });
  }
  await runExecFile(input.execFileImpl, reloadCommand[0], reloadCommand[1]);

  return Object.freeze({
    implementationStatus: "xray-applied",
    configPath,
    testCommand: summarizeArgv([testArgv[0], ...testArgv[1]]),
    reloadCommand: summarizeArgv(reloadArgv)
  });
}
