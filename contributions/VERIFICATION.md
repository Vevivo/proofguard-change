# Verification record

Executed on 27 September 2026 using Python 3.12.14, genlayer-test 0.29.2,
genvm-linter 0.11.0, and pytest 9.1.1.

```text
pytest -c contributions/pytest.ini contributions/invoice-match/tests contributions/delivery-acceptance/tests -q
50 passed in 1.08s
```

Both `genvm-lint check` commands returned `ok: true` for the AST safety checks and
SDK semantic validation. InvoiceMatch exposes four write methods and one view;
DeliveryAcceptance exposes five write methods and one view. Both constructors
take no parameters.

The runner is pinned to
`py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6`.
The tools resolved it from GenVM's v0.3.0-rc7 universal artifact bundle. The linter
also emitted informational warning I200: a newer runner is available. No claim
is made that the pin is the latest or that every current network accepts it.

## What these checks establish

The official Direct Mode runner loads actual contract code and SDK storage with
mocked LLM responses. Tests exercise public methods, role enforcement, immutable
state transitions, replay protection, failure paths, arithmetic, evidence bounds,
and explicit calls to the captured validator using agreeing or disagreeing answers.

The disagreement tests are especially relevant: they show that a valid-looking
leader output is rejected when the validator independently derives another mapping
or criterion verdict. Validation is not only an enum or JSON-shape check.

## What these checks do not establish

Direct Mode does not run a distributed consensus network. It normally executes
the leader before validators are invoked separately by the tests. It cannot prove
network finality, production gas costs, real model quality, resistance to all prompt
injections, or compatibility with the target network's complete GenVM execution.

## Live Studionet verification

Both current contracts were deployed on stable Studionet (chain 61999) on
27 September 2026 UTC, using genlayer-js 1.1.8 and separate disposable test accounts.
No real funds or user wallet keys were used. `getContractCode` matched the repository
source byte for byte and `get_state` was read at `latest-final`.

* InvoiceMatch: create order, supplier submits invoice, independent consensus review,
  then buyer books. Observed `MATCHED` followed by `BOOKED`, with two of three hours
  consumed and a record hash.
* DeliveryAcceptance: lock rubric, contractor submits concrete documentation,
  independent consensus review, then buyer accepts. Observed two supported rows,
  score 100, `ACCEPTABLE`, and a stored revision-1 acceptance certificate.

All eight sample writes and both deployments finalized successfully with
`MAJORITY_AGREE`. These were full-consensus transactions, not leader-only simulation.
Addresses, source hashes, transaction IDs, inputs, votes and final state are in
[live-evidence.json](live-evidence.json). Each contract README links its Studio
and Explorer records. Negative paths and races were tested in Direct Mode, not
repeated on the live network. One successful sample per contract is not a production
audit or a guarantee of future LLM agreement.

### Issue discovered by the live test

The initial InvoiceMatch review failed with `INCOMPLETE_MATCH` and ended
`UNDETERMINED` because the prompt requested a top-level array while JSON-mode
providers return objects. The failed transaction is recorded under `previousAttempt`
in the evidence file. Both prompts now request named object envelopes (`matches`
and `reviews`), validate the envelope, and validate every enclosed row. Five
additional regression cases cover invalid envelopes and empty mappings. The
current addresses point to newly deployed, corrected source. The failed instance
is not presented as successful evidence.

The contracts do not move funds. Production adoption still requires bounded
worst-case profiling, adversarial model evaluation, and a security review.

## Dependency download note

The initial Direct Mode SDK download returned HTTP 404 for its GitHub release URL
in the verification environment. The linter had already downloaded the same public
v0.3.0-rc7 universal artifact bundle successfully. Reusing that file in the Direct
Mode cache allowed the official test runner to proceed. No contract or SDK behavior
was replaced to get the tests to pass.
