import { expect, test } from '@playwright/test';
import { seedScenario, type Scenario } from './fixtures';

/**
 * Proves the one path every other test in this suite deliberately stubs:
 * a photograph picked in a real browser goes browser -> API -> object store
 * -> worker scan -> attached to a sent change order.
 *
 * Requires the worker process to be running against the SAME storage driver
 * as the API (STORAGE_DRIVER=local for both in this environment — see the
 * task notes). Without the worker, the scan never reaches CLEAN and the
 * "Ready" assertion below times out.
 */

let scenario: Scenario;

test.beforeAll(async () => {
  scenario = await seedScenario();
});

test('a photograph uploads, clears its scan, and reaches a sent change order', async ({ page }) => {
  const project = scenario.projects[0];
  expect(project, 'seed produced at least one project').toBeTruthy();

  // The contractor dashboard is authenticated (report §6.5): mint a real
  // session for the seeded owner the same way every sign-in route does
  // (startSessionFor), and hand the browser the same pair of cookies the API
  // would have set — an HTTP-only session cookie and a readable CSRF cookie.
  const session = await scenario.signIn(scenario.ownerUserId, scenario.organizationId);
  const webUrl = new URL(process.env.E2E_WEB_URL ?? 'http://localhost:3000');
  await page.context().addCookies([
    {
      name: 'ew_session',
      value: session.sessionToken,
      domain: webUrl.hostname,
      path: '/',
      httpOnly: true,
      secure: false,
    },
    {
      name: 'ew_csrf',
      value: session.csrfToken,
      domain: webUrl.hostname,
      path: '/',
      httpOnly: false,
      secure: false,
    },
  ]);

  // --- Step 1: what changed, plus the photograph -----------------------
  await page.goto(`/app/projects/${project!.id}/changes/new`);

  await page.getByLabel('Short title').fill('Concealed points, master bedroom');
  await page
    .getByLabel('What exactly is being done?')
    .fill('Supply and install four concealed 16A points on the east wall.');

  await page.setInputFiles('input[type=file]', 'tests/e2e/fixtures/site-photo.jpg');

  // The upload/scan round trip crosses the API, the local object store and
  // the worker's quarantine job — genuinely, not stubbed.
  await expect(page.getByText('Ready', { exact: true })).toBeVisible({ timeout: 60_000 });

  await page.getByRole('button', { name: 'Continue' }).click();

  // --- Step 2: at least one priced line, so the schedule/cost refine passes -
  await page.getByRole('button', { name: 'Add an item' }).click();
  await page.getByLabel('Description').fill('Concealed 16A point, wiring and socket');
  await page.getByLabel('Quantity').fill('4');
  await page.getByLabel('Rate per unit (₹)').fill('1500');
  await page.getByRole('button', { name: 'Continue' }).click();

  // --- Step 3: time and approver — the project's default approver is
  // already selected, nothing to fill.
  await page.getByRole('button', { name: 'Continue' }).click();

  // --- Step 4: the server-computed preview and the send gate -------------
  // A change with a site photograph must not show the "no photograph"
  // warning, and the still-pending-attachment reason must never be why send
  // is blocked once the scan has cleared.
  await expect(page.getByText('No photograph attached')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'What the customer will see' })).toBeVisible();

  const send = page.getByRole('button', { name: 'Freeze and send to customer' });
  await expect(send).toBeEnabled({ timeout: 30_000 });

  await send.click();

  // The version is frozen and sent — the photograph travelled with it.
  await expect(
    page.getByRole('heading', { name: 'Version frozen and ready to send' }),
  ).toBeVisible();
});
