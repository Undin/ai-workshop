// The demo videos of the web view's features (demos/*.demo.ts), for pull requests: `npm run demo <name>`.
// On the same server as the browser tests, whose GitHub is recorded; not a part of `npm test`.
import { defineConfig, devices } from '@playwright/test';

const port = 3101;
const size = { width: 1280, height: 800 };

export default defineConfig({
  testDir: '.',
  testMatch: '*.demo.ts',
  // A demo is slow on purpose: typing, pauses to read.
  timeout: 120_000,
  reporter: 'list',
  use: { baseURL: `http://localhost:${port}`, viewport: size, video: 'off' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: size } }],
  webServer: {
    command: 'node tests/serve-test.ts',
    cwd: '..',
    url: `http://localhost:${port}/`,
    env: { PORT: String(port) },
    reuseExistingServer: false,
  },
});
