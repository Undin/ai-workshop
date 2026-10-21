// The decisions in spec/analysis.md, Group: each skill's group, in what the web view's scan answers
// for a GitHub repository with a skill for each rule (tests/helpers.ts), and for the skills of
// JetBrains' repositories, checked by hand (tests/groups.golden.txt).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, test } from 'node:test';
import { cluster, clusterOf, CLUSTERS, OTHER } from '../src/core/cluster.ts';
import { listen, type ScanAnswer } from '../src/server.ts';
import { atlasServer, GROUPED } from './helpers.ts';

const server = atlasServer();
const base = await listen(server, 0);
after(() => server.close());

const scanned = async (source: string) =>
  (await (await fetch(new URL(`/api/scan?source=${encodeURIComponent(source)}`, base))).json()) as ScanAnswer;

test('each skill comes with its group: its id, its name, its place in the list', async () => {
  const answer = await scanned('https://github.com/JetBrains/groups');
  assert.deepEqual(Object.fromEntries(answer.skills.map((skill) => [skill.name, skill.group.id])), GROUPED);
  for (const skill of answer.skills) assert.deepEqual(skill.group, cluster(skill.group.id));
  assert.deepEqual(answer.skills.find((skill) => skill.name === 'run-tests')!.group, { id: 'testing', name: 'Testing', order: 5 });
  assert.deepEqual(answer.skills.find((skill) => skill.name === 'notes')!.group, { id: 'other', name: 'Other', order: 17 });
});

test('17 groups and Other, the names as the spec lists them, in its order', () => {
  assert.deepEqual(
    [...CLUSTERS, OTHER].map(({ name }) => name),
    [
      'Language engineering & DSLs',
      'AI/ML & evaluation',
      'Data & analytics',
      'Performance & benchmarking',
      'Debugging & diagnostics',
      'Testing',
      'Releases & changelogs',
      'Issues & bug fixing',
      'Documentation & writing',
      'Code review & quality',
      'Git & pull requests',
      'Code search & navigation',
      'Refactoring & migrations',
      'Build & CI/CD',
      'IDE & plugin development',
      'Languages & frameworks',
      'Planning & agent workflows',
      'Other',
    ],
  );
});

test("the skills of JetBrains' repositories: each in the group checked by hand", () => {
  const rows = readFileSync(new URL('groups.golden.txt', import.meta.url), 'utf8')
    .split('\n')
    .filter((line) => line && !line.startsWith('#'));
  assert.equal(rows.length, 215);
  const wrong = rows.flatMap((row) => {
    const [repository, name, group, ...description] = row.split(' | ');
    const got = clusterOf({ name, description: description.join(' | ') });
    return got === group ? [] : [`${repository} | ${name}: ${got}, not ${group}`];
  });
  assert.deepEqual(wrong, []);
  // Every group has some.
  const groups = new Set(rows.map((row) => row.split(' | ')[2]));
  assert.deepEqual([...CLUSTERS, OTHER].filter(({ id }) => !groups.has(id)), []);
});
