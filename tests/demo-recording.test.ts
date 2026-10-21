// The recordings of the demos (demos/recording.ts): GitHub's answers kept with a demo, then
// replayed with no network and no token, whenever they were kept; an organization cut to a few
// repositories.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import type { Fetch } from '../src/core/github.ts';
import { recording, replayed } from '../demos/recording.ts';

const REPOSITORIES = 'https://api.github.com/users/JetBrains/repos?per_page=100&page=1';
const TREE = 'https://api.github.com/repos/JetBrains/example/git/trees/main?recursive=1';

function temporary(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'skill-atlas-demo-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** GitHub: each URL its own answer, the URL itself, or `answers[url]`; what was asked, in order. */
function github(answers: Record<string, unknown> = {}): Fetch & { asked: string[] } {
  const asked: string[] = [];
  const fetch = async (url: string) => {
    asked.push(url);
    if (url.includes('/missing')) return new Response('{"message":"Not Found"}', { status: 404 });
    return new Response(JSON.stringify(answers[url] ?? url), { status: 200 });
  };
  return Object.assign(fetch, { asked });
}

/** The answers kept in the directory: its files, none if there is no directory. */
const kept = (directory: string) => (existsSync(directory) ? readdirSync(directory) : []);

const text = async (response: Response) => JSON.parse(await response.text());

test('a recording keeps each answer GitHub gives in the directory, emptied first', async (t) => {
  const directory = join(temporary(t), 'cache');
  const fetch = recording(directory, github(), {});
  assert.equal(await text(await fetch(TREE)), TREE);
  assert.equal(kept(directory).length, 1);

  // Recorded anew: nothing left from the earlier one.
  const again = github();
  const anew = recording(directory, again, {});
  assert.equal(kept(directory).length, 0);
  await anew(REPOSITORIES);
  assert.deepEqual(again.asked, [REPOSITORIES]);
  assert.equal(kept(directory).length, 1);
});

test('a replay answers what was recorded, with no network, whatever token it was recorded with', async (t) => {
  const directory = temporary(t);
  // Recorded with a token in the requests; the recording has no token.
  const fetch = recording(directory, github(), {});
  await fetch(TREE, { headers: { Authorization: 'Bearer secret' } });
  assert.doesNotMatch(readFileSync(join(directory, readdirSync(directory)[0]), 'utf8'), /secret/);

  const missing: string[] = [];
  const replay = replayed(directory, {}, (url) => missing.push(url));
  const response = await replay(TREE, { headers: { Authorization: 'Bearer another' } });
  assert.equal(response.status, 200);
  assert.equal(await text(response), TREE);
  assert.deepEqual(missing, []);
});

test('a replay answers what was recorded long ago: a recording never expires', async (t) => {
  const directory = temporary(t);
  await recording(directory, github(), {})(TREE);
  // As if kept a year ago, its expiry long past.
  const [file] = readdirSync(directory);
  const kept = JSON.parse(readFileSync(join(directory, file), 'utf8'));
  writeFileSync(join(directory, file), JSON.stringify({ ...kept, expires: Date.UTC(2025, 9, 21) }));

  const missing: string[] = [];
  assert.equal(await text(await replayed(directory, {}, (url) => missing.push(url))(TREE)), TREE);
  assert.deepEqual(missing, []);
});

test('a replay fails a request that was not recorded, and reports it', async (t) => {
  const directory = temporary(t);
  await recording(directory, github(), {})(TREE);
  const missing: string[] = [];
  const replay = replayed(directory, {}, (url) => missing.push(url));
  await assert.rejects(replay(REPOSITORIES), { message: `not recorded: ${REPOSITORIES}` });
  assert.deepEqual(missing, [REPOSITORIES]);
});

test('an error from GitHub is not recorded: its replay fails', async (t) => {
  const directory = temporary(t);
  const url = 'https://api.github.com/repos/JetBrains/missing';
  assert.equal((await recording(directory, github(), {})(url)).status, 404);
  assert.deepEqual(kept(directory), []);
  const missing: string[] = [];
  await assert.rejects(replayed(directory, {}, (url) => missing.push(url))(url));
  assert.deepEqual(missing, [url]);
});

test("a recording cuts an organization's repositories to the ones named, in GitHub's order", async (t) => {
  const directory = temporary(t);
  const all = ['.github', 'actions', 'aspire-plugin', 'attachme', 'bazel'].map((name) => ({ name, full_name: `JetBrains/${name}` }));
  const fetch = recording(directory, github({ [REPOSITORIES]: all }), { repositories: ['bazel', 'actions', 'aspire-plugin'] });
  const cut = ['actions', 'aspire-plugin', 'bazel'].map((name) => ({ name, full_name: `JetBrains/${name}` }));
  assert.deepEqual(await text(await fetch(REPOSITORIES)), cut);
  // The rest of GitHub as it is.
  assert.equal(await text(await fetch(TREE)), TREE);
  // And replayed cut.
  assert.deepEqual(await text(await replayed(directory, {}, () => {})(REPOSITORIES)), cut);
});

test('a replay with a latency answers that late', async (t) => {
  const directory = temporary(t);
  await recording(directory, github(), {})(TREE);
  const replay = replayed(directory, { latency: 200 }, () => {});
  const start = performance.now();
  await replay(TREE);
  assert.ok(performance.now() - start >= 190, 'answered 200 ms late');
});
