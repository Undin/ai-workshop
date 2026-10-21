// What every demo shares: its web view, GitHub answering from its recording; the video, a visible
// pointer, pauses a viewer can follow, the waits where nothing happens played faster, and
// screenshots of its key points.
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { test as base, expect, type Locator, type Page } from '@playwright/test';

export const VIDEOS = new URL('out/', import.meta.url).pathname;
const ROOT = new URL('..', import.meta.url).pathname;
/** `npm run demo:record`: GitHub's answers recorded anew, instead of replayed. */
const RECORD = process.env.DEMO_RECORD === '1';

/** A part of the video to play `factor` times faster: from `start` to `end`, seconds into it. */
type Faster = { start: number; end: number; factor: number };

/** For each recorded page: its demo, when its video started, its parts to play faster, its key points so far. */
const recordings = new WeakMap<Page, { name: string; started: number; faster: Faster[]; keyPoints: number }>();

/** A demo: demos/<name>/<name>.demo.ts. */
const demoName = (file: string) => basename(dirname(file));

export const test = base.extend<{ page: Page }>({
  /**
   * The demo's web view, demos/serve.ts, on a port of its own: its address. After the demo, in a
   * replay: nothing asked that is not recorded.
   */
  baseURL: async ({}, use, info) => {
    const server = spawn(process.execPath, ['demos/serve.ts'], {
      cwd: ROOT,
      env: { ...process.env, DEMO: `demos/${demoName(info.file)}`, PORT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const missing: string[] = [];
    server.stderr!.on('data', (data: Buffer) => {
      process.stderr.write(data);
      missing.push(...[...data.toString().matchAll(/^not recorded: (.+)$/gm)].map((match) => match[1]));
    });
    const [line] = (await Promise.race([once(server.stdout!, 'data'), once(server, 'exit').then(() => {
      throw new Error('demos/serve.ts exited');
    })])) as Buffer[];
    try {
      await use(line.toString().match(/http:\/\/\S+/)![0]);
      expect(missing, 'GitHub answers the demo asked for and its recording does not have').toEqual([]);
    } finally {
      server.kill();
    }
  },
  /**
   * A page recorded into demos/out/<name>.webm, its pointer actions shown. In a recording, after
   * the demo: each scan it started, again to its end, so that what the demo stopped is recorded
   * too, and a replay, faster, finds it.
   */
  page: async ({ page }, use, info) => {
    const name = demoName(info.file);
    const video = `${VIDEOS}${name}.webm`;
    // Each scan the page started.
    const scans: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/scan') scans.push(request.url());
    });
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
    if (RECORD) for (const scan of scans) await (await fetch(scan)).text();
  },
});

export { expect };

/** Time for a viewer to see what happened. */
export const pause = (page: Page, ms = 1200) => page.waitForTimeout(ms);

/** Clicks the field, so the pointer goes there, and types into it as a person does. */
export async function type(field: Locator, text: string, delay = 120) {
  await field.click();
  await field.clear();
  await field.pressSequentially(text, { delay });
}

/**
 * Where the screenshots of a demo's key points go: demos/out/<name>/, next to its video; the ones
 * committed, demos/<name>/screenshots/, come from the Demos workflow (demos/screenshots.ts).
 */
const keyPoints = (name: string) => `${VIDEOS}${name}/`;

/** A key point of the demo: its screenshot, demos/out/<demo>/<nn>-<name>.png, numbered in order. */
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
