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
import { openGitHub } from '../src/core/github.ts';
import { parseSkill } from '../src/core/parse.ts';
import { replay } from '../src/core/replay.ts';
import { atlas, CLI, EXAMPLE_COMMIT, FIXTURE } from './helpers.ts';

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
      'fixture · 8 skills',
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
    ].join('\n'),
  );
  assert.deepEqual(
    warnings().map((line) => line.replace(/(malformed front matter): .*/, '$1')),
    [
      'warning: .agents/skills/release-checklist/SKILL.md: malformed front matter',
      'warning: .claude/skills/missing: link to ../../no-such-skill, not followed',
      'warning: .claude/skills/outside/SKILL.md: link to ../../../../README.md, not followed',
      'warning: packages/app/.claude/skills/deploy/SKILL.md: same name as packages/api/.claude/skills/deploy/SKILL.md, different content',
      'warning: skipped 3 SKILL.md in test data',
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
  for (const path of ['tests/skills/sample/SKILL.md', 'src/test/resources/.claude/skills/sample/SKILL.md', 'examples/skills/demo/SKILL.md']) {
    assert.ok(!listed(path), `${path} is test data`);
  }
  assert.doesNotMatch(fixture.stdout, /^(sample|demo)\b/m);
  assert.deepEqual(
    warnings().filter((line) => line.includes('test data')),
    ['warning: skipped 3 SKILL.md in test data'],
  );
});

test('a project that works with skills: its fixture is test data, not its skills', async () => {
  const project = await atlas(['scan', join(FIXTURE, '..')]);
  assert.equal(project.code, 0, project.stderr);
  assert.match(project.stdout, /^\S+ · 0 skills$/);
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

test('the CLI prints the result at once and stores nothing', (t) => {
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
