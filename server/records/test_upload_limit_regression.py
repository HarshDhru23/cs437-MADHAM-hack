"""CP-32 (temporary-upload handling): a transcript PDF is kept in memory and never written to disk (the promise in
coursepath/imports/pdf_transcript.py), and one over 10 MB is refused with 413 INPUT_LIMIT before it is stored anywhere."""
from unittest.mock import patch
from django.core.files import uploadedfile, uploadhandler
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase
from server.records.testing import AccountAPIMixin

MB = 1024 * 1024


class UploadLimitTests(AccountAPIMixin, TestCase):
    def setUp(self):
        self.client = Client(enforce_csrf_checks=True)
        self.signup(self.client, 'upload-owner')

    def upload(self, body):
        token = self.client.cookies['csrftoken'].value
        # Every way Django spools an upload to disk goes through TemporaryUploadedFile; count its creations.
        with patch.object(uploadhandler, 'TemporaryUploadedFile', wraps=uploadedfile.TemporaryUploadedFile) as to_disk:
            response = self.client.post('/api/v1/imports/preview', {'expected_revision': '0', 'file': SimpleUploadedFile('synthetic.pdf', body, content_type='application/pdf')},
                                        HTTP_X_CSRFTOKEN=token)
        return response, to_disk.call_count

    def assert_refused(self, size):
        response, written = self.upload(b'%PDF-1.4\n' + b'0' * (size - 9))
        self.assertEqual(written, 0, f'{size} bytes were spooled to a temporary file')
        self.assertEqual((response.status_code, [i['code'] for i in response.json()['issues']]), (413, ['INPUT_LIMIT']), size)

    def test_cp32_a_40_mb_upload_is_refused_without_touching_disk(self):
        self.assert_refused(40 * MB)  # the whole request (40 MB + form overhead) is over the 11 MB request cap

    def test_cp32_an_upload_just_over_10_mb_is_refused_without_touching_disk(self):
        self.assert_refused(10 * MB + 512 * 1024)  # 10.5 MB: the request is under 11 MB, so only counting the file's own bytes catches it

    def test_cp32_a_file_of_exactly_10_mb_is_accepted_in_memory(self):
        # 10 MB is allowed (the limit is "more than 10 MB"). Not a PDF, so the parser answers quickly: 422 PDF_INVALID_INPUT, not 413.
        response, written = self.upload(b'X' * (10 * MB))
        self.assertEqual(written, 0, 'a 10 MB upload was spooled to a temporary file')
        self.assertEqual((response.status_code, [i['code'] for i in response.json()['issues']]), (422, ['PDF_INVALID_INPUT']))
