// No warnings on the page (spec/web.md, Page and Organization page; #41). On JetBrains/koog: the
// scan has a warning (the API still answers it, the CLI prints it), the page does not show it; the
// skills right under the repository. Then the JetBrains organization: a few of its repositories
// scanned, no warning on its page, Stop. A real repository changes: what is checked is that no
// warning is shown, not which.
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

  // An organization: a few of its repositories scanned, no warning on its page either; then Stop.
  await type(page.getByLabel('Repository'), 'https://github.com/JetBrains', 60);
  await page.getByRole('button', { name: 'Scan' }).click();
  const organization = page.getByRole('heading', { name: /^JetBrains · \d+ repositories$/ });
  await faster(page, 4, () => expect(organization).toBeVisible({ timeout: 60_000 }));
  const progress = page.locator('#progress');
  const scanned = async () => Number((await progress.textContent())?.match(/: (\d+) of/)?.[1] ?? 0);
  const list = page.getByRole('list', { name: 'Repositories' });
  const scanning = list.getByRole('listitem').filter({ has: page.locator('.count', { hasText: '…' }) }).first();
  await faster(page, 8, async () => {
    for (const deadline = Date.now() + 120_000; (await scanned()) < 8; ) {
      expect(Date.now(), '8 repositories scanned').toBeLessThan(deadline);
      await scanning.evaluate((row) => row.scrollIntoView({ block: 'center', behavior: 'smooth' })).catch(() => {});
      await pause(page, 1000);
    }
  });
  await expect(page.getByText(/^warning: /)).toHaveCount(0);
  await page.locator('body').evaluate((body) => body.ownerDocument.defaultView!.scrollTo({ top: 0, behavior: 'smooth' }));
  await pause(page, 1000);
  await progress.getByRole('button', { name: 'Stop' }).hover();
  await pause(page, 800);
  await progress.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByRole('status')).toHaveText(/^Stopped after \d+ of \d+ repositories$/);
  await expect(page.getByText(/^warning: /)).toHaveCount(0);
  await keyPoint(page, 'organization-no-warnings');
  await pause(page, 2000);
});
