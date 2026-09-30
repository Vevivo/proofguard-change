# Evidence Desk validation

Observed on 30 September 2026. Tests establish the behavior below at that time; they do not guarantee test-network availability or independent adoption.

## Automated checks

- TypeScript typecheck and production build passed.
- 91 JavaScript tests and 37 Python contract tests passed.
- New regression coverage checks browser/Node inspector agreement, UTF-8 hashes, altered output contents, malformed history and failure after a previously successful read.
- The real MCP stdio probe passed at `2026-09-30T12:54:03.172Z`: three tools discovered, current jobs read, output digest/bindings checked, held output rejected and old revision rejected. It submitted zero transactions.
- The Studio Next output SHA-256 was `9796fd13049b0b392b07813275dcb55d8b62354a62a27407658b68332aafc5e7`.

## Browser checks

The development preview was exercised through the actual interface, using real RPC responses:

- Homepage opens Evidence Desk and its reference record.
- Studio Next correction record reads v2 with one generated output and one condition-changed job.
- Studionet policy record reads v1 with one generated output and one evidence-needed job.
- The browser read check returns a fresh workflow observation, rejects expected v1 against current v2, and refuses output retrieval for the held job.
- Output JSON copying was checked against the clipboard. Record sharing copied the canonical host, selected network, contract and Source ID.
- Opening the existing Studionet record from the Live setup works without a wallet and reaches the review screen. No signing or writing was performed.
- Demo starts paused at 00/45, requires **Start demo**, then reaches 45/45 with two sample outputs and one held job.
- Desktop layout and collapsed evidence sections were visually inspected.

## Remaining checks and boundaries

The cloud-browser download event timed out, so successful file delivery is not confirmed by this run. The output remains available through the verified copy action and inline JSON preview; manually confirm downloads on the publishing host. No new wallet signature, deployment, contract write or Turbo upload was performed for this frontend change. Mobile layouts have responsive CSS but were not visually tested on a physical device.

Build warnings remain for existing large optional wallet/archive dependencies. Evidence Desk and each network SDK load separately from the homepage. The reader checks an exact known contract code hash and trusts the selected RPC; it is not a generic GenLayer contract explorer or a light-client proof.

No deployed contract code changed. Static frontend publication is a separate step from saving this source branch.
