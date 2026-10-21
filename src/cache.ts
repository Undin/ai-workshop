// GitHub's answers, kept on disk for the Node clients: a scan asks GitHub only for what is not
// there or expired. One JSON file per answer; the browser terminal has no disk, no cache.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Fetch } from './core/github.ts';

/** Where the CLI and the web view keep it, in the current directory. */
export const CACHE_DIRECTORY = '.skill-atlas-cache';

const MINUTE = 60 * 1000;
/**
 * A tree, a blob, a file at a commit, a commit by its sha, the last change of a directory up to a
 * commit: what it answers never changes.
 */
export const PINNED_MS = 30 * 24 * 60 * MINUTE;
/** A repository, a branch or tag → its commit, an owner's repositories, code search. */
export const MOVING_MS = 60 * MINUTE;

export type CacheOptions = {
  directory: string;
  /** The token the requests carry: each token has its answers, and none has another's. */
  token?: string;
  /** The clock, in milliseconds; tests pass their own. */
  now?: () => number;
};

/** One kept answer: the token is not in it, only in its file name's hash. */
type Kept = { url: string; expires: number; status: number; body: string };

const PINNED = [
  /^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/(?:git\/trees|git\/blobs|commits)\/[0-9a-f]{40}(?:\?|$)/i,
  /^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/commits\?sha=[0-9a-f]{40}(?:&|$)/i,
  /^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[0-9a-f]{40}\//i,
];

/** How long an answer for the URL is kept. */
export function keptFor(url: string): number {
  return PINNED.some((pinned) => pinned.test(url)) ? PINNED_MS : MOVING_MS;
}

/**
 * A fetch that answers from the directory while an answer is fresh, and keeps each successful one
 * it gets; errors are never kept. A file that cannot be read or written is as if there were none.
 */
export function cached(fetch: Fetch, { directory, token, now = Date.now }: CacheOptions): Fetch {
  return async (url, init) => {
    const file = join(directory, `${createHash('sha256').update(`${token ?? ''}\n${url}`).digest('hex')}.json`);
    const kept = await read(file);
    if (kept && kept.url === url && kept.expires > now()) {
      return new Response(Buffer.from(kept.body, 'base64'), { status: kept.status });
    }
    const response = await fetch(url, init);
    if (response.status !== 200) return response;
    const body = Buffer.from(await response.arrayBuffer());
    await write(file, { url, expires: now() + keptFor(url), status: response.status, body: body.toString('base64') });
    return new Response(body, { status: response.status });
  };
}

async function read(file: string): Promise<Kept | undefined> {
  try {
    const kept = JSON.parse(await readFile(file, 'utf8')) as Kept;
    return typeof kept.body === 'string' && typeof kept.expires === 'number' ? kept : undefined;
  } catch {
    return undefined;
  }
}

/** Through a file of its own, renamed: a scan reading it at the same time never sees half of it. */
async function write(file: string, kept: Kept): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(temporary, JSON.stringify(kept));
    await rename(temporary, file);
  } catch {
    // Not kept: the scan goes on with the answer it has.
  }
}
