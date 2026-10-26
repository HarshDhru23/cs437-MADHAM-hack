import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { preview, record } from '../../test/fixtures';
import { fakeApi, issue, renderApp } from '../../test/harness';
import { importDraftStore } from './draftStore';
import { ImportPage, SYNTHETIC_SAMPLE } from './ImportPage';
import { previewStore } from './previewStore';

const routes = { 'GET /record': () => ({ data: record }) };

describe('ImportPage (A03, CP-06/07/09)', () => {
  beforeEach(() => {
    importDraftStore.clear();
    previewStore.clear();
  });

  it('offers equal PDF and IMS tabs, limits, a privacy note and no IMS password field', async () => {
    const { fetchImpl } = fakeApi(routes);
    renderApp(<ImportPage />, { fetchImpl, route: '/record/import', path: '/record/import' });
    expect(await screen.findByRole('tab', { name: 'Upload transcript PDF' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Paste IMS grades' })).toBeInTheDocument();
    expect(screen.getByText(/never asks for your IMS password/)).toBeInTheDocument();
    expect(screen.getByText(/10 MB/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/IMS password/i)).not.toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Steps' })).toHaveTextContent('Import');
  });

  it('fills a synthetic sample and parses it with the record revision, then opens review', async () => {
    const { fetchImpl, calls } = fakeApi({ ...routes, 'POST /imports/preview': () => ({ status: 201, data: preview, issues: [issue('UNMATCHED_COURSE', 'unknown', ['cand-1'])] }) });
    renderApp(<ImportPage />, { fetchImpl, route: '/record/import', path: '/record/import' });
    await userEvent.click(await screen.findByRole('tab', { name: 'Paste IMS grades' }));
    await userEvent.click(screen.getByRole('button', { name: 'Use synthetic sample' }));
    expect(screen.getByLabelText('IMS grade table')).toHaveValue(SYNTHETIC_SAMPLE);
    expect(SYNTHETIC_SAMPLE).toMatch(/Academic Period\tCourse No\tCourse Name\tCredit\tGrade/);
    await userEvent.click(screen.getByRole('button', { name: 'Parse grades' }));
    await screen.findByText('navigated-away');
    expect(calls.find((c) => c.path === '/imports/preview')?.body).toEqual({ kind: 'ims', text: SYNTHETIC_SAMPLE, expected_revision: 3 });
    expect(previewStore.get(preview.id, '1')?.issues[0]?.code).toBe('UNMATCHED_COURSE');
  });

  it('uploads a chosen PDF as multipart with the expected revision (keyboard-accessible picker)', async () => {
    const { fetchImpl, calls } = fakeApi({ ...routes, 'POST /imports/preview': () => ({ status: 201, data: preview }) });
    renderApp(<ImportPage />, { fetchImpl, route: '/record/import', path: '/record/import' });
    const input = await screen.findByLabelText('Choose transcript PDF');
    const file = new File(['%PDF-1.4 synthetic'], 'synthetic.pdf', { type: 'application/pdf' });
    await userEvent.upload(input, file);
    expect(screen.getByText(/synthetic.pdf/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Parse transcript' }));
    await screen.findByText('navigated-away');
    const body = calls.find((c) => c.path === '/imports/preview')?.body as FormData;
    expect(body.get('expected_revision')).toBe('3');
    expect((body.get('file') as File).name).toBe('synthetic.pdf');
  });

  it('keeps the pasted draft when the visitor must sign in first', async () => {
    const { fetchImpl, calls } = fakeApi({}, null);
    renderApp(<ImportPage />, { fetchImpl, route: '/record/import', path: '/record/import' });
    await userEvent.click(await screen.findByRole('tab', { name: 'Paste IMS grades' }));
    await userEvent.type(screen.getByLabelText('IMS grade table'), 'pending synthetic paste');
    expect(screen.getByRole('link', { name: 'Sign in to parse' })).toHaveAttribute('href', '/login?next=%2Frecord%2Fimport');
    expect(importDraftStore.get().text).toBe('pending synthetic paste');
    expect(calls.some((c) => c.path === '/imports/preview')).toBe(false);
  });

  it('explains an unparseable input, keeps the draft and the prior record, and offers alternatives', async () => {
    const { fetchImpl } = fakeApi({
      ...routes,
      'POST /imports/preview': () => ({ status: 422, data: { candidate_attempts: [] }, issues: [issue('PDF_NO_TEXT', 'error', [], 'This PDF has no extractable text (image-only).')] }),
    });
    renderApp(<ImportPage />, { fetchImpl, route: '/record/import', path: '/record/import' });
    await userEvent.upload(await screen.findByLabelText('Choose transcript PDF'), new File(['x'], 'scan.pdf', { type: 'application/pdf' }));
    await userEvent.click(screen.getByRole('button', { name: 'Parse transcript' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('This PDF has no extractable text (image-only).');
    expect(alert).toHaveTextContent(/Your saved record was not changed/);
    expect(within(alert).getByRole('button', { name: 'Paste IMS grades instead' })).toBeInTheDocument();
    expect(within(alert).getByRole('link', { name: 'Add attempts manually' })).toHaveAttribute('href', '/record');
    expect(screen.getByText(/scan.pdf/)).toBeInTheDocument();
  });

  it('reports an oversized upload', async () => {
    const { fetchImpl } = fakeApi({ ...routes, 'POST /imports/preview': () => ({ status: 413, issues: [issue('INPUT_LIMIT', 'error', [], 'PDF exceeds 10 MB.')] }) });
    renderApp(<ImportPage />, { fetchImpl, route: '/record/import', path: '/record/import' });
    await userEvent.upload(await screen.findByLabelText('Choose transcript PDF'), new File(['x'], 'big.pdf', { type: 'application/pdf' }));
    await userEvent.click(screen.getByRole('button', { name: 'Parse transcript' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('PDF exceeds 10 MB.'));
  });

  it('rejects a non-PDF file before upload', async () => {
    const { fetchImpl, calls } = fakeApi(routes);
    renderApp(<ImportPage />, { fetchImpl, route: '/record/import', path: '/record/import' });
    await userEvent.upload(await screen.findByLabelText('Choose transcript PDF'), new File(['a,b'], 'grades.xlsx', { type: 'application/vnd.ms-excel' }), { applyAccept: false });
    expect(screen.getByRole('alert')).toHaveTextContent(/Only PDF transcripts/);
    expect(calls.some((c) => c.path === '/imports/preview')).toBe(false);
  });
});
