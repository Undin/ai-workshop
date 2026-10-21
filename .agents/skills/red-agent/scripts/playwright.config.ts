// The red agent's scenarios (.red-agent/*.red.ts): the real `skill-atlas serve` on real
// repositories, as a user sees it; it needs the network and `GITHUB_TOKEN`. Throwaway, never
// committed: `npx playwright test -c .agents/skills/red-agent/scripts/playwright.config.ts`.
import { defineConfig, devices } from '@playwright/test';

const port = 3102;
const root = new URL('../../../../', import.meta.url).pathname;

export default defineConfig({
  testDir: `${root}.red-agent`,
  testMatch: '*.red.ts',
  outputDir: `${root}.red-agent/test-results`,
  // A real scan of a real repository.
  timeout: 120_000,
  // Each scenario is a verdict of its own: never retried, so a flaky result shows.
  retries: 0,
  reporter: 'list',
  use: { baseURL: `http://localhost:${port}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `./skill-atlas serve --port ${port}`,
    cwd: root,
    url: `http://localhost:${port}/`,
    reuseExistingServer: false,
  },
});
