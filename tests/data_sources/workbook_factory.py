"""Builds synthetic timetable workbooks mirroring the structure documented in
docs/team/source-findings.md. No real institutional data is used."""
from itertools import product

from openpyxl import Workbook
from openpyxl.styles import PatternFill

HEADERS = [
    "Course Number", "Course Name", "L", "T", "P", "C", "Instructor", "Capacity",
    "Enrolment", "Sections", "Lecture", "Tutorial", "Lab", "Course Plan Link",
    "Preferred Knowledge", "Remarks", "Minor", "HSS/BS",
]
WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
TIME_ROWS = [
    "08:30 – 09:50", "10:00 – 11:20", "11:30 – 12:50",
    "LUNCH", "14:00 – 15:20", "15:30 – 16:50", "17:00 – 18:20",
]
# (time row index, weekday index) -> slot token, as stated in source-findings.
KNOWN_SLOTS = {
    (0, 1): "B1", (0, 4): "B2", (1, 1): "D1", (2, 2): "H2",
    (4, 4): "J2", (5, 4): "M2", (6, 0): "H1",
}


def slot_grid():
    used = set(KNOWN_SLOTS.values())
    spare = (a + b for b, a in product("12", "ACEFGKLNPQRSTUVWXYZ")
             if a + b not in used)
    grid = {}
    for r, c in product(range(len(TIME_ROWS)), range(5)):
        if r == 3:
            continue
        grid[(r, c)] = KNOWN_SLOTS.get((r, c)) or next(spare)
    return grid


def add_time_slots(wb, grid=None):
    ws = wb.create_sheet("Time Slots")
    ws.cell(1, 1, "Time")
    for c, day in enumerate(WEEKDAYS):
        ws.cell(1, c + 2, day)
    grid = slot_grid() if grid is None else grid
    for r, label in enumerate(TIME_ROWS):
        ws.cell(r + 2, 1, label if label != "LUNCH" else "Lunch Break")
        for c in range(5):
            ws.cell(r + 2, c + 2, "Lunch Break" if r == 3 else grid.get((r, c)))
    return ws


def course_row(code, title, credits, lecture="", tutorial="", lab="", *,
               sections=1, link=None, pref=None, remarks=None, minor=None,
               tag=None, l=3, t=0, p=0):
    return {"A": code, "B": title, "C": l, "D": t, "E": p, "F": credits,
            "J": sections, "K": lecture, "L": tutorial, "M": lab, "N": link,
            "O": pref, "P": remarks, "Q": minor, "R": tag}


def build_workbook(path, rows, *, time_slots=True, availability=True,
                   header_row=2, place=None, grid=None, blank_rows=0):
    """rows: course_row dicts, None (empty row) or str (section row), placed
    from the row after the header. place: {row_number: row_dict} for fixed
    source locators."""
    wb = Workbook()
    ws = wb.active
    ws.title = "Time table"
    ws.cell(1, 1, "Timetable Semester I")
    for i, h in enumerate(HEADERS):
        ws.cell(header_row, i + 1, h)
    r = header_row + 1
    for row in rows:
        if isinstance(row, str):
            ws.cell(r, 1, row)
        elif row is not None:
            _put(ws, r, row)
        r += 1
    for rn, row in (place or {}).items():
        _put(ws, rn, row)
    if blank_rows:
        fill = PatternFill("solid", fgColor="EEEEEE")
        for rn in range(1, blank_rows + 1):
            for cn in range(1, 19):
                if ws.cell(rn, cn).value is None:
                    ws.cell(rn, cn).fill = fill
    if time_slots:
        add_time_slots(wb, grid)
    if availability:
        wb.create_sheet("Availability").cell(1, 1, "Room availability")
    wb.save(path)
    return wb


def _put(ws, rn, row):
    for col, val in row.items():
        if val is not None:
            ws[f"{col}{rn}"] = val
