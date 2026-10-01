# Evidence Desk

Evidence Desk is a wallet-free reader for deployed ProofGuard v2 contracts. It helps a reviewer or an agent developer inspect a finalized record before connecting a signing account.

## Run this version

```sh
git clone --branch feature/evidence-desk https://github.com/Vevivo/proofguard-change.git
cd proofguard-change
npm ci
npm run dev
```

Requires Node.js 22.13+. Open the URL printed by Vite and select **Evidence Desk**. The application is static; no backend, API key or signing key is required for inspection.

## Five-minute check

1. Select **Source correction**. The reader contacts Studio Next (61997), checks the deployed code and reads the finalized source bundle. This is an actual network record of a controlled supplier scenario, not an independent customer deployment.
2. Inspect **EXPRESS**. Its condition changed after the source correction and it remains held. Inspect **STANDARD** to view and download the generated draft. Neither job places an external supplier order.
3. Open **Evidence & history** to compare the registered versions and inspect recorded permission/execution checks.
4. Open **Connect an agent**. Run **Inspect workflow** with the displayed current revision. Then enter an earlier revision and run again: it must return `STALE_SOURCE_REVISION`, without a usable result.
5. Choose **Retrieve output** for the held job: it must return `OUTPUT_NOT_CREATED`. Choose the executed job to retrieve its bound output.

The **Policy distinction** reference reads Studionet (61999). It distinguishes a registered no-training condition from an unsupported zero-retention condition. Its source text is a historical test input, not a statement about GitHub's current policy.

## Bring your own record

Choose the network and enter the deployed ProofGuard v2 contract address and Source ID. The reader pins the exact contract source SHA-256, so another contract with a similar interface will be rejected. Source IDs are 2–80 letters, digits, dots, underscores or hyphens. A source must have been published before it can be inspected.

The current web signing workspace supports Studionet. Evidence Desk supports both Studionet and Studio Next. Opening a record does not submit a transaction. Demo needs no wallet and starts only when the visitor selects **Start demo**.

## Follow the next step

The **Operations** view groups jobs into **Needs attention**, **Ready to run** and **Current outputs**. Search by workflow or job name. Each selected job identifies the next step and responsible role. On Studionet, **Open Live controls** continues in the signing workspace. **Copy agent action** copies exact revision and intent/output bindings for an explicitly configured MCP capability; it never submits a transaction. Historical artifacts remain inspectable but are not listed as current outputs.

## Connect an MCP client

After cloning and installing the branch above, enter its absolute local path under **Connect an agent**. Copy the generated `mcpServers` configuration into a compatible local MCP client. The server provides:

| Tool | Result |
| --- | --- |
| `proofguard_list_workflows` | Current source revision and workflow/job states |
| `proofguard_inspect_workflow` | Conditions, exact intents, reasons and permission/output status |
| `proofguard_get_output` | An existing artifact after checking its digest and bindings |
| `proofguard_get_source` | Current evidence, approved owners and source history |
| `proofguard_prepare_workflow` | An unsigned Studionet workflow request for the owner's review |
| `proofguard_get_request_status` | A request's current registration, permission and output states |

Use `expectedRevision` when a consumer depends on an earlier observation. The browser's read check calls the shared inspector directly over RPC; it does not create an MCP session or run an AI agent. See [Agent connector](AGENT_CONNECTOR.md) for protocol setup and the read-only integration test.

## What inspection establishes

Browser and MCP reads share `genlayer/inspector-core.mjs`. Every call checks the chain ID, exact deployed code, policy, finalized bundle, source history, registered intent hashes, applicable permit bindings and existing output contents. Reads time out and fail closed. Failed reads do not substitute demo fixtures or cached approvals. A downloaded snapshot records its observation time.

These checks trust the configured RPC. They are not light-client proofs, independent verification of the publisher's real-world claims or permission to act outside the contract. An output may belong to an earlier revision and is labeled as historical. A favorable review still requires the owner's current permit; contract execution must recheck it. External tools need their own enforcement and idempotency controls.

Test networks may reset or become unavailable. Example records are conveniences, not availability guarantees. If a record cannot be read, use the displayed error or inspect another deployed record.

## Deployment

Run `npm run typecheck`, `npm test`, and `npm run build`. Upload the contents of `arns-dist/` to the static host. Preserve the directory layout: `index.html`, `assets/`, icons and other public files. `config/public-site.ts` supplies the canonical host used for copied record links. Keep older content-addressed deployments available if existing sessions still use their assets.

This deploys the website only. The local MCP connector, optional delegated manager and [report vault](REPORT_VAULT.md) run as separate Node.js processes. A static upload does not start or host them.
