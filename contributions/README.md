# Standalone GenLayer contract primitives

Two independent contracts, each deployable as one Python file. They do not import
ProofGuard, use its deployed state, or change its application. This directory is
on the `contributions/contract-primitives` branch so the published app stays intact.

| Contract | Problem | Consensus boundary | Deterministic enforcement |
| --- | --- | --- | --- |
| [InvoiceMatch](invoice-match/README.md) | Different descriptions make invoice reconciliation brittle | Independently match every invoice line to an ordered item | Exact prices, units, currency, totals, aggregate quantities, duplicate IDs, atomic booking |
| [DeliveryAcceptance](delivery-acceptance/README.md) | A delivery can score well while missing a mandatory requirement | Independently assess every locked criterion against submitted evidence | Mandatory veto, weighted threshold, role separation, challenge revisions, final acceptance certificate |

These are reference primitives, not audited production systems. The included
fixtures are synthetic. Neither contract moves funds or establishes physical
delivery. Read each contract's trust boundaries before using it.

Both contracts have verified Studionet deployments and completed live sample flows.
See [live evidence](live-evidence.json) and each contract README for addresses.

## Reproduce verification

Python 3.12 or newer:

```sh
python -m venv .venv-contributions
. .venv-contributions/bin/activate
pip install -r contributions/requirements.txt
pytest -c contributions/pytest.ini contributions/invoice-match/tests contributions/delivery-acceptance/tests -q
genvm-lint check contributions/invoice-match/contract.py
genvm-lint check contributions/delivery-acceptance/contract.py
```

The pytest configuration disables the Studio integration plugin and keeps the
official Direct Mode plugin enabled. Direct Mode uses the GenLayer SDK and storage
adapter, with mocked LLM responses. First use downloads the GenVM SDK artifacts.
An internet connection is needed for dependency and artifact downloads.

The contracts pin the `py-genlayer` runner shown in their headers. The linter
reports that a newer runner is available; compatibility with a target network
must be checked before deployment. See [verification](VERIFICATION.md).

## References

* [GenLayer equivalence principle](https://docs.genlayer.com/developers/intelligent-contracts/equivalence-principle)
* [GenLayer contract testing](https://docs.genlayer.com/developers/intelligent-contracts/testing)
* [GenVM linter](https://docs.genlayer.com/api-references/genvm-linter)

MIT, as in the repository [license](../LICENSE).
