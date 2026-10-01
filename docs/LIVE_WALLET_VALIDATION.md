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

## Outstanding before release

- Mobile pairing, explicit network recovery and the source publication owner transaction passed. Workflow registration, review, permit, output and Turbo signature remain to be checked through the mobile provider before treating the full lifecycle as accepted.
- The SDK panel displayed untranslated keys for some controls in a Turkish browser locale. Resolve or verify that UI before calling mobile onboarding complete.
- Run the full Live lifecycle with wallet approvals and verify account switching, cancellation and reconnect behavior. QR availability alone is not an end-to-end pass.

This is a development checkpoint, not a completed wallet acceptance report. No production deployment or release ZIP was created for these changes.
