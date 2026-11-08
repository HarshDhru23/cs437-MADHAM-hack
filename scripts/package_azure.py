"""Build the zip that is deployed to Azure App Service (docs/operations/azure.md).

Contents: files git tracks or would track (untracked but not git-ignored; the private transcript, IMS paste, graduation plan,
.env and server/.local are git-ignored, so they can never be included) plus the built frontend (frontend/dist). Run `npm run build` in frontend/ first.
Usage: python scripts/package_azure.py [--out coursepath-azure.zip]
"""
import argparse
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKIP_PREFIXES = ('frontend/', 'e2e/', 'docs/', 'tests/', '.github/', '.claude/', 'lab-notes/')
PRIVATE = ('.pdf', '.xlsx', '.sqlite3', '.env')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', default=str(ROOT / 'coursepath-azure.zip'))
    out = Path(parser.parse_args().out)
    dist = ROOT / 'frontend' / 'dist'
    if not (dist / 'index.html').is_file():
        sys.exit('frontend/dist/index.html is missing: run `npm ci && npm run build` in frontend/ first.')
    tracked = subprocess.run(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], cwd=ROOT, capture_output=True, check=True).stdout.decode('utf-8').split('\0')
    files = [name for name in tracked if name and not name.startswith(SKIP_PREFIXES) and not name.lower().endswith(PRIVATE)
             and (ROOT / name).is_file()]
    if out.exists():
        out.unlink()
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as bundle:
        for name in files:
            bundle.write(ROOT / name, name)
        for path in dist.rglob('*'):
            if path.is_file():
                bundle.write(path, 'frontend/dist/' + path.relative_to(dist).as_posix())
    print(f'{out}: {len(files)} tracked files + frontend/dist, {out.stat().st_size / 1e6:.1f} MB')


if __name__ == '__main__':
    main()
