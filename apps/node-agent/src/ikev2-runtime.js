import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { execFile as nodeExecFile } from "node:child_process";

export const IKEV2_RUNTIME_MODEL_VERSION = "lumen.node-agent.ikev2-runtime.v1";
export const DEFAULT_IKEV2_CONFIG_DIR = "/etc/swanctl";
export const DEFAULT_IKEV2_RUNTIME_DIR = "/var/lib/lumen-node/runtime/ikev2";

const execFileAsync = promisify(nodeExecFile);
const FORBIDDEN_UNRESOLVED_FIELDS = new Set(["clientsRef", "credentialsRef"]);
const DEFAULT_CHARON_VICI_SOCKET = "/var/run/charon.vici";

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
  if (typeof value === "string" && /[\n\r]/.test(value)) {
    errors.push(`${path} must not contain newline characters`);
  }
}

function validateIkev2Config(config) {
  const errors = [];
  if (!isPlainObject(config)) {
    errors.push("ikev2Config must be an object");
  }
  validatePort(config?.ike_port, "ikev2Config.ike_port", errors);
  validatePort(config?.nat_port, "ikev2Config.nat_port", errors);
  validateText(config?.server_id, "ikev2Config.server_id", errors);
  validateText(config?.pool, "ikev2Config.pool", errors);
  if (!isPlainObject(config?.pki)) {
    errors.push("ikev2Config.pki must be an object");
  } else {
    validateText(config.pki.ca_cert, "ikev2Config.pki.ca_cert", errors);
    validateText(config.pki.server_cert, "ikev2Config.pki.server_cert", errors);
    validateText(config.pki.server_key, "ikev2Config.pki.server_key", errors);
  }
  if (!Array.isArray(config?.users) || config.users.length === 0) {
    errors.push("ikev2Config.users must contain at least one user");
  } else {
    config.users.forEach((user, index) => {
      if (!isPlainObject(user)) {
        errors.push(`ikev2Config.users[${index}] must be an object`);
        return;
      }
      validateCredential(user.username, `ikev2Config.users[${index}].username`, errors);
      validateCredential(user.password, `ikev2Config.users[${index}].password`, errors);
    });
  }
  const unresolved = assertNoUnresolvedRefs(config);
  if (unresolved.length > 0) {
    errors.push(`ikev2Config contains unresolved refs: ${unresolved.join(", ")}`);
  }
  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }
}

function quoteSwan(value) {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
}

function runtimePaths(configDir, runtimeDir) {
  return Object.freeze({
    configDir,
    runtimeDir,
    swanctlConfPath: join(configDir, "swanctl.conf"),
    caCertPath: join(configDir, "x509ca", "lumen-ikev2-ca.pem"),
    serverCertPath: join(configDir, "x509", "lumen-ikev2-server.pem"),
    serverKeyPath: join(configDir, "private", "lumen-ikev2-server-key.pem")
  });
}

function writeRuntimeFile(path, content, mode = 0o600) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, content.endsWith("\n") ? content : `${content}\n`, { mode });
}

export function renderSwanctlConfig(config, paths) {
  validateIkev2Config(config);
  const connectionName = String(config.connection_name ?? "lumen-ikev2");
  const childName = String(config.child_name ?? "lumen-ikev2");
  const poolName = String(config.pool_name ?? "lumen-ikev2-pool");
  const localTs = Array.isArray(config.local_ts) && config.local_ts.length > 0
    ? config.local_ts.map(String).join(",")
    : "0.0.0.0/0";
  const dns = Array.isArray(config.dns) && config.dns.length > 0
    ? `\n      dns = ${config.dns.map(String).join(",")}`
    : "";
  const userSecrets = config.users.map((user, index) => [
    `    eap-${index} {`,
    `      id = ${quoteSwan(user.username)}`,
    `      secret = ${quoteSwan(user.password)}`,
    "    }"
  ].join("\n")).join("\n");

  return `connections {
  ${connectionName} {
    version = 2
    local_addrs = ${config.local_addrs ?? "0.0.0.0"}
    pools = ${poolName}
    proposals = ${config.proposals ?? "aes256gcm16-prfsha384-ecp384,aes256-sha256-modp2048"}
    fragmentation = yes
    send_cert = always

    local {
      auth = pubkey
      certs = ${paths.serverCertPath}
      id = ${quoteSwan(config.server_id)}
    }
    remote {
      auth = eap-mschapv2
      eap_id = %any
    }
    children {
      ${childName} {
        local_ts = ${localTs}
        esp_proposals = ${config.esp_proposals ?? "aes256gcm16-ecp384,aes256-sha256-modp2048"}
      }
    }
  }
}

pools {
  ${poolName} {
    addrs = ${config.pool}${dns}
  }
}

secrets {
    private-${connectionName} {
      file = ${paths.serverKeyPath}
    }
${userSecrets}
}
`;
}

export function createIkev2ApplyPlan(input = {}) {
  const config = input.ikev2Config ?? input.config;
  validateIkev2Config(config);
  return Object.freeze({
    modelVersion: IKEV2_RUNTIME_MODEL_VERSION,
    id: input.id,
    config,
    configDir: input.configDir,
    runtimeDir: input.runtimeDir
  });
}

async function runExecFile(execFileImpl, command, args) {
  if (execFileImpl) {
    return await execFileImpl(command, args);
  }
  return await execFileAsync(command, args);
}

async function runExecFileIgnoringFailure(execFileImpl, command, args) {
  try {
    return await runExecFile(execFileImpl, command, args);
  } catch {
    return undefined;
  }
}

async function waitForPath(path, input = {}) {
  const timeoutMs = Number.parseInt(String(input.timeoutMs ?? 5000), 10);
  const intervalMs = Number.parseInt(String(input.intervalMs ?? 100), 10);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (existsSync(path)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`${path} was not created before timeout`);
}

function retryableViciError(error) {
  const message = String(error?.message ?? "");
  return message.includes("charon.vici") || message.includes("Connection refused") || message.includes("No such file or directory");
}

async function runSwanctlLoadAllWhenReady(input = {}) {
  const timeoutMs = Number.parseInt(String(input.timeoutMs ?? 10000), 10);
  const intervalMs = Number.parseInt(String(input.intervalMs ?? 250), 10);
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() <= deadline) {
    try {
      return await runExecFile(input.execFileImpl, "swanctl", ["--load-all"]);
    } catch (error) {
      lastError = error;
      if (!retryableViciError(error)) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  throw lastError ?? new Error("swanctl --load-all did not finish before timeout");
}

async function configureForwarding(execFileImpl, pool) {
  await runExecFile(execFileImpl, "sh", ["-c", [
    "sysctl -w net.ipv4.ip_forward=1 >/dev/null 2>/dev/null || [ \"$(cat /proc/sys/net/ipv4/ip_forward 2>/dev/null)\" = \"1\" ]",
    `while iptables -t nat -D POSTROUTING -s ${pool} -j MASQUERADE 2>/dev/null; do :; done`,
    `iptables -t nat -A POSTROUTING -s ${pool} -j MASQUERADE`
  ].join(" && ")]);
}

export async function applyIkev2Config(plan, input = {}) {
  const env = input.env ?? {};
  const configDir = plan.configDir ?? env.LUMEN_IKEV2_CONFIG_DIR ?? DEFAULT_IKEV2_CONFIG_DIR;
  const runtimeDir = plan.runtimeDir ?? env.LUMEN_IKEV2_RUNTIME_DIR ?? DEFAULT_IKEV2_RUNTIME_DIR;
  const paths = runtimePaths(configDir, runtimeDir);
  const rendered = renderSwanctlConfig(plan.config, paths);

  if (input.dryRun !== false) {
    return Object.freeze({
      implementationStatus: "ikev2-dry-run",
      configDir,
      ikePort: plan.config.ike_port,
      natPort: plan.config.nat_port,
      userCount: plan.config.users.length
    });
  }

  mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
  writeRuntimeFile(paths.caCertPath, plan.config.pki.ca_cert, 0o644);
  writeRuntimeFile(paths.serverCertPath, plan.config.pki.server_cert, 0o644);
  writeRuntimeFile(paths.serverKeyPath, plan.config.pki.server_key, 0o600);
  writeRuntimeFile(paths.swanctlConfPath, rendered, 0o600);

  await configureForwarding(input.execFileImpl, plan.config.pool);
  await runExecFileIgnoringFailure(input.execFileImpl, "ipsec", ["stop"]);
  await runExecFile(input.execFileImpl, "ipsec", ["start"]);
  await waitForPath(env.LUMEN_IKEV2_VICI_SOCKET ?? DEFAULT_CHARON_VICI_SOCKET, {
    timeoutMs: env.LUMEN_IKEV2_VICI_WAIT_MS ?? 5000
  });
  await runSwanctlLoadAllWhenReady({
    execFileImpl: input.execFileImpl,
    timeoutMs: env.LUMEN_IKEV2_SWANCTL_READY_WAIT_MS ?? env.LUMEN_IKEV2_VICI_WAIT_MS ?? 10000
  });
  await runExecFile(input.execFileImpl, "swanctl", ["--list-conns"]);

  return Object.freeze({
    implementationStatus: "ikev2-applied",
    configDir,
    ikePort: plan.config.ike_port,
    natPort: plan.config.nat_port,
    userCount: plan.config.users.length
  });
}

export async function stopIkev2Runtime(input = {}) {
  const env = input.env ?? {};
  const configDir = input.configDir ?? env.LUMEN_IKEV2_CONFIG_DIR ?? DEFAULT_IKEV2_CONFIG_DIR;
  const runtimeDir = input.runtimeDir ?? env.LUMEN_IKEV2_RUNTIME_DIR ?? DEFAULT_IKEV2_RUNTIME_DIR;
  await runExecFileIgnoringFailure(input.execFileImpl, "ipsec", ["stop"]);
  rmSync(join(configDir, "swanctl.conf"), { force: true });
  rmSync(join(configDir, "x509", "lumen-ikev2-server.pem"), { force: true });
  rmSync(join(configDir, "x509ca", "lumen-ikev2-ca.pem"), { force: true });
  rmSync(join(configDir, "private", "lumen-ikev2-server-key.pem"), { force: true });
  rmSync(runtimeDir, { recursive: true, force: true });
  return Object.freeze({
    implementationStatus: "ikev2-stopped",
    configDir
  });
}
