import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { promisify } from "node:util";
import { execFile as nodeExecFile } from "node:child_process";

export const WIREGUARD_RUNTIME_MODEL_VERSION = "lumen.node-agent.wireguard-runtime.v2";
export const DEFAULT_WIREGUARD_CONFIG_PATH = "/etc/wireguard/lumen-wg.conf";
export const DEFAULT_WIREGUARD_RELOAD_MODE = "wg-quick";
export const DEFAULT_WIREGUARD_RELOAD_ARGV = Object.freeze(["wg-quick", "up"]);

const execFileAsync = promisify(nodeExecFile);
const FORBIDDEN_UNRESOLVED_FIELDS = new Set(["clientsRef", "credentialsRef"]);

// Structured interface keys mapped to their wg-quick INI names. Any other
// interface key (e.g. AmneziaWG obfuscation params Jc/Jmin/S1/H1) is rendered
// verbatim, so the same runtime serves WireGuard and AmneziaWG.
const INTERFACE_KEY_MAP = Object.freeze({
  private_key: "PrivateKey",
  address: "Address",
  listen_port: "ListenPort",
  dns: "DNS",
  mtu: "MTU"
});
const PEER_KEY_MAP = Object.freeze({
  public_key: "PublicKey",
  preshared_key: "PresharedKey",
  allowed_ips: "AllowedIPs",
  endpoint: "Endpoint",
  persistent_keepalive: "PersistentKeepalive"
});
const AMNEZIA_WG_KEYS = Object.freeze([
  "Jc",
  "Jmin",
  "Jmax",
  "S1",
  "S2",
  "S3",
  "S4",
  "H1",
  "H2",
  "H3",
  "H4",
  "I1",
  "I2",
  "I3",
  "I4",
  "I5"
]);

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
    throw new Error("wireguard reload argv must be a JSON array of non-empty strings");
  }
  return parsed;
}

function summarizeArgv(argv) {
  return argv.join(" ");
}

function interfaceNameFromConfigPath(configPath) {
  return basename(configPath).replace(/\.conf$/i, "");
}

function containsAmneziaWireGuardOptions(config) {
  return AMNEZIA_WG_KEYS.some((key) => config?.interface?.[key] !== undefined);
}

function validateWireguardConfig(config) {
  const errors = [];
  if (!isPlainObject(config)) {
    errors.push("wireguardConfig must be an object");
  }
  const iface = config?.interface;
  if (!isPlainObject(iface)) {
    errors.push("wireguardConfig.interface must be an object");
  } else {
    if (typeof iface.private_key !== "string" || iface.private_key.length === 0) {
      errors.push("wireguardConfig.interface.private_key must be a non-empty string");
    }
    if (typeof iface.address !== "string" || iface.address.length === 0) {
      errors.push("wireguardConfig.interface.address must be a non-empty string");
    }
    if (!Number.isInteger(iface.listen_port) || iface.listen_port < 1 || iface.listen_port > 65535) {
      errors.push("wireguardConfig.interface.listen_port must be an integer port");
    }
  }
  if (!Array.isArray(config?.peers) || config.peers.length === 0) {
    errors.push("wireguardConfig.peers must contain at least one peer");
  } else {
    config.peers.forEach((peer, index) => {
      if (!isPlainObject(peer)) {
        errors.push(`wireguardConfig.peers[${index}] must be an object`);
        return;
      }
      if (typeof peer.public_key !== "string" || peer.public_key.length === 0) {
        errors.push(`wireguardConfig.peers[${index}].public_key must be a non-empty string`);
      }
      if (typeof peer.allowed_ips !== "string" || peer.allowed_ips.length === 0) {
        errors.push(`wireguardConfig.peers[${index}].allowed_ips must be a non-empty string`);
      }
    });
  }
  const unresolved = assertNoUnresolvedRefs(config);
  if (unresolved.length > 0) {
    errors.push(`wireguardConfig contains unresolved refs: ${unresolved.join(", ")}`);
  }
  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }
}

function renderSection(header, values, keyMap) {
  const lines = [`[${header}]`];
  const seen = new Set();
  for (const [key, mapped] of Object.entries(keyMap)) {
    if (values[key] !== undefined && values[key] !== null) {
      lines.push(`${mapped} = ${values[key]}`);
      seen.add(key);
    }
  }
  // Pass-through for extra keys (e.g. AmneziaWG params), rendered verbatim.
  for (const [key, value] of Object.entries(values)) {
    if (seen.has(key) || value === undefined || value === null || isPlainObject(value) || Array.isArray(value)) {
      continue;
    }
    lines.push(`${key} = ${value}`);
  }
  return lines;
}

export function renderWireguardIni(config) {
  validateWireguardConfig(config);
  const lines = renderSection("Interface", config.interface, INTERFACE_KEY_MAP);
  for (const peer of config.peers) {
    lines.push("");
    lines.push(...renderSection("Peer", peer, PEER_KEY_MAP));
  }
  return `${lines.join("\n")}\n`;
}

export function createWireguardApplyPlan(input = {}) {
  const config = input.wireguardConfig ?? input.config;
  validateWireguardConfig(config);
  if (input.reloadMode === "awg-quick" && !containsAmneziaWireGuardOptions(config)) {
    throw new Error("awg-quick reload mode requires AmneziaWG interface options");
  }
  return Object.freeze({
    modelVersion: WIREGUARD_RUNTIME_MODEL_VERSION,
    id: input.id,
    config,
    configPath: input.configPath,
    reloadMode: input.reloadMode,
    reloadArgv: input.reloadArgv
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

export async function applyWireguardConfig(plan, input = {}) {
  const env = input.env ?? {};
  const configPath =
    plan.configPath ?? env.LUMEN_WIREGUARD_CONFIG_FILE ?? DEFAULT_WIREGUARD_CONFIG_PATH;
  const reloadMode =
    plan.reloadMode ??
    env.LUMEN_WIREGUARD_RELOAD_MODE ??
    (containsAmneziaWireGuardOptions(plan.config) ? "awg-quick" : DEFAULT_WIREGUARD_RELOAD_MODE);
  const reloadArgv =
    plan.reloadArgv ?? parseArgv(env.LUMEN_WIREGUARD_RELOAD_ARGV, DEFAULT_WIREGUARD_RELOAD_ARGV);
  const interfaceName = env.LUMEN_WIREGUARD_INTERFACE ?? interfaceNameFromConfigPath(configPath);

  const rendered = renderWireguardIni(plan.config);

  if (input.dryRun !== false) {
    return Object.freeze({
      implementationStatus: "wireguard-dry-run",
      configPath,
      interfaceName,
      reloadMode,
      reloadCommand: summarizeArgv(reloadArgv)
    });
  }

  mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 });
  writeFileSync(configPath, rendered, { mode: 0o600 });

  if (reloadMode === "wg-quick") {
    await runExecFileIgnoringFailure(input.execFileImpl, "wg-quick", ["down", configPath]);
    await runExecFile(input.execFileImpl, "wg-quick", ["up", configPath]);
    await runExecFile(input.execFileImpl, "wg", ["show", interfaceName]);
  } else if (reloadMode === "awg-quick") {
    await runExecFileIgnoringFailure(input.execFileImpl, "awg-quick", ["down", configPath]);
    await runExecFile(input.execFileImpl, "awg-quick", ["up", configPath]);
    await runExecFile(input.execFileImpl, "awg", ["show", interfaceName]);
  } else if (reloadMode === "exec") {
    await runExecFile(input.execFileImpl, reloadArgv[0], reloadArgv.slice(1));
  } else {
    throw new Error(`unsupported wireguard reload mode: ${reloadMode}`);
  }

  return Object.freeze({
    implementationStatus: "wireguard-applied",
    configPath,
    interfaceName,
    reloadMode,
    reloadCommand: summarizeArgv(reloadArgv)
  });
}
