"""CP-30, CP-12: a restore that would replace the printed transcript totals says so in the diff the student reviews (issue #8)."""
import copy
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from server.records.testing import AccountAPIMixin
from tests.imports.test_pdf import transcript


class RestoreReportedTotalsDiffTests(AccountAPIMixin, TestCase):
    def setUp(self):
        self.signup(self.client, 'totals-owner')
        token = self.client.cookies['csrftoken'].value
        preview = self.client.post('/api/v1/imports/preview', {'expected_revision': '0', 'file': SimpleUploadedFile('synthetic.pdf', transcript(), content_type='application/pdf')},
                                   HTTP_X_CSRFTOKEN=token).json()['data']
        committed = self.request(self.client, 'post', f"/imports/{preview['id']}/commit", {'expected_revision': 0, 'accepted_candidate_ids': [a['id'] for a in preview['candidate_attempts']],
                                                                                            'resolutions': {'_totals': {'action': 'acknowledge', 'justification': 'synthetic'}}})
        self.assertEqual(committed.status_code, 200, committed.content)
        self.backup = self.client.get('/api/v1/export').json()['data']
        self.assertEqual(self.backup['record']['reported_controls'][0]['controls']['earned_credits'], '16')  # the synthetic PDF prints 16 earned

    def diff(self, revision, reported=None):
        backup = copy.deepcopy(self.backup)
        if reported is not None:
            backup['record']['reported_controls'] = reported
        response = self.request(self.client, 'post', '/imports/backup-preview', {'expected_revision': revision, 'backup': backup})
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()['data']['diff']

    def test_cp30_restore_diff_names_a_change_to_the_printed_totals(self):
        self.assertIs(self.diff(1, reported=[]).get('reported_controls_changed'), True)  # the record holds the printed 16; the backup would clear it
        deleted = self.request(self.client, 'delete', '/account/data', {'expected_revision': 1, 'password': self.password, 'confirm': 'delete my data'})
        self.assertEqual(deleted.status_code, 200, deleted.content)
        self.assertIs(self.diff(2).get('reported_controls_changed'), True)  # the emptied record holds none; the backup brings the printed 16 back

    def test_cp30_honest_backup_diff_reports_the_printed_totals_unchanged(self):
        self.assertIs(self.diff(1).get('reported_controls_changed'), False)
