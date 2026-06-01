import test from "node:test";
import assert from "node:assert/strict";
import {
  COMMAND_TYPES,
  NODE_PROVISIONING_MODES,
  PROVISIONING_EVENTS,
  PROVISIONING_PHASES,
  commandAllowanceForState,
  createCommandAck,
  createCommandEnvelope,
  createCommandResult,
  createProvisioningState,
  transitionProvisioningState,
  validateCommandEnvelope
} from "../src/index.js";

test("pause command envelope ACK moves active node into paused mode", () => {
  const state = createProvisioningState({
    nodeId: "ams-1",
    updatedAt: "2026-05-27T00:00:00.000Z"
  });
  const envelope = createCommandEnvelope({
    id: "cmd-pause-1",
    nodeId: "ams-1",
    command: COMMAND_TYPES.NODE_PAUSE,
    idempotencyKey: "cmd-pause-1:ams-1",
    issuedAt: "2026-05-27T00:01:00.000Z",
    payload: { reason: "operator-maintenance" }
  });
  const ack = createCommandAck(envelope, {
    receivedAt: "2026-05-27T00:01:01.000Z",
    currentMode: state.mode
  });
  const paused = transitionProvisioningState(state, PROVISIONING_EVENTS.PAUSE_REQUESTED, {
    at: "2026-05-27T00:01:02.000Z"
  });

  assert.equal(validateCommandEnvelope(envelope).ok, true);
  assert.equal(ack.status, "accepted");
  assert.equal(paused.mode, NODE_PROVISIONING_MODES.PAUSED);
  assert.equal(paused.phase, PROVISIONING_PHASES.IDLE);
});

test("paused nodes defer mutating envelopes until resume", () => {
  const paused = createProvisioningState({
    nodeId: "ams-1",
    mode: NODE_PROVISIONING_MODES.PAUSED,
    pausedAt: "2026-05-27T00:01:02.000Z",
    updatedAt: "2026-05-27T00:01:02.000Z"
  });
  const applyEnvelope = createCommandEnvelope({
    id: "cmd-apply-1",
    nodeId: "ams-1",
    command: COMMAND_TYPES.OUTBOUND_APPLY,
    idempotencyKey: "cmd-apply-1:ams-1",
    issuedAt: "2026-05-27T00:02:00.000Z",
    payload: { outboundId: "ams-vless", credentialsRef: "vault://nodes/ams-1/vless" }
  });
  const allowance = commandAllowanceForState(applyEnvelope, paused);
  const ack = createCommandAck(applyEnvelope, {
    status: allowance.allowed ? "accepted" : "deferred",
    reason: allowance.reason,
    currentMode: paused.mode
  });
  const resumeEnvelope = createCommandEnvelope({
    id: "cmd-resume-1",
    nodeId: "ams-1",
    command: COMMAND_TYPES.NODE_RESUME,
    idempotencyKey: "cmd-resume-1:ams-1",
    issuedAt: "2026-05-27T00:03:00.000Z",
    payload: {}
  });
  const resumed = transitionProvisioningState(paused, PROVISIONING_EVENTS.RESUME_REQUESTED, {
    at: "2026-05-27T00:03:01.000Z"
  });

  assert.equal(allowance.allowed, false);
  assert.equal(ack.status, "deferred");
  assert.match(ack.reason, /paused/);
  assert.equal(commandAllowanceForState(resumeEnvelope, paused).allowed, true);
  assert.equal(resumed.mode, NODE_PROVISIONING_MODES.ACTIVE);
});

test("quarantine envelope blocks mutation and requires explicit clear on resume", () => {
  const state = createProvisioningState({
    nodeId: "ams-1",
    updatedAt: "2026-05-27T00:00:00.000Z"
  });
  const quarantineEnvelope = createCommandEnvelope({
    id: "cmd-quarantine-1",
    nodeId: "ams-1",
    command: COMMAND_TYPES.NODE_QUARANTINE,
    idempotencyKey: "cmd-quarantine-1:ams-1",
    issuedAt: "2026-05-27T00:04:00.000Z",
    payload: { reason: "conflict-scan-blocking" }
  });
  const quarantined = transitionProvisioningState(state, PROVISIONING_EVENTS.QUARANTINE_REQUESTED, {
    at: "2026-05-27T00:04:01.000Z",
    commandId: quarantineEnvelope.id,
    reason: quarantineEnvelope.payload.reason
  });
  const mutatingEnvelope = createCommandEnvelope({
    id: "cmd-firewall-1",
    nodeId: "ams-1",
    command: COMMAND_TYPES.FIREWALL_PLAN_APPLY,
    idempotencyKey: "cmd-firewall-1:ams-1",
    issuedAt: "2026-05-27T00:05:00.000Z",
    payload: { firewallPlanId: "fw-ams-1" }
  });

  assert.equal(quarantined.mode, NODE_PROVISIONING_MODES.QUARANTINED);
  assert.equal(commandAllowanceForState(mutatingEnvelope, quarantined).allowed, false);
  assert.throws(
    () => transitionProvisioningState(quarantined, PROVISIONING_EVENTS.RESUME_REQUESTED),
    /clearQuarantine=true/
  );

  const resumeEnvelope = createCommandEnvelope({
    id: "cmd-resume-2",
    nodeId: "ams-1",
    command: COMMAND_TYPES.NODE_RESUME,
    idempotencyKey: "cmd-resume-2:ams-1",
    issuedAt: "2026-05-27T00:06:00.000Z",
    payload: { clearQuarantine: true }
  });
  const resumed = transitionProvisioningState(quarantined, PROVISIONING_EVENTS.RESUME_REQUESTED, {
    at: "2026-05-27T00:06:01.000Z",
    clearQuarantine: resumeEnvelope.payload.clearQuarantine
  });
  const result = createCommandResult(resumeEnvelope, {
    status: "succeeded",
    finishedAt: "2026-05-27T00:06:02.000Z",
    outputs: { mode: resumed.mode }
  });

  assert.equal(commandAllowanceForState(resumeEnvelope, quarantined).allowed, true);
  assert.equal(resumed.mode, NODE_PROVISIONING_MODES.ACTIVE);
  assert.equal(resumed.quarantine, null);
  assert.equal(result.status, "succeeded");
});

test("quarantine command requires a reason and rejects inline secret payloads", () => {
  assert.throws(
    () => createCommandEnvelope({
      id: "cmd-quarantine-bad",
      nodeId: "ams-1",
      command: COMMAND_TYPES.NODE_QUARANTINE,
      idempotencyKey: "cmd-quarantine-bad:ams-1",
      issuedAt: "2026-05-27T00:04:00.000Z",
      payload: {}
    }),
    /payload.reason/
  );

  assert.throws(
    () => createCommandEnvelope({
      id: "cmd-pause-bad",
      nodeId: "ams-1",
      command: COMMAND_TYPES.NODE_PAUSE,
      idempotencyKey: "cmd-pause-bad:ams-1",
      issuedAt: "2026-05-27T00:04:00.000Z",
      payload: { token: "do-not-store" }
    }),
    /Inline secret-like fields/
  );
});

test("outbound apply permits resolved runtime credentials but still rejects stray secrets", () => {
  const envelope = createCommandEnvelope({
    id: "cmd-xray-ss-1",
    nodeId: "ams-1",
    command: COMMAND_TYPES.OUTBOUND_APPLY,
    idempotencyKey: "cmd-xray-ss-1:ams-1",
    issuedAt: "2026-05-27T00:04:00.000Z",
    payload: {
      adapter: "shadowsocks-native",
      xrayConfig: {
        inbounds: [
          {
            port: 18446,
            protocol: "shadowsocks",
            settings: {
              method: "aes-256-gcm",
              password: "resolved-runtime-password"
            }
          }
        ]
      }
    }
  });

  assert.equal(validateCommandEnvelope(envelope).ok, true);

  const openvpnEnvelope = createCommandEnvelope({
    id: "cmd-openvpn-1",
    nodeId: "ams-1",
    command: COMMAND_TYPES.OUTBOUND_APPLY,
    idempotencyKey: "cmd-openvpn-1:ams-1",
    issuedAt: "2026-05-27T00:04:00.000Z",
    payload: {
      adapter: "openvpn-udp",
      openvpnConfig: {
        listen_port: 1194,
        proto: "udp",
        network: "10.88.0.0/24",
        pki: {
          ca_cert: "-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----",
          server_cert: "-----BEGIN CERTIFICATE-----\nserver\n-----END CERTIFICATE-----",
          server_key: "-----BEGIN PRIVATE KEY-----\nserver\n-----END PRIVATE KEY-----"
        },
        users: [{ username: "lumen_sub_live", password: "resolved-runtime-password" }]
      }
    }
  });

  assert.equal(validateCommandEnvelope(openvpnEnvelope).ok, true);

  assert.throws(
    () => createCommandEnvelope({
      id: "cmd-xray-token-bad",
      nodeId: "ams-1",
      command: COMMAND_TYPES.OUTBOUND_APPLY,
      idempotencyKey: "cmd-xray-token-bad:ams-1",
      issuedAt: "2026-05-27T00:04:00.000Z",
      payload: {
        xrayConfig: {
          inbounds: [
            {
              port: 18446,
              protocol: "shadowsocks",
              settings: { token: "not-a-runtime-credential" }
            }
          ]
        }
      }
    }),
    /Inline secret-like fields/
  );
});
