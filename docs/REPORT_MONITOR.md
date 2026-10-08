# Continuous report monitoring

An accepted report can become historical while no agent is downloading it. The report monitor checks stored receipts in the background and keeps a durable transition history that an agent can read. It extends the existing vault; independent import/download verification and deduplication were already present before this milestone.

## States

| State | Meaning |
| --- | --- |
| `CURRENT` | The vault verified the exact stored artifact against its configured finalized source. The observation is usable only until `validUntil`; it is not a permission to execute another action. |
| `INVALIDATED` | A verified source revision mismatch made this old artifact historical. This state is permanent for that receipt. A later network failure or older RPC response cannot revive it. |
| `UNVERIFIABLE` | A current result cannot be established: network timeout, code/integrity mismatch, unavailable storage, missing first check or expired observation. The bounded `reason` distinguishes these causes. It does not imply the source changed. |

Every receipt/content download still performs a fresh independent verification and refuses a known invalidated report. Status reads are observations with an expiry, not a replacement for download checks. Copies already downloaded cannot be recalled.

## Run

Use the [existing vault configuration](REPORT_VAULT.md). Two optional environment variables control the monitor:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PROOFGUARD_REPORT_MONITOR_INTERVAL_MS` | `60000` | Background scan cadence in milliseconds. A scan runs on startup; scans do not overlap. |
| `PROOFGUARD_REPORT_FRESHNESS_MS` | `120000` | Maximum age of a successful observation. Status/event reads apply expiry even after a restart or when scans stop. |

The scanner reads previously stored reports too. Reports are checked sequentially, so a large backlog or slow RPC can exceed the nominal cadence; overdue observations become `UNVERIFIABLE`. Configure the interval/window for the size of the selected workspace. A scan is not a blockchain subscription and has no instantaneous detection guarantee.

Run one vault process per report directory. Keep its storage private and persistent. Original report receipts remain immutable; `.monitor/<deliveryId>.json` contains the latest observation and its complete event history in one atomic replacement. Updates for one report are serialized. State and events therefore advance together on a process restart; corrupted monitor files are rejected instead of being silently reset. This is an operator-controlled local audit record, not a signed or independently verifiable ledger. Back up the directory and monitor available storage; history is not silently truncated and there is no automatic retention policy.

Health remains process liveness only: `/health` does not attest that reports are current. The static ArNS frontend cannot run this service.

## HTTP and MCP

All new HTTP routes require the existing service bearer token and reject browser-origin requests. IDs must be 64 lowercase hexadecimal characters. The operator controls endpoint, token and workflow allowlist.

| HTTP route | MCP tool enabled with `--enable-delivery` |
| --- | --- |
| `GET /v1/reports/{id}/status` | `proofguard_get_report_status` |
| `POST /v1/reports/{id}/recheck` (empty body) | `proofguard_recheck_report` |
| `GET /v1/reports/{id}/events?after=0&limit=50` | `proofguard_get_report_events` |

Status/recheck inputs are `{ "deliveryId": "<receipt ID>" }`. Event inputs add optional `after` (nonnegative integer, default 0) and `limit` (1–100, default 50). Responses contain monotonically increasing per-report event sequences, `nextCursor` and `hasMore`. Continue with `after: nextCursor`; when no later events exist the cursor remains unchanged.

Only a state or reason change adds an event. Repeated successful checks refresh observation times without creating repeated `CURRENT` events. Event timestamps and successful states are historical facts; always read current status before interpreting them. The recheck tool changes local audit state but submits no blockchain transaction. Default MCP mode still exposes only the original six read/request tools; delivery-enabled mode exposes ten.

## Reproduce

```sh
npm ci
npm run test:client
npm run verify:monitor
```

The last command starts a separate local HTTP vault and real stdio MCP process against the existing Studionet test output. It checks automatic refresh without a download, explicit recheck, event cursors, repeat deduplication, authenticated status and the exact downloaded digest. It uses no wallet key and submits no transaction. It fails if the public test record or RPC cannot be verified; it does not substitute archived data. It writes its dated result to ignored `outputs/report-monitor-live-probe.json`.

Source corrections, RPC failure/recovery, expiry, corruption, restart and concurrency are exercised with controlled fixtures. The live probe does not mutate the shared public source to reproduce those scenarios. Neither test type establishes an independent developer pilot, production deployment, real-world truth of the source, or an atomic lock between GenLayer and the filesystem.
