# ProofGuard Change

**Evidence changes. Permission adapts.**

ProofGuard Change connects agent workflows to shared, versioned evidence. When a publisher corrects a source, existing unused permissions stop working. GenLayer evaluates each job's condition separately; supported jobs can receive a new permission and generate a protected output.

[Open the application](https://proofguardchange.ar.io) · [Demo](https://proofguardchange.ar.io/?mode=demo) · [Live workspace](https://proofguardchange.ar.io/?mode=live) · [Recorded review transaction](https://explorer-studio.genlayer.com/tx/0xa511ea667f93b7b46e55e8473470e458e78318e7c85c2c321886920dc424461e)

**Reviewing this project?** Start with the [reviewer guide](docs/REVIEWER_GUIDE.md). It separates the browser demo, original Studionet example and live Studio Next correction regression. `npm run verify:correction` checks old-permit rejection, selective reauthorization and replay prevention without a wallet. [Watch the product walkthrough](https://www.youtube.com/watch?v=27-_cac4LQk).

## The problem

An agent can plan work using a valid source, then execute after that source changes. A blanket pause stops unaffected jobs too. An ordinary approval can remain usable even though the evidence that justified it is out of date.

ProofGuard gives each job an exact condition, tool, target and payload. A shared correction invalidates unused permissions immediately. Review determines which individual jobs remain supported, and execution checks the current evidence revision again inside the contract.

## How it works

1. **Publish evidence.** A wallet owns a source and its revision history.
2. **Register workflows.** Approved owners register jobs and an executor account. Each job has an immutable intent and a condition that must remain supported.
3. **Review dependencies.** GenLayer evaluates source support for each job. Evidence excerpts are resolved against the exact registered text.
4. **Authorize and execute.** The workflow owner grants a revision-bound permit. The registered executor consumes it while the contract generates the output.
5. **Correct and review again.** A new revision makes unused older permits unusable. Supported, unexecuted jobs can be authorized again; earlier outputs remain in history.

| Part | Responsibility |
| --- | --- |
| GenLayer intelligent contract | Source history, semantic review, roles, permits and atomic output creation |
| React application | Separate Live and Demo experiences, dependency map, wallet actions and persistent transaction feedback |
| Agent consumer and runner | Inspect finalized state and execute already authorized jobs using the registered executor |
| AR.IO / Turbo | Optional signed audit upload and gateway retrieval verification |

## Run locally

Requirements: Node.js **22.13+** and npm. Python **3.10+** is needed for the contract unit tests. The frontend does not require a backend, API key or private key.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. Choose **Demo** for the guided sample, or **Live** to connect a browser wallet to GenLayer Studionet. Live starts at setup and does not automatically submit a transaction.

```sh
npm run typecheck
npm test
npm run build
npm run preview
```

The production build is written to `arns-dist/`. Upload the **contents** of that directory to a static host or your Arweave publishing workflow. Assets use relative paths. `config/public-site.ts` contains the canonical application URL; change it for your own deployment. Publishing the frontend is separate from deploying an intelligent contract or publishing an audit snapshot.

## Live reference

The reference instance uses **GenLayer Studionet, chain 61999**:

| Field | Value |
| --- | --- |
| Contract | `0x91883d4829E5b5bD7BED6eBd0EceF927A71942d6` |
| Policy | `proofguard-change/2.0` |
| Source | `COPILOT-BUSINESS-01` |
| Workflow | `COPILOT-REVIEW-01` |
| Contract source SHA-256 | `beca7648cac048399221260c92f55bdc053301fe7eaa4611c3e6eecfc3c8e060` |

The recorded review distinguishes a **no-training** condition from a **zero-retention** condition. The registered evidence supports the former and does not establish the latter. This illustrates selective permission: a supported job can proceed while a job with insufficient evidence remains held. It is a test of the registered evidence, not independent verification of GitHub's current commercial policy.

Verify the reference using read-only RPC calls:

```sh
npm run verify:live
```

See [live evidence](docs/LIVE_EVIDENCE.md) for the inspection result and its limits. To create your own instance, use **Live → Need a new contract?** and inspect the contract source before signing deployment. The [walkthrough](docs/WALKTHROUGH.md) explains the remaining steps.

The additional correction regression runs on **Studio Next, chain 61997**, at [`0x8a93A27747D0a007cfD525D5456B1017ca5bF50e`](https://explorer-studio-dev.genlayer.com/address/0x8a93A27747D0a007cfD525D5456B1017ca5bF50e). It uses the exact same v2 contract and separate owner/executor accounts. The existing browser app remains on Studionet; use the [reviewer guide](docs/REVIEWER_GUIDE.md) and read-only verification command for the Next record.

## Protected outputs

- `prepare_purchase_order`: creates a purchase-order **draft** with the registered target, quantity, price and shipping parameters.
- `prepare_price_report`: creates a structured price report from the registered parameters and source evidence.

These tools create contract artifacts. They do not send supplier orders, transfer money or prove delivery. The atomic guarantee covers the current source, review, intent, permit consumption and artifact creation within the contract. External integrations need their own enforcement and idempotency controls.

**Download output** saves one generated job artifact. **Readable report** and **JSON package** export the broader audit snapshot, including evidence, decisions, permissions and outputs. **Inspect complete record** opens that history in the application.

## Independent executor

The runner defaults to read-only inspection:

```sh
npm run agent:change -- --contract 0x91883d4829E5b5bD7BED6eBd0EceF927A71942d6 --source COPILOT-BUSINESS-01
```

For an instance you operate, supply `GENLAYER_EXECUTOR_KEY` through your local environment and append `--execute`. The key must belong to the registered executor. Only READY jobs with active permits are selected. Outputs are written to ignored `outputs/` files. A private key must never be placed in frontend code, committed configuration or a browser form. `.env.example` documents the optional variables; the runner reads process environment variables, not `.env` automatically.

The reusable consumer is [public/proofguard-change-network-consumer.mjs](public/proofguard-change-network-consumer.mjs).

## Agent connector (experimental)

An MCP-compatible agent can inspect finalized workflow decisions and retrieve existing integrity-checked artifacts without operating the website. The [read-only connector](docs/AGENT_CONNECTOR.md) exposes workflow listing, per-job inspection and artifact retrieval. It pins the chain and contract source, detects stale expected revisions, and reports RPC failures as unknown rather than approval. No wallet or signing key is required.

```sh
npm run verify:agent
```

This command launches a standard MCP client/server pair and checks the existing Studio Next record. It submits no transactions. The connector does not enforce external API calls or turn a read result into execution permission. The [pilot criteria](docs/PILOT.md) describe the independent-use and enforcement milestones still needed.

## Audit archives — powered by AR.IO

The Audit trail places **Archive on Arweave** beside **Readable report** and **JSON package**. Its dialog prepares an exact snapshot and upload quote, asks for public-publication consent, then signs and uploads through Turbo using existing credits. The application can retrieve the record through the gateway and compare its bytes and SHA-256.

Turbo acceptance, successful gateway retrieval and independently verified Arweave settlement are different states. This implementation reports the first two and does not independently verify settlement. Downloaded JSON is a portable snapshot, not a cryptographic chain proof; the stated contract can be read again independently.

## Repository guide

| Path | Contents |
| --- | --- |
| `contracts/genlayer/change_network.py` | Current v2 intelligent contract |
| `components/` | Landing page, guided demo, Live workspace and audit interface |
| `genlayer/` | SDK clients, transaction tracking, integrity checks and archive handling |
| `agents/` | Command-line executor |
| `public/` | Consumer modules, application icons and licensed fonts |
| `tests/` | Contract state-machine, evidence, consumer, transaction and archive tests |
| `docs/` | Architecture, walkthrough, live evidence and dependency notices |

The earlier v1 workspace remains accessible at `?legacy=1`. Its code and deployment references are historical and are not the v2 submission. The archived v2 contract source is retained so existing older instances can be inspected read-only.

## Verification and limits

Python tests mock GenVM and reviewer responses; they exercise the contract state machine without claiming validator integration coverage. JavaScript tests exercise actual client helpers, including source races, replay protection, failed transaction outcomes, digest mismatch and archive recovery. Archive tests use intercepted requests and test-only signing accounts.

The contract has explicit prototype bounds: 4 workflows per source, 3 jobs per workflow, 8 approved owners, 16 revisions and 128 recorded authorized-role attempts per workflow. Publisher identity does not make submitted claims true. Unsupported or unresolved conditions cannot receive a current permit. Review outcomes depend on actual GenLayer execution; Demo fixtures are labeled sample data.

See [architecture](docs/ARCHITECTURE.md) for trust boundaries and [third-party notices](docs/THIRD_PARTY_NOTICES.md) for dependency licenses.

## License

Project source is available under the [MIT License](LICENSE). Fonts and dependencies retain their respective licenses.
