# SourceQuorum

A standalone GenLayer Intelligent Contract for checking whether a claim is
corroborated by a frozen set of source documents. A developer can use it before
publishing a research finding, generating a policy report, or handing evidence
to another contract. It returns an evidence decision, not a permission to execute.

Two links do not necessarily mean two sources. They can belong to the same
publisher or contain the same copied document. SourceQuorum separates semantic
review from a deterministic quorum rule: support counts only when both the
declared publisher group and the exact document digest are distinct.

## Policy and decisions

The deploying owner registers two to four public HTTPS text documents, their
SHA-256 digests, declared publisher groups, and a support threshold of at least
two. A policy cannot be edited. The owner then opens an immutable claim against
that policy. Anyone may request its review.

GenLayer fetches every document and requires its bytes to match the registered
digest. Each document receives one verdict:

| Verdict | Meaning |
| --- | --- |
| `SUPPORTS` | The document explicitly supports the whole claim |
| `CONTRADICTS` | The document explicitly says something incompatible |
| `UNKNOWN` | Evidence is absent, partial, or ambiguous |

A relevant quoted passage is required for support or contradiction. A missing
statement is not treated as a contradiction. Qualifiers such as “may” and “must”
are part of the claim, not interchangeable wording.

The contract then applies a fixed rule:

* Any contradicting source produces `CONFLICT`, even if the support threshold is met.
* Otherwise, enough distinct publisher/digest pairs produce `CORROBORATED`.
* Otherwise, the result is `INSUFFICIENT`.

The count uses exact subset enumeration over at most four sources. A greedy
algorithm could undercount when a publisher has two documents and another
publisher mirrors one of them. Same-host entries also cannot claim different
publisher groups within one policy.

## Consensus boundary

The leader fetches and classifies the documents. Validators independently fetch
the same URLs, check the pinned bytes, classify each document, and compare all
source IDs and verdicts. If the leader selects different passages, validators
also check whether those passages justify the verdict in the full context.
Rephrased explanations alone do not cause disagreement.

Outside the nondeterministic execution, the contract rechecks document hashes,
coverage, allowed verdicts, quote grounding, and the complete output schema.
The final status, counted source set, and contradiction veto are ordinary Python
logic. An HTTP failure, changed body, invalid response, or failed consensus does
not commit a completed case. It stays `OPEN` and can be retried. Completed cases
cannot be rerolled; a genuinely new claim or source policy needs a new ID.

Receipts contain the claim, policy hash, per-source verdicts and short quotes,
counted sources, final decision, and a content hash. Full document bodies are not
stored in the receipt. The policy keeps each original URL and digest.

## Run locally

From the repository root, use Python 3.12 or newer:

```sh
python -m venv .venv-contributions
. .venv-contributions/bin/activate
pip install -r contributions/requirements.txt
pytest -c contributions/pytest.ini contributions/source-quorum/tests -q
genvm-lint check contributions/source-quorum/contract.py
```

The 26 tests use the official GenLayer Direct Mode SDK with mocked web and model
responses. They cover duplicate bodies, same-publisher sources, exact matching,
contradiction veto, unknown evidence, immutable state, unauthorized writes,
source drift, HTTP errors, malformed model output, fabricated quotes, independent
validator disagreement, alternate-citation checking, and review replay. These
tests exercise contract behavior; they do not measure real model accuracy.

The linter passes syntax, structural, and semantic validation. It reports a newer
runner is available. This contract pins the runner tested on Studionet 61999;
check compatibility before using another network. If the Direct Mode release
download returns 404, see the dependency cache note in [VERIFICATION.md](../VERIFICATION.md).

## API

Deploy `contract.py` without constructor arguments.

| Method | Caller | Effect |
| --- | --- | --- |
| `create_policy(id, threshold, sources_json)` | Owner | Freeze source URLs, groups, digests and quorum |
| `open_case(id, policy_id, claim)` | Owner | Freeze a claim against a policy |
| `review_case(id)` | Anyone | Fetch, reach consensus, and record the decision |
| `get_policy(id)` | Anyone | Read the policy as JSON |
| `get_case(id)` | Anyone | Read the claim and receipt as JSON |
| `get_state()` | Anyone | Read all policies and cases as JSON |

Each entry in `sources_json` must have exactly these fields:

```json
{"id":"source-id","publisher":"declared-group","url":"https://public-host.example/document.txt","sha256":"64 lowercase hexadecimal characters"}
```

Use an actual public HTTPS URL and hash its exact UTF-8 response bytes before
registering the policy. The example above is a schema illustration, not a live
source. [sample-policy.json](sample-policy.json) contains the real HTTP reference
sources used in the live exercise. It can be passed as the third argument to
`create_policy("HTTP429", 2, sources_json)` on a fresh owner-controlled instance.

## Trust boundaries

Publisher groups are **owner declarations**, not verified identities. Different
hosts and different bytes do not prove independent authorship. Modified copies,
different subdomains, related companies, omissions, and a deliberately chosen
source set can still bias a result. The contract detects exact-body mirrors and
same-host relabeling, not every form of source dependence.

An immutable digest prevents silent byte changes; it does not establish that a
document is truthful, current, or authoritative. Choose trustworthy sources and
pin the policy before opening a claim. Updating evidence requires a new policy.
The HTTP sample uses RFC Editor and MDN; MDN documents the RFC, so this is a
cross-publication consistency exercise, not proof of independent discovery.

Web and model availability are required. Model judgments can be wrong or fail to
agree. Prompts treat source text as untrusted data, but no prompt-injection
immunity is claimed. HTTP failures abort the whole review rather than silently
lowering the quorum. Redirect handling belongs to the GenVM web runtime; the
contract pins the returned body but does not attest the final host.

Bounds: 16 policies, 32 cases, four sources per policy, 32,000 bytes per document,
1,000 bytes per claim, and 800 bytes per quote. URLs must be public-style HTTPS
DNS names without query strings, fragments, credentials, or explicit ports.
DNS syntax checks are not network isolation. Only use non-sensitive public text.

All registered information and receipts are public. A receipt hash is a content
digest, not an independent signature. Consumers must verify the chain and contract
address as well as the receipt; its hash alone does not bind a deployment.
This reference implementation transfers no funds, issues no execution permits,
and is not an audited production system.

## Verification records

Contract: [0x7580B8500D9296dC08b177f0f7E3Dd89822b86D0](https://explorer-studio.genlayer.com/address/0x7580B8500D9296dC08b177f0f7E3Dd89822b86D0)

[Open in Studio](https://studio.genlayer.com/?import-contract=0x7580B8500D9296dC08b177f0f7E3Dd89822b86D0) · [Deployment transaction](https://explorer-studio.genlayer.com/tx/0xfe2ca148294091ee3ce121792328757c7d0132ba546410ee0539d7c842484c1c)

The deployment uses GenLayer Studionet, chain 61999. Source code was read back
from the network and compared byte for byte. Separate disposable test accounts
created policies and requested reviews; no user wallet or real funds were used.
Deploy your own instance for owner-only methods. The shared instance is a
reference record, not delegated access to its owner account.

The live exercise uses actual RFC Editor and version-pinned MDN documents about
HTTP 429. It includes an intentionally unsupported claim about a fictional
service's support promise. These cases test evidence handling, not that service.

Observed on 29 September 2026 UTC (30 September in Istanbul):

| Case | Recorded result |
| --- | --- |
| `RATE_LIMIT` | `CORROBORATED`; both documents support the rate-limiting meaning |
| `HEADER_REQUIRED` | `CONFLICT`; optional Retry-After is not a mandatory header |
| `SUPPORT_SLA` | `INSUFFICIENT`; neither source establishes a fictional service's support promise |
| `DAILY_CAP` | Review failed with `MAJORITY_DISAGREE`; finalized state remains `OPEN`, with no receipt |

Nine transactions, including deployment, completed with `FINALIZED`,
`MAJORITY_AGREE`, and successful execution. One additional review did not reach
agreement. That attempt was retained rather than rerolled: its transaction later
reached `FINALIZED` while keeping `MAJORITY_DISAGREE`. Finalization alone is not
evidence of a successful contract execution. This limited exercise demonstrates
three decision paths and one failed-consensus path, not general model reliability.

Live deployment and transaction results are recorded in [live-evidence.json](live-evidence.json).
The read-only verifier retrieves deployed source, checks successful consensus
transactions, and reads finalized case receipts:

```sh
npm ci
node contributions/source-quorum/verify-live.mjs
```

It never connects a wallet, signs, or sends a write transaction.
