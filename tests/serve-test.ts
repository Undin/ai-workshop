// The web view for the browser tests in tests/web/: `skill-atlas serve`, with GitHub answering from
// the recordings in tests/helpers.ts and below, never from the network.
import type { Fetch } from '../src/core/github.ts';
import { replay } from '../src/core/replay.ts';
import { createAtlasServer, listen } from '../src/server.ts';
import { github, inTree, lastCommit, openWith, owner, RATE_LIMITED, repository, SLOW_ANSWER_MS } from './helpers.ts';

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
        '![tracker](https://tracker.example/pixel.png)',
        '',
      ].join('\n'),
    }),
    ...repository('JetBrains/empty', {}),
    // A first sentence too long for two lines of the list.
    ...repository('JetBrains/long', {
      '.claude/skills/long/SKILL.md': `---\nname: long\ndescription: ${'Explains every step of a very long procedure, '.repeat(8)}in detail.\n---\n# Long\n`,
    }),
    // One skill in three places: the skill and two copies.
    ...repository(
      'JetBrains/copies',
      Object.fromEntries(
        ['.agents', '.claude', '.github'].map((folder) => [
          `${folder}/skills/review/SKILL.md`,
          '---\nname: review\ndescription: Review a change.\n---\n# Review\n',
        ]),
      ),
    ),
    // An organization whose second repository answers SLOW_ANSWER_MS late.
    ...owner('Slow', ['first', 'late']),
    ...inTree('Slow/first', {}),
    ...inTree('Slow/late', {}),
    // Groups: an organization whose first repository has two skills, and whose second answers
    // SLOW_ANSWER_MS late, with one.
    ...owner('Halting', ['first', 'late']),
    ...inTree('Halting/first', {
      '.claude/skills/run-tests/SKILL.md': '---\nname: run-tests\ndescription: Run the tests before pushing.\n---\n# Run tests\n',
      '.claude/skills/commits/SKILL.md': '---\nname: commits\ndescription: Write commit messages.\n---\n# Commits\n',
    }),
    ...lastCommit('Halting/first', '.claude/skills/run-tests', '2026-05-05T05:05:05Z'),
    ...lastCommit('Halting/first', '.claude/skills/commits', '2026-05-05T05:05:05Z'),
    ...inTree('Halting/late', { '.claude/skills/e2e/SKILL.md': '---\nname: e2e\ndescription: The end-to-end tests.\n---\n# e2e\n' }),
    ...lastCommit('Halting/late', '.claude/skills/e2e', '2026-05-05T05:05:05Z'),
    // Groups: an organization whose first repository has a skill, and GitHub answers no more at its second.
    ...owner('Cut', ['first', 'second']),
    ...inTree('Cut/first', { '.claude/skills/commits/SKILL.md': '---\nname: commits\ndescription: Write commit messages.\n---\n# Commits\n' }),
    ...lastCommit('Cut/first', '.claude/skills/commits', '2026-05-05T05:05:05Z'),
    'https://api.github.com/repos/Cut/second/commits/main': RATE_LIMITED,
  },
  github,
);

// JetBrains/slow answers as JetBrains/example does, SLOW_ANSWER_MS late: a scan still running;
// Slow/late too, and Halting/late's commit.
const slow: Fetch = async (url, init) => {
  if (!url.includes('JetBrains/slow') && !url.includes('Slow/late/') && !url.includes('Halting/late/commits/main')) return answers(url, init);
  await new Promise((resolve) => setTimeout(resolve, SLOW_ANSWER_MS));
  return answers(url.replace('JetBrains/slow', 'JetBrains/example'), init);
};

const server = createAtlasServer({ open: openWith(slow) });
console.log(`Skill Atlas: ${(await listen(server, Number(process.env.PORT ?? 3100))).href}`);
