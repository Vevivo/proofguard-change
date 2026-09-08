# Live evidence

Read on **8 September 2026 at 07:29:59 UTC** using public GenLayer Studionet RPC calls. No wallet signature or network write was used for this inspection.

The machine-readable result is [deployments/verified-state.json](../deployments/verified-state.json). Run `npm run verify:live` to perform a fresh independent read; it may observe a later revision or different network availability.

## Reference

- Network: GenLayer Studionet, chain `61999`.
- Contract: `0x91883d4829E5b5bD7BED6eBd0EceF927A71942d6`.
- Contract policy: `proofguard-change/2.0`.
- Exact deployed code matches `contracts/genlayer/change_network.py`.
- Code SHA-256: `beca7648cac048399221260c92f55bdc053301fe7eaa4611c3e6eecfc3c8e060`.
- [Review transaction](https://explorer-studio.genlayer.com/tx/0xa511ea667f93b7b46e55e8473470e458e78318e7c85c2c321886920dc424461e): `FINALIZED`, successful execution.

## Observed workflow

Source `COPILOT-BUSINESS-01`, revision 1, is attached to workflow `COPILOT-REVIEW-01`.

| Job | Finalized state | Permits | Output |
| --- | --- | --- | --- |
| `NO-TRAINING` | `ALREADY_EXECUTED` | 1 | Price report present; digest verified |
| `ZERO-RETENTION` | `INSUFFICIENT_EVIDENCE` | 0 | None |

The output digest is `3aaba81cc6d8c4804dfae0a10c1ea760d0f43880aa71730c315753b7b19aa283`. The verification script recomputes source, intent and output SHA-256 values from exact UTF-8 bytes.

This record demonstrates a successful review, permit-backed artifact creation for one job and a held insufficient-evidence job. It does not establish that every correction or network failure scenario has been exercised live. Revision fencing, replay rejection and malformed-evidence handling also have local regression coverage.

## Local verification

The standalone source package was installed with `npm ci`, typechecked and built successfully. `npm test` passed **37 Python tests** and **64 JavaScript tests**. Python tests mock GenVM and reviewer responses. Archive tests use intercepted HTTP requests; they are not proof of an external upload.

The archived RPC summary is a dated observation, not a cryptographic chain proof. Re-read the contract to assess its current state. The registered source contains a publisher-provided summary of GitHub Copilot information; this test does not independently verify current GitHub pricing or policy. Arweave settlement is outside this verification script.
