from copy import deepcopy
from datetime import timedelta
from unittest.mock import patch
from django.db import DatabaseError
from django.test import Client, TestCase
from django.utils import timezone
from server.records.testing import AccountAPIMixin
from server.records.models import AcademicRecord, ImportPreview
from tests.imports.test_ims import TABLE
from tests.imports.test_pdf import transcript
from django.core.files.uploadedfile import SimpleUploadedFile


class ImportAPITests(AccountAPIMixin, TestCase):
    def setUp(self):
        self.client = Client(enforce_csrf_checks=True)
        self.signup(self.client, 'import-owner')

    def preview(self, text=TABLE):
        result = self.request(self.client, 'post', '/imports/preview', {'kind': 'ims', 'text': text, 'expected_revision': 0})
        self.assertEqual(result.status_code, 201, result.content)
        return result.json()['data']

    def test_cp08_commit_reload_and_unchanged_reimport(self):
        preview = self.preview()
        self.assertEqual(self.client.get('/api/v1/record').json()['data']['attempts'], [])
        payload = {'expected_revision': 0, 'accepted_candidate_ids': [a['id'] for a in preview['candidate_attempts']], 'resolutions': {}}
        result = self.request(self.client, 'post', f"/imports/{preview['id']}/commit", payload)
        self.assertEqual(result.status_code, 200, result.content)
        self.assertEqual(len(self.client.get('/api/v1/record').json()['data']['attempts']), 5)
        self.assertEqual(self.request(self.client, 'post', f"/imports/{preview['id']}/commit", payload).status_code, 409)

    def test_cp09_foreign_expired_preview_and_transaction_rollback(self):
        preview = self.preview()
        other = Client()
        self.signup(other, 'other-import')
        path = f"/imports/{preview['id']}/commit"
        payload = {'expected_revision': 0, 'accepted_candidate_ids': [a['id'] for a in preview['candidate_attempts']], 'resolutions': {}}
        self.assertEqual(self.request(other, 'post', path, payload).status_code, 404)
        with patch('server.records.services.Attempt.objects.bulk_create', side_effect=DatabaseError('synthetic failure')):
            with self.assertRaises(DatabaseError):
                self.request(self.client, 'post', path, payload)
        self.assertEqual(AcademicRecord.objects.get(owner__username='import-owner').revision, 0)
        self.assertFalse(ImportPreview.objects.get(pk=preview['id']).committed_at)
        ImportPreview.objects.filter(pk=preview['id']).update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.request(self.client, 'post', path, payload).status_code, 422)

    def test_unknown_grade_rejected_without_record_mutation(self):
        preview = self.preview(TABLE.replace('\tA\n', '\tZ\n'))
        result = self.request(self.client, 'post', f"/imports/{preview['id']}/commit", {'expected_revision': 0, 'accepted_candidate_ids': [a['id'] for a in preview['candidate_attempts']], 'resolutions': {}})
        self.assertEqual(result.status_code, 422)
        self.assertEqual(AcademicRecord.objects.get(owner__username='import-owner').revision, 0)

    def test_pdf_preview_commit_retains_reported_controls_separately(self):
        token = self.client.cookies['csrftoken'].value
        preview_response = self.client.post('/api/v1/imports/preview', {'expected_revision': '0', 'file': SimpleUploadedFile('synthetic.pdf', transcript(), content_type='application/pdf')}, HTTP_X_CSRFTOKEN=token)
        self.assertEqual(preview_response.status_code, 201, preview_response.content)
        preview = preview_response.json()['data']
        self.assertEqual(preview['extracted_controls']['raw_credits'], '16')
        result = self.request(self.client, 'post', f"/imports/{preview['id']}/commit", {'expected_revision': 0, 'accepted_candidate_ids': [a['id'] for a in preview['candidate_attempts']], 'resolutions': {}})
        self.assertEqual(result.status_code, 200, result.content)
        self.assertEqual(result.json()['data']['reported_controls'][0]['controls']['cpi'], '10.00')

    def test_record_edit_requires_justification_and_preserves_source_history(self):
        preview = self.preview()
        accepted = self.request(self.client, 'post', f"/imports/{preview['id']}/commit", {'expected_revision': 0, 'accepted_candidate_ids': [a['id'] for a in preview['candidate_attempts']], 'resolutions': {}}).json()['data']
        rows = deepcopy(accepted['attempts'])
        rows[0]['title'] = 'Corrected extraction title'
        payload = {'expected_revision': 1, 'attempts': rows}
        self.assertEqual(self.request(self.client, 'patch', '/record', payload).status_code, 400)
        payload['correction_justifications'] = {rows[0]['id']: 'Checked against source'}
        result = self.request(self.client, 'patch', '/record', payload)
        self.assertEqual(result.status_code, 200, result.content)
        row = next(a for a in result.json()['data']['attempts'] if a['id'] == rows[0]['id'])
        self.assertEqual(row['original']['title'], accepted['attempts'][0]['original']['title'])
        self.assertEqual(row['user_corrections'][-1]['justification'], 'Checked against source')

    def test_unsupported_admission_candidate_is_not_silently_coerced(self):
        token = self.client.cookies['csrftoken'].value
        preview = self.client.post('/api/v1/imports/preview', {'expected_revision': '0', 'file': SimpleUploadedFile('synthetic.pdf', transcript(admission_year=2025), content_type='application/pdf')}, HTTP_X_CSRFTOKEN=token).json()['data']
        result = self.request(self.client, 'post', f"/imports/{preview['id']}/commit", {'expected_revision': 0, 'accepted_candidate_ids': [a['id'] for a in preview['candidate_attempts']], 'resolutions': {}})
        self.assertEqual(result.status_code, 422)
        self.assertTrue(any(i['code'] == 'COHORT_MISMATCH' for i in result.json()['issues']))
