"""Generate explicitly simulated UI snapshots from the real contract state machine.
The GenVM and review responses are mocked. This is not network validation.
"""
import copy
import importlib.util
import json
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).parents[1]
spec=importlib.util.spec_from_file_location('network_tests',ROOT/'tests/change_network_unit.py')
t=importlib.util.module_from_spec(spec); spec.loader.exec_module(t)
scenarios={
 'material': ('Delivery becomes dispatch',t.AFTER,'MATERIAL_CHANGE','Arrival on 10 September is no longer guaranteed. Dispatch does not establish arrival.'),
 'wording': ('Different words, same promise','Express arrival on 10 September 2026. Standard delivery by 14 September 2026. Unit price EUR 240.','NO_MATERIAL_CHANGE','Arrival on 10 September remains supported; only the wording changed.'),
 'missing': ('The key clause disappears','Express service is available; scheduling details are pending confirmation. Standard delivery by 14 September 2026. Unit price EUR 240.','INSUFFICIENT_EVIDENCE','The revised source gives no firm express arrival or dispatch date. More evidence is needed.'),
}
result={}
for key,(title,after,verdict,reason) in scenarios.items():
 test=t.NetworkTests(); test.setUp(); c=test.c
 # Improve the human-facing names while preserving exact contract-generated state.
 source=c._source('SRC-1');source['title']='Northline supplier terms'; c._save_source(source)
 for wid,name in [('WF-1','Supply operations'),('WF-2','Market intelligence')]:
  w=c._case(wid); w['title']=name;c._save_case(w)
 def review(v,why,original=False):
  rows=[]
  for w in test.bundle()['workflows']:
   for a in w['actions']:
    urgent=a['id']=='urgent'; stock=a['id']=='stock'
    old='Express delivery on 10 September 2026.' if urgent else 'Standard delivery by 14 September 2026.' if stock else 'Unit price EUR 240.'
    new=(old if original else after.split(' Standard')[0]) if urgent else old
    rows.append(dict(workflow_id=w['id'],id=a['id'],verdict=v if urgent else 'NO_MATERIAL_CHANGE',reason=why if urgent else 'Standard delivery by 14 September and the EUR 240 unit price remain supported.' if stock else 'The unit price remains EUR 240; the delivery change does not affect the price report.',old_quote=old,new_quote=new))
  test.sender(t.STRANGER)
  with patch.object(t.gl.nondet,'exec_prompt',return_value={'jobs':rows}): c.review_source('SRC-1',test.bundle()['source']['revision'])
 review('NO_MATERIAL_CHANGE','The source supports express delivery on 10 September.',True)
 for wid,jobs in [('WF-1',['urgent','stock']),('WF-2',['price'])]:
  for jid in jobs: test.authorize(jid,wf=wid)
 stages=[test.bundle()]
 test.revise(after); stages.append(test.bundle())
 review(verdict,reason); stages.append(test.bundle())
 for wid,jobs in [('WF-1',['urgent','stock']),('WF-2',['price'])]:
  for jid in jobs:
   if test.job(jid,wid)['gate']=='READY': test.authorize(jid,wf=wid);test.execute(jid,wf=wid)
 stages.append(test.bundle())
 result[key]=dict(title=title,mode='SIMULATED_CONTRACT_WALKTHROUGH',stages=stages)
(ROOT/'config/change-network-walkthrough.json').write_text(json.dumps(result,indent=2)+'\n')
print('Generated three simulated scenarios, four contract-state snapshots each.')
