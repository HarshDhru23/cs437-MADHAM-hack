import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SYNTHETIC_PDF = path.join(here, '.artifacts', 'synthetic-transcript.pdf');

export default function globalSetup() {
  mkdirSync(path.dirname(SYNTHETIC_PDF), { recursive: true });
  const python = process.env.COURSEPATH_PYTHON ?? 'python';
  const result = spawnSync(python, [path.join(here, 'fixtures', 'make_synthetic_pdf.py'), SYNTHETIC_PDF], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('Could not generate the synthetic PDF fixture (reportlab from the backend requirements is needed).');
}
