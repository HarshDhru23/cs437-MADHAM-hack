import hashlib
import json
from pathlib import Path
from django.core.management.base import BaseCommand, CommandError
from coursepath.data_sources.timetable_xlsx import validate_snapshot
from coursepath.models import validate_term_id
from server.records.models import OfferingSnapshot


class Command(BaseCommand):
    help = 'Validate and store a term offering snapshot built by scripts/build_timetable.py. Staff only; never a student action.'

    def add_arguments(self, parser):
        parser.add_argument('path')
        state = parser.add_mutually_exclusive_group()
        state.add_argument('--reviewed', action='store_true', help='Record that staff reviewed this snapshot against its source.')
        state.add_argument('--draft', action='store_true', help='Store an unreviewed snapshot; offerings stay tentative.')
        parser.add_argument('--coverage', choices=['complete', 'partial', 'unknown'], help='Reviewed coverage; defaults to the file value.')

    def handle(self, *args, **options):
        try:
            data = json.loads(Path(options['path']).read_text(encoding='utf-8'))
            problems = validate_snapshot(data)
            if problems:
                raise ValueError('Snapshot failed validation: ' + '; '.join(problems[:5]))
            if not options['reviewed'] and not options['draft']:
                raise ValueError('Pass --reviewed after staff review, or --draft to keep offerings tentative')
            validate_term_id(data['term_id'])
            data['review_status'] = 'reviewed' if options['reviewed'] else 'draft'
            if options['coverage']:
                data['coverage'] = options['coverage']
            # The version names the stored content, so a corrected snapshot of the same workbook is a new version.
            canonical = json.dumps(data, sort_keys=True, separators=(',', ':'), ensure_ascii=False)
            digest = hashlib.sha256(canonical.encode('utf-8')).hexdigest()
            version = f"{data['id']}@{digest[:12]}:{data['review_status']}"
            if OfferingSnapshot.objects.filter(pk=version).exists():
                raise ValueError('This snapshot version is already stored; publish a new version instead of overwriting')
            OfferingSnapshot(version=version, term_id=data['term_id'], payload=data, reviewed=options['reviewed']).save(force_insert=True)
        except (ValueError, OSError, KeyError) as exc:
            raise CommandError(str(exc)) from exc
        self.stdout.write(f"Stored {version}: {len(data['offerings'])} offerings ({data['review_status']}, coverage {data['coverage']})")
