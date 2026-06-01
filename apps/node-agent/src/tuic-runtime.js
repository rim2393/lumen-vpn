import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { promisify } from "node:util";
import { execFile as nodeExecFile, spawn } from "node:child_process";

export const TUIC_RUNTIME_MODEL_VERSION = "lumen.node-agent.tuic-runtime.v1";
export const DEFAULT_TUIC_CONFIG_PATH = "/var/lib/lumen-node/runtime/tuic/config.json";
export const DEFAULT_TUIC_LOG_FILE = "/var/lib/lumen-node/runtime/tuic/sing-box.log";
export const DEFAULT_TUIC_PID_FILE = "/var/lib/lumen-node/runtime/tuic/sing-box.pid";
export const DEFAULT_TUIC_BINARY = "sing-box";
export const DEFAULT_TUIC_RELOAD_ARGV = Object.freeze(["systemctl", "restart", "tuic-server"]);
export const TUIC_RELOAD_MODE_PROCESS = "process";

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
  if (
    !Array.isArray(parsed) ||
    parsed.some((part) => typeof part !== "string" || part.length === 0)
  ) {
    throw new Error("tuic reload argv must be a JSON array of non-empty strings");
  }
  return parsed;
}

function summarizeArgv(argv) {
  return argv.join(" ");
}

function parseListen(value) {
  const listen = typeof value === "string" && value.length > 0 ? value : ":443";
  const match = listen.match(/^(.*):(\d+)$/);
  if (!match) {
    throw new Error("tuicConfig.server must include a numeric port");
  }
  const port = Number.parseInt(match[2], 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("tuicConfig.server port must be in 1..65535");
  }
  const host = match[1] || "::";
  return { host, port };
}

function validateTuicConfig(config) {
  const errors = [];
  if (!isPlainObject(config)) {
    errors.push("tuicConfig must be an object");
  }
  if (typeof config?.server !== "string" || config.server.length === 0) {
    errors.push("tuicConfig.server must be a non-empty listen string (e.g. '[::]:443')");
  }
  if (!isPlainObject(config?.users) || Object.keys(config.users).length === 0) {
    errors.push("tuicConfig.users must map at least one uuid to a password");
  }
  const hasInlineTls =
    typeof config?.certificate === "string" && typeof config?.private_key === "string";
  const hasAcme = isPlainObject(config?.acme);
  if (!hasInlineTls && !hasAcme) {
    errors.push("tuicConfig requires certificate+private_key or an acme block");
  }
  const unresolved = assertNoUnresolvedRefs(config);
  if (unresolved.length > 0) {
    errors.push(`tuicConfig contains unresolved refs: ${unresolved.join(", ")}`);
  }
  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }
}

function singBoxTlsFromTuic(config) {
  if (typeof config.certificate === "string" && typeof config.private_key === "string") {
    const tls = {
      enabled: true,
      certificate_path: config.certificate,
      key_path: config.private_key
    };
    if (typeof config.alpn === "string") {
      tls.alpn = config.alpn.split(",").map((item) => item.trim()).filter(Boolean);
    } else if (Array.isArray(config.alpn)) {
      tls.alpn = config.alpn;
    }
    return tls;
  }
  return { enabled: true, acme: config.acme };
}

export function renderTuicSingBoxConfig(config) {
  validateTuicConfig(config);
  const { host, port } = parseListen(config.server);
  return {
    log: { level: "info", timestamp: true },
    inbounds: [
      {
        type: "tuic",
        tag: "tuic-in",
        listen: host,
        listen_port: port,
        users: Object.entries(config.users).map(([uuid, password]) => ({
          uuid,
          password: String(password)
        })),
        congestion_control: String(config.congestion_control || "bbr"),
        tls: singBoxTlsFromTuic(config)
      }
    ],
    outbounds: [{ type: "direct", tag: "direct" }]
  };
}

export function createTuicApplyPlan(input = {}) {
  const config = input.tuicConfig ?? input.config;
  validateTuicConfig(config);
  return Object.freeze({
    modelVersion: TUIC_RUNTIME_MODEL_VERSION,
    id: input.id,
    config,
    configPath: input.configPath,
    reloadArgv: input.reloadArgv
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
    const child = spawnImpl(binary, ["run", "-c", configPath], {
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

export async function ensureManagedTuicProcess(input = {}) {
  const env = input.env ?? {};
  if (env.LUMEN_TUIC_RELOAD_MODE !== TUIC_RELOAD_MODE_PROCESS) {
    return null;
  }
  const configPath = env.LUMEN_TUIC_CONFIG_FILE ?? DEFAULT_TUIC_CONFIG_PATH;
  if (!existsSync(configPath)) {
    return null;
  }
  const binary = env.LUMEN_TUIC_BINARY ?? DEFAULT_TUIC_BINARY;
  const logPath = env.LUMEN_TUIC_LOG_FILE ?? DEFAULT_TUIC_LOG_FILE;
  const pidFile = env.LUMEN_TUIC_PID_FILE ?? DEFAULT_TUIC_PID_FILE;
  await runExecFile(input.execFileImpl, binary, ["check", "-c", configPath]);
  const pid = readPid(pidFile);
  if (isPidRunning(pid)) {
    return Object.freeze({
      implementationStatus: "tuic-managed-process-running",
      configPath,
      logPath,
      pid
    });
  }
  const nextPid = startManagedProcess(binary, configPath, logPath, pidFile, input.spawnImpl);
  return Object.freeze({
    implementationStatus: "tuic-managed-process-restored",
    configPath,
    logPath,
    pid: nextPid
  });
}

export async function applyTuicConfig(plan, input = {}) {
  const env = input.env ?? {};
  const configPath = plan.configPath ?? env.LUMEN_TUIC_CONFIG_FILE ?? DEFAULT_TUIC_CONFIG_PATH;
  const binary = env.LUMEN_TUIC_BINARY ?? DEFAULT_TUIC_BINARY;
  const reloadMode = env.LUMEN_TUIC_RELOAD_MODE ?? "";
  const reloadArgv =
    plan.reloadArgv ?? parseArgv(env.LUMEN_TUIC_RELOAD_ARGV, DEFAULT_TUIC_RELOAD_ARGV);
  const reloadCommand = [reloadArgv[0], reloadArgv.slice(1)];
  const runtimeConfig = reloadMode === TUIC_RELOAD_MODE_PROCESS
    ? renderTuicSingBoxConfig(plan.config)
    : plan.config;

  validateTuicConfig(plan.config);

  if (input.dryRun !== false) {
    return Object.freeze({
      implementationStatus: "tuic-dry-run",
      configPath,
      reloadCommand: summarizeArgv(reloadArgv)
    });
  }

  mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 });
  writeFileSync(configPath, `${JSON.stringify(runtimeConfig, null, 2)}\n`, { mode: 0o600 });
  if (reloadMode === TUIC_RELOAD_MODE_PROCESS) {
    await runExecFile(input.execFileImpl, binary, ["check", "-c", configPath]);
    const logPath = env.LUMEN_TUIC_LOG_FILE ?? DEFAULT_TUIC_LOG_FILE;
    const pidFile = env.LUMEN_TUIC_PID_FILE ?? DEFAULT_TUIC_PID_FILE;
    stopPid(pidFile);
    const pid = startManagedProcess(binary, configPath, logPath, pidFile, input.spawnImpl);
    return Object.freeze({
      implementationStatus: "tuic-managed-process-started",
      configPath,
      logPath,
      pid,
      testCommand: summarizeArgv([binary, "check", "-c", configPath])
    });
  }
  await runExecFile(input.execFileImpl, reloadCommand[0], reloadCommand[1]);

  return Object.freeze({
    implementationStatus: "tuic-applied",
    configPath,
    reloadCommand: summarizeArgv(reloadArgv)
  });
}
