// No warnings on the page (spec/web.md, Page; #41) on JetBrains/koog: the scan has a warning (the
// API still answers it, the CLI prints it), the page does not show it; the skills right under the
// repository. A real repository changes: what is checked is that its warnings are not shown, not which.
import { expect, faster, keyPoint, pause, test, type } from './demo.ts';

const SOURCE = 'https://github.com/JetBrains/koog';

test('no warnings', async ({ page }) => {
  // The scan has warnings: the API answers them.
  const answer = await (await page.request.get(`/api/scan?source=${encodeURIComponent(SOURCE)}`, { timeout: 120_000 })).json();
  expect(answer.warnings.length).toBeGreaterThan(0);

  await page.goto('/');
  await type(page.getByLabel('Repository'), SOURCE, 60);
  await page.getByRole('button', { name: 'Scan' }).click();
  const heading = page.getByRole('heading', { name: /^JetBrains\/koog · \d+ skills$/ });
  await faster(page, 4, () => expect(heading).toBeVisible({ timeout: 120_000 }));

  // None of them on the page; the skills right under the repository.
  for (const warning of answer.warnings) await expect(page.getByText(warning)).toHaveCount(0);
  await expect(page.getByText(/^warning: /)).toHaveCount(0);
  const skills = page.getByRole('list', { name: 'Skills' }).getByRole('button');
  await expect(skills.first()).toBeVisible();
  const under = (await heading.boundingBox())!;
  const first = (await skills.first().boundingBox())!;
  expect(first.y - (under.y + under.height)).toBeLessThan(160);
  await skills.first().hover();
  await pause(page, 1500);
  await keyPoint(page, 'skills-no-warnings');
  await pause(page, 1500);
});
