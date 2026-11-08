"""Read-only timetable workbook adapter.

Turns a supplied timetable XLSX into a plain-data offering snapshot plus an
ingestion report (docs/team/contracts.md section 5). No Django, persistence,
network access, academic allocation or modification of the source file.
"""
import hashlib
import re
import unicodedata
import warnings
from decimal import Decimal, InvalidOperation
from pathlib import Path

SCHEMA_VERSION = "1"
SHEET_TIMETABLE = "Time table"
SHEET_SLOTS = "Time Slots"
SHEET_AVAILABILITY = "Availability"

# Time table columns (docs/team/manashree.md M02 step 2).
COL_CODE, COL_TITLE, COL_CREDITS, COL_SECTIONS = "A", "B", "F", "J"
COL_MEETINGS = {"lecture": "K", "tutorial": "L", "lab": "M"}
COL_LINK, COL_PREF, COL_REMARKS, COL_MINOR, COL_TAGS = "N", "O", "P", "Q", "R"
REQUIRED_HEADERS = {"A": ("course",), "F": ("credit", "c"), "K": ("lecture",), "L": ("tutorial",), "M": ("lab",)}
OPTIONAL_HEADERS = {"J": ("section",), "N": ("link", "plan"), "O": ("prefer",), "P": ("remark",), "Q": ("minor",), "R": ("hss", "bs")}
HEADER_SCAN_ROWS = 15

TERM_RE = re.compile(r"^\d{4}-\d{2}-(I|II|SUMMER)$")
LABEL_RE = re.compile(r"^([A-Za-z]{2,3})\s*(\d{3})(\s*)(.*)$")
SLOT_RE = re.compile(r"^[A-Za-z]\d$")
# One slot token, optionally followed by its own parenthesised rooms, then an optional separator.
SLOT_ITEM_RE = re.compile(r"\s*([A-Za-z]\d)\b[\s\-:]*(?:\(([^)]*)\))?\s*[,;&+]?")
PAREN_RE = re.compile(r"^\((.*)\)$")
TIME_RE = re.compile(r"(\d{1,2})[:.](\d{2})\s*(?:[-‐-―−]|to)\s*(\d{1,2})[:.](\d{2})")
DELIVERY_RE = re.compile(r"^\(?(online|remote|hybrid)\)?$", re.I)
WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
# The supplied slot sheet uses "M, T, W, Th, F"; "T" is Tuesday and "Th" Thursday.
WEEKDAY_ALIASES = {"m": 0, "mon": 0, "t": 1, "tu": 1, "tue": 1, "tues": 1, "w": 2, "wed": 2, "th": 3, "thu": 3,
                   "thur": 3, "thurs": 3, "f": 4, "fri": 4, "sa": 5, "sat": 5, "su": 6, "sun": 6}


def _text(value):
    if value is None:
        return ""
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", str(value))).strip()


def _lines(value):
    """Cell text as normalized non-empty lines; line breaks carry meaning in meeting and section cells."""
    if value is None:
        return []
    text = unicodedata.normalize("NFKC", str(value)).replace("\r", "\n")
    return [re.sub(r"\s+", " ", line).strip() for line in text.split("\n") if line.strip()]


def _norm(value):
    return _text(value).casefold()


def _weekday(value):
    n = _norm(value).rstrip(".")
    if n in WEEKDAYS:
        return WEEKDAYS.index(n)
    return WEEKDAY_ALIASES.get(n)


def _rooms(text):
    return [r.strip() for r in text.split(",") if r.strip()]


class _Report:
    def __init__(self, source_id):
        self.source_id = source_id
        self.issues = []

    def add(self, code, severity, message, locator=None, entity_refs=(), action=None):
        self.issues.append({
            "code": code,
            "severity": severity,
            "message": message,
            "entity_refs": sorted(entity_refs),
            "source_refs": [{"id": self.source_id, "locator": locator}] if locator else [],
            "suggested_action": action,
        })

    def has_errors(self):
        return any(i["severity"] == "error" for i in self.issues)


def build_snapshot(path, term_id, source_id):
    """Return (snapshot, ingestion_report) for the workbook at `path`."""
    if not TERM_RE.match(term_id or ""):
        raise ValueError(f"term_id must look like 2026-27-I, got {term_id!r}")
    try:
        from openpyxl import load_workbook
    except ImportError as exc:
        raise RuntimeError("openpyxl is required to read timetable workbooks: pip install openpyxl") from exc

    path = Path(path)
    rep = _Report(source_id)
    raw = path.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    snapshot = {
        "schema_version": SCHEMA_VERSION,
        "id": f"timetable-{term_id}",
        "term_id": term_id,
        "source_refs": [{
            "id": source_id, "kind": "timetable", "title": path.name, "version": None,
            "applicable_cohorts": [], "effective_date": None, "file_sha256": digest,
            "locator": f"{SHEET_TIMETABLE}; {SHEET_SLOTS}; {SHEET_AVAILABILITY}",
            "review_status": "draft", "authority": None, "retrieved_at": None,
            "notes": "Supplied workbook; publication, revision and finality not established by the file.",
        }],
        "coverage": "unknown",
        "review_status": "draft",
        "publication_status": "unestablished",
        "revision_date": None,
        "offerings": [],
        "slot_map": {},
        "unresolved_rows": [],
        "issues": rep.issues,
    }
    report = {
        "source_id": source_id, "file_sha256": digest, "term_id": term_id,
        "sheets": [], "reader_warnings": [], "stats": {}, "issues": rep.issues,
    }

    try:
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            wb = load_workbook(path, data_only=True)
        report["reader_warnings"] = sorted({str(w.message) for w in caught})
    except Exception as exc:  # corrupt/unsupported container
        rep.add("FILE_UNREADABLE", "error", f"Workbook could not be read: {exc}",
                action="Provide an unmodified .xlsx export of the timetable.")
        return snapshot, report

    report["sheets"] = list(wb.sheetnames)
    sheets = {_norm(n): wb[n] for n in wb.sheetnames}

    slots_ws = sheets.get(_norm(SHEET_SLOTS))
    if slots_ws is None:
        rep.add("SHEET_MISSING", "error", f"Sheet '{SHEET_SLOTS}' not found; meeting slots cannot be resolved.",
                action="Supply the workbook with its slot legend sheet.")
    else:
        snapshot["slot_map"] = _parse_slots(slots_ws, rep)

    tt_ws = sheets.get(_norm(SHEET_TIMETABLE))
    stats = {"course_pattern_rows": 0, "distinct_labels": 0, "duplicate_labels": 0,
             "section_rows": 0, "unrecognized_rows": 0, "merged_duplicate_rows": 0}
    if tt_ws is None:
        rep.add("SHEET_MISSING", "error", f"Sheet '{SHEET_TIMETABLE}' not found; no offerings extracted.",
                action="Supply the workbook with the course timetable sheet.")
    else:
        _parse_timetable(tt_ws, term_id, source_id, snapshot, rep, stats)

    av_ws = sheets.get(_norm(SHEET_AVAILABILITY))
    if av_ws is None:
        rep.add("SHEET_MISSING", "warning", f"Sheet '{SHEET_AVAILABILITY}' not found; room/slot cross-check skipped.")
    else:
        _check_availability(av_ws, snapshot, rep)

    report["stats"] = stats
    return snapshot, report


def _parse_slots(ws, rep):
    name = ws.title
    header_row, day_cols = None, {}
    for r in range(1, min(ws.max_row, 6) + 1):
        cols = {c: _weekday(ws.cell(r, c).value) for c in range(2, ws.max_column + 1)}
        found = {c: d for c, d in cols.items() if d is not None}
        if len(found) >= 3:
            header_row, day_cols = r, found
            break
    if header_row is None:
        rep.add("SLOT_SHEET_LAYOUT", "error", "No weekday header row found in the slot sheet.",
                locator=f"{name}!A1", action="Confirm the slot sheet layout (weekday columns, time rows).")
        return {}
    for c in range(2, ws.max_column + 1):
        v = _text(ws.cell(header_row, c).value)
        if v and c not in day_cols:
            rep.add("SLOT_SHEET_LAYOUT", "warning", f"Unrecognized header '{v}' in the slot sheet; column ignored.",
                    locator=f"{name}!{ws.cell(header_row, c).coordinate}")

    slots, conflicted = {}, set()
    for r in range(header_row + 1, ws.max_row + 1):
        label = _text(ws.cell(r, 1).value)
        cells = {c: _text(ws.cell(r, c).value) for c in day_cols}
        if not label and not any(cells.values()):
            continue
        if "lunch" in label.casefold() or all("lunch" in v.casefold() for v in cells.values() if v):
            continue
        m = TIME_RE.search(label)
        start = int(m[1]) * 60 + int(m[2]) if m else None
        end = int(m[3]) * 60 + int(m[4]) if m else None
        if m is None or end <= start:
            rep.add("SLOT_TIME_INVALID", "error", f"Time label '{label}' is not a valid start-end interval.",
                    locator=f"{name}!A{r}", action="Correct the slot sheet time label.")
            continue
        for c, token in cells.items():
            coord = ws.cell(r, c).coordinate
            if not token or "lunch" in token.casefold():
                continue
            if not SLOT_RE.match(token):
                rep.add("SLOT_CELL_UNPARSED", "warning", f"Slot cell '{token}' is not a recognized slot token.",
                        locator=f"{name}!{coord}")
                continue
            token = token.upper()
            entry = {"weekday": day_cols[c], "start_minute": start, "end_minute": end,
                     "label": label, "locator": f"{name}!{coord}"}
            old = slots.get(token)
            if old is None:
                slots[token] = entry
            elif (old["weekday"], old["start_minute"], old["end_minute"]) != (entry["weekday"], start, end):
                conflicted.add(token)
                rep.add("SLOT_DEFINITION_CONFLICT", "error",
                        f"Slot {token} is defined at conflicting times ({old['locator']}, {entry['locator']}).",
                        locator=entry["locator"], action="Resolve which definition is correct.")
    for token in conflicted:
        del slots[token]
    return {k: slots[k] for k in sorted(slots)}


def _header_has(value, keywords):
    n = _norm(value)
    return any(n == k if len(k) == 1 else k in n for k in keywords)


def _find_header(ws, rep):
    for r in range(1, min(ws.max_row, HEADER_SCAN_ROWS) + 1):
        if "course" in _norm(ws[f"{COL_CODE}{r}"].value):
            missing = [col for col, kws in REQUIRED_HEADERS.items() if not _header_has(ws[f"{col}{r}"].value, kws)]
            if missing:
                rep.add("HEADER_MISMATCH", "error",
                        "Time table headers do not match the supported layout in column(s) "
                        + ", ".join(missing) + ".", locator=f"{ws.title}!A{r}",
                        action="Check for a renamed or restructured workbook before ingesting.")
                return None
            for col, kws in OPTIONAL_HEADERS.items():
                if not _header_has(ws[f"{col}{r}"].value, kws):
                    rep.add("HEADER_MISMATCH", "warning",
                            f"Optional column {col} header does not look like '{kws[0]}'; its values are still read.",
                            locator=f"{ws.title}!{col}{r}")
            return r
    rep.add("HEADER_MISMATCH", "error", "No header row (course number column) found in the Time table sheet.",
            locator=f"{ws.title}!A1")
    return None


def _parse_credits(value, rep, locator):
    s = _text(value)
    if not s:
        rep.add("CREDITS_INVALID", "warning", "Credits (column F) are empty.", locator=locator)
        return None
    try:
        d = Decimal(s)
        if not d.is_finite() or d < 0:
            raise InvalidOperation
    except InvalidOperation:
        rep.add("CREDITS_INVALID", "warning", f"Credits '{s}' are not a non-negative decimal.", locator=locator)
        return None
    return format(d.normalize(), "f")


def _apply_extra(entries, extra):
    """Room pool or delivery note that applies to every slot of a line still lacking one."""
    if DELIVERY_RE.match(extra) or DELIVERY_RE.match(f"({extra})"):
        for e in entries:
            e["delivery_note"] = extra.strip("()")
        return True
    paren = PAREN_RE.match(extra)
    if paren and entries:
        rooms = _rooms(paren[1])
        if len(rooms) == 1 and DELIVERY_RE.match(rooms[0]):
            for e in entries:
                e["delivery_note"] = rooms[0]
            return True
        for e in entries:
            if not e["room_options"]:
                e["room_options"] = list(rooms)
        return True
    return False


def _parse_meeting_cell(value, slot_map, rep, locator):
    """Return (segments, notes, unresolved).

    Supplied formats: "B1,B2" then a "(room, room)" line shared by those slots, or one line per slot with its
    own rooms ("J2 (10/103,10/104)"). Rooms are never paired with a slot unless the cell says so; a slot with
    several possible rooms keeps them as room_options and no single room."""
    segments, notes, unresolved, previous = [], [], [], []
    for line in _lines(value):
        pos, entries = 0, []
        while True:
            m = SLOT_ITEM_RE.match(line, pos)
            if not m or m.end() == pos:
                break
            entries.append({"slot": m[1].upper(), "room_options": _rooms(m[2]) if m[2] is not None else []})
            pos = m.end()
        rest = line[pos:].strip()
        if entries:
            for e in entries:
                e["delivery_note"] = None
            # "B1,B2 (x)" on one line: a parenthesis after the last of several bare slots is that line's pool.
            if len(entries) > 1 and all(not e["room_options"] for e in entries[:-1]) and entries[-1]["room_options"]:
                pool = entries[-1]["room_options"]
                for e in entries:
                    e["room_options"] = list(pool)
            for e in entries:
                if len(e["room_options"]) == 1 and DELIVERY_RE.match(e["room_options"][0]):
                    e["delivery_note"], e["room_options"] = e["room_options"][0], []
            if rest and not _apply_extra(entries, rest):
                notes.append(rest)
                unresolved.append(rest)
                rep.add("MEETING_TEXT_UNPARSED", "warning", f"Meeting text '{rest}' has no slot token.", locator=locator)
            previous = entries
        elif previous and _apply_extra(previous, line):
            continue
        else:
            notes.append(line)
            if not DELIVERY_RE.match(line):
                unresolved.append(line)
                rep.add("MEETING_TEXT_UNPARSED", "warning", f"Meeting text '{line}' has no slot token.", locator=locator)
            continue
        for e in entries:
            if e["slot"] not in slot_map:
                unresolved.append(e["slot"])
                if slot_map:
                    rep.add("SLOT_UNKNOWN", "warning", f"Slot '{e['slot']}' is not in the slot sheet.", locator=locator)
            elif not any(x["slot"] == e["slot"] for x in segments):
                segments.append(e)
    for e in segments:
        e["room"] = e["room_options"][0] if len(e["room_options"]) == 1 else None
    return segments, notes, unresolved


def _parse_timetable(ws, term_id, source_id, snapshot, rep, stats):
    header = _find_header(ws, rep)
    if header is None:
        return
    slot_map, name = snapshot["slot_map"], ws.title
    labels, entries = [], []
    for r in range(header + 1, ws.max_row + 1):
        values = {c: ws[f"{c}{r}"].value for c in "ABCDEFGHIJKLMNOPQR"}
        if not any(_text(v) for v in values.values()):
            continue
        try:
            label = _text(values["A"])
            m = LABEL_RE.match(label)
            if not m:
                others = any(_text(v) for c, v in values.items() if c != "A")
                if label and not others:
                    stats["section_rows"] += 1
                else:
                    stats["unrecognized_rows"] += 1
                    rep.add("ROW_UNRECOGNIZED", "warning", f"Row {r} is not a recognizable course row.",
                            locator=f"{name}!A{r}", action="Review manually; retained in unresolved_rows.")
                    snapshot["unresolved_rows"].append({
                        "locator": f"{name}!A{r}", "reason": "not_a_course_row",
                        "values": {c: _text(v) for c, v in values.items() if _text(v)}})
                continue
            stats["course_pattern_rows"] += 1
            labels.append(label)
            entries.append(_row_offering(ws, r, m, values, slot_map, source_id, rep))
        except Exception as exc:  # one bad row must not stop the rest
            rep.add("ROW_PARSE_ERROR", "error", f"Row {r} could not be parsed: {exc}", locator=f"{name}!A{r}")
    stats["distinct_labels"] = len(set(labels))
    stats["duplicate_labels"] = sum(1 for lab in set(labels) if labels.count(lab) > 1)
    _merge_and_finalize(entries, term_id, snapshot, rep, stats)


def _row_offering(ws, r, m, values, slot_map, source_id, rep):
    name = ws.title
    loc = lambda col: f"{name}!{col}{r}"
    ref = lambda col="A": {"id": source_id, "locator": loc(col)}
    code = f"{m[1].upper()} {m[2]}"
    suffix = m[4].strip()
    display = code + ((" " if m[3] else "") + suffix if suffix else "")
    groups = []
    for kind, col in COL_MEETINGS.items():
        raw = "\n".join(_lines(values[col]))
        if not raw:
            continue
        segs, notes, unresolved = _parse_meeting_cell(values[col], slot_map, rep, loc(col))
        if not slot_map:
            unresolved = unresolved or [s["slot"] for s in segs] or notes
            segs = []
        if unresolved:
            semantics = "unknown"
        elif kind == "lecture" or len(segs) <= 1:
            semantics = "all_required"
        elif kind in ("lab", "tutorial"):
            # D-26 (Harsh, 7 Nov 2026): the slots of a lab or tutorial are alternatives; each student is assigned to exactly one.
            semantics = "choose_one"
        else:
            semantics = "unknown"
            rep.add("MEETING_SEMANTICS_UNKNOWN", "unknown",
                    f"{display} {kind} lists {len(segs)} slots; whether they are all required or alternatives is not stated.",
                    locator=loc(col), action="Confirm section/group meaning with the timetable owner.")
        meetings = [{
            "kind": kind, "weekday": slot_map[s["slot"]]["weekday"],
            "start_minute": slot_map[s["slot"]]["start_minute"],
            "end_minute": slot_map[s["slot"]]["end_minute"],
            "active_start_date": None, "active_end_date": None,
            "room": s["room"], "room_options": s["room_options"], "delivery_note": s["delivery_note"],
            "original_slot": s["slot"], "source_refs": [ref(col)],
        } for s in segs]
        # The sheet lists sections per course (column J), not per meeting group.
        groups.append({"kind": kind, "raw_text": raw, "selection_semantics": semantics, "section_labels": [],
                       "notes": notes, "unresolved": unresolved, "meetings": meetings,
                       "source_refs": [ref(col)]})
    link_cell = ws[loc(COL_LINK).split("!")[1]]
    link_text = _text(link_cell.value)
    hyperlink = link_cell.hyperlink
    target = (hyperlink.target or hyperlink.location) if hyperlink else None
    link = None
    if link_text or target:
        link = {"target": target, "display_text": link_text or None, "locator": loc(COL_LINK)}
    sections = _lines(values[COL_SECTIONS])
    tags = _text(values[COL_TAGS])
    return {
        "code": code, "display_code": display, "raw_label": _text(values["A"]), "suffix": suffix or None,
        "title": _text(values[COL_TITLE]) or None,
        "credits": _parse_credits(values[COL_CREDITS], rep, loc(COL_CREDITS)),
        "section_labels": sections,
        "meeting_groups": groups,
        "course_plan_link": link,
        "preferred_knowledge": _text(values[COL_PREF]) or None,
        "remarks": _text(values[COL_REMARKS]) or None,
        "minor_hint": _text(values[COL_MINOR]) or None,
        "classification_tag_candidates": [tags] if tags else [],
        "prerequisites_status": "unknown",
        "catalogue_match_status": "not_checked",
        "catalogue_version_id": None,
        "availability_status": "confirmed_in_snapshot",
        "field_locators": {"credits": loc(COL_CREDITS), "title": loc(COL_TITLE)},
        "source_refs": [ref()],
        "_row": r,
    }


def _signature(o):
    return (o["display_code"], o["title"], o["credits"], tuple(o["section_labels"]),
            tuple((g["kind"], g["raw_text"]) for g in o["meeting_groups"]),
            (o["course_plan_link"] or {}).get("target"), o["preferred_knowledge"],
            o["minor_hint"], o["remarks"], tuple(o["classification_tag_candidates"]))


def _merge_and_finalize(entries, term_id, snapshot, rep, stats):
    merged = {}
    for o in entries:
        sig = _signature(o)
        first = merged.get(sig)
        if first is None:
            merged[sig] = o
            continue
        stats["merged_duplicate_rows"] += 1
        first["source_refs"].extend(o["source_refs"])
        for g1, g2 in zip(first["meeting_groups"], o["meeting_groups"]):
            g1["source_refs"].extend(g2["source_refs"])
            for m1, m2 in zip(g1["meetings"], g2["meetings"]):
                m1["source_refs"].extend(m2["source_refs"])
    ordered = sorted(merged.values(), key=lambda o: (o["code"], o["display_code"], o["_row"]))
    by_display = {}
    for o in ordered:
        by_display.setdefault(o["display_code"], []).append(o)
    for display, variants in by_display.items():
        for i, o in enumerate(variants, 1):
            o["id"] = f"{term_id}:{display.replace(' ', '')}" + (f"#v{i}" if len(variants) > 1 else "")
        if len(variants) > 1:
            rep.add("DUPLICATE_CODE_CONFLICT", "warning",
                    f"{display} appears {len(variants)} times with different credits, title, sections or meetings; all retained.",
                    locator=variants[0]["source_refs"][0]["locator"], entity_refs=[v["id"] for v in variants],
                    action="Decide which variant is authoritative or whether they are separate sections.")
    for o in ordered:
        o["term_id"] = term_id
        for g in o["meeting_groups"]:
            g["id"] = f"{o['id']}:{g['kind']}"
            for m in g["meetings"]:
                m["id"] = f"{g['id']}:{m['original_slot']}"
                m["offering_id"], m["group_id"] = o["id"], g["id"]
        del o["_row"]
    snapshot["offerings"] = ordered
    for field, col, meaning in [("preferred_knowledge", COL_PREF, "preferred knowledge"), ("minor_hint", COL_MINOR, "minor hints")]:
        empty = sum(1 for o in ordered if o[field] is None)
        if empty:
            rep.add("SOURCE_COLUMN_EMPTY", "unknown",
                    f"Column {col} ({meaning}) is empty for {empty} of {len(ordered)} offerings. An empty cell says nothing "
                    "about prerequisites or minor eligibility; prerequisites stay unknown.",
                    action="Obtain the approved prerequisite and minor lists; do not read an empty cell as 'none'.")


def _check_availability(ws, snapshot, rep):
    by_code = {}
    for o in snapshot["offerings"]:
        slots = by_code.setdefault(o["code"], set())
        for g in o["meeting_groups"]:
            slots.update(m["original_slot"] for m in g["meetings"])
            slots.update(u.upper() for u in g["unresolved"])
    for r in range(1, ws.max_row + 1):
        codes, tokens = [], []
        for c in range(1, ws.max_column + 1):
            t = _text(ws.cell(r, c).value)
            m = LABEL_RE.match(t)
            if m:
                codes.append(f"{m[1].upper()} {m[2]}")
            elif SLOT_RE.match(t):
                tokens.append(t.upper())
        first = _text(ws.cell(r, 1).value)
        if SLOT_RE.match(first):
            # Supplied layout: slot in column A, one column per room, course codes in the cells.
            pairs = [(code, first.upper()) for code in dict.fromkeys(codes)]
        elif len(codes) == 1 and tokens:
            pairs = [(codes[0], token) for token in tokens]
        else:
            continue
        for code, token in pairs:
            if code not in by_code:
                rep.add("AVAILABILITY_MISMATCH", "warning",
                        f"Availability lists {code} in {token}, but the course is not in the Time table.",
                        locator=f"{ws.title}!A{r}", action="Review; Availability does not add offerings.")
            elif token not in by_code[code]:
                rep.add("AVAILABILITY_MISMATCH", "warning",
                        f"Availability lists {code} in {token}, which its Time table row does not use.",
                        locator=f"{ws.title}!A{r}", action="Review; the Time table row is kept unchanged.")


def validate_snapshot(snapshot):
    """Structural self-check. Returns a list of problems (empty when valid).

    The shared JSON schema is owned by Harsh (H01); this guards the fields the
    contract requires until that schema can be applied directly."""
    problems = []
    for key in ("schema_version", "id", "term_id", "source_refs", "coverage", "review_status",
                "offerings", "slot_map", "unresolved_rows", "issues"):
        if key not in snapshot:
            problems.append(f"missing {key}")
    for o in snapshot.get("offerings", []):
        for key in ("id", "code", "display_code", "credits", "meeting_groups", "source_refs", "availability_status"):
            if key not in o:
                problems.append(f"offering {o.get('id')} missing {key}")
        for g in o.get("meeting_groups", []):
            if g.get("selection_semantics") not in ("all_required", "choose_one", "unknown"):
                problems.append(f"{g.get('id')} has invalid selection_semantics")
            for m in g.get("meetings", []):
                if not (0 <= m["weekday"] <= 6 and 0 <= m["start_minute"] < m["end_minute"] <= 1440):
                    problems.append(f"{m.get('id')} has invalid time")
    return problems
