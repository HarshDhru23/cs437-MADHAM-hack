"""H13 versioned JSON export and reviewed restore (CP-30)."""
import copy
import json
from unittest import mock
from django.contrib.auth.models import User
from django.db import DatabaseError
from django.test import Client, TestCase
from django.utils import timezone
from jsonschema import Draft202012Validator, FormatChecker
from server.records.models import ApprovalEvidence, ImportPreview
from server.records.services import SCHEMA
from server.records.testing import AccountAPIMixin
from tests.imports.test_ims import TABLE

VALIDATOR = Draft202012Validator(SCHEMA, format_checker=FormatChecker())


class ExportRestoreTests(AccountAPIMixin, TestCase):
    def setUp(self):
        self.signup(self.client, 'backup-owner')
        preview = self.request(self.client, 'post', '/imports/preview', {'kind': 'ims', 'text': TABLE, 'expected_revision': 0}).json()['data']
        accepted = self.request(self.client, 'post', f"/imports/{preview['id']}/commit",
                                {'expected_revision': 0, 'accepted_candidate_ids': [a['id'] for a in preview['candidate_attempts']], 'resolutions': {}})
        self.assertEqual(accepted.status_code, 200, accepted.content)
        self.attempts = accepted.json()['data']['attempts']
        self.plan = self.request(self.client, 'post', '/plans', {'label': 'Main', 'semesters': [
            {'term_id': '2026-27-I', 'courses': [{'id': 'c1', 'normalized_code': 'CS 330', 'credits': '4'}]}]}).json()['data']
        self.request(self.client, 'post', '/scenarios', {'plan_id': self.plan['id'], 'changes': [{'op': 'drop', 'item_id': 'c1'}]})

    def export(self, client=None):
        response = (client or self.client).get('/api/v1/export', {'kind': 'json'})
        self.assertEqual(response.status_code, 200, response.content)
        return response

    def corrected(self, revision):
        """Correct ES 242(N) from the imported A- to B through PATCH /record, with a justification."""
        rows = copy.deepcopy(self.client.get('/api/v1/record').json()['data']['attempts'])
        target = next(a for a in rows if a['normalized_code'] == 'ES 242(N)')
        target['grade'] = 'B'
        response = self.request(self.client, 'patch', '/record', {'expected_revision': revision, 'attempts': rows,
                                                                   'correction_justifications': {target['id']: 'Checked the printed transcript'}})
        self.assertEqual(response.status_code, 200, response.content)
        return next(a for a in response.json()['data']['attempts'] if a['id'] == target['id'])

    def preview_with_row(self, backup, row, revision):
        changed = copy.deepcopy(backup)
        changed['record']['attempts'] = [row if a['id'] == row['id'] else a for a in changed['record']['attempts']]
        return self.request(self.client, 'post', '/imports/backup-preview', {'expected_revision': revision, 'backup': changed})

    def clear(self, revision):
        self.assertEqual(self.request(self.client, 'patch', '/record', {'expected_revision': revision, 'attempts': []}).status_code, 200)

    def test_cp30_export_is_versioned_owned_and_free_of_credentials(self):
        response = self.export()
        self.assertIn('attachment', response['Content-Disposition'])
        body = response.json()
        self.assertFalse(list(VALIDATOR.iter_errors(body)))
        data = body['data']
        self.assertEqual((data['kind'], data['backup_version'], data['account']['username']), ('coursepath-backup', '1', 'backup-owner'))
        self.assertEqual((data['record']['revision'], len(data['record']['attempts'])), (1, len(self.attempts)))
        self.assertEqual((len(data['plans']), len(data['scenarios'])), (1, 1))
        self.assertEqual((data['rule_version'], data['rule_review_status']), ('cse-2024-v1', 'reviewed'))
        self.assertIn('adv13', [s['id'] for s in data['sources']])  # the backup names the rules it was made with
        text = response.content.decode().lower()
        for secret in ['password', 'pbkdf2', 'sessionid', 'csrf', self.password.lower()]:
            self.assertNotIn(secret, text)
        self.assertEqual(Client().get('/api/v1/export').status_code, 401)
        self.assertEqual(self.client.get('/api/v1/export', {'kind': 'pdf'}).status_code, 400)
        other = Client()
        self.signup(other, 'backup-stranger')
        foreign = self.export(other).json()['data']
        self.assertEqual((foreign['record']['attempts'], foreign['plans'], foreign['scenarios']), ([], [], []))

    def test_cp30_restore_previews_diff_then_commits_only_on_confirmation(self):
        backup = self.export().json()
        cleared = self.request(self.client, 'patch', '/record', {'expected_revision': 1, 'attempts': []})
        self.assertEqual(cleared.status_code, 200)
        preview = self.request(self.client, 'post', '/imports/backup-preview', {'expected_revision': 2, 'backup': backup})
        self.assertEqual(preview.status_code, 201, preview.content)
        self.assertFalse(list(VALIDATOR.iter_errors(preview.json())))
        diff = preview.json()['data']['diff']
        self.assertEqual((len(diff['attempts_added']), diff['attempts_removed'], diff['plans_to_create'], diff.get('plans_skipped_existing'), diff['scenarios_not_restored']),
                         (len(self.attempts), [], 0, [self.plan['id']], 1))
        self.assertEqual(self.client.get('/api/v1/record').json()['data']['attempts'], [])  # preview mutates nothing
        preview_id = preview.json()['data']['id']
        self.assertEqual(self.request(self.client, 'post', f'/imports/{preview_id}/commit', {'expected_revision': 2}).status_code, 400)
        committed = self.request(self.client, 'post', f'/imports/{preview_id}/commit', {'expected_revision': 2, 'confirm': True})
        self.assertEqual(committed.status_code, 200, committed.content)
        self.assertEqual(committed.json()['data']['attempts'], self.attempts)
        self.assertEqual(committed.json()['data']['revision'], 3)
        self.assertEqual([p['id'] for p in self.client.get('/api/v1/plans').json()['data']], [self.plan['id']])  # the plan still exists, so it is not copied
        self.assertEqual(self.request(self.client, 'post', f'/imports/{preview_id}/commit', {'expected_revision': 3, 'confirm': True}).status_code, 409)

    def test_cp30_unknown_foreign_or_malformed_backups_are_rejected_without_changes(self):
        self.client.raise_request_exception = False  # a malformed backup is a 4xx, never a server error
        backup = self.export().json()['data']
        for broken, status in [({**backup, 'backup_version': '99'}, 422), ({**backup, 'kind': 'something-else'}, 422),
                               ({'schema_version': '99', 'data': backup, 'issues': []}, 422),
                               ({**backup, 'account': {'username': 'someone-else'}}, 422),
                               ({**backup, 'record': {**backup['record'], 'attempts': [{'id': 'x', 'credits': 1.5}]}}, 400),
                               ({**backup, 'plans': [{'semesters': [{'term_id': 'not-a-term', 'courses': []}]}]}, 400),
                               ({**backup, 'plans': ['x']}, 400), ({**backup, 'plans': [None]}, 400), ({**backup, 'plans': [[]]}, 400),
                               ({**backup, 'scenarios': ['x']}, 400), ({**backup, 'scenarios': [None]}, 400)]:
            response = self.request(self.client, 'post', '/imports/backup-preview', {'expected_revision': 1, 'backup': broken})
            self.assertEqual(response.status_code, status, (broken.get('backup_version'), response.content))
        self.assertEqual(self.request(self.client, 'post', '/imports/backup-preview', {'expected_revision': 0, 'backup': backup}).status_code, 409)
        stranger = Client()
        self.signup(stranger, 'restore-stranger')
        preview = self.request(self.client, 'post', '/imports/backup-preview', {'expected_revision': 1, 'backup': backup}).json()['data']
        self.assertEqual(self.request(stranger, 'post', f"/imports/{preview['id']}/commit", {'expected_revision': 0, 'confirm': True}).status_code, 404)
        self.assertEqual(self.client.get('/api/v1/record').json()['data']['revision'], 1)

    def test_cp30_restoring_a_backup_twice_does_not_duplicate_plans(self):
        backup = self.export().json()

        def restore(revision, created, skipped):
            preview = self.request(self.client, 'post', '/imports/backup-preview', {'expected_revision': revision, 'backup': backup})
            self.assertEqual(preview.status_code, 201, preview.content)
            self.assertFalse(list(VALIDATOR.iter_errors(preview.json())))
            diff = preview.json()['data']['diff']
            self.assertEqual((diff['plans_to_create'], diff.get('plans_skipped_existing')), (created, skipped))
            self.assertEqual(self.request(self.client, 'post', f"/imports/{preview.json()['data']['id']}/commit", {'expected_revision': revision, 'confirm': True}).status_code, 200)
            return [p['id'] for p in self.client.get('/api/v1/plans').json()['data']]

        self.assertEqual(restore(1, 0, [self.plan['id']]), [self.plan['id']])  # same plan ID
        self.assertEqual(restore(2, 0, [self.plan['id']]), [self.plan['id']])
        self.assertEqual(self.request(self.client, 'delete', f"/plans/{self.plan['id']}", {'expected_revision': 0}).status_code, 200)
        recreated = restore(3, 1, [])
        self.assertEqual(len(recreated), 1)
        self.assertEqual(restore(4, 0, recreated), recreated)  # identical content under a new ID

    def test_cp30_restore_accepts_only_well_formed_reported_controls(self):
        backup = self.export().json()['data']
        entry = {'preview_id': 'synthetic-preview', 'record_revision_at_import': 1, 'controls': {'cpi': '9.23', 'earned_credits': '104'}, 'source_refs': ['synthetic.pdf']}
        for reported in ([1], ['junk'], [None], [{'controls': {'cpi': 9.99, 'earned_credits': 999.5}}],
                         [{**entry, 'controls': {'cpi': 9.23}}], [{**entry, 'controls': {'cpi': '9.23', 'forged_total': '1'}}],
                         [{**entry, 'controls': {'cpi': '-1'}}], [{**entry, 'controls': {}}], [{**entry, 'record_revision_at_import': '1'}],
                         [{**entry, 'source_refs': [7]}], [{**entry, 'extra': True}], [entry] * 51):
            response = self.request(self.client, 'post', '/imports/backup-preview', {'expected_revision': 1, 'backup': {**backup, 'record': {**backup['record'], 'reported_controls': reported}}})
            self.assertEqual(response.status_code, 400, (reported[:2], response.content))
        preview = self.request(self.client, 'post', '/imports/backup-preview', {'expected_revision': 1, 'backup': {**backup, 'record': {**backup['record'], 'reported_controls': [entry]}}})
        self.assertEqual(preview.status_code, 201, preview.content)
        self.assertEqual(self.request(self.client, 'post', f"/imports/{preview.json()['data']['id']}/commit", {'expected_revision': 1, 'confirm': True}).status_code, 200)
        analysis = self.request(self.client, 'post', '/analysis', {'record_revision': 2})
        self.assertEqual(analysis.json()['data']['performance']['source_reported_controls'], [entry])

    def test_cp30_restore_rejects_rows_the_record_editor_would_reject(self):
        corrected = self.corrected(1)
        history = corrected['user_corrections']
        backup = self.export().json()['data']
        previews = ImportPreview.objects.count()

        def forged(**fields):
            return {**copy.deepcopy(corrected), **fields}

        def rejected(cases, revision):
            for label, row in cases.items():
                response = self.preview_with_row(backup, row, revision)
                self.assertEqual(response.status_code, 422, (label, response.content))
                self.assertEqual([(i['code'], i['entity_refs']) for i in response.json()['issues']], [('BACKUP_INVALID', [row['id']])], label)

        rejected({'review repro: history erased, approval and catalogue match forged': forged(grade='A', user_corrections=[], approval_refs=['forged-approval'], course_version_id='forged-cv'),
                  'value differs from its last correction': forged(grade='A'),
                  'correction history shortened': forged(user_corrections=[]),
                  'correction history rewritten': forged(user_corrections=[{**history[0], 'justification': 'rewritten'}]),
                  'new correction without a justification': forged(grade='A', user_corrections=history + [{'field': 'grade', 'raw': 'B', 'accepted': 'A', 'justification': ' '}]),
                  'source evidence rewritten to match': forged(grade='A', user_corrections=[], original={**corrected['original'], 'grade': 'A'}),
                  'approval claimed': forged(approval_refs=['forged-approval']),
                  'catalogue match claimed': forged(course_version_id='forged-cv')}, 2)
        # In an emptied record every backup row is new, so each one is checked against its own source evidence.
        self.clear(2)
        rejected({'value differs from its source with no correction': forged(grade='A', user_corrections=[]),
                  'value differs from its last correction': forged(grade='A'),
                  'source citation without its original values': {k: v for k, v in forged(grade='A', user_corrections=[]).items() if k != 'original'},
                  'approval that resolves to no evidence': forged(approval_refs=['forged-approval']),
                  'catalogue match claimed': forged(course_version_id='forged-cv')}, 3)
        record = self.client.get('/api/v1/record').json()['data']
        self.assertEqual((record['revision'], record['attempts'], ImportPreview.objects.count()), (3, [], previews))

    def test_cp30_restore_keeps_justified_history_and_owned_verified_approvals(self):
        rows = copy.deepcopy(self.attempts)
        sc372 = next(a for a in rows if a['normalized_code'] == 'SC 372')
        sc372['learning_designation'] = 'additional'
        self.assertEqual(self.request(self.client, 'patch', '/record', {'expected_revision': 1, 'attempts': rows,
                                                                         'correction_justifications': {sc372['id']: 'Synthetic: outside the degree'}}).status_code, 200)
        preview = self.request(self.client, 'post', '/imports/preview', {'kind': 'ims', 'text': TABLE, 'expected_revision': 2}).json()['data']
        reimported = self.request(self.client, 'post', f"/imports/{preview['id']}/commit", {
            'expected_revision': 2, 'accepted_candidate_ids': [a['id'] for a in preview['candidate_attempts']],
            'resolutions': {sc372['id']: {'action': 'accept_incoming', 'fields': {'grade': 'F'}, 'justification': 'Synthetic regrade after review'}}})
        self.assertEqual(reimported.status_code, 200, reimported.content)
        corrected = self.corrected(3)
        backup = self.export().json()['data']
        later = {**copy.deepcopy(corrected), 'grade': 'A', 'user_corrections': corrected['user_corrections'] + [
            {'field': 'grade', 'raw': 'B', 'accepted': 'A', 'justification': 'Rechecked the printed transcript'}]}
        response = self.preview_with_row(backup, later, 4)  # a justified correction restores as PATCH /record would store it
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()['data']['diff']['attempts_changed'], [corrected['id']])
        self.clear(4)
        preview = self.request(self.client, 'post', '/imports/backup-preview', {'expected_revision': 5, 'backup': backup})
        self.assertEqual(preview.status_code, 201, preview.content)
        committed = self.request(self.client, 'post', f"/imports/{preview.json()['data']['id']}/commit", {'expected_revision': 5, 'confirm': True})
        self.assertEqual(committed.status_code, 200, committed.content)
        self.assertEqual(committed.json()['data']['attempts'], backup['record']['attempts'])  # record, import-time and re-import corrections all kept
        owner, staff, stranger = User.objects.get(username='backup-owner'), User.objects.create_user('synthetic-verifier', is_staff=True), User.objects.create_user('synthetic-other')

        def evidence(user, status):
            return str(ApprovalEvidence.objects.create(owner=user, policy_id='synthetic-policy', status=status, source_refs=['synthetic-letter'],
                                                       verifier=staff if status == 'verified' else None, verified_at=timezone.now() if status == 'verified' else None).pk)
        verified, pending, foreign = evidence(owner, 'verified'), evidence(owner, 'user_reported'), evidence(stranger, 'verified')
        self.clear(6)
        for refs, status in [([pending], 422), ([foreign], 422), ([verified, 'forged-approval'], 422), ([verified], 201)]:
            response = self.preview_with_row(backup, {**copy.deepcopy(corrected), 'approval_refs': refs}, 7)
            self.assertEqual(response.status_code, status, (refs, response.content))
        committed = self.request(self.client, 'post', f"/imports/{response.json()['data']['id']}/commit", {'expected_revision': 7, 'confirm': True})
        self.assertEqual(next(a for a in committed.json()['data']['attempts'] if a['id'] == corrected['id'])['approval_refs'], [verified])

    def test_cp30_failed_restore_rolls_back_the_record(self):
        backup = self.export().json()
        self.request(self.client, 'patch', '/record', {'expected_revision': 1, 'attempts': []})
        preview = self.request(self.client, 'post', '/imports/backup-preview', {'expected_revision': 2, 'backup': backup}).json()['data']
        with mock.patch('server.records.models.AcademicPlan.objects.bulk_create', side_effect=DatabaseError('disk full')):
            with self.assertRaises(DatabaseError):
                self.request(self.client, 'post', f"/imports/{preview['id']}/commit", {'expected_revision': 2, 'confirm': True})
        record = self.client.get('/api/v1/record').json()['data']
        self.assertEqual((record['revision'], record['attempts']), (2, []))
        self.assertEqual(len(self.client.get('/api/v1/plans').json()['data']), 1)
        self.assertEqual(json.loads(json.dumps(backup))['data']['record']['revision'], 1)
