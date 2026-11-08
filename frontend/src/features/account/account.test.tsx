import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { record } from '../../test/fixtures';
import { fakeApi, issue, renderApp } from '../../test/harness';
import { AccountPage } from './AccountPage';

describe('AccountPage (A04)', () => {
  it('changes the password through the Django route with proper autocomplete', async () => {
    const { fetchImpl, calls } = fakeApi({ 'GET /record': () => ({ data: record }), 'POST /auth/password': () => ({ data: null }) });
    renderApp(<AccountPage />, { fetchImpl });
    expect(await screen.findByLabelText('Current password')).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.getByLabelText('New password')).toHaveAttribute('autocomplete', 'new-password');
    await userEvent.type(screen.getByLabelText('Current password'), 'old-synthetic-pass');
    await userEvent.type(screen.getByLabelText('New password'), 'New-synthetic-pass-42');
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'New-synthetic-pass-42');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    await waitFor(() => expect(calls.find((c) => c.path === '/auth/password')?.body).toEqual({ old_password: 'old-synthetic-pass', new_password: 'New-synthetic-pass-42' }));
    expect(await screen.findByText(/Password changed/)).toBeInTheDocument();
  });

  it('shows a server rejection and keeps typed values out of the message', async () => {
    const { fetchImpl } = fakeApi({ 'GET /record': () => ({ data: record }), 'POST /auth/password': () => ({ status: 400, issues: [issue('INVALID_INPUT', 'error')] }) });
    renderApp(<AccountPage />, { fetchImpl });
    await userEvent.type(await screen.findByLabelText('Current password'), 'wrong-old');
    await userEvent.type(screen.getByLabelText('New password'), 'New-synthetic-pass-42');
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'New-synthetic-pass-42');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/not accepted/);
    expect(alert).not.toHaveTextContent('wrong-old');
  });

  it('puts deleting data in its own red-outlined danger zone, apart from the other panels', async () => {
    const { fetchImpl } = fakeApi({ 'GET /record': () => ({ data: record }) });
    const { container } = renderApp(<AccountPage />, { fetchImpl });
    await screen.findByLabelText('Current password');
    const zone = container.querySelector('.danger-zone');
    expect(zone).not.toBeNull();
    expect(zone).toContainElement(screen.getByRole('heading', { name: 'Delete my data' }));
    expect(zone).not.toContainElement(screen.getByRole('heading', { name: 'Change password' }));
    expect(screen.getByRole('button', { name: 'Delete my data…' })).toHaveClass('btn-danger');
  });

  it('does not ship nonfunctional recovery or SSO buttons', async () => {
    const { fetchImpl } = fakeApi({ 'GET /record': () => ({ data: record }) });
    renderApp(<AccountPage />, { fetchImpl });
    await screen.findByLabelText('Current password');
    expect(screen.queryByRole('button', { name: /recover|reset|SSO/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Password recovery is not available/)).toBeInTheDocument();
    expect(screen.getByText('synthetic-student')).toBeInTheDocument();
  });
});
