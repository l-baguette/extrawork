import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests — report §14.5:
 *
 *   "Playwright mobile and desktop: create organization/customer/project;
 *    compose request with attachment; preview and send; open public link;
 *    approve/decline/request revision; observe dashboard and evidence PDF;
 *    supersede while an old page is open; simulate slow network and duplicate tap."
 *
 * The suite drives the real web app against the real API and a real database.
 * `pnpm e2e:setup` prepares the schema and seeds; the web server is expected to
 * already be running (or is started by `webServer` below).
 */
const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  // A shared database means a shared world; one worker keeps the story coherent.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    // The public approval flow must work on an inexpensive Android phone
    // (report §2.2), so that is the default device.
    ...devices['Pixel 5'],
  },
  projects: [
    {
      name: 'mobile',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
  ],
});
