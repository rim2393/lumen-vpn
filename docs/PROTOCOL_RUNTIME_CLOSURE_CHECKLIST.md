# Protocol Runtime Closure Checklist

Use this checklist for every new or materially changed protocol family before
marking the tracker row `DONE`.

The rule is intentionally strict: a protocol can have limited client-app
feature parity, but it cannot be closed unless backend/node traffic accounting
is real and proven through production evidence.

## Required Implementation Surfaces

Every protocol closure must cover the real production path:

1. Backend adapter validation rejects impossible, unsafe or conflicting config.
2. Backend profile payload stores enough structured config to rebuild runtime.
3. Port/inbound conflicts are detected before applying to a node.
4. Node-agent `outbound.apply` creates or updates the real runtime process,
   interface, policy or config.
5. Node-agent `outbound.remove` stops and cleans the same runtime surface.
6. Public subscription renderers emit correct target output or return an
   explicit unsupported error.
7. Client compatibility fixtures cover the supported render targets.
8. Live smoke uses a real profile, real user/license/subscription, real node,
   real public subscription URL and real cleanup.

## Mandatory Traffic Accounting

Before a protocol can be `DONE`, node/backend GB accounting must be implemented
and verified.

Required evidence:

- node-agent reads real runtime counters, not generated or estimated numbers;
- shared metric fields include `rx_bytes` and `tx_bytes` deltas;
- protocol-specific cumulative diagnostics are preserved when useful, for
  example `wireguard_cumulative_rx_bytes` or `ikev2_cumulative_rx_bytes`;
- first observation establishes a baseline instead of double-counting old
  traffic;
- `node.traffic.reset` clears the protocol baseline together with shared node
  traffic state;
- live production smoke proves nonzero dataplane bytes when the protocol can
  generate client traffic during the test;
- cleanup leaves no temporary users, licenses, subscriptions, profiles, hosts,
  node policies, runtime processes, interfaces or `/tmp/lumen-*` files.

If a protocol cannot expose byte counters from the underlying runtime, the row
must stay `PARTIAL` and the UI/API must report a concrete unsupported reason.
Do not close the protocol with fake zeros, synthetic totals or hidden
best-effort accounting.

## Policy Honesty

Unsupported policy features must fail before queueing node commands.

Examples:

- if torrent blocking cannot be enforced for the protocol, backend apply must
  return an explicit unsupported error instead of pretending the policy is
  active;
- if a target client format cannot represent the protocol, the public renderer
  must return an explicit unsupported response instead of an empty successful
  config;
- if two protocols cannot safely share a port on one node, install/apply must
  reject the conflict or offer a safe port change before mutation.

## Official Release Evidence

Tracker evidence for protocol closure must include:

- commit id;
- product image tag and digest for every changed image;
- signed public manifest evidence;
- official panel/node upgrade evidence;
- focused local test commands and results;
- live VPS apply/connect/render/accounting smoke result;
- concrete `rx_bytes`/`tx_bytes` or explicit unsupported status;
- cleanup counts returning `0`;
- node host cleanliness evidence.

Local tests alone are not completion evidence.
