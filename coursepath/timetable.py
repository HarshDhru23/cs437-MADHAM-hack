"""Required-meeting clash checks for one term's selected courses.

A clash needs the same weekday, overlapping end-exclusive minutes and, when both
meetings are dated, a shared end-exclusive date range holding that weekday
(weekday 0 is Monday). Undated meetings or unresolved alternatives can only
produce a possible clash; missing meeting data is `not_checked`, never clear.
A term with no snapshot, or with no selected courses, is `not_checked`: nothing
was compared, so it never reads as clear.
`section_ids` on a planned course are snapshot meeting IDs the student chose.
"""
from datetime import date, timedelta
from coursepath.issues import issue
from coursepath.offerings import matching_offerings


def _dates(meeting):
    start, end = meeting.get('active_start_date'), meeting.get('active_end_date')
    return (date.fromisoformat(start), date.fromisoformat(end)) if start and end else None


def _meets_in_shared_range(span_a, span_b, weekday):
    """True when the shared end-exclusive range holds at least one date on `weekday`."""
    start, end = max(span_a[0], span_b[0]), min(span_a[1], span_b[1])
    return start + timedelta(days=(weekday - start.weekday()) % 7) < end


def _unique(meetings):
    seen, result = set(), []
    for meeting in meetings:
        key = (meeting.get('kind'), meeting['weekday'], meeting['start_minute'], meeting['end_minute'],
               meeting.get('active_start_date'), meeting.get('active_end_date'))
        if key not in seen:
            seen.add(key)
            result.append(meeting)
    return result


def _resolve(item, snapshot, issues):
    """Return (meetings as (meeting, kind, certainly_required) tuples, resolved)."""
    entity = item['id']
    offerings = matching_offerings(snapshot, item['normalized_code'])
    if item.get('offering_id'):
        offerings = [o for o in offerings if o['id'] == item['offering_id']]
        if not offerings:
            issues.append(issue('OFFERING_VARIANT_UNKNOWN', f"The selected offering variant is not in this term's snapshot for {item['normalized_code']}.",
                                'error', [entity, item['offering_id']], action='Select an offering variant from the current snapshot.'))
            return [], False
    if not offerings:
        issues.append(issue('MEETINGS_UNKNOWN', f"No meetings for {item['normalized_code']} in this term's snapshot.", entities=[entity]))
        return [], False
    if len(offerings) > 1:
        issues.append(issue('OFFERING_SECTION_REQUIRED', 'Several source variants exist; choose the offering before clashes can be checked.',
                            entities=[entity] + [o['id'] for o in offerings], action='Select the offering variant for this course.'))
        return [], False
    groups = [g for g in offerings[0].get('meeting_groups') or [] if g.get('kind') != 'exam']
    selected = set(item.get('section_ids') or [])
    unknown = selected - {m['id'] for g in groups for m in g.get('meetings', [])}
    if unknown:
        issues.append(issue('SECTION_UNKNOWN', 'A selected section is not in this snapshot.', 'error', [entity] + sorted(unknown)))
        return [], False
    resolved, result = bool(groups), []
    for group in groups:
        meetings = _unique(group.get('meetings', []))
        if group.get('unresolved') or not meetings:
            resolved = False
            issues.append(issue('MEETINGS_UNKNOWN', f"Some {group.get('kind')} meetings could not be resolved from the source.", entities=[entity, group.get('id', '')],
                                sources=[r.get('locator', r.get('id')) for r in group.get('source_refs', [])]))
        picks = [m for m in meetings if m['id'] in selected]
        if group['selection_semantics'] == 'choose_one' and len(picks) == 1:
            result.extend((m, group.get('kind'), True) for m in picks)
        else:
            certain = group['selection_semantics'] == 'all_required'
            result.extend((m, group.get('kind'), certain) for m in meetings)
    if not groups:
        issues.append(issue('MEETINGS_UNKNOWN', 'The offering lists no meetings; clashes cannot be checked.', entities=[entity]))
    return result, resolved


def check_meetings(items, snapshot):
    issues, per_item, resolved_meetings = [], {}, {}
    for item in items:
        if snapshot is None:
            per_item[item['id']] = 'not_checked'
            issues.append(issue('MEETINGS_UNKNOWN', 'No timetable snapshot exists for this term; clashes were not checked.', entities=[item['id']]))
            continue
        meetings, resolved = _resolve(item, snapshot, issues)
        resolved_meetings[item['id']] = meetings
        per_item[item['id']] = 'clear' if resolved else 'not_checked'
    conflicts = []
    ids = list(resolved_meetings)
    for i, first in enumerate(ids):
        for second in ids[i + 1:]:
            for a, kind_a, certain_a in resolved_meetings[first]:
                for b, kind_b, certain_b in resolved_meetings[second]:
                    if a['weekday'] != b['weekday'] or not (a['start_minute'] < b['end_minute'] and b['start_minute'] < a['end_minute']):
                        continue
                    span_a, span_b = _dates(a), _dates(b)
                    if span_a and span_b and not _meets_in_shared_range(span_a, span_b, a['weekday']):
                        continue
                    assumptions = []
                    if not (span_a and span_b):
                        assumptions.append('Active dates are not stated; both meetings are assumed to run all term.')
                    if not (certain_a and certain_b):
                        assumptions.append('A meeting belongs to alternatives or a group whose required meetings are not stated.')
                    conflicts.append({'id': f"clash:{first}|{second}|{a['id']}|{b['id']}", 'item_ids': [first, second], 'meeting_ids': [a['id'], b['id']],
                                      'kinds': [kind_a, kind_b], 'weekday': a['weekday'],
                                      'start_minute': max(a['start_minute'], b['start_minute']), 'end_minute': min(a['end_minute'], b['end_minute']),
                                      'certain': not assumptions, 'assumptions': assumptions,
                                      'source_refs': a.get('source_refs', []) + b.get('source_refs', [])})
    for conflict in conflicts:
        for entity in conflict['item_ids']:
            per_item[entity] = 'conflicts'
        issues.append(issue('TIMETABLE_CONFLICT', ('Required meetings overlap.' if conflict['certain'] else 'Meetings may overlap. ' + ' '.join(conflict['assumptions'])),
                            'error' if conflict['certain'] else 'warning', conflict['item_ids'] + conflict['meeting_ids'],
                            [r.get('locator', r.get('id')) for r in conflict['source_refs']], 'Choose a compatible section or edit the plan.'))
    status = 'conflicts' if conflicts else 'not_checked' if snapshot is None or not per_item or 'not_checked' in per_item.values() else 'clear'
    return {'status': status, 'conflicts': conflicts, 'per_item': per_item, 'issues': issues}
