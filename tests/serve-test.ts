// The web view for the browser tests in tests/web/: `skill-atlas serve`, with GitHub answering from
// the recordings in tests/helpers.ts and below, never from the network.
import { replay, type Recording } from '../src/core/replay.ts';
import { openSource } from '../src/open.ts';
import { createAtlasServer, listen } from '../src/server.ts';
import { EXAMPLE_COMMIT, github } from './helpers.ts';

/** Code search, the commit and the files for a repository with these SKILL.md files. */
function repository(id: string, files: Record<string, string>): Recording {
  return {
    [`https://api.github.com/repos/${id}`]: { status: 200, body: { full_name: id, default_branch: 'main' } },
    [`https://api.github.com/repos/${id}/commits/main`]: { status: 200, body: { sha: EXAMPLE_COMMIT } },
    [`https://api.github.com/search/code?q=filename:SKILL.md+repo:${id}&per_page=100&page=1`]: {
      status: 200,
      body: { total_count: Object.keys(files).length, items: Object.keys(files).map((path) => ({ path })) },
    },
    ...Object.fromEntries(
      Object.entries(files).map(([path, body]) => [`https://raw.githubusercontent.com/${id}/${EXAMPLE_COMMIT}/${path}`, { status: 200, body }]),
    ),
  };
}

const answers = replay(
  {
    // A SKILL.md that tries to run a script in the page.
    ...repository('JetBrains/untrusted', {
      '.claude/skills/untrusted/SKILL.md': [
        '---',
        'name: untrusted',
        'description: Tries to run a script.',
        'allowed-tools: [Read, Grep]',
        '---',
        '# Untrusted',
        '',
        'Some **bold** text and a [link](https://example.com).',
        '',
        '<script>globalThis.pwned = "script"</script>',
        '<img src="x" onerror="globalThis.pwned = \'onerror\'">',
        '<a href="javascript:globalThis.pwned = \'href\'">click</a>',
        '',
      ].join('\n'),
    }),
    ...repository('JetBrains/empty', {}),
    // A first sentence too long for two lines of the list.
    ...repository('JetBrains/long', {
      '.claude/skills/long/SKILL.md': `---\nname: long\ndescription: ${'Explains every step of a very long procedure, '.repeat(8)}in detail.\n---\n# Long\n`,
    }),
  },
  github,
);

const server = createAtlasServer({ open: (input) => openSource(input, { fetch: answers, token: 'test' }) });
console.log(`Skill Atlas: ${(await listen(server, Number(process.env.PORT ?? 3100))).href}`);
