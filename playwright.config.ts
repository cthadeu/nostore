import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false, workers: 1, timeout: 90_000,
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8080', headless: true, launchOptions: { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
});
