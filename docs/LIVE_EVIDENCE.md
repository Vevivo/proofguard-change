# Live evidence

Re-read on **30 September 2026** using public GenLayer Studionet RPC calls. No wallet signature or network write was used for this inspection.

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

This record demonstrates a successful review, permit-backed artifact creation for one job and a held insufficient-evidence job. This original instance does not exercise a correction. The additional Studio Next run below covers revision fencing, selective reauthorization and replay; malformed-evidence and arbitrary network-failure coverage still relies on local tests.

## Local verification

The standalone source package was installed with `npm ci`, typechecked and built successfully. `npm test` passed **37 Python tests** and **69 JavaScript tests**. Python tests mock GenVM and reviewer responses. Archive tests use intercepted HTTP requests; they are not proof of an external upload.

The archived RPC summary is a dated observation, not a cryptographic chain proof. Re-read the contract to assess its current state. The registered source contains a publisher-provided summary of GitHub Copilot information; this test does not independently verify current GitHub pricing or policy. Arweave settlement is outside this verification script.

## Studio Next correction regression, 30 September 2026

This supplementary run was performed after the original hackathon submission. It deploys the exact same v2 contract on chain **61997**, using two separate test-only accounts and a clearly labeled supplier fixture. The existing browser application remains on Studionet (61999).

Contract: [0x8a93A27747D0a007cfD525D5456B1017ca5bF50e](https://explorer-studio-dev.genlayer.com/address/0x8a93A27747D0a007cfD525D5456B1017ca5bF50e). All **15 transactions finalized with successful execution**. The two semantic reviews used validator consensus (`leader_only: false`, five initial validators), not local mock responses.

| Check | Observed result |
| --- | --- |
| Execute with either v1 permit after v2 correction | `STALE_SOURCE_REVISION`, no output |
| Re-review standard vs express delivery | `NO_MATERIAL_CHANGE` vs `MATERIAL_CHANGE` |
| Authorize affected express job | Held; no v2 permit |
| Execute supported job without fresh permission | `AUTHORIZATION_REQUIRED` |
| Fresh owner permit, separate executor | One v2 draft created |
| Replay execution | `ALREADY_EXECUTED`; same output |

[Transaction manifest](../deployments/studio-next-correction.json) · [Finalized state snapshot](../deployments/studio-next-correction-state.json) · [Reviewer guide](REVIEWER_GUIDE.md)

Run `npm run verify:correction` for independent read-only checks, or add `-- --offline` to inspect only the saved snapshot. A successful transaction can record an application-level denial; look at `allowed` and `code`, not just transaction finality.

| Operation | Transaction |
| --- | --- |
| `deploy` | [0x2543f881b7…](https://explorer-studio-dev.genlayer.com/tx/0x2543f881b73124d6999ab8fdb719322cbbdc0603358a97a7c63e4999f16b2c20) |
| `publish-v1` | [0xd123ffba19…](https://explorer-studio-dev.genlayer.com/tx/0xd123ffba19b3875415dc2611b69e98383b458a0cda71d8d0cbbe16d65367c4b2) |
| `register` | [0x1ab8399a9a…](https://explorer-studio-dev.genlayer.com/tx/0x1ab8399a9a33b7d4b3f6ab326aa6ab0f67d329782be69ec10b6d6074cd563c77) |
| `review-v1` | [0xcd96848561…](https://explorer-studio-dev.genlayer.com/tx/0xcd96848561684cd4f3a32935720c00407c540c455a5ff2fce48c0c6ae0d4185c) |
| `permit-v1-STANDARD` | [0x6704f3f22e…](https://explorer-studio-dev.genlayer.com/tx/0x6704f3f22e45209f6d5df5d09ed0e78b2275a234d14120668da2fb178487dfd4) |
| `permit-v1-EXPRESS` | [0x7165701427…](https://explorer-studio-dev.genlayer.com/tx/0x71657014276bdd2a1c9d38e7ab6974c2de6259c6a196b28ec51dfc08b503dbc3) |
| `revise-v2` | [0x6271d1961a…](https://explorer-studio-dev.genlayer.com/tx/0x6271d1961a003f6916c55392aa490e6a19b75168838a26504654c05955427f56) |
| `stale-STANDARD` | [0xe38c8e3c8e…](https://explorer-studio-dev.genlayer.com/tx/0xe38c8e3c8e1e56017902f3556e1196de5cab762cbfd27868de5fe22fdd904f7a) |
| `stale-EXPRESS` | [0x414d048ad6…](https://explorer-studio-dev.genlayer.com/tx/0x414d048ad6d0803a9dc40ac845f92d56b129051517235fc385485287dce5a5ce) |
| `review-v2` | [0xd673f05b28…](https://explorer-studio-dev.genlayer.com/tx/0xd673f05b2818e400d103160420a9fe4bef6286cce713fe5bc6cfd5288eaa7e69) |
| `held-EXPRESS` | [0x12afdc014d…](https://explorer-studio-dev.genlayer.com/tx/0x12afdc014d0c214206a9c9616c859ba174d5a3312cd7c0c69938745167c3d0be) |
| `missing-current-permit` | [0x4964461835…](https://explorer-studio-dev.genlayer.com/tx/0x4964461835f1f75cb3dcb9ecb9403f6cc025ffccb9461b1cac66847722c49bf3) |
| `permit-v2-STANDARD` | [0x3b6156d019…](https://explorer-studio-dev.genlayer.com/tx/0x3b6156d019e6300302e576db0e22ccbc9ccc5e3907013d4997ef39f609cb7ea9) |
| `execute-STANDARD` | [0x4c1e71c241…](https://explorer-studio-dev.genlayer.com/tx/0x4c1e71c24129901599cd9bdea5ea0267289a389b0c8cd5f44c7789d8055737ef) |
| `replay-STANDARD` | [0x0c34b5d5e6…](https://explorer-studio-dev.genlayer.com/tx/0x0c34b5d5e6025cff6737cfbec4c64c3cfc19255380ba08746d7229c3887d41ef) |

One receipt lookup temporarily returned non-JSON from the RPC. The runner resumed using the same transaction hashes, without creating a replacement deployment or rerolling either semantic review. The archived evidence is a dated observation, not a cryptographic chain proof or a guarantee that the preview network will preserve state. No external order, payment or real user adoption is asserted.
