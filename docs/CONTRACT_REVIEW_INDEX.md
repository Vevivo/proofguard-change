# Contract review index

This index separates the shipped ProofGuard application from related contract research in this repository. Start with [the application reviewer guide](REVIEWER_GUIDE.md). The additional contracts below are developer prototypes on contribution branches. They are not wired into the ProofGuard web interface and are not three additional shipped products.

## Application and supporting work

| Work | Purpose | Review entry point | Integration status |
| --- | --- | --- | --- |
| ProofGuard Change | Recheck whether an exact agent job remains permitted after its supporting source changes | [Application and correction regression](REVIEWER_GUIDE.md) | Browser workflow, source revisions, per-job reviews, owner authorization, executor outputs and audit exports |
| InvoiceMatch | Match invoice descriptions while enforcing exact prices, units and atomic remaining quantities | [Pinned documentation](https://github.com/Vevivo/proofguard-change/blob/ddba074d79440264825d4a48598090ea30c31363/contributions/invoice-match/README.md) | Separate contract prototype; no app integration, accounting connector or payment |
| DeliveryAcceptance | Review supplied text against a locked rubric, preserving challenges and preventing stale acceptance | [Pinned documentation](https://github.com/Vevivo/proofguard-change/blob/ddba074d79440264825d4a48598090ea30c31363/contributions/delivery-acceptance/README.md) | Separate contract prototype; no app integration, escrow or proof of physical delivery |
| SourceQuorum | Assess pinned documents and count declared publisher groups and distinct document bodies, with a contradiction veto | [Pinned documentation](https://github.com/Vevivo/proofguard-change/blob/6bc79250439d056194681b0824aaa738e70011ae/contributions/source-quorum/README.md) | Separate contract prototype; no app integration, proven publisher identity or universal truth guarantee |

## ProofGuard application

The main application protects a source revision and an exact registered tool call. GenLayer performs semantic review; ordinary contract logic checks revision, owner authorization, executor identity and replay at execution.

The [Studio Next record](../deployments/studio-next-correction.json) documents a controlled test on chain 61997 using separate owner and executor accounts. A correction fences both unused old permits. A fresh review supports standard delivery but holds express delivery; fresh authorization creates one draft and replay is blocked. Run `npm ci` and `npm run verify:correction` for a read-only network check. See the reviewer guide for prerequisites and offline limitations.

The original browser example and related contract prototypes use Studionet, chain 61999. These deployments are not interchangeable with Studio Next. Reports and order drafts do not place external orders or transfer funds.

## Related contract evidence

These are previously recorded network exercises, not new transactions created by this documentation update. Their source, fixtures, tests and deployment records are pinned below so a reviewer does not need to search the repository's branches.

### InvoiceMatch

- [Contract](https://github.com/Vevivo/proofguard-change/blob/ddba074d79440264825d4a48598090ea30c31363/contributions/invoice-match/contract.py)
- [Tests](https://github.com/Vevivo/proofguard-change/blob/ddba074d79440264825d4a48598090ea30c31363/contributions/invoice-match/tests/test_invoice.py)
- [Recorded transactions and state](https://github.com/Vevivo/proofguard-change/blob/ddba074d79440264825d4a48598090ea30c31363/contributions/live-evidence.json)
- [Explorer contract](https://explorer-studio.genlayer.com/address/0x1a1C897efBCd0BA6a51222947001180d461278a3)

The September 27 UTC record shows a fictional invoice booked for two of three ordered hours. The documented 25 Direct Mode tests cover booking races, quantity aggregation, arithmetic, roles, replay and validator disagreement. Local model responses are mocked; these tests are not a measurement of real model accuracy.

### DeliveryAcceptance

- [Contract](https://github.com/Vevivo/proofguard-change/blob/ddba074d79440264825d4a48598090ea30c31363/contributions/delivery-acceptance/contract.py)
- [Tests](https://github.com/Vevivo/proofguard-change/blob/ddba074d79440264825d4a48598090ea30c31363/contributions/delivery-acceptance/tests/test_delivery.py)
- [Recorded transactions and state](https://github.com/Vevivo/proofguard-change/blob/ddba074d79440264825d4a48598090ea30c31363/contributions/live-evidence.json)
- [Explorer contract](https://explorer-studio.genlayer.com/address/0xCf1c40b19514B27D961a23e6D65619707bEE75eE)

The September 27 UTC record shows a synthetic documentation packet accepted at revision 1. The documented 25 Direct Mode tests cover mandatory vetoes, evidence quotations, role separation, challenges, stale acceptance and validator disagreement. An acceptance certificate concerns the supplied text and agreed rubric, not the authenticity or completion of work outside the contract.

### SourceQuorum

- [Contract](https://github.com/Vevivo/proofguard-change/blob/6bc79250439d056194681b0824aaa738e70011ae/contributions/source-quorum/contract.py)
- [Tests directory](https://github.com/Vevivo/proofguard-change/tree/6bc79250439d056194681b0824aaa738e70011ae/contributions/source-quorum/tests)
- [Recorded transactions and state](https://github.com/Vevivo/proofguard-change/blob/6bc79250439d056194681b0824aaa738e70011ae/contributions/source-quorum/live-evidence.json)
- [Read-only verifier](https://github.com/Vevivo/proofguard-change/blob/6bc79250439d056194681b0824aaa738e70011ae/contributions/source-quorum/verify-live.mjs)
- [Explorer contract](https://explorer-studio.genlayer.com/address/0x7580B8500D9296dC08b177f0f7E3Dd89822b86D0)

The September 29 UTC record contains CORROBORATED, CONFLICT and INSUFFICIENT outcomes. A fourth review reached FINALIZED with MAJORITY_DISAGREE and left the case OPEN; it is retained as a failed consensus attempt. Finalization alone does not establish successful execution. The documented 26 Direct Mode tests use mocked web and model responses.

Publisher groups are declarations. Exact hashes detect duplicate bodies and byte changes; neither proves independent authorship or truth. The HTTP reference example compares RFC Editor and MDN, which describes the RFC, so it is not evidence of independent discovery.

## Scope of this index

The three prototypes are supporting repository work, not additional features demonstrated by the browser video. Their documentation explains how to deploy a fresh instance with the appropriate test accounts. Existing reference deployments do not delegate their owner accounts.

No independent user adoption, production readiness, security audit, automatic protection of arbitrary external APIs or new live verification is claimed by this index. Test networks can reset. Archived records show what was observed on their stated dates; read the network again to establish current state.
