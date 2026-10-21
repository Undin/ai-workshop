// Groups (spec/web.md, Groups; spec/analysis.md, Group; #38) on JetBrains/youtrackdb, then on the
// JetBrains organization: Group skills once a scan is over, each group with its skills, a skill's
// SKILL.md from there, Back to skills; for an organization, after Stop, the skills of the
// repositories scanned, each with its repository.
// A real repository changes: what is checked is what the page does, not which skills it has.
import { expect, faster, keyPoint, pause, test, type } from './demo.ts';
import type { Page } from '@playwright/test';

const headings = (page: Page) => page.getByRole('list', { name: 'Groups' }).getByRole('heading', { level: 3 });
const grouped = (page: Page) => page.getByRole('list', { name: 'Groups' }).getByRole('button');

/** The groups: as many skills in them as the heading says, each group's count its own; the first skill chosen. */
async function checkGroups(page: Page, owner: string, all: number) {
  const heading = page.getByRole('heading', { name: new RegExp(`^${owner} · ${all} skills? in \\d+ groups?$`) });
  await expect(heading).toBeVisible();
  const groups = Number((await heading.textContent())!.match(/in (\d+) group/)![1]);
  await expect(headings(page)).toHaveCount(groups);
  await expect(grouped(page)).toHaveCount(all);
  for (const group of await page.getByRole('list', { name: 'Groups' }).locator(':scope > li').all()) {
    const shown = Number((await group.getByRole('heading').textContent())!.match(/· (\d+) skills?$/)![1]);
    await expect(group.getByRole('button')).toHaveCount(shown);
  }
  // Other, if any, last.
  const other = (await headings(page).allTextContents()).findIndex((name) => name.startsWith('Other ·'));
  if (other >= 0) expect(other).toBe(groups - 1);
  await expect(grouped(page).first()).toHaveAttribute('aria-current', 'true');
}

test('groups', async ({ page }) => {
  await page.goto('/');
  await type(page.getByLabel('Repository'), 'https://github.com/JetBrains/youtrackdb', 60);
  await page.getByRole('button', { name: 'Scan' }).click();
  const title = page.getByRole('heading', { name: /^JetBrains\/youtrackdb · \d+ skills$/ });
  await faster(page, 4, () => expect(title).toBeVisible({ timeout: 120_000 }));
  const all = await page.getByRole('list', { name: 'Skills' }).getByRole('button').count();
  await keyPoint(page, 'skills');
  await pause(page, 1500);

  // Group skills: each group with its skills, the first one's SKILL.md.
  await page.getByRole('button', { name: 'Group skills' }).hover();
  await pause(page, 800);
  await page.getByRole('button', { name: 'Group skills' }).click();
  await expect(page).toHaveURL(/&view=groups$/);
  await checkGroups(page, 'JetBrains/youtrackdb', all);
  await keyPoint(page, 'groups');
  await pause(page, 3000);

  // A skill of another group: its SKILL.md, as on the repository's page.
  const last = grouped(page).last();
  await last.evaluate((row) => row.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  await last.hover();
  await pause(page, 800);
  const name = (await last.locator('.name').textContent())!;
  await last.click();
  await expect(last).toHaveAttribute('aria-current', 'true');
  await expect(page.getByRole('article').locator('#skill-name')).toHaveText(name);
  await expect(page.getByRole('article').getByRole('table', { name: 'Front matter' })).toBeVisible();
  await expect(page.getByRole('article').locator('#skill-updated')).toHaveText(/^(Updated \d{4}-\d\d-\d\d|Last update unknown)$/);
  await keyPoint(page, 'skill-from-group');
  await pause(page, 2500);

  // Back to skills: the list, no new scan.
  await page.locator('body').evaluate((body) => body.ownerDocument.defaultView!.scrollTo({ top: 0, behavior: 'smooth' }));
  await page.getByRole('link', { name: 'Back to skills' }).hover();
  await pause(page, 800);
  await page.getByRole('link', { name: 'Back to skills' }).click();
  await expect(title).toBeVisible();
  await expect(page.getByRole('list', { name: 'Skills' }).getByRole('button')).toHaveCount(all);
  await keyPoint(page, 'back-to-skills');
  await pause(page, 2000);

  // An organization: no Group skills while it runs.
  await type(page.getByLabel('Repository'), 'https://github.com/JetBrains', 60);
  await page.getByRole('button', { name: 'Scan' }).click();
  const organization = page.getByRole('heading', { name: /^JetBrains · \d+ repositories$/ });
  await faster(page, 4, () => expect(organization).toBeVisible({ timeout: 60_000 }));
  const list = page.getByRole('list', { name: 'Repositories' });
  const withSkills = list.getByRole('listitem').filter({ has: page.locator('.count', { hasText: /^[1-9]\d* skills?$/ }) });
  const scanning = list.getByRole('listitem').filter({ has: page.locator('.count', { hasText: '…' }) }).first();
  await expect(page.getByRole('button', { name: 'Group skills' })).toBeHidden();
  await keyPoint(page, 'organization-scanning');
  // Following the scan down the list, until two repositories with skills are scanned.
  await faster(page, 8, async () => {
    for (const deadline = Date.now() + 180_000; (await withSkills.count()) < 2; ) {
      expect(Date.now(), 'two scanned repositories with skills').toBeLessThan(deadline);
      await scanning.evaluate((row) => row.scrollIntoView({ block: 'center', behavior: 'smooth' })).catch(() => {});
      await pause(page, 1000);
    }
  });

  // Stop: the scan is over, Group skills for the repositories scanned.
  await page.locator('body').evaluate((body) => body.ownerDocument.defaultView!.scrollTo({ top: 0, behavior: 'smooth' }));
  await page.locator('#progress').getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByRole('status')).toHaveText(/^Stopped after \d+ of \d+ repositories$/);
  const counts = await withSkills.locator('.count').allTextContents();
  const total = counts.reduce((sum, count) => sum + Number(count.split(' ')[0]), 0);
  const repositories = await withSkills.locator('.name').allTextContents();
  await page.getByRole('button', { name: 'Group skills' }).hover();
  await keyPoint(page, 'organization-stopped');
  await pause(page, 1500);
  await page.getByRole('button', { name: 'Group skills' }).click();
  await checkGroups(page, 'JetBrains', total);
  // Each skill with its repository, one of those scanned.
  for (const repository of await grouped(page).locator('.repository').allTextContents()) expect(repositories).toContain(repository);
  await expect(page.getByRole('status')).toHaveText(/^Stopped after \d+ of \d+ repositories$/);
  await keyPoint(page, 'organization-groups');
  await pause(page, 3000);
  await page.getByRole('link', { name: 'Back to repositories' }).hover();
  await pause(page, 800);
  await page.getByRole('link', { name: 'Back to repositories' }).click();
  await expect(organization).toBeVisible();
});
