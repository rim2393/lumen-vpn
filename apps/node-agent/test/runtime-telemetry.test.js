import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  collectRuntimeTelemetryEvents,
  createRuntimeTelemetryPlan,
  reportRuntimeTelemetry
} from "../src/runtime-telemetry.js";

function torrentPolicy(logFile) {
  return {
    modelVersion: "lumen.node-policy.v1",
    plugins: [
      {
        id: "torrent-blocker",
        kind: "torrent-blocker",
        name: "Torrent blocker",
        enabled: true,
        config: {
          logFiles: [logFile],
          patterns: ["BitTorrent protocol"]
        }
      }
    ]
  };
}

test("createRuntimeTelemetryPlan enables log scan from node policy", () => {
  const plan = createRuntimeTelemetryPlan({
    policies: [torrentPolicy("/tmp/runtime.log")],
    stateFile: "/tmp/state.json"
  });

  assert.equal(plan.enabled, true);
  assert.deepEqual(plan.logFiles, ["/tmp/runtime.log"]);
  assert.equal(plan.patterns.includes("BitTorrent protocol"), true);
});

test("collectRuntimeTelemetryEvents scans new lines, redacts samples, and deduplicates", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lumen-runtime-telemetry-"));
  const logFile = join(dir, "xray.log");
  const stateFile = join(dir, "telemetry-state.json");
  await writeFile(logFile, [
    "ordinary startup line",
    "blocked outbound contained BitTorrent protocol from 203.0.113.10 token abcdefghijklmnopqrstuvwxyz123456",
    ""
  ].join("\n"));
  const plan = createRuntimeTelemetryPlan({
    policies: [torrentPolicy(logFile)],
    stateFile
  });

  const first = collectRuntimeTelemetryEvents(plan, { now: "2026-06-01T12:00:00Z" });
  assert.equal(first.events.length, 1);
  assert.equal(first.events[0].action, "torrent.blocked");
  assert.equal(first.events[0].resourceType, "torrent");
  assert.equal(first.events[0].metadataJson.sample.includes("203.0.113.10"), false);
  assert.equal(first.events[0].metadataJson.sample.includes("abcdefghijklmnopqrstuvwxyz123456"), false);

  const second = collectRuntimeTelemetryEvents(plan, { now: "2026-06-01T12:01:00Z" });
  assert.equal(second.events.length, 0);

  appendFileSync(logFile, "blocked btih:0123456789abcdef0123456789abcdef01234567\n");
  const third = collectRuntimeTelemetryEvents(plan, { now: "2026-06-01T12:02:00Z" });
  assert.equal(third.events.length, 1);
  assert.equal(third.events[0].resourceId, "btih:0123456789abcdef0123456789abcdef01234567");
  assert.doesNotThrow(() => JSON.parse(readFileSync(stateFile, "utf8")));
});

test("reportRuntimeTelemetry posts detected events through node event API client", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lumen-runtime-telemetry-report-"));
  const logFile = join(dir, "xray.log");
  const stateFile = join(dir, "telemetry-state.json");
  writeFileSync(logFile, "policy blocked BitTorrent protocol\n");
  const plan = createRuntimeTelemetryPlan({
    policies: [torrentPolicy(logFile)],
    stateFile
  });
  const calls = [];
  const response = await reportRuntimeTelemetry({
    plan,
    nodeId: "node-1",
    nodeToken: "node-token",
    controlPlaneBaseUrl: "https://panel.example",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 201,
        text: async () => JSON.stringify({ id: "event-1", action: "torrent.blocked" })
      };
    }
  });

  assert.equal(response.reportedEvents, 1);
  assert.equal(calls[0].url, "https://panel.example/api/v1/nodes/node-1/events");
  assert.equal(JSON.parse(calls[0].options.body).metadata_json.detector, "runtime-log");
  assert.equal(calls[0].options.headers["x-lumen-node-token"], "node-token");
});

test("runtime telemetry is disabled without a real torrent-blocker policy", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lumen-runtime-telemetry-disabled-"));
  const policyDir = join(dir, "policies");
  mkdirSync(policyDir);
  writeFileSync(join(policyDir, "policy.json"), JSON.stringify({ modelVersion: "lumen.node-policy.v1", plugins: [] }));
  const plan = createRuntimeTelemetryPlan({
    policyDir,
    stateFile: join(dir, "state.json")
  });

  assert.equal(plan.enabled, false);
  const collected = collectRuntimeTelemetryEvents(plan);
  assert.equal(collected.events.length, 0);
});
