# ProofGuard integration pilot

Status: proposed adoption experiment. There is no claimed external user, partnership, production deployment or measured savings.

## The product question

Can a developer use ProofGuard to prevent an agent from using an approval after the shared evidence behind it has changed, while keeping unaffected work usable?

The first audience is a team whose evidence publisher, workflow owner and executor can be different parties. A single trusted operator checking a fixed number usually does not need GenLayer; ordinary code is cheaper and simpler. GenLayer's useful role here is independently evaluating whether a natural-language change still supports an agreed condition, then enforcing the resulting on-chain state.

The official [builder fit guidance](https://docs.genlayer.com/developers/intelligent-contracts/when-to-use-genlayer) emphasizes judgment, independently checkable evidence, a shared state consequence and a reason to avoid relying on one backend. This pilot must demonstrate that fit rather than adding consensus to every routine check.

## Current first slice

The [agent connector](AGENT_CONNECTOR.md) removes the need for an agent to navigate the browser to inspect decisions or retrieve protected artifacts. A controlled Studio Next regression already demonstrates source correction, stale-permit rejection and selective reauthorization inside the contract. The connector makes that record available through standard tools.

These are technical prerequisites, not proof of demand. The current protected effects remain a report and purchase-order draft. Manually registered evidence is not automatic observation of a third-party website. An agent that retains direct supplier/API credentials can bypass a separate advisory check.

## A pilot worth extending

Recruit one independent developer with an existing workflow that creates a report or draft from changing, shareable source material. Start with their own real task and counterparties, not another copy of the built-in supplier or Copilot examples. Do not publish private source material just to run this test.

Measure these before and during the pilot:

| Question | Evidence to collect |
| --- | --- |
| Does the problem occur? | An actual stale-source incident or an existing manual reapproval procedure, with the developer's permission to use it. |
| Can another developer integrate it? | Their installation time, code changes and points requiring help; target a first successful read in 30 minutes. |
| Does the workflow behave correctly? | A supported job, a material change, an irrelevant wording change, ambiguous evidence, a source update during execution and an RPC failure. Record unfavorable results too. |
| Is the overhead acceptable? | Measured review/finalization latency and transaction cost, compared with that workflow's own limits. |
| Does it earn continued use? | The developer runs it again on a separate real task and can name a manual check it replaces. |

These targets are proposed decision criteria, not achieved metrics or a universal benchmark.

## Only then expand enforcement

If the pilot earns repeat use, implement **one** narrowly scoped real tool adapter requested by that developer. Put the external credentials behind its enforcement boundary, bind the exact tool payload and source revision, and make retries safe with persistent idempotency records. Define the ordering between source updates and external dispatch explicitly. A last-second RPC check alone cannot make an external API call atomic with a blockchain update.

Add source monitoring only for an authoritative source chosen by the pilot, with provenance, retrieval time and explicit handling of unavailability. An automatic fetch must not quietly change who is allowed to publish a source revision.

## Stop or change direction if

- Developers do not have a concrete stale-approval problem or prefer their existing check after trying the connector.
- All meaningful decisions reduce to deterministic comparisons under one trusted operator.
- Evidence cannot be shared or independently evaluated, or false holds and latency make the workflow unusable.
- The external tool can bypass the proposed enforcement boundary and the operator cannot remove that bypass.

The next meaningful milestone is an independently used integration, supported by recorded behavior and the developer's feedback.
