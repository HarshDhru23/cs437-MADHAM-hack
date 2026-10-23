from django.core.management.base import BaseCommand, CommandError
from coursepath.rules.loader import load_curriculum
from server.records.models import RuleSnapshot


class Command(BaseCommand):
    help = 'Validate and ingest a versioned curriculum. Does not approve sources.'

    def add_arguments(self, parser):
        parser.add_argument('path')
        parser.add_argument('--draft', action='store_true')

    def handle(self, *args, **options):
        try:
            data = load_curriculum(options['path'])
            if data['review_status'] != 'reviewed' and not options['draft']:
                raise ValueError('Draft/conflicted sources require --draft; they remain unapproved')
            snapshot = RuleSnapshot(version=data['version'], payload=data, reviewed=data['review_status'] == 'reviewed')
            if RuleSnapshot.objects.filter(pk=snapshot.pk).exists():
                raise ValueError('Publish a new version instead of overwriting a snapshot')
            snapshot.save(force_insert=True)
        except (ValueError, OSError) as exc:
            raise CommandError(str(exc)) from exc
        self.stdout.write('Stored ' + data['version'] + ' (' + data['review_status'] + ')')
