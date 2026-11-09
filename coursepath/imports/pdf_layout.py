"""Coordinate-aware blocks with explicit column headers; unknown layouts fail closed."""
from collections import Counter
from io import BytesIO
import re
import pdfplumber
from pypdf import PdfReader
from coursepath.imports.normalization import TERM, CODE, candidate, candidate_issues, empty_result, normalize_term, normalize_code, summarize_candidates
from coursepath.issues import issue


# "Comp Science & Engg" is how IITGN transcripts print the discipline.
CSE_DISCIPLINE = r'\bComp(?:uter|\.)?\s+Sci(?:ence|\.)?\s*(?:&|and)\s*Eng(?:g|ineering|\.)?\b|\bCSE\b'


def lines_from_words(words):
    rows = []
    for word in sorted(words, key=lambda w: (round(w['top'] / 3), w['x0'])):
        if not rows or abs(rows[-1][0]['top'] - word['top']) > 3:
            rows.append([word])
        else:
            rows[-1].append(word)
    return [sorted(row, key=lambda w: w['x0']) for row in rows]


def _row_shaped(line, credit_x, grade_x):
    """A number in the credit column and a single grade-like token in the grade column."""
    credit = [w['text'] for w in line if credit_x <= w['x0'] < grade_x]
    grade = [w['text'] for w in line if w['x0'] >= grade_x]
    return len(credit) == 1 and re.fullmatch(r'\d+(?:\.\d+)?', credit[0]) is not None and len(grade) == 1 and re.fullmatch(r'[A-Za-z][+-]?', grade[0]) is not None


def _split_glued_code(line, code):
    """A code that fills its column touches the title ("491-VIIISpecial"); cut that word where the code ends.
    The transcript font is monospaced, so the title keeps its real x position for wrapped-line matching."""
    index = len(code.split()) - 1
    word, cut = line[index], len(code.split()[-1])
    split_x = word['x0'] + (word['x1'] - word['x0']) * cut / len(word['text'])
    return line[:index] + [{**word, 'text': word['text'][:cut], 'x1': split_x}, {**word, 'text': word['text'][cut:], 'x0': split_x}] + line[index + 1:]


def extract_pdf(data, source, max_pages):
    result = empty_result()
    reader = PdfReader(BytesIO(data), strict=True)
    if reader.is_encrypted:
        raise ValueError('Encrypted PDFs are unsupported')
    if len(reader.pages) > max_pages:
        raise ValueError('PDF page limit exceeded')
    counts = Counter()
    with pdfplumber.open(BytesIO(data)) as document:
        for page_number, original_page in enumerate(document.pages, 1):
            page = original_page.dedupe_chars()
            words = page.extract_words()
            text = page.extract_text() or ''
            profile = result.setdefault('profile_candidates', {'programme': None, 'admission_year': None})
            if re.search(r'B\.?\s*Tech|Bachelor\s+of\s+Technology', text, re.I):
                # Only the DISCIPLINE/PROGRAMME header decides; course titles ("Special Topics in Computer Science") never do.
                header = '\n'.join(line for line in text.splitlines() if re.search(r'\b(?:DISCIPLINE|PROGRAMME)\b', line, re.I))
                profile['programme'] = 'BTECH_CSE' if re.search(CSE_DISCIPLINE, header, re.I) else 'BTECH'
            admission = re.search(r'(?:MONTH\s*&\s*YEAR\s*OF\s*ADMISSION|ADMISSION(?:\s*YEAR)?)\s*:?\s*(?:[A-Za-z]+\s+)?(20\d{2})', text, re.I)
            if admission:
                profile['admission_year'] = int(admission[1])
            for label, field in [('(?:Earned Credits|TOTAL CREDITS EARNED)', 'earned_credits'), ('(?:Performance Credits|TOTAL CREDITS COUNTED TOWARDS PERFORMANCE)', 'performance_credits'), ('(?:Points|TOTAL CUMULATIVE POINTS)', 'grade_points'), ('CPI', 'cpi')]:
                match = re.search(label + r'\s*:\s*(\d+(?:\.\d+)?)', text, re.I)
                if match:
                    result['reported_controls'][field] = match[1]
            headings = []
            for left, right in [(0, page.width / 2), (page.width / 2, page.width)]:
                column = [w for w in words if left <= w['x0'] < right]
                for line in lines_from_words(column):
                    joined = ' '.join(w['text'] for w in line)
                    match = re.search(TERM, joined, re.I)
                    if match:
                        headings.append((left, right, line[0]['top'], match[0]))
            if not headings and 'SYSTEM OF EVALUATION AND AWARD OF DEGREE' in text:
                continue
            if not headings and any(re.match(rf'^({CODE})\s+', line) for line in text.splitlines()):
                result['unparsed_rows'].append({'page': page_number, 'raw': text})
                result['issues'].append(issue('PDF_LAYOUT_UNKNOWN', 'Course-looking text has no unambiguous term block.', 'error'))
            for block, (left, right, top, term) in enumerate(headings):
                bottom = min([h[2] for h in headings if h[0] == left and h[2] > top] + [page.height])
                lines = lines_from_words([w for w in words if left <= w['x0'] < right and top + 4 < w['top'] < bottom])
                headers = next((line for line in lines if any(w['text'].lower() in {'credit', 'credits'} for w in line) and any(w['text'].lower() == 'grade' for w in line)), None)
                if not headers:
                    result['issues'].append(issue('PDF_LAYOUT_UNKNOWN', 'Missing credit/grade column anchors.', 'error'))
                    result['unparsed_rows'].append({'page': page_number, 'block': block, 'raw': '\n'.join(' '.join(w['text'] for w in line) for line in lines)})
                    continue
                credit_x = next(w['x0'] for w in headers if w['text'].lower() in {'credit', 'credits'}) - 3
                grade_x = next(w['x0'] for w in headers if w['text'].lower() == 'grade') - 3
                previous = None
                title_x = None
                for line in lines:
                    if line[0]['top'] <= headers[0]['top'] + 3:
                        continue
                    joined = ' '.join(w['text'] for w in line)
                    match = re.match(rf'^({CODE})\s+', joined)
                    glued = None if match else re.match(rf'^({CODE})(?=[A-Z][a-z])', joined)
                    if glued:
                        line = _split_glued_code(line, glued[1])
                        joined = ' '.join(w['text'] for w in line)
                        match = re.match(rf'^({CODE})\s+', joined)
                    if match:
                        code = match[1]
                        code_words = len(code.split())
                        title_words = [w for w in line[code_words:] if w['x0'] < credit_x]
                        credit = ' '.join(w['text'] for w in line if credit_x <= w['x0'] < grade_x)
                        grade = ' '.join(w['text'] for w in line if w['x0'] >= grade_x)
                        try:
                            key = normalize_term(term), normalize_code(code)
                            row = candidate(term, code, ' '.join(w['text'] for w in title_words), credit, grade, source,
                                            {'page': page_number, 'block': block, 'line': round(line[0]['top'], 2),
                                             'box': [left, line[0]['top'], right, max(w['bottom'] for w in line)], 'raw': joined}, counts[key])
                            counts[key] += 1
                            result['candidate_attempts'].append(row)
                            result['issues'].extend(candidate_issues(row))
                            previous = row
                            title_x = title_words[0]['x0'] if title_words else None
                        except ValueError:
                            result['unparsed_rows'].append({'page': page_number, 'block': block, 'raw': joined})
                            result['issues'].append(issue('IMPORT_ROW_UNPARSED', 'Invalid PDF course row.', 'error'))
                            previous = None
                    elif previous and title_x is not None and abs(line[0]['x0'] - title_x) < 5 and max(w['x1'] for w in line) < credit_x and line[0]['top'] - previous['source_refs'][0]['box'][3] < 18:
                        previous['title'] += ' ' + joined
                        previous['original']['title'] += ' ' + joined
                        previous['source_refs'][0]['box'][3] = max(w['bottom'] for w in line)
                    elif re.match(rf'^({CODE})\s+', joined) or _row_shaped(line, credit_x, grade_x):
                        # A line with a credit and a grade is a course row even when its code is unreadable: disclose it, never skip it.
                        result['unparsed_rows'].append({'page': page_number, 'block': block, 'raw': joined})
                        result['issues'].append(issue('IMPORT_ROW_UNPARSED', 'Unrecognized course-looking PDF row.', 'error'))
                        previous = None
    if not result['candidate_attempts']:
        result['issues'].append(issue('PDF_LAYOUT_UNKNOWN', 'No supported text layout found. Use IMS paste or manual entry.', 'error'))
    if result.get('profile_candidates', {}).get('programme') != 'BTECH_CSE':
        result['issues'].append(issue('PROFILE_UNCONFIRMED', 'The source does not establish the selected CSE programme. Confirm the supported cohort separately.'))
    return summarize_candidates(result)
