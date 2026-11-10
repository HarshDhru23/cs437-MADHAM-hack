import { expect, test } from '@playwright/test';
import { signup, uniqueUser } from './helpers';

/**
 * CR-102 (CP-32, CP-37): a Google-only account has no password, so the Your Data page asks it to confirm with its IITGN Google account and sends
 * the Google credential instead. Real Google cannot be reached from a test, so the page is given a stubbed Google library and a session that says
 * "Google only"; the deletion request itself is intercepted and checked, never sent. The server's own refusal of a wrong credential is covered by
 * server/records/test_google_delete_regression.py.
 */
test('a Google-only account deletes its data with a Google credential and no password (CP-32, CP-37)', async ({ page }) => {
  await signup(page, uniqueUser('e2e_google_delete'));   // a real account on the real backend; the stubs below are added after sign-up

  await page.addInitScript(() => {
    const w = window as unknown as { google?: unknown; __googleCallback?: (response: { credential: string }) => void };
    w.google = {
      accounts: {
        id: {
          initialize: (config: { callback: (response: { credential: string }) => void }) => {
            w.__googleCallback = config.callback;
          },
          renderButton: (parent: HTMLElement) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = 'Continue with Google';
            button.onclick = () => w.__googleCallback?.({ credential: 'stubbed.google.credential.token' });
            parent.appendChild(button);
          },
        },
      },
    };
  });
  await page.route('**/api/v1/session', async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    json.data.user.reauth = 'google';   // this account has no password, so the server would say so (the real sign-up above made a password account)
    json.data.sign_in = { google_client_id: 'stub-client.apps.googleusercontent.com', google_domain: 'iitgn.ac.in', password: false };
    await route.fulfill({ response, json });
  });
  const sent: unknown[] = [];
  await page.route('**/api/v1/account/data', async (route) => {
    if (route.request().method() !== 'DELETE') return route.continue();
    sent.push(route.request().postDataJSON());
    return route.fulfill({
      status: 200,
      json: { data: { deleted: { attempts: 0, plans: 0, scenarios: 0, import_previews: 0, approval_evidence: 0 }, account_deleted: false, record_revision: 1, retention: 'Deleted from the database (stub).' }, issues: [], schema_version: '1' },
    });
  });

  await page.goto('/account');
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await expect(page.getByLabel('Current password for deletion')).toHaveCount(0);

  await page.getByLabel(/^Type “delete my data” to confirm$/).fill('delete my data');
  await page.getByRole('button', { name: 'Delete my data…' }).click();
  await expect(page.getByText('Confirm with your IITGN Google account first.')).toBeVisible();   // no Google confirmation yet, so nothing is sent
  expect(sent).toHaveLength(0);

  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page.getByText('Confirmed with your Google account.')).toBeVisible();
  await page.getByRole('button', { name: 'Delete my data…' }).click();
  await page.getByRole('dialog', { name: 'Delete your data now?' }).getByRole('button', { name: 'Delete my data', exact: true }).click();
  await expect(page.getByText(/Your data was deleted\./)).toBeVisible();

  expect(sent).toHaveLength(1);
  const body = sent[0] as Record<string, unknown>;
  expect(body.google_credential).toBe('stubbed.google.credential.token');
  expect(body).not.toHaveProperty('password');
  expect(body.confirm).toBe('delete my data');
  expect(body.delete_account).toBe(false);
});
