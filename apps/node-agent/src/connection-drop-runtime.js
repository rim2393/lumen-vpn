import { execFile as nodeExecFile } from "node:child_process";
import { isIP } from "node:net";
import { promisify } from "node:util";

export const CONNECTION_DROP_RUNTIME_MODEL_VERSION = "lumen.node-agent.connection-drop-runtime.v1";

const execFileAsync = promisify(nodeExecFile);

function requireIp(value) {
  if (typeof value !== "string" || isIP(value.trim()) === 0) {
    throw new Error("connection drop requires a valid client IP address");
  }
  return value.trim();
}

function maybeString(value) {
  if (typeof value !== "string") {
    return null;
  }
  const text = value.trim();
  return text.length > 0 ? text : null;
}

function commandSummary(command, args) {
  return [command, ...args].join(" ");
}

function summarizeExecResult(result) {
  return {
    stdout: typeof result?.stdout === "string" ? result.stdout.slice(0, 240) : "",
    stderr: typeof result?.stderr === "string" ? result.stderr.slice(0, 240) : ""
  };
}

async function runExecFile(execFileImpl, command, args) {
  if (execFileImpl) {
    return await execFileImpl(command, args);
  }
  return await execFileAsync(command, args);
}

function commandAttempts(ip) {
  return Object.freeze([
    Object.freeze({ command: "conntrack", args: Object.freeze(["-D", "-s", ip]) }),
    Object.freeze({ command: "conntrack", args: Object.freeze(["-D", "-d", ip]) }),
    Object.freeze({ command: "ss", args: Object.freeze(["-K", "dst", ip]) }),
    Object.freeze({ command: "ss", args: Object.freeze(["-K", "src", ip]) })
  ]);
}

export function createConnectionDropPlan(payload = {}) {
  const ip = requireIp(payload.ip);
  return Object.freeze({
    modelVersion: CONNECTION_DROP_RUNTIME_MODEL_VERSION,
    ip,
    nodeId: maybeString(payload.node_id ?? payload.nodeId),
    userId: maybeString(payload.user_id ?? payload.userId),
    subscriptionId: maybeString(payload.subscription_id ?? payload.subscriptionId),
    reason: maybeString(payload.reason),
    commands: commandAttempts(ip).map((attempt) => commandSummary(attempt.command, attempt.args))
  });
}

export async function dropConnections(plan, input = {}) {
  const ip = requireIp(plan?.ip);
  const attempts = commandAttempts(ip);
  if (input.dryRun !== false) {
    return Object.freeze({
      implementationStatus: "connection-drop-dry-run",
      dryRun: true,
      ip,
      commands: attempts.map((attempt) => commandSummary(attempt.command, attempt.args))
    });
  }

  const results = [];
  let executed = false;
  for (const attempt of attempts) {
    try {
      const result = await runExecFile(input.execFileImpl, attempt.command, [...attempt.args]);
      executed = true;
      results.push({
        command: commandSummary(attempt.command, attempt.args),
        status: "executed",
        ...summarizeExecResult(result)
      });
    } catch (error) {
      const code = error?.code ?? error?.errno ?? "failed";
      results.push({
        command: commandSummary(attempt.command, attempt.args),
        status: code === "ENOENT" ? "tool_missing" : "failed",
        code: String(code),
        message: String(error?.message ?? "connection drop command failed").slice(0, 240)
      });
    }
  }

  if (!executed) {
    throw new Error("connection drop is unsupported on this node: conntrack/ss are unavailable or failed");
  }

  return Object.freeze({
    implementationStatus: "connection-drop-attempted",
    dryRun: false,
    ip,
    attempts: results
  });
}
