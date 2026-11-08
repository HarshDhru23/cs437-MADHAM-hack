"""Term offering availability from a reviewed snapshot. A present entry confirms
only that snapshot's term; absence proves nothing unless coverage is complete.
A I or II term without a snapshot borrows the latest earlier same-parity reviewed
snapshot as a historical hint only (D-23)."""
from coursepath.issues import issue
from coursepath.models import term_key


def snapshot_for_term(snapshots, term_id):
    """Accept one snapshot, a list of them, or None; return the one for term_id."""
    if snapshots is None:
        return None
    if isinstance(snapshots, dict):
        snapshots = [snapshots]
    return next((s for s in snapshots if s.get('term_id') == term_id), None)


def matching_offerings(snapshot, code):
    return [o for o in snapshot.get('offerings', []) if o.get('code') == code]


def pattern_snapshot(snapshots, term_id):
    """Latest reviewed snapshot of an earlier year in the same semester (I or II), or None (D-23)."""
    year, part = term_key(term_id)
    if part == 2 or snapshots is None:
        return None
    earlier = [s for s in ([snapshots] if isinstance(snapshots, dict) else snapshots)
               if s.get('review_status') == 'reviewed' and term_key(s['term_id'])[1] == part and term_key(s['term_id'])[0] < year]
    return max(earlier, key=lambda s: term_key(s['term_id']), default=None)


def offering_availability(snapshot, term_id, code):
    snapshots, snapshot = snapshot, snapshot_for_term(snapshot, term_id)
    if snapshot is None:
        pattern = pattern_snapshot(snapshots, term_id)
        matches = matching_offerings(pattern, code) if pattern else []
        if matches:
            # The hint names the earlier term but never lends its offering IDs or meetings to this term.
            return {'status': 'historical', 'offering_ids': [], 'source_refs': [ref for o in matches for ref in o.get('source_refs', [])],
                    'pattern_term_id': pattern['term_id'],
                    'issues': [issue('OFFERING_HISTORICAL_ONLY', f"Expected: {code} was offered in {pattern['term_id']} and the same semester usually repeats it, "
                                     f'but no {term_id} timetable is published, so this is unconfirmed.', 'info', [code])]}
        return {'status': 'unknown', 'offering_ids': [], 'source_refs': [],
                'issues': [issue('OFFERING_UNKNOWN', f'No {term_id} timetable is published yet, and {code} is not in the earlier same-semester list, so its availability cannot be confirmed.', 'info', [code])]}
    matches = matching_offerings(snapshot, code)
    reviewed = snapshot.get('review_status') == 'reviewed'
    refs = [ref for o in matches for ref in o.get('source_refs', [])]
    result = {'offering_ids': [o['id'] for o in matches], 'source_refs': refs, 'coverage': snapshot.get('coverage', 'unknown'),
              'snapshot_id': snapshot.get('id'), 'issues': []}
    if not matches:
        if reviewed and snapshot.get('coverage') == 'complete':
            return {**result, 'status': 'not_offered',
                    'issues': [issue('OFFERING_NOT_IN_SNAPSHOT', f'{code} is not in the complete reviewed {term_id} snapshot.', 'warning', [code])]}
        return {**result, 'status': 'unknown',
                'issues': [issue('OFFERING_UNKNOWN', f'{code} is absent from a partial or unreviewed {term_id} list; that does not prove it is unavailable.', entities=[code])]}
    # A current variant outranks a historical pattern; only all-historical matches stay a hint.
    if all(o.get('availability_status') == 'historical' for o in matches):
        return {**result, 'status': 'historical',
                'issues': [issue('OFFERING_HISTORICAL_ONLY', 'Expected from an earlier timetable; not a confirmed offering.', 'info', [code])]}
    if not reviewed:
        return {**result, 'status': 'tentative',
                'issues': [issue('OFFERING_SNAPSHOT_UNREVIEWED', f'The {term_id} timetable snapshot has not been reviewed.', 'warning', [code], [r['id'] for r in refs[:1]])]}
    return {**result, 'status': 'confirmed_in_snapshot'}


FOLLOWING_YEARS = 5   # academic years after the latest official one that follow its timetables


def _shift_year(text, years):
    return f'{int(text[:4]) + years}{text[4:]}'


def derive_snapshot(snapshot, term_id):
    """A copy of an official snapshot for a later term of the same semester (I or II): the same courses, slots and weekday times, with
    the term in every ID and each active date moved by whole years. Used where the institute has not yet published that term, so
    the odd-semester and even-semester timetables stay the one source for every year."""
    source_year, part = term_key(snapshot['term_id'])
    delta = term_key(term_id)[0] - source_year
    if term_key(term_id)[1] != part or delta <= 0:
        raise ValueError('A derived snapshot must be a later year of the same semester')

    def walk(value, key=None):
        if isinstance(value, dict):
            return {k: walk(v, k) for k, v in value.items()}
        if isinstance(value, list):
            return [walk(v, key) for v in value]
        if isinstance(value, str):
            if key in {'active_start_date', 'active_end_date'} and len(value) == 10:
                return _shift_year(value, delta)
            return value.replace(snapshot['term_id'], term_id)
        return value
    derived = walk(snapshot)
    derived['derived_from'] = snapshot['term_id']
    return derived


def with_following_terms(snapshots):
    """The given snapshots plus, for each semester (I and II) that has an official snapshot, a derived one for every year up to FOLLOWING_YEARS later."""
    by_term = {s['term_id']: s for s in snapshots if s.get('term_id')}
    for snapshot in list(by_term.values()):
        year, part = term_key(snapshot['term_id'])
        if part == 2 or snapshot.get('review_status') != 'reviewed' or snapshot.get('derived_from'):
            continue
        for later in range(year + 1, year + 1 + FOLLOWING_YEARS):
            term = f'{later}-{(later + 1) % 100:02d}-{"I" if part == 0 else "II"}'
            by_term.setdefault(term, derive_snapshot(snapshot, term))
    return list(by_term.values())
