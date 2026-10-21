// The decisions in spec/analysis.md and spec/cli.md, checked on what the real command prints for
// ./fixture and for a small GitHub repository answered in tests/helpers.ts. Each case of what a
// skill is has its own test, on the fixture/ case named in fixture/README.md.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { openGitHub, openGitHubOwner, parseGitHubOwnerUrl, parseGitHubUrl, type Fetch } from '../src/core/github.ts';
import { parseSkill } from '../src/core/parse.ts';
import { replay, type Recording } from '../src/core/replay.ts';
import { scan, scanOrganization } from '../src/core/scan.ts';
import { run } from '../src/commands.ts';
import { openDirectory } from '../src/local.ts';
import { openSource } from '../src/open.ts';
import { atlas, CLI, EXAMPLE_COMMIT, FIXTURE, github, inTree, owner } from './helpers.ts';

const fixture = await atlas(['scan', FIXTURE]);
const example = await atlas(['scan', 'github.com/JetBrains/example']);

/** A file in ./fixture, as a skill's link. */
function link(path: string): string {
  return `${pathToFileURL(FIXTURE).href}/${path}`;
}

type Listed = { title: string; link: string; also: string[] };

/** The skills ./fixture prints: a title line, a link line and, for copies, an `also in` line. */
function listedSkills(): Listed[] {
  const skills: Listed[] = [];
  for (const line of fixture.stdout.split('\n').slice(1)) {
    if (line.startsWith('  also in ')) skills.at(-1)!.also = line.slice('  also in '.length).split(', ');
    else if (line.startsWith('  ')) skills.at(-1)!.link = line.trim();
    else skills.push({ title: line, link: '', also: [] });
  }
  return skills;
}

/** The skill linked to this file of ./fixture, if it is listed. */
function skill(path: string): Listed | undefined {
  return listedSkills().find((listed) => listed.link === link(path));
}

/** Whether this file of ./fixture is listed as a skill: a copy is not. */
function listed(path: string): boolean {
  return skill(path) !== undefined;
}

/** The warnings ./fixture prints, sorted. */
function warnings(): string[] {
  return fixture.stderr.split('\n').filter(Boolean).sort();
}

test('malformed front matter → the directory name, no description and a warning', () => {
  const parsed = parseSkill(readFileSync(join(FIXTURE, '.agents/skills/release-checklist/SKILL.md'), 'utf8'));
  assert.equal(parsed.name, undefined);
  assert.equal(parsed.description, '');
  assert.equal(
    parsed.warning,
    'malformed front matter: Nested mappings are not allowed in compact mappings at line 3, column 14; using the directory name',
  );
});

test('scan prints the repository, then each skill with its first sentence and pinned link', () => {
  assert.equal(example.code, 0, example.stderr);
  assert.equal(
    example.stdout,
    [
      'JetBrains/example · 1 skill',
      'commits — Write commit messages the way this repository does.',
      `  https://github.com/JetBrains/example/blob/${EXAMPLE_COMMIT}/.claude/skills/commits/SKILL.md`,
    ].join('\n'),
  );
});

test('./fixture: every skill, sorted by name, linked to its file, with its copies and the warnings', () => {
  assert.equal(fixture.code, 0, fixture.stderr);
  assert.equal(
    fixture.stdout,
    [
      'fixture · 10 skills',
      'changelog — Update CHANGELOG.md for a release.',
      `  ${link('skills/changelog/SKILL.md')}`,
      '  also in .cursor/skills/changelog/SKILL.md',
      "code-style — Follow the project's code style.",
      `  ${link('.agents/skills/code-style/SKILL.md')}`,
      '  also in .github/skills/code-style/SKILL.md',
      'commits — Write commit messages the way this repository does.',
      `  ${link('.claude/skills/commits/SKILL.md')}`,
      '  also in .github/skills/commits/SKILL.md',
      'deploy — Deploy the API to staging.',
      `  ${link('packages/api/.claude/skills/deploy/SKILL.md')}`,
      'deploy — Deploy the app to staging.',
      `  ${link('packages/app/.claude/skills/deploy/SKILL.md')}`,
      'fixture — The fixture repository as one skill.',
      `  ${link('SKILL.md')}`,
      'release-checklist',
      `  ${link('.agents/skills/release-checklist/SKILL.md')}`,
      'review-pr — Review a pull request for correctness.',
      `  ${link('plugins/review/skills/review-pr/SKILL.md')}`,
      '  also in agent/skills/review-pr/SKILL.md',
      'run-tests — Run the tests before pushing.',
      `  ${link('.claude/skills/run-tests/SKILL.md')}`,
      'upgrade — Upgrade the dependencies to their latest versions.',
      `  ${link('tools/latest/skills/upgrade/SKILL.md')}`,
    ].join('\n'),
  );
  assert.deepEqual(
    warnings().map((line) => line.replace(/(malformed front matter): .*/, '$1')),
    [
      'warning: .agents/skills/release-checklist/SKILL.md: malformed front matter',
      'warning: .claude/skills/missing: link to ../../no-such-skill, not followed',
      'warning: .claude/skills/outside/SKILL.md: link to ../../../../README.md, not followed',
      'warning: packages/app/.claude/skills/deploy/SKILL.md: same name as packages/api/.claude/skills/deploy/SKILL.md, different content',
      'warning: skipped 7 SKILL.md in test data',
    ],
  );
});

// Where: a SKILL.md directly in skills/<name>/, at any depth, or at the root.

test('a skill in another agent folder, a monorepo package, a plugin and a skill collection', () => {
  for (const path of [
    '.agents/skills/release-checklist/SKILL.md',
    '.claude/skills/commits/SKILL.md',
    'packages/app/.claude/skills/deploy/SKILL.md',
    'plugins/review/skills/review-pr/SKILL.md',
    'skills/changelog/SKILL.md',
  ]) {
    assert.ok(listed(path), `${path} is a skill`);
  }
});

test('a SKILL.md at the root: the repository is one skill, named after it', () => {
  assert.deepEqual(skill('SKILL.md'), {
    title: 'fixture — The fixture repository as one skill.',
    link: link('SKILL.md'),
    also: [],
  });
});

test('not directly in skills/<name>/ → not a skill', () => {
  for (const path of ['docs/SKILL.md', 'skills/SKILL.md', 'skills/group/nested/SKILL.md']) {
    assert.ok(!listed(path), `${path} is not a skill`);
  }
  assert.doesNotMatch(fixture.stdout, /^(docs|skills|nested)\b/m);
});

test('not named exactly SKILL.md → not a skill', () => {
  for (const path of ['.claude/skills/lowercase/skill.md', '.claude/skills/backup/SKILL.md.bak']) {
    assert.ok(!listed(path), `${path} is not a skill`);
  }
  assert.doesNotMatch(fixture.stdout, /^(lowercase|backup)\b/m);
});

// Not a skill: test data.

test('test data → skipped, with one warning for all of it', () => {
  for (const path of [
    'tests/skills/sample/SKILL.md',
    'src/test/resources/.claude/skills/sample/SKILL.md',
    'examples/skills/demo/SKILL.md',
    // As in JetBrains/koog: a test resource of a project that loads skills.
    'integration-tests/src/jvmTest/resources/skills/arithmetic-evaluator/SKILL.md',
    'src/commonTest/resources/skills/weather-retrieval/SKILL.md',
    'e2e-tests/skills/smoke/SKILL.md',
    'lib/testFixtures/skills/stub/SKILL.md',
  ]) {
    assert.ok(!listed(path), `${path} is test data`);
  }
  assert.doesNotMatch(fixture.stdout, /^(sample|demo|arithmetic-evaluator|weather-retrieval|smoke|stub)\b/m);
  assert.deepEqual(
    warnings().filter((line) => line.includes('test data')),
    ['warning: skipped 7 SKILL.md in test data'],
  );
});

test('test data is named after tests: a word, a source set; not a skill named so, not a word that contains it', () => {
  assert.equal(skill('.claude/skills/run-tests/SKILL.md')?.title, 'run-tests — Run the tests before pushing.');
  assert.equal(skill('tools/latest/skills/upgrade/SKILL.md')?.title, 'upgrade — Upgrade the dependencies to their latest versions.');
});

test('a project that works with skills: its fixture is test data, its own skills are its skills', async () => {
  const project = await atlas(['scan', join(FIXTURE, '..')]);
  assert.equal(project.code, 0, project.stderr);
  assert.match(project.stdout, /^\S+ · 4 skills\n/);
  assert.match(project.stdout, /^code-review — /m);
  assert.match(project.stdout, /^demo-feature — /m);
  assert.match(project.stdout, /^implement-issue — /m);
  assert.match(project.stdout, /^red-agent — /m);
  assert.match(project.stderr, /^warning: skipped \d+ SKILL\.md in test data$/m);
});

// Copies.

test('same name, same content but other line endings → one skill, the first path, the other also in', () => {
  assert.deepEqual(skill('.agents/skills/code-style/SKILL.md')?.also, ['.github/skills/code-style/SKILL.md']);
  assert.ok(!listed('.github/skills/code-style/SKILL.md'));
});

test('same name, different content → two skills and a warning', () => {
  assert.equal(skill('packages/api/.claude/skills/deploy/SKILL.md')?.title, 'deploy — Deploy the API to staging.');
  assert.equal(skill('packages/app/.claude/skills/deploy/SKILL.md')?.title, 'deploy — Deploy the app to staging.');
  assert.ok(
    warnings().includes(
      'warning: packages/app/.claude/skills/deploy/SKILL.md: same name as packages/api/.claude/skills/deploy/SKILL.md, different content',
    ),
  );
});

// Symbolic links: followed; what they reach is a copy of the target.

test('a link to a SKILL.md → a copy of its target', () => {
  assert.deepEqual(skill('.claude/skills/commits/SKILL.md')?.also, ['.github/skills/commits/SKILL.md']);
  assert.ok(!listed('.github/skills/commits/SKILL.md'));
});

test('a link to a skill directory → a copy, the target stays the skill whatever the path order', () => {
  // agent/… sorts before plugins/…, yet the link's target is the skill.
  assert.deepEqual(skill('plugins/review/skills/review-pr/SKILL.md')?.also, ['agent/skills/review-pr/SKILL.md']);
  assert.ok(!listed('agent/skills/review-pr/SKILL.md'));
});

test('a link to a skills/ directory → each skill in it gets a copy', () => {
  // `.cursor/…` sorts before `skills/…`, yet the link's target is the skill.
  assert.deepEqual(skill('skills/changelog/SKILL.md')?.also, ['.cursor/skills/changelog/SKILL.md']);
  assert.ok(!listed('.cursor/skills/changelog/SKILL.md'));
});

test('on GitHub, without a token: a link in the tree is read from its blob and followed', async () => {
  const commit = EXAMPLE_COMMIT;
  const linked = replay({
    'https://api.github.com/repos/JetBrains/linked': { status: 200, body: { full_name: 'JetBrains/linked', default_branch: 'main' } },
    'https://api.github.com/repos/JetBrains/linked/commits/main': { status: 200, body: { sha: commit } },
    [`https://api.github.com/repos/JetBrains/linked/git/trees/${commit}?recursive=1`]: {
      status: 200,
      body: {
        truncated: false,
        tree: [
          { path: '.claude/skills/commits/SKILL.md', mode: '100644', type: 'blob', sha: 'file' },
          { path: '.github/skills', mode: '120000', type: 'blob', sha: 'link' },
        ],
      },
    },
    'https://api.github.com/repos/JetBrains/linked/git/blobs/link': {
      status: 200,
      body: { content: `${btoa('../.claude/skills')}\n`, encoding: 'base64' },
    },
    [`https://raw.githubusercontent.com/JetBrains/linked/${commit}/.claude/skills/commits/SKILL.md`]: {
      status: 200,
      body: '---\nname: commits\ndescription: Write commit messages.\n---\n',
    },
  });
  const result = await scan(await openGitHub('https://github.com/JetBrains/linked', { fetch: linked }));
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(
    result.skills.map((skill) => [skill.path, skill.copies]),
    [['.claude/skills/commits/SKILL.md', ['.github/skills/commits/SKILL.md']]],
  );
});

// A pinned ref: /tree/<ref> instead of the default branch.

test('a URL with /tree/<ref> → that ref', () => {
  assert.deepEqual(parseGitHubUrl('https://github.com/JetBrains/kotlin/tree/v2.1.0/'), { owner: 'JetBrains', repo: 'kotlin', ref: 'v2.1.0' });
  assert.deepEqual(parseGitHubUrl('github.com/JetBrains/kotlin/tree/release/2.1'), { owner: 'JetBrains', repo: 'kotlin', ref: 'release/2.1' });
  assert.deepEqual(parseGitHubUrl('https://github.com/JetBrains/kotlin'), { owner: 'JetBrains', repo: 'kotlin' });
});

test('on GitHub, a pinned ref with a token: listed through the tree at that commit, linked to it', async () => {
  const commit = 'd7e4f5c1394535b05e90dde6e3e7e8a3f3e174a2';
  // No search answer is recorded: code search only sees the default branch.
  const pinned = replay({
    'https://api.github.com/repos/JetBrains/pinned': { status: 200, body: { full_name: 'JetBrains/pinned', default_branch: 'main' } },
    [`https://api.github.com/repos/JetBrains/pinned/commits/${commit}`]: { status: 200, body: { sha: commit } },
    [`https://api.github.com/repos/JetBrains/pinned/git/trees/${commit}?recursive=1`]: {
      status: 200,
      body: { truncated: false, tree: [{ path: '.claude/skills/commits/SKILL.md', mode: '100644', type: 'blob', sha: 'file' }] },
    },
    [`https://raw.githubusercontent.com/JetBrains/pinned/${commit}/.claude/skills/commits/SKILL.md`]: {
      status: 200,
      body: '---\nname: commits\ndescription: Write commit messages.\n---\n',
    },
  });
  const source = await openGitHub(`https://github.com/JetBrains/pinned/tree/${commit}`, { fetch: pinned, token: 'test' });
  assert.equal(source.repository.commit, commit);
  const result = await scan(source);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(
    result.skills.map((skill) => skill.path),
    ['.claude/skills/commits/SKILL.md'],
  );
});

test('a pinned ref that does not exist → a clear message', async () => {
  const missing = replay({
    'https://api.github.com/repos/JetBrains/pinned': { status: 200, body: { full_name: 'JetBrains/pinned', default_branch: 'main' } },
    'https://api.github.com/repos/JetBrains/pinned/commits/no-such-branch': { status: 404, body: { message: 'Not Found' } },
  });
  await assert.rejects(openGitHub('https://github.com/JetBrains/pinned/tree/no-such-branch', { fetch: missing }), {
    message: 'Not found in https://github.com/JetBrains/pinned: no-such-branch',
  });
});

test('a broken link → a warning, the scan goes on', () => {
  assert.equal(fixture.code, 0);
  assert.ok(warnings().includes('warning: .claude/skills/missing: link to ../../no-such-skill, not followed'));
  assert.doesNotMatch(fixture.stdout, /^missing\b/m);
});

test('a link outside the repository → a warning, not followed', () => {
  assert.ok(warnings().includes('warning: .claude/skills/outside/SKILL.md: link to ../../../../README.md, not followed'));
  assert.ok(!listed('.claude/skills/outside/SKILL.md'));
  assert.doesNotMatch(fixture.stdout, /^outside\b/m);
});

test('the CLI prints the result at once; a local directory: nothing stored', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'skill-atlas-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const scanned = spawnSync(process.execPath, [CLI, 'scan', FIXTURE], { cwd, encoding: 'utf8' });
  assert.equal(scanned.status, 0, scanned.stderr);
  assert.equal(scanned.stdout, `${fixture.stdout}\n`);
  assert.deepEqual(readdirSync(cwd), []);
});

test('unreachable repository → a clear message, exit code 1', async () => {
  const missing = spawnSync(process.execPath, [CLI, 'scan', join(FIXTURE, 'no-such-directory')], { encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /^Not a GitHub URL or a readable directory: .*no-such-directory\n$/);

  // What GitHub answers for a repository that does not exist.
  const notFound = replay({ 'https://api.github.com/repos/JetBrains/no-such-repository': { status: 404, body: { message: 'Not Found' } } });
  await assert.rejects(openGitHub('https://github.com/JetBrains/no-such-repository', { fetch: notFound }), {
    message: 'Repository not found: https://github.com/JetBrains/no-such-repository',
  });

  const offline = await atlas(['scan', 'https://github.com/JetBrains/not-answered']);
  assert.equal(offline.code, 1);
  assert.match(offline.stderr, /^Cannot reach GitHub: not recorded: https:\/\/api\.github\.com\/repos\/JetBrains\/not-answered$/);
});

test('rate limit → a message that asks for GITHUB_TOKEN', async () => {
  const limited = replay({
    'https://api.github.com/repos/JetBrains/MPS': {
      status: 403,
      body: { message: 'API rate limit exceeded for 192.0.2.1. (But here is the good news: ...)' },
    },
  });
  await assert.rejects(openGitHub('https://github.com/JetBrains/MPS', { fetch: limited }), {
    message: 'GitHub rate limit reached; set GITHUB_TOKEN',
  });
});

test('a skill carries its SKILL.md text, as read, and its parts', async () => {
  const result = await scan(await openDirectory(FIXTURE));
  const commits = result.skills.find((skill) => skill.path === '.claude/skills/commits/SKILL.md');
  const text = readFileSync(join(FIXTURE, '.claude/skills/commits/SKILL.md'), 'utf8');
  assert.equal(commits?.text, text);
  const { properties, body } = parseSkill(text);
  assert.deepEqual([commits?.properties, commits?.body], [properties, body]);
});

// An organization: each public repository, one by one.

/** `fetch` that answers as `answer` does and keeps each requested URL, in order. */
function watched(answer: Fetch): { fetch: Fetch; requested: string[] } {
  const requested: string[] = [];
  return { requested, fetch: (url, init) => (requested.push(url), answer(url, init)) };
}

test('an organization URL: https://github.com/<owner>, with or without the scheme or a trailing slash', () => {
  for (const url of ['https://github.com/JetBrains', 'https://github.com/JetBrains/', 'github.com/JetBrains', 'http://www.github.com/JetBrains ']) {
    assert.deepEqual(parseGitHubOwnerUrl(url), { owner: 'JetBrains' }, url);
    assert.equal(parseGitHubUrl(url), undefined, url);
  }
  for (const url of ['https://github.com/JetBrains/kotlin', 'https://github.com/', 'https://gitlab.com/JetBrains']) {
    assert.equal(parseGitHubOwnerUrl(url), undefined, url);
  }
});

test('an organization → the number of its repositories, then each one with its skill count, or why it is not scanned', async () => {
  const result = await atlas(['scan', 'https://github.com/JetBrains']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(
    result.stdout,
    [
      'JetBrains · 4 repositories',
      'JetBrains/example · 1 skill',
      'JetBrains/malformed · 2 skills',
      'JetBrains/new · not scanned: GitHub answered 409 for https://api.github.com/repos/JetBrains/new/commits/main: Git Repository is empty.',
      'JetBrains/none · 0 skills',
    ].join('\n'),
  );
});

test("an organization: each repository's warnings on stderr, after its name", async () => {
  const result = await atlas(['scan', 'github.com/JetBrains/']);
  assert.match(
    result.stderr,
    /^warning: JetBrains\/malformed: \.claude\/skills\/broken\/SKILL\.md: malformed front matter: .*; using the directory name$/,
  );
});

test("an organization's repository: the line of its own scan, at its default branch, listed through its tree even with a token", async () => {
  const own = await atlas(['scan', 'https://github.com/JetBrains/example']);
  const organization = await atlas(['scan', 'https://github.com/JetBrains']);
  assert.ok(organization.stdout.split('\n').includes(own.stdout.split('\n')[0]));

  const { fetch, requested } = watched(github);
  for await (const _ of scanOrganization(await openGitHubOwner('https://github.com/JetBrains', { fetch, token: 'test' })));
  assert.deepEqual(requested.filter((url) => url.includes('/search/')), []);
  assert.ok(requested.includes(`https://api.github.com/repos/JetBrains/example/git/trees/${EXAMPLE_COMMIT}?recursive=1`));
});

test('an organization: one repository at a time, each one as soon as it is scanned', async () => {
  const { fetch, requested } = watched(github);
  const scanning = scanOrganization(await openGitHubOwner('https://github.com/JetBrains', { fetch }));
  const asked = (repository: string) => requested.some((url) => url.includes(`/JetBrains/${repository}/`));
  const order: string[] = [];
  for await (const scanned of scanning) {
    order.push(scanned.id);
    // The next repository is not asked for until this one is given.
    const next = ['example', 'malformed', 'new', 'none'][order.length];
    if (next) assert.ok(!asked(next), `${next} asked for before ${scanned.id} was given`);
  }
  assert.deepEqual(order, ['JetBrains/example', 'JetBrains/malformed', 'JetBrains/new', 'JetBrains/none']);
});

test('an organization: all its public repositories, page after page', async () => {
  const names = Array.from({ length: 101 }, (_, index) => `r${String(index).padStart(3, '0')}`);
  const recording: Recording = owner('Many', names);
  recording['https://api.github.com/users/Many/repos?per_page=100&page=1'] = {
    status: 200,
    body: names.slice(0, 100).map((name) => ({ full_name: `Many/${name}`, default_branch: 'main' })),
  };
  recording['https://api.github.com/users/Many/repos?per_page=100&page=2'] = {
    status: 200,
    body: [{ full_name: 'Many/r100', default_branch: 'main' }],
  };
  for (const name of names) Object.assign(recording, inTree(`Many/${name}`, {}));
  const lines: string[] = [];
  const source = await openGitHubOwner('https://github.com/Many', { fetch: replay(recording) });
  for await (const scanned of scanOrganization(source)) lines.push(scanned.id);
  assert.equal(lines.length, 101);
  assert.equal(lines.at(-1), 'Many/r100');
});

test('an organization without public repositories, or a user → `0 repositories`', async () => {
  assert.deepEqual(await atlas(['scan', 'https://github.com/nobody']), { code: 0, stdout: 'nobody · 0 repositories', stderr: '' });
});

test('an organization GitHub does not know → a clear message, exit code 1', async () => {
  assert.deepEqual(await atlas(['scan', 'https://github.com/no-such-owner']), {
    code: 1,
    stdout: '',
    stderr: 'Organization not found: https://github.com/no-such-owner',
  });
});

test('an organization, GitHub answers no more → the scan stops there: the lines so far, the message, exit code 1', async () => {
  const { fetch, requested } = watched(github);
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await run(['scan', 'https://github.com/Limited'], {
    open: (input) => openSource(input, { fetch, token: 'test' }),
    print: (text) => stdout.push(text),
    error: (text) => stderr.push(text),
  });
  assert.equal(code, 1);
  assert.deepEqual(stdout, ['Limited · 3 repositories', 'Limited/first · 0 skills']);
  assert.deepEqual(stderr, ['GitHub rate limit reached; try again in a minute']);
  assert.ok(!requested.some((url) => url.includes('Limited/third')));
});
