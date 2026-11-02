import hashlib
import json
from pathlib import Path
from datetime import timedelta
from functools import wraps
from django.contrib.auth import authenticate, login, logout, update_session_auth_hash
from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError, RequestDataTooBig
from django.db import IntegrityError, transaction
from django.db.models import F
from django.http import JsonResponse, Http404
from django.middleware.csrf import get_token
from django.shortcuts import get_object_or_404
from django.utils import timezone
from coursepath.issues import issue
from coursepath.serialization import plain
from server.records.models import AcademicRecord, AcademicPlan, LoginThrottle, ImportPreview, Scenario, ApprovalEvidence
from coursepath.validation import plan_payload, current_enrolment, scenario_payload
from server.records.services import record_data, replace_record, expected_revision, RevisionConflict, update_plan, plan_data, corrected_record_rows, scenario_data, update_scenario, validate_attempts


def response(data=None, issues=(), status=200):
    result = JsonResponse({'data': plain(data), 'issues': list(issues), 'schema_version': '1'}, status=status)
    result['Cache-Control'] = 'no-store'
    return result


def endpoint(methods, public=False):
    def decorate(fn):
        @wraps(fn)
        def wrapped(request, *args, **kwargs):
            if request.method not in methods:
                return response(issues=[issue('METHOD_NOT_ALLOWED', 'Unsupported HTTP method.', 'error')], status=405)
            if not public and not request.user.is_authenticated:
                return response(issues=[issue('AUTHENTICATION_REQUIRED', 'Sign in to continue.', 'error')], status=401)
            try:
                if request.content_type == 'application/json':
                    request.payload = json.loads(request.body or b'{}')
                    if not isinstance(request.payload, dict):
                        raise ValueError('Expected a JSON object')
                else:
                    request.payload = {}
                return fn(request, *args, **kwargs)
            except RevisionConflict as exc:
                return response({'current_revision': exc.current_revision, 'action': 'reload_compare'},
                                [issue('REVISION_CONFLICT', 'Reload and compare the newer saved revision.', 'error')], 409)
            except Http404:
                return response(issues=[issue('NOT_FOUND', 'Resource not found.', 'error')], status=404)
            except RequestDataTooBig:
                return response(issues=[issue('INPUT_LIMIT', 'Input exceeds the upload limit.', 'error')], status=413)
            except (ValueError, TypeError, KeyError, ValidationError) as exc:
                return response(issues=[issue('INVALID_INPUT', 'Invalid request fields; review the documented schema.', 'error')], status=400)
        return wrapped
    return decorate


def csrf_failure(request, reason=''):
    return response(issues=[issue('CSRF_REQUIRED', 'Refresh the session and send the CSRF token.', 'error')], status=403)


@endpoint({'GET'}, public=True)
def session(request):
    return response({'csrf_token': get_token(request), 'user': {'id': str(request.user.pk), 'username': request.user.username} if request.user.is_authenticated else None})


@transaction.atomic
def throttled(request):
    key = hashlib.sha256(request.META.get('REMOTE_ADDR', '').encode()).hexdigest()
    now = timezone.now()
    entry, _ = LoginThrottle.objects.get_or_create(key=key, defaults={'window_start': now})
    LoginThrottle.objects.filter(pk=key, window_start__lt=now - timedelta(minutes=15)).update(attempts=0, window_start=now)
    LoginThrottle.objects.filter(pk=key).update(attempts=F('attempts') + 1)
    entry.refresh_from_db()
    return entry.attempts > 10


@endpoint({'POST'}, public=True)
def auth(request, action):
    payload = request.payload
    if action in {'signup', 'login'}:
        if throttled(request):
            return response(issues=[issue('AUTH_THROTTLED', 'Too many attempts. Retry after 15 minutes.', 'error')], status=429)
        username, password = payload.get('username'), payload.get('password')
        if not isinstance(username, str) or not 1 <= len(username) <= 150 or not isinstance(password, str) or len(password) > 1024:
            raise ValueError('Invalid credentials')
        if action == 'signup':
            user = User(username=username)
            user.full_clean(exclude=['password'])
            validate_password(password, user)
            try:
                with transaction.atomic():
                    user = User.objects.create_user(username=username, password=password)
                    AcademicRecord.objects.create(owner=user)
            except IntegrityError:
                raise ValueError('Account unavailable')
            login(request, user)
            return response({'id': str(user.pk), 'username': user.username}, status=201)
        user = authenticate(request, username=username, password=password)
        if user is None:
            return response(issues=[issue('INVALID_CREDENTIALS', 'Sign-in details were not accepted.', 'error')], status=401)
        login(request, user)
        return response({'id': str(user.pk), 'username': user.username})
    if not request.user.is_authenticated:
        return response(status=401)
    if action == 'logout':
        logout(request)
        return response()
    if action == 'password':
        if not request.user.check_password(payload.get('old_password', '')):
            raise ValueError('Incorrect current password')
        password = payload.get('new_password')
        if not isinstance(password, str) or len(password) > 1024:
            raise ValueError('Invalid password')
        validate_password(password, request.user)
        request.user.set_password(password)
        request.user.save(update_fields=['password'])
        update_session_auth_hash(request, request.user)
        return response()
    raise Http404


@endpoint({'GET', 'PATCH'})
def record(request):
    stored = get_object_or_404(AcademicRecord, owner=request.user)
    if request.method == 'GET':
        return response(record_data(stored))
    payload = request.payload
    if set(payload) - {'expected_revision', 'attempts', 'current_enrolment', 'profile', 'correction_justifications'}:
        raise ValueError('Unknown/privileged record field')
    if 'profile' in payload and payload['profile'] != stored.profile:
        raise ValueError('Curriculum changes require review')
    enrolment = payload.get('current_enrolment')
    if enrolment is not None:
        enrolment = current_enrolment(enrolment)
    rows = corrected_record_rows(stored, payload.get('attempts', record_data(stored)['attempts']), payload.get('correction_justifications', {}))
    return response(replace_record(stored, expected_revision(payload), rows, enrolment))


def validated_plan(payload):
    return plan_payload(payload)


@endpoint({'GET', 'POST'})
def plans(request):
    if request.method == 'GET':
        return response([plan_data(p) for p in AcademicPlan.objects.filter(owner=request.user).order_by('id')])
    stored = AcademicPlan.objects.create(owner=request.user, payload=validated_plan(request.payload))
    return response({**plan_data(stored), 'validation': _validate_owned_plan(request.user, stored)}, status=201)


@endpoint({'GET', 'PATCH', 'DELETE'})
def plan_detail(request, plan_id):
    stored = get_object_or_404(AcademicPlan, pk=plan_id, owner=request.user)
    if request.method == 'GET':
        return response(plan_data(stored))
    expected = expected_revision(request.payload)
    if request.method == 'DELETE':
        if not AcademicPlan.objects.filter(pk=stored.pk, owner=request.user, revision=expected).delete()[0]:
            raise RevisionConflict(AcademicPlan.objects.get(pk=stored.pk, owner=request.user).revision)
        return response()
    result = update_plan(stored, expected, validated_plan(request.payload))
    return response({**result, 'validation': _validate_owned_plan(request.user, stored)})


@endpoint({'POST'})
def import_preview(request):
    from coursepath.imports.ims import parse_ims
    from coursepath.imports.pdf_transcript import parse_pdf
    from coursepath.imports.reconcile import reconcile_import
    stored = get_object_or_404(AcademicRecord, owner=request.user)
    if request.content_type == 'multipart/form-data':
        revision = int(request.POST.get('expected_revision', '-1'))
        upload = request.FILES.get('file')
        if upload is None:
            raise ValueError('Missing PDF')
        if upload.size > 10 * 1024 * 1024:
            return response(issues=[issue('INPUT_LIMIT', 'PDF exceeds 10 MB.', 'error')], status=413)
        try:
            parsed = parse_pdf(upload.read(10 * 1024 * 1024 + 1), 'pdf-v1')
        finally:
            upload.close()
    else:
        revision = expected_revision(request.payload)
        if request.payload.get('kind') != 'ims':
            raise ValueError('Expected IMS input')
        parsed = parse_ims(request.payload.get('text'), 'ims-v1')
    if revision != stored.revision:
        raise RevisionConflict(stored.revision)
    if not parsed['candidate_attempts']:
        return response(parsed, parsed['issues'], 422)
    proposed = reconcile_import(record_data(stored), parsed, {})
    preview = ImportPreview.objects.create(owner=request.user, record=stored, base_record_revision=stored.revision,
                                           payload=parsed, expires_at=timezone.now() + timedelta(hours=1))
    data = {k: v for k, v in parsed.items() if k != 'issues'}
    data.update({'id': str(preview.pk), 'base_record_revision': stored.revision, 'expires_at': preview.expires_at.isoformat(), 'diff': proposed['diff']})
    return response(data, parsed['issues'] + proposed['issues'], 201)


@endpoint({'POST'})
@transaction.atomic
def import_commit(request, preview_id):
    from coursepath.imports.reconcile import reconcile_import
    preview = get_object_or_404(ImportPreview, pk=preview_id, owner=request.user)
    stored = get_object_or_404(AcademicRecord, pk=preview.record_id, owner=request.user)
    expected = expected_revision(request.payload)
    if preview.committed_at or expected != stored.revision or preview.base_record_revision != expected:
        raise RevisionConflict(stored.revision)
    if preview.expires_at <= timezone.now():
        return response(issues=[issue('PREVIEW_EXPIRED', 'Create a new preview.', 'error')], status=422)
    if preview.payload.get('kind') == 'backup':
        return _restore_backup(request, preview, stored, expected)
    selected = request.payload.get('accepted_candidate_ids')
    candidates = preview.payload['candidate_attempts']
    if not isinstance(selected, list) or len(set(selected)) != len(selected) or set(selected) - {a['id'] for a in candidates}:
        raise ValueError('Invalid candidate selection')
    resolutions = request.payload.get('resolutions', {})
    if not isinstance(resolutions, dict) or set(resolutions) - ({a['id'] for a in candidates} | {'_totals', '_unparsed'}):
        raise ValueError('Invalid resolution targets')
    parsed = {**preview.payload, 'candidate_attempts': [a for a in candidates if a['id'] in selected]}
    result = reconcile_import(record_data(stored), parsed, resolutions)
    if any(i['severity'] == 'error' for i in result['issues']):
        return response({'diff': result['diff']}, result['issues'], 422)
    reported = list(stored.reported_controls)
    if preview.payload.get('reported_controls'):
        reported.append({'preview_id': str(preview.pk), 'record_revision_at_import': expected + 1, 'controls': preview.payload['reported_controls'],
                         'source_refs': list({r['id'] for a in candidates for r in a['source_refs']})})
    accepted = replace_record(stored, expected, result['record']['attempts'], reported_controls=reported)
    preview.committed_at = timezone.now()
    preview.save(update_fields=['committed_at'])
    return response(accepted, result['issues'])


def _curriculum_for(record=None):
    from coursepath.rules.loader import load_curriculum, validate_curriculum
    from server.records.models import RuleSnapshot
    version = record.profile['curriculum_version'] if record else 'cse-2024-draft-v1'
    stored = RuleSnapshot.objects.filter(pk=version).first()
    return validate_curriculum(stored.payload) if stored else load_curriculum()


def _offering_snapshots():
    """Latest reviewed snapshot per term, else the latest draft."""
    from server.records.models import OfferingSnapshot
    latest = {}
    for stored in OfferingSnapshot.objects.order_by('term_id', '-reviewed', '-loaded_at'):
        latest.setdefault(stored.term_id, stored.payload)
    return latest


def _validate_owned_plan(owner, plan):
    from coursepath.semester_plan import validate_plan
    record = AcademicRecord.objects.get(owner=owner)
    return validate_plan({'attempts': record_data(record)['attempts'], 'catalogue': {}, 'standing': record.profile.get('standing', 'unknown')},
                         plan.payload, list(_offering_snapshots().values()))


@endpoint({'GET'}, public=True)
def offerings(request):
    from coursepath.models import validate_term_id
    term = validate_term_id(request.GET.get('term_id', ''))
    snapshot = _offering_snapshots().get(term)
    if snapshot is None:
        return response({'id': None, 'term_id': term, 'coverage': 'unknown', 'review_status': None, 'offerings': [], 'slot_map': {}, 'source_refs': []},
                        [issue('OFFERING_UNKNOWN', f'No timetable snapshot is loaded for {term}; availability and clashes are unknown.')])
    gaps = []
    if snapshot['review_status'] != 'reviewed':
        gaps.append(issue('OFFERING_SNAPSHOT_UNREVIEWED', 'This timetable snapshot has not been reviewed; offerings are tentative.', 'warning'))
    if snapshot['coverage'] != 'complete':
        gaps.append(issue('OFFERING_COVERAGE_PARTIAL', 'Coverage is not complete: a course missing here may still be offered.'))
    return response(snapshot, gaps)


@endpoint({'GET'}, public=True)
def curriculum(request):
    data = _curriculum_for()
    gaps = [issue('SOURCE_MISSING', 'Only a draft based on committed planning notes is available; official rules need review.', sources=['committed-roadmap'])] if data['review_status'] != 'reviewed' else []
    return response(data, gaps)


@endpoint({'GET'}, public=True)
def catalogue(request):
    return response({'courses': [], 'coverage': 'unknown', 'review_status': 'draft'},
                    [issue('CATALOGUE_MISSING', 'No reviewed catalogue snapshot is committed. Course/basket/prerequisite searches cannot be verified.')])


@endpoint({'POST'})
def analysis(request):
    from coursepath.degree_audit import evaluate_audit
    from coursepath.performance import calculate_performance
    stored = get_object_or_404(AcademicRecord, owner=request.user)
    if request.payload.get('record_revision') != stored.revision:
        raise RevisionConflict(stored.revision)
    plan = None
    if request.payload.get('plan_id'):
        plan = get_object_or_404(AcademicPlan, pk=request.payload['plan_id'], owner=request.user)
        if request.payload.get('plan_revision') != plan.revision:
            raise RevisionConflict(plan.revision)
    awards = request.payload.get('award_ids', [])
    if not isinstance(awards, list) or any(a not in {'cse_honours', 'ai_minor'} for a in awards):
        raise ValueError('Unsupported award')
    record = record_data(stored)
    rules = _curriculum_for(stored)
    audit = evaluate_audit(rules, {}, record, plan.payload if plan else None, awards=awards)
    performance = calculate_performance(record['attempts'], _grading_policy())
    performance['source_reported_controls'] = stored.reported_controls
    data = {'audit': audit, 'performance': performance, 'validation': _validate_owned_plan(request.user, plan) if plan else None,
            'record_revision': stored.revision, 'plan_revision': plan.revision if plan else None, 'rule_version': rules['version']}
    return response(data, audit['issues'] + performance['issues'])


@endpoint({'POST'})
def plan_validate(request, plan_id):
    plan = get_object_or_404(AcademicPlan, pk=plan_id, owner=request.user)
    record = AcademicRecord.objects.get(owner=request.user)
    if request.payload.get('plan_revision') != plan.revision:
        raise RevisionConflict(plan.revision)
    if request.payload.get('record_revision') != record.revision:
        raise RevisionConflict(record.revision)
    return response(_validate_owned_plan(request.user, plan))


def _grading_policy():
    return json.loads((Path(__file__).resolve().parents[2] / 'data/grading/reported-v1.json').read_text())


def _engine_context(user, stored):
    """Server-side inputs for scenario evaluation. Approvals are staff-verified evidence only; no calendar is committed (GAP-03)."""
    approvals = [{'id': str(a.pk), 'status': a.status, 'covered_entities': a.covered_entities}
                 for a in ApprovalEvidence.objects.filter(owner=user, status='verified')]
    return {'curriculum': _curriculum_for(stored), 'catalogue': {}, 'grading_policy': _grading_policy(), 'approvals': approvals,
            'standing': stored.profile.get('standing', 'unknown'), 'advisor_cap': stored.profile.get('advisor_cap'),
            'offering_snapshots': list(_offering_snapshots().values()), 'calendar': None}


def _baseline(stored, plan):
    return {'record': record_data(stored), 'plan': {'id': str(plan.pk), 'revision': plan.revision, **plan.payload},
            'rule_version': _curriculum_for(stored)['version']}


def _checked_changes(plan, payload):
    from coursepath.scenarios import apply_changes
    apply_changes({'semesters': plan.payload.get('semesters', [])}, payload.get('changes', []))
    return payload


@endpoint({'GET', 'POST'})
def scenarios(request):
    if request.method == 'GET':
        return response({'scenarios': [scenario_data(s) for s in Scenario.objects.filter(owner=request.user).order_by('id')]})
    payload = scenario_payload(request.payload)
    plan = get_object_or_404(AcademicPlan, pk=request.payload.get('plan_id'), owner=request.user)
    stored = get_object_or_404(AcademicRecord, owner=request.user)
    payload = _checked_changes(plan, {k: v for k, v in payload.items() if k in {'label', 'changes', 'internship', 'award_ids'}})
    scenario = Scenario.objects.create(owner=request.user, plan=plan, baseline_record_revision=stored.revision, baseline_plan_revision=plan.revision,
                                       rule_version=_curriculum_for(stored)['version'], payload=payload)
    return response(scenario_data(scenario), status=201)


@endpoint({'GET', 'PATCH', 'DELETE'})
def scenario_detail(request, scenario_id):
    scenario = get_object_or_404(Scenario, pk=scenario_id, owner=request.user)
    if request.method == 'GET':
        return response(scenario_data(scenario))
    expected = expected_revision(request.payload)
    if request.method == 'DELETE':
        if not Scenario.objects.filter(pk=scenario.pk, owner=request.user, revision=expected).delete()[0]:
            raise RevisionConflict(Scenario.objects.get(pk=scenario.pk).revision)
        return response()
    changes = scenario_payload(request.payload)
    if 'plan_id' in request.payload and request.payload['plan_id'] != str(scenario.plan_id):
        raise ValueError('A scenario keeps its plan; create a new scenario instead')
    payload = _checked_changes(scenario.plan, {**scenario.payload, **{k: v for k, v in changes.items() if k in {'label', 'changes', 'internship', 'award_ids'}}})
    baseline = None
    if request.payload.get('rebase') is True:
        stored = get_object_or_404(AcademicRecord, owner=request.user)
        baseline = {'baseline_record_revision': stored.revision, 'baseline_plan_revision': scenario.plan.revision, 'rule_version': _curriculum_for(stored)['version']}
    return response(update_scenario(scenario, expected, payload, baseline))


@endpoint({'POST'})
def scenarios_compare(request):
    from coursepath.internships import compare_internships
    from coursepath.scenarios import compare_scenario
    ids = request.payload.get('scenario_ids')
    if not isinstance(ids, list) or not 1 <= len(ids) <= 6 or len(set(ids)) != len(ids):
        raise ValueError('Compare one to six distinct scenarios')
    chosen = [get_object_or_404(Scenario, pk=i, owner=request.user) for i in ids]
    if len({s.plan_id for s in chosen}) != 1:
        raise ValueError('Compared scenarios must share one baseline plan')
    stored = get_object_or_404(AcademicRecord, owner=request.user)
    context, baseline = _engine_context(request.user, stored), _baseline(stored, chosen[0].plan)
    comparisons = [compare_scenario(context, baseline, scenario_data(s)) for s in chosen]
    current = [s for s, c in zip(chosen, comparisons) if not c['stale'] and s.payload.get('internship')]
    planning = {'attempts': baseline['record']['attempts'], 'current_enrolment': baseline['record']['current_enrolment'], 'catalogue': context['catalogue'],
                'approvals': context['approvals'], 'record_revision': stored.revision}
    table = compare_internships(planning, baseline['plan'], context['calendar'], [s.payload['internship'] for s in current])
    cases = [{**case, 'scenario_id': str(s.pk)} for s, case in zip(current, table['cases'])]
    issues, seen = [], set()
    for found in [i for c in comparisons for i in c['issues'] + (c['scenario']['issues'] if c['scenario'] else [])] + [i for c in cases for i in c['issues']]:
        key = (found['code'], tuple(found['entity_refs']))
        if key not in seen:
            seen.add(key)
            issues.append(found)
    return response({'comparisons': comparisons, 'internship_cases': cases}, issues)


@endpoint({'POST'})
@transaction.atomic
def scenario_apply(request, scenario_id):
    from coursepath.scenarios import plan_edits
    scenario = get_object_or_404(Scenario.objects.select_for_update(), pk=scenario_id, owner=request.user)
    plan = AcademicPlan.objects.select_for_update().get(pk=scenario.plan_id, owner=request.user)
    stored = get_object_or_404(AcademicRecord, owner=request.user)
    expected_scenario, expected = request.payload.get('expected_scenario_revision'), request.payload.get('expected_plan_revision')
    if any(type(value) is not int or value < 0 for value in (expected_scenario, expected)):
        raise ValueError('expected_scenario_revision and expected_plan_revision must be nonnegative integers')
    if expected_scenario != scenario.revision:
        raise RevisionConflict(scenario.revision)  # the scenario changed after the client compared it
    if expected != plan.revision:
        raise RevisionConflict(plan.revision)
    current = (stored.revision, plan.revision, _curriculum_for(stored)['version'])
    if current != (scenario.baseline_record_revision, scenario.baseline_plan_revision, scenario.rule_version):
        stale = {'action': 'rebase', 'scenario_revision': scenario.revision, 'current_record_revision': current[0], 'current_plan_revision': current[1],
                 'current_rule_version': current[2], 'baseline_record_revision': scenario.baseline_record_revision,
                 'baseline_plan_revision': scenario.baseline_plan_revision, 'rule_version': scenario.rule_version}
        return response(stale, [issue('SCENARIO_STALE', 'The saved record, plan or rules changed after this scenario was created.', 'error', [str(scenario.pk)],
                                      action='Rebase the scenario on the current record and plan, then compare again.')], 409)
    edited, skipped = plan_edits({'id': str(plan.pk), 'revision': plan.revision, **plan.payload}, scenario_data(scenario))
    result = update_plan(plan, expected, plan_payload(edited))
    return response({'plan': {**result, 'validation': _validate_owned_plan(request.user, plan)}, 'not_applied': skipped})


BACKUP_KIND = 'coursepath-backup'


@endpoint({'GET'})
def export(request):
    if request.GET.get('kind', 'json') != 'json':
        raise ValueError('Only kind=json is exported; print the report from the analysis view')
    stored = get_object_or_404(AcademicRecord, owner=request.user)
    rules, policy = _curriculum_for(stored), _grading_policy()
    data = {'kind': BACKUP_KIND, 'backup_version': '1', 'exported_at': timezone.now().isoformat(), 'account': {'username': request.user.username},
            'rule_version': rules['version'], 'rule_review_status': rules['review_status'], 'sources': rules['sources'],
            'missing_sources': rules.get('missing_sources', []), 'grading_policy': {'id': policy['id'], 'review_status': policy['review_status']},
            'record': record_data(stored), 'plans': [plan_data(p) for p in AcademicPlan.objects.filter(owner=request.user).order_by('id')],
            'scenarios': [scenario_data(s) for s in Scenario.objects.filter(owner=request.user).order_by('id')]}
    gaps = [] if rules['review_status'] == 'reviewed' else [issue('SOURCE_MISSING', 'This backup was made against draft rules; its audit is not an official verdict.', sources=[s['id'] for s in rules['sources']])]
    result = response(data, gaps)
    result['Content-Disposition'] = 'attachment; filename="coursepath-backup.json"'
    return result


@endpoint({'POST'})
def backup_preview(request):
    """Validate a JSON backup as a candidate restore. Nothing changes until /imports/{id}/commit with confirm=true."""
    stored = get_object_or_404(AcademicRecord, owner=request.user)
    revision = expected_revision(request.payload)
    backup = request.payload.get('backup')
    if isinstance(backup, dict) and 'schema_version' in backup and isinstance(backup.get('data'), dict):
        backup = backup['data']
    if not isinstance(backup, dict) or backup.get('kind') != BACKUP_KIND or backup.get('backup_version') != '1':
        return response(issues=[issue('BACKUP_VERSION_UNSUPPORTED', 'This is not a supported CoursePath backup version.', 'error')], status=422)
    if not isinstance(backup.get('account'), dict) or backup['account'].get('username') != request.user.username:
        return response(issues=[issue('BACKUP_OWNER_MISMATCH', 'A backup can be restored only into the account that exported it.', 'error')], status=422)
    record = backup.get('record')
    if not isinstance(record, dict) or not isinstance(record.get('profile'), dict):
        raise ValueError('Backup record missing')
    if (record['profile'].get('programme'), record['profile'].get('admission_year')) != ('BTECH_CSE', 2024):
        return response(issues=[issue('COHORT_MISMATCH', 'The backup is not for the supported B.Tech CSE 2024 cohort.', 'error')], status=422)
    attempts = validate_attempts(record.get('attempts'))
    enrolment = current_enrolment(record.get('current_enrolment', []))
    reported = record.get('reported_controls', [])
    plans, scenarios = backup.get('plans', []), backup.get('scenarios', [])
    if not isinstance(reported, list) or len(reported) > 50 or not isinstance(plans, list) or len(plans) > 50 or not isinstance(scenarios, list):
        raise ValueError('Backup lists exceed limits')
    plans = [plan_payload({k: v for k, v in p.items() if k in {'semesters', 'label'}}) for p in plans]
    if revision != stored.revision:
        raise RevisionConflict(stored.revision)
    existing = {a['id']: a for a in record_data(stored)['attempts']}
    incoming = {a['id']: a for a in attempts}
    shared = incoming.keys() & existing.keys()
    diff = {'attempts_added': sorted(incoming.keys() - existing.keys()), 'attempts_removed': sorted(existing.keys() - incoming.keys()),
            'attempts_changed': sorted(k for k in shared if incoming[k] != existing[k]), 'attempts_unchanged': sum(incoming[k] == existing[k] for k in shared),
            'current_enrolment_changed': enrolment != stored.current_enrolment, 'plans_to_create': len(plans), 'scenarios_not_restored': len(scenarios)}
    issues = []
    if backup.get('rule_version') != _curriculum_for(stored)['version']:
        issues.append(issue('BACKUP_RULE_VERSION_DIFFERS', 'The backup was made with different rules; analysis will use the current rules.', 'warning'))
    if scenarios:
        issues.append(issue('BACKUP_SCENARIOS_NOT_RESTORED', 'Scenarios depend on an exact baseline; recreate them after restoring.', 'warning'))
    preview = ImportPreview.objects.create(owner=request.user, record=stored, base_record_revision=stored.revision, expires_at=timezone.now() + timedelta(hours=1),
                                           payload={'kind': 'backup', 'attempts': attempts, 'current_enrolment': enrolment, 'reported_controls': reported, 'plans': plans})
    return response({'id': str(preview.pk), 'kind': 'backup', 'base_record_revision': stored.revision, 'expires_at': preview.expires_at.isoformat(), 'diff': diff},
                    issues, 201)


def _restore_backup(request, preview, stored, expected):
    """Runs inside import_commit's transaction: the record and new plans commit together or not at all."""
    if request.payload.get('confirm') is not True:
        raise ValueError('Restoring replaces the record; send confirm: true')
    payload = preview.payload
    restored = replace_record(stored, expected, payload['attempts'], payload['current_enrolment'], payload['reported_controls'])
    AcademicPlan.objects.bulk_create([AcademicPlan(owner=request.user, payload=plan) for plan in payload['plans']])
    preview.committed_at = timezone.now()
    preview.save(update_fields=['committed_at'])
    return response(restored)
