"""The official 2026-27 timetables as reviewed, complete term snapshots (D-22).

The workbook adapter in `timetable_xlsx` does all parsing and is used unchanged. The
Semester II source is a CSV export of the `Time table` sheet alone, so its rows are
copied into a temporary workbook next to the Semester I `Time Slots` legend first. This
module then records the review, puts the real source file on the snapshot and dates
every meeting from the committed calendar (D-22, D-24).

    python -m coursepath.data_sources.official_timetables   # rewrite data/offerings/
"""
import csv
import hashlib
import json
import re
import tempfile
from pathlib import Path
from coursepath.calendar import course_dates, load_calendar
from coursepath.data_sources.timetable_xlsx import SHEET_SLOTS, SHEET_TIMETABLE, build_snapshot, validate_snapshot

ROOT = Path(__file__).resolve().parents[2]
OFFERINGS_DIR = ROOT / 'data' / 'offerings'
SEM_I = 'Timetable, Sem-I, 2026-27.xlsx'
OFFICIAL_SOURCES = {
    '2026-27-I': {'path': SEM_I, 'source_id': 'SRC-TIMETABLE'},
    '2026-27-II': {'path': 'Timetable, Sem-II, 2026-27 - Time table.csv', 'source_id': 'SRC-TIMETABLE-II', 'slot_legend': SEM_I},
}
RETRIEVED = '2026-11-03'
HALF_RE = re.compile(r'\((first|second) half\)', re.I)


def _csv_workbook(csv_path, legend_path, target):
    """One worksheet row per CSV record (locators like `Time table!A12` name record 12), plus the borrowed slot legend."""
    from openpyxl import Workbook, load_workbook
    book = Workbook()
    sheet = book.active
    sheet.title = SHEET_TIMETABLE
    with open(csv_path, encoding='utf-8', newline='') as handle:
        for row in csv.reader(handle):
            sheet.append([cell if cell.strip() else None for cell in row])
    legend = load_workbook(legend_path, data_only=True)[SHEET_SLOTS]
    slots = book.create_sheet(SHEET_SLOTS)
    for row in legend.iter_rows(max_row=legend.max_row, values_only=True):
        slots.append(list(row))
    book.save(target)


def _parse(term_id, source):
    path = ROOT / source['path']
    if 'slot_legend' not in source:
        return build_snapshot(path, term_id, source['source_id'])
    with tempfile.TemporaryDirectory() as folder:
        workbook = Path(folder) / 'timetable.xlsx'
        _csv_workbook(path, ROOT / source['slot_legend'], workbook)
        return build_snapshot(workbook, term_id, source['source_id'])


def build_official_snapshot(term_id, calendar=None):
    """Return (snapshot, ingestion report) for one official term, reviewed and complete (D-22)."""
    source = OFFICIAL_SOURCES[term_id]
    snapshot, report = _parse(term_id, source)
    calendar = calendar or load_calendar()
    digest = hashlib.sha256((ROOT / source['path']).read_bytes()).hexdigest()
    borrowed = 'slot_legend' in source
    snapshot['source_refs'][0].update(
        title=source['path'], file_sha256=digest, review_status='reviewed', authority='institutional', retrieved_at=RETRIEVED,
        locator=f"{source['path']}: {SHEET_TIMETABLE}" + (f" (CSV export; row = CSV record); {SHEET_SLOTS} from {source['slot_legend']}" if borrowed else ''),
        notes='Official institute timetable, supplied 3 Nov 2026; reviewed and complete for this term (D-22).')
    snapshot.update(coverage='complete', review_status='reviewed', publication_status='official')
    report.update(file_sha256=digest)
    if borrowed:
        for slot in snapshot['slot_map'].values():
            slot['locator'] = f"{source['slot_legend']}: {slot['locator']}"
        snapshot['issues'].append({
            'code': 'SLOT_LEGEND_FROM_OTHER_TERM', 'severity': 'warning', 'entity_refs': [],
            'message': f"This file has no slot legend; its slots are read with the {SHEET_SLOTS} legend of {source['slot_legend']} (D-22).",
            'source_refs': [{'id': 'SRC-TIMETABLE', 'locator': SHEET_SLOTS}], 'suggested_action': None})
    for offering in snapshot['offerings']:
        half = HALF_RE.search(offering.get('title') or '')
        start, end = course_dates(calendar, term_id, half[1].lower() if half else None) or (None, None)
        for group in offering['meeting_groups']:
            for meeting in group['meetings']:
                meeting['active_start_date'], meeting['active_end_date'] = start, end
    problems = validate_snapshot(snapshot)
    if problems:
        raise ValueError(f'{term_id} snapshot failed validation: ' + '; '.join(problems[:5]))
    return snapshot, report


def _write(path, data):
    path.write_text(json.dumps(data, sort_keys=True, indent=2, ensure_ascii=False) + '\n', encoding='utf-8', newline='\n')


def write_official_data(directory=OFFERINGS_DIR):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    calendar = load_calendar()
    for term_id in OFFICIAL_SOURCES:
        snapshot, report = build_official_snapshot(term_id, calendar)
        _write(directory / f'{term_id}.json', snapshot)
        _write(directory / f'{term_id}.report.json', report)
        print(f"{term_id}: {len(snapshot['offerings'])} offerings, {len(snapshot['slot_map'])} slots, {len(report['issues'])} report issues")


def load_committed_snapshots(directory=None):
    """The committed reviewed snapshots, one per term, in academic order."""
    snapshots = []
    for path in sorted(Path(directory or OFFERINGS_DIR).glob('*.json')):
        if path.name.endswith('.report.json'):
            continue
        snapshot = json.loads(path.read_text(encoding='utf-8'))
        problems = validate_snapshot(snapshot)
        if problems or snapshot.get('review_status') != 'reviewed':
            raise ValueError(f'{path.name} is not a valid reviewed snapshot: ' + '; '.join(problems[:5]))
        snapshots.append(snapshot)
    return sorted(snapshots, key=lambda s: s['term_id'])


if __name__ == '__main__':
    write_official_data()
