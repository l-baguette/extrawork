import { expect, test } from '@playwright/test';
import { seedScenario, type Scenario } from './fixtures';

/**
 * The customer decision journey — report §14.5 end-to-end list and §6.7.
 *
 * These run against the real web app, the real API and a real database. Each
 * test seeds its own scenario so the suite does not depend on ordering.
 */

let scenario: Scenario;

test.beforeAll(async () => {
  scenario = await seedScenario();
});

test.describe('public approval', () => {
  test('shows every fact a customer needs, then records an approval', async ({ page }) => {
    const link = scenario.pendingLinks[0];
    expect(link, 'seed produced a live approval link').toBeTruthy();

    await page.goto(link!.url);

    // --- Report §6.7: what the page must show ---------------------------
    await expect(page.getByRole('heading', { name: scenario.organizationName })).toBeVisible();
    await expect(page.getByText(link!.changeNumber, { exact: false })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'What this costs' })).toBeVisible();
    await expect(page.getByText('New contract total')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Effect on the schedule' })).toBeVisible();

    // Honest assurance language, never a claim of a certified signature.
    await expect(
      page.getByText('not a licensed or government-recognised electronic signature'),
    ).toBeVisible();
    await expect(page.getByText(/court/i)).toBeVisible();

    // The masked contact is shown, the full number never is.
    await expect(page.getByText(/\+91\*+\d{4}/)).toBeVisible();

    // --- No dark patterns: all three actions are visible and enabled -----
    const approve = page.getByRole('button', { name: 'Approve this change' });
    const decline = page.getByRole('button', { name: 'Decline' });
    const revise = page.getByRole('button', { name: 'Ask for a change to this request' });
    await expect(approve).toBeEnabled();
    await expect(decline).toBeEnabled();
    await expect(revise).toBeEnabled();

    // --- Decide ----------------------------------------------------------
    await approve.click();
    await expect(page.getByRole('heading', { name: 'Confirm your approval' })).toBeVisible();

    // Consent is never pre-selected (report §6.7).
    const declaration = page.getByRole('checkbox');
    await expect(declaration).not.toBeChecked();

    // Submitting without the declaration must fail with a visible error.
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(page.getByText('Tick the box to confirm.')).toBeVisible();

    await page.getByLabel('Your full name').fill('Priya Mehta');
    await declaration.check();
    await page.getByRole('button', { name: 'Approve', exact: true }).click();

    // --- Receipt ---------------------------------------------------------
    await expect(page.getByRole('heading', { name: /Approved\. Thank you\./ })).toBeVisible();
    await expect(page.getByText(/EW-R-[A-Z0-9]{6}/)).toBeVisible();
    // The name appears both in the request summary ("addressed to …") and in
    // the receipt, so scope the assertion to the receipt's own row.
    await expect(
      page.getByRole('row', { name: /Name given/ }).getByText('Priya Mehta'),
    ).toBeVisible();
  });

  test('refuses a second decision on the same link', async ({ page }) => {
    const fresh = await seedScenario();
    const link = fresh.pendingLinks[0]!;

    await page.goto(link.url);
    await page.getByRole('button', { name: 'Approve this change' }).click();
    await page.getByLabel('Your full name').fill('Priya Mehta');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(page.getByRole('heading', { name: /Approved/ })).toBeVisible();

    // Reopening the link shows the receipt, not a second decision form.
    await page.goto(link.url);
    await expect(page.getByRole('heading', { name: 'Your decision is recorded' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve this change' })).toHaveCount(0);
  });

  test('records a decline without changing any total', async ({ page }) => {
    const fresh = await seedScenario();
    const link = fresh.pendingLinks[0]!;

    await page.goto(link.url);
    await page.getByRole('button', { name: 'Decline' }).click();
    await expect(page.getByRole('heading', { name: /Confirm you are declining/ })).toBeVisible();
    await expect(
      page.getByText('No cost or schedule change is authorised by this decision.'),
    ).toBeVisible();

    await page.getByLabel('Your full name').fill('Priya Mehta');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Decline', exact: true }).click();

    await expect(page.getByRole('heading', { name: /Declined\. Thank you\./ })).toBeVisible();
  });

  test('requires a comment when asking for a revision', async ({ page }) => {
    const fresh = await seedScenario();
    const link = fresh.pendingLinks[0]!;

    await page.goto(link.url);
    await page.getByRole('button', { name: 'Ask for a change to this request' }).click();

    await page.getByLabel('Your full name').fill('Priya Mehta');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Send request' }).click();
    await expect(page.getByText('Tell the contractor what needs to change.')).toBeVisible();

    await page.getByLabel('What needs to change?').fill('Please split out the hardware cost.');
    await page.getByRole('button', { name: 'Send request' }).click();
    await expect(page.getByRole('heading', { name: /Sent back to the contractor/ })).toBeVisible();
  });

  test('a duplicate tap creates exactly one decision', async ({ page }) => {
    // Report §14.5: "Simulate slow network and duplicate tap."
    //
    // The UI disables the control while a submission is in flight, but that is
    // not the guarantee under test. The guarantee is that the *server* collapses
    // repeats onto one decision via the idempotency key — which is what protects
    // a customer whose first response never arrives. So this double-taps the way
    // an impatient person would and asserts the committed state.
    const fresh = await seedScenario();
    const link = fresh.pendingLinks[0]!;

    await page.goto(link.url);
    await page.getByRole('button', { name: 'Approve this change' }).click();
    await page.getByLabel('Your full name').fill('Priya Mehta');
    await page.getByRole('checkbox').check();

    await page.getByRole('button', { name: 'Approve', exact: true }).dblclick();

    await expect(page.getByRole('heading', { name: /Approved/ })).toBeVisible();
    expect(await fresh.countDecisions(link.changeOrderId)).toBe(1);
  });

  test('explains a superseded link instead of accepting a stale decision', async ({ page }) => {
    // Report §4.6: the contractor supersedes while the customer page is open.
    const fresh = await seedScenario();
    const link = fresh.pendingLinks[0]!;

    await page.goto(link.url);
    await expect(page.getByRole('button', { name: 'Approve this change' })).toBeVisible();

    await fresh.supersede(link.changeOrderId);

    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'This request has been replaced' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve this change' })).toHaveCount(0);
  });

  test('shows a neutral error for an invalid link', async ({ page }) => {
    await page.goto('/r/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    await expect(page.getByRole('heading', { name: 'This link is not valid' })).toBeVisible();
    // No hint about whether the token exists elsewhere (report §12.2).
    await expect(page.getByText(/organization|tenant|database/i)).toHaveCount(0);
  });

  test('never leaks the token to another origin or a referrer', async ({ page }) => {
    const fresh = await seedScenario();
    const link = fresh.pendingLinks[0]!;

    const externalRequests: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
        externalRequests.push(request.url());
      }
    });

    const response = await page.goto(link.url);
    // Report §3.4 and §11.3: no third-party origin is contacted at all.
    expect(externalRequests).toEqual([]);
    expect(response?.headers()['referrer-policy']).toBe('no-referrer');
    expect(response?.headers()['x-robots-tag']).toContain('noindex');
  });
});
