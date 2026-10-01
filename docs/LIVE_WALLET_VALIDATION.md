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

## Outstanding before release

- No mobile wallet has paired with this build yet. No owner transaction, review, permit, output or Turbo signature has been exercised through the mobile provider.
- The SDK panel displayed untranslated keys for some controls in a Turkish browser locale. Resolve or verify that UI before calling mobile onboarding complete.
- Run the full Live lifecycle with wallet approvals and verify account switching, cancellation and reconnect behavior. QR availability alone is not an end-to-end pass.

This is a development checkpoint, not a completed wallet acceptance report. No production deployment or release ZIP was created for these changes.
