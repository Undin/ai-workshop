// The decisions in spec/web.md, checked in a browser on the page that `skill-atlas serve` serves:
// ./fixture, and GitHub repositories answered in tests/helpers.ts and tests/serve-test.ts.
// In tests/web, not e2e/: these never reach the network; e2e/ is the CLI on real repositories.
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { atlas, EXAMPLE_COMMIT, EXAMPLE_UPDATED, FIXTURE, SLOW_ANSWER_MS } from '../helpers.ts';

/** Types the repository link into the field and scans it. */
async function scan(page: Page, source: string, how: 'enter' | 'button' = 'enter') {
  await page.getByLabel('Repository').fill(source);
  if (how === 'enter') await page.getByLabel('Repository').press('Enter');
  else await page.getByRole('button', { name: 'Scan' }).click();
}

const skills = (page: Page) => page.getByRole('list', { name: 'Skills' }).getByRole('button');
const article = (page: Page) => page.getByRole('article');
const updated = (page: Page) => article(page).locator('#skill-updated');

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

test('copies: a badge after the name, `+1 copy`, the paths on hover; no copies, no badge', async ({ page }) => {
  await scan(page, FIXTURE);
  const commits = skills(page).filter({ hasText: /^commits/ });
  await expect(commits.locator('.copies')).toHaveText('+1 copy');
  await expect(commits.locator('.copies')).toHaveAttribute('title', 'also in .github/skills/commits/SKILL.md');
  // On the name's line, after it; no `also in` line in the list.
  const [name, badge] = await Promise.all([commits.locator('.name').boundingBox(), commits.locator('.copies').boundingBox()]);
  expect(badge!.x).toBeGreaterThan(name!.x + name!.width);
  expect(Math.abs(badge!.y + badge!.height / 2 - (name!.y + name!.height / 2))).toBeLessThan(name!.height / 2);
  await expect(page.getByRole('list', { name: 'Skills' }).getByText(/also in/)).toHaveCount(0);
  await expect(skills(page).filter({ hasText: /^review-pr/ }).locator('.copies')).toHaveAttribute(
    'title',
    'also in agent/skills/review-pr/SKILL.md',
  );
  // No copies: no badge.
  for (const deploy of await skills(page).filter({ hasText: /^deploy/ }).all()) await expect(deploy.locator('.copies')).toHaveCount(0);
});

test('two copies: `+2 copies`, both paths on hover', async ({ page }) => {
  await scan(page, 'https://github.com/JetBrains/copies');
  await expect(page.getByRole('heading', { name: 'JetBrains/copies · 1 skill' })).toBeVisible();
  await expect(skills(page).locator('.copies')).toHaveText('+2 copies');
  await expect(skills(page).locator('.copies')).toHaveAttribute('title', 'also in .claude/skills/review/SKILL.md, .github/skills/review/SKILL.md');
});

test('a divider between two skills; the chosen one keeps its highlight', async ({ page }) => {
  await scan(page, FIXTURE);
  const items = page.getByRole('list', { name: 'Skills' }).getByRole('listitem');
  await expect(items).toHaveCount(10);
  const borders = await items.evaluateAll((nodes) => nodes.map((node) => node.ownerDocument.defaultView!.getComputedStyle(node).borderTopStyle));
  expect(borders).toEqual(['none', ...Array(9).fill('solid')]);
  const background = (button: ReturnType<typeof skills>) => button.evaluate((node) => node.ownerDocument.defaultView!.getComputedStyle(node).backgroundColor);
  await expect(skills(page).first()).toHaveAttribute('aria-current', 'true');
  expect(await background(skills(page).first())).not.toBe(await background(skills(page).nth(1)));
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
  // The copies' badge is neither filtered nor marked.
  await page.getByLabel('Filter').fill('copy');
  await expect(page.getByText('No skills match copy')).toBeVisible();
  await page.getByLabel('Filter').fill('commits');
  await expect(skills(page).locator('.copies')).toHaveText(['+1 copy']);
  await expect(skills(page).locator('.copies mark')).toHaveCount(0);
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

test('in the top right corner of the chosen skill: when it was last updated, the date in UTC, the time on hover; another skill, its own', async ({ page }) => {
  await scan(page, 'https://github.com/JetBrains/dates');
  await expect(article(page).getByRole('heading', { level: 2 })).toHaveText('first');
  await expect(updated(page)).toHaveText('Updated 2026-10-14');
  await expect(updated(page)).toHaveAttribute('title', '2026-10-14 12:53 UTC');
  await expect(updated(page).locator('time')).toHaveAttribute('datetime', '2026-10-14T12:53:27.000Z');
  // The top right corner: on the name's line, right of it, at the right edge of the SKILL.md.
  const name = (await article(page).getByRole('heading', { level: 2 }).boundingBox())!;
  const corner = (await updated(page).boundingBox())!;
  const right = await article(page).evaluate((node) => {
    const box = node.getBoundingClientRect();
    return box.right - parseFloat(node.ownerDocument.defaultView!.getComputedStyle(node).paddingRight);
  });
  expect(corner.x).toBeGreaterThan(name.x + name.width);
  expect(Math.abs(corner.x + corner.width - right)).toBeLessThan(1);
  expect(corner.y).toBeLessThan(name.y + name.height / 2);
  // Another skill: its own date, in UTC (`2025-03-02T23:30:00-05:00`).
  await skills(page).filter({ hasText: /^second/ }).click();
  await expect(updated(page)).toHaveText('Updated 2025-03-03');
  await expect(updated(page)).toHaveAttribute('title', '2025-03-03 04:30 UTC');
});

test('the last update cannot be known → `Last update unknown`, why on hover', async ({ page }) => {
  await scan(page, 'https://github.com/JetBrains/dates');
  await skills(page).filter({ hasText: /^limited/ }).click();
  await expect(updated(page)).toHaveText('Last update unknown');
  await expect(updated(page)).toHaveAttribute('title', 'GitHub rate limit reached; try again in a minute');
  await skills(page).filter({ hasText: /^uncommitted/ }).click();
  await expect(updated(page)).toHaveText('Last update unknown');
  await expect(updated(page)).toHaveAttribute(
    'title',
    `No commit changed .claude/skills/uncommitted in https://github.com/JetBrains/dates up to ${EXAMPLE_COMMIT}`,
  );
  // Known again for a skill that has it.
  await skills(page).filter({ hasText: /^first/ }).click();
  await expect(updated(page)).toHaveText('Updated 2026-10-14');
});

test('the last update in a directory: a date too', async ({ page }) => {
  await scan(page, FIXTURE);
  await expect(updated(page)).toHaveText(/^Updated \d{4}-\d{2}-\d{2}$/);
  await expect(updated(page)).toHaveAttribute('title', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/);
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

// An organization: its own page, its repositories as they are scanned, their pages from that scan.

const repositories = (page: Page) => page.getByRole('list', { name: 'Repositories' }).getByRole('listitem');
const progress = (page: Page) => page.locator('#progress');

/** Every GET /api/scan the page asks for, as it goes. */
function scansOf(page: Page): string[] {
  const scans: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/scan') scans.push(new URL(request.url()).searchParams.get('source')!);
  });
  return scans;
}

test('an organization: its own page, each repository with its skill count as the CLI lists it, and the warnings', async ({ page }) => {
  const cli = await atlas(['scan', 'https://github.com/JetBrains']);
  const [title, ...lines] = cli.stdout.split('\n');
  await scan(page, 'https://github.com/JetBrains');
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  const listed = lines.map((line) => line.split(' · '));
  await expect(repositories(page).locator('.name')).toHaveText(listed.map(([name]) => name));
  await expect(repositories(page).locator('.count')).toHaveText(listed.map(([, count]) => count));
  await expect(page.getByRole('list', { name: 'Warnings' }).getByRole('listitem')).toHaveText(cli.stderr.split('\n'));
  // A link for each scanned repository; not for one that is not.
  await expect(page.getByRole('list', { name: 'Repositories' }).getByRole('link')).toHaveText([
    /^JetBrains\/example/,
    /^JetBrains\/malformed/,
    /^JetBrains\/none/,
  ]);
  // Done: no progress left; not the page of one repository.
  await expect(progress(page)).toBeHidden();
  await expect(page.getByRole('status')).toBeHidden();
  await expect(page.getByRole('navigation')).toBeHidden();
  await expect(page).toHaveURL(`/?source=${encodeURIComponent('https://github.com/JetBrains')}`);
});

test("a scanned repository is a link to its page, from the organization's scan; back and forth, no new scan; a reload scans afresh", async ({ page }) => {
  const scans = scansOf(page);
  await scan(page, 'https://github.com/JetBrains');
  await page.getByRole('link', { name: /^JetBrains\/example/ }).click();
  await expect(page).toHaveURL(`/?source=${encodeURIComponent('https://github.com/JetBrains/example')}`);
  await expect(page.getByLabel('Repository')).toHaveValue('https://github.com/JetBrains/example');
  await expect(page.getByRole('heading', { name: 'JetBrains/example · 1 skill' })).toBeVisible();
  await expect(article(page).getByRole('heading', { level: 2 })).toHaveText('commits');
  await expect(article(page).getByRole('link', { name: '.claude/skills/commits/SKILL.md' })).toHaveAttribute(
    'href',
    `https://github.com/JetBrains/example/blob/${EXAMPLE_COMMIT}/.claude/skills/commits/SKILL.md`,
  );
  // Its last update, from the organization's scan.
  await expect(updated(page)).toHaveText(`Updated ${EXAMPLE_UPDATED.date.slice(0, 10)}`);
  await expect(page.getByRole('list', { name: 'Repositories' })).toBeHidden();
  // Its warnings, from the organization's scan.
  await page.goBack();
  await page.getByRole('link', { name: /^JetBrains\/malformed/ }).click();
  await expect(page.getByRole('heading', { name: 'JetBrains/malformed · 2 skills' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Warnings' }).getByRole('listitem')).toHaveText([/^warning: \.claude\/skills\/broken\/SKILL\.md: malformed front matter/]);
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'JetBrains · 4 repositories' })).toBeVisible();
  await expect(repositories(page)).toHaveCount(4);
  await page.goForward();
  await expect(page.getByRole('heading', { name: 'JetBrains/malformed · 2 skills' })).toBeVisible();
  await page.goBack();
  await page.getByRole('link', { name: /^JetBrains\/example/ }).click();
  await expect(page.getByRole('heading', { name: 'JetBrains/example · 1 skill' })).toBeVisible();
  expect(scans).toEqual(['https://github.com/JetBrains']);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'JetBrains/example · 1 skill' })).toBeVisible();
  expect(scans).toEqual(['https://github.com/JetBrains', 'https://github.com/JetBrains/example']);
});

test('an organization: every repository at once, each count as soon as it is scanned, the progress; no link until scanned', async ({ page }) => {
  await scan(page, 'https://github.com/Slow');
  await expect(page.getByRole('heading', { name: 'Slow · 2 repositories' })).toBeVisible();
  await expect(repositories(page).locator('.count')).toHaveText(['0 skills', '…']);
  await expect(progress(page)).toHaveText(/^Scanning Slow: 1 of 2 repositories…\s*Stop$/);
  await expect(page.getByRole('list', { name: 'Repositories' }).getByRole('link')).toHaveText([/^Slow\/first/]);
  await expect(repositories(page).locator('.count')).toHaveText(['0 skills', '0 skills'], { timeout: SLOW_ANSWER_MS * 4 });
  await expect(page.getByRole('list', { name: 'Repositories' }).getByRole('link')).toHaveCount(2);
  await expect(progress(page)).toBeHidden();
  await expect(page.getByRole('status')).toBeHidden();
});

test("the organization's scan goes on on a repository's page: its progress, a link back; back → what the scan has", async ({ page }) => {
  const scans = scansOf(page);
  await scan(page, 'https://github.com/Slow');
  await page.getByRole('link', { name: /^Slow\/first/ }).click();
  await expect(page.getByRole('heading', { name: 'Slow/first · 0 skills' })).toBeVisible();
  await expect(progress(page)).toHaveText(/^Scanning Slow: 1 of 2 repositories…\s*Stop$/);
  // The link in the progress: back to the organization's page, the scan still going on.
  await progress(page).getByRole('link', { name: 'Slow' }).click();
  await expect(page).toHaveURL(`/?source=${encodeURIComponent('https://github.com/Slow')}`);
  await expect(page.getByRole('heading', { name: 'Slow · 2 repositories' })).toBeVisible();
  await expect(repositories(page).locator('.count')).toHaveText(['0 skills', '…']);
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Slow/first · 0 skills' })).toBeVisible();
  // Done while on the repository's page: the progress goes; back, the organization's page has it all.
  await expect(progress(page)).toBeHidden({ timeout: SLOW_ANSWER_MS * 4 });
  await page.goBack();
  await expect(repositories(page).locator('.count')).toHaveText(['0 skills', '0 skills']);
  expect(scans).toEqual(['https://github.com/Slow']);
});

test("Stop: on the organization's page or a repository's, the scan stops, the repositories left not scanned", async ({ page }) => {
  await scan(page, 'https://github.com/Slow');
  await expect(repositories(page).locator('.count')).toHaveText(['0 skills', '…']);
  await progress(page).getByRole('button', { name: 'Stop' }).click();
  await expect(progress(page)).toBeHidden();
  await expect(page.getByRole('status')).toHaveText('Stopped after 1 of 2 repositories');
  await expect(repositories(page).locator('.count')).toHaveText(['0 skills', 'not scanned']);
  // Past the slow answer: nothing more comes.
  await page.waitForTimeout(SLOW_ANSWER_MS * 2 + 500);
  await expect(repositories(page).locator('.count')).toHaveText(['0 skills', 'not scanned']);

  // On a repository's page.
  await scan(page, 'https://github.com/Slow', 'button');
  await page.getByRole('link', { name: /^Slow\/first/ }).click();
  await progress(page).getByRole('button', { name: 'Stop' }).click();
  await expect(progress(page)).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Slow/first · 0 skills' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('status')).toHaveText('Stopped after 1 of 2 repositories');
  await expect(repositories(page).locator('.count')).toHaveText(['0 skills', 'not scanned']);
});

test("an organization: scanning anything else stops it; back to it, a fresh scan", async ({ page }) => {
  const scans = scansOf(page);
  await scan(page, 'https://github.com/Slow');
  await expect(progress(page)).toHaveText(/^Scanning Slow: 1 of 2 repositories…/);
  await scan(page, 'https://github.com/JetBrains/example');
  await expect(page.getByRole('heading', { name: 'JetBrains/example · 1 skill' })).toBeVisible();
  await expect(progress(page)).toBeHidden();
  await page.waitForTimeout(SLOW_ANSWER_MS + 500); // past the slow answer
  await expect(page.getByRole('list', { name: 'Repositories' })).toBeHidden();
  await expect(page.getByRole('heading', { name: 'JetBrains/example · 1 skill' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Slow · 2 repositories' })).toBeVisible();
  expect(scans).toEqual(['https://github.com/Slow', 'https://github.com/JetBrains/example', 'https://github.com/Slow']);
});

test('an organization, GitHub answers no more → its message, red, above; the repositories left `not scanned`', async ({ page }) => {
  await scan(page, 'https://github.com/Limited');
  await expect(page.getByRole('status')).toHaveText('GitHub rate limit reached; try again in a minute');
  await expect(page.getByRole('status')).toHaveClass(/error/);
  await expect(page.getByRole('heading', { name: 'Limited · 3 repositories' })).toBeVisible();
  await expect(repositories(page).locator('.count')).toHaveText(['0 skills', 'not scanned', 'not scanned']);
  await expect(progress(page)).toBeHidden();
});

test('an organization without repositories → `No repositories found`; one GitHub does not know → the CLI message', async ({ page }) => {
  await scan(page, 'https://github.com/nobody');
  await expect(page.getByRole('heading', { name: 'nobody · 0 repositories' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('No repositories found');
  await expect(progress(page)).toBeHidden();
  await scan(page, 'https://github.com/no-such-owner');
  await expect(page.getByRole('status')).toHaveText('Organization not found: https://github.com/no-such-owner');
  await expect(page.getByRole('list', { name: 'Repositories' })).toBeHidden();
});

// Groups (spec/web.md, Groups): the skills of a scan that is over, in their groups (spec/analysis.md, Group).

const groupHeadings = (page: Page) => page.getByRole('list', { name: 'Groups' }).getByRole('heading', { level: 3 });
const inGroup = (page: Page, name: string) => page.getByRole('list', { name }).getByRole('button');
const groupSkills = (page: Page) => page.getByRole('button', { name: 'Group skills' });

test("Group skills: a repository's skills in their groups, in the order of the list, Other last; a skill → its SKILL.md", async ({ page }) => {
  await scan(page, 'https://github.com/JetBrains/groups');
  await expect(page.getByRole('heading', { name: 'JetBrains/groups · 10 skills' })).toBeVisible();
  await groupSkills(page).click();
  await expect(page).toHaveURL(`/?source=${encodeURIComponent('https://github.com/JetBrains/groups')}&view=groups`);
  await expect(page.getByRole('heading', { name: 'JetBrains/groups · 10 skills in 6 groups' })).toBeVisible();
  // No empty group; each with how many it has.
  await expect(groupHeadings(page)).toHaveText([
    'Testing · 1 skill',
    'Releases & changelogs · 1 skill',
    'Code review & quality · 1 skill',
    'Git & pull requests · 1 skill',
    'Build & CI/CD · 1 skill',
    'Other · 5 skills',
  ]);
  // By name, as in the list: the name and the first sentence; no filter, no list of skills.
  await expect(inGroup(page, 'Other').locator('.name')).toHaveText(['latest', 'mystery', 'nopressure', 'notes', 'pull-logs']);
  await expect(inGroup(page, 'Testing')).toHaveText(['run-tests' + 'Run the tests before pushing.']);
  await expect(inGroup(page, 'Testing').locator('.repository')).toHaveCount(0);
  await expect(page.getByLabel('Filter')).toBeHidden();
  await expect(page.getByRole('list', { name: 'Skills' })).toBeHidden();
  // The first one chosen at first; another, its SKILL.md as on the repository's page.
  await expect(inGroup(page, 'Testing')).toHaveAttribute('aria-current', 'true');
  await expect(article(page).getByRole('heading', { level: 2 })).toHaveText('run-tests');
  await inGroup(page, 'Build & CI/CD').click();
  await expect(inGroup(page, 'Build & CI/CD')).toHaveAttribute('aria-current', 'true');
  await expect(inGroup(page, 'Testing')).not.toHaveAttribute('aria-current', 'true');
  await expect(article(page).getByRole('heading', { level: 2 })).toHaveText('deploy');
  await expect(article(page).getByRole('table', { name: 'Front matter' })).toContainText('Run the tests, then review the release.');
  await expect(article(page).getByRole('link', { name: '.claude/skills/deploy/SKILL.md' })).toHaveAttribute(
    'href',
    `https://github.com/JetBrains/groups/blob/${EXAMPLE_COMMIT}/.claude/skills/deploy/SKILL.md`,
  );
  await expect(updated(page)).toHaveText('Updated 2026-05-05');
});

test('Back to skills, or Back: the list again, no new scan; a reload of the groups scans again and shows them', async ({ page }) => {
  const scans = scansOf(page);
  await scan(page, FIXTURE);
  await groupSkills(page).click();
  await expect(page.getByRole('heading', { name: 'fixture · 10 skills in 7 groups' })).toBeVisible();
  await page.getByRole('link', { name: 'Back to skills' }).click();
  await expect(page).toHaveURL(`/?source=${encodeURIComponent(FIXTURE)}`);
  await expect(page.getByRole('heading', { name: 'fixture · 10 skills' })).toBeVisible();
  await expect(skills(page)).toHaveCount(10);
  // Back: the groups, then the list.
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'fixture · 10 skills in 7 groups' })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(`/?source=${encodeURIComponent(FIXTURE)}`);
  await expect(skills(page)).toHaveCount(10);
  expect(scans).toEqual([FIXTURE]);

  await page.goForward();
  await expect(page.getByRole('heading', { name: 'fixture · 10 skills in 7 groups' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'fixture · 10 skills in 7 groups' })).toBeVisible();
  await expect(groupHeadings(page)).toHaveText([
    'Testing · 1 skill',
    'Releases & changelogs · 2 skills',
    'Code review & quality · 2 skills',
    'Git & pull requests · 1 skill',
    'Refactoring & migrations · 1 skill',
    'Build & CI/CD · 2 skills',
    'Other · 1 skill',
  ]);
  expect(scans).toEqual([FIXTURE, FIXTURE]);
});

test('no Group skills while a repository is scanned, nor when it has no skills', async ({ page }) => {
  await scan(page, 'https://github.com/JetBrains/slow');
  await expect(page.getByRole('status')).toHaveText('Scanning https://github.com/JetBrains/slow…');
  await expect(groupSkills(page)).toBeHidden();
  await scan(page, 'https://github.com/JetBrains/empty');
  await expect(page.getByRole('status')).toHaveText('No skills found');
  await expect(groupSkills(page)).toBeHidden();
});

test("an organization: no Group skills while it runs; once done, all its skills in their groups, each with its repository", async ({ page }) => {
  await scan(page, 'https://github.com/Halting');
  await expect(progress(page)).toHaveText(/^Scanning Halting: 1 of 2 repositories…/);
  await expect(groupSkills(page)).toBeHidden();
  await expect(progress(page)).toBeHidden({ timeout: SLOW_ANSWER_MS * 4 });
  await groupSkills(page).click();
  await expect(page).toHaveURL(`/?source=${encodeURIComponent('https://github.com/Halting')}&view=groups`);
  await expect(page.getByRole('heading', { name: 'Halting · 3 skills in 2 groups' })).toBeVisible();
  await expect(groupHeadings(page)).toHaveText(['Testing · 2 skills', 'Git & pull requests · 1 skill']);
  await expect(inGroup(page, 'Testing').locator('.name')).toHaveText(['e2e', 'run-tests']);
  await expect(inGroup(page, 'Testing').locator('.repository')).toHaveText(['Halting/late', 'Halting/first']);
  await inGroup(page, 'Testing').first().click();
  await expect(article(page).getByRole('link', { name: '.claude/skills/e2e/SKILL.md' })).toHaveAttribute(
    'href',
    `https://github.com/Halting/late/blob/${EXAMPLE_COMMIT}/.claude/skills/e2e/SKILL.md`,
  );
  await page.getByRole('link', { name: 'Back to repositories' }).click();
  await expect(page.getByRole('heading', { name: 'Halting · 2 repositories' })).toBeVisible();

  // The same name in two repositories: two skills, by repository.
  await scan(page, 'https://github.com/JetBrains');
  await groupSkills(page).click();
  await expect(page.getByRole('heading', { name: 'JetBrains · 3 skills in 2 groups' })).toBeVisible();
  await expect(groupHeadings(page)).toHaveText(['Git & pull requests · 2 skills', 'Other · 1 skill']);
  await expect(inGroup(page, 'Git & pull requests').locator('.repository')).toHaveText(['JetBrains/example', 'JetBrains/malformed']);
  await expect(inGroup(page, 'Other')).toHaveText(['broken' + 'JetBrains/malformed']);
});

test('an organization stopped: Group skills, the skills of the repositories scanned', async ({ page }) => {
  await scan(page, 'https://github.com/Halting');
  await progress(page).getByRole('button', { name: 'Stop' }).click();
  await groupSkills(page).click();
  await expect(page.getByRole('status')).toHaveText('Stopped after 1 of 2 repositories');
  await expect(page.getByRole('heading', { name: 'Halting · 2 skills in 2 groups' })).toBeVisible();
  await expect(groupHeadings(page)).toHaveText(['Testing · 1 skill', 'Git & pull requests · 1 skill']);
  // Nothing scanned: nothing to group.
  await scan(page, 'https://github.com/Slow');
  await expect(repositories(page).locator('.count')).toHaveText(['0 skills', '0 skills'], { timeout: SLOW_ANSWER_MS * 4 });
  await expect(groupSkills(page)).toBeHidden();
});

test("a repository's page during the organization's scan: Group skills, its own skills; the scan goes on", async ({ page }) => {
  const scans = scansOf(page);
  await scan(page, 'https://github.com/Halting');
  await page.getByRole('link', { name: /^Halting\/first/ }).click();
  await groupSkills(page).click();
  await expect(page).toHaveURL(`/?source=${encodeURIComponent('https://github.com/Halting/first')}&view=groups`);
  await expect(page.getByRole('heading', { name: 'Halting/first · 2 skills in 2 groups' })).toBeVisible();
  await expect(progress(page)).toHaveText(/^Scanning Halting: 1 of 2 repositories…/);
  await expect(progress(page)).toBeHidden({ timeout: SLOW_ANSWER_MS * 4 });
  await page.getByRole('link', { name: 'Back to skills' }).click();
  await expect(page.getByRole('heading', { name: 'Halting/first · 2 skills' })).toBeVisible();
  expect(scans).toEqual(['https://github.com/Halting']);
});

test("a reload of an organization's groups: its page and progress meanwhile, then the groups", async ({ page }) => {
  await page.goto(`/?source=${encodeURIComponent('https://github.com/Halting')}&view=groups`);
  await expect(page.getByRole('heading', { name: 'Halting · 2 repositories' })).toBeVisible();
  await expect(progress(page)).toHaveText(/^Scanning Halting: 1 of 2 repositories…/);
  await expect(page.getByRole('heading', { name: 'Halting · 3 skills in 2 groups' })).toBeVisible({ timeout: SLOW_ANSWER_MS * 4 });
  await expect(progress(page)).toBeHidden();
});
