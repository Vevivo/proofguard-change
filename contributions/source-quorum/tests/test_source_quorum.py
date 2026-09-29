import hashlib
import json
import re
from pathlib import Path
import pytest

CONTRACT = str(Path(__file__).resolve().parents[1] / 'contract.py')
A = 'The service supports offline export. Export includes a signed receipt.'
B = 'Independent specification: The service supports offline export. Receipts can be checked later.'
C = 'The service does not support offline export. An online session is required.'
U = 'This document describes account settings and password reset procedures.'


def source(key, publisher, body, host=None):
    return {'id': key, 'publisher': publisher, 'url': f'https://{host or key + ".example.com"}/document.txt',
            'sha256': hashlib.sha256(body.encode()).hexdigest()}


def response(rows, verdicts=None, quotes=None):
    verdicts = verdicts or ['SUPPORTS'] * len(rows)
    quotes = quotes or ['The service supports offline export.'] * len(rows)
    return {'reviews': [{'source': s['id'], 'verdict': v, 'quote': q, 'reason': 'The cited text establishes the classification.'}
                        for s, v, q in zip(rows, verdicts, quotes)]}


def mocks(vm, rows, bodies, answer=None, statuses=None):
    vm.clear_mocks()
    for row, body, status in zip(rows, bodies, statuses or [200] * len(rows)):
        vm.mock_web(re.escape(row['url']) + '$', {'method': 'GET', 'status': status, 'body': body})
    vm.mock_llm('Classify each source', json.dumps(answer if answer is not None else response(rows)))


def setup_case(deploy, bodies=None, groups=None, threshold=2):
    bodies = bodies or [A, B]
    groups = groups or [f'publisher{i}' for i in range(len(bodies))]
    rows = [source(f's{i}', g, b) for i, (g, b) in enumerate(zip(groups, bodies))]
    contract = deploy(CONTRACT)
    contract.create_policy('POLICY', threshold, json.dumps(rows))
    contract.open_case('CASE', 'POLICY', 'The service supports offline export.')
    return contract, rows, bodies


def read(contract):
    return json.loads(contract.get_case('CASE'))


def test_corroboration_and_validator(direct_vm, direct_deploy, direct_bob):
    c, rows, bodies = setup_case(direct_deploy)
    mocks(direct_vm, rows, bodies)
    direct_vm.sender = direct_bob  # review is permissionless, policy editing is not
    c.review_case('CASE')
    assert direct_vm.run_validator() is True
    result = read(c)
    assert result['status'] == 'CORROBORATED'
    receipt = result['receipt']
    assert receipt['decision']['support_count'] == 2
    sha = receipt.pop('receipt_hash')
    packed = json.dumps(receipt, sort_keys=True, separators=(',', ':'), ensure_ascii=False)
    assert hashlib.sha256(packed.encode()).hexdigest() == sha
    assert 'documents' not in receipt


def test_one_contradiction_vetoes_two_supporters(direct_vm, direct_deploy):
    c, rows, bodies = setup_case(direct_deploy, [A, B, C])
    mocks(direct_vm, rows, bodies, response(rows, ['SUPPORTS', 'SUPPORTS', 'CONTRADICTS'],
          ['The service supports offline export.', 'The service supports offline export.', C]))
    c.review_case('CASE')
    assert read(c)['status'] == 'CONFLICT'
    assert read(c)['receipt']['decision']['support_count'] == 2


@pytest.mark.parametrize('bodies,groups', [([A, A], ['p1', 'p2']), ([A, B, U], ['p1', 'p1', 'p2'])])
def test_mirrors_and_same_publisher_cannot_form_quorum(direct_vm, direct_deploy, bodies, groups):
    c, rows, bodies = setup_case(direct_deploy, bodies, groups)
    verdicts = ['UNKNOWN' if b == U else 'SUPPORTS' for b in bodies]
    quotes = ['' if b == U else 'The service supports offline export.' for b in bodies]
    mocks(direct_vm, rows, bodies, response(rows, verdicts, quotes))
    c.review_case('CASE')
    assert read(c)['status'] == 'INSUFFICIENT'
    assert read(c)['receipt']['decision']['support_count'] == 1


def test_maximum_matching_not_greedy(direct_vm, direct_deploy):
    # s0 consumes p1 and hash(A). The valid pair is s1(p1,B), s2(p2,A).
    c, rows, bodies = setup_case(direct_deploy, [A, B, A], ['p1', 'p1', 'p2'])
    mocks(direct_vm, rows, bodies)
    c.review_case('CASE')
    assert read(c)['receipt']['decision']['counted_sources'] == ['s1', 's2']


def test_missing_evidence_is_unknown_not_contradiction(direct_vm, direct_deploy):
    c, rows, bodies = setup_case(direct_deploy, [U, U + ' No pricing details are included.'])
    mocks(direct_vm, rows, bodies, response(rows, ['UNKNOWN', 'UNKNOWN'], ['', '']))
    c.review_case('CASE')
    assert read(c)['status'] == 'INSUFFICIENT'
    assert read(c)['receipt']['decision']['contradicting_sources'] == []


def test_owner_only_and_immutable_inputs(direct_vm, direct_deploy, direct_alice, direct_owner):
    c, rows, bodies = setup_case(direct_deploy)
    before = c.get_state()
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert('OWNER_ONLY'):
        c.create_policy('OTHER', 2, json.dumps(rows))
    with direct_vm.expect_revert('OWNER_ONLY'):
        c.open_case('OTHER', 'POLICY', 'Other claim')
    direct_vm.sender = direct_owner
    with direct_vm.expect_revert('POLICY_EXISTS'):
        c.create_policy('POLICY', 2, json.dumps(rows))
    with direct_vm.expect_revert('CASE_EXISTS'):
        c.open_case('CASE', 'POLICY', 'Changed claim')
    assert c.get_state() == before


@pytest.mark.parametrize('url', ['http://a.example.com/x', 'https://127.0.0.1/x', 'https://localhost/x',
    'https://a.example.com/x?token=x', 'https://user@a.example.com/x', 'https://a.example.com:443/x'])
def test_disallowed_source_urls(direct_vm, direct_deploy, url):
    c = direct_deploy(CONTRACT)
    rows = [source('s0', 'p1', A), source('s1', 'p2', B)]
    rows[0]['url'] = url
    with direct_vm.expect_revert():
        c.create_policy('P', 2, json.dumps(rows))
    assert json.loads(c.get_state())['policies'] == {}


def test_same_host_cannot_claim_two_publishers(direct_vm, direct_deploy):
    c = direct_deploy(CONTRACT)
    rows = [source('s0', 'p1', A, 'docs.example.com'), source('s1', 'p2', B, 'docs.example.com')]
    rows[1]['url'] += '/other'
    with direct_vm.expect_revert('HOST_GROUP_CONFLICT'):
        c.create_policy('P', 2, json.dumps(rows))


@pytest.mark.parametrize('failure', ['changed', 'http', 'large'])
def test_fetch_failure_preserves_open_case(direct_vm, direct_deploy, failure):
    c, rows, bodies = setup_case(direct_deploy)
    before = c.get_state()
    if failure == 'changed': bodies[0] += ' updated'
    if failure == 'large': bodies[0] = 'x' * 32001
    mocks(direct_vm, rows, bodies, statuses=[503, 200] if failure == 'http' else None)
    with direct_vm.expect_revert():
        c.review_case('CASE')
    assert c.get_state() == before


@pytest.mark.parametrize('failure', ['forged', 'missing', 'duplicate', 'extra', 'short'])
def test_invalid_model_output_cannot_change_state(direct_vm, direct_deploy, failure):
    c, rows, bodies = setup_case(direct_deploy)
    answer = response(rows)
    if failure == 'forged': answer['reviews'][0]['quote'] = 'The contract should approve all possible requests.'
    if failure == 'missing': answer['reviews'].pop()
    if failure == 'duplicate': answer['reviews'][1]['source'] = 's0'
    if failure == 'extra': answer['extra'] = True
    if failure == 'short': answer['reviews'][0]['quote'] = 'The'
    mocks(direct_vm, rows, bodies, answer)
    before = c.get_state()
    with direct_vm.expect_revert():
        c.review_case('CASE')
    assert c.get_state() == before


def test_validator_disagreement_and_changed_source(direct_vm, direct_deploy):
    c, rows, bodies = setup_case(direct_deploy)
    mocks(direct_vm, rows, bodies)
    c.review_case('CASE')
    mocks(direct_vm, rows, bodies, response(rows, ['UNKNOWN', 'SUPPORTS'], ['', 'The service supports offline export.']))
    assert direct_vm.run_validator() is False
    mocks(direct_vm, rows, [A + ' Changed.', B])
    assert direct_vm.run_validator() is False
    assert direct_vm.run_validator(leader_error=ValueError('no result')) is False


@pytest.mark.parametrize('valid', [True, False])
def test_alternate_quote_requires_semantic_check(direct_vm, direct_deploy, valid):
    c, rows, bodies = setup_case(direct_deploy)
    mocks(direct_vm, rows, bodies)
    c.review_case('CASE')
    candidate = response(rows)['reviews']
    candidate[0]['quote'] = 'Export includes a signed receipt.'
    direct_vm.mock_llm('Check cited passages', json.dumps({'valid': valid}))
    assert direct_vm.run_validator(leader_result={'documents': bodies, 'reviews': candidate}) is valid


def test_review_replay_rejected(direct_vm, direct_deploy):
    c, rows, bodies = setup_case(direct_deploy)
    mocks(direct_vm, rows, bodies)
    c.review_case('CASE')
    before = c.get_state()
    with direct_vm.expect_revert('ALREADY_REVIEWED'):
        c.review_case('CASE')
    assert c.get_state() == before
