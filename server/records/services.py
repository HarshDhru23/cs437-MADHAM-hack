from copy import deepcopy
from pathlib import Path
import json
from jsonschema import Draft202012Validator, FormatChecker, ValidationError as SchemaError
from django.db import transaction
from django.db.models import F
from server.records.models import Attempt
from coursepath.models import CourseAttempt
from coursepath.imports.grades import grade_status
from coursepath.validation import course_code

SCHEMA = json.loads((Path(__file__).resolve().parents[2] / 'schemas/coursepath-v1.schema.json').read_text())
ATTEMPT_VALIDATOR = Draft202012Validator({'$ref': '#/$defs/attempt', '$defs': SCHEMA['$defs']}, format_checker=FormatChecker())


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
    editable = {'normalized_code', 'title', 'credits', 'grade', 'term_id', 'completion_status', 'learning_designation', 'instance_id'}
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


def record_data(record):
    return {'profile': record.profile, 'revision': record.revision,
            'attempts': [a.payload for a in record.attempts.order_by('term_id', 'attempt_key')],
            'current_enrolment': record.current_enrolment, 'reported_controls': record.reported_controls}


@transaction.atomic
def replace_record(record, expected, attempts, current_enrolment=None, reported_controls=None):
    attempts = validate_attempts(attempts)
    updates = {'revision': F('revision') + 1}
    if current_enrolment is not None:
        updates['current_enrolment'] = current_enrolment
    if reported_controls is not None:
        updates['reported_controls'] = reported_controls
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
