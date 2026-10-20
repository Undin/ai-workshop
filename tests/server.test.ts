// The decisions in spec/web.md that the server makes: the page, and the scan as JSON, the same as
// what the CLI prints. What the page does with it is in tests/web/web.spec.ts.
import assert from 'node:assert/strict';
import { spawn, spawnSync, type SpawnOptions } from 'node:child_process';
import { once } from 'node:events';
import { request } from 'node:http';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { after, test, type TestContext } from 'node:test';
import { parseSkill } from '../src/core/parse.ts';
import { createBrowserBackend } from '../src/browser.ts';
import { run } from '../src/commands.ts';
import type { Fetch } from '../src/core/github.ts';
import { createAtlasServer, isServedHost, listen, type ErrorAnswer, type OrganizationLine, type ScanAnswer } from '../src/server.ts';
import { atlas, atlasServer, CLI, EXAMPLE_COMMIT, FIXTURE, github, openWith, updatedWith } from './helpers.ts';

const PRELOAD = fileURLToPath(new URL('github-preload.ts', import.meta.url));

/**
 * `node <args>` as a real `skill-atlas serve`: its printed address, once it listens. Killed after
 * the test, before the test's own cleanup; fails, not hangs, if it exits without an address.
 */
async function serveCli(t: TestContext, args: string[], options: SpawnOptions = {}): Promise<string> {
  const served = spawn(process.execPath, args, { ...options, stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(() => served.kill());
  const printed = once(served.stdout!, 'data').then(([line]: Buffer[]) => line.toString());
  const exited = once(served, 'exit').then(([code]) => `exited with ${code} before printing its address`);
  const line = await Promise.race([printed, exited]);
  const address = /^Skill Atlas: (http:\/\/127\.0\.0\.1:\d+\/)\n$/.exec(line)?.[1];
  assert.ok(address, line);
  return address;
}

/** `skill-atlas serve <args>` in-process, with a fake server: the exit code, the ports served, stderr. */
async function serveWith(args: string[]) {
  const ports: number[] = [];
  const stderr: string[] = [];
  const code = await run(['serve', ...args], {
    open: () => Promise.reject(new Error('not opened')),
    print: () => {},
    error: (text) => stderr.push(text),
    serve: async (port) => (ports.push(port), new URL('http://127.0.0.1/')),
  });
  return { code, ports, stderr: stderr.join('\n') };
}

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

const updatedOf = (link: string) => get(`/api/updated?link=${encodeURIComponent(link)}`);
const blob = (path: string) => `https://github.com/JetBrains/example/blob/${EXAMPLE_COMMIT}/${path}`;

test('the last update on GitHub: the last commit, up to the scanned one, that changed the skill directory', async () => {
  const [skill] = (await scanned('https://github.com/JetBrains/example')).skills;
  const { response, body } = await updatedOf(skill.link);
  assert.equal(response.status, 200);
  assert.deepEqual(body, { updated: '2026-10-14T12:53:27.000Z' });
});

test('the last update on GitHub of a SKILL.md at the root: the repository\'s', async () => {
  assert.deepEqual((await updatedOf(blob('SKILL.md'))).body, { updated: '2026-10-19T08:05:00.000Z' });
});

test('the last update: not a skill link, no commit, GitHub answers no more → 400 and a clear message', async () => {
  const links = [
    '',
    'https://github.com/JetBrains/example',
    `https://gitlab.com/JetBrains/example/blob/${EXAMPLE_COMMIT}/SKILL.md`,
    join(FIXTURE, 'SKILL.md'), // a path, not a link
    pathToFileURL(join(FIXTURE, 'README.md')).href,
    pathToFileURL(join(FIXTURE, '.claude/skills/no-such/SKILL.md')).href,
  ];
  for (const link of links) {
    const { response, body } = await updatedOf(link);
    assert.equal(response.status, 400, link);
    assert.deepEqual(body, { error: `Not a skill link: ${link}` });
  }
  assert.deepEqual((await updatedOf(blob('.claude/skills/gone/SKILL.md'))).body, {
    error: `No commit changed .claude/skills/gone in https://github.com/JetBrains/example up to ${EXAMPLE_COMMIT}`,
  });
  const limited = await updatedOf(`https://github.com/Limited/first/blob/${EXAMPLE_COMMIT}/skills/x/SKILL.md`);
  assert.equal(limited.response.status, 400);
  assert.deepEqual(limited.body, { error: 'GitHub rate limit reached; try again in a minute' });
});

/** A directory with these files, removed after the test. */
function directoryWith(t: TestContext, files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'skill-atlas-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(root, files);
  return root;
}

function write(root: string, files: Record<string, string>) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

/** A git checkout: each commit's files, committed at its date. */
function checkout(t: TestContext, commits: { date: string; files: Record<string, string> }[]): string {
  const root = directoryWith(t, {});
  const git = (args: string[], date?: string) => {
    const env = { ...process.env, ...(date && { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }) };
    const done = spawnSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { cwd: root, env, encoding: 'utf8' });
    assert.equal(done.status, 0, done.stderr);
  };
  git(['init', '-q']);
  for (const { date, files } of commits) {
    write(root, files);
    git(['add', '-A']);
    git(['commit', '-q', '-m', date], date);
  }
  return root;
}

const skillMd = (name: string) => `---\nname: ${name}\ndescription: The ${name} skill.\n---\n# ${name}\n`;

/** Each skill's last update, by name, through the links of the directory's scan. */
async function lastUpdates(root: string): Promise<Record<string, unknown>> {
  const answer = await scanned(root);
  const updates = await Promise.all(answer.skills.map(async (skill) => [skill.name, (await updatedOf(skill.link)).body]));
  return Object.fromEntries(updates);
}

/** Sets the files' modification time. */
function touch(root: string, paths: string[], date: string) {
  for (const path of paths) utimesSync(join(root, path), new Date(date), new Date(date));
}

test('the last update in a git checkout: the last commit that changed the skill directory; the repository\'s for a root SKILL.md', async (t) => {
  const root = checkout(t, [
    { date: '2026-01-01T10:00:00Z', files: { 'SKILL.md': skillMd('root'), '.claude/skills/a/SKILL.md': skillMd('a') } },
    // A file of the skill's own: an update of the skill.
    { date: '2026-02-01T10:00:00Z', files: { '.claude/skills/a/scripts/run.sh': 'echo a\n' } },
    { date: '2026-03-01T10:00:00+02:00', files: { '.claude/skills/b/SKILL.md': skillMd('b') } },
  ]);
  assert.deepEqual(await lastUpdates(root), {
    a: { updated: '2026-02-01T10:00:00.000Z' },
    b: { updated: '2026-03-01T08:00:00.000Z' },
    root: { updated: '2026-03-01T08:00:00.000Z' },
  });
});

test('the last update in a git checkout, changed since or not committed: the latest modification of its files', async (t) => {
  const root = checkout(t, [
    { date: '2026-01-01T10:00:00Z', files: { '.claude/skills/a/SKILL.md': skillMd('a'), '.claude/skills/a/scripts/run.sh': 'echo a\n', '.claude/skills/b/SKILL.md': skillMd('b') } },
  ]);
  write(root, { '.claude/skills/a/scripts/run.sh': 'echo changed\n', '.claude/skills/c/SKILL.md': skillMd('c') });
  touch(root, ['.claude/skills/a/SKILL.md'], '2026-04-04T04:04:04Z');
  touch(root, ['.claude/skills/a/scripts/run.sh'], '2026-05-05T05:05:05Z');
  touch(root, ['.claude/skills/c/SKILL.md'], '2026-06-06T06:06:06Z');
  assert.deepEqual(await lastUpdates(root), {
    a: { updated: '2026-05-05T05:05:05.000Z' },
    b: { updated: '2026-01-01T10:00:00.000Z' },
    c: { updated: '2026-06-06T06:06:06.000Z' },
  });
});

test('the last update in a directory not in a git checkout: the latest modification of its files', async (t) => {
  const root = directoryWith(t, { '.claude/skills/a/SKILL.md': skillMd('a'), '.claude/skills/a/references/notes.md': '# Notes\n' });
  touch(root, ['.claude/skills/a/SKILL.md'], '2026-07-07T07:07:07Z');
  touch(root, ['.claude/skills/a/references/notes.md'], '2026-03-03T03:03:03Z');
  assert.deepEqual(await lastUpdates(root), { a: { updated: '2026-07-07T07:07:07.000Z' } });
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

test('an organization: a JSON line at a time, the same repositories, counts and warnings as the CLI, each scan as alone', async () => {
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
  const slow = createAtlasServer({ open: openWith(late), updated: updatedWith(late) });
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

  const scanned = spawnSync(process.execPath, [...node, 'scan', example], { env: env('scan'), encoding: 'utf8' });
  assert.equal(scanned.status, 0, scanned.stderr);
  // The API requests carry it; raw.githubusercontent.com is asked without.
  assert.ok(seen('scan').includes('Bearer secret'), seen('scan').join(', '));

  const address = await serveCli(t, [...node, 'serve', '--port', '0'], { env: env('serve') });
  t.after(() => rmSync(dir, { recursive: true, force: true })); // after the server is killed
  const answer = await fetch(new URL(`/api/scan?source=${encodeURIComponent(example)}`, address));
  assert.equal(answer.status, 200);
  assert.deepEqual(seen('serve'), seen('scan'));
});

test('anything else → 404; not GET → 405; the scan, not HEAD either', async () => {
  assert.equal((await get('/no-such-page')).response.status, 404);
  assert.equal((await get('/../package.json')).response.status, 404);
  assert.equal((await get('/api/scan', { method: 'POST' })).response.status, 405);
  assert.equal((await get('/', { method: 'HEAD' })).response.status, 200);
  assert.equal((await get(`/api/scan?source=${encodeURIComponent(FIXTURE)}`, { method: 'HEAD' })).response.status, 405);
  assert.equal((await get(`/api/updated?link=${encodeURIComponent(blob('.claude/skills/commits/SKILL.md'))}`, { method: 'HEAD' })).response.status, 405);
  assert.equal((await get('/api/updated', { method: 'POST' })).response.status, 405);
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
  assert.equal(bad.stderr, 'Not a port: many\nUsage: skill-atlas serve [--port <port>]\n');
  // Digits only, 0 to 65535; 0 picks a free port.
  for (const port of ['', '0x1F90', '1e3', '-1', '65536', '80.5', ' 80']) {
    const expected = { code: 1, ports: [], stderr: `Not a port: ${port}\nUsage: skill-atlas serve [--port <port>]` };
    assert.deepEqual(await serveWith(['--port', port]), expected, port);
  }
});

test('skill-atlas serve: other arguments → the usage, exit code 1', async () => {
  // The shape is checked before the port: a bad port with extra arguments gets the usage too.
  for (const args of [['--port'], ['80'], ['--port', '80', '81'], ['--port', 'many', '81'], ['--port=80'], ['--host', '80']]) {
    const expected = { code: 1, ports: [], stderr: 'Usage: skill-atlas serve [--port <port>]' };
    assert.deepEqual(await serveWith(args), expected, args.join(' '));
  }
});

test('skill-atlas serve: port 3000 by default; any port from 0 to 65535', async () => {
  assert.deepEqual(await serveWith([]), { code: 0, ports: [3000], stderr: '' });
  for (const [port, number] of [['0', 0], ['1', 1], ['080', 80], ['65535', 65535]] as const) {
    assert.deepEqual(await serveWith(['--port', port]), { code: 0, ports: [number], stderr: '' }, port);
  }
});

test('the browser terminal has no server: its help leaves `serve` out', async () => {
  const terminal = createBrowserBackend({ fetch: () => Promise.reject(new Error('no network')) });
  const help = await terminal.run('skill-atlas help');
  assert.match(help, /^  scan /m);
  assert.doesNotMatch(help, /serve/);
  assert.match(await terminal.run('serve'), /^Unknown command: serve\n/);
  // The Node CLI lists it.
  assert.match(spawnSync(process.execPath, [CLI, 'help'], { encoding: 'utf8' }).stdout, /^  serve \[--port <port>\]/m);
});
