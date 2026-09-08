# Architecture

## State and authority

A source has one publisher, an ordered revision history and an approved-owner list. Each workflow belongs to one owner and names an executor. Workflow registration fixes the baseline evidence revision and each job's tool, target, parameters and condition.

Publishing a correction increments the source revision. An old unused permit then fails the contract's revision check even if a browser or agent still displays an older snapshot. No notification delivery is needed for this check.

Anyone can request review of a new revision. GenLayer evaluates each workflow against its own baseline. A workflow cannot repeatedly ask for another verdict on the same revision. The review prompt treats evidence as untrusted data, and returned excerpt identifiers must resolve to exact registered source text. A bounded formatting retry can repair malformed output; it does not retry an unfavorable verdict.

The workflow owner can authorize a supported job. The registered executor must present the current revision and exact intent. The contract checks the review, active permit, executor and replay state before consuming the permit and storing the artifact in the same state transition.

## Boundaries

| Boundary | Guarantee | Limit |
| --- | --- | --- |
| Evidence | Exact text, publisher and revision are recorded | Publisher identity does not establish real-world truth |
| Review | Per-job decisions are stored through GenLayer execution | Consensus and network availability are external dependencies |
| Permit | Source revision, intent and executor are bound | Unintegrated external tools are outside the contract's control |
| Output | Permit consumption and draft/report creation are atomic | No purchase, payment or delivery takes place |
| History | Existing outputs remain inspectable | A correction does not undo earlier effects |
| Audit archive | Signed snapshot and exact-byte retrieval checks | A snapshot is not a chain proof; settlement is not independently verified |

## Frontend and recovery

The static frontend communicates directly with GenLayer RPC and a compatible injected browser wallet. Live reads use `LATEST_FINAL`. Submitted transaction hashes are saved for recovery; resuming polls the same transaction rather than resubmitting a write. An unavailable refresh does not turn a transaction into a falsely confirmed current snapshot.

Pending actions use persistent viewport-level progress, a moving border glow and action-specific labels. Success appears after finalized execution and the required state refresh. Reduced-motion preferences disable decorative motion. Full evidence and audit details expand on request to keep the working view compact.

The current Studionet client uses `genlayer-js@1.1.8` under the `genlayer-studionet` alias. The 2.0 release candidate is retained for the historical v1 workspace. Mixing these clients would incorrectly send newer fee-policy RPC requests to Studionet.

## Public archives

An archive is prepared from the displayed audit snapshot. Publication requires a current quote, explicit public-publication consent and wallet signatures. Existing Turbo credits are used; the application does not automatically fund the account. An unknown upload response retains the record identifier for retrieval-only recovery. A gateway response must match both the expected byte length and SHA-256 before being labeled verified.
