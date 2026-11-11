from copy import deepcopy
from pathlib import Path
import json
from jsonschema import Draft202012Validator, FormatChecker, ValidationError as SchemaError
from django.db import transaction
from django.db.models import F
from server.records.models import Attempt
from coursepath.models import CourseAttempt
from coursepath.imports.grades import grade_status
from coursepath.imports import normalization
from coursepath.imports.normalization import normalize_code, normalize_text
from coursepath.imports.reconcile import FIELDS as REIMPORT_FIELDS
from coursepath.serialization import decimal_string, decimal_value
from coursepath.validation import course_code

SCHEMA = json.loads((Path(__file__).resolve().parents[2] / 'schemas/coursepath-v1.schema.json').read_text())
ATTEMPT_VALIDATOR = Draft202012Validator({'$ref': '#/$defs/attempt', '$defs': SCHEMA['$defs']}, format_checker=FormatChecker())
EDITABLE_FIELDS = {'normalized_code', 'title', 'credits', 'grade', 'term_id', 'completion_status', 'learning_designation', 'instance_id'}
_DERIVED = object()  # completion state that follows the grade, as an import sets it


class RevisionConflict(Exception):
    def __init__(self, current_revision):
        self.current_revision = current_revision


def expected_revision(payload):
    value = payload.get('expected_revision')
    if type(value) is not int or value < 0:
        raise ValueError('expected_revision must be a nonnegative integer')
    return value


def validate_attempts(attempts):
    if not isinstance(attempts, list) or len(attempts) > 2000:
        raise ValueError('Expected at most 2000 attempts')
    ids, source_keys = set(), set()
    for attempt in attempts:
        try:
            ATTEMPT_VALIDATOR.validate(attempt)
        except SchemaError as exc:
            raise ValueError('Invalid course attempt: ' + exc.message) from exc
        CourseAttempt(**{key: attempt[key] for key in CourseAttempt.__dataclass_fields__ if key in attempt})
        course_code(attempt['normalized_code'])
        if len(attempt['id']) > 160 or len(attempt['title']) > 2000 or len(attempt['grade']) > 24:
            raise ValueError('Attempt fields exceed limits')
        derived = grade_status(attempt['grade'])
        if attempt['completion_status'] in {'completed', 'failed'} and attempt['completion_status'] != derived:
            raise ValueError('Grade and completion state conflict')
        if attempt['id'] in ids:
            raise ValueError('Duplicate attempt IDs')
        ids.add(attempt['id'])
        if attempt.get('source_key'):
            if attempt['source_key'] in source_keys:
                raise ValueError('Duplicate source attempt identity')
            source_keys.add(attempt['source_key'])
    return deepcopy(attempts)


def corrected_record_rows(record, incoming, justifications):
    incoming = validate_attempts(incoming)
    if not isinstance(justifications, dict):
        raise ValueError('Correction justifications must map attempt IDs to text')
    existing = {a.attempt_key: a.payload for a in record.attempts.all()}
    editable = EDITABLE_FIELDS
    for row in incoming:
        previous = existing.get(row['id'])
        if previous is None:
            if row.get('course_version_id') is not None or row.get('approval_refs') or row.get('user_corrections'):
                raise ValueError('New manual attempts cannot claim catalogue matches or approvals')
            continue
        if any(row.get(k) != previous.get(k) for k in (set(row) | set(previous)) - editable):
            raise ValueError('Original evidence/history cannot be overwritten')
        changed = [key for key in sorted(editable) if row.get(key) != previous.get(key)]
        if changed:
            justification = justifications.get(row['id'])
            if not isinstance(justification, str) or not justification.strip() or len(justification) > 2000:
                raise ValueError('Record corrections need a justification')
            row['user_corrections'] = deepcopy(previous['user_corrections']) + [
                {'field': key, 'raw': previous.get(key), 'accepted': row.get(key), 'justification': justification} for key in changed]
    return incoming


def restore_rejections(record, rows, verified_approvals):
    """IDs of backup rows that PATCH /record and imports could not have produced (CP-30).

    A row already in the record keeps its stored evidence, server-assigned fields and whole correction history; it may
    only append justified corrections. A row new to the record must match its own `original` source values except where
    a justified correction says otherwise, claims no catalogue match, and cites only this owner's verified approvals."""
    existing = {a.attempt_key: a.payload for a in record.attempts.all()}
    return sorted(row['id'] for row in rows if not _restorable(row, existing.get(row['id']), verified_approvals))


def _restorable(row, stored, verified_approvals):
    history = row['user_corrections']
    if stored is not None:
        if any(row.get(k) != stored.get(k) for k in (set(row) | set(stored)) - EDITABLE_FIELDS - {'user_corrections'}):
            return False
        if history[:len(stored['user_corrections'])] != stored['user_corrections']:
            return False
        expected, history = {k: stored.get(k) for k in EDITABLE_FIELDS}, history[len(stored['user_corrections']):]
    else:
        if row.get('course_version_id') is not None or any(not isinstance(ref, str) or ref not in verified_approvals for ref in row.get('approval_refs', [])):
            return False
        if (row.get('source_refs') or row.get('source_key')) and not isinstance(row.get('original'), dict):
            return False
        expected = _source_values(row.get('original'))
    for entry in history:
        if not isinstance(entry, dict) or 'accepted' not in entry or not isinstance(entry.get('justification'), str) or not entry['justification'].strip():
            return False
        if entry.get('field') == 'reimport' and isinstance(entry['accepted'], dict):
            expected.update({k: v for k, v in entry['accepted'].items() if k in REIMPORT_FIELDS}, learning_designation=normalization.IMPORTED_LEARNING_DESIGNATION, completion_status=_DERIVED)
        elif isinstance(entry.get('field'), str) and entry['field'] in EDITABLE_FIELDS:
            expected[entry['field']] = entry['accepted']
        else:
            return False
    if expected.get('completion_status') is _DERIVED:
        expected['completion_status'] = grade_status(row['grade'])
    return all(row.get(k) == value or row.get(k) == _stored_form(k, value) for k, value in expected.items())


def _source_values(original):
    """An imported row's values before any correction, as normalization.candidate builds them. A manual row has none."""
    if not isinstance(original, dict):
        return {}
    expected = {'learning_designation': normalization.IMPORTED_LEARNING_DESIGNATION, 'instance_id': None, 'completion_status': _DERIVED}
    for field, key in [('original_code', 'code'), ('normalized_code', 'code'), ('title', 'title'), ('credits', 'credits'), ('grade', 'grade')]:
        if key in original:
            expected[field] = original[key]
    return expected


def _stored_form(field, value):
    """A source or corrected value as an import stores it: codes, titles, credits and grades are normalized."""
    try:
        if field == 'normalized_code':
            return normalize_code(value)
        if field == 'title':
            return ' '.join(value.split())
        if field == 'credits':
            return decimal_string(decimal_value(value.strip() if isinstance(value, str) else value))
        if field == 'grade':
            return normalize_text(value).strip().upper()
    except (AttributeError, TypeError, ValueError):
        pass
    return value


def record_data(record):
    return {'profile': record.profile, 'revision': record.revision,
            'attempts': [a.payload for a in record.attempts.order_by('term_id', 'attempt_key')],
            'current_enrolment': record.current_enrolment, 'reported_controls': record.reported_controls}


@transaction.atomic
def replace_record(record, expected, attempts, current_enrolment=None, reported_controls=None, profile=None):
    attempts = validate_attempts(attempts)
    updates = {'revision': F('revision') + 1}
    if current_enrolment is not None:
        updates['current_enrolment'] = current_enrolment
    if reported_controls is not None:
        updates['reported_controls'] = reported_controls
    if profile is not None:
        updates['profile'] = profile
    if not type(record).objects.filter(pk=record.pk, owner=record.owner, revision=expected).update(**updates):
        record.refresh_from_db()
        raise RevisionConflict(record.revision)
    record.attempts.all().delete()
    Attempt.objects.bulk_create([Attempt(record=record, attempt_key=a['id'], normalized_code=a['normalized_code'],
                                         term_id=a['term_id'], credits=a['credits'], grade=a['grade'], payload=a) for a in attempts])
    record.refresh_from_db()
    return record_data(record)


@transaction.atomic
def update_plan(plan, expected, payload):
    if not type(plan).objects.filter(pk=plan.pk, owner=plan.owner, revision=expected).update(revision=F('revision') + 1, payload=payload):
        plan.refresh_from_db()
        raise RevisionConflict(plan.revision)
    plan.refresh_from_db()
    return plan_data(plan)


def plan_data(plan):
    return {'id': str(plan.id), 'revision': plan.revision, **plan.payload}


def scenario_data(scenario):
    payload = scenario.payload
    return {'id': str(scenario.id), 'revision': scenario.revision, 'plan_id': str(scenario.plan_id), 'label': payload.get('label', ''),
            'baseline_record_revision': scenario.baseline_record_revision, 'baseline_plan_revision': scenario.baseline_plan_revision,
            'rule_version': scenario.rule_version, 'changes': payload.get('changes', []), 'internship': payload.get('internship'),
            'award_ids': payload.get('award_ids', [])}


@transaction.atomic
def update_scenario(scenario, expected, payload, baseline=None):
    updates = {'revision': F('revision') + 1, 'payload': payload}
    if baseline:
        updates.update(baseline)
    if not type(scenario).objects.filter(pk=scenario.pk, owner=scenario.owner, revision=expected).update(**updates):
        scenario.refresh_from_db()
        raise RevisionConflict(scenario.revision)
    scenario.refresh_from_db()
    return scenario_data(scenario)
