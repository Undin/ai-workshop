// The demos of the web view's features (demos/<name>/<name>.demo.ts): `npm run demo`.
// The real web view, as a user sees it, GitHub answering from each demo's recording (demos/serve.ts,
// started by demos/demo.ts): no network, no token; `npm run demo:record` records them anew.
import { defineConfig, devices } from '@playwright/test';

const size = { width: 1280, height: 800 };

export default defineConfig({
  testDir: '.',
  testMatch: '*/*.demo.ts',
  // A demo is slow on purpose: typing, pauses to read; and a recording, a real scan.
  timeout: 180_000,
  reporter: 'list',
  // bypassCSP: the page's policy forbids inline styles, and so the overlays of demo.ts; the app's own
  // policy stays as it is.
  use: { viewport: size, video: 'off', bypassCSP: true },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: size } }],
});
