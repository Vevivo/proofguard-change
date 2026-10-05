# Review ProofGuard Change

ProofGuard asks a narrow question: **can an already approved agent job still run after the evidence behind it changes?** The contract binds permission to a source revision and an exact tool call. An unused old permit cannot authorize a new output. Semantic review decides which jobs remain supported; a separate owner still authorizes execution.

## Start with the application

- [Guided demo](https://proofguardchange.ar.io/?mode=demo): no wallet; labeled sample data.
- [Product walkthrough video](https://www.youtube.com/watch?v=27-_cac4LQk): introduction to the interface. Recorded before the Studio Next regression below.
- [Existing Live workspace](https://proofguardchange.ar.io/?mode=live): Studionet, chain **61999**. The browser application's network has not been migrated to Studio Next.

To inspect the original Live example, enter contract `0x91883d4829E5b5bD7BED6eBd0EceF927A71942d6` and source `COPILOT-BUSINESS-01`. One condition is supported and one lacks evidence. `npm run verify:live` reads that instance without a wallet.

## Verify the correction regression

This is a separate, controlled **live-network test on Studio Next, chain 61997**. Its supplier text is a fixture, not a claim about an actual company. GenLayer performs the semantic reviews on the network; reviewer answers are not mocked in this run. Separate test accounts act as owner and executor.

The exact current v2 contract is deployed at:

[0x8a93A27747D0a007cfD525D5456B1017ca5bF50e](https://explorer-studio-dev.genlayer.com/address/0x8a93A27747D0a007cfD525D5456B1017ca5bF50e)

The test checks this sequence:

| Step | What must happen |
| --- | --- |
| Review v1 | Standard and express delivery conditions are supported. |
| Authorize v1 | Owner creates two permits; executor consumes neither. |
| Publish v2 | Express **delivery** becomes **dispatch** without a guaranteed arrival. Standard delivery is unchanged. |
| Try both old permits | Both execution attempts are held with `STALE_SOURCE_REVISION`. No artifact is created. |
| Review v2 | Standard remains supported; express is `MATERIAL_CHANGE`. |
| Try changed job | Express receives no new permit. |
| Try standard without a fresh permit | Execution is held with `AUTHORIZATION_REQUIRED`. |
| Authorize standard again, then execute | A separate executor creates one v2 purchase-order draft. |
| Replay the same execution | `ALREADY_EXECUTED`; the output remains unchanged. |

Install Node.js 22.13+ and run:

```sh
git clone https://github.com/Vevivo/proofguard-change.git
cd proofguard-change
npm ci
npm run verify:correction
```

The verification command does not need a wallet or private key. It checks the chain ID, exact deployed source, finalized successful transactions, senders, target contract, call arguments, evidence and output hashes, reviews, permit history and blocked attempts. A transaction that records a rejected application-level attempt can succeed on the network: `allowed: false` and its reason prove that no output was authorized.

For network-independent inspection of the saved record:

```sh
npm run verify:correction -- --offline
```

Offline mode checks the archived snapshot only. Its output says `ARCHIVED_SNAPSHOT_ONLY`; it does not claim to re-read the chain. Studio Next is a development preview and its state may be reset. A later failed lookup does not turn a saved snapshot into current on-chain proof.

## Reproduce with your own test accounts

The [fixture](../examples/correction-scenario.json) and [runner](../scripts/reproduce-correction.mjs) are included. Supply two different, test-only accounts through `PROOFGUARD_TEST_OWNER_KEY` and `PROOFGUARD_TEST_EXECUTOR_KEY`. Fund them with test GEN using the Studio Next faucet. Do not use a wallet that holds real assets.

```sh
npm run reproduce:correction
# Prints the requirements; does not submit anything.
npm run reproduce:correction -- --submit-test-transactions
```

The second command deploys a **new** instance, estimates fees and runs the sequence. Results and intermediate receipts go to ignored `work/correction-next/`. Resume with the same accounts and directory after an interruption: recorded transaction hashes are checked again, not blindly resubmitted. An unsuccessful semantic review stops the test and preserves its transaction rather than being converted into a favorable result. For a deliberate fresh run, choose a different `PROOFGUARD_TEST_DIR`.

## What this does and does not demonstrate

The guarded effect is a contract artifact: a price report or purchase-order draft. It is not an external order or payment. A publisher can submit false information; the review evaluates support within the registered source. These network tests do not establish the safety of arbitrary prompts or third-party tool integrations. Previously generated outputs remain historical records when evidence changes.

Local tests deliberately mock GenVM and review responses. The live regression uses the actual deployed GenVM and validator review. Neither should be described as independent user adoption or a third-party security audit.

## Related contract research

[Contract review index](CONTRACT_REVIEW_INDEX.md) lists InvoiceMatch, DeliveryAcceptance and SourceQuorum with pinned source, tests and deployment records. These are separate prototypes in this repository, not features integrated into the browser application. Their evidence is supplementary to the ProofGuard product review.
