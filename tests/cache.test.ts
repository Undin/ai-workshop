// The cache in spec/cli.md: GitHub's answers kept on disk, how long, which ones, for which token;
// the real CLI and web view for where it is and --no-cache, in-process with a clock of its own for
// the rest.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { cached } from '../src/cache.ts';
import { run } from '../src/commands.ts';
import type { Fetch } from '../src/core/github.ts';
import { replay } from '../src/core/replay.ts';
import { openSource } from '../src/open.ts';
import { CLI, EXAMPLE, EXAMPLE_COMMIT, github, PRELOAD, serveCli } from './helpers.ts';

const CACHE = '.skill-atlas-cache';
const EXAMPLE_URL = 'https://github.com/JetBrains/example';
/** What a scan of JetBrains/example with a token asks GitHub: the repository, its commit, code search, the SKILL.md. */
const EXAMPLE_ASKED = [
  'https://api.github.com/repos/JetBrains/example',
  'https://api.github.com/repos/JetBrains/example/commits/main',
  'https://api.github.com/search/code?q=filename:SKILL.md+repo:JetBrains/example&per_page=100&page=1',
  `https://raw.githubusercontent.com/JetBrains/example/${EXAMPLE_COMMIT}/.claude/skills/commits/SKILL.md`,
];

const MINUTE = 60 * 1000;
const START = Date.UTC(2026, 9, 21);

function temporary(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'skill-atlas-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * `skill-atlas <args>` as the CLI runs it, its cache in `directory`, at the time `at`, with GitHub
 * answering from `fetch`: what it printed, and what it asked GitHub, in order.
 */
async function atlasCached(args: string[], directory: string, { at = START, token = 'test' as string | undefined, fetch = github } = {}) {
  const asked: string[] = [];
  const counted: Fetch = (url, init) => (asked.push(url), fetch(url, init));
  const fromCache = cached(counted, { directory, token, now: () => at });
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await run(args, {
    open: (input, { cache }) => openSource(input, { fetch: cache ? fromCache : counted, token }),
    print: (text) => stdout.push(text),
    error: (text) => stderr.push(text),
    cacheDirectory: directory,
  });
  return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n'), asked };
}

/** The real CLI in `cwd`, with GitHub answering from EXAMPLE and each request counted in `seen`. */
function cli(cwd: string, args: string[], seen: string) {
  const env = { ...process.env, GITHUB_TOKEN: 'secret', SKILL_ATLAS_SEEN: seen };
  return spawnSync(process.execPath, ['--import', PRELOAD, CLI, ...args], { cwd, env, encoding: 'utf8' });
}

/** How many requests GitHub got, as tests/github-preload.ts counts them. */
function requests(seen: string): number {
  return existsSync(seen) ? readFileSync(seen, 'utf8').trim().split('\n').length : 0;
}

/** Each cache file's name and content. */
function files(directory: string): Record<string, string> {
  return Object.fromEntries(readdirSync(directory).sort().map((name) => [name, readFileSync(join(directory, name), 'utf8')]));
}

test('a GitHub scan keeps its answers in .skill-atlas-cache/ in the current directory; again, the same output, GitHub not asked', (t) => {
  const cwd = temporary(t);
  const first = cli(cwd, ['scan', EXAMPLE_URL], join(cwd, 'first.seen'));
  assert.equal(first.status, 0, first.stderr);
  assert.equal(requests(join(cwd, 'first.seen')), EXAMPLE_ASKED.length);
  assert.deepEqual(readdirSync(cwd).sort(), [CACHE, 'first.seen']);
  assert.equal(readdirSync(join(cwd, CACHE)).length, EXAMPLE_ASKED.length);

  const again = cli(cwd, ['scan', EXAMPLE_URL], join(cwd, 'again.seen'));
  assert.equal(again.status, 0, again.stderr);
  assert.equal(again.stdout, first.stdout);
  assert.equal(again.stderr, first.stderr);
  assert.equal(requests(join(cwd, 'again.seen')), 0);
});

test('an organization: again, only what was an error is asked', async (t) => {
  const directory = temporary(t);
  const first = await atlasCached(['scan', 'https://github.com/JetBrains'], directory);
  assert.equal(first.code, 0, first.stderr);
  const again = await atlasCached(['scan', 'https://github.com/JetBrains'], directory, { at: START + 59 * MINUTE });
  assert.deepEqual(again, { ...first, asked: ['https://api.github.com/repos/JetBrains/new/commits/main'] });
});

test('after 1 hour, the repository, its commit and code search are asked again, the file at the commit not; after 30 days, all', async (t) => {
  const directory = temporary(t);
  const first = await atlasCached(['scan', EXAMPLE_URL], directory);
  assert.deepEqual(first.asked, EXAMPLE_ASKED);

  assert.deepEqual((await atlasCached(['scan', EXAMPLE_URL], directory, { at: START + 59 * MINUTE })).asked, []);
  const hour = await atlasCached(['scan', EXAMPLE_URL], directory, { at: START + 61 * MINUTE });
  assert.equal(hour.stdout, first.stdout);
  assert.deepEqual(hour.asked, EXAMPLE_ASKED.slice(0, 3));
  // Asked again, kept again: an hour from then.
  assert.deepEqual((await atlasCached(['scan', EXAMPLE_URL], directory, { at: START + 120 * MINUTE })).asked, []);

  const month = await atlasCached(['scan', EXAMPLE_URL], directory, { at: START + 30 * 24 * 60 * MINUTE + MINUTE });
  assert.equal(month.stdout, first.stdout);
  assert.deepEqual(month.asked, EXAMPLE_ASKED);
});

test('pinned to a commit: the trees and the files kept 30 days, a commit by its sha too; an owner and its repositories 1 hour', async (t) => {
  const directory = temporary(t);
  const organization = 'https://github.com/JetBrains';
  await atlasCached(['scan', organization], directory);
  const hour = await atlasCached(['scan', organization], directory, { at: START + 61 * MINUTE });
  assert.deepEqual(hour.asked, [
    'https://api.github.com/users/JetBrains',
    'https://api.github.com/users/JetBrains/repos?per_page=100&page=1',
    ...['example', 'malformed', 'new', 'none'].map((name) => `https://api.github.com/repos/JetBrains/${name}/commits/main`),
  ]);

  // `/tree/<sha>`: the commit is asked by its sha.
  const pinned = replay({ ...EXAMPLE, [`https://api.github.com/repos/JetBrains/example/commits/${EXAMPLE_COMMIT}`]: { status: 200, body: { sha: EXAMPLE_COMMIT } } });
  const url = `${EXAMPLE_URL}/tree/${EXAMPLE_COMMIT}`;
  const first = await atlasCached(['scan', url], directory, { fetch: pinned });
  assert.equal(first.code, 0, first.stderr);
  const later = await atlasCached(['scan', url], directory, { fetch: pinned, at: START + 61 * MINUTE });
  assert.equal(later.stdout, first.stdout);
  assert.deepEqual(later.asked, ['https://api.github.com/repos/JetBrains/example']);
});

test('an error answer is never kept: a rate limit, a 404 are asked again', async (t) => {
  const directory = temporary(t);
  const limited = await atlasCached(['scan', 'https://github.com/Limited'], directory);
  assert.equal(limited.code, 1);
  assert.match(limited.stderr, /GitHub rate limit reached/);
  const again = await atlasCached(['scan', 'https://github.com/Limited'], directory);
  assert.deepEqual(again, { ...limited, asked: ['https://api.github.com/repos/Limited/second/commits/main'] });

  const missing = await atlasCached(['scan', 'https://github.com/no-such-owner'], directory);
  assert.equal(missing.code, 1);
  assert.deepEqual(await atlasCached(['scan', 'https://github.com/no-such-owner'], directory), missing);
});

test('per token: another token, or none, asks again; no file holds the token', async (t) => {
  const directory = temporary(t);
  const first = await atlasCached(['scan', EXAMPLE_URL], directory, { token: 'token-a' });
  assert.deepEqual((await atlasCached(['scan', EXAMPLE_URL], directory, { token: 'token-a' })).asked, []);
  const other = await atlasCached(['scan', EXAMPLE_URL], directory, { token: 'token-b' });
  assert.equal(other.stdout, first.stdout);
  assert.deepEqual(other.asked, EXAMPLE_ASKED);
  // Without a token, through the tree; the repository asked again all the same.
  const none = await atlasCached(['scan', EXAMPLE_URL], directory, { token: undefined });
  assert.equal(none.stdout, first.stdout);
  assert.equal(none.asked[0], 'https://api.github.com/repos/JetBrains/example');

  for (const [name, content] of Object.entries(files(directory))) {
    assert.match(name, /^[0-9a-f]{64}\.json$/);
    assert.doesNotMatch(content, /token-[ab]/, name);
  }
});

test('--no-cache, before or after the link: the cache is not read, nothing is written', (t) => {
  const cwd = temporary(t);
  assert.equal(cli(cwd, ['scan', EXAMPLE_URL], join(cwd, 'first.seen')).status, 0);
  const kept = files(join(cwd, CACHE));
  for (const args of [['scan', '--no-cache', EXAMPLE_URL], ['scan', EXAMPLE_URL, '--no-cache']]) {
    const seen = join(cwd, `${args.indexOf('--no-cache')}.seen`);
    const scanned = cli(cwd, args, seen);
    assert.equal(scanned.status, 0, scanned.stderr);
    assert.equal(requests(seen), EXAMPLE_ASKED.length, args.join(' '));
    assert.deepEqual(files(join(cwd, CACHE)), kept);
  }

  const fresh = temporary(t);
  assert.equal(cli(fresh, ['scan', '--no-cache', EXAMPLE_URL], join(cwd, 'fresh.seen')).status, 0);
  assert.deepEqual(readdirSync(fresh), []);
});

test('--no-cache once: twice, with a link or without, or with no link, is the usage', async (t) => {
  const directory = temporary(t);
  for (const args of [['scan', '--no-cache', '--no-cache', EXAMPLE_URL], ['scan', EXAMPLE_URL, '--no-cache', '--no-cache'], ['scan', '--no-cache', '--no-cache'], ['scan', '--no-cache']]) {
    assert.deepEqual(await atlasCached(args, directory), {
      code: 1, stdout: '', stderr: 'Usage: skill-atlas scan [--no-cache] <GitHub URL | directory>', asked: [],
    }, args.join(' '));
  }
});

test('serve answers from the same cache as scan, in the directory it was started in; serve --no-cache neither reads nor writes it', async (t) => {
  const cwd = temporary(t);
  const scanned = cli(cwd, ['scan', EXAMPLE_URL], join(cwd, 'scan.seen'));
  assert.equal(scanned.status, 0, scanned.stderr);
  const env = (name: string) => ({ ...process.env, GITHUB_TOKEN: 'secret', SKILL_ATLAS_SEEN: join(cwd, name) });
  const api = `/api/scan?source=${encodeURIComponent(EXAMPLE_URL)}`;

  const served = await serveCli(t, ['--import', PRELOAD, CLI, 'serve', '--port', '0'], { cwd, env: env('serve.seen') });
  const answer = await fetch(new URL(api, served));
  assert.equal(answer.status, 200);
  assert.equal(((await answer.json()) as { skills: unknown[] }).skills.length, 1);
  assert.equal(requests(join(cwd, 'serve.seen')), 0);

  const fresh = temporary(t);
  const uncached = await serveCli(t, ['--import', PRELOAD, CLI, 'serve', '--no-cache', '--port', '0'], { cwd: fresh, env: env('uncached.seen') });
  assert.equal((await fetch(new URL(api, uncached))).status, 200);
  assert.equal(requests(join(cwd, 'uncached.seen')), EXAMPLE_ASKED.length);
  assert.deepEqual(readdirSync(fresh), []);
});

test('a cache file that cannot be read, or a cache that cannot be written: GitHub is asked, the same output, no warning', async (t) => {
  const directory = temporary(t);
  const first = await atlasCached(['scan', EXAMPLE_URL], directory);
  for (const name of readdirSync(directory)) writeFileSync(join(directory, name), 'not JSON');
  assert.deepEqual(await atlasCached(['scan', EXAMPLE_URL], directory), first);
  // Kept again.
  assert.deepEqual((await atlasCached(['scan', EXAMPLE_URL], directory)).asked, []);

  // The cache's place is a file: nothing can be written there.
  const file = join(temporary(t), 'a file');
  writeFileSync(file, '');
  assert.deepEqual(await atlasCached(['scan', EXAMPLE_URL], file), first);
  assert.deepEqual(await atlasCached(['scan', EXAMPLE_URL], file), first);
  assert.equal(readFileSync(file, 'utf8'), '');
});
