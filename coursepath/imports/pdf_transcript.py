"""PDF extraction runs in a killable process; originals never touch disk."""
import json
import subprocess
import sys
from pathlib import Path
from coursepath.imports.normalization import empty_result
from coursepath.issues import issue


def parse_pdf(file_bytes, source_ref, *, max_bytes=10 * 1024 * 1024, max_pages=20, timeout_seconds=10):
    result = empty_result()
    if not isinstance(file_bytes, bytes) or len(file_bytes) > max_bytes or not file_bytes.startswith(b'%PDF-'):
        result['issues'].append(issue('PDF_INVALID_INPUT', 'Expected a PDF of at most 10 MB. Use IMS paste/manual entry.', 'error'))
        return result
    try:
        process = subprocess.run([sys.executable, '-m', 'coursepath.imports.pdf_worker', json.dumps([source_ref, max_pages])],
                                 cwd=Path(__file__).resolve().parents[2], input=file_bytes, capture_output=True, timeout=timeout_seconds,
                                 creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0)
        if process.returncode:
            raise ValueError('Worker failed')
        return json.loads(process.stdout)
    except (subprocess.TimeoutExpired, ValueError, OSError):
        result['issues'].append(issue('PDF_EXTRACTION_FAILED', 'PDF extraction failed or exceeded its time limit. Use IMS paste/manual entry.', 'error'))
        return result
