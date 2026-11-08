from copy import deepcopy
from decimal import Decimal
from coursepath.imports.normalization import normalize_code
from coursepath.imports.grades import grade_status
from coursepath.models import validate_term_id
from coursepath.serialization import decimal_value, decimal_string
from coursepath.issues import issue

FIELDS = {'normalized_code', 'title', 'credits', 'grade', 'term_id', 'instance_id'}


def is_imported(attempt):
    """A row that came from an import (it carries its source); a row the student typed in has none."""
    return bool(attempt.get('source_key') or attempt.get('source_refs'))


def _canonical(field, value):
    """A value as an import stores it, so a row that only comes back reformatted (ES242(N), doubled spaces, 4.0) is the same row (D-44)."""
    try:
        if field in {'normalized_code', 'code'}:
            return normalize_code(value)
        if field == 'title':
            return ' '.join(value.split())
        if field == 'credits':
            return decimal_value(value.strip() if isinstance(value, str) else value)
        if field == 'grade':
            return value.strip().upper()
    except (AttributeError, TypeError, ValueError):
        pass
    return value


def _same_values(a, b, fields=FIELDS):
    return isinstance(a, dict) and isinstance(b, dict) and all(_canonical(f, a.get(f)) == _canonical(f, b.get(f)) for f in fields)


def _same_original(a, b):
    return isinstance(a, dict) and isinstance(b, dict) and _same_values(a, b, set(a) | set(b))


def _same_attempt(a, b):
    return (a['term_id'], a['normalized_code'], a.get('instance_id')) == (b['term_id'], b['normalized_code'], b.get('instance_id'))


def reconcile_import(record, preview, resolutions, replace_imported=False):
    """Compare an import with the saved record and build the record it would produce.

    With `replace_imported`, a new import replaces what an earlier import saved: the previously imported rows are not compared
    one by one for conflicts. A saved imported row that the new import repeats unchanged stays as it is (with any correction the
    student made); one the import changes is replaced by the incoming row; one the import no longer has is removed. Rows the
    student typed in themselves are never touched by that, and a changed one still needs an explicit decision."""
    proposed = deepcopy(record)
    attempts = proposed.setdefault('attempts', [])
    prior = []
    if replace_imported:
        prior = [a for a in attempts if is_imported(a)]
        attempts[:] = [a for a in attempts if not is_imported(a)]
        kept = [a for a in prior if any(a.get('source_key') == e.get('source_key') or _same_attempt(a, e) for e in preview.get('excluded_attempts', []))]
        attempts.extend(kept)  # a row the student left out of this review keeps its saved version
        prior = [a for a in prior if a not in kept]
    by_source = {a.get('source_key', a['id']): a for a in attempts}
    issues, diff = [], []
    candidate_profile = preview.get('profile_candidates', {})
    if candidate_profile.get('admission_year') not in {None, 2024}:
        issues.append(issue('COHORT_MISMATCH', 'The source admission year differs from the supported 2024 cohort.', 'error'))
    if preview.get('unparsed_rows') and not _acknowledged(resolutions.get('_unparsed'), 'omit'):
        issues.append(issue('IMPORT_ROW_UNPARSED', 'Explicitly review omitted unparsed rows before committing.', 'error'))
    for incoming in preview['candidate_attempts']:
        row = deepcopy(incoming)
        resolution = resolutions.get(row['id'], {})
        if not isinstance(resolution, dict) or set(resolution) - {'fields', 'justification', 'action'}:
            raise ValueError('Invalid resolution')
        if resolution.get('action') not in {None, 'keep_existing', 'accept_incoming'}:
            raise ValueError('Invalid resolution action')
        edits = resolution.get('fields', {})
        if not isinstance(edits, dict) or set(edits) - FIELDS:
            raise ValueError('Unsupported correction field')
        if edits and not str(resolution.get('justification', '')).strip():
            issues.append(issue('CORRECTION_JUSTIFICATION_REQUIRED', 'Corrections need an extraction-error justification; this does not approve equivalence.', 'error', [row['id']]))
            continue
        for field, value in edits.items():
            if value != row.get(field):
                row['user_corrections'].append({'field': field, 'raw': row.get(field), 'accepted': value, 'justification': resolution['justification']})
                row[field] = value
        row['normalized_code'] = normalize_code(row['normalized_code'])
        row['credits'] = decimal_string(decimal_value(row['credits']))
        row['grade'] = row['grade'].strip().upper()
        row['completion_status'] = grade_status(row['grade'])
        validate_term_id(row['term_id'])
        if row['completion_status'] == 'unknown' or not row['title'].strip():
            issues.append(issue('IMPORT_BLOCKING_FIELD', 'Resolve blank/unknown grades and required fields.', 'error', [row['id']]))
        same_term_code = [a for a in preview['candidate_attempts'] if a['term_id'] == incoming['term_id'] and a['normalized_code'] == incoming['normalized_code']]
        if len(same_term_code) > 1 and not row.get('instance_id'):
            issues.append(issue('DUPLICATE_SOURCE_ROW', 'Assign reviewed instance IDs or omit repeated source rows.', 'error', [row['id']]))
        if replace_imported:
            before = next((a for a in prior if a.get('source_key') == row.get('source_key')), None) or next((a for a in prior if _same_attempt(a, row)), None)
            if before is not None:
                prior.remove(before)
                if _same_values(before, row) or (before.get('user_corrections') and _same_original(before.get('original'), incoming.get('original')) and not edits):
                    attempts.append(before)
                    diff.append({'candidate_id': incoming['id'], 'attempt_id': before['id'], 'status': 'unchanged'})
                else:
                    why = str(resolution.get('justification', '')).strip() or 'Replaced by a newer import'
                    row['id'] = before['id']  # the saved attempt keeps its identity, so anything that points at it still does
                    row['user_corrections'] = before.get('user_corrections', []) + row['user_corrections'] + [
                        {'field': 'reimport', 'raw': {k: before.get(k) for k in FIELDS}, 'accepted': {k: row.get(k) for k in FIELDS}, 'justification': why}]
                    attempts.append(row)
                    diff.append({'candidate_id': incoming['id'], 'attempt_id': row['id'], 'status': 'replaced', 'existing': {k: before.get(k) for k in FIELDS}})
                continue
        existing = by_source.get(row.get('source_key', row['id']))
        if existing is None:
            cross_source = [a for a in attempts if (a['term_id'], a['normalized_code'], a.get('instance_id')) == (row['term_id'], row['normalized_code'], row.get('instance_id'))]
            if len(cross_source) == 1:
                existing = cross_source[0]
            elif len(cross_source) > 1:
                issues.append(issue('IMPORT_CONFLICT', 'Ambiguous cross-source attempt identity.', 'error', [row['id']]))
                continue
        if existing is not None:
            same_values = _same_values(existing, row)
            original_unchanged = existing.get('user_corrections') and _same_original(existing.get('original'), incoming.get('original')) and not edits
            if same_values or original_unchanged or resolution.get('action') == 'keep_existing':
                diff.append({'candidate_id': row['id'], 'attempt_id': existing['id'], 'status': 'unchanged'})
                continue
            if resolution.get('action') != 'accept_incoming' or not str(resolution.get('justification', '')).strip():
                issues.append(issue('IMPORT_CONFLICT', 'Changed grade, credits, term or title needs an explicit resolution.', 'error', [row['id'], existing['id']]))
                diff.append({'candidate_id': row['id'], 'attempt_id': existing['id'], 'status': 'conflicting'})
                continue
            row['id'] = existing['id']
            row['user_corrections'] = existing.get('user_corrections', []) + row['user_corrections'] + [{'field': 'reimport', 'raw': {k: existing.get(k) for k in FIELDS}, 'accepted': {k: row.get(k) for k in FIELDS}, 'justification': resolution['justification']}]
            attempts[attempts.index(existing)] = row
            diff.append({'candidate_id': incoming['id'], 'attempt_id': row['id'], 'status': 'resolved'})
        else:
            attempts.append(row)
            diff.append({'candidate_id': row['id'], 'attempt_id': row['id'], 'status': 'new'})
    diff.extend({'candidate_id': None, 'attempt_id': a['id'], 'status': 'removed', 'existing': {k: a.get(k) for k in FIELDS}} for a in prior)
    from coursepath.imports.normalization import summarize_candidates
    extracted = summarize_candidates(deepcopy(preview))['extracted_controls']
    fields = {'earned_credits': 'reported_grade_earned_credits', 'performance_credits': 'performance_credits', 'grade_points': 'grade_points'}
    for reported_field, computed_field in fields.items():
        reported = preview.get('reported_controls', {}).get(reported_field)
        if reported is not None and decimal_value(reported) != decimal_value(extracted[computed_field]):
            issues.append(issue('IMPORT_TOTAL_MISMATCH', f'Source {reported_field} reports {reported}; extracted {computed_field} is {extracted[computed_field]}. Degree allocation is separate.',
                                'warning' if _acknowledged(resolutions.get('_totals'), 'acknowledge') else 'error'))
    return {'record': proposed, 'diff': diff, 'issues': issues}


def _acknowledged(value, action):
    return isinstance(value, dict) and value.get('action') == action and bool(str(value.get('justification', '')).strip())
