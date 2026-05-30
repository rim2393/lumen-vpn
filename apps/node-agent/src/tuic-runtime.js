import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { promisify } from "node:util";
import { execFile as nodeExecFile } from "node:child_process";

export const TUIC_RUNTIME_MODEL_VERSION = "lumen.node-agent.tuic-runtime.v1";
export const DEFAULT_TUIC_CONFIG_PATH = "/etc/tuic/config.json";
export const DEFAULT_TUIC_RELOAD_ARGV = Object.freeze(["systemctl", "restart", "tuic-server"]);

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

export async function applyTuicConfig(plan, input = {}) {
  const env = input.env ?? {};
  const configPath = plan.configPath ?? env.LUMEN_TUIC_CONFIG_FILE ?? DEFAULT_TUIC_CONFIG_PATH;
  const reloadArgv =
    plan.reloadArgv ?? parseArgv(env.LUMEN_TUIC_RELOAD_ARGV, DEFAULT_TUIC_RELOAD_ARGV);
  const reloadCommand = [reloadArgv[0], reloadArgv.slice(1)];

  validateTuicConfig(plan.config);

  if (input.dryRun !== false) {
    return Object.freeze({
      implementationStatus: "tuic-dry-run",
      configPath,
      reloadCommand: summarizeArgv(reloadArgv)
    });
  }

  mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 });
  writeFileSync(configPath, `${JSON.stringify(plan.config, null, 2)}\n`, { mode: 0o600 });
  await runExecFile(input.execFileImpl, reloadCommand[0], reloadCommand[1]);

  return Object.freeze({
    implementationStatus: "tuic-applied",
    configPath,
    reloadCommand: summarizeArgv(reloadArgv)
  });
}
