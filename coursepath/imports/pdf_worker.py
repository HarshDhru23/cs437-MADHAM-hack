import json
import sys
from coursepath.imports.pdf_layout import extract_pdf
from coursepath.imports.normalization import empty_result
from coursepath.issues import issue


if __name__ == '__main__':
    source, max_pages = json.loads(sys.argv[1])
    try:
        result = extract_pdf(sys.stdin.buffer.read(10 * 1024 * 1024 + 1), source, max_pages)
    except Exception:
        result = empty_result()
        result['issues'].append(issue('PDF_UNSUPPORTED', 'Unreadable, encrypted or unsupported PDF. Use IMS paste/manual entry.', 'error'))
    sys.stdout.write(json.dumps(result))
