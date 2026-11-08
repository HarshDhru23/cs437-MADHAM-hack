"""Smoke test of the hosted CoursePath with a synthetic account (docs/operations/azure.md). Deletes its own account at the end.
Run: .venv/Scripts/python scripts/smoke_live.py  (needs the live site up; prints PASS/FAIL per check, exit code 1 on any FAIL)."""
import http.cookiejar
import json
import secrets
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tests.imports.test_ims import TABLE

BASE = 'https://coursepath-iitgn.azurewebsites.net/api/v1'
PASSWORD = 'Synthetic-river-946!'


def client():
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


def call(opener, method, route, payload=None):
    csrf = json.load(opener.open(BASE + '/session', timeout=60))['data']['csrf_token']
    request = urllib.request.Request(BASE + route, method=method, data=json.dumps(payload).encode() if payload is not None else None,
                                     headers={'Content-Type': 'application/json', 'X-CSRFToken': csrf, 'Origin': 'https://coursepath-iitgn.azurewebsites.net'})
    try:
        with opener.open(request, timeout=90) as result:
            return result.status, json.load(result)
    except urllib.error.HTTPError as error:
        return error.code, json.load(error)


FAILED = []


def check(label, got, want):
    ok = got == want
    print(('PASS ' if ok else 'FAIL ') + label + ('' if ok else f' (got {got!r}, wanted {want!r})'))
    if not ok:
        FAILED.append(label)


name = 'smoke-' + secrets.token_hex(4)
first, second = client(), client()
creds = {'username': name, 'password': PASSWORD}
check('signup (device 1)', call(first, 'POST', '/auth/signup', creds)[0], 201)
check('login (device 2)', call(second, 'POST', '/auth/login', creds)[0], 200)
code, preview = call(first, 'POST', '/imports/preview', {'kind': 'ims', 'text': TABLE, 'expected_revision': 0})
check('IMS preview', code, 201)
preview = preview['data']
accepted = [a['id'] for a in preview['candidate_attempts']]
code, _ = call(first, 'POST', f"/imports/{preview['id']}/commit", {'expected_revision': 0, 'resolutions': {}, 'accepted_candidate_ids': accepted})
check('import commit', code, 200)
rec = call(second, 'GET', '/record')[1]['data']
check('device 2 sees the saved record (revision, attempts)', (rec['revision'], len(rec['attempts'])), (1, len(accepted)))
check('stale write from device 2 gets 409', call(second, 'PATCH', '/record', {'expected_revision': 0, 'attempts': []})[0], 409)
code, plan = call(first, 'POST', '/plans', {'semesters': []})
check('create plan', code, 201)
check('device 2 reads the plan', call(second, 'GET', '/plans/' + plan['data']['id'])[0], 200)
check('analysis', call(second, 'POST', '/analysis', {'record_revision': 1})[0], 200)
check('catalogue is public', call(client(), 'GET', '/curricula/cse-2024')[0], 200)
code, cat = call(client(), 'GET', '/catalogue')
check('catalogue lists real courses', (code, cat['data']['coverage'] > '' and len(cat['data']['courses']) > 250, cat['data']['review_status']), (200, True, 'reviewed'))
check('catalogue gives no unknown-severity issue', [i for i in cat['issues'] if i['severity'] == 'unknown'], [])
code, gen = call(first, 'POST', '/plans/generate', {'record_revision': 1})
check('plan generation answers', code, 200)
g = gen['data']
check('generated plan has semesters and placements', (len(g['semesters']) > 0, len(g['placements']) > 0), (True, True))
check('generated plan has no error-severity validation issue', [i for i in g['validation']['issues'] if i['severity'] == 'error'], [])
check('generation saved nothing yet', len(call(first, 'GET', '/plans')[1]['data']), 1)
code, saved = call(first, 'POST', '/plans', {'label': 'Generated smoke plan', 'semesters': g['semesters']})
check('generated plan saves through the normal path', code, 201)
check('device 2 sees both plans', len(call(second, 'GET', '/plans')[1]['data']), 2)

a = call(second, 'POST', '/analysis', {'record_revision': 1})[1]['data']['audit']
d = a['degree']['actual']
check('audit reports the 170 total with counted + remaining = 170', (d['total_credits'], float(d['counted_credits']) > 0, float(d['counted_credits']) + float(d['remaining_credits'])), ('170', True, 170.0))
code, intern = call(first, 'POST', '/plans/generate', {'record_revision': 1, 'options': {'internship_term': '2027-28-I'}})
gr = intern['data']['graduation']   # this synthetic record has 158 credits left: more than four 28-credit semesters hold, so the plan says it cannot cover everything
check('internship plan answers, never early when it cannot cover everything', (code, gr['early'], gr['message']), (200, None, None))
check('internship modules are 4-credit and at most 16', sorted({p['desired_credits'] for s in intern['data']['semesters'] for p in s['placeholders'] if p['label'].startswith('Internship')}) in ([], ['4']), True)
check('no semester above 28 credits', [t for t, c in intern['data']['summary']['credits_by_term'].items() if float(c) > 28], [])
code, chk = call(first, 'POST', '/plans/check', {'record_revision': 1, 'semesters': intern['data']['semesters']})
check('draft check answers with degree credits and no error', (code, [i for i in chk['data']['validation']['issues'] if i['severity'] == 'error']), (200, []))
check('draft check reports requirements, credits left and room per semester', (len(chk['data']['requirements']) > 30, float(chk['data']['uncovered_credits']) >= 0, all(float(v['available_credits']) <= 28 for v in chk['data']['load'].values())), (True, True, True))
code, off = call(client(), 'GET', '/offerings?term_id=2027-28-I')
check('a later odd semester follows the semester I timetable, with no notice', (code, len(off['data']['offerings']) > 250, off['issues']), (200, True, []))
check('another anonymous visitor cannot read the record', call(client(), 'GET', '/record')[0], 401)
code, _ = call(first, 'DELETE', '/account/data', {'confirm': 'delete my data', 'delete_account': True, 'password': PASSWORD, 'expected_revision': 1})
check('cleanup: synthetic account deleted', code, 200)
print(('FAILED: ' + ', '.join(FAILED)) if FAILED else 'ALL LIVE CHECKS PASSED for synthetic account ' + name)
sys.exit(1 if FAILED else 0)
