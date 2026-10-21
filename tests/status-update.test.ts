// The status-update skill's status-update.ts (its SKILL.md), as the skill runs it: the real process,
// with `gh` on the PATH answering from tests/fake-gh.ts and SLACK_API pointing at a fake Slack.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type TestContext } from 'node:test';
import type { Answer, Answers } from './fake-gh.ts';

const SCRIPT = fileURLToPath(new URL('../.agents/skills/status-update/scripts/status-update.ts', import.meta.url));
const FAKE_GH = fileURLToPath(new URL('./fake-gh.ts', import.meta.url));

const REPO = 'Undin/example';
const CHANNEL = 'C0CAS1T6YN9';
const TOKEN = 'xoxb-secret';
const SINCE = '2026-10-14T00:00:00Z';
const AT = '2026-10-14T00:00:00+00:00';
const CLOSED = `q=repo:${REPO} is:issue is:closed closed:>=${AT}`;
const PROGRESS = `q=repo:${REPO} is:issue is:open linked:pr`;
const CREATED = `q=repo:${REPO} is:pr created:>=${AT}`;
const MERGED = `q=repo:${REPO} is:pr merged:>=${AT}`;
const POSTED = '1792572425.799389';

const url = (kind: string, number: number) => `https://github.com/${REPO}/${kind}/${number}`;
/** A pull request: merged by default, created on the 15th. */
const pull = (number: number, extra: Record<string, unknown> = {}) => ({
  number, title: `Pull ${number}`, url: url('pull', number), state: 'MERGED', isDraft: false,
  createdAt: '2026-10-15T10:00:00Z', mergedAt: '2026-10-16T10:00:00Z', author: { login: 'alice' }, ...extra,
});
/** An issue: closed on the 16th as completed, by `pulls`. */
const issue = (number: number, pulls: unknown[], extra: Record<string, unknown> = {}) => ({
  number, title: `Issue ${number}`, url: url('issues', number), state: 'CLOSED', stateReason: 'COMPLETED',
  closedAt: '2026-10-16T10:00:00Z', closedByPullRequestsReferences: { nodes: pulls }, ...extra,
});
/** A page of a search: the last unless `next` names the cursor of the next one. */
const page = (nodes: unknown[], next?: string) => ({
  data: { search: { pageInfo: { hasNextPage: !!next, endCursor: next ?? null }, nodes } },
});
const EMPTY: Answers = { [CLOSED]: [page([])], [PROGRESS]: [page([])], [CREATED]: [page([])], [MERGED]: [page([])] };

type Call = { method: string; authorization?: string; query: Record<string, string>; body?: Record<string, unknown> };
/** What Slack answers to chat.postMessage, each time; the last one repeats. */
type Post = { status?: number; retryAfter?: string; answer?: Record<string, unknown> };

/** A fake Slack: its calls, and its API's URL. */
async function fakeSlack(t: TestContext, posts: Post[] = [{}]) {
  const calls: Call[] = [];
  let posted = 0;
  const server = createServer(async (request, response) => {
    const address = new URL(request.url!, 'http://localhost');
    const method = address.pathname.replace('/api/', '');
    let body: Record<string, unknown> | undefined;
    if (request.method === 'POST') {
      let raw = '';
      for await (const chunk of request) raw += chunk;
      body = JSON.parse(raw);
    }
    calls.push({ method, authorization: request.headers.authorization, query: Object.fromEntries(address.searchParams), body });
    let answer: unknown;
    if (method === 'chat.postMessage') {
      const post = posts[Math.min(posted++, posts.length - 1)];
      if (post.status) {
        if (post.retryAfter) response.setHeader('retry-after', post.retryAfter);
        response.statusCode = post.status;
        return void response.end();
      }
      answer = post.answer ?? { ok: true, channel: CHANNEL, ts: `${1792572425 + posted - 1}.799389` };
    } else if (method === 'chat.getPermalink') {
      answer = { ok: true, permalink: `https://example.slack.com/archives/${CHANNEL}/p${address.searchParams.get('message_ts')!.replace('.', '')}` };
    } else answer = { ok: false, error: 'unknown_method' };
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(answer));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return { calls, api: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api` };
}

/** `status-update.ts <args>` with GitHub answering `answers` and Slack at `slack`. */
async function statusUpdate(t: TestContext, answers: Answers, args: string[], options: {
  slack?: string; env?: Record<string, string | undefined>;
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'status-update-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'gh'), `#!/bin/sh\nexec "${process.execPath}" "${FAKE_GH}" "$@"\n`);
  chmodSync(join(dir, 'gh'), 0o755);
  const file = join(dir, 'answers.json');
  writeFileSync(file, JSON.stringify({ nameWithOwner: [{ nameWithOwner: REPO }], ...answers }));
  const env: Record<string, string | undefined> = {
    ...process.env, PATH: `${dir}${delimiter}${process.env.PATH}`, FAKE_GH: file,
    SLACK_API: options.slack ?? 'http://127.0.0.1:9/api', SLACK_BOT_TOKEN: TOKEN, SLACK_CHANNEL: CHANNEL, ...options.env,
  };
  for (const [name, value] of Object.entries(env)) if (value === undefined) delete env[name];
  const child = spawn(process.execPath, [SCRIPT, ...args], { env });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => (stdout += chunk));
  child.stderr.on('data', (chunk) => (stderr += chunk));
  const code = await new Promise<number | null>((resolve) => child.on('close', resolve));
  const log = existsSync(`${file}.log`) ? readFileSync(`${file}.log`, 'utf8') : '';
  return { code, stdout, stderr, log };
}

/** Every search `gh` was asked, in order. */
const searches = (log: string) => [...log.matchAll(/ -f (q=.*)$/gm)].map((match) => match[1]);

test('the update: closed issues with their pull requests, the ones in progress, every other pull request once', async (t) => {
  const answers: Answers = {
    [CLOSED]: [page([
      issue(12, [pull(14), pull(13, { state: 'CLOSED', mergedAt: null, author: null })]),
      issue(11, [], { stateReason: 'NOT_PLANNED', title: 'Fix <script> & "quotes"' }),
      // Closed before the start: GitHub's search is less precise than the script.
      issue(10, [pull(9)], { closedAt: '2026-10-13T23:59:59Z' }),
    ])],
    [PROGRESS]: [page([
      issue(20, [pull(22, { state: 'OPEN', isDraft: true, mergedAt: null }), pull(21)], { state: 'OPEN', stateReason: null, closedAt: null }),
      // Only a merged pull request linked: not in progress.
      issue(23, [pull(24)], { state: 'OPEN', stateReason: null, closedAt: null }),
    ])],
    [CREATED]: [page([pull(14), pull(22, { state: 'OPEN', isDraft: true, mergedAt: null }), pull(31, { state: 'OPEN', mergedAt: null }), pull(30)])],
    [MERGED]: [page([
      pull(30), pull(24),
      pull(25, { createdAt: '2026-10-01T10:00:00Z', mergedAt: '2026-10-14T00:00:00Z', author: { login: 'bob' } }),
      pull(26, { createdAt: '2026-10-01T10:00:00Z', mergedAt: '2026-10-13T10:00:00Z' }),
    ])],
  };
  const result = await statusUpdate(t, answers, ['--since', SINCE, '--dry-run']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, `*Status update: <https://github.com/${REPO}|${REPO}>*, since 2026-10-14 00:00 UTC

*Closed issues (2)*
• <${url('issues', 11)}|#11> Fix &lt;script&gt; &amp; "quotes" (not planned): no pull request
• <${url('issues', 12)}|#12> Issue 12: <${url('pull', 13)}|#13> by @ghost, closed; <${url('pull', 14)}|#14> by @alice, merged

*In progress (1)*
• <${url('issues', 20)}|#20> Issue 20: <${url('pull', 22)}|#22> by @alice, draft

*Other pull requests (4)*
• <${url('pull', 24)}|#24> Pull 24 by @alice, merged
• <${url('pull', 25)}|#25> Pull 25 by @bob, merged
• <${url('pull', 30)}|#30> Pull 30 by @alice, merged
• <${url('pull', 31)}|#31> Pull 31 by @alice, open
`);
  assert.deepEqual(searches(result.log), [CLOSED, PROGRESS, CREATED, MERGED]);
  assert.match(result.log, /^repo view --json nameWithOwner$/m, 'the repository of the checkout');
});

test('nothing happened: each section says None', async (t) => {
  const result = await statusUpdate(t, EMPTY, ['--since', SINCE, '--dry-run']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout.split('\n\n').slice(1).join('\n\n'), `*Closed issues (0)*
_None_

*In progress (0)*
_None_

*Other pull requests (0)*
_None_
`);
});

test('every page of a search', async (t) => {
  const result = await statusUpdate(t, {
    ...EMPTY, [CREATED]: [page([pull(1)], 'Y3Vyc29yOjE='), page([pull(2)], 'Y3Vyc29yOjI='), page([pull(3)])],
  }, ['--since', SINCE, '--dry-run']);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /\*Other pull requests \(3\)\*\n• .*#1>.*\n• .*#2>.*\n• .*#3>/);
  const pages = result.log.split('\n').filter((line) => line.endsWith(CREATED));
  assert.equal(pages.length, 3);
  assert.doesNotMatch(pages[0], / -f after=/);
  assert.match(pages[1], / -f after=Y3Vyc29yOjE= /);
  assert.match(pages[2], / -f after=Y3Vyc29yOjI= /);
});

test('--repo: that repository, the checkout is not asked', async (t) => {
  const other = 'JetBrains/kotlin';
  const result = await statusUpdate(t, {
    [`q=repo:${other} is:issue is:closed closed:>=${AT}`]: [page([])], [`q=repo:${other} is:issue is:open linked:pr`]: [page([])],
    [`q=repo:${other} is:pr created:>=${AT}`]: [page([])], [`q=repo:${other} is:pr merged:>=${AT}`]: [page([])],
  }, ['--since', SINCE, '--repo', other, '--dry-run']);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^\*Status update: <https:\/\/github\.com\/JetBrains\/kotlin\|JetBrains\/kotlin>\*/);
  assert.doesNotMatch(result.log, /repo view/);
});

test('a date alone: its midnight in the local time zone; a time with its offset', async (t) => {
  const tokyo = await statusUpdate(t, {}, ['--since', '2026-10-14', '--dry-run'], { env: { TZ: 'Asia/Tokyo' } });
  assert.equal(searches(tokyo.log)[0], `q=repo:${REPO} is:issue is:closed closed:>=2026-10-13T15:00:00+00:00`);
  const offset = await statusUpdate(t, {}, ['--since', '2026-10-14T09:30+02:00', '--dry-run']);
  assert.equal(searches(offset.log)[0], `q=repo:${REPO} is:issue is:closed closed:>=2026-10-14T07:30:00+00:00`);
});

test('posted to SLACK_CHANNEL as the bot of SLACK_BOT_TOKEN: its link printed, previews of links off', async (t) => {
  const slack = await fakeSlack(t);
  const result = await statusUpdate(t, { ...EMPTY, [CREATED]: [page([pull(30)])] }, ['--since', SINCE], { slack: slack.api });
  assert.equal(result.code, 0, result.stderr);
  const [message, link] = result.stdout.split('\n\nPosted: ');
  assert.equal(link, `https://example.slack.com/archives/${CHANNEL}/p${POSTED.replace('.', '')}\n`);
  assert.deepEqual(slack.calls.map((call) => call.method), ['chat.postMessage', 'chat.getPermalink']);
  assert.deepEqual(slack.calls[0].body, { channel: CHANNEL, text: message.trim(), unfurl_links: false, unfurl_media: false });
  assert.ok(slack.calls.every((call) => call.authorization === `Bearer ${TOKEN}`));
  assert.deepEqual(slack.calls[1].query, { channel: CHANNEL, message_ts: POSTED });
});

test('an update too long for one message: cut between lines, the rest in its thread', async (t) => {
  const slack = await fakeSlack(t);
  const many = Array.from({ length: 60 }, (_, i) => pull(100 + i, { title: 'x'.repeat(100) }));
  const result = await statusUpdate(t, { ...EMPTY, [CREATED]: [page(many)] }, ['--since', SINCE], { slack: slack.api });
  assert.equal(result.code, 0, result.stderr);
  const posts = slack.calls.filter((call) => call.method === 'chat.postMessage').map((call) => call.body!);
  assert.equal(posts.length, 3);
  assert.ok(posts.every((post) => (post.text as string).length <= 3900));
  assert.equal(posts[0].thread_ts, undefined);
  assert.deepEqual(posts.slice(1).map((post) => post.thread_ts), [POSTED, POSTED]);
  const lines = (text: string) => text.split('\n').filter(Boolean);
  assert.deepEqual(posts.flatMap((post) => lines(post.text as string)), lines(result.stdout.split('\n\nPosted: ')[0]));
  assert.match(result.stdout, new RegExp(`Posted: .*/p${POSTED.replace('.', '')}\n$`));
});

test("Slack's rate limit: posted again after the wait it asks for", async (t) => {
  const slack = await fakeSlack(t, [{ status: 429, retryAfter: '0' }, {}]);
  const result = await statusUpdate(t, EMPTY, ['--since', SINCE], { slack: slack.api });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(slack.calls.filter((call) => call.method === 'chat.postMessage').length, 2);
});

test('Slack refuses: its reason, exit 1; a bot not in the channel is told to be invited', async (t) => {
  const slack = await fakeSlack(t, [{ answer: { ok: false, error: 'not_in_channel' } }]);
  const result = await statusUpdate(t, EMPTY, ['--since', SINCE], { slack: slack.api });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /^Slack chat\.postMessage failed: not_in_channel \(invite the bot to the channel: \/invite @<bot>\)$/m);
  const limited = await fakeSlack(t, [{ status: 429, retryAfter: '0' }]);
  const again = await statusUpdate(t, EMPTY, ['--since', SINCE], { slack: limited.api });
  assert.equal(again.code, 1);
  assert.match(again.stderr, /^Slack chat\.postMessage failed: HTTP 429$/m);
  assert.equal(limited.calls.length, 3, 'three attempts');
});

test('no Slack token or no channel ID: exit 1 before GitHub is asked; a dry run needs neither', async (t) => {
  const cases: [Record<string, string | undefined>, RegExp][] = [
    [{ SLACK_BOT_TOKEN: undefined }, /^SLACK_BOT_TOKEN is not set$/m],
    [{ SLACK_CHANNEL: '' }, /^SLACK_CHANNEL is not set$/m],
    [{ SLACK_CHANNEL: '#general' }, /^SLACK_CHANNEL is not a channel ID \(C…, in the channel's details in Slack\): #general$/m],
  ];
  for (const [env, error] of cases) {
    const result = await statusUpdate(t, EMPTY, ['--since', SINCE], { env });
    assert.equal(result.code, 1, JSON.stringify(env));
    assert.match(result.stderr, error);
    assert.equal(result.log, '', 'GitHub is not asked');
  }
  const dry = await statusUpdate(t, EMPTY, ['--since', SINCE, '--dry-run'], { env: { SLACK_BOT_TOKEN: undefined, SLACK_CHANNEL: undefined } });
  assert.equal(dry.code, 0, dry.stderr);
});

test('GitHub fails: what gh said, exit 1, nothing posted', async (t) => {
  const slack = await fakeSlack(t);
  const failure: Answer = { error: 'HTTP 401: Bad credentials' };
  const result = await statusUpdate(t, { ...EMPTY, [PROGRESS]: [failure] }, ['--since', SINCE], { slack: slack.api });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /^gh api graphql failed: HTTP 401: Bad credentials$/m);
  assert.equal(slack.calls.length, 0);
});

test('wrong arguments: what is wrong and the usage, exit 1', async (t) => {
  const cases: [string[], RegExp][] = [
    [[], /^--since is required$/m],
    [['--since'], /^Not a date and time: $/m],
    [['--since', 'yesterday'], /^Not a date and time: yesterday$/m],
    [['--since', '2026-13-45'], /^Not a date and time: 2026-13-45$/m],
    [['--since', '2999-01-01'], /^In the future: 2999-01-01$/m],
    [['--since', SINCE, '--repo', 'kotlin'], /^Not a repository, <owner>\/<name>: kotlin$/m],
    [['--since', SINCE, '--verbose'], /^Unknown argument: --verbose$/m],
  ];
  for (const [args, error] of cases) {
    const result = await statusUpdate(t, EMPTY, args);
    assert.equal(result.code, 1, args.join(' '));
    assert.match(result.stderr, error, args.join(' '));
    assert.match(result.stderr, /^Usage: status-update\.ts --since /m);
    assert.equal(result.log, '');
  }
});
