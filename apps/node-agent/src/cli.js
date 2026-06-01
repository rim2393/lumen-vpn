#!/usr/bin/env node

import {
  exchangeInstallToken,
  redactInstallTokenExchangeResponse,
  redactNodeResponse,
  sendHeartbeat
} from "./control-plane-client.js";
import { assertLiveRuntimeMode, buildNodeAgentDryRun, loadNodeAgentConfigFromEnv } from "./runtime-loop.js";
import { runNodeAgentLoop } from "./runtime-runner.js";
import { readSecretFromEnv } from "./secret-input.js";

function printHelp() {
  console.log([
    "Usage: lumen-node-agent --run | --run-once | --dry-run | --exchange-install-token | --heartbeat-once",
    "",
    "Commands:",
    "  --run                    Enroll if needed, then send heartbeat forever.",
    "  --run-once               Enroll if needed, then send one heartbeat.",
    "  --dry-run                 Print config and heartbeat payload without network calls.",
    "  --exchange-install-token  Exchange LUMEN_INSTALL_TOKEN for node enrollment.",
    "  --heartbeat-once          Send one heartbeat using LUMEN_NODE_TOKEN."
  ].join("\n"));
}

async function main(argv, env) {
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return 0;
  }

  if (argv.includes("--run") || argv.includes("--run-once")) {
    assertLiveRuntimeMode(loadNodeAgentConfigFromEnv(env), argv);
    const result = await runNodeAgentLoop({
      env,
      once: argv.includes("--run-once")
    });
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }

  if (argv.includes("--exchange-install-token")) {
    const config = loadNodeAgentConfigFromEnv(env);
    const response = await exchangeInstallToken({
      controlPlaneBaseUrl: config.controlPlaneBaseUrl,
      installToken: readSecretFromEnv(env, "LUMEN_INSTALL_TOKEN")
    });
    console.log(JSON.stringify(redactInstallTokenExchangeResponse(response), null, 2));
    return 0;
  }

  if (argv.includes("--heartbeat-once")) {
    const config = loadNodeAgentConfigFromEnv(env);
    const response = await sendHeartbeat({
      config,
      nodeToken: readSecretFromEnv(env, "LUMEN_NODE_TOKEN"),
      heartbeatPath: env.LUMEN_HEARTBEAT_PATH
    });
    console.log(JSON.stringify(redactNodeResponse(response), null, 2));
    return 0;
  }

  if (argv.length > 0 && !argv.includes("--dry-run")) {
    throw new Error(`Unsupported command: ${argv.join(" ")}`);
  }

  const report = buildNodeAgentDryRun({ env });
  console.log(JSON.stringify(report, null, 2));
  return 0;
}

try {
  process.exitCode = await main(process.argv.slice(2), process.env);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
