import uuid
from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models


def empty_profile():
    return {'programme': 'BTECH_CSE', 'admission_year': 2024, 'curriculum_version': 'cse-2024-v1'}


class Owned(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)

    class Meta:
        abstract = True


class AcademicRecord(Owned):
    owner = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    revision = models.PositiveIntegerField(default=0)
    profile = models.JSONField(default=empty_profile)
    current_enrolment = models.JSONField(default=list)
    reported_controls = models.JSONField(default=list)


class Attempt(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    record = models.ForeignKey(AcademicRecord, on_delete=models.CASCADE, related_name='attempts')
    attempt_key = models.CharField(max_length=160)
    normalized_code = models.CharField(max_length=100)
    term_id = models.CharField(max_length=24)
    credits = models.DecimalField(max_digits=9, decimal_places=4)
    grade = models.CharField(max_length=24)
    payload = models.JSONField()

    class Meta:
        constraints = [models.UniqueConstraint(fields=['record', 'attempt_key'], name='unique_record_attempt')]
        indexes = [models.Index(fields=['record', 'term_id'])]


class ImportPreview(Owned):
    record = models.ForeignKey(AcademicRecord, on_delete=models.CASCADE)
    base_record_revision = models.PositiveIntegerField()
    payload = models.JSONField()
    expires_at = models.DateTimeField(db_index=True)
    committed_at = models.DateTimeField(null=True)


class AcademicPlan(Owned):
    revision = models.PositiveIntegerField(default=0)
    payload = models.JSONField(default=dict)


class Scenario(Owned):
    plan = models.ForeignKey(AcademicPlan, on_delete=models.CASCADE)
    revision = models.PositiveIntegerField(default=0)
    baseline_record_revision = models.PositiveIntegerField()
    baseline_plan_revision = models.PositiveIntegerField()
    rule_version = models.CharField(max_length=100)
    payload = models.JSONField(default=dict)


class ApprovalEvidence(Owned):
    policy_id = models.CharField(max_length=100)
    status = models.CharField(max_length=24, default='unsubmitted', choices=[(s, s) for s in ['unsubmitted', 'user_reported', 'verified', 'rejected']])
    covered_entities = models.JSONField(default=list)
    source_refs = models.JSONField(default=list)
    verifier = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, related_name='verified_evidence')
    verified_at = models.DateTimeField(null=True)

    def clean(self):
        if self.status == 'verified' and (not self.verifier_id or not self.verifier.is_staff or not self.verified_at or not self.source_refs):
            raise ValidationError('Verification requires staff, date and source evidence')


class RuleSnapshot(models.Model):
    version = models.CharField(primary_key=True, max_length=100)
    payload = models.JSONField()
    reviewed = models.BooleanField(default=False)

    def save(self, *args, **kwargs):
        if self.pk and type(self).objects.filter(pk=self.pk, reviewed=True).exists():
            raise ValidationError('Reviewed snapshots are immutable; publish a new version')
        super().save(*args, **kwargs)


class OfferingSnapshot(models.Model):
    """A staff-loaded term timetable. Reviewed versions are immutable."""
    version = models.CharField(primary_key=True, max_length=160)
    term_id = models.CharField(max_length=24, db_index=True)
    payload = models.JSONField()
    reviewed = models.BooleanField(default=False)
    loaded_at = models.DateTimeField(auto_now_add=True)

    def save(self, *args, **kwargs):
        if self.pk and type(self).objects.filter(pk=self.pk, reviewed=True).exists():
            raise ValidationError('Reviewed snapshots are immutable; publish a new version')
        super().save(*args, **kwargs)


class LoginThrottle(models.Model):
    key = models.CharField(primary_key=True, max_length=64)
    attempts = models.PositiveIntegerField(default=0)
    window_start = models.DateTimeField()
