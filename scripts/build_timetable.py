"""Build a draft offering snapshot and ingestion report from a timetable XLSX.

    python scripts/build_timetable.py --input <path> --term 2026-27-I \
        --output <draft.json> --report <report.json>

Exit codes: 0 ok, 1 usage/input/validation failure (nothing written),
2 snapshot written but the report contains error issues.
The source workbook is only read. The draft stays unreviewed until Harsh's review.
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from coursepath.data_sources.timetable_xlsx import build_snapshot, validate_snapshot  # noqa: E402


def _write(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, sort_keys=True, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--input", required=True, help="timetable .xlsx (read only)")
    p.add_argument("--term", required=True, help="supplied term, e.g. 2026-27-I")
    p.add_argument("--output", required=True, help="draft snapshot JSON path")
    p.add_argument("--report", required=True, help="ingestion report JSON path")
    p.add_argument("--source-id", default="SRC-TIMETABLE")
    args = p.parse_args(argv)

    if not Path(args.input).is_file():
        print(f"error: input not found: {args.input}", file=sys.stderr)
        return 1
    try:
        snapshot, report = build_snapshot(args.input, args.term, args.source_id)
    except (ValueError, RuntimeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    problems = validate_snapshot(snapshot)
    if problems:
        print("error: snapshot failed validation:\n  " + "\n  ".join(problems), file=sys.stderr)
        return 1
    _write(args.output, snapshot)
    _write(args.report, report)
    errors = sum(1 for i in report["issues"] if i["severity"] == "error")
    print(f"{len(snapshot['offerings'])} offerings, {len(snapshot['slot_map'])} slots, "
          f"{len(report['issues'])} issues ({errors} errors) -> {args.output}")
    return 2 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
