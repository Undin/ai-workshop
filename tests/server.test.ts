// The decisions in spec/web.md that the server makes: the page, and the scan as JSON, the same as
// what the CLI prints. What the page does with it is in e2e/web.spec.ts.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { request } from 'node:http';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { parseSkill } from '../src/core/parse.ts';
import { listen } from '../src/server.ts';
import { atlas, atlasServer, CLI, EXAMPLE_COMMIT, FIXTURE } from './helpers.ts';

const server = atlasServer();
const base = await listen(server, 0);
after(() => server.close());

type Scanned = {
  repository: { id: string };
  skills: {
    name: string;
    path: string;
    link: string;
    summary: string;
    copies: string[];
    text: string;
    properties: Record<string, unknown>;
    body: string;
  }[];
  warnings: string[];
};

async function get(path: string, init?: RequestInit): Promise<{ response: Response; body: any }> {
  const response = await fetch(new URL(path, base), init);
  // A HEAD answer has no body.
  const json = response.headers.get('content-type')?.startsWith('application/json') && init?.method !== 'HEAD';
  return { response, body: json ? await response.json() : await response.text() };
}

const scanOf = (source: string) => get(`/api/scan?source=${encodeURIComponent(source)}`);

test('GET / → the page, scripts only from the server', async () => {
  const { response, body } = await get('/');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type')!, /^text\/html/);
  assert.match(response.headers.get('content-security-policy')!, /default-src 'self'; img-src 'self' data:;/);
  assert.match(body, /<title>Skill Atlas<\/title>/);
  for (const path of ['/app.js', '/style.css', '/vendor/marked.js', '/vendor/purify.js']) {
    assert.equal((await get(path)).response.status, 200, path);
  }
});

test('the scan as JSON: the same skills, links, copies and warnings as the CLI', async () => {
  const cli = await atlas(['scan', FIXTURE]);
  const { response, body } = await scanOf(FIXTURE);
  assert.equal(response.status, 200);
  const scanned = body as Scanned;
  const [title, ...lines] = cli.stdout.split('\n');
  assert.equal(`${scanned.repository.id} · ${scanned.skills.length} skills`, title);
  const printed = scanned.skills.flatMap((skill) => [
    skill.summary ? `${skill.name} — ${skill.summary}` : skill.name,
    `  ${skill.link}`,
    ...(skill.copies.length ? [`  also in ${skill.copies.join(', ')}`] : []),
  ]);
  assert.deepEqual(printed, lines);
  assert.deepEqual(scanned.warnings.map((warning) => `warning: ${warning}`), cli.stderr.split('\n'));
});

test('each skill comes with its SKILL.md text, and its parts', async () => {
  const scanned = (await scanOf(FIXTURE)).body as Scanned;
  for (const skill of scanned.skills) {
    const text = readFileSync(join(FIXTURE, skill.path), 'utf8');
    const { properties, body } = parseSkill(text);
    assert.equal(skill.text, text, skill.path);
    assert.deepEqual([skill.properties, skill.body], [properties, body], skill.path);
  }
});

test('on GitHub: the link pins the scanned commit', async () => {
  const scanned = (await scanOf('https://github.com/JetBrains/example')).body as Scanned;
  assert.equal(scanned.repository.id, 'JetBrains/example');
  assert.deepEqual(
    scanned.skills.map((skill) => [skill.name, skill.summary, skill.link]),
    [['commits', 'Write commit messages the way this repository does.', `https://github.com/JetBrains/example/blob/${EXAMPLE_COMMIT}/.claude/skills/commits/SKILL.md`]],
  );
});

test('an empty field → 400 and a hint; an unreachable repository, not a GitHub URL → 400 and the CLI message', async () => {
  for (const source of ['', '   ']) {
    const { response, body } = await scanOf(source);
    assert.equal(response.status, 400);
    assert.deepEqual(body, { error: 'Enter a GitHub repository URL or a directory' });
  }
  const missing = await scanOf(join(FIXTURE, 'no-such-directory'));
  assert.equal(missing.response.status, 400);
  assert.match((missing.body as { error: string }).error, /^Not a GitHub URL or a readable directory: .*no-such-directory$/);
  const offline = await scanOf('https://github.com/JetBrains/not-answered');
  assert.equal(offline.response.status, 400);
  assert.match((offline.body as { error: string }).error, /^Cannot reach GitHub: /);
  // Not a GitHub URL: what the CLI says for it.
  const gitlab = 'https://gitlab.com/JetBrains/kotlin';
  const cli = await atlas(['scan', gitlab]);
  assert.equal(cli.code, 1);
  assert.deepEqual((await scanOf(gitlab)).body, { error: cli.stderr });
});

test('anything else → 404; not GET → 405; the scan, not HEAD either', async () => {
  assert.equal((await get('/no-such-page')).response.status, 404);
  assert.equal((await get('/../package.json')).response.status, 404);
  assert.equal((await get('/api/scan', { method: 'POST' })).response.status, 405);
  assert.equal((await get('/', { method: 'HEAD' })).response.status, 200);
  assert.equal((await get(`/api/scan?source=${encodeURIComponent(FIXTURE)}`, { method: 'HEAD' })).response.status, 405);
});

/** A request with this Host header; fetch() always sends the real one. */
function withHost(host: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const sent = request(new URL(`/api/scan?source=${encodeURIComponent(FIXTURE)}`, base), { headers: { host } }, (response) => {
      let body = '';
      response.setEncoding('utf8').on('data', (chunk: string) => (body += chunk));
      response.on('end', () => resolve({ status: response.statusCode!, body }));
    });
    sent.on('error', reject).end();
  });
}

test('only for localhost and 127.0.0.1: another name → 403 (DNS rebinding)', async () => {
  const port = base.port;
  for (const host of [`localhost:${port}`, `127.0.0.1:${port}`]) assert.equal((await withHost(host)).status, 200, host);
  for (const host of [`attacker.example:${port}`, 'localhost', `localhost:${Number(port) + 1}`, `localhost.attacker.example:${port}`]) {
    const answer = await withHost(host);
    assert.equal(answer.status, 403, host);
    assert.deepEqual(JSON.parse(answer.body), { error: `Not served to ${host}: open http://127.0.0.1:${port}/` });
  }
});

test('skill-atlas serve: prints its address, serves the page, stores nothing', async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'skill-atlas-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const served = spawn(process.execPath, [CLI, 'serve', '--port', '0'], { cwd, stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(() => served.kill());
  const [line] = (await once(served.stdout, 'data')) as [Buffer];
  const address = /^Skill Atlas: (http:\/\/127\.0\.0\.1:\d+\/)\n$/.exec(line.toString())?.[1];
  assert.ok(address, line.toString());
  const scanned = await (await fetch(`${address}api/scan?source=${encodeURIComponent(FIXTURE)}`)).json();
  assert.equal((scanned as Scanned).repository.id, 'fixture');
  assert.deepEqual(readdirSync(cwd), []);
});

test('skill-atlas serve: a bad port → a clear message, exit code 1', () => {
  const bad = spawnSync(process.execPath, [CLI, 'serve', '--port', 'many'], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.equal(bad.stderr, 'Not a port: many\nUsage: skill-atlas serve [--port <port>]\n');
});
