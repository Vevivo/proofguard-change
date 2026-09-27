# Verification record

Executed on 27 September 2026 using Python 3.12.14, genlayer-test 0.29.2,
genvm-linter 0.11.0, and pytest 9.1.1.

```text
pytest -c contributions/pytest.ini contributions/invoice-match/tests contributions/delivery-acceptance/tests -q
45 passed in 0.93s
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

These contributions have not been deployed or exercised on a live network as part
of this verification. There is no invented transaction hash or deployment address.
Before production use, deploy to the intended environment, test real validator
agreement and disagreement, measure bounded worst-case state, and obtain a security
review. The contracts do not move funds.

## Dependency download note

The initial Direct Mode SDK download returned HTTP 404 for its GitHub release URL
in the verification environment. The linter had already downloaded the same public
v0.3.0-rc7 universal artifact bundle successfully. Reusing that file in the Direct
Mode cache allowed the official test runner to proceed. No contract or SDK behavior
was replaced to get the tests to pass.
