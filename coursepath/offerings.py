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
                    'issues': [issue('OFFERING_HISTORICAL_ONLY', f"{code} was offered in {pattern['term_id']}; the same semester usually repeats it (D-23), "
                                     f'but no {term_id} timetable is published, so this is a planning hint, not a confirmed offering.', entities=[code])]}
        return {'status': 'unknown', 'offering_ids': [], 'source_refs': [],
                'issues': [issue('OFFERING_UNKNOWN', f'No offering snapshot exists for {term_id}; availability is unknown.', entities=[code])]}
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
                'issues': [issue('OFFERING_HISTORICAL_ONLY', 'A historical pattern is a planning hint, not a confirmed offering.', entities=[code])]}
    if not reviewed:
        return {**result, 'status': 'tentative',
                'issues': [issue('OFFERING_SNAPSHOT_UNREVIEWED', f'The {term_id} timetable snapshot has not been reviewed.', 'warning', [code], [r['id'] for r in refs[:1]])]}
    return {**result, 'status': 'confirmed_in_snapshot'}
