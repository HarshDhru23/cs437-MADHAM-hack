from django.core.management.base import BaseCommand
from django.utils import timezone
from server.records.models import ImportPreview


class Command(BaseCommand):
    help = 'Delete expired import previews; they hold unreviewed grades. Run on a schedule in production.'

    def handle(self, *args, **options):
        count, _ = ImportPreview.objects.filter(expires_at__lte=timezone.now()).delete()
        self.stdout.write(f'Deleted {count} expired import preview rows')
