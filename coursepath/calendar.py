"""Calendar-month arithmetic and term presets. Intervals are [start, end).

No institute calendar is committed (GAP-03): presets fail with CALENDAR_MISSING
instead of inventing term dates."""
from calendar import monthrange
from datetime import date, timedelta

MONTHS = {'three_months': 3, 'six_months': 6}


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


def preset_dates(duration_choice, preset, calendar, term_id):
    """Seed dates from a term start: `summer` uses a summer term, `semester` a regular one."""
    if duration_choice not in MONTHS:
        raise ValueError('Presets apply only to three_months or six_months')
    if preset not in {'summer', 'semester'} or (preset == 'summer') != term_id.endswith('SUMMER'):
        raise ValueError('The preset does not match the chosen term')
    dates = term_dates(calendar, term_id)
    if dates is None:
        raise ValueError(f'CALENDAR_MISSING: no reviewed start date for {term_id}; enter exact dates instead')
    return dates[0], add_calendar_months(dates[0], MONTHS[duration_choice])
