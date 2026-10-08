# Protected report vault

The report vault is a separate HTTP process that stores and serves verified ProofGuard reports and purchase-order drafts. It gives a reporting application one controlled intake route: it accepts identifiers, reads GenLayer itself, and stores the exact executed artifact. The caller cannot upload substitute report bytes or claim that a job was approved.

This is useful when several agents consume the same changing evidence and reports must stop being offered as current after a correction. The operator must route that application's report intake through this service. It does not intercept unrelated file copies, arbitrary APIs, existing downloads, supplier orders or payments.

## What is enforced

For every import **and every download**, the service:

1. Checks its service token and the operator's workflow allowlist.
2. Independently reads finalized state from its fixed network, contract and source.
3. Checks the reviewed contract code, evidence history, intent, output digest, owner permit and registered executor through the common inspector.
4. Requires an executed artifact at the exact current source revision and requested output digest.
5. Stores the chain-provided bytes with an atomic create-if-absent record. Identical retries return the same receipt.

A source correction blocks imports and downloads of the previous revision, including an earlier stored report. The stored record remains for local audit. Copies already downloaded cannot be recalled. Existing contract jobs each produce one artifact; to produce a fresh report after a source correction, register a new workflow against the current revision.

## Run locally

The vault now also scans stored reports and exposes expiring validity observations and durable event history. See [Continuous report monitoring](REPORT_MONITOR.md) for the new feature, three MCP tools and its reproducible validation.

Use Node.js 22.13+ and `npm ci`. The service requires no signing key.

Supply these environment variables through the operator's environment or secret manager:

| Variable | Purpose |
| --- | --- |
| `PROOFGUARD_REPORT_TOKEN` | Random URL-safe token, 32–128 characters; never in model input or a public URL |
| `PROOFGUARD_REPORT_DIR` | Private persistent storage directory outside public assets |
| `PROOFGUARD_REPORT_WORKFLOWS` | Comma-separated workflow IDs allowed to import reports |
| `PROOFGUARD_REPORT_PORT` | Optional loopback port, default 8788 |

Generate a token locally with `node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))"` and store it locally. Do not commit it or send it in chat.

```sh
node services/report-vault.mjs --network studionet --contract 0xYOUR_CONTRACT --source YOUR-SOURCE
```

The service binds to `127.0.0.1`. For a pilot on another host, an operator must provide HTTPS termination, access controls, persistent storage and process supervision. Do not publish the storage directory or expose the loopback service through an unprotected tunnel. No hosted vault is supplied by the static ArNS website.

## Connect an agent

For an isolated Docker installation with persistent storage and an operator-managed stdio connection, see [Private server runtime](SERVER_RUNTIME.md). It keeps both the vault and its token off public ports and retains human wallet signing in Live.

Give the separate MCP child process `PROOFGUARD_REPORT_ENDPOINT` (the service origin) and the same `PROOFGUARD_REPORT_TOKEN`, then add `--enable-delivery` to the normal MCP command. Plain HTTP is permitted only for numeric loopback; remote service origins must use HTTPS. Redirects are refused. The endpoint and token are never tool arguments.

`proofguard_deliver_report` accepts:

```json
{
  "workflowId": "YOUR-WORKFLOW",
  "jobId": "YOUR-JOB",
  "expectedRevision": 1,
  "expectedOutputSha256": "64_LOWERCASE_HEX_CHARACTERS_FROM_PROOFGUARD_GET_OUTPUT"
}
```

Evidence Desk's **Copy agent action** gives the exact call for a current output. Copying does not run it. `REPORT_STORED` returns a stable delivery ID. `DELIVERY_UNCONFIRMED` means the response was unavailable; retry identical input. Never infer delivery from a timeout.

## HTTP interface

All `/v1/` routes require `Authorization: Bearer <token>`. Browser-origin requests are rejected and no CORS access is granted.

| Route | Behavior |
| --- | --- |
| `GET /health` | Process liveness only, explicitly not chain verification |
| `POST /v1/reports` | Strict JSON with the four fields above; 201 on import, 200 on identical retry |
| `GET /v1/reports/{deliveryId}` | Receipt, only after a fresh current-source check |
| `GET /v1/reports/{deliveryId}/content` | Exact verified JSON bytes, only after a fresh current-source check |

Failures return a bounded error code, without RPC internals or credentials. Requests are size-limited and concurrency is bounded. The storage path and network destinations cannot be chosen by callers.

## Consistency boundary

Admission is based on the finalized snapshot read immediately before persistence. GenLayer and an HTTP filesystem cannot be locked atomically: a correction can finalize after that read. Subsequent service downloads recheck state and refuse stale reports, but no stronger cross-system atomicity is claimed. The selected RPC remains a trust assumption, not a light-client proof.

The on-chain permit authorizes artifact creation. The **vault operator's explicit workflow allowlist** permits storing and serving those artifacts in this service. It does not reinterpret the on-chain permit as permission to email, buy, pay or mutate another system. The agent must not have direct write access to the vault's storage if this is to be an enforcement boundary.

## Reproduce validation

```sh
npm run test:client
npm run verify:delivery
```

The live probe launches a separate HTTP server and an actual stdio MCP server, reads the existing Studionet mobile-validation output, imports it, retries it, downloads and hashes it, and checks rejection of unauthenticated and held-job requests. It creates no new chain transaction. Temporary test storage is removed after the run; the public probe result is written to ignored `outputs/`.

The [recorded 1 October 2026 result](../deployments/report-vault-validation-20261001.json) confirms one stored artifact, identical bytes on download, deduplication, rejection without a token and rejection of the held job. This used a local service and existing finalized chain data; it is not a hosted vault deployment.

Source-change rejection, code mismatch, chain failure, storage tampering and restart recovery are also exercised with controlled RPC fixtures over real HTTP. This is developer validation of a service implementation, not a public production deployment or independent-user adoption.
