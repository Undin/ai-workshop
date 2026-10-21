// The decisions in spec/web.md that the server makes: the page, and the scan as JSON, the same as
// what the CLI prints. What the page does with it is in tests/web/web.spec.ts.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { request } from 'node:http';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test, type TestContext } from 'node:test';
import { parseSkill } from '../src/core/parse.ts';
import { createBrowserBackend } from '../src/browser.ts';
import { run } from '../src/commands.ts';
import type { Fetch } from '../src/core/github.ts';
import { createAtlasServer, isServedHost, listen, type ErrorAnswer, type OrganizationLine, type ScanAnswer } from '../src/server.ts';
import { atlas, atlasServer, CLI, EXAMPLE_COMMIT, EXAMPLE_UPDATED, FIXTURE, github, openWith, PRELOAD, serveCli } from './helpers.ts';

/**
 * `skill-atlas serve <args>` in-process, with a fake server and a cache as the CLI has: the exit
 * code, the ports served, whether each serves from the cache, stderr.
 */
async function serveWith(args: string[]) {
  const ports: number[] = [];
  const cached: boolean[] = [];
  const stderr: string[] = [];
  const code = await run(['serve', ...args], {
    open: () => Promise.reject(new Error('not opened')),
    print: () => {},
    error: (text) => stderr.push(text),
    serve: async (port, { cache }) => (ports.push(port), cached.push(cache), new URL('http://127.0.0.1/')),
    cacheDirectory: '.skill-atlas-cache',
  });
  return { code, ports, cached, stderr: stderr.join('\n') };
}

const SERVE_USAGE = 'Usage: skill-atlas serve [--port <port>] [--no-cache]';

const server = atlasServer();
const base = await listen(server, 0);
after(() => server.close());

async function get(path: string, init?: RequestInit): Promise<{ response: Response; body: unknown }> {
  const response = await fetch(new URL(path, base), init);
  // A HEAD answer has no body.
  const json = response.headers.get('content-type')?.startsWith('application/json') && init?.method !== 'HEAD';
  return { response, body: json ? await response.json() : await response.text() };
}

const scanOf = (source: string) => get(`/api/scan?source=${encodeURIComponent(source)}`);
const scanned = async (source: string) => (await scanOf(source)).body as ScanAnswer;

test('GET / → the page, scripts only from the server', async () => {
  const { response, body } = await get('/');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type')!, /^text\/html/);
  assert.match(response.headers.get('content-security-policy')!, /default-src 'self'; img-src 'self' data:;/);
  assert.match(String(body), /<title>Skill Atlas<\/title>/);
  for (const path of ['/app.js', '/style.css', '/vendor/marked.js', '/vendor/purify.js']) {
    assert.equal((await get(path)).response.status, 200, path);
  }
});

test('the scan as JSON: the same skills, links, copies and warnings as the CLI', async () => {
  const cli = await atlas(['scan', FIXTURE]);
  const { response, body } = await scanOf(FIXTURE);
  assert.equal(response.status, 200);
  const answer = body as ScanAnswer;
  const [title, ...lines] = cli.stdout.split('\n');
  assert.equal(`${answer.repository.id} · ${answer.skills.length} skills`, title);
  const printed = answer.skills.flatMap((skill) => [
    skill.summary ? `${skill.name} — ${skill.summary}` : skill.name,
    `  ${skill.link}`,
    ...(skill.copies.length ? [`  also in ${skill.copies.join(', ')}`] : []),
  ]);
  assert.deepEqual(printed, lines);
  assert.deepEqual(answer.warnings.map((warning) => `warning: ${warning}`), cli.stderr.split('\n'));
});

test('each skill comes with its SKILL.md text, and its parts', async () => {
  const answer = await scanned(FIXTURE);
  for (const skill of answer.skills) {
    const text = readFileSync(join(FIXTURE, skill.path), 'utf8');
    const { properties, body } = parseSkill(text);
    assert.equal(skill.text, text, skill.path);
    assert.deepEqual([skill.properties, skill.body], [properties, body], skill.path);
  }
});

test('on GitHub: the link pins the scanned commit', async () => {
  const answer = await scanned('https://github.com/JetBrains/example');
  assert.equal(answer.repository.id, 'JetBrains/example');
  assert.deepEqual(
    answer.skills.map((skill) => [skill.name, skill.summary, skill.link]),
    [['commits', 'Write commit messages the way this repository does.', `https://github.com/JetBrains/example/blob/${EXAMPLE_COMMIT}/.claude/skills/commits/SKILL.md`]],
  );
});

/** Each skill's last update, by its path. */
const lastUpdates = (answer: ScanAnswer) => Object.fromEntries(answer.skills.map((skill) => [skill.path, skill.updated]));

test("the last update on GitHub: the last commit, up to the scanned one, that changed the skill's directory, in UTC", async () => {
  // Recorded for `commits?sha=<the scanned commit>&path=<the skill's directory>`, nothing else.
  assert.deepEqual(lastUpdates(await scanned('https://github.com/JetBrains/example')), {
    '.claude/skills/commits/SKILL.md': { date: EXAMPLE_UPDATED.date },
  });
  const dates = lastUpdates(await scanned('https://github.com/JetBrains/dates'));
  assert.deepEqual(dates['.claude/skills/first/SKILL.md'], { date: '2026-10-14T12:53:27.000Z' });
  assert.deepEqual(dates['.claude/skills/second/SKILL.md'], { date: '2025-03-03T04:30:00.000Z' });
});

test("the last update on GitHub of a skill only through a link: its target's directory", async () => {
  // A pinned ref: listed through the tree, which has the link, even with a token.
  assert.deepEqual(lastUpdates(await scanned('https://github.com/JetBrains/linked/tree/main')), {
    '.claude/skills/shared/SKILL.md': { date: '2026-07-07T07:07:07.000Z' },
  });
});

test('the last update on GitHub of a SKILL.md at the root: the repository\'s last commit', async () => {
  assert.deepEqual(lastUpdates(await scanned('https://github.com/JetBrains/root')), { 'SKILL.md': { date: '2026-09-01T08:05:00.000Z' } });
});

test('the last update cannot be known: no commit, GitHub answers no more → why, for that skill; the scan goes on', async () => {
  const { response, body } = await scanOf('https://github.com/JetBrains/dates');
  assert.equal(response.status, 200);
  const dates = lastUpdates(body as ScanAnswer);
  assert.equal(Object.keys(dates).length, 4);
  assert.deepEqual(dates['.claude/skills/uncommitted/SKILL.md'], {
    error: `No commit changed .claude/skills/uncommitted in https://github.com/JetBrains/dates up to ${EXAMPLE_COMMIT}`,
  });
  assert.deepEqual(dates['.claude/skills/limited/SKILL.md'], { error: 'GitHub rate limit reached; try again in a minute' });
});

/** A new temporary directory with these files, each modified at its date; removed after the test. */
function directory(t: TestContext, files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'skill-atlas-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(root, files);
  return root;
}

/** Writes each file, modified at its date. */
function write(root: string, files: Record<string, string>) {
  for (const [path, date] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), `---\ndescription: ${path}\n---\n${date}\n`);
    utimesSync(join(root, path), new Date(date), new Date(date));
  }
}

/** git in the directory, each commit at its date. */
function git(root: string, date: string, ...args: string[]) {
  const env = { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
  const config = ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false'];
  const result = spawnSync('git', ['-C', root, ...config, ...args], { env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

/** A git checkout: two skills and a root SKILL.md, then a script of the first one, committed later. */
function checkout(t: TestContext): string {
  const root = directory(t, { 'SKILL.md': '2020-01-01', '.claude/skills/a/SKILL.md': '2020-01-01', '.claude/skills/b/SKILL.md': '2020-01-01' });
  git(root, '2026-01-01T10:00:00Z', 'init', '-q');
  git(root, '2026-01-01T10:00:00Z', 'add', '-A');
  git(root, '2026-01-01T10:00:00Z', 'commit', '-q', '-m', 'Skills');
  write(root, { '.claude/skills/a/scripts/run.sh': '2020-01-01' });
  git(root, '2026-02-01T10:00:00+01:00', 'add', '-A');
  git(root, '2026-02-01T10:00:00+01:00', 'commit', '-q', '-m', 'A script');
  return root;
}

test("the last update in a git checkout: the last commit that changed the skill's directory, a script too; the root, the repository's", async (t) => {
  assert.deepEqual(lastUpdates(await scanned(checkout(t))), {
    '.claude/skills/a/SKILL.md': { date: '2026-02-01T09:00:00.000Z' },
    '.claude/skills/b/SKILL.md': { date: '2026-01-01T10:00:00.000Z' },
    'SKILL.md': { date: '2026-02-01T09:00:00.000Z' },
  });
});

test('the last update in a git checkout, changed since or not committed: the latest modification of its files git does not ignore', async (t) => {
  const root = checkout(t);
  write(root, { '.claude/skills/b/SKILL.md': '2026-03-01T12:00:00Z', '.claude/skills/c/SKILL.md': '2026-04-01T12:00:00Z' });
  // Ignored by git: not the skill's change.
  writeFileSync(join(root, '.gitignore'), '*.log\n');
  write(root, { '.claude/skills/b/build.log': '2026-09-01T12:00:00Z' });
  const dates = lastUpdates(await scanned(root));
  assert.deepEqual(dates['.claude/skills/a/SKILL.md'], { date: '2026-02-01T09:00:00.000Z' });
  assert.deepEqual(dates['.claude/skills/b/SKILL.md'], { date: '2026-03-01T12:00:00.000Z' });
  assert.deepEqual(dates['.claude/skills/c/SKILL.md'], { date: '2026-04-01T12:00:00.000Z' });
});

test('the last update not in a git checkout: the latest modification of its files, a script too', async (t) => {
  const root = directory(t, { '.claude/skills/x/SKILL.md': '2026-05-01T12:00:00Z', '.claude/skills/x/scripts/run.sh': '2026-06-01T12:00:00Z' });
  assert.deepEqual(lastUpdates(await scanned(root)), { '.claude/skills/x/SKILL.md': { date: '2026-06-01T12:00:00.000Z' } });
});

test('the CLI does not ask for the last updates: a GitHub request each', async () => {
  const requested: string[] = [];
  const stdout: string[] = [];
  const code = await run(['scan', 'https://github.com/JetBrains/dates'], {
    open: openWith((url, init) => (requested.push(url), github(url, init))),
    print: (text) => stdout.push(text),
    error: () => {},
  });
  assert.equal(code, 0);
  assert.deepEqual(requested.filter((url) => url.includes('/commits?')), []);
  assert.equal(stdout[0], 'JetBrains/dates · 4 skills');
  assert.doesNotMatch(stdout.join('\n'), /Updated|2026-10-14|unknown/);
});

test('an empty field → 400 and a hint; an unreachable repository, not a GitHub URL → 400 and the CLI message', async () => {
  for (const source of ['', '   ']) {
    const { response, body } = await scanOf(source);
    assert.equal(response.status, 400);
    assert.deepEqual(body, { error: 'Enter a GitHub repository URL or a directory' });
  }
  const missing = await scanOf(join(FIXTURE, 'no-such-directory'));
  assert.equal(missing.response.status, 400);
  assert.match((missing.body as ErrorAnswer).error, /^Not a GitHub URL or a readable directory: .*no-such-directory$/);
  const offline = await scanOf('https://github.com/JetBrains/not-answered');
  assert.equal(offline.response.status, 400);
  assert.match((offline.body as ErrorAnswer).error, /^Cannot reach GitHub: /);
  // Not a GitHub URL: what the CLI says for it.
  const gitlab = 'https://gitlab.com/JetBrains/kotlin';
  const cli = await atlas(['scan', gitlab]);
  assert.equal(cli.code, 1);
  assert.deepEqual((await scanOf(gitlab)).body, { error: cli.stderr });
});

/** What GET /api/scan answers for an organization: its lines, parsed. */
async function organizationLines(source: string): Promise<{ response: Response; lines: OrganizationLine[] }> {
  const response = await fetch(new URL(`/api/scan?source=${encodeURIComponent(source)}`, base));
  const text = await response.text();
  return { response, lines: text.split('\n').filter(Boolean).map((line) => JSON.parse(line)) };
}

test('an organization: a JSON line at a time, the same repositories, counts and warnings as the CLI, each scan as alone, last updates too', async () => {
  const cli = await atlas(['scan', 'https://github.com/JetBrains']);
  const { response, lines } = await organizationLines('https://github.com/JetBrains');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type')!, /^application\/x-ndjson/);
  const [first, ...repositories] = lines;
  assert.deepEqual(first, {
    organization: { id: 'JetBrains', url: 'https://github.com/JetBrains' },
    repositories: ['example', 'malformed', 'new', 'none'].map((name) => ({ id: `JetBrains/${name}`, url: `https://github.com/JetBrains/${name}` })),
  });
  const printed = repositories.map((line) => {
    assert.ok('id' in line, JSON.stringify(line));
    if ('error' in line) return `${line.id} · not scanned: ${line.error}`;
    assert.ok('skills' in line);
    return `${line.id} · ${line.skills.length} ${line.skills.length === 1 ? 'skill' : 'skills'}`;
  });
  assert.deepEqual([`JetBrains · ${repositories.length} repositories`, ...printed], cli.stdout.split('\n'));
  const warnings = repositories.flatMap((line) => ('warnings' in line ? line.warnings.map((warning) => `warning: ${line.id}: ${warning}`) : []));
  assert.deepEqual(warnings, cli.stderr.split('\n'));
  // A repository's line: what GET /api/scan answers for it alone, listed through its tree.
  const example = repositories.find((line) => 'id' in line && line.id === 'JetBrains/example');
  const alone = await scanned('https://github.com/JetBrains/example');
  assert.deepEqual(example, { id: 'JetBrains/example', url: 'https://github.com/JetBrains/example', ...alone });
  // Its skills' last updates too.
  assert.deepEqual(lastUpdates(alone), { '.claude/skills/commits/SKILL.md': { date: EXAMPLE_UPDATED.date } });
});

test('an organization, GitHub answers no more → the lines so far, then `{ error }`, last', async () => {
  const { response, lines } = await organizationLines('https://github.com/Limited');
  assert.equal(response.status, 200);
  assert.deepEqual(
    lines.slice(1).map((line) => ('id' in line && 'skills' in line ? [line.id, line.skills, line.warnings] : line)),
    [['Limited/first', [], []], { error: 'GitHub rate limit reached; try again in a minute' }],
  );
});

test('an organization GitHub does not know → 400 and the CLI message', async () => {
  const { response, body } = await scanOf('https://github.com/no-such-owner');
  assert.equal(response.status, 400);
  assert.deepEqual(body, { error: 'Organization not found: https://github.com/no-such-owner' });
});

test('an organization: the page gone, the server stops scanning it', async (t) => {
  // Each commit is answered late: the page leaves while the first repository is scanned.
  const requested: string[] = [];
  const late: Fetch = async (url, init) => {
    requested.push(url);
    if (url.endsWith('/commits/main')) await new Promise((resolve) => setTimeout(resolve, 200));
    return github(url, init);
  };
  const slow = createAtlasServer({ open: openWith(late) });
  const address = await listen(slow, 0);
  t.after(() => slow.close());
  const leaving = new AbortController();
  const response = await fetch(new URL(`/api/scan?source=${encodeURIComponent('https://github.com/JetBrains')}`, address), { signal: leaving.signal });
  const reader = response.body!.getReader();
  await reader.read(); // the organization's line
  leaving.abort();
  await new Promise((resolve) => setTimeout(resolve, 4 * 200 + 500)); // past what the whole scan takes
  const commits = requested.filter((url) => url.endsWith('/commits/main'));
  assert.deepEqual(commits, ['https://api.github.com/repos/JetBrains/example/commits/main']);
});

test('GITHUB_TOKEN works for serve as for scan: from the environment to GitHub', async (t) => {
  // The real CLI, with GitHub answering from a recording and telling which token it got.
  const dir = mkdtempSync(join(tmpdir(), 'skill-atlas-'));
  const seen = (name: string) => readFileSync(join(dir, name), 'utf8').trim().split('\n');
  const env = (name: string) => ({ ...process.env, GITHUB_TOKEN: 'secret', SKILL_ATLAS_SEEN: join(dir, name) });
  const node = ['--import', PRELOAD, CLI];
  const example = 'https://github.com/JetBrains/example';

  // Without the cache: each one asks GitHub itself.
  const scanned = spawnSync(process.execPath, [...node, 'scan', '--no-cache', example], { env: env('scan'), encoding: 'utf8' });
  assert.equal(scanned.status, 0, scanned.stderr);
  // The API requests carry it; raw.githubusercontent.com is asked without.
  assert.ok(seen('scan').includes('Bearer secret'), seen('scan').join(', '));

  const address = await serveCli(t, [...node, 'serve', '--port', '0', '--no-cache'], { env: env('serve') });
  t.after(() => rmSync(dir, { recursive: true, force: true })); // after the server is killed
  const answer = await fetch(new URL(`/api/scan?source=${encodeURIComponent(example)}`, address));
  assert.equal(answer.status, 200);
  // The scan's requests, then the skill's last update: an API request too.
  assert.deepEqual(seen('serve'), [...seen('scan'), 'Bearer secret']);
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

test('the Host check: the name and the port, which browsers leave out for 80', () => {
  assert.ok(isServedHost('localhost:3000', 3000));
  assert.ok(isServedHost('127.0.0.1:3000', 3000));
  assert.ok(isServedHost('LOCALHOST:3000', 3000));
  assert.ok(isServedHost('localhost', 80));
  assert.ok(isServedHost('127.0.0.1:80', 80));
  for (const host of [undefined, '', 'localhost', 'localhost:3001', 'attacker.example:3000', 'localhost.attacker.example:3000', 'localhost:3000@attacker.example', '[::1]:3000']) {
    assert.ok(!isServedHost(host, 3000), host);
  }
});

test('skill-atlas serve: prints its address, serves the page, stores nothing', async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'skill-atlas-'));
  const address = await serveCli(t, [CLI, 'serve', '--port', '0'], { cwd });
  t.after(() => rmSync(cwd, { recursive: true, force: true })); // after the server is killed
  const scanned = await (await fetch(`${address}api/scan?source=${encodeURIComponent(FIXTURE)}`)).json();
  assert.equal((scanned as ScanAnswer).repository.id, 'fixture');
  assert.deepEqual(readdirSync(cwd), []);
});

test('skill-atlas serve: a bad port → a clear message, exit code 1', async () => {
  const bad = spawnSync(process.execPath, [CLI, 'serve', '--port', 'many'], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.equal(bad.stderr, `Not a port: many\n${SERVE_USAGE}\n`);
  // Digits only, 0 to 65535; 0 picks a free port.
  // The word after --port is the port, even --no-cache.
  for (const port of ['', '0x1F90', '1e3', '-1', '65536', '80.5', ' 80', '--no-cache']) {
    const expected = { code: 1, ports: [], cached: [], stderr: `Not a port: ${port}\n${SERVE_USAGE}` };
    assert.deepEqual(await serveWith(['--port', port]), expected, port);
  }
});

test('skill-atlas serve: other arguments → the usage, exit code 1', async () => {
  // The shape is checked before the port: a bad port with extra arguments gets the usage too.
  for (const args of [
    ['--port'], ['80'], ['--port', '80', '81'], ['--port', 'many', '81'], ['--port=80'], ['--host', '80'],
    ['--no-cache', '--no-cache'], ['--port', '80', '--port', '81'], ['--cache'],
  ]) {
    const expected = { code: 1, ports: [], cached: [], stderr: SERVE_USAGE };
    assert.deepEqual(await serveWith(args), expected, args.join(' '));
  }
});

test('skill-atlas serve: port 3000 by default; any port from 0 to 65535', async () => {
  assert.deepEqual(await serveWith([]), { code: 0, ports: [3000], cached: [true], stderr: '' });
  for (const [port, number] of [['0', 0], ['1', 1], ['080', 80], ['65535', 65535]] as const) {
    assert.deepEqual(await serveWith(['--port', port]), { code: 0, ports: [number], cached: [true], stderr: '' }, port);
  }
});

test('skill-atlas serve --no-cache: with or without --port, in any order', async () => {
  for (const args of [['--no-cache'], ['--no-cache', '--port', '80'], ['--port', '80', '--no-cache']]) {
    const port = args.includes('--port') ? 80 : 3000;
    assert.deepEqual(await serveWith(args), { code: 0, ports: [port], cached: [false], stderr: '' }, args.join(' '));
  }
});

test('the browser terminal has no server and no cache: its help leaves `serve` and `--no-cache` out', async () => {
  const terminal = createBrowserBackend({ fetch: () => Promise.reject(new Error('no network')) });
  const help = await terminal.run('skill-atlas help');
  assert.match(help, /^  scan /m);
  assert.doesNotMatch(help, /serve|no-cache/);
  assert.match(await terminal.run('serve'), /^Unknown command: serve\n/);
  assert.equal(await terminal.run('scan --no-cache https://github.com/JetBrains/example'), 'Usage: skill-atlas scan <GitHub URL | directory>');
  // The Node CLI lists them.
  const cli = spawnSync(process.execPath, [CLI, 'help'], { encoding: 'utf8' }).stdout;
  assert.match(cli, /^  serve \[--port <port>\]/m);
  assert.match(cli, /^  --no-cache {22}with scan or serve: ask GitHub for everything, keep nothing in \.skill-atlas-cache\/$/m);
});
