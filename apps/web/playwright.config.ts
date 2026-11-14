import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
// Locally we reuse the installed Chrome (PW_CHANNEL=chrome); CI installs Playwright's Chromium.
const channel = process.env.PW_CHANNEL;

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? `http://localhost:${PORT}/navbat/`,
    trace: 'retain-on-failure',
    ...(channel ? { channel } : {}),
  },
  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        ...(channel ? { channel } : {}),
      },
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'], viewport: { width: 375, height: 812 }, ...(channel ? { channel } : {}) },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npm run build:demo && npx vite preview --mode demo --port ${PORT} --strictPort`,
        url: `http://localhost:${PORT}/navbat/`,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
});
