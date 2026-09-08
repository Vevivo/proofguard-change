import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {readableNetworkAudit} from '../genlayer/change-network-report.mjs';
const fixture=JSON.parse(fs.readFileSync(new URL('../config/change-network-walkthrough.json',import.meta.url)));
test('simulated evidence is clearly labeled and untrusted text stays escaped',()=>{const b=structuredClone(fixture.material.stages[3]);b.source.title='<script>alert(1)</script>';const report=readableNetworkAudit({readState:'SIMULATED',bundle:b,verification:[],network:'LOCAL SIMULATION'});assert.match(report,/SIMULATED WALKTHROUGH — NOT NETWORK EVIDENCE/);assert.ok(!report.includes('<script>'));assert.match(report,/&lt;script&gt;/);assert.match(report,/PURCHASE_ORDER_DRAFT/);assert.match(report,/PRICE_REPORT/);assert.match(report,/Superseded/);assert.match(report,/Consumed/);});
