import json
from pathlib import Path
import pytest

CONTRACT = str(Path(__file__).resolve().parents[1] / "contract.py")


def line(id="I1", description="Editorial review of API docs, September", quantity=2, price=5000, unit="hour"):
    return {"id": id, "description": description, "quantity": quantity, "unit_price_minor": price, "unit": unit}


def answer(target="P1", invoice="I1", reason="Same documentation review service and period."):
    return {"invoice_line": invoice, "order_line": target, "reason": reason}


@pytest.fixture
def setup(direct_vm, direct_deploy, direct_alice, direct_owner):
    contract = direct_deploy(CONTRACT)
    supplier = "0x" + bytes(direct_alice).hex()
    contract.create_order("PO1", supplier, "USD", json.dumps([line("P1", quantity=3)]))
    return contract, supplier, direct_owner, direct_alice


def submit(vm, setup, id="INV1", rows=None, currency="USD", total=None, order="PO1"):
    contract, supplier, owner, seller = setup
    rows = rows or [line()]
    vm.sender = seller
    contract.submit_invoice(order, id, currency, total if total is not None else sum(r["quantity"]*r["unit_price_minor"] for r in rows), json.dumps(rows))
    vm.sender = owner


def review(vm, setup, id="INV1", rows=None):
    vm.clear_mocks()
    vm.mock_llm(r"Match invoice descriptions", json.dumps({"matches": rows or [answer()]}))
    setup[0].review_invoice(setup[1], id)


def invoice(setup, id="INV1"):
    return json.loads(setup[0].get_state())["invoices"][setup[1].lower() + "/" + id]


def test_end_to_end_partial_booking_and_certificate(direct_vm, setup):
    submit(direct_vm, setup)
    review(direct_vm, setup)
    assert invoice(setup)["status"] == "MATCHED"
    assert direct_vm.run_validator() is True
    setup[0].book_invoice(setup[1], "INV1")
    assert invoice(setup)["status"] == "BOOKED"
    assert len(invoice(setup)["record_hash"]) == 64
    assert json.loads(setup[0].get_state())["orders"]["PO1"]["booked"] == {"P1": 2}


def test_booking_race_rechecks_balance(direct_vm, setup):
    for id in ("INV1", "INV2"):
        submit(direct_vm, setup, id)
        review(direct_vm, setup, id)
    setup[0].book_invoice(setup[1], "INV1")
    before = setup[0].get_state()
    with direct_vm.expect_revert("QUANTITY_EXCEEDED"):
        setup[0].book_invoice(setup[1], "INV2")
    assert setup[0].get_state() == before


def test_duplicate_across_orders_and_replay(direct_vm, setup):
    submit(direct_vm, setup)
    setup[0].create_order("PO2", setup[1], "USD", json.dumps([line("P1")]))
    with direct_vm.expect_revert("DUPLICATE_INVOICE"):
        submit(direct_vm, setup, order="PO2")
    direct_vm.sender = setup[2]
    review(direct_vm, setup)
    setup[0].book_invoice(setup[1], "INV1")
    with direct_vm.expect_revert("NOT_BOOKABLE"):
        setup[0].book_invoice(setup[1], "INV1")


@pytest.mark.parametrize("rows,currency,total,problem", [
    ([line(price=5001)], "USD", 10002, "PRICE_MISMATCH"),
    ([line(unit="day")], "USD", 10000, "UNIT_MISMATCH"),
    ([line()], "EUR", 10000, "CURRENCY_MISMATCH"),
    ([line()], "USD", 9999, "TOTAL_MISMATCH"),
    ([line(quantity=4)], "USD", 20000, "QUANTITY_EXCEEDED"),
])
def test_deterministic_holds(direct_vm, setup, rows, currency, total, problem):
    submit(direct_vm, setup, rows=rows, currency=currency, total=total)
    review(direct_vm, setup)
    assert invoice(setup)["status"] == "HELD"
    assert any(p.startswith(problem) for p in invoice(setup)["problems"])
    with direct_vm.expect_revert("NOT_BOOKABLE"):
        setup[0].book_invoice(setup[1], "INV1")


def test_split_lines_cannot_bypass_quantity(direct_vm, setup):
    submit(direct_vm, setup, rows=[line("I1"), line("I2")])
    review(direct_vm, setup, rows=[answer(), answer(invoice="I2")])
    assert "QUANTITY_EXCEEDED:P1" in invoice(setup)["problems"]


def test_unmatched_is_held(direct_vm, setup):
    submit(direct_vm, setup)
    review(direct_vm, setup, rows=[answer(target="")])
    assert invoice(setup)["status"] == "HELD"


def test_validator_independently_disagrees(direct_vm, setup):
    submit(direct_vm, setup)
    review(direct_vm, setup)
    direct_vm.clear_mocks()
    direct_vm.mock_llm(r"Match invoice descriptions", json.dumps({"matches": [answer(target="")]}))
    assert direct_vm.run_validator() is False


def test_validator_allows_different_reason_not_mapping(direct_vm, setup):
    submit(direct_vm, setup)
    review(direct_vm, setup)
    direct_vm.clear_mocks()
    direct_vm.mock_llm(r"Match invoice descriptions", json.dumps({"matches": [answer(reason="The scope and period are equivalent.")]}))
    assert direct_vm.run_validator() is True
    assert direct_vm.run_validator(leader_error=ValueError("no result")) is False
    assert direct_vm.run_validator(leader_result=[answer(target="unknown")]) is False


@pytest.mark.parametrize("response", ["not json", "{}", "[]", '{"matches":[]}', '{"matches":{},"extra":1}', '{"matches":[{"invoice_line":"I1","order_line":"P1","reason":""}]}'])
def test_bad_model_output_does_not_write(direct_vm, setup, response):
    submit(direct_vm, setup)
    before = setup[0].get_state()
    direct_vm.mock_llm(r"Match invoice descriptions", response)
    with direct_vm.expect_revert():
        setup[0].review_invoice(setup[1], "INV1")
    assert setup[0].get_state() == before


def test_role_enforcement(direct_vm, setup, direct_bob):
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("SUPPLIER_ONLY"):
        setup[0].submit_invoice("PO1", "INV1", "USD", 10000, json.dumps([line()]))
    with direct_vm.expect_revert("OWNER_ONLY"):
        setup[0].create_order("OTHER", setup[1], "USD", json.dumps([line("P1")]))
    submit(direct_vm, setup)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("OWNER_ONLY"):
        setup[0].review_invoice(setup[1], "INV1")
    with direct_vm.expect_revert("OWNER_ONLY"):
        setup[0].book_invoice(setup[1], "INV1")


@pytest.mark.parametrize("bad_quantity", [0, -1, True, 1.5, 1_000_001])
def test_numeric_boundary(direct_vm, setup, bad_quantity):
    with direct_vm.expect_revert("INVALID_INTEGER"):
        submit(direct_vm, setup, rows=[line(quantity=bad_quantity)], total=1000)


def test_review_is_not_repeatable(direct_vm, setup):
    submit(direct_vm, setup)
    review(direct_vm, setup)
    with direct_vm.expect_revert("ALREADY_REVIEWED"):
        setup[0].review_invoice(setup[1], "INV1")
