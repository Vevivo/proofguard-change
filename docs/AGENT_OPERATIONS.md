# Delegated workflow operations

ProofGuard can manage the existing v2 lifecycle over MCP: publish a source, prepare and register jobs, request GenLayer review, authorize a supported job, execute it and retrieve or deliver its artifact. Correcting a source starts a new review cycle and fences unused old permits.

Management is **disabled by default**. A local operator explicitly chooses which operations to delegate. The browser wallet route remains available for people who prefer to approve each transaction themselves. No contract migration is required.

## Roles and authority

| Role | Enabled capabilities | Authority required on chain |
| --- | --- | --- |
| Source publisher | `publish_source,revise_source,approve_owner` | Publisher for changes and owner approval |
| Workflow owner | `register_workflow,authorize_job` | Approved source owner; exact registered workflow owner for authorization |
| Reviewer | `review_source` | Review transaction sender; cannot choose the validator verdict |
| Executor | Separate `--enable-executor` | Exact registered executor and an existing owner permit |
| Report consumer | Separate `--enable-delivery` | Vault service token and server-side workflow allowlist |

An operator may run separate MCP instances for different roles. Do not give an autonomous executor the owner's manager key if the owner must approve each job personally. **Enabling `authorize_job` delegates real permission-granting authority to that local agent connection.** It is not a human confirmation mechanism. A request checksum or an MCP annotation is not approval.

For workflows requiring human approval, enable `register_workflow,review_source` for the appropriate local account and retain authorization in the Live website. Use a dedicated test-network account, keep keys in a local secret manager, and never paste them into chat, public configuration or the website. Run one writer process per account to avoid competing nonce management.

## Configuration

Install with `npm ci` and Node.js 22.13+. Inject these values into the local child process environment; `.env` is not loaded automatically:

| Variable | Value |
| --- | --- |
| `GENLAYER_MANAGER_KEY` | The delegated local account's signing key |
| `PROOFGUARD_MANAGER_CAPABILITIES` | Explicit comma-separated capabilities from the table; no `all` shortcut |
| `PROOFGUARD_MANAGER_STATE_DIR` | Absolute path to a private, durable recovery directory |

Then start the server with the same fixed workspace as the read connector:

```sh
node agents/mcp-server.mjs --network studionet --contract 0xYOUR_CONTRACT --source YOUR-SOURCE --enable-manager
```

MCP cannot choose a different source, contract, network, RPC, key or destination in tool arguments. Management and signed artifact execution currently support Studionet, chain 61999. Inspection and report delivery also support Studio Next, chain 61997.

## Operations

All management calls submit a transaction and may spend network fees unless the requested state is already confirmed. Every mutation uses a fixed contract method and zero transferred value.

| MCP tool | Input |
| --- | --- |
| `proofguard_publish_source` | `title`, `text`; source ID is pinned at startup |
| `proofguard_revise_source` | `expectedRevision`, corrected `text` |
| `proofguard_approve_owner` | `expectedRevision`, `owner` address |
| `proofguard_register_workflow` | Exact `envelope` from `proofguard_prepare_workflow` |
| `proofguard_review_source` | `expectedRevision`, `workflowIds` covering the current unreviewed set |
| `proofguard_authorize_job` | `expectedRevision`, `workflowId`, `jobId`, `expectedIntentHash` |

The read connector's six default tools are unchanged. Only explicitly enabled capabilities appear in discovery. `approve_owner` grants standing source registration rights; the contract does not bind that grant to one revision. Its expected revision is a preflight check. Review examines all pending workflows at contract execution time, which may include a workflow registered after preflight. It does not authorize any of them.

## Recovery

A private journal claims the exact operation before submission and records the transaction hash. Identical repeated calls recover that hash instead of issuing a second write. Revision updates can be recovered after the source advances. A finalized transaction is followed by a fresh state read: a finalized but denied authorization is not reported as success.

- `STATE_CONFIRMED`: the specific requested state was observed.
- `TRANSACTION_PENDING`: repeat the exact call to inspect the same transaction.
- `TRANSACTION_FAILED`: inspect the explorer and on-chain state before operator reconciliation.
- `SUBMISSION_OUTCOME_UNKNOWN`: submission may have happened without a usable hash. Do not delete the journal or change arguments to force a retry.

The journal is not chain authority. Keep it private, writable and durable, outside the public website. One manager instance rejects overlapping operations before they can compete for the account's nonce. Do not share the same account across multiple independently running managers. An operator reconciliation tool is not yet supplied.

## Validation boundary

The new management operations are covered by controlled-client tests over the official MCP transport: role restrictions, source revision checks, exact request binding, rejected conditions, transaction recovery and post-finalization readback. These are not a newly signed live management lifecycle. The earlier mobile-wallet lifecycle used the same v2 contract but a different client path; see [LIVE_WALLET_VALIDATION.md](LIVE_WALLET_VALIDATION.md).

Use [PILOT.md](PILOT.md) before describing independent adoption. The included [report vault](REPORT_VAULT.md) provides a concrete service boundary for artifact import and download; arbitrary external APIs remain outside that boundary.
