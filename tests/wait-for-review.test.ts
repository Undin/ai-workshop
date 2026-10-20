// The implement-issue skill's wait-for-review.ts (step 7 of its SKILL.md), as the skill runs it: the
// real process, with `gh` on the PATH answering from tests/fake-gh.ts.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type TestContext } from 'node:test';
import type { Answer, Answers } from './fake-gh.ts';

const SCRIPT = fileURLToPath(new URL('../.agents/skills/implement-issue/scripts/wait-for-review.ts', import.meta.url));
const FAKE_GH = fileURLToPath(new URL('./fake-gh.ts', import.meta.url));

const REVIEWS = 'repos/{owner}/{repo}/pulls/7/reviews';
const CONVERSATION = 'repos/{owner}/{repo}/issues/7/comments';
const INLINE = 'repos/{owner}/{repo}/pulls/7/comments';
const PR = 'https://github.com/JetBrains/example/pull/7';
const REPLY = '\n\n<!-- implement-issue -->';

/** At 12:<minute> on the day. */
const at = (minute: number) => `2026-10-20T12:${String(minute).padStart(2, '0')}:00Z`;

const comment = (id: number, minute: number, body: string, login = 'reviewer') => ({
  id, user: { login }, body, html_url: `${PR}#issuecomment-${id}`, created_at: at(minute),
});
const inline = (id: number, minute: number, body: string, root?: number) => ({
  id, user: { login: 'reviewer' }, body, html_url: `${PR}#discussion_r${id}`, created_at: at(minute),
  path: 'src/cli.ts', line: 10, original_line: 10, ...(root ? { in_reply_to_id: root } : {}),
});
const review = (id: number, minute: number, body: string, state = 'COMMENTED') => ({
  id, user: { login: 'reviewer' }, state, body, html_url: `${PR}#pullrequestreview-${id}`, submitted_at: at(minute),
});

type Asked = { reviews?: Answer[]; conversation?: Answer[]; inline?: Answer[] };

/** `wait-for-review.ts <args>` with GitHub answering `asked` (one page of nothing by default). */
function waitForReview(t: TestContext, asked: Asked, args = ['7', '--quiet', '0']) {
  const dir = mkdtempSync(join(tmpdir(), 'wait-for-review-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'gh'), `#!/bin/sh\nexec "${process.execPath}" "${FAKE_GH}" "$@"\n`);
  chmodSync(join(dir, 'gh'), 0o755);
  const answers: Answers = {
    [REVIEWS]: asked.reviews ?? [[[]]],
    [CONVERSATION]: asked.conversation ?? [[[]]],
    [INLINE]: asked.inline ?? [[[]]],
  };
  const file = join(dir, 'answers.json');
  writeFileSync(file, JSON.stringify(answers));
  const env = { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH}`, FAKE_GH: file };
  const done = spawnSync(process.execPath, [SCRIPT, ...args], { env, encoding: 'utf8' });
  const log = `${file}.log`;
  const calls = existsSync(log) ? readFileSync(log, 'utf8').trimEnd().split('\n') : [];
  return { code: done.status, stdout: done.stdout, stderr: done.stderr, calls };
}

/** What it found, when it found something. */
function found(t: TestContext, asked: Asked) {
  const { code, stdout, stderr } = waitForReview(t, asked);
  assert.equal(code, 0, stderr);
  assert.equal(stderr, '');
  return JSON.parse(stdout);
}

test('nothing to answer: [] and exit 2, after asking for every kind of review once with --quiet 0', (t) => {
  const { code, stdout, stderr, calls } = waitForReview(t, {});
  assert.equal(code, 2);
  assert.equal(stdout, '[]\n');
  assert.equal(stderr, 'No unanswered review on #7 in 0 minutes.\n');
  assert.deepEqual(calls, [REVIEWS, CONVERSATION, INLINE].map((path) => `api --paginate --slurp ${path}`));
});

test('an inline comment without a reply: its thread, path, line and comment', (t) => {
  assert.deepEqual(found(t, { inline: [[[inline(1, 1, 'Rename this.')]]] }), [
    {
      kind: 'inline', id: 1, url: `${PR}#discussion_r1`, path: 'src/cli.ts', line: 10,
      comments: [{ author: 'reviewer', url: `${PR}#discussion_r1`, body: 'Rename this.' }],
    },
  ]);
});

test('an inline thread is answered by a reply after its last comment; a comment after the reply opens it again', (t) => {
  const answered = [inline(1, 1, 'Rename this.'), inline(2, 2, `Renamed.${REPLY}`, 1)];
  const reopened = [
    inline(3, 3, 'Split this.'), inline(4, 4, `Split.${REPLY}`, 3),
    inline(5, 5, 'Not like that.', 3), inline(6, 6, 'Like the other one.', 3),
  ];
  // Out of order, as pages may come: the time decides.
  assert.deepEqual(found(t, { inline: [[[...reopened.reverse(), ...answered]]] }), [
    {
      kind: 'inline', id: 3, url: `${PR}#discussion_r3`, path: 'src/cli.ts', line: 10,
      comments: [
        { author: 'reviewer', url: `${PR}#discussion_r5`, body: 'Not like that.' },
        { author: 'reviewer', url: `${PR}#discussion_r6`, body: 'Like the other one.' },
      ],
    },
  ]);
});

test('an outdated inline comment: the line it was made on', (t) => {
  const outdated = { ...inline(1, 1, 'Rename this.'), line: null, original_line: 12 };
  assert.equal(found(t, { inline: [[[outdated]]] })[0].line, 12);
});

test('a conversation comment is answered by a later reply that links to it, not by a comment that is no reply', (t) => {
  const conversation = [
    comment(1, 1, 'Why not a flag?'),
    comment(2, 2, 'And the README?'),
    comment(3, 3, `${PR}#issuecomment-2: updated.${REPLY}`, 'author'),
    comment(4, 4, `${PR}#issuecomment-1: me too`),
  ];
  assert.deepEqual(found(t, { conversation: [[conversation]] }), [
    { kind: 'conversation', id: 1, url: `${PR}#issuecomment-1`, author: 'reviewer', body: 'Why not a flag?' },
    { kind: 'conversation', id: 4, url: `${PR}#issuecomment-4`, author: 'reviewer', body: `${PR}#issuecomment-1: me too` },
  ]);
});

test('a review summary is answered by a later reply that links to it; LGTM, drafts and empty ones need none', (t) => {
  const reviews = [
    review(1, 1, 'Two points: …'),
    review(2, 2, 'One more.'),
    review(3, 3, ''),
    review(4, 4, '', 'APPROVED'),
    review(5, 5, 'LGTM', 'APPROVED'),
    // code-review's LGTM, as a comment when it can't approve its own pull request
    review(6, 6, 'LGTM\n\nSpec axis skipped: no issue.\n\n---\nProduced by Air Automations.'),
    review(7, 7, 'Not sent yet', 'PENDING'),
    review(8, 8, 'Approved, but rename it.', 'APPROVED'),
    review(9, 9, 'LGTM, but rename it.'),
  ];
  const conversation = [comment(10, 10, `${PR}#pullrequestreview-2: done.${REPLY}`, 'author')];
  const listed = found(t, { reviews: [[reviews]], conversation: [[conversation]] });
  assert.deepEqual(listed[0], { kind: 'review', id: 1, url: `${PR}#pullrequestreview-1`, author: 'reviewer', body: 'Two points: …' });
  assert.deepEqual(listed.map((item: { id: number }) => item.id), [1, 8, 9]);
});

test('status comments are neither review nor a reply, even when they link to a review', (t) => {
  const conversation = [
    comment(2, 2, `🔍 Code review of 4b7c28a done: ${PR}#pullrequestreview-1\n\n<!-- code-review:started -->`),
    comment(3, 3, '🛠️ Started addressing the review comments.\n\n<!-- implement-issue:started -->', 'author'),
  ];
  const listed = found(t, { reviews: [[[review(1, 1, 'One point: …')]]], conversation: [[conversation]] });
  assert.deepEqual(listed.map((item: { url: string }) => item.url), [`${PR}#pullrequestreview-1`]);
});

test('oldest first, of every kind', (t) => {
  const listed = found(t, {
    reviews: [[[review(2, 2, 'A summary.')]]],
    conversation: [[[comment(3, 3, 'A question.')]]],
    inline: [[[inline(1, 1, 'Rename this.'), inline(4, 0, 'Split this.')]]],
  });
  assert.deepEqual(listed.map((item: { id: number }) => item.id), [4, 1, 2, 3]);
});

test('every page counts', (t) => {
  const listed = found(t, {
    conversation: [[[comment(1, 1, 'A question.')], [comment(2, 2, 'Another one.')]]],
    inline: [[[inline(3, 3, 'Rename this.')], [inline(4, 4, `Renamed.${REPLY}`, 3)]]],
  });
  assert.deepEqual(listed.map((item: { id: number }) => item.id), [1, 2]);
});

test('a long answer is printed whole, through a pipe', (t) => {
  const long = Array.from({ length: 50 }, (_, i) => inline(i + 1, i, `${i} `.repeat(1000)));
  assert.equal(found(t, { inline: [[long]] }).length, 50);
});

test('waits: asks again every interval, until there is review to answer', (t) => {
  const question = comment(1, 1, 'A question.');
  const { code, stdout, stderr, calls } = waitForReview(
    t, { conversation: [[[]], [[]], [[question]]] }, ['7', '--quiet', '1', '--interval', '0.1'],
  );
  assert.equal(code, 0, stderr);
  assert.deepEqual(JSON.parse(stdout).map((item: { id: number }) => item.id), [1]);
  assert.equal(calls.filter((call) => call.endsWith(CONVERSATION)).length, 3);
});

test('waits: no review for the whole quiet period, [] and exit 2', (t) => {
  const started = Date.now();
  const { code, stdout, stderr, calls } = waitForReview(t, {}, ['7', '--quiet', '0.01', '--interval', '0.2']);
  assert.equal(code, 2);
  assert.equal(stdout, '[]\n');
  assert.equal(stderr, 'No unanswered review on #7 in 0.01 minutes.\n');
  // 0.6 seconds, asking every 0.2 seconds after each answer (how many times depends on how fast gh is).
  assert.ok(Date.now() - started >= 600);
  assert.ok(calls.filter((call) => call.endsWith(REVIEWS)).length >= 2, calls.join('\n'));
});

test('gh fails: its error, exit 1, nothing on stdout', (t) => {
  const { code, stdout, stderr } = waitForReview(t, { inline: [{ error: 'HTTP 502: Bad Gateway' }] });
  assert.equal(code, 1);
  assert.equal(stdout, '');
  assert.equal(stderr, `gh api ${INLINE} failed: HTTP 502: Bad Gateway\n`);
});

test('bad arguments: what is wrong and the usage, exit 1, GitHub never asked', (t) => {
  const usage = 'Usage: wait-for-review.ts <pr> [--quiet <minutes>] [--interval <seconds>]';
  const cases: [string[], string][] = [
    [[], 'No pull request number'],
    [['seven'], 'Not a pull request number: seven'],
    [['0'], 'Not a pull request number: 0'],
    [['7', '8'], 'Not a pull request number: 8'],
    [['7', '--quiet'], 'Not a number of minutes: '],
    [['7', '--quiet', '-1'], 'Not a number of minutes: -1'],
    [['7', '--interval', 'soon'], 'Not a number of seconds: soon'],
  ];
  for (const [args, error] of cases) {
    assert.deepEqual(waitForReview(t, {}, args), { code: 1, stdout: '', stderr: `${error}\n${usage}\n`, calls: [] }, args.join(' '));
  }
});
