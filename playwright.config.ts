import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  retries: 0,
  workers: 1,
  reporter: 'html',
  use: {
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npx http-server ./mock-scores -p 8788 -c-1',
    url: 'http://localhost:8788',
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
