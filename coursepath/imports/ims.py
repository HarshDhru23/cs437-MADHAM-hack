"""Bounded IMS table extraction; every rejected candidate remains inspectable."""
import re
from collections import Counter
from coursepath.imports.normalization import CODE, TERM, candidate, candidate_issues, empty_result, normalize_text, normalize_term, normalize_code, summarize_candidates
from coursepath.issues import issue


def parse_ims(text, source_ref):
    result = empty_result()
    if not isinstance(text, str) or len(text) > 1_000_000:
        result['issues'].append(issue('INPUT_LIMIT', 'Paste limit is 1,000,000 characters.', 'error'))
        return result
    text = normalize_text(text)
    lines = text.splitlines()
    expected = ['academic period', 'course no', 'course name', 'credit', 'grade']
    header_index = next((i for i, line in enumerate(lines) if all(h in line.lower() for h in expected)), None)
    if header_index is None:
        result['issues'].append(issue('IMPORT_HEADERS_MISSING', 'Expected Academic Period, Course No, Course Name, Credit, Grade.', 'error'))
        result['unparsed_rows'] = [{'line': i + 1, 'raw': line} for i, line in enumerate(lines) if line.strip()]
        return result
    counts = Counter()
    pending, start_line = '', 0

    def consume(raw, line_number):
        try:
            if '\t' in raw:
                fields = raw.split('\t')
                if len(fields) != 5:
                    raise ValueError('Missing table fields')
                term, code, title, credits, grade = fields
                if not re.fullmatch(CODE, code.strip()):
                    raise ValueError('Invalid course number')
            else:
                match = re.fullmatch(rf'\s*({TERM})\s+({CODE})\s+(.+?)\s+(\d+(?:\.\d+)?)\s+([A-Za-z][+-]?)?\s*', raw, re.I)
                if not match:
                    raise ValueError('Unrecognized row')
                term, code, title, credits, grade = match.groups()
            key = normalize_term(term), normalize_code(code)
            row = candidate(term, code, title, credits, grade or '', source_ref, {'line': line_number, 'raw': raw}, counts[key])
            counts[key] += 1
            result['candidate_attempts'].append(row)
            result['issues'].extend(candidate_issues(row))
            if counts[key] > 1:
                result['issues'].append(issue('DUPLICATE_SOURCE_ROW', 'Repeated course in the same term requires instance review.', 'error', [row['id']]))
        except ValueError:
            result['unparsed_rows'].append({'line': line_number, 'raw': raw})
            result['issues'].append(issue('IMPORT_ROW_UNPARSED', f'Could not parse line {line_number}.', 'error'))

    for index, raw in enumerate(lines[header_index + 1:], header_index + 2):
        if not raw.strip():
            continue
        if all(h in raw.lower() for h in expected):
            continue
        if '\t' in raw:
            if pending:
                consume(pending, start_line)
                pending = ''
            consume(raw, index)
        else:
            if re.match(r'\s*20\d{2}\s*-', raw) and pending:
                consume(pending, start_line)
                pending = ''
            if not pending:
                start_line = index
            pending = (pending + ' ' + raw.strip()).strip()
    if pending:
        consume(pending, start_line)
    if not result['candidate_attempts']:
        result['issues'].append(issue('IMPORT_EMPTY', 'No valid course rows were extracted.', 'error'))
    return summarize_candidates(result)
