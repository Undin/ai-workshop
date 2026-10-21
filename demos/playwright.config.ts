// The demo videos of the web view's features (demos/*.demo.ts): `npm run demo`.
// The real `skill-atlas serve` on real repositories, as a user sees it: it needs the network and
// `GITHUB_TOKEN`, as `npm run e2e` does; not a part of `npm test`.
import { defineConfig, devices } from '@playwright/test';

const port = 3101;
const size = { width: 1280, height: 800 };

export default defineConfig({
  testDir: '.',
  testMatch: '*.demo.ts',
  // A demo is slow on purpose: typing, pauses to read; and a real scan.
  timeout: 180_000,
  reporter: 'list',
  // bypassCSP: the page's policy forbids inline styles, and so the overlays of demo.ts; the app's own
  // policy stays as it is.
  use: { baseURL: `http://localhost:${port}`, viewport: size, video: 'off', bypassCSP: true },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: size } }],
  webServer: {
    command: `./skill-atlas serve --port ${port}`,
    cwd: '..',
    url: `http://localhost:${port}/`,
    reuseExistingServer: false,
  },
});
