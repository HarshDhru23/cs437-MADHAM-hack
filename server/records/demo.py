"""CR-137: the sample student. A visitor can press "Try with a sample student" and get a fresh, throw-away account holding a made-up record
(`data/demo/sample-student.json`: real course codes, invented grades). The account is its own user with its own rows, so nothing is shared with a
real student; it has no password and no email, so no sign-in form can reach it; and it is deleted when the visitor leaves it or after a few hours."""
import json
import secrets
from copy import deepcopy
from datetime import timedelta
from functools import lru_cache

from django.conf import settings
from django.contrib.auth.models import User
from django.db import transaction
from django.utils import timezone

from server.records.models import AcademicRecord, DemoAccount
from server.records.services import replace_record

SAMPLE_FILE = settings.BASE_DIR / 'data' / 'demo' / 'sample-student.json'


class DemoFull(Exception):
    """Too many sample accounts are alive at once."""


@lru_cache(maxsize=1)
def sample_attempts():
    return json.loads(SAMPLE_FILE.read_text(encoding='utf-8'))['attempts']


def is_demo(user):
    return bool(user is not None and user.is_authenticated and DemoAccount.objects.filter(owner=user).exists())


def purge_expired(now=None):
    """Delete the sample accounts older than COURSEPATH_DEMO_HOURS, with everything they own. Returns how many went."""
    cutoff = (now or timezone.now()) - timedelta(hours=settings.COURSEPATH_DEMO_HOURS)
    expired = User.objects.filter(demoaccount__created_at__lt=cutoff)
    count = expired.count()
    expired.delete()
    return count


@transaction.atomic
def start_demo():
    """A new sample account with the made-up record saved in it. Raises DemoFull when the limit of live sample accounts is reached."""
    purge_expired()
    if DemoAccount.objects.count() >= settings.COURSEPATH_DEMO_MAX:
        raise DemoFull
    user = User.objects.create_user(username='sample-' + secrets.token_hex(6))   # no password given: the account is unusable for password sign-in
    DemoAccount.objects.create(owner=user)
    record = AcademicRecord.objects.create(owner=user)
    replace_record(record, 0, deepcopy(sample_attempts()))
    return user


def leave_demo(user):
    """The visitor is done: delete the account and everything it owns."""
    if is_demo(user):
        user.delete()
