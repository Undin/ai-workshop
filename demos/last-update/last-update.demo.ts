// When the chosen skill was last updated (spec/web.md, Page; spec/analysis.md, Last update; #23) on
// JetBrains/MPS: `Updated <date>` in the top right corner of its SKILL.md, the time on hover; another
// skill, its own. A real repository changes: what is checked is where and how the date is shown,
// not which it is.
import { expect, faster, keyPoint, pause, test, type } from '../demo.ts';
import type { Page } from '@playwright/test';

const skills = (page: Page) => page.getByRole('list', { name: 'Skills' }).getByRole('button');
const updated = (page: Page) => page.getByRole('article').locator('#skill-updated');

/** The chosen skill's last update: a date, in the top right corner, the time on hover. */
async function lastUpdate(page: Page, name: string, point: string) {
  await expect(page.locator('#skill-name')).toHaveText(name);
  await expect(updated(page)).toHaveText(/^Updated \d{4}-\d{2}-\d{2}$/);
  const day = (await updated(page).locator('time').textContent())!;
  await expect(updated(page)).toHaveAttribute('title', new RegExp(`^${day} \\d{2}:\\d{2} UTC$`));
  const corner = (await updated(page).boundingBox())!;
  const heading = (await page.locator('#skill-name').boundingBox())!;
  expect(corner.x).toBeGreaterThan(heading.x + heading.width);
  expect(corner.y).toBeLessThan(heading.y + heading.height / 2);
  await keyPoint(page, point);
  // The time on hover; the pointer below the date, not over it.
  await updated(page).hover({ position: { x: 2, y: corner.height - 2 } });
  await pause(page, 2000);
}

test('the last update', async ({ page }) => {
  await page.goto('/');
  await type(page.getByLabel('Repository'), 'https://github.com/JetBrains/MPS', 60);
  await page.getByRole('button', { name: 'Scan' }).click();
  const heading = page.getByRole('heading', { name: /^JetBrains\/MPS · \d+ skills$/ });
  await faster(page, 4, () => expect(heading).toBeVisible({ timeout: 120_000 }));

  // The first skill, chosen at first.
  const first = (await skills(page).first().locator('.name').textContent())!;
  await lastUpdate(page, first, 'first-skill');

  // Another skill: its own date.
  const editor = skills(page).filter({ hasText: /^mps-aspect-editor/ }).first();
  const second = (await editor.locator('.name').textContent())!;
  await editor.evaluate((node) => node.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  await pause(page, 800);
  await editor.hover();
  await pause(page, 600);
  await editor.click();
  // The list scrolled the page: back to the top, where the SKILL.md starts.
  await page.locator('body').evaluate((body) => body.ownerDocument.defaultView!.scrollTo({ top: 0, behavior: 'smooth' }));
  await pause(page, 800);
  await lastUpdate(page, second, 'another-skill');
});
