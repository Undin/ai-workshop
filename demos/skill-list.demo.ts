// The skill list (spec/web.md, Page; #30) on JetBrains/MPS: a divider between two skills, and each
// skill's copies as a badge after its name, `+1 copy`, `+2 copies`, their paths on hover and in the
// chosen skill's pane. A real repository changes: what is checked is how the list shows the copies,
// not which skills have them.
import { expect, keyPoint, pause, test, type } from './demo.ts';
import type { Locator, Page } from '@playwright/test';

const skills = (page: Page) => page.getByRole('list', { name: 'Skills' }).getByRole('button');

/** The badge says how many copies its title lists: `+1 copy` for `also in <path>`. */
async function expectBadge(skill: Locator) {
  const badge = skill.locator('.copies');
  const title = (await badge.getAttribute('title'))!;
  expect(title).toMatch(/^also in /);
  const copies = title.slice('also in '.length).split(', ').length;
  await expect(badge).toHaveText(`+${copies} ${copies === 1 ? 'copy' : 'copies'}`);
  return title;
}

/** Shows the skill, hovers its badge, chooses it: its pane lists the same paths. */
async function choose(page: Page, skill: Locator, point: string) {
  await skill.evaluate((node) => node.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  await pause(page, 800);
  const title = await expectBadge(skill);
  await skill.locator('.copies').hover();
  await pause(page, 1000);
  await skill.click();
  await expect(page.getByRole('article').locator('#skill-copies')).toHaveText(title);
  await keyPoint(page, point);
  await pause(page, 2500);
}

test('the skill list', async ({ page }) => {
  await page.goto('/');
  await type(page.getByLabel('Repository'), 'https://github.com/JetBrains/MPS', 60);
  await page.getByRole('button', { name: 'Scan' }).click();
  await expect(page.getByRole('heading', { name: /^JetBrains\/MPS · \d+ skills$/ })).toBeVisible({ timeout: 120_000 });

  // Every skill with copies has its badge, on the line of its name; no `also in` line in the list.
  const all = await skills(page).count();
  const badged = skills(page).filter({ has: page.locator('.copies') });
  expect(await badged.count()).toBeGreaterThan(0);
  for (const skill of await badged.all()) await expectBadge(skill);
  await expect(page.getByRole('list', { name: 'Skills' }).getByText(/also in/)).toHaveCount(0);
  // A divider between two skills.
  const borders = await page
    .getByRole('list', { name: 'Skills' })
    .getByRole('listitem')
    .evaluateAll((items) => items.map((item) => item.ownerDocument.defaultView!.getComputedStyle(item).borderTopStyle));
  expect(borders).toEqual(['none', ...Array(all - 1).fill('solid')]);
  await keyPoint(page, 'the-list');
  await pause(page, 2500);

  // One copy, then two.
  const one = badged.filter({ has: page.locator('.copies', { hasText: '+1 copy' }) }).first();
  await choose(page, one, 'one-copy');
  const two = badged.filter({ has: page.locator('.copies', { hasText: '+2 copies' }) }).first();
  await choose(page, two, 'two-copies');
});
