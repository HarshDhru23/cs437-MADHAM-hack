"""CR-109 (CP-32): an import preview holds every parsed grade, so it is emptied as soon as it is used, and expired previews of any student are
deleted by anyone's next import or commit. (The Azure startup command also runs `purge_previews`; see docs/operations/azure.md.)"""
from datetime import timedelta
from django.test import Client, TestCase
from django.utils import timezone
from server.records.models import ImportPreview
from server.records.testing import AccountAPIMixin
from tests.imports.test_ims import TABLE


class PreviewRetentionTests(AccountAPIMixin, TestCase):
    def preview(self, client, revision=0):
        response = self.request(client, 'post', '/imports/preview', {'kind': 'ims', 'text': TABLE, 'expected_revision': revision})
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()['data']

    def commit(self, client, preview, revision=0):
        return self.request(client, 'post', f"/imports/{preview['id']}/commit",
                            {'expected_revision': revision, 'accepted_candidate_ids': [a['id'] for a in preview['candidate_attempts']], 'resolutions': {}})

    def student(self, name):
        client = Client()
        self.signup(client, name)
        return client

    def test_cp32_after_a_commit_no_preview_row_still_holds_the_grades(self):
        client = self.student('retention-student')
        preview = self.preview(client)
        self.assertEqual(self.commit(client, preview).status_code, 200)
        rows = ImportPreview.objects.filter(owner__username='retention-student')
        self.assertTrue(rows.exists(), 'the row stays so a second commit is refused, not forgotten')
        for row in rows:
            self.assertFalse(row.payload.get('candidate_attempts'), row.payload)
            self.assertFalse(row.payload.get('attempts'), row.payload)
            self.assertEqual(row.payload, {})
            self.assertIsNotNone(row.committed_at)

    def test_cp32_a_second_commit_of_the_same_preview_is_still_a_409(self):
        client = self.student('twice-student')
        preview = self.preview(client)
        self.assertEqual(self.commit(client, preview).status_code, 200)
        self.assertEqual(self.commit(client, preview).status_code, 409)

    def test_cp32_a_restored_backup_leaves_no_grades_in_its_preview_row(self):
        client = self.student('backup-student')
        self.assertEqual(self.commit(client, self.preview(client)).status_code, 200)
        backup = client.get('/api/v1/export').json()
        revision = client.get('/api/v1/record').json()['data']['revision']
        preview = self.request(client, 'post', '/imports/backup-preview', {'expected_revision': revision, 'backup': backup}).json()['data']
        done = self.request(client, 'post', f"/imports/{preview['id']}/commit", {'expected_revision': revision, 'confirm': True})
        self.assertEqual(done.status_code, 200, done.content)
        self.assertEqual(ImportPreview.objects.get(pk=preview['id']).payload, {})

    def test_cp32_someone_elses_import_deletes_an_expired_preview_of_another_student(self):
        stale_owner, other = self.student('stale-owner'), self.student('other-student')
        stale = self.preview(stale_owner)
        ImportPreview.objects.filter(pk=stale['id']).update(expires_at=timezone.now() - timedelta(minutes=1))
        self.preview(other)
        self.assertFalse(ImportPreview.objects.filter(pk=stale['id']).exists())

    def test_cp32_someone_elses_commit_deletes_an_expired_preview_of_another_student(self):
        stale_owner, other = self.student('stale-owner-2'), self.student('other-student-2')
        stale = self.preview(stale_owner)
        ImportPreview.objects.filter(pk=stale['id']).update(expires_at=timezone.now() - timedelta(minutes=1))
        self.assertEqual(self.commit(other, self.preview(other)).status_code, 200)
        self.assertFalse(ImportPreview.objects.filter(pk=stale['id']).exists())

    def test_cp32_an_unexpired_preview_of_another_student_is_left_alone(self):
        # Negative: the purge removes only what has expired.
        waiting, other = self.student('waiting-student'), self.student('busy-student')
        kept = self.preview(waiting)
        self.assertEqual(self.commit(other, self.preview(other)).status_code, 200)
        row = ImportPreview.objects.get(pk=kept['id'])
        self.assertTrue(row.payload['candidate_attempts'])
        self.assertIsNone(row.committed_at)
