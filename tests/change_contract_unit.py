"""Offline state-machine tests. GenVM storage/consensus is stubbed explicitly.
These tests do not claim to execute the GenVM or produce network consensus.
"""
import importlib.util
import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

OWNER = "0x" + "1" * 40
OTHER = "0x" + "2" * 40
BEFORE = "Express delivery tomorrow. Standard delivery in four days. Price 240."
AFTER = "Express dispatch tomorrow. Standard delivery in four days. Price 240."


class Returned:
    def __init__(self, value):
        self.calldata = value


def consensus(leader, validator):
    result = leader()
    if not validator(Returned(result)):
        raise RuntimeError("VALIDATOR_DISAGREEMENT")
    return result


fake_gl = types.ModuleType("genlayer")
fake_gl.contract = types.SimpleNamespace(Contract=object)
fake_gl.storage = types.SimpleNamespace(TreeMap=dict)
fake_gl.public = types.SimpleNamespace(write=lambda f: f, view=lambda f: f)
fake_gl.message = types.SimpleNamespace(sender_address=types.SimpleNamespace(as_hex=OWNER))
fake_gl.vm = types.SimpleNamespace(UserError=RuntimeError, Return=Returned, run_nondet_default=consensus)
fake_gl.nondet = types.SimpleNamespace(exec_prompt=lambda *_args, **_kw: None)
spec = importlib.util.spec_from_file_location("change_contract_under_test", Path(__file__).parents[1] / "contracts/genlayer/change_impact.py")
module = importlib.util.module_from_spec(spec)
with patch.dict(sys.modules, {"genlayer": fake_gl}):
    spec.loader.exec_module(module)


class ChangeTests(unittest.TestCase):
    def setUp(self):
        fake_gl.message.sender_address.as_hex = OWNER
        self.c = module.ProofGuardChange()
        self.c.cases = {}
        self.actions = [
            {"id": "urgent", "label": "Urgent order", "condition": "Delivery tomorrow is required.", "tool": "purchase", "target": "event", "payload": {"amount": 10}},
            {"id": "stock", "label": "Stock order", "condition": "Standard delivery in four days is required.", "tool": "purchase", "target": "warehouse", "payload": {"amount": 20}},
        ]
        self.c.create_case("CASE-001", "Source correction", OWNER, BEFORE, json.dumps(self.actions))

    def state(self):
        return json.loads(self.c.get_case("CASE-001"))

    def reviewed(self, verdict="MATERIAL_CHANGE"):
        self.c.revise_source("CASE-001", 1, AFTER)
        rows = {"actions": [
            {"id": "urgent", "verdict": verdict, "reason": "The delivery condition is affected.", "old_quote": "Express delivery tomorrow.", "new_quote": "Express dispatch tomorrow."},
            {"id": "stock", "verdict": "NO_MATERIAL_CHANGE", "reason": "The standard delivery condition is unchanged.", "old_quote": "Standard delivery in four days.", "new_quote": "Standard delivery in four days."},
        ]}
        with patch.object(fake_gl.nondet, "exec_prompt", return_value=rows):
            self.c.adjudicate("CASE-001", 2)

    def release(self, action="stock", revision=2, intent_hash=None):
        selected = next(a for a in self.state()["actions"] if a["id"] == action)
        return self.c.release_action("CASE-001", action, revision, intent_hash or selected["intent_hash"])

    def test_pending_never_releases(self):
        self.assertEqual(self.release(revision=1)["code"], "AWAITING_REVIEW")
        self.assertTrue(all(a["release"] is None for a in self.state()["actions"]))

    def test_selective_release_is_a_real_state_change(self):
        self.reviewed()
        self.assertFalse(self.release("urgent")["allowed"])
        self.assertTrue(self.release("stock")["allowed"])
        self.assertIsNone(self.state()["actions"][0]["release"])
        self.assertEqual(self.state()["actions"][1]["release"]["effect"], "REGISTERED_JOB_RELEASED")

    def test_stale_and_changed_intent_cannot_release(self):
        self.reviewed()
        self.assertEqual(self.release(revision=1)["code"], "STALE_SOURCE_REVISION")
        self.assertEqual(self.release(intent_hash="0" * 64)["code"], "INTENT_MISMATCH")
        self.assertIsNone(self.state()["actions"][1]["release"])

    def test_replay_keeps_one_immutable_release(self):
        self.reviewed()
        self.release()
        first = self.state()["actions"][1]["release"]
        self.assertEqual(self.release()["code"], "ALREADY_RELEASED")
        self.assertEqual(self.state()["actions"][1]["release"], first)

    def test_source_revision_fences_old_review(self):
        self.reviewed()
        self.c.revise_source("CASE-001", 2, AFTER + " Availability varies.")
        self.assertEqual(self.release(revision=3)["code"], "AWAITING_REVIEW")
        self.assertEqual(len(self.state()["reviews"]), 1)

    def test_unauthorized_publisher_does_not_invalidate(self):
        fake_gl.message.sender_address.as_hex = OTHER
        with self.assertRaisesRegex(RuntimeError, "ONLY_SOURCE_PUBLISHER"):
            self.c.revise_source("CASE-001", 1, AFTER)
        self.assertEqual(self.state()["revision"], 1)

    def test_unauthorized_owner_cannot_release_or_judge(self):
        self.reviewed()
        fake_gl.message.sender_address.as_hex = OTHER
        with self.assertRaisesRegex(RuntimeError, "ONLY_CASE_OWNER"):
            self.release()
        self.assertEqual(len(self.state()["attempts"]), 0)

    def test_insufficient_evidence_holds_action(self):
        self.reviewed("INSUFFICIENT_EVIDENCE")
        self.assertEqual(self.release("urgent")["code"], "INSUFFICIENT_EVIDENCE")

    def test_duplicate_review_cannot_shop_same_revision(self):
        self.reviewed()
        with self.assertRaisesRegex(RuntimeError, "REVISION_ALREADY_REVIEWED"):
            self.c.adjudicate("CASE-001", 2)

    def test_incomplete_or_invented_evidence_is_rejected(self):
        with self.assertRaisesRegex(RuntimeError, "INCOMPLETE_REVIEW"):
            self.c._validate_review({"actions": []}, self.state())
        rows = [{"id": action["id"], "verdict": "NO_MATERIAL_CHANGE", "reason": "An invented justification.", "old_quote": "not in source", "new_quote": "not in source"} for action in self.actions]
        with self.assertRaisesRegex(RuntimeError, "QUOTE_NOT_IN_EVIDENCE"):
            self.c._validate_review({"actions": rows}, self.state())

    def test_new_source_preserves_historical_release(self):
        self.reviewed()
        self.release()
        first = self.state()["actions"][1]["release"]
        self.c.revise_source("CASE-001", 2, AFTER + " Availability varies.")
        self.assertEqual(self.state()["actions"][1]["release"], first)

    def test_hash_binds_tool_target_and_parameters(self):
        action = self.state()["actions"][1]
        intent = json.loads(action["intent_json"])
        for field, value in [("tool", "withdraw"), ("target", "attacker"), ("payload", {"amount": 999})]:
            changed = dict(intent)
            changed[field] = value
            self.assertNotEqual(module.digest(module.packed(changed)), action["intent_hash"])

    def test_out_of_order_source_and_duplicate_bytes_fail(self):
        with self.assertRaisesRegex(RuntimeError, "STALE_SOURCE_REVISION"):
            self.c.revise_source("CASE-001", 0, AFTER)
        with self.assertRaisesRegex(RuntimeError, "SOURCE_UNCHANGED"):
            self.c.revise_source("CASE-001", 1, BEFORE)

    def test_authorized_restoration_is_a_new_revision_not_a_history_rewrite(self):
        self.reviewed()
        self.c.revise_source("CASE-001", 2, BEFORE)
        self.assertEqual(self.state()["revision"], 3)
        self.assertEqual(len(self.state()["reviews"]), 1)
        self.assertEqual(self.release(revision=3)["code"], "AWAITING_REVIEW")


if __name__ == "__main__":
    unittest.main()
