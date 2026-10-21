// GitHub's answers for a demo, kept with it in demos/<name>/cache/: recorded once from GitHub, then
// replayed, so a demo shows the same every time, with no network and no token. The same files as
// the cache of the CLI and the web view (src/cache.ts), for no token, and never expired.
import { rmSync } from 'node:fs';
import { cached } from '../src/cache.ts';
import type { Fetch } from '../src/core/github.ts';

/** How a demo is recorded and replayed: demos/<name>/recording.json, all optional. */
export type RecordingOptions = {
  /**
   * An organization's repositories, only these, by name, in GitHub's order: what GitHub answers is
   * cut to them, so a demo scans a few small ones, not all; each one on its first page of 100.
   */
  repositories?: string[];
  /** Each replayed answer this late, in milliseconds: a scan that takes time, as GitHub's does. */
  latency?: number;
};

/** The time a kept answer is looked at: before it expires, whenever it was kept. */
const NEVER = () => 0;

const REPOSITORIES = /^https:\/\/api\.github\.com\/users\/[^/]+\/repos\?/;

/** The demo's answers from `directory`; a request not among them goes to `missing`, and fails. */
export function replayed(directory: string, { latency = 0 }: RecordingOptions, missing: (url: string) => void): Fetch {
  const answers = cached(
    async (url) => {
      missing(url);
      throw new Error(`not recorded: ${url}`);
    },
    { directory, now: NEVER },
  );
  return async (url, init) => {
    if (latency) await new Promise((resolve) => setTimeout(resolve, latency));
    return answers(url, init);
  };
}

/**
 * GitHub's answers through `fetch`, each one kept in `directory`, emptied first: a recording of
 * this run only. An organization's repositories cut to `repositories`.
 */
export function recording(directory: string, fetch: Fetch, { repositories }: RecordingOptions): Fetch {
  rmSync(directory, { recursive: true, force: true });
  const cut: Fetch = async (url, init) => {
    const response = await fetch(url, init);
    if (repositories === undefined || response.status !== 200 || !REPOSITORIES.test(url)) return response;
    const all = (await response.json()) as { name: string }[];
    return new Response(JSON.stringify(all.filter(({ name }) => repositories.includes(name))), { status: response.status });
  };
  return cached(cut, { directory, now: NEVER });
}
