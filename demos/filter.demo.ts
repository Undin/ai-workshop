// The filter (spec/web.md, Page; #9): it keeps the skills whose name or first sentence contains
// its text, marks each match, and shows how many are shown of all.
import { expect, pause, test, type } from './demo.ts';

test('the filter', async ({ page }) => {
  const skills = page.getByRole('list', { name: 'Skills' }).getByRole('button');
  const filter = page.getByLabel('Filter');
  await page.goto('/');
  await page.screencast.showChapter('Filter the found skills', {
    description: 'By name or first sentence, with the count of the shown ones',
  });

  await type(page.getByLabel('Repository'), './fixture');
  await page.getByRole('button', { name: 'Scan' }).click();
  await expect(page.getByText('Showing 10 of 10 skills')).toBeVisible();
  await pause(page);

  // By name: both `deploy` skills, each match marked.
  await type(filter, 'deploy');
  await expect(skills.locator('.name mark')).toHaveText(['deploy', 'deploy']);
  await expect(page.getByText('Showing 2 of 10 skills')).toBeVisible();
  await pause(page, 2000);

  // A name and a first sentence: release-checklist, and changelog's `… for a release.`
  await type(filter, 'release');
  await expect(skills.locator('.name')).toHaveText(['changelog', 'release-checklist']);
  await expect(page.getByText('Showing 2 of 10 skills')).toBeVisible();
  await pause(page, 2000);

  // Nothing kept.
  await type(filter, 'kotlin');
  await expect(page.getByText('No skills match kotlin')).toBeVisible();
  await pause(page, 2000);

  // Empty again: all of them.
  await filter.clear();
  await expect(page.getByText('Showing 10 of 10 skills')).toBeVisible();
});
