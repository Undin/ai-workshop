// The decisions in spec/web.md, checked in a browser on the page that `skill-atlas serve` serves:
// ./fixture, and GitHub repositories answered in tests/helpers.ts and tests/serve-test.ts.
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { atlas, EXAMPLE_COMMIT, FIXTURE } from '../tests/helpers.ts';

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
  const { height, line, scrollHeight } = await summary.evaluate((node) => ({
    height: node.getBoundingClientRect().height,
    line: parseFloat(node.ownerDocument.defaultView!.getComputedStyle(node).lineHeight),
    scrollHeight: node.scrollHeight,
  }));
  expect(Math.round(height / line)).toBe(2);
  expect(scrollHeight).toBeGreaterThan(height); // the rest is cut, not wrapped below
});

test('copies: `also in <paths>`', async ({ page }) => {
  await scan(page, FIXTURE);
  await expect(skills(page).filter({ hasText: /^commits/ }).locator('.copies')).toHaveText('also in .github/skills/commits/SKILL.md');
  await expect(skills(page).filter({ hasText: /^review-pr/ }).locator('.copies')).toHaveText('also in agent/skills/review-pr/SKILL.md');
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
  await expect(article(page).locator('code')).toHaveText('editor: keep the caret after undo');
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
  const remote: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith('http://localhost:')) remote.push(request.url());
  });
  await scan(page, 'https://github.com/JetBrains/untrusted');
  await expect(article(page).getByRole('heading', { level: 1, name: 'Untrusted' })).toBeVisible();
  await expect(article(page).locator('strong')).toHaveText('bold');
  await expect(article(page).getByRole('row').nth(2)).toHaveText(/^allowed-tools\s*\["Read","Grep"\]$/);
  await article(page).getByText('click').click();
  await expect(article(page).locator('script, [onerror]')).toHaveCount(0);
  expect(await page.evaluate(() => (globalThis as { pwned?: string }).pwned)).toBeUndefined();
  await expect(article(page).getByRole('img', { name: 'tracker' })).toBeAttached();
  expect(remote).toEqual([]);
});

test('no skills → `No skills found`', async ({ page }) => {
  await scan(page, 'https://github.com/JetBrains/empty');
  await expect(page.getByRole('heading', { name: 'JetBrains/empty · 0 skills' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('No skills found');
  await expect(article(page)).toBeHidden();
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

test('nothing is stored in the browser', async ({ page, context }) => {
  await scan(page, FIXTURE);
  await expect(page.getByRole('heading', { name: 'fixture · 10 skills' })).toBeVisible();
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  expect(await context.cookies()).toEqual([]);
});
