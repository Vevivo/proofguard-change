"""State and authorization tests with an explicit mocked GenVM/LLM.
Live-network evidence is produced separately by scripts/validate-change-network.mjs.
"""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

PUBLISHER, OWNER, ANALYST, EXECUTOR, STRANGER = ['0x' + c * 40 for c in '12345']
BEFORE = 'Express delivery on 10 September 2026. Standard delivery by 14 September 2026. Unit price EUR 240.'
AFTER = 'Express dispatch on 10 September 2026; arrival is not guaranteed. Standard delivery by 14 September 2026. Unit price EUR 240.'
class Returned:
    def __init__(self, value): self.calldata = value

def consensus(leader, validator):
    result = leader()
    if not validator(Returned(result)): raise RuntimeError('VALIDATOR_DISAGREEMENT')
    return result

gl = types.ModuleType('genlayer')
gl.gl = gl
gl.Contract = object
gl.storage = types.SimpleNamespace(TreeMap=dict)
gl.public = types.SimpleNamespace(write=lambda f:f, view=lambda f:f)
gl.message = types.SimpleNamespace(sender_address=types.SimpleNamespace(as_hex=PUBLISHER))
gl.vm = types.SimpleNamespace(UserError=RuntimeError, Return=Returned, run_nondet=consensus)
gl.nondet = types.SimpleNamespace(exec_prompt=lambda *_a, **_k:None)
spec = importlib.util.spec_from_file_location('network_contract', Path(__file__).parents[1] / 'contracts/genlayer/change_network.py')
m = importlib.util.module_from_spec(spec)
with patch.dict(sys.modules, {'genlayer':gl}): spec.loader.exec_module(m)

class NetworkTests(unittest.TestCase):
    def sender(self, who): gl.message.sender_address.as_hex = who
    def setUp(self):
        self.sender(PUBLISHER)
        self.c = m.ProofGuardChangeNetwork(); self.c.sources = {}; self.c.cases = {}
        self.c.publish_source('SRC-1', 'Supplier terms', BEFORE)
        self.c.approve_workflow_owner('SRC-1', OWNER); self.c.approve_workflow_owner('SRC-1', ANALYST)
        self.actions = [dict(id='urgent',label='Event order',condition='Express delivery on 10 September 2026 is required.',tool='prepare_purchase_order',target='event',payload=dict(unit_price=240,currency='EUR',quantity=10,shipping='express')),
                        dict(id='stock',label='Stock order',condition='Standard delivery by 14 September 2026 is required.',tool='prepare_purchase_order',target='warehouse',payload=dict(unit_price=240,currency='EUR',quantity=20,shipping='standard'))]
        self.sender(OWNER); self.c.register_workflow('WF-1','Procurement','SRC-1',1,EXECUTOR,json.dumps(self.actions))
        self.sender(ANALYST); self.c.register_workflow('WF-2','Pricing','SRC-1',1,EXECUTOR,json.dumps([dict(id='price',label='Price report',condition='Unit price is EUR 240.',tool='prepare_price_report',target='pricing',payload=dict(unit_price=240,currency='EUR'))]))
    def bundle(self): return json.loads(self.c.get_source_bundle('SRC-1'))
    def job(self, id='stock', wf='WF-1'): return next(a for a in json.loads(self.c.get_case(wf))['actions'] if a['id']==id)
    def review(self, urgent='NO_MATERIAL_CHANGE'):
        source=self.bundle()['source']; jobs=[]
        for case in self.bundle()['workflows']:
            for a in case['actions']:
                jobs.append(dict(workflow_id=case['id'],id=a['id'],verdict=urgent if a['id']=='urgent' else 'NO_MATERIAL_CHANGE',reason='Relevant source condition evaluated in English.',old_excerpt_id=m.evidence_excerpts(source['versions'][case['baseline_revision']-1]['text']).index('Unit price EUR 240.'),new_excerpt_id=m.evidence_excerpts(source['versions'][-1]['text']).index('Unit price EUR 240.')))
        self.sender(STRANGER)
        with patch.object(gl.nondet,'exec_prompt',return_value={'jobs':jobs}): self.c.review_source('SRC-1',source['revision'])
    def authorize(self,id='stock',rev=None,wf='WF-1',intent=None):
        self.sender(OWNER if wf=='WF-1' else ANALYST)
        return self.c.authorize_action(wf,id,rev or self.bundle()['source']['revision'],intent or self.job(id,wf)['intent_hash'])
    def execute(self,id='stock',rev=None,wf='WF-1',intent=None):
        self.sender(EXECUTOR)
        return self.c.execute_action(wf,id,rev or self.bundle()['source']['revision'],intent or self.job(id,wf)['intent_hash'])
    def revise(self,text=AFTER):
        self.sender(PUBLISHER); self.c.revise_source('SRC-1',self.bundle()['source']['revision'],text)
    def test_shared_revision_fences_both_independent_workflows(self):
        self.review(); self.authorize(); self.authorize('price',wf='WF-2'); self.revise()
        self.assertEqual(self.execute(rev=1)['code'],'STALE_SOURCE_REVISION')
        self.assertEqual(self.execute('price',rev=1,wf='WF-2')['code'],'STALE_SOURCE_REVISION')
        self.assertEqual(self.execute()['code'],'AWAITING_REVIEW')
        self.assertTrue(all(a['active_permit'] is None for w in self.bundle()['workflows'] for a in w['actions']))
    def test_selective_reauthorization_and_actual_output(self):
        self.review(); self.authorize(); self.revise(); self.review('MATERIAL_CHANGE')
        self.assertEqual(self.authorize('urgent')['code'],'MATERIAL_CHANGE')
        self.assertEqual(self.authorize()['code'],'READY')
        self.assertEqual(len(self.job()['permits']),2)
        self.assertEqual(self.execute()['code'],'READY')
        e=self.job()['execution']; output=json.loads(e['output_json'])
        self.assertEqual(output['total'],4800); self.assertEqual(output['kind'],'PURCHASE_ORDER_DRAFT')
        self.assertEqual(e['output_sha256'],hashlib.sha256(e['output_json'].encode()).hexdigest())
        self.assertEqual(e['external_order'],'NOT_SUBMITTED')
    def test_duplicate_execution_cannot_create_second_artifact(self):
        self.review(); self.authorize(); self.execute(); original=self.job()['execution']
        self.assertEqual(self.execute()['code'],'ALREADY_EXECUTED'); self.assertEqual(original,self.job()['execution'])
    def test_execution_requires_owner_permit(self):
        self.review(); self.assertEqual(self.execute()['code'],'AUTHORIZATION_REQUIRED')
    def test_intent_changes_are_rejected_for_authorization_and_execution(self):
        self.review(); self.assertEqual(self.authorize(intent='0'*64)['code'],'INTENT_MISMATCH')
        self.authorize(); self.assertEqual(self.execute(intent='0'*64)['code'],'INTENT_MISMATCH')
        self.assertIsNone(self.job()['execution'])
    def test_roles_cannot_impersonate_each_other(self):
        for who,fn,code in [(OWNER,lambda:self.c.revise_source('SRC-1',1,AFTER),'ONLY_SOURCE_PUBLISHER'),(PUBLISHER,lambda:self.c.authorize_action('WF-1','stock',1,self.job()['intent_hash']),'ONLY_WORKFLOW_OWNER'),(OWNER,lambda:self.c.execute_action('WF-1','stock',1,self.job()['intent_hash']),'ONLY_REGISTERED_EXECUTOR'),(OWNER,lambda:self.c.approve_workflow_owner('SRC-1',STRANGER),'ONLY_SOURCE_PUBLISHER')]:
            self.sender(who)
            with self.assertRaisesRegex(RuntimeError,code): fn()
    def test_strangers_cannot_fill_source_workflow_capacity(self):
        self.sender(STRANGER)
        with self.assertRaisesRegex(RuntimeError,'SOURCE_OWNER_APPROVAL_REQUIRED'): self.c.register_workflow('SPAM-1','Spam','SRC-1',1,STRANGER,json.dumps(self.actions))
    def test_insufficient_evidence_is_a_distinct_hold(self):
        self.review('INSUFFICIENT_EVIDENCE'); self.assertEqual(self.authorize('urgent')['code'],'INSUFFICIENT_EVIDENCE')
    def test_no_same_revision_verdict_reroll(self):
        self.review()
        with self.assertRaisesRegex(RuntimeError,'NO_UNREVIEWED_WORKFLOWS'): self.c.review_source('SRC-1',1)
    def test_quote_must_exist_in_the_correct_source(self):
        bundle=self.bundle()
        rows=[dict(workflow_id=w['id'],id=a['id'],verdict='NO_MATERIAL_CHANGE',reason='Evidence supported.',old_quote='invented evidence',new_quote='') for w in bundle['workflows'] for a in w['actions']]
        with self.assertRaisesRegex(RuntimeError,'QUOTE_NOT_IN_EVIDENCE'): self.c._validate_review({'jobs':rows},bundle['source'],bundle['workflows'])
    def test_validator_disagreement_rejects_review(self):
        with patch.object(gl.nondet,'exec_prompt',return_value={'jobs':[]}):
            with self.assertRaisesRegex(RuntimeError,'REVIEW_FORMAT_RETRY_EXHAUSTED'): self.c.review_source('SRC-1',1)
        self.assertEqual(self.bundle()['workflows'][0]['reviewed_revision'],0)
    def test_historical_output_is_not_reversed_by_later_revision(self):
        self.review(); self.authorize(); self.execute(); original=self.job()['execution']; self.revise()
        self.assertEqual(self.job()['execution'],original); self.assertEqual(self.job()['gate'],'ALREADY_EXECUTED')
    def test_price_report_is_a_real_supported_tool(self):
        self.review(); self.authorize('price',wf='WF-2'); self.execute('price',wf='WF-2')
        self.assertEqual(json.loads(self.job('price','WF-2')['execution']['output_json'])['kind'],'PRICE_REPORT')
    def test_job_payload_is_closed_and_typed(self):
        for value in [True,0,-1,2.5,'240']:
            actions=json.loads(json.dumps(self.actions)); actions[0]['payload']['unit_price']=value
            with self.assertRaisesRegex(RuntimeError,'INVALID_UNIT_PRICE'): self.c._actions(json.dumps(actions))
        self.actions[0]['payload']['callback']='https://attacker.invalid'
        with self.assertRaisesRegex(RuntimeError,'UNSUPPORTED_PAYLOAD_FIELDS'): self.c._actions(json.dumps(self.actions))
    def test_duplicate_or_out_of_order_revision_rejected(self):
        self.sender(PUBLISHER)
        with self.assertRaisesRegex(RuntimeError,'SOURCE_UNCHANGED'): self.c.revise_source('SRC-1',1,BEFORE)
        with self.assertRaisesRegex(RuntimeError,'STALE_SOURCE_REVISION'): self.c.revise_source('SRC-1',0,AFTER)
    def test_read_does_not_mutate_stored_workflow(self):
        old=self.c.cases['WF-1']; self.bundle(); self.assertEqual(old,self.c.cases['WF-1'])

if __name__=='__main__': unittest.main()
