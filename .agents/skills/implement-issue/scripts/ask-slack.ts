#!/usr/bin/env node
// _Asking the user_ in ../SKILL.md, when no one is at the session: posts the question read from stdin
// to the Slack channel SLACK_CHANNEL (its ID) as the bot of SLACK_BOT_TOKEN, or into the thread of an
// earlier one (`--thread`), then reads the thread every interval until someone who is no bot answers
// (their messages printed as JSON, exit 0) or the wait passes without an answer (exit 2). With
// `--after`, it posts nothing and waits on a question already posted. Exit 1: an error.
import { text } from 'node:stream/consumers';
import { setTimeout as sleep } from 'node:timers/promises';

/** How long to wait for an answer (`--wait`). */
const WAIT_MINUTES = 60;
/** How often to read the thread (`--interval`). */
const INTERVAL_SECONDS = 30;
const USAGE = `Usage: ask-slack.ts [--thread <ts>] [--wait <minutes: ${WAIT_MINUTES}>] [--interval <seconds: ${INTERVAL_SECONDS}>] < question
       ask-slack.ts --thread <ts> --after <question ts> [--wait <minutes>] [--interval <seconds>]`;
/** Slack's Web API; another one in tests. */
const API = process.env.SLACK_API || 'https://slack.com/api';

type Message = { ts: string; user?: string; bot_id?: string; subtype?: string; text?: string };
type Answer = { author: string; text: string; ts: string };
/** What the script prints: where the question is, and what was answered to it. */
type Asked = { channel: string; thread: string; question: string; url: string; answers: Answer[] };

/** What Slack's `method` answers, when it says ok. */
async function slack<T>(token: string, method: string, query: Record<string, string>, body?: object): Promise<T> {
  const url = `${API}/${method}${body ? '' : `?${new URLSearchParams(query)}`}`;
  const response = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json; charset=utf-8' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(`Slack ${method} failed: HTTP ${response.status}`);
  const answer = (await response.json()) as { ok: boolean; error?: string } & T;
  if (!answer.ok) throw new Error(`Slack ${method} failed: ${answer.error ?? 'no reason given'}`);
  return answer;
}

/** A message's ts as a number to compare: `1792572444.850259`, always six decimals. */
const order = (ts: string) => BigInt(ts.replace('.', ''));
// Slack escapes these three in a message's text, and nothing else.
const unescape = (text: string) => text.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');

/** What people, not bots, wrote in `thread` after the message `after`, oldest first: every page. */
async function answers(token: string, channel: string, thread: string, after: string): Promise<Answer[]> {
  const found: Message[] = [];
  let cursor = '';
  do {
    const query = { channel, ts: thread, oldest: after, limit: '200', ...(cursor ? { cursor } : {}) };
    const page = await slack<{ messages: Message[]; response_metadata?: { next_cursor?: string } }>(
      token, 'conversations.replies', query,
    );
    found.push(...page.messages);
    cursor = page.response_metadata?.next_cursor ?? '';
  } while (cursor);
  // A thread broadcast to the channel too is still an answer; joins and other events are not.
  return found
    .filter((message) => order(message.ts) > order(after) && !message.bot_id && message.user)
    .filter((message) => !message.subtype || message.subtype === 'thread_broadcast')
    .sort((a, b) => (order(a.ts) < order(b.ts) ? -1 : 1))
    .map((message) => ({ author: message.user!, text: unescape(message.text ?? ''), ts: message.ts }));
}

/** A number of `what` from the command line: not negative. */
function amount(text: string | undefined, what: string): number {
  const value = Number(text);
  if (!text?.trim() || !Number.isFinite(value) || value < 0) {
    throw new Error(`Not a number of ${what}: ${text ?? ''}`);
  }
  return value;
}

/** A Slack message's ts from the command line. */
function ts(text: string | undefined): string {
  if (!/^\d+\.\d{6}$/.test(text ?? '')) throw new Error(`Not a Slack message ts: ${text ?? ''}`);
  return text!;
}

function parse(args: string[]) {
  let thread: string | undefined;
  let after: string | undefined;
  let wait = WAIT_MINUTES;
  let interval = INTERVAL_SECONDS;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--wait') wait = amount(args[++i], 'minutes');
    else if (arg === '--interval') interval = amount(args[++i], 'seconds');
    else if (arg === '--thread') thread = ts(args[++i]);
    else if (arg === '--after') after = ts(args[++i]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (after && !thread) throw new Error('--after needs the --thread of the question');
  return { thread, after, wait, interval };
}

/** The environment the script needs: the token, and the channel's ID, not its name. */
function environment() {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_CHANNEL;
  if (!token) throw new Error('SLACK_BOT_TOKEN is not set');
  if (!channel) throw new Error('SLACK_CHANNEL is not set');
  if (!/^[CG][A-Z0-9]+$/.test(channel)) {
    throw new Error(`SLACK_CHANNEL is not a channel ID (C…, in the channel's details in Slack): ${channel}`);
  }
  return { token, channel };
}

/** What the script exits with, having printed what it got. */
async function main(args: string[]): Promise<number> {
  let options: ReturnType<typeof parse>;
  try {
    options = parse(args);
  } catch (error) {
    console.error(`${(error as Error).message}\n${USAGE}`);
    return 1;
  }
  const { thread, after, wait, interval } = options;
  let asked: Asked;
  try {
    const { token, channel } = environment();
    let question = after;
    if (!question) {
      const said = (await text(process.stdin)).trim();
      if (!said) throw new Error(`No question on stdin\n${USAGE}`);
      const posted = await slack<{ ts: string }>(token, 'chat.postMessage', {}, {
        channel, text: said, ...(thread ? { thread_ts: thread } : {}),
      });
      question = posted.ts;
    }
    const link = await slack<{ permalink: string }>(token, 'chat.getPermalink', { channel, message_ts: question });
    asked = { channel, thread: thread ?? question, question, url: link.permalink, answers: [] };

    const deadline = Date.now() + wait * 60_000;
    // Once the interval after posting, then every interval, the last time when the wait ends.
    for (;;) {
      const left = deadline - Date.now();
      await sleep(Math.max(0, Math.min(interval * 1000, left)));
      asked.answers = await answers(token, channel, asked.thread, question);
      if (asked.answers.length) {
        console.log(JSON.stringify(asked, null, 2));
        return 0;
      }
      if (left <= interval * 1000) break;
    }
  } catch (error) {
    console.error((error as Error).message);
    return 1;
  }
  console.log(JSON.stringify(asked, null, 2));
  console.error(`No answer in ${wait} minutes: ${asked.url}`);
  return 2;
}

// Not process.exit(): it would cut what is still being written to a pipe.
process.exitCode = await main(process.argv.slice(2));
