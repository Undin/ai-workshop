// The filter (spec/web.md, Page; #9) on JetBrains/aspire-plugin, a small repository: it keeps the
// skills whose name or first sentence contains its text, marks each match, and shows how many are
// shown of all.
// A real repository changes: what is checked is what the filter does, not which skills it has.
import { expect, keyPoint, pause, test, type } from './demo.ts';
import type { Page } from '@playwright/test';

const skills = (page: Page) => page.getByRole('list', { name: 'Skills' }).getByRole('button');

/** The filter by `text`: each skill kept contains it, each match is marked, and the count says so. */
async function filterBy(page: Page, text: string, all: number) {
  await type(page.getByLabel('Filter'), text);
  const kept = await skills(page).count();
  expect(kept).toBeGreaterThan(0);
  for (const skill of await skills(page).all()) {
    await expect(skill.locator('.name, .summary').locator('mark').first()).toHaveText(new RegExp(`^${text}$`, 'i'));
  }
  await expect(page.getByText(`Showing ${kept} of ${all} skills`)).toBeVisible();
  await keyPoint(page, `filtered-by-${text}`);
  await pause(page, 2500);
}

test('the filter', async ({ page }) => {
  await page.goto('/');
  await type(page.getByLabel('Repository'), 'https://github.com/JetBrains/aspire-plugin', 60);
  await page.getByRole('button', { name: 'Scan' }).click();
  await expect(page.getByRole('heading', { name: /^JetBrains\/aspire-plugin · \d+ skills$/ })).toBeVisible({ timeout: 120_000 });
  const all = await skills(page).count();
  await expect(page.getByText(`Showing ${all} of ${all} skills`)).toBeVisible();
  await keyPoint(page, 'all-skills');
  await pause(page);

  // A name and a first sentence, in any case: update-aspire, and `Update Aspire version …`;
  // a first sentence only: `… from the latest GitHub release`
  await filterBy(page, 'aspire', all);
  await filterBy(page, 'release', all);

  // Nothing kept.
  await type(page.getByLabel('Filter'), 'python');
  await expect(page.getByText('No skills match python')).toBeVisible();
  await keyPoint(page, 'nothing-kept');
  await pause(page, 2000);

  // Empty again: all of them.
  await page.getByLabel('Filter').click();
  await page.getByLabel('Filter').clear();
  await expect(page.getByText(`Showing ${all} of ${all} skills`)).toBeVisible();
});
