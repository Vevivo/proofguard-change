"""Actual registered Copilot inputs; mocked model responses, not live consensus."""
import copy
import json
from pathlib import Path
import unittest
from unittest.mock import patch
from change_network_unit import gl, m

BUNDLE = json.loads((Path(__file__).parent / 'fixtures/copilot-unreviewed-source.json').read_text())


class EvidenceTests(unittest.TestCase):
    def setUp(self):
        self.c = m.ProofGuardChangeNetwork()
        self.c.sources = {}; self.c.cases = {}
        self.source = copy.deepcopy(BUNDLE['source'])
        gl.message.sender_address.as_hex = self.source['publisher']
        self.c.publish_source(self.source['id'], self.source['title'], self.source['versions'][0]['text'])
        w = BUNDLE['workflows'][0]
        jobs = [dict(id=a['id'], label=a['label'], condition=a['condition'], **{
            k:v for k,v in json.loads(a['intent_json']).items() if k in ['tool','target','payload']}) for a in w['actions']]
        self.c.register_workflow(w['id'], w['title'], self.source['id'], 1, w['executor'], json.dumps(jobs))
        quote_id = next(i for i,t in enumerate(m.evidence_excerpts(self.source['versions'][0]['text'])) if 'to train AI models' in t)
        self.answer = {'jobs': [
            dict(workflow_id=w['id'], id='NO-TRAINING', verdict='NO_MATERIAL_CHANGE', reason='The source states the base price and excludes training use.', old_excerpt_id=quote_id, new_excerpt_id=quote_id),
            dict(workflow_id=w['id'], id='ZERO-RETENTION', verdict='INSUFFICIENT_EVIDENCE', reason='No retention guarantee is established by the source.', old_excerpt_id=None, new_excerpt_id=None),
        ]}

    def bundle(self): return json.loads(self.c.get_source_bundle(self.source['id']))
    def review(self): self.c.review_source(self.source['id'], 1)

    def test_copilot_input_keeps_supported_and_unsupported_jobs_separate(self):
        with patch.object(gl.nondet, 'exec_prompt', return_value=self.answer): self.review()
        w = self.bundle()['workflows'][0]
        self.assertEqual([a['gate'] for a in w['actions']], ['READY', 'INSUFFICIENT_EVIDENCE'])
        for row in w['reviews'][0]['actions']:
            self.assertIn(row['old_quote'], self.source['versions'][0]['text'])
            self.assertIn(row['new_quote'], self.source['versions'][0]['text'])
        for a in w['actions']:
            result = self.c.authorize_action(w['id'], a['id'], 1, a['intent_hash'])
            self.assertEqual(result['allowed'], a['id'] == 'NO-TRAINING')
        a = w['actions'][0]
        self.c.execute_action(w['id'], a['id'], 1, a['intent_hash'])
        saved = self.bundle()['workflows'][0]['actions']
        self.assertEqual(json.loads(saved[0]['execution']['output_json'])['unit_price'], 19)
        self.assertIsNone(saved[1]['execution'])

    def test_model_paraphrase_cannot_replace_an_exact_catalog_quote(self):
        response = copy.deepcopy(self.answer)
        response['jobs'][0]['old_quote'] = 'Invented sentence not in the source'
        resolved = m.resolve_review_references(response, self.source, BUNDLE['workflows'])
        self.assertNotEqual(resolved[0]['old_quote'], response['jobs'][0]['old_quote'])
        self.assertIn(resolved[0]['old_quote'], self.source['versions'][0]['text'])

    def test_invalid_and_missing_ids_never_grant_a_review(self):
        for bad in [-1, 100000, True, '0', 0.5, None]:
            response = copy.deepcopy(self.answer); response['jobs'][0]['old_excerpt_id'] = bad
            with self.subTest(bad=bad), self.assertRaisesRegex(RuntimeError, 'INVALID_EVIDENCE_REFERENCE'):
                m.resolve_review_references(response, self.source, BUNDLE['workflows'])
        response = copy.deepcopy(self.answer); del response['jobs'][1]['new_excerpt_id']
        with self.assertRaisesRegex(RuntimeError, 'MISSING_EVIDENCE_REFERENCE'):
            m.resolve_review_references(response, self.source, BUNDLE['workflows'])

    def test_format_retry_is_bounded_and_keeps_state_unchanged(self):
        with patch.object(gl.nondet, 'exec_prompt', return_value={'jobs':[]}) as model:
            with self.assertRaisesRegex(RuntimeError, 'REVIEW_FORMAT_RETRY_EXHAUSTED'): self.review()
            self.assertEqual(model.call_count, 2)
        self.assertEqual(self.bundle()['workflows'][0]['reviewed_revision'], 0)

    def test_single_format_retry_can_recover_without_relaxing_validation(self):
        with patch.object(gl.nondet, 'exec_prompt', side_effect=[{'jobs':[]}, self.answer, self.answer]) as model:
            self.review()
            self.assertEqual(model.call_count, 3)  # 2 leader attempts, 1 independent validator.

    def test_validators_disagreeing_on_verdict_do_not_approve(self):
        dissent = copy.deepcopy(self.answer)
        dissent['jobs'][0]['verdict'] = 'INSUFFICIENT_EVIDENCE'
        with patch.object(gl.nondet, 'exec_prompt', side_effect=[self.answer, dissent]):
            with self.assertRaisesRegex(RuntimeError, 'VALIDATOR_DISAGREEMENT'): self.review()
        self.assertEqual(self.bundle()['workflows'][0]['reviewed_revision'], 0)

    def test_unicode_and_line_breaks_preserve_exact_source_bytes(self):
        for text in ['😀' * 1500, 'A.\r\nB.  C.', ('x\n' * 1000), 'Price: USD 19.\n\n“Data” is not training data.']:
            for quote in m.evidence_excerpts(text):
                self.assertIn(quote, text)
                self.assertLessEqual(len(quote.encode('utf-8')), 500)


if __name__ == '__main__': unittest.main()
