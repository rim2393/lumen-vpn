import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { promisify } from "node:util";
import { execFile as nodeExecFile } from "node:child_process";

export const HYSTERIA2_RUNTIME_MODEL_VERSION = "lumen.node-agent.hysteria2-runtime.v1";
export const DEFAULT_HYSTERIA2_CONFIG_PATH = "/etc/hysteria/config.json";
export const DEFAULT_HYSTERIA2_RELOAD_ARGV = Object.freeze([
  "systemctl",
  "restart",
  "hysteria-server"
]);

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
    throw new Error("hysteria2 reload argv must be a JSON array of non-empty strings");
  }
  return parsed;
}

function summarizeArgv(argv) {
  return argv.join(" ");
}

function validateHysteria2Config(config) {
  const errors = [];
  if (!isPlainObject(config)) {
    errors.push("hysteria2Config must be an object");
  }
  if (typeof config?.listen !== "string" || config.listen.length === 0) {
    errors.push("hysteria2Config.listen must be a non-empty string (e.g. ':443')");
  }
  if (!isPlainObject(config?.auth)) {
    errors.push("hysteria2Config.auth must be an object");
  }
  const hasInlineTls =
    isPlainObject(config?.tls) &&
    typeof config.tls.cert === "string" &&
    typeof config.tls.key === "string";
  const hasAcme = isPlainObject(config?.acme);
  if (!hasInlineTls && !hasAcme) {
    errors.push("hysteria2Config requires tls.cert+tls.key or an acme block");
  }
  const unresolved = assertNoUnresolvedRefs(config);
  if (unresolved.length > 0) {
    errors.push(`hysteria2Config contains unresolved refs: ${unresolved.join(", ")}`);
  }
  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }
}

export function createHysteria2ApplyPlan(input = {}) {
  const config = input.hysteria2Config ?? input.config;
  validateHysteria2Config(config);
  return Object.freeze({
    modelVersion: HYSTERIA2_RUNTIME_MODEL_VERSION,
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

export async function applyHysteria2Config(plan, input = {}) {
  const env = input.env ?? {};
  const configPath = plan.configPath ?? env.LUMEN_HYSTERIA2_CONFIG_FILE ?? DEFAULT_HYSTERIA2_CONFIG_PATH;
  const reloadArgv =
    plan.reloadArgv ?? parseArgv(env.LUMEN_HYSTERIA2_RELOAD_ARGV, DEFAULT_HYSTERIA2_RELOAD_ARGV);
  const reloadCommand = [reloadArgv[0], reloadArgv.slice(1)];

  validateHysteria2Config(plan.config);

  if (input.dryRun !== false) {
    return Object.freeze({
      implementationStatus: "hysteria2-dry-run",
      configPath,
      reloadCommand: summarizeArgv(reloadArgv)
    });
  }

  mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 });
  writeFileSync(configPath, `${JSON.stringify(plan.config, null, 2)}\n`, { mode: 0o600 });
  await runExecFile(input.execFileImpl, reloadCommand[0], reloadCommand[1]);

  return Object.freeze({
    implementationStatus: "hysteria2-applied",
    configPath,
    reloadCommand: summarizeArgv(reloadArgv)
  });
}
