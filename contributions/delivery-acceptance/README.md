# DeliveryAcceptance

A standalone GenLayer Intelligent Contract for reviewing a deliverable against
acceptance criteria agreed before submission. A buyer cannot change the rubric
after seeing the work, and a high aggregate score cannot compensate for a missing
mandatory requirement.

Useful for text-based documentation reviews, grant milestone evidence, and
contractor handoffs where an auditable acceptance record matters. It evaluates
what the submitted material establishes; it does not prove real-world completion.

## Lifecycle

1. The deploying buyer registers a distinct contractor, locked rubric, and score
   threshold. Each criterion has a weight and a mandatory flag. Weights total 100.
2. The contractor submits the deliverable text. Each submission creates a numbered
   revision with an immutable evidence packet.
3. Either party requests consensus review of an exact revision.
4. Each criterion receives `SUPPORTED`, `CONTRADICTED`, or `UNPROVEN`, with grounded
   quotations when a positive or negative conclusion is made.
5. A deterministic rule produces the overall decision. The buyer may explicitly
   accept only an `ACCEPTABLE` current revision.
6. Before acceptance, either party may challenge a completed review with concrete
   counterevidence. This creates a new revision needing a fresh review.

| Condition | Decision |
| --- | --- |
| Any mandatory criterion is contradicted | `REJECTED` |
| Any mandatory criterion is unproven | `NEEDS_EVIDENCE` |
| No mandatory failure, but supported weights fall below the threshold | `NEEDS_EVIDENCE` |
| All mandatory criteria supported and threshold reached | `ACCEPTABLE` |

Only supported rows contribute weight. Nonmandatory criteria can be unsatisfied
without blocking acceptance when the threshold is reached. This is an explicit
rubric choice, not a model-created exception.

## Consensus and evidence

Each validator independently evaluates the same locked criteria and packet using
`gl.nondet.exec_prompt`. The custom `run_nondet_unsafe` validator compares the
complete criterion/verdict vector, not just the final score or JSON structure.
Disagreement about one criterion is disagreement even if the aggregate score
would remain unchanged.

Both leader and validator outputs must cover every criterion exactly once.
Every `SUPPORTED` or `CONTRADICTED` row must cite an exact nonempty substring of a
named evidence item. Unknown evidence IDs, fabricated quotations, duplicate rows,
and unsupported enum values fail. Wording and choice of valid excerpt can differ;
the narrative reasoning itself is not an exact-agreement field.

The prompt treats evidence as untrusted data, rejects completion claims unsupported
by concrete material, distinguishes plans from completed work, and treats unresolved
conflicts as `UNPROVEN`. It never fetches linked pages or assumes their contents.
Quotation presence provides traceability, not proof that the quoted statement is true.

## Challenge and race protection

A review is immutable and cannot be rerolled. A challenge preserves it, marks it
challenged, and creates a new version containing the prior packet and counterevidence.
Replacing the contractor's deliverable preserves accumulated challenges, so adverse
evidence cannot be silently removed.

Review, challenge, and acceptance require `expected_revision`. A transaction based
on an older page view cannot accept work after a newer submission or challenge.
Acceptance stores one immutable certificate binding the case, revision, rubric,
evidence, review, buyer, and contractor. Closed cases reject further changes and
repeat acceptance. There is no automatic acceptance or timeout override.

## Try the contract

Deploy [contract.py](contract.py) with no constructor arguments. Replace
`CONTRACTOR_ADDRESS` with a second account. The following evidence is fictional.

Buyer calls `create_case`:

```text
case_id: API-DOCS-01
contractor: CONTRACTOR_ADDRESS
threshold: 80
criteria_json:
[{"id":"health","requirement":"Document the health endpoint path and success status.","weight":40,"mandatory":true},{"id":"errors","requirement":"Document a request_id field in error responses.","weight":60,"mandatory":false}]
```

Contractor calls `submit_delivery`:

```text
case_id: API-DOCS-01
evidence_text: Endpoint GET /health returns 200. Error responses include a request_id field.
```

Either party calls `review_delivery("API-DOCS-01", 1)`. After network finality,
inspect `get_state()`. If both criteria are supported, the decision is `ACCEPTABLE`
with score 100. The buyer can call `accept_delivery("API-DOCS-01", 1)`.

To try the challenge path instead of accepting, call:

```text
challenge_review("API-DOCS-01", 1, "The submitted error example is {\"error\":\"invalid\"}; it has no request_id field.")
```

The current revision becomes 2 with no review. `accept_delivery(..., 1)` must fail
as stale. Review revision 2. The contradictory packet should cause the error
criterion to remain unresolved unless the supplied material establishes a clear
resolution. The model verdict is a network result, not a scripted guarantee.

## API

| Method | Caller | Effect |
| --- | --- | --- |
| `create_case(id, contractor, threshold, criteria_json)` | Buyer | Lock criteria and roles |
| `submit_delivery(id, evidence_text)` | Contractor | New revision, preserving challenges |
| `review_delivery(id, expected_revision)` | Either party | Independent semantic consensus |
| `challenge_review(id, expected_revision, counterevidence)` | Either party | Retain review and create unreviewed revision |
| `accept_delivery(id, expected_revision)` | Buyer | Close an acceptable case with a certificate |
| `get_state()` | Anyone | JSON cases, evidence, history, and certificates |

## Limits and trust

32 cases per deployment; eight criteria and eight total revisions per case;
12,000 UTF-8 bytes per delivery; 4,000 bytes per challenge; 800 bytes per criterion.
The bounded JSON representation is for small reference deployments. Large
documents need a separately designed content-addressed retrieval layer.

All submitted material is public. Use public or synthetic evidence. Parties can
submit false text; consensus evaluates support within that text, not authenticity.
There is no payment escrow, legal adjudication, external execution, delivery
verification, or claim that a model cannot be manipulated. A buyer can decline to
accept; a party can exhaust the revision budget. The contract deliberately holds
no funds, so these liveness limits cannot trap a deposit.

## Verification

[22 Direct Mode tests](tests/test_delivery.py) cover mandatory vetoes, insufficient
evidence, exact quotations, role separation, conflicting validator verdicts,
stale acceptance, challenge preservation, terminal states, and bounds.
See [verification details](../VERIFICATION.md) for executed commands and limits.
