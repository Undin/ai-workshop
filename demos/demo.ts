// What every demo shares: the recording, a visible pointer, and pauses a viewer can follow.
import { test as base, type Locator, type Page } from '@playwright/test';

export const VIDEOS = new URL('out/', import.meta.url).pathname;

/** A page recorded into demos/out/<the demo's file name>.webm, its actions shown with a pointer. */
export const test = base.extend<{ page: Page }>({
  page: async ({ page }, use, info) => {
    const name = info.file.split('/').at(-1)!.replace(/\.demo\.ts$/, '');
    await page.screencast.start({ path: `${VIDEOS}${name}.webm`, size: page.viewportSize()! });
    await page.screencast.showActions({
      cursor: 'pointer',
      duration: 800,
      position: 'top-right',
      style: {
        point: 'width: 24px; height: 24px; border-radius: 50%; background: rgba(255, 64, 64, .55)',
        highlight: 'outline: 2px solid rgba(255, 64, 64, .9); background: rgba(255, 64, 64, .08)',
        title: 'font-size: 18px',
      },
    });
    await use(page);
    await pause(page, 1500);
    await page.screencast.stop();
  },
});

export { expect } from '@playwright/test';

/** Time for a viewer to see what happened. */
export const pause = (page: Page, ms = 1200) => page.waitForTimeout(ms);

/** Clicks the field, so the pointer goes there, and types into it as a person does. */
export async function type(field: Locator, text: string) {
  await field.click();
  await field.clear();
  await field.pressSequentially(text, { delay: 150 });
}
