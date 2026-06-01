import {
  chmodSync,
  chownSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { execFile as nodeExecFile, spawn } from "node:child_process";

export const OPENVPN_RUNTIME_MODEL_VERSION = "lumen.node-agent.openvpn-runtime.v1";
export const DEFAULT_OPENVPN_CONFIG_PATH = "/var/lib/lumen-node/runtime/openvpn/server.conf";
export const DEFAULT_OPENVPN_LOG_FILE = "/var/lib/lumen-node/runtime/openvpn/openvpn.log";
export const DEFAULT_OPENVPN_PID_FILE = "/var/lib/lumen-node/runtime/openvpn/openvpn.pid";
export const DEFAULT_OPENVPN_AUTH_SCRIPT = "/var/lib/lumen-node/runtime/openvpn/auth-user-pass.sh";
export const DEFAULT_OPENVPN_USERS_FILE = "/var/lib/lumen-node/runtime/openvpn/users.txt";
export const DEFAULT_OPENVPN_BINARY = "openvpn";
export const OPENVPN_RELOAD_MODE_PROCESS = "process";
export const OPENVPN_DROPPED_PRIVILEGE_UID = 65534;
export const OPENVPN_DROPPED_PRIVILEGE_GID = 65534;

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

function validateText(value, path, errors) {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${path} must be a non-empty string`);
  }
}

function validatePort(value, path, errors) {
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    errors.push(`${path} must be an integer port in 1..65535`);
  }
}

function validateCredential(value, path, errors) {
  validateText(value, path, errors);
  if (typeof value === "string" && /[\n\r:]/.test(value)) {
    errors.push(`${path} must not contain newline or colon characters`);
  }
}

function validateOpenVpnConfig(config) {
  const errors = [];
  if (!isPlainObject(config)) {
    errors.push("openvpnConfig must be an object");
  }
  validatePort(config?.listen_port, "openvpnConfig.listen_port", errors);
  if (!["udp", "tcp-server"].includes(config?.proto)) {
    errors.push("openvpnConfig.proto must be udp or tcp-server");
  }
  validateText(config?.network, "openvpnConfig.network", errors);
  if (!isPlainObject(config?.pki)) {
    errors.push("openvpnConfig.pki must be an object");
  } else {
    validateText(config.pki.ca_cert, "openvpnConfig.pki.ca_cert", errors);
    validateText(config.pki.server_cert, "openvpnConfig.pki.server_cert", errors);
    validateText(config.pki.server_key, "openvpnConfig.pki.server_key", errors);
  }
  if (!Array.isArray(config?.users) || config.users.length === 0) {
    errors.push("openvpnConfig.users must contain at least one user");
  } else {
    config.users.forEach((user, index) => {
      if (!isPlainObject(user)) {
        errors.push(`openvpnConfig.users[${index}] must be an object`);
        return;
      }
      validateCredential(user.username, `openvpnConfig.users[${index}].username`, errors);
      validateCredential(user.password, `openvpnConfig.users[${index}].password`, errors);
    });
  }
  const unresolved = assertNoUnresolvedRefs(config);
  if (unresolved.length > 0) {
    errors.push(`openvpnConfig contains unresolved refs: ${unresolved.join(", ")}`);
  }
  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }
}

function cidrToNetworkAndMask(cidr) {
  const match = String(cidr).match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/);
  if (!match) {
    throw new Error("openvpnConfig.network must be an IPv4 CIDR such as 10.88.0.0/24");
  }
  const prefix = Number.parseInt(match[2], 10);
  if (prefix < 8 || prefix > 30) {
    throw new Error("openvpnConfig.network prefix must be between 8 and 30");
  }
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  return {
    network: match[1],
    netmask: [24, 16, 8, 0].map((shift) => (mask >>> shift) & 255).join("."),
    cidr: `${match[1]}/${prefix}`
  };
}

function writeRuntimeFile(path, content, mode = 0o600) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, content.endsWith("\n") ? content : `${content}\n`, { mode });
}

function chownRuntimePath(path, uid = OPENVPN_DROPPED_PRIVILEGE_UID, gid = OPENVPN_DROPPED_PRIVILEGE_GID) {
  try {
    chownSync(path, uid, gid);
  } catch (error) {
    if (!["EINVAL", "ENOSYS", "EPERM"].includes(error?.code)) {
      throw error;
    }
  }
}

function ensureDroppedUserCanTraverse(path) {
  const normalized = path.replaceAll("\\", "/");
  if (!normalized.startsWith("/var/lib/lumen-node/")) {
    return;
  }
  let current = dirname(normalized);
  while (current.startsWith("/var/lib/lumen-node")) {
    try {
      const mode = statSync(current).mode & 0o777;
      chmodSync(current, mode | 0o111);
    } catch (error) {
      if (!["ENOENT", "EINVAL", "ENOSYS", "EPERM"].includes(error?.code)) {
        throw error;
      }
    }
    if (current === "/var/lib/lumen-node") {
      break;
    }
    current = dirname(current);
  }
}

function hardenAuthRuntimePermissions(paths) {
  const runtimeDir = dirname(paths.usersPath);
  ensureDroppedUserCanTraverse(runtimeDir);
  chownRuntimePath(runtimeDir);
  chmodSync(runtimeDir, 0o700);
  chownRuntimePath(paths.authScriptPath);
  chmodSync(paths.authScriptPath, 0o500);
  chownRuntimePath(paths.usersPath);
  chmodSync(paths.usersPath, 0o400);
}

function renderAuthScript(usersFile) {
  return `#!/bin/sh
set -eu
if [ -z "\${username:-}" ] || [ -z "\${password:-}" ]; then
  exit 1
fi
grep -Fx -- "\${username}:\${password}" "${usersFile}" >/dev/null 2>&1
`;
}

function renderUsersFile(users) {
  return users.map((user) => `${user.username}:${user.password}`).join("\n");
}

export function renderOpenVpnServerConfig(config, paths) {
  validateOpenVpnConfig(config);
  const network = cidrToNetworkAndMask(config.network);
  const push = Array.isArray(config.push) ? config.push : [
    "redirect-gateway def1 bypass-dhcp",
    "dhcp-option DNS 1.1.1.1"
  ];
  const lines = [
    `port ${config.listen_port}`,
    `proto ${config.proto}`,
    ...(typeof config.local_address === "string" && config.local_address.trim().length > 0
      ? [`local ${config.local_address.trim()}`]
      : []),
    "dev tun",
    "topology subnet",
    `server ${network.network} ${network.netmask}`,
    "persist-key",
    "persist-tun",
    "keepalive 10 120",
    `ca ${paths.caCertPath}`,
    `cert ${paths.serverCertPath}`,
    `key ${paths.serverKeyPath}`,
    "dh none",
    "ecdh-curve prime256v1",
    "verify-client-cert none",
    "username-as-common-name",
    `auth-user-pass-verify ${paths.authScriptPath} via-env`,
    "script-security 3",
    "auth SHA256",
    "data-ciphers AES-256-GCM:AES-128-GCM:CHACHA20-POLY1305",
    "user nobody",
    "group nobody",
    `status ${paths.statusPath}`,
    "verb 3",
    ...push.map((value) => `push "${value}"`)
  ];
  return `${lines.join("\n")}\n`;
}

export function createOpenVpnApplyPlan(input = {}) {
  const config = input.openvpnConfig ?? input.config;
  validateOpenVpnConfig(config);
  return Object.freeze({
    modelVersion: OPENVPN_RUNTIME_MODEL_VERSION,
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function configureForwarding(execFileImpl, networkCidr) {
  await runExecFile(execFileImpl, "sh", ["-c", [
    "sysctl -w net.ipv4.ip_forward=1 >/dev/null 2>/dev/null || [ \"$(cat /proc/sys/net/ipv4/ip_forward 2>/dev/null)\" = \"1\" ]",
    `while iptables -t nat -D POSTROUTING -s ${networkCidr} -j MASQUERADE 2>/dev/null; do :; done`,
    `iptables -t nat -A POSTROUTING -s ${networkCidr} -j MASQUERADE`
  ].join(" && ")]);
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

function readLogTail(logPath, maxBytes = 4096) {
  try {
    const raw = readFileSync(logPath, "utf8");
    return raw.slice(Math.max(0, raw.length - maxBytes)).trim();
  } catch (error) {
    if (error?.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

async function assertManagedProcessAlive(pid, logPath, input = {}) {
  const waitMs = Number.isInteger(input.processStartCheckMs) ? input.processStartCheckMs : 1000;
  if (waitMs > 0) {
    await sleep(waitMs);
  }
  const isRunning = input.isPidRunningImpl ?? isPidRunning;
  if (isRunning(pid)) {
    return;
  }
  const tail = readLogTail(logPath);
  throw new Error(
    tail.length > 0
      ? `openvpn managed process exited during startup: ${tail}`
      : "openvpn managed process exited during startup"
  );
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
    const child = spawnImpl(binary, ["--config", configPath], {
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

function runtimePaths(configPath, env) {
  const baseDir = dirname(configPath);
  return Object.freeze({
    caCertPath: join(baseDir, "ca.crt"),
    serverCertPath: join(baseDir, "server.crt"),
    serverKeyPath: join(baseDir, "server.key"),
    authScriptPath: env.LUMEN_OPENVPN_AUTH_SCRIPT ?? DEFAULT_OPENVPN_AUTH_SCRIPT,
    usersPath: env.LUMEN_OPENVPN_USERS_FILE ?? DEFAULT_OPENVPN_USERS_FILE,
    statusPath: join(baseDir, "status.log")
  });
}

function writeOpenVpnRuntimeFiles(config, configPath, env) {
  const paths = runtimePaths(configPath, env);
  writeRuntimeFile(paths.caCertPath, config.pki.ca_cert);
  writeRuntimeFile(paths.serverCertPath, config.pki.server_cert);
  writeRuntimeFile(paths.serverKeyPath, config.pki.server_key);
  writeRuntimeFile(paths.usersPath, renderUsersFile(config.users));
  writeRuntimeFile(paths.authScriptPath, renderAuthScript(paths.usersPath), 0o700);
  writeRuntimeFile(configPath, renderOpenVpnServerConfig(config, paths));
  hardenAuthRuntimePermissions(paths);
  return paths;
}

export async function ensureManagedOpenVpnProcess(input = {}) {
  const env = input.env ?? {};
  if (env.LUMEN_OPENVPN_RELOAD_MODE !== OPENVPN_RELOAD_MODE_PROCESS) {
    return null;
  }
  const configPath = env.LUMEN_OPENVPN_CONFIG_FILE ?? DEFAULT_OPENVPN_CONFIG_PATH;
  if (!existsSync(configPath)) {
    return null;
  }
  const binary = env.LUMEN_OPENVPN_BINARY ?? DEFAULT_OPENVPN_BINARY;
  const logPath = env.LUMEN_OPENVPN_LOG_FILE ?? DEFAULT_OPENVPN_LOG_FILE;
  const pidFile = env.LUMEN_OPENVPN_PID_FILE ?? DEFAULT_OPENVPN_PID_FILE;
  ensureDroppedUserCanTraverse(dirname(configPath));
  await runExecFile(input.execFileImpl, binary, ["--version"]);
  const pid = readPid(pidFile);
  if (isPidRunning(pid)) {
    return Object.freeze({
      implementationStatus: "openvpn-managed-process-running",
      configPath,
      logPath,
      pid
    });
  }
  const nextPid = startManagedProcess(binary, configPath, logPath, pidFile, input.spawnImpl);
  await assertManagedProcessAlive(nextPid, logPath, input);
  return Object.freeze({
    implementationStatus: "openvpn-managed-process-restored",
    configPath,
    logPath,
    pid: nextPid
  });
}

export async function applyOpenVpnConfig(plan, input = {}) {
  const env = input.env ?? {};
  const configPath = plan.configPath ?? env.LUMEN_OPENVPN_CONFIG_FILE ?? DEFAULT_OPENVPN_CONFIG_PATH;
  const binary = env.LUMEN_OPENVPN_BINARY ?? DEFAULT_OPENVPN_BINARY;

  validateOpenVpnConfig(plan.config);
  const network = cidrToNetworkAndMask(plan.config.network);

  if (input.dryRun !== false) {
    return Object.freeze({
      implementationStatus: "openvpn-dry-run",
      configPath
    });
  }

  writeOpenVpnRuntimeFiles(plan.config, configPath, env);
  await runExecFile(input.execFileImpl, binary, ["--version"]);
  await configureForwarding(input.execFileImpl, network.cidr);
  const logPath = env.LUMEN_OPENVPN_LOG_FILE ?? DEFAULT_OPENVPN_LOG_FILE;
  const pidFile = env.LUMEN_OPENVPN_PID_FILE ?? DEFAULT_OPENVPN_PID_FILE;
  stopPid(pidFile);
  const pid = startManagedProcess(binary, configPath, logPath, pidFile, input.spawnImpl);
  await assertManagedProcessAlive(pid, logPath, input);
  return Object.freeze({
    implementationStatus: "openvpn-managed-process-started",
    configPath,
    logPath,
    pid,
    listenPort: plan.config.listen_port,
    protocol: plan.config.proto
  });
}
