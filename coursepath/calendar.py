"""Calendar-month arithmetic, the committed academic calendar and internship presets. Intervals are [start, end).

`data/calendars/*.json` holds the published IITGN calendars (D-24); terms of later
years have no dates until they are published, and callers report CALENDAR_MISSING
for them instead of inventing dates."""
import json
from calendar import monthrange
from datetime import date, timedelta
from pathlib import Path
from coursepath.models import term_key, validate_term_id

MONTHS = {'three_months': 3, 'six_months': 6}
CALENDAR_DIR = Path(__file__).resolve().parents[1] / 'data' / 'calendars'


def as_date(value):
    return value if isinstance(value, date) or value is None else date.fromisoformat(value)


def add_calendar_months(start, months):
    """Same day-of-month `months` later, clamped to that month's last day."""
    index = start.month - 1 + months
    year, month = start.year + index // 12, index % 12 + 1
    return date(year, month, min(start.day, monthrange(year, month)[1]))


def from_inclusive(start, last_day):
    """UI dates (inclusive last day) -> engine interval (exclusive end), converted once."""
    return as_date(start), as_date(last_day) + timedelta(days=1)


def to_inclusive(end_exclusive):
    return as_date(end_exclusive) - timedelta(days=1)


def term_dates(calendar, term_id):
    term = next((t for t in (calendar or {}).get('terms', []) if t.get('id') == term_id), None)
    if not term or not term.get('start_date') or not term.get('end_date_exclusive'):
        return None
    return as_date(term['start_date']), as_date(term['end_date_exclusive'])


def _span(entry, where, within=None):
    try:
        start, end = date.fromisoformat(entry['start_date']), date.fromisoformat(entry['end_date_exclusive'])
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError(f'{where} needs ISO start_date and end_date_exclusive') from exc
    if start >= end:
        raise ValueError(f'{where} ends before it starts')
    if within and not (within[0] <= start and end <= within[1]):
        raise ValueError(f'{where} lies outside its term')
    return start, end


def validate_calendar(calendar):
    """Check a published calendar: reviewed, valid unique term IDs, and exams, quads and classes inside their term."""
    if calendar.get('review_status') != 'reviewed':
        raise ValueError('Only a reviewed calendar can be used')
    seen = set()
    for term in calendar.get('terms', []):
        term_id = validate_term_id(term.get('id') or '')
        if term_id in seen:
            raise ValueError(f'{term_id} appears twice')
        seen.add(term_id)
        span = _span(term, term_id)
        _span({'start_date': term.get('classes_start_date'), 'end_date_exclusive': term.get('classes_end_date_exclusive')}, f'{term_id} classes', span)
        for key in ('exams', 'quads'):
            for entry in term.get(key, []):
                _span(entry, f"{term_id} {entry.get('id', key)}", span)
    return calendar


def load_calendar(directory=None):
    """Merge every committed calendar year into one validated calendar, terms in academic order."""
    years = [validate_calendar(json.loads(path.read_text(encoding='utf-8'))) for path in sorted(Path(directory or CALENDAR_DIR).glob('*.json'))]
    terms = sorted((t for year in years for t in year['terms']), key=lambda t: term_key(t['id']))
    return validate_calendar({'id': '+'.join(year['id'] for year in years) or None, 'review_status': 'reviewed',
                              'source_refs': [ref for year in years for ref in year.get('source_refs', [])], 'terms': terms})


def course_dates(calendar, term_id, half=None):
    """Active dates of a course (D-22): Q1-Q2 for the first half, Q3-Q4 for the second, else all classes. None if unpublished."""
    term = next((t for t in (calendar or {}).get('terms', []) if t.get('id') == term_id), None)
    if term is None:
        return None
    if half is None:
        return term['classes_start_date'], term['classes_end_date_exclusive']
    quads = {q['id']: q for q in term.get('quads', [])}
    first, last = ('Q1', 'Q2') if half == 'first' else ('Q3', 'Q4')
    if first not in quads or last not in quads:
        return None
    return quads[first]['start_date'], quads[last]['end_date_exclusive']


def preset_dates(duration_choice, preset, term_id):
    """D-25: a summer internship starts on 1 May; a six-month semester internship starts on 1 July before its odd semester.

    `term_id` names the summer term for `summer`, or the odd semester the internship overlaps for `semester`."""
    if duration_choice not in MONTHS:
        raise ValueError('Presets apply only to three_months or six_months')
    first_year = int(validate_term_id(term_id)[:4])
    if preset == 'summer' and term_id.endswith('-SUMMER'):
        start = date(first_year + 1, 5, 1)
    elif preset == 'semester' and duration_choice == 'six_months' and term_id.endswith('-I'):
        start = date(first_year, 7, 1)
    else:
        raise ValueError('No preset matches this duration and term; enter exact dates instead (D-25)')
    return start, add_calendar_months(start, MONTHS[duration_choice])


def internship_presets(calendar):
    """Seed dates for each published summer: three or six months from 1 May, and six months from 1 July before the next odd semester."""
    presets = []
    for term in (calendar or {}).get('terms', []):
        if not term['id'].endswith('-SUMMER'):
            continue
        year = int(term['id'][:4]) + 1
        odd = f'{year}-{(year + 1) % 100:02d}-I'
        for choice, preset, term_id in [('three_months', 'summer', term['id']), ('six_months', 'summer', term['id']), ('six_months', 'semester', odd)]:
            start, end = preset_dates(choice, preset, term_id)
            presets.append({'duration_choice': choice, 'preset': preset, 'term_id': term_id, 'start_date': start.isoformat(),
                            'end_date_exclusive': end.isoformat(), 'decision': 'D-25'})
    return presets
