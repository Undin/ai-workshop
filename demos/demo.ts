// What every demo shares: the recording, a visible pointer, pauses a viewer can follow, the
// waits where nothing happens played faster, and screenshots of its key points.
import { execFileSync } from 'node:child_process';
import { mkdirSync, renameSync, rmSync } from 'node:fs';
import { test as base, type Locator, type Page } from '@playwright/test';

export const VIDEOS = new URL('out/', import.meta.url).pathname;

/** A part of the video to play `factor` times faster: from `start` to `end`, seconds into it. */
type Faster = { start: number; end: number; factor: number };

/** For each recorded page: its demo, when its video started, its parts to play faster, its key points so far. */
const recordings = new WeakMap<Page, { name: string; started: number; faster: Faster[]; keyPoints: number }>();

/** A page recorded into demos/out/<the demo's file name>.webm, its pointer actions shown. */
export const test = base.extend<{ page: Page }>({
  page: async ({ page }, use, info) => {
    const name = info.file.split('/').at(-1)!.replace(/\.demo\.ts$/, '');
    const video = `${VIDEOS}${name}.webm`;
    // This run's key points only: none left from an earlier one.
    rmSync(keyPoints(name), { recursive: true, force: true });
    await page.screencast.start({ path: video, size: page.viewportSize()! });
    const recording = { name, started: Date.now(), faster: [], keyPoints: 0 };
    recordings.set(page, recording);
    await page.screencast.showActions({
      cursor: 'pointer',
      duration: 800,
      style: {
        point: 'width: 24px; height: 24px; border-radius: 50%; background: rgba(255, 64, 64, .55)',
        highlight: 'outline: 2px solid rgba(255, 64, 64, .9); background: rgba(255, 64, 64, .08)',
        // The pointer shows what is done; no callout naming the action.
        title: 'display: none',
      },
    });
    await use(page);
    await pause(page, 1500);
    await page.screencast.stop();
    if (recording.faster.length) playFaster(video, recording.faster);
  },
});

export { expect } from '@playwright/test';

/** Time for a viewer to see what happened. */
export const pause = (page: Page, ms = 1200) => page.waitForTimeout(ms);

/** Clicks the field, so the pointer goes there, and types into it as a person does. */
export async function type(field: Locator, text: string, delay = 120) {
  await field.click();
  await field.clear();
  await field.pressSequentially(text, { delay });
}

/** Where the screenshots of a demo's key points go: demos/<name>/. */
const keyPoints = (name: string) => new URL(`${name}/`, import.meta.url).pathname;

/** A key point of the demo: its screenshot, demos/<demo>/<nn>-<name>.png, numbered in order. */
export async function keyPoint(page: Page, name: string) {
  const recording = recordings.get(page)!;
  const directory = keyPoints(recording.name);
  mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: `${directory}${String(++recording.keyPoints).padStart(2, '0')}-${name}.png` });
}

/**
 * A wait where nothing happens but waiting, `factor` times faster in the video, `×<factor>` in its
 * bottom right corner meanwhile.
 */
export async function faster<T>(page: Page, factor: number, wait: () => Promise<T>): Promise<T> {
  const recording = recordings.get(page)!;
  const badge = await page.screencast.showOverlay(
    `<div style="position: fixed; right: 16px; bottom: 16px; padding: 6px 14px; border-radius: 8px;
      background: rgba(0, 0, 0, .7); color: white; font: bold 22px system-ui, sans-serif">⏩ ×${factor}</div>`,
  );
  const start = (Date.now() - recording.started) / 1000;
  try {
    return await wait();
  } finally {
    recording.faster.push({ start, end: (Date.now() - recording.started) / 1000, factor });
    await badge.dispose();
  }
}

/** Rewrites the video with these parts played faster (ffmpeg), the rest as it was. */
function playFaster(video: string, parts: Faster[]) {
  const pieces: string[] = [];
  let at = 0;
  for (const { start, end, factor } of [...parts].sort((a, b) => a.start - b.start)) {
    pieces.push(`trim=${at}:${start},setpts=PTS-STARTPTS`, `trim=${start}:${end},setpts=(PTS-STARTPTS)/${factor}`);
    at = end;
  }
  pieces.push(`trim=start=${at},setpts=PTS-STARTPTS`);
  const filter = [
    `[0:v]split=${pieces.length}${pieces.map((_, i) => `[in${i}]`).join('')}`,
    ...pieces.map((piece, i) => `[in${i}]${piece}[out${i}]`),
    `${pieces.map((_, i) => `[out${i}]`).join('')}concat=n=${pieces.length}:v=1:a=0[v]`,
  ].join(';');
  const output = video.replace(/\.webm$/, '.faster.webm');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', video, '-filter_complex', filter, '-map', '[v]',
    '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '32', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4', output]);
  renameSync(output, video);
}
