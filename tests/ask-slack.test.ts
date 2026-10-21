// The implement-issue skill's ask-slack.ts (_Asking the user_ in its SKILL.md), as the skill runs it:
// the real process, with SLACK_API pointing at a fake Slack in this test.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { test, type TestContext } from 'node:test';

const SCRIPT = fileURLToPath(new URL('../.agents/skills/implement-issue/scripts/ask-slack.ts', import.meta.url));

const CHANNEL = 'C0CAS1T6YN9';
const TOKEN = 'xoxb-secret';
/** The ts of what the script posts. */
const POSTED = '1792572425.799389';
const URL_OF = (ts: string) => `https://example.slack.com/archives/${CHANNEL}/p${ts.replace('.', '')}`;

/** A message in the thread, `seconds` after the question. */
const message = (seconds: number, text: string, extra: Record<string, unknown> = {}) => ({
  ts: `${1792572425 + seconds}.000000`, user: 'U0CAFSBRH9D', type: 'message', text, ...extra,
});
const question = { ts: POSTED, user: 'U0CA95Y5YT1', bot_id: 'B0CAQBLQS3C', text: 'Which one?' };

type Page = { messages: unknown[]; response_metadata?: { next_cursor: string } };
/** A read that fails: with an HTTP status (and `Retry-After`), or with no answer at all (`status: 0`). */
type Failure = { status: number; retryAfter?: string };
/**
 * What Slack answers: for conversations.replies, each time it is read, its pages or a failure; the
 * last one repeats.
 */
type Fake = { replies?: (Page[] | Failure)[]; post?: Record<string, unknown> };
type Call = {
  method: string; authorization?: string; query: Record<string, string>; body?: Record<string, unknown>; at: number;
};

/** `ask-slack.ts <args>`, `stdin` the question, with Slack answering `fake`. */
async function ask(t: TestContext, fake: Fake, args = ['--wait', '0', '--interval', '0'], options: {
  stdin?: string; env?: Record<string, string | undefined>;
} = {}) {
  const calls: Call[] = [];
  let read = 0;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url!, 'http://localhost');
    const method = url.pathname.replace('/api/', '');
    let body: Record<string, unknown> | undefined;
    if (request.method === 'POST') {
      let raw = '';
      for await (const chunk of request) raw += chunk;
      body = JSON.parse(raw);
    }
    const query = Object.fromEntries(url.searchParams);
    calls.push({ method, authorization: request.headers.authorization, query, body, at: Date.now() });
    let answer: unknown;
    if (method === 'chat.postMessage') answer = fake.post ?? { ok: true, channel: CHANNEL, ts: POSTED };
    else if (method === 'chat.getPermalink') answer = { ok: true, permalink: URL_OF(url.searchParams.get('message_ts')!) };
    else if (method === 'conversations.replies') {
      const pages = fake.replies ?? [[{ messages: [question] }]];
      const cursor = url.searchParams.get('cursor');
      if (!cursor) read++;
      const time = pages[Math.min(read, pages.length) - 1];
      if (!Array.isArray(time)) {
        if (!time.status) return void request.socket.destroy();
        if (time.retryAfter) response.setHeader('retry-after', time.retryAfter);
        response.statusCode = time.status;
        return void response.end();
      }
      answer = { ok: true, ...time[cursor ? Number(cursor) : 0] };
    } else answer = { ok: false, error: 'unknown_method' };
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(answer));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;

  const env: Record<string, string | undefined> = {
    ...process.env, SLACK_API: `http://127.0.0.1:${port}/api`, SLACK_BOT_TOKEN: TOKEN, SLACK_CHANNEL: CHANNEL,
    ...options.env,
  };
  for (const [name, value] of Object.entries(env)) if (value === undefined) delete env[name];
  const child = spawn(process.execPath, [SCRIPT, ...args], { env });
  child.stdin.end(options.stdin ?? 'Which one?\n1. A (recommended)\n2. B\n');
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => (stdout += chunk));
  child.stderr.on('data', (chunk) => (stderr += chunk));
  const code = await new Promise<number | null>((resolve) => child.on('close', resolve));
  return { code, stdout, stderr, calls, read };
}

/** What it got, when it got an answer. */
async function answered(t: TestContext, fake: Fake, args?: string[]) {
  const done = await ask(t, fake, args);
  assert.equal(done.code, 0, done.stderr);
  assert.equal(done.stderr, '');
  return { ...done, asked: JSON.parse(done.stdout) };
}

test('posts the question to SLACK_CHANNEL as the bot of SLACK_BOT_TOKEN and prints the answer in its thread', async (t) => {
  const { asked, calls } = await answered(t, { replies: [[{ messages: [question, message(20, 'B')] }]] });
  assert.deepEqual(asked, {
    channel: CHANNEL, thread: POSTED, question: POSTED, url: URL_OF(POSTED),
    answers: [{ author: 'U0CAFSBRH9D', text: 'B', ts: '1792572445.000000' }],
  });
  assert.deepEqual(calls.map((call) => call.method), ['chat.postMessage', 'chat.getPermalink', 'conversations.replies']);
  assert.ok(calls.every((call) => call.authorization === `Bearer ${TOKEN}`));
  assert.deepEqual(calls[0].body, { channel: CHANNEL, text: 'Which one?\n1. A (recommended)\n2. B' });
  assert.deepEqual(calls[2].query, { channel: CHANNEL, ts: POSTED, oldest: POSTED, limit: '200' });
});

test('waits, reading the thread every interval, until a person answers; the question and bots are no answer', async (t) => {
  const bot = message(5, 'I am a bot', { bot_id: 'B1', user: 'U1' });
  const join = message(6, '<@U2> has joined the channel', { subtype: 'channel_join', user: 'U2' });
  const { asked, read } = await answered(t, {
    replies: [[{ messages: [question] }], [{ messages: [question, bot, join] }], [{ messages: [question, bot, join, message(30, 'A')] }]],
  }, ['--wait', '1', '--interval', '0.05']);
  assert.equal(read, 3);
  assert.deepEqual(asked.answers.map((answer: { text: string }) => answer.text), ['A']);
});

test('every answer by then, of anyone, oldest first, from every page; a reply also sent to the channel counts', async (t) => {
  const pages = [
    { messages: [question, message(40, 'and the README too')], response_metadata: { next_cursor: '1' } },
    { messages: [message(10, 'B', { user: 'U3', subtype: 'thread_broadcast' })] },
  ];
  const { asked, calls } = await answered(t, { replies: [pages] });
  assert.deepEqual(asked.answers, [
    { author: 'U3', text: 'B', ts: '1792572435.000000' },
    { author: 'U0CAFSBRH9D', text: 'and the README too', ts: '1792572465.000000' },
  ]);
  assert.equal(calls.at(-1)!.query.cursor, '1');
});

test('the text of an answer as written: Slack’s escapes undone', async (t) => {
  const { asked } = await answered(t, { replies: [[{ messages: [question, message(1, 'a &lt;b&gt; &amp;amp; c')] }]] });
  assert.equal(asked.answers[0].text, 'a <b> &amp; c');
});

test('--thread: a follow-up in the thread of an earlier question, answered by what comes after it only', async (t) => {
  const earlier = '1792570000.000001';
  const fake = {
    post: { ok: true, channel: CHANNEL, ts: POSTED },
    replies: [[{ messages: [{ ...question, ts: earlier }, message(-100, 'an earlier answer'), question, message(3, 'C')] }]],
  };
  const { asked, calls } = await answered(t, fake, ['--thread', earlier, '--wait', '0', '--interval', '0']);
  assert.deepEqual(calls[0].body, { channel: CHANNEL, text: 'Which one?\n1. A (recommended)\n2. B', thread_ts: earlier });
  assert.deepEqual(calls[2].query, { channel: CHANNEL, ts: earlier, oldest: POSTED, limit: '200' });
  assert.equal(asked.thread, earlier);
  assert.equal(asked.question, POSTED);
  assert.equal(asked.url, URL_OF(POSTED));
  assert.deepEqual(asked.answers.map((answer: { text: string }) => answer.text), ['C']);
});

test('no answer in the wait: where the question is, no answers, and exit 2', async (t) => {
  const { code, stdout, stderr, read } = await ask(t, {}, ['--wait', '0.002', '--interval', '0.05']);
  assert.equal(code, 2);
  assert.deepEqual(JSON.parse(stdout), { channel: CHANNEL, thread: POSTED, question: POSTED, url: URL_OF(POSTED), answers: [] });
  assert.equal(stderr, `No answer in 0.002 minutes: ${URL_OF(POSTED)}\n`);
  assert.ok(read >= 2, `read ${read} times`);
});

test('--after: waits on a question already posted, posting nothing, for what comes after it', async (t) => {
  const earlier = '1792570000.000001';
  const fake = { replies: [[{ messages: [{ ...question, ts: earlier }, message(-100, 'an earlier answer'), question, message(3, 'C')] }]] };
  const done = await ask(t, fake, ['--thread', earlier, '--after', POSTED, '--wait', '0', '--interval', '0'], { stdin: '' });
  assert.equal(done.code, 0, done.stderr);
  assert.deepEqual(done.calls.map((call) => call.method), ['chat.getPermalink', 'conversations.replies']);
  assert.deepEqual(JSON.parse(done.stdout), {
    channel: CHANNEL, thread: earlier, question: POSTED, url: URL_OF(POSTED),
    answers: [{ author: 'U0CAFSBRH9D', text: 'C', ts: '1792572428.000000' }],
  });
});

test('a read that fails for a while is tried again, after the Retry-After Slack asks for: the wait goes on', async (t) => {
  const fake = {
    replies: [{ status: 429, retryAfter: '1' }, { status: 503 }, { status: 0 }, [{ messages: [question, message(9, 'A')] }]],
  };
  const { code, stdout, stderr, calls } = await ask(t, fake, ['--wait', '1', '--interval', '0.05']);
  assert.equal(code, 0, stderr);
  assert.deepEqual(JSON.parse(stdout).answers.map((answer: { text: string }) => answer.text), ['A']);
  const lines = stderr.trimEnd().split('\n');
  assert.deepEqual(lines.slice(0, 2), [
    'Slack conversations.replies failed: HTTP 429; reading again',
    'Slack conversations.replies failed: HTTP 503; reading again',
  ]);
  assert.match(lines[2], /^Slack conversations\.replies failed: .+; reading again$/);
  assert.equal(lines.length, 3);
  const reads = calls.filter((call) => call.method === 'conversations.replies').map((call) => call.at);
  assert.equal(reads.length, 4);
  assert.ok(reads[1] - reads[0] >= 1000, `read again after ${reads[1] - reads[0]} ms`);
  assert.ok(reads[2] - reads[1] < 1000, `read again after ${reads[2] - reads[1]} ms`);
});

test('a read that keeps failing to the end of the wait: no answer, exit 2', async (t) => {
  const { code, stdout, stderr } = await ask(t, { replies: [{ status: 502 }] });
  assert.equal(code, 2);
  assert.deepEqual(JSON.parse(stdout).answers, []);
  assert.equal(stderr, `Slack conversations.replies failed: HTTP 502; reading again\nNo answer in 0 minutes: ${URL_OF(POSTED)}\n`);
});

test('a failure that does not pass, on a read too: its error, and exit 1', async (t) => {
  for (const [replies, error] of [[[{ status: 403 }], 'HTTP 403'], [[[{ ok: false, error: 'invalid_auth' } as unknown as Page]], 'invalid_auth']] as const) {
    const { code, stdout, stderr } = await ask(t, { replies: [...replies] as Fake['replies'] }, ['--wait', '1', '--interval', '0.05']);
    assert.equal(code, 1);
    assert.equal(stdout, '');
    assert.equal(stderr, `Slack conversations.replies failed: ${error}\n`);
  }
});

test('what Slack refuses: its error, and exit 1', async (t) => {
  const { code, stdout, stderr } = await ask(t, { post: { ok: false, error: 'not_in_channel' } });
  assert.equal(code, 1);
  assert.equal(stdout, '');
  assert.equal(stderr, 'Slack chat.postMessage failed: not_in_channel\n');
});

test('no token, no channel, a channel name for its ID, no question: what is wrong, and nothing posted', async (t) => {
  const cases: [Parameters<typeof ask>[3], string][] = [
    [{ env: { SLACK_BOT_TOKEN: undefined } }, 'SLACK_BOT_TOKEN is not set'],
    [{ env: { SLACK_CHANNEL: '' } }, 'SLACK_CHANNEL is not set'],
    [{ env: { SLACK_CHANNEL: '#ai-workshop' } }, 'SLACK_CHANNEL is not a channel ID (C…, in the channel\'s details in Slack): #ai-workshop'],
    [{ stdin: ' \n' }, 'No question on stdin'],
  ];
  for (const [options, error] of cases) {
    const { code, stderr, calls } = await ask(t, {}, undefined, options);
    assert.equal(code, 1, error);
    assert.equal(stderr.split('\n')[0], error);
    assert.deepEqual(calls, []);
  }
});

test('bad arguments: the usage, and exit 1', async (t) => {
  const usage = 'Usage: ask-slack.ts [--thread <ts>] [--wait <minutes: 60>] [--interval <seconds: 30>] < question\n'
    + '       ask-slack.ts --thread <ts> --after <question ts> [--wait <minutes>] [--interval <seconds>]';
  for (const [args, error] of [
    [['--wait', '-1'], 'Not a number of minutes: -1'],
    [['--interval'], 'Not a number of seconds: '],
    [['--thread', 'yesterday'], 'Not a Slack message ts: yesterday'],
    [['--after', POSTED], '--after needs the --thread of the question'],
    [['42'], 'Unknown argument: 42'],
  ] as const) {
    const { code, stderr, calls } = await ask(t, {}, [...args]);
    assert.equal(code, 1);
    assert.equal(stderr, `${error}\n${usage}\n`);
    assert.deepEqual(calls, []);
  }
});
