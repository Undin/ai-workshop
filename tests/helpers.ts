// Runs the commands the way the CLI does, with GitHub answering from EXAMPLE below.
import { fileURLToPath } from 'node:url';
import { run } from '../src/commands.ts';
import type { Fetch } from '../src/core/github.ts';
import { replay, type Recording } from '../src/core/replay.ts';
import { lastUpdate, openSource } from '../src/open.ts';
import { createAtlasServer } from '../src/server.ts';

export const FIXTURE = fileURLToPath(new URL('../fixture', import.meta.url));
export const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

/** How late tests/serve-test.ts answers for JetBrains/slow: a scan still running. */
export const SLOW_ANSWER_MS = 2000;

/** The commit GitHub answers for JetBrains/example. */
export const EXAMPLE_COMMIT = '5ab6270ab772d113e8ad52ebfcaa0109c522ae00';

/** What GitHub answers for a repository listed through its tree, at EXAMPLE_COMMIT, with these files. */
export function inTree(id: string, files: Record<string, string>): Recording {
  return {
    [`https://api.github.com/repos/${id}/commits/main`]: { status: 200, body: { sha: EXAMPLE_COMMIT } },
    [`https://api.github.com/repos/${id}/git/trees/${EXAMPLE_COMMIT}?recursive=1`]: {
      status: 200,
      body: { truncated: false, tree: Object.keys(files).map((path) => ({ path, mode: '100644', type: 'blob', sha: 'file' })) },
    },
    ...Object.fromEntries(
      Object.entries(files).map(([path, body]) => [`https://raw.githubusercontent.com/${id}/${EXAMPLE_COMMIT}/${path}`, { status: 200, body }]),
    ),
  };
}

/** The date of the last commit that changed `directory` up to EXAMPLE_COMMIT, as GitHub answers it; the repository's without one. */
export function lastCommit(id: string, directory: string, date: string): Recording {
  const path = directory && `&path=${directory}`;
  return {
    [`https://api.github.com/repos/${id}/commits?sha=${EXAMPLE_COMMIT}${path}&per_page=1`]: {
      status: 200,
      body: [{ sha: 'last', commit: { committer: { date } } }],
    },
  };
}

/** What GitHub answers for an owner, an organization or a user, with these public repositories. */
export function owner(login: string, repositories: string[]): Recording {
  return {
    [`https://api.github.com/users/${login}`]: { status: 200, body: { login } },
    [`https://api.github.com/users/${login}/repos?per_page=100&page=1`]: {
      status: 200,
      body: repositories.map((name) => ({ full_name: `${login}/${name}`, default_branch: 'main' })),
    },
  };
}

const COMMITS = '---\nname: commits\ndescription: Write commit messages the way this repository does. Use for every commit.\n---\n# Commits\n';

/** What GitHub answers for a small repository, JetBrains/example, with one skill. */
export const EXAMPLE: Recording = {
  'https://api.github.com/repos/JetBrains/example': { status: 200, body: { full_name: 'JetBrains/example', default_branch: 'main' } },
  'https://api.github.com/repos/JetBrains/example/commits/main': { status: 200, body: { sha: EXAMPLE_COMMIT } },
  'https://api.github.com/search/code?q=filename:SKILL.md+repo:JetBrains/example&per_page=100&page=1': {
    status: 200,
    body: { total_count: 1, items: [{ path: '.claude/skills/commits/SKILL.md' }] },
  },
  [`https://raw.githubusercontent.com/JetBrains/example/${EXAMPLE_COMMIT}/.claude/skills/commits/SKILL.md`]: { status: 200, body: COMMITS },
  // Its last updates: the skill's directory, the repository's for a SKILL.md at the root; a
  // directory no commit changed.
  ...lastCommit('JetBrains/example', '.claude/skills/commits', '2026-10-14T12:53:27Z'),
  ...lastCommit('JetBrains/example', '', '2026-10-19T08:05:00Z'),
  [`https://api.github.com/repos/JetBrains/example/commits?sha=${EXAMPLE_COMMIT}&path=.claude/skills/gone&per_page=1`]: { status: 200, body: [] },

  // The JetBrains organization: JetBrains/example, one with a warning, an empty one, one without skills.
  ...owner('JetBrains', ['example', 'malformed', 'new', 'none']),
  'https://api.github.com/repos/JetBrains/new/commits/main': { status: 409, body: { message: 'Git Repository is empty.' } },
  ...inTree('JetBrains/example', { '.claude/skills/commits/SKILL.md': COMMITS, 'README.md': '# Example\n' }),
  ...inTree('JetBrains/malformed', {
    '.claude/skills/broken/SKILL.md': '---\nname: [broken\n---\n# Broken\n',
    '.claude/skills/commits/SKILL.md': COMMITS,
  }),
  ...inTree('JetBrains/none', { 'README.md': '# None\n' }),

  // Limited: GitHub's rate limit is reached at its second repository; the third is never asked for.
  ...owner('Limited', ['first', 'second', 'third']),
  ...inTree('Limited/first', {}),
  [`https://api.github.com/repos/Limited/first/commits?sha=${EXAMPLE_COMMIT}&path=skills/x&per_page=1`]: {
    status: 403,
    body: { message: 'API rate limit exceeded for user ID 1. (But here is the good news: ...)' },
  },
  'https://api.github.com/repos/Limited/second/commits/main': {
    status: 403,
    body: { message: 'API rate limit exceeded for user ID 1. (But here is the good news: ...)' },
  },

  // A user with no public repositories; an owner GitHub does not know.
  ...owner('nobody', []),
  'https://api.github.com/users/no-such-owner': { status: 404, body: { message: 'Not Found' } },
};

export const github = replay(EXAMPLE);

/** What the user asked to scan, opened the way the CLI does, with GitHub answering from `fetch`. */
export function openWith(fetch: Fetch) {
  // With a token, through code search, as EXAMPLE answers it.
  return (input: string) => openSource(input, { fetch, token: 'test' });
}

/** When a skill was last updated, asked the way the CLI's web view does, with GitHub answering from `fetch`. */
export function updatedWith(fetch: Fetch) {
  return (link: string) => lastUpdate(link, { fetch, token: 'test' });
}

/** `skill-atlas <args>`, as the CLI runs it, with GitHub answering from EXAMPLE. */
export async function atlas(args: string[]) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await run(args, {
    open: openWith(github),
    print: (text) => stdout.push(text),
    error: (text) => stderr.push(text),
  });
  return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
}

/** The web view, as `skill-atlas serve` runs it, with GitHub answering from EXAMPLE. */
export function atlasServer() {
  return createAtlasServer({ open: openWith(github), updated: updatedWith(github) });
}
