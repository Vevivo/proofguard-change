# Live wallet validation checkpoint

Date: 1 October 2026

## Changes under validation

- Preserve an installed EIP-1193 browser wallet. If none is available, initialize MetaMask Connect EVM 2.1.1 only after a Live connection click.
- Pass the selected provider to GenLayer and Turbo signing. Do not assign a mobile provider to `window.ethereum`.
- Switch or add only the configured Studionet chain through the selected provider. Recheck chain ID and account after approval. User rejection does not trigger an add-network fallback.
- Observe account, network and disconnect events on the selected provider. Offer disconnect in the Live setup screen.
- Disable SDK analytics. Connection does not send a transaction or sign an archive.

## Verified

- TypeScript validation and production compilation passed.
- Existing suite: 91 JavaScript and 37 Python tests passed.
- Four additional network tests cover an already correct network, user rejection without retries, adding an unknown declared network, and rejecting a wallet that remains on the wrong network.
- The browser without an injected wallet reached MetaMask's mobile QR pairing panel.
- A mobile wallet paired successfully and the selected account and Studionet chain were confirmed in the Live workspace.
- An existing Studionet contract passed the code/policy check through the Live UI.
- Repeated `eth_requestAccounts` calls were removed for already granted accounts. Duplicate account/network events no longer clear an unchanged connected account, and successful connection clears the stale change warning.
- Five additional account/error tests passed, covering account reuse, initial permission, rejection, malformed account responses, and an unknown outcome after a relay failure.
- Explicit network recovery adds the configured Studionet network even when the mobile SDK reports a cached matching chain ID. Three additional tests cover this recovery, rejected network addition, and the targeted missing-network message (12 wallet/network tests total).

## Mobile submission findings

- Deployment reached `eth_sendTransaction`, then MetaMask Connect reported `RPCErr53: Failed to publish message after all retries`. No transaction hash was returned to the application.
- A separate, smaller `publish_source` request against the verified existing contract reached the wallet request stage, then reported `RPCErr53: Transport request timed out`. No transaction hash was returned. This does not establish that the request was rejected or that no transaction could have been submitted; check wallet activity before retrying.
- Neither request was automatically resent. Existing source/workflow records were not edited.
- Relay failures now show a short recovery instruction with the raw SDK error under Technical details. Connection and signing are tracked as separate validation outcomes.
- A later source request returned `Invalid chain ID "0xf22f"`. Explicit Add GenLayer network recovery completed through MetaMask and the Live UI confirmed the network addition. The configured chain ID is 61999 (`0xf22f`).
- After recovery, publishing controlled source `MOBILE-QA-20261001-1057` returned transaction `0x048f18ae90ee0cda13ece81b773f73869f64572a16079d74f55e17a35a4ce6a5`. The Live UI reached "Source published", read revision 1 back from finalized contract state and enabled progression to protected jobs.
- Workflow `MOBILE-QA-WF-20261001` with two price-report jobs finalized in transaction `0x6822a3c64971bb283577ce48f9b03ad76cf85a5dc9905970c96e8abf9e5d3357` and both jobs appeared in the Live dependency map.
- Review transaction `0x5c4c1dd846db12427542e2574c5fe931e9e5d76b74cca8cf5d1a6b0cded49f47` finalized. The weekday/price condition was READY; the weekend-support condition was blocked. No output or permit was granted to the blocked job.
- Authorization transaction `0x92a5e91a8de4f669efab3bc48a9318ecc5e4c1db82ebb96c8573943170750122` finalized for `weekday-price`. The UI changed to "Permitted", disabled repeated authorization and enabled Generate output for the registered executor.
- Execution transaction `0x06592dd755bbbd1a371e9139e6ed468bf9dd2bd100a932b686b2f6f5bb3a0dc7` finalized. The UI reported one output and one blocked job, and showed "Current revision resolved".
- The output download was present in the browser shared directory as `MOBILE-QA-WF-20261001-weekday-price.json` (629 bytes). Its calculated SHA-256, `dfb6061524e4b13e4bacb1a964956053bc18ecd04735c77e9d7035f718be6d2a`, matched the displayed contract output hash. The JSON contained the correct source, workflow, job, revision, permit, USD currency and 49 unit price. The browser automation download-event waiter timed out, but the actual downloaded file was independently read and verified.
- The blocked job showed the excerpt "This source does not promise weekend support" and offered neither authorization nor execution. First-review UI wording was made revision-neutral; a blocked initial condition is not described as a new source change.
- Audit downloads now read finalized state, announce readiness, and expose a native download link. Prepared links are cleared when the record changes and object URLs are released when replaced. The downloaded JSON audit was parsed and contained the expected source and workflow (`proofguard-change-network-audit/2.0`, 8,429 bytes).
- Reopening the completed contract/source recovered the finalized output and blocked decision. Reconnecting reused the existing mobile wallet session without QR pairing.

## Outstanding before release

- The mobile source-to-output lifecycle passed: pairing, explicit network recovery, source publication, workflow registration, review, permit, execution and output file integrity. A Turbo archive signature remains a separate unverified mobile integration.
- The SDK panel displayed untranslated keys for some controls in a Turkish browser locale. Resolve or verify that UI before calling mobile onboarding complete.
- The readable HTML report reached its ready state and exposed the named native download link, but no HTML file appeared in this cloud browser's shared download directory after activation. HTML download acceptance remains unverified; JSON output and audit downloads passed.
- Source correction fencing, a new deployment through the mobile provider, account switching, cancellation and reconnect after a full disconnection remain additional acceptance paths. The completed source-to-output run used a verified existing contract and controlled test evidence.

This records the validated source-to-output path and the remaining integration checks. TypeScript validation and the final production build passed. A static web ZIP was prepared; the production site has not been redeployed from this branch.
