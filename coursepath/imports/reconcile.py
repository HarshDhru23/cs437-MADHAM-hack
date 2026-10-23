from copy import deepcopy
from decimal import Decimal
from coursepath.imports.normalization import normalize_code
from coursepath.imports.grades import grade_status
from coursepath.models import validate_term_id
from coursepath.serialization import decimal_value, decimal_string
from coursepath.issues import issue

FIELDS = {'normalized_code', 'title', 'credits', 'grade', 'term_id', 'instance_id'}


def reconcile_import(record, preview, resolutions):
    proposed = deepcopy(record)
    attempts = proposed.setdefault('attempts', [])
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
        existing = by_source.get(row.get('source_key', row['id']))
        if existing is None:
            cross_source = [a for a in attempts if (a['term_id'], a['normalized_code'], a.get('instance_id')) == (row['term_id'], row['normalized_code'], row.get('instance_id'))]
            if len(cross_source) == 1:
                existing = cross_source[0]
            elif len(cross_source) > 1:
                issues.append(issue('IMPORT_CONFLICT', 'Ambiguous cross-source attempt identity.', 'error', [row['id']]))
                continue
        if existing is not None:
            same_values = all(existing.get(field) == row.get(field) for field in FIELDS)
            original_unchanged = existing.get('user_corrections') and existing.get('original') == incoming.get('original') and not edits
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
