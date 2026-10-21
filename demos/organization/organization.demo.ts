// An organization (spec/web.md, Organization page; #10) on JetBrains: its repositories, each with
// its skill count as it is scanned; a scanned one is a link to its page while the scan goes on;
// back to the organization, then Stop, long before the end of its scan.
// A real organization changes: what is checked is what the page does, not which repositories it has.
import { expect, faster, keyPoint, pause, test, type } from '../demo.ts';

test('an organization', async ({ page }) => {
  const list = page.getByRole('list', { name: 'Repositories' });
  const progress = page.locator('#progress');
  await page.goto('/');
  await type(page.getByLabel('Repository'), 'https://github.com/JetBrains', 60);
  await page.getByRole('button', { name: 'Scan' }).click();

  // Every repository at once, its count once it is scanned, `…` until then.
  const heading = page.getByRole('heading', { name: /^JetBrains · \d+ repositories$/ });
  // Listing the organization's repositories: nothing to see but the wait.
  await faster(page, 4, () => expect(heading).toBeVisible({ timeout: 60_000 }));
  const all = Number((await heading.textContent())!.match(/(\d+) repositories/)![1]);
  await expect(list.getByRole('listitem').locator('.count', { hasText: '…' }).first()).toBeVisible();
  await expect(progress).toHaveText(new RegExp(`^Scanning JetBrains: \\d+ of ${all} repositories…\\s*Stop$`));
  await keyPoint(page, 'scanning');

  // Following the scan down the list, to the first scanned repository with skills: a link to its page.
  const withSkills = list.getByRole('listitem').filter({ has: page.locator('.count', { hasText: /^[1-9]\d* skills?$/ }) }).first();
  const scanning = list.getByRole('listitem').filter({ has: page.locator('.count', { hasText: '…' }) }).first();
  await pause(page, 1500);
  await faster(page, 8, async () => {
    for (const deadline = Date.now() + 120_000; !(await withSkills.count()); ) {
      expect(Date.now(), 'a scanned repository with skills').toBeLessThan(deadline);
      await scanning.evaluate((row) => row.scrollIntoView({ block: 'center', behavior: 'smooth' })).catch(() => {});
      await pause(page, 1000);
    }
  });
  await withSkills.evaluate((row) => row.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  await withSkills.getByRole('link').hover();
  await keyPoint(page, 'scanned-with-skills');
  await pause(page, 2000);
  const name = (await withSkills.locator('.name').textContent())!;
  const count = (await withSkills.locator('.count').textContent())!;
  await withSkills.getByRole('link').click();

  // Its page, from the organization's scan, which goes on there.
  await expect(page.getByRole('heading', { name: `${name} · ${count}` })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Skills' }).getByRole('button')).toHaveCount(Number(count.split(' ')[0]));
  await expect(progress).toHaveText(new RegExp(`^Scanning JetBrains: \\d+ of ${all} repositories…\\s*Stop$`));
  await page.locator('body').evaluate((body) => body.ownerDocument.defaultView!.scrollTo({ top: 0, behavior: 'smooth' }));
  await pause(page, 1000);
  await keyPoint(page, 'repository-page-scan-goes-on');
  await pause(page, 2000);

  // Back to the organization's page: what the scan has by now.
  await progress.getByRole('link', { name: 'JetBrains' }).click();
  await expect(heading).toBeVisible();
  await keyPoint(page, 'back-to-organization');
  await pause(page, 2500);

  // Stop: the repositories left not scanned.
  await progress.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByRole('status')).toHaveText(new RegExp(`^Stopped after \\d+ of ${all} repositories$`));
  await expect(list.getByRole('listitem').locator('.count', { hasText: 'not scanned' }).first()).toBeVisible();
  await expect(list.getByRole('listitem').locator('.count', { hasText: '…' })).toHaveCount(0);
  await keyPoint(page, 'stopped');
});
