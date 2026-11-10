"""A student's first PDF parse after the server (or the laptop) was idle can lose the extraction process to its time limit while the PDF
libraries load from a cold disk; the second try, with everything cached, works. The parser tries once more when the first attempt only ran
out of time, so the student does not have to press the button twice."""
import subprocess
import unittest
from unittest import mock
from coursepath.imports import pdf_transcript
from coursepath.imports.pdf_transcript import parse_pdf
from tests.imports.test_pdf import transcript

REAL_RUN = subprocess.run


def slow_first(timeouts):
    """A subprocess.run that times out `timeouts` times, then behaves normally; the calls are counted."""
    calls = []

    def run(*args, **kwargs):
        calls.append(kwargs.get('timeout'))
        if len(calls) <= timeouts:
            raise subprocess.TimeoutExpired(args[0], kwargs.get('timeout'))
        return REAL_RUN(*args, **kwargs)
    return run, calls


class PdfSlowStartTests(unittest.TestCase):
    def test_cp06_first_attempt_that_only_ran_out_of_time_is_tried_again(self):
        run, calls = slow_first(1)
        with mock.patch.object(pdf_transcript.subprocess, 'run', run):
            parsed = parse_pdf(transcript(), 'synthetic-pdf')
        self.assertEqual(len(parsed['candidate_attempts']), 8)   # 2 rows x 4 terms, as the transcript() fixture draws them
        self.assertEqual([i['code'] for i in parsed['issues'] if i['severity'] == 'error'], [])
        self.assertEqual(len(calls), 2)

    def test_cp09_a_pdf_that_always_runs_out_of_time_still_fails_after_one_more_try(self):
        run, calls = slow_first(99)
        with mock.patch.object(pdf_transcript.subprocess, 'run', run):
            parsed = parse_pdf(transcript(), 'synthetic-pdf')
        self.assertEqual(parsed['candidate_attempts'], [])
        self.assertIn('PDF_EXTRACTION_FAILED', [i['code'] for i in parsed['issues']])
        self.assertEqual(len(calls), 2)   # bounded: never a loop
        self.assertEqual(calls, [20, 20])   # the per-try limit is pinned

    def test_cp09_an_unreadable_pdf_is_not_retried(self):
        calls = []

        def run(*args, **kwargs):
            calls.append(1)
            return REAL_RUN(*args, **kwargs)
        with mock.patch.object(pdf_transcript.subprocess, 'run', run):
            parsed = parse_pdf(transcript(encrypted=True), 'synthetic-pdf')
        self.assertIn('PDF_UNSUPPORTED', [i['code'] for i in parsed['issues']])
        self.assertEqual(len(calls), 1)

    def test_cp09_a_worker_that_exits_with_an_error_is_not_retried(self):
        calls = []

        def run(*args, **kwargs):
            calls.append(1)
            return subprocess.CompletedProcess(args[0], 1, stdout=b'', stderr=b'boom')
        with mock.patch.object(pdf_transcript.subprocess, 'run', run):
            parsed = parse_pdf(transcript(), 'synthetic-pdf')
        self.assertEqual(len(calls), 1)
        self.assertEqual(parsed['candidate_attempts'], [])
        self.assertIn('PDF_EXTRACTION_FAILED', [i['code'] for i in parsed['issues']])

    def test_cp09_a_worker_that_prints_garbage_is_not_retried(self):
        calls = []

        def run(*args, **kwargs):
            calls.append(1)
            return subprocess.CompletedProcess(args[0], 0, stdout=b'not json', stderr=b'')
        with mock.patch.object(pdf_transcript.subprocess, 'run', run):
            parsed = parse_pdf(transcript(), 'synthetic-pdf')
        self.assertEqual(len(calls), 1)
        self.assertIn('PDF_EXTRACTION_FAILED', [i['code'] for i in parsed['issues']])

    def test_cp09_a_process_that_cannot_start_is_not_retried(self):
        calls = []

        def run(*args, **kwargs):
            calls.append(1)
            raise OSError('cannot start')
        with mock.patch.object(pdf_transcript.subprocess, 'run', run):
            parsed = parse_pdf(transcript(), 'synthetic-pdf')
        self.assertEqual(len(calls), 1)
        self.assertIn('PDF_EXTRACTION_FAILED', [i['code'] for i in parsed['issues']])


if __name__ == '__main__':
    unittest.main()
