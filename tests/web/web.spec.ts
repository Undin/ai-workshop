// The decisions in spec/web.md, checked in a browser on the page that `skill-atlas serve` serves:
// ./fixture, and GitHub repositories answered in tests/helpers.ts and tests/serve-test.ts.
// In tests/web, not e2e/: these never reach the network; e2e/ is the CLI on real repositories.
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { atlas, EXAMPLE_COMMIT, FIXTURE, SLOW_ANSWER_MS } from '../helpers.ts';

/** Types the repository link into the field and scans it. */
async function scan(page: Page, source: string, how: 'enter' | 'button' = 'enter') {
  await page.getByLabel('Repository').fill(source);
  if (how === 'enter') await page.getByLabel('Repository').press('Enter');
  else await page.getByRole('button', { name: 'Scan' }).click();
}

const skills = (page: Page) => page.getByRole('list', { name: 'Skills' }).getByRole('button');
const article = (page: Page) => page.getByRole('article');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('the field scans a directory: the repository and its skills, sorted by name, as the CLI lists them', async ({ page }) => {
  const cli = await atlas(['scan', FIXTURE]);
  const [title, ...lines] = cli.stdout.split('\n');
  await scan(page, FIXTURE);
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  // The CLI's name lines: `name — first sentence`, or the name alone.
  const named = lines.filter((line) => !line.startsWith('  ')).map((line) => line.split(' — '));
  await expect(skills(page).locator('.name')).toHaveText(named.map(([name]) => name));
  await expect(skills(page).filter({ hasText: 'Write commit messages' }).locator('.summary')).toHaveText(
    'Write commit messages the way this repository does.',
  );
});

test('the Scan button scans too', async ({ page }) => {
  await scan(page, FIXTURE, 'button');
  await expect(page.getByRole('heading', { name: 'fixture · 10 skills' })).toBeVisible();
});

test('a long first sentence: at most two lines in the list, whole on hover', async ({ page }) => {
  await scan(page, 'https://github.com/JetBrains/long');
  const summary = skills(page).locator('.summary');
  const sentence = `${'Explains every step of a very long procedure, '.repeat(8)}in detail.`;
  await expect(summary).toHaveText(sentence);
  await expect(summary).toHaveAttribute('title', sentence);
  const { height, line, scrollHeight, clamp } = await summary.evaluate((node) => {
    const style = node.ownerDocument.defaultView!.getComputedStyle(node);
    return {
      height: node.getBoundingClientRect().height,
      line: parseFloat(style.lineHeight),
      scrollHeight: node.scrollHeight,
      clamp: style.getPropertyValue('-webkit-line-clamp'),
    };
  });
  expect(Math.round(height / line)).toBe(2);
  // A line clamp cuts with `…`; the page has no other way to show it.
  expect(clamp).toBe('2');
  expect(scrollHeight).toBeGreaterThan(height); // the rest is cut, not wrapped below
});

test('copies: `also in <paths>`', async ({ page }) => {
  await scan(page, FIXTURE);
  await expect(skills(page).filter({ hasText: /^commits/ }).locator('.copies')).toHaveText('also in .github/skills/commits/SKILL.md');
  await expect(skills(page).filter({ hasText: /^review-pr/ }).locator('.copies')).toHaveText('also in agent/skills/review-pr/SKILL.md');
});

test('the filter: the skills whose name or first sentence contains its text, in any case, and the count', async ({ page }) => {
  await scan(page, FIXTURE);
  await expect(page.getByText('Showing 10 of 10 skills')).toBeVisible();
  // By name: both `deploy` skills.
  await page.getByLabel('Filter').fill('deploy');
  await expect(skills(page).locator('.name')).toHaveText(['deploy', 'deploy']);
  await expect(page.getByText('Showing 2 of 10 skills')).toBeVisible();
  // By first sentence, in any case, spaces around it aside: `… to staging.`
  await page.getByLabel('Filter').fill('  STAGING ');
  await expect(skills(page).locator('.summary')).toHaveText(['Deploy the API to staging.', 'Deploy the app to staging.']);
  // A name and a first sentence: release-checklist, and changelog's `… for a release.`
  await page.getByLabel('Filter').fill('release');
  await expect(skills(page).locator('.name')).toHaveText(['changelog', 'release-checklist']);
  await expect(page.getByText('Showing 2 of 10 skills')).toBeVisible();
  // At once, without a new scan: the address is the same.
  await expect(page).toHaveURL(`/?source=${encodeURIComponent(FIXTURE)}`);
  await page.getByLabel('Filter').fill('');
  await expect(skills(page)).toHaveCount(10);
  await expect(page.getByText('Showing 10 of 10 skills')).toBeVisible();
});

test('the filter: each match of its text is marked in the name and the first sentence', async ({ page }) => {
  await scan(page, FIXTURE);
  await expect(skills(page).locator('mark')).toHaveCount(0);
  // In any case, as it is written in the skill.
  await page.getByLabel('Filter').fill('deploy');
  await expect(skills(page).locator('.name mark')).toHaveText(['deploy', 'deploy']);
  await expect(skills(page).locator('.summary mark')).toHaveText(['Deploy', 'Deploy']);
  await expect(skills(page).locator('.summary').first()).toHaveText('Deploy the API to staging.');
  // Every match: `the` and `the` of `their`; the whole sentence still on hover.
  await page.getByLabel('Filter').fill('THE');
  const upgrade = skills(page).filter({ hasText: /^upgrade/ });
  await expect(upgrade.locator('.summary mark')).toHaveText(['the', 'the']);
  await expect(upgrade.locator('.summary')).toHaveAttribute('title', 'Upgrade the dependencies to their latest versions.');
  // The text, not a pattern: `.` is a dot.
  await page.getByLabel('Filter').fill('.md');
  await expect(skills(page).locator('.name')).toHaveText(['changelog']);
  await expect(skills(page).locator('mark')).toHaveText(['.md']);
  await page.getByLabel('Filter').fill('');
  await expect(skills(page).locator('mark')).toHaveCount(0);
});

test('the filter keeps nothing → `No skills match <text>`', async ({ page }) => {
  await scan(page, FIXTURE);
  await page.getByLabel('Filter').fill(' kotlin ');
  await expect(skills(page)).toHaveCount(0);
  await expect(page.getByText('No skills match kotlin')).toBeVisible();
  await expect(page.getByText(/^Showing /)).toHaveCount(0);
});

test('the filter does not change the chosen skill; a new scan empties it', async ({ page }) => {
  await scan(page, FIXTURE);
  await expect(article(page).getByRole('heading', { level: 2 })).toHaveText('changelog');
  await page.getByLabel('Filter').fill('commit');
  await expect(skills(page).locator('.name')).toHaveText(['commits']);
  await expect(article(page).getByRole('heading', { level: 2 })).toHaveText('changelog');

  await scan(page, 'https://github.com/JetBrains/example');
  await expect(page.getByRole('heading', { name: 'JetBrains/example · 1 skill' })).toBeVisible();
  await expect(page.getByLabel('Filter')).toHaveValue('');
  await expect(page.getByText('Showing 1 of 1 skill')).toBeVisible();
  await expect(skills(page)).toHaveCount(1);
});

test('the warnings, as the CLI prints them', async ({ page }) => {
  const cli = await atlas(['scan', FIXTURE]);
  await scan(page, FIXTURE);
  await expect(page.getByRole('list', { name: 'Warnings' }).getByRole('listitem')).toHaveText(cli.stderr.split('\n'));
});

test('the first skill is chosen at first', async ({ page }) => {
  await scan(page, FIXTURE);
  await expect(article(page).getByRole('heading', { level: 2 })).toHaveText('changelog');
  await expect(skills(page).first()).toHaveAttribute('aria-current', 'true');
});

test("a chosen skill's SKILL.md: the front matter as a table, the body as Markdown, its path", async ({ page }) => {
  await scan(page, FIXTURE);
  await skills(page).filter({ hasText: /^commits/ }).click();
  await expect(article(page).getByRole('heading', { level: 2 })).toHaveText('commits');
  const table = article(page).getByRole('table', { name: 'Front matter' });
  await expect(table.getByRole('row')).toHaveText([
    /^name\s*commits$/,
    /^description\s*Write commit messages the way this repository does\. Use for every commit\.$/,
  ]);
  // `# Commits` and `code` in the body are Markdown, rendered.
  await expect(article(page).getByRole('heading', { level: 1, name: 'Commits' })).toBeVisible();
  await expect(article(page).locator('#skill-body code')).toHaveText('editor: keep the caret after undo');
  await expect(article(page).getByText('also in .github/skills/commits/SKILL.md')).toBeVisible();
  // In a directory: the file's path as text, not a file:// link a web page cannot open.
  await expect(article(page).locator('#skill-location')).toHaveText(join(FIXTURE, '.claude/skills/commits/SKILL.md'));
  await expect(article(page).locator('#skill-location').getByRole('link')).toHaveCount(0);
});

test('malformed front matter: the skill is still shown, under its directory name', async ({ page }) => {
  await scan(page, FIXTURE);
  await skills(page).filter({ hasText: /^release-checklist/ }).click();
  await expect(article(page).getByRole('heading', { level: 1, name: 'Release checklist' })).toBeVisible();
  await expect(article(page).getByRole('listitem')).toHaveText(['Tag the release.', 'Write the release notes.', 'Announce it.']);
});

test('on GitHub: the link pins the scanned commit', async ({ page }) => {
  await scan(page, 'https://github.com/JetBrains/example');
  await expect(page.getByRole('heading', { name: 'JetBrains/example · 1 skill' })).toBeVisible();
  await expect(article(page).getByRole('link', { name: '.claude/skills/commits/SKILL.md' })).toHaveAttribute(
    'href',
    `https://github.com/JetBrains/example/blob/${EXAMPLE_COMMIT}/.claude/skills/commits/SKILL.md`,
  );
});

test('the SKILL.md is untrusted: sanitized, its scripts never run, remote images not loaded', async ({ page }) => {
  // The CSP's violation for the image proves it was not loaded; Chromium reports even a request
  // the CSP blocks, so watching the requests would not. A script in the page, as text: the tests
  // are type-checked without the DOM's types.
  await page.addInitScript({
    content: "globalThis.blocked = []; addEventListener('securitypolicyviolation', (event) => blocked.push(event.blockedURI));",
  });
  await page.reload();
  await scan(page, 'https://github.com/JetBrains/untrusted');
  await expect(article(page).getByRole('heading', { level: 1, name: 'Untrusted' })).toBeVisible();
  await expect(article(page).locator('strong')).toHaveText('bold');
  await expect(article(page).getByRole('row').nth(2)).toHaveText(/^allowed-tools\s*\["Read","Grep"\]$/);
  await article(page).getByText('click').click();
  await expect(article(page).locator('script, [onerror]')).toHaveCount(0);
  expect(await page.evaluate(() => (globalThis as { pwned?: string }).pwned)).toBeUndefined();
  await expect(article(page).getByRole('img', { name: 'tracker' })).toBeAttached();
  await expect.poll(() => page.evaluate(() => (globalThis as { blocked?: string[] }).blocked)).toContain('https://tracker.example/pixel.png');
});

test('no skills → `No skills found`', async ({ page }) => {
  await scan(page, 'https://github.com/JetBrains/empty');
  await expect(page.getByRole('heading', { name: 'JetBrains/empty · 0 skills' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('No skills found');
  await expect(article(page)).toBeHidden();
  // Nothing to filter: no filter field.
  await expect(page.getByLabel('Filter')).toBeHidden();
});

test('an empty field → a hint; an unreachable repository, not a GitHub URL → the clear message of the CLI', async ({ page }) => {
  await scan(page, '');
  await expect(page.getByRole('status')).toHaveText('Enter a GitHub repository URL or a directory');
  const missing = join(FIXTURE, 'no-such-directory');
  await scan(page, missing);
  await expect(page.getByRole('status')).toHaveText(`Not a GitHub URL or a readable directory: ${missing}`);
  await expect(page.getByRole('navigation')).toBeHidden();
  await scan(page, 'https://github.com/JetBrains/not-answered');
  await expect(page.getByRole('status')).toHaveText(/^Cannot reach GitHub: /);
  await scan(page, 'https://gitlab.com/JetBrains/kotlin');
  await expect(page.getByRole('status')).toHaveText('Not a GitHub URL or a readable directory: https://gitlab.com/JetBrains/kotlin');
});

test('the address keeps the link: a reload or a shared link scans it again', async ({ page }) => {
  await scan(page, FIXTURE);
  await expect(page).toHaveURL(`/?source=${encodeURIComponent(FIXTURE)}`);
  await page.reload();
  await expect(page.getByLabel('Repository')).toHaveValue(FIXTURE);
  await expect(page.getByRole('heading', { name: 'fixture · 10 skills' })).toBeVisible();

  await page.goto(`/?source=${encodeURIComponent('https://github.com/JetBrains/example')}`);
  await expect(page.getByRole('heading', { name: 'JetBrains/example · 1 skill' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'fixture · 10 skills' })).toBeVisible();
});

test('back to no repository: a scan still running does not show its result', async ({ page }) => {
  await scan(page, 'https://github.com/JetBrains/slow');
  await expect(page.getByRole('status')).toHaveText('Scanning https://github.com/JetBrains/slow…');
  await page.goBack();
  await expect(page).toHaveURL('/');
  await expect(page.getByLabel('Repository')).toHaveValue('');
  await page.waitForTimeout(SLOW_ANSWER_MS + 500); // past the slow answer
  await expect(page.getByRole('navigation')).toBeHidden();
  await expect(page.getByRole('status')).toBeHidden();
});

test('nothing is stored in the browser', async ({ page, context }) => {
  await scan(page, FIXTURE);
  await expect(page.getByRole('heading', { name: 'fixture · 10 skills' })).toBeVisible();
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  expect(await context.cookies()).toEqual([]);
});

// An organization: its own page, its repositories as they are scanned.

const repositories = (page: Page) => page.getByRole('list', { name: 'Repositories' }).getByRole('listitem');

test('an organization: its own page, each repository with its skill count as the CLI lists it, and the warnings', async ({ page }) => {
  const cli = await atlas(['scan', 'https://github.com/JetBrains']);
  const [title, ...lines] = cli.stdout.split('\n');
  await scan(page, 'https://github.com/JetBrains');
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  const listed = lines.map((line) => line.split(' · '));
  await expect(repositories(page).locator('.name')).toHaveText(listed.map(([name]) => name));
  await expect(repositories(page).locator('.count')).toHaveText(listed.map(([, count]) => count));
  await expect(page.getByRole('list', { name: 'Warnings' }).getByRole('listitem')).toHaveText(cli.stderr.split('\n'));
  // Done: no progress left; not the page of one repository.
  await expect(page.getByRole('status')).toBeHidden();
  await expect(page.getByRole('navigation')).toBeHidden();
  await expect(page).toHaveURL(`/?source=${encodeURIComponent('https://github.com/JetBrains')}`);
});

test("an organization's repository is a link to its own page; back → the organization's page", async ({ page }) => {
  await scan(page, 'https://github.com/JetBrains');
  await expect(repositories(page).filter({ hasText: 'JetBrains/example' }).locator('.count')).toHaveText('1 skill');
  await page.getByRole('link', { name: /^JetBrains\/example/ }).click();
  await expect(page).toHaveURL(`/?source=${encodeURIComponent('https://github.com/JetBrains/example')}`);
  await expect(page.getByRole('heading', { name: 'JetBrains/example · 1 skill' })).toBeVisible();
  await expect(article(page).getByRole('heading', { level: 2 })).toHaveText('commits');
  await expect(page.getByRole('list', { name: 'Repositories' })).toBeHidden();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'JetBrains · 4 repositories' })).toBeVisible();
  await expect(repositories(page)).toHaveCount(4);
});

test('an organization: every repository at once, each count as soon as it is scanned, and the progress', async ({ page }) => {
  await scan(page, 'https://github.com/Slow');
  await expect(page.getByRole('heading', { name: 'Slow · 2 repositories' })).toBeVisible();
  await expect(repositories(page).locator('.count')).toHaveText(['0 skills', '…']);
  await expect(page.getByRole('status')).toHaveText('Scanned 1 of 2 repositories…');
  await expect(repositories(page).locator('.count')).toHaveText(['0 skills', '0 skills'], { timeout: SLOW_ANSWER_MS * 3 });
  await expect(page.getByRole('status')).toBeHidden();
});

test('an organization: another scan while it runs → that one, the organization is not shown', async ({ page }) => {
  await scan(page, 'https://github.com/Slow');
  await expect(page.getByRole('status')).toHaveText('Scanned 1 of 2 repositories…');
  await scan(page, 'https://github.com/JetBrains/example');
  await expect(page.getByRole('heading', { name: 'JetBrains/example · 1 skill' })).toBeVisible();
  await page.waitForTimeout(SLOW_ANSWER_MS + 500); // past the slow answer
  await expect(page.getByRole('list', { name: 'Repositories' })).toBeHidden();
  await expect(page.getByRole('heading', { name: 'JetBrains/example · 1 skill' })).toBeVisible();
});

test('an organization, GitHub answers no more → its message, red, above; the repositories left `not scanned`', async ({ page }) => {
  await scan(page, 'https://github.com/Limited');
  await expect(page.getByRole('status')).toHaveText('GitHub rate limit reached; try again in a minute');
  await expect(page.getByRole('status')).toHaveClass(/error/);
  await expect(page.getByRole('heading', { name: 'Limited · 3 repositories' })).toBeVisible();
  await expect(repositories(page).locator('.count')).toHaveText(['0 skills', 'not scanned', 'not scanned']);
});

test('an organization without repositories → `No repositories found`; one GitHub does not know → the CLI message', async ({ page }) => {
  await scan(page, 'https://github.com/nobody');
  await expect(page.getByRole('heading', { name: 'nobody · 0 repositories' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('No repositories found');
  await scan(page, 'https://github.com/no-such-owner');
  await expect(page.getByRole('status')).toHaveText('Organization not found: https://github.com/no-such-owner');
  await expect(page.getByRole('list', { name: 'Repositories' })).toBeHidden();
});
