import json
from pathlib import Path
import pytest

CONTRACT = str(Path(__file__).resolve().parents[1] / "contract.py")
EVIDENCE = "Endpoint GET /health returns 200. Error responses include a request_id field."
RUBRIC = [
    {"id": "health", "requirement": "Document the health endpoint and success status.", "mandatory": True, "weight": 40},
    {"id": "errors", "requirement": "Document a request_id field in error responses.", "mandatory": False, "weight": 60},
]


def row(id="health", verdict="SUPPORTED", quote="Endpoint GET /health returns 200.", evidence="delivery"):
    return {"criterion": id, "verdict": verdict, "quote": quote, "evidence_id": evidence, "reason": "The submitted material establishes this requirement."}


def rows():
    return [row(), row("errors", quote="Error responses include a request_id field.")]


@pytest.fixture
def setup(direct_vm, direct_deploy, direct_alice, direct_owner):
    contract = direct_deploy(CONTRACT)
    contract.create_case("DOCS", "0x" + bytes(direct_alice).hex(), 60, json.dumps(RUBRIC))
    direct_vm.sender = direct_alice
    contract.submit_delivery("DOCS", EVIDENCE)
    direct_vm.sender = direct_owner
    return contract, direct_owner, direct_alice


def read(setup):
    return json.loads(setup[0].get_state())["cases"]["DOCS"]


def review(vm, setup, answer=None, revision=1):
    vm.clear_mocks()
    vm.mock_llm(r"Evaluate a delivery", json.dumps({"reviews": answer if answer is not None else rows()}))
    setup[0].review_delivery("DOCS", revision)


def test_review_and_owner_acceptance(direct_vm, setup):
    review(direct_vm, setup)
    assert direct_vm.run_validator() is True
    assert read(setup)["accepted"] is None
    setup[0].accept_delivery("DOCS", 1)
    accepted = read(setup)["accepted"]
    assert accepted["revision"] == 1
    assert len(accepted["certificate_hash"]) == 64
    assert accepted["accepted_by"] == ("0x" + bytes(setup[1]).hex())


@pytest.mark.parametrize("verdict,status", [("UNPROVEN", "NEEDS_EVIDENCE"), ("CONTRADICTED", "REJECTED")])
def test_mandatory_veto_even_at_score_threshold(direct_vm, setup, verdict, status):
    answer = rows()
    answer[0] = row(verdict=verdict, quote="" if verdict == "UNPROVEN" else "Endpoint GET /health returns 200.", evidence="" if verdict == "UNPROVEN" else "delivery")
    review(direct_vm, setup, answer)
    decision = read(setup)["versions"][-1]["review"]["decision"]
    assert decision["score"] == 60
    assert decision["status"] == status
    with direct_vm.expect_revert("NOT_ACCEPTABLE"):
        setup[0].accept_delivery("DOCS", 1)


def test_below_threshold(direct_vm, setup):
    review(direct_vm, setup, [row(), row("errors", "UNPROVEN", "", "")])
    assert read(setup)["versions"][-1]["review"]["decision"]["status"] == "NEEDS_EVIDENCE"


def test_challenge_fences_previous_review_and_retains_history(direct_vm, setup):
    review(direct_vm, setup)
    setup[0].challenge_review("DOCS", 1, "The example error response omits request_id.")
    case = read(setup)
    assert case["versions"][0]["challenged"] is True
    assert case["versions"][1]["review"] is None
    with direct_vm.expect_revert("STALE_REVISION"):
        setup[0].accept_delivery("DOCS", 1)
    with direct_vm.expect_revert("NOT_ACCEPTABLE"):
        setup[0].accept_delivery("DOCS", 2)
    review(direct_vm, setup, [row(), row("errors", "UNPROVEN", "", "")], revision=2)
    assert read(setup)["versions"][-1]["review"]["decision"]["status"] == "NEEDS_EVIDENCE"


def test_resubmission_cannot_erase_counterevidence(direct_vm, setup):
    review(direct_vm, setup)
    setup[0].challenge_review("DOCS", 1, "Counterevidence survives resubmission.")
    direct_vm.sender = setup[2]
    setup[0].submit_delivery("DOCS", "Replacement deliverable.")
    assert read(setup)["versions"][-1]["evidence"][1]["text"] == "Counterevidence survives resubmission."
    assert read(setup)["versions"][-1]["review"] is None


def test_resubmission_blocks_stale_review(direct_vm, setup):
    direct_vm.sender = setup[2]
    setup[0].submit_delivery("DOCS", "New work.")
    with direct_vm.expect_revert("STALE_REVISION"):
        setup[0].review_delivery("DOCS", 1)


def test_closed_case_cannot_be_replayed_or_rewritten(direct_vm, setup):
    review(direct_vm, setup)
    setup[0].accept_delivery("DOCS", 1)
    with direct_vm.expect_revert("CASE_CLOSED"):
        setup[0].accept_delivery("DOCS", 1)
    with direct_vm.expect_revert("CASE_CLOSED"):
        setup[0].challenge_review("DOCS", 1, "New claim")
    direct_vm.sender = setup[2]
    with direct_vm.expect_revert("CASE_CLOSED"):
        setup[0].submit_delivery("DOCS", "Overwrite")


def test_distinct_roles(direct_vm, setup, direct_bob):
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("PARTY_ONLY"):
        setup[0].review_delivery("DOCS", 1)
    with direct_vm.expect_revert("CONTRACTOR_ONLY"):
        setup[0].submit_delivery("DOCS", "Unknown party")
    with direct_vm.expect_revert("PARTY_ONLY"):
        setup[0].challenge_review("DOCS", 1, "Unknown party")
    direct_vm.sender = setup[2]
    with direct_vm.expect_revert("OWNER_ONLY"):
        setup[0].accept_delivery("DOCS", 1)


def test_validator_checks_every_criterion(direct_vm, setup):
    review(direct_vm, setup)
    direct_vm.clear_mocks()
    direct_vm.mock_llm(r"Evaluate a delivery", json.dumps({"reviews": [row("health", "UNPROVEN", "", ""), rows()[1]]}))
    assert direct_vm.run_validator() is False
    assert direct_vm.run_validator(leader_error=ValueError("failed")) is False


def test_validator_tolerates_prose_difference(direct_vm, setup):
    review(direct_vm, setup)
    direct_vm.clear_mocks()
    independent = rows()
    independent[0]["reason"] = "Different wording for the same supported criterion."
    direct_vm.mock_llm(r"Evaluate a delivery", json.dumps({"reviews": independent}))
    assert direct_vm.run_validator() is True


@pytest.mark.parametrize("answer", [[], [row(), row()], [row(quote="Invented quotation"), rows()[1]], [row(quote="", evidence=""), rows()[1]], [row(evidence="unknown"), rows()[1]]])
def test_incomplete_or_fabricated_evidence_reverts(direct_vm, setup, answer):
    before = setup[0].get_state()
    with direct_vm.expect_revert():
        review(direct_vm, setup, answer)
    assert setup[0].get_state() == before


def test_review_cannot_be_rerolled(direct_vm, setup):
    review(direct_vm, setup)
    with direct_vm.expect_revert("ALREADY_REVIEWED"):
        setup[0].review_delivery("DOCS", 1)


def test_revision_bound(direct_vm, setup):
    direct_vm.sender = setup[2]
    for i in range(7):
        setup[0].submit_delivery("DOCS", "Revision " + str(i))
    with direct_vm.expect_revert("REVISION_LIMIT"):
        setup[0].submit_delivery("DOCS", "One too many")


@pytest.mark.parametrize("change", [{"weight": True}, {"mandatory": 1}, {"weight": 50}, {"requirement": ""}])
def test_invalid_rubric(direct_vm, setup, change):
    criteria = json.loads(json.dumps(RUBRIC))
    criteria[0].update(change)
    with direct_vm.expect_revert():
        setup[0].create_case("BAD", ("0x" + bytes(setup[2]).hex()), 60, json.dumps(criteria))


@pytest.mark.parametrize("response", ["[]", "{}", '{"reviews": [], "extra": 1}'])
def test_invalid_model_envelope_reverts(direct_vm, setup, response):
    before = setup[0].get_state()
    direct_vm.mock_llm(r"Evaluate a delivery", response)
    with direct_vm.expect_revert("INVALID_REVIEW_ENVELOPE"):
        setup[0].review_delivery("DOCS", 1)
    assert setup[0].get_state() == before
