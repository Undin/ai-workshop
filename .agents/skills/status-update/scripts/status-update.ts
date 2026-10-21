#!/usr/bin/env node
// The status-update skill (../SKILL.md): what happened in the repository since a date and time, from
// GitHub through `gh api graphql`, as one Slack message posted to the channel SLACK_CHANNEL (its ID)
// as the bot of SLACK_BOT_TOKEN. Three sections: the issues closed since, each with the pull requests
// that closed it; the issues in progress, open with an open pull request linked; every other pull
// request created or merged since. With `--dry-run`, it prints the message and posts nothing. Exit 1:
// an error.
import { execFile } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';

const USAGE = 'Usage: status-update.ts --since <YYYY-MM-DD | YYYY-MM-DDTHH:MM[:SS][Z | ±HH:MM]> [--repo <owner/name>] [--dry-run]';
/** Slack's Web API; another one in tests. */
const API = process.env.SLACK_API || 'https://slack.com/api';
/** The longest message Slack shows whole; a longer update goes on in its thread. */
const MESSAGE_LENGTH = 3900;
/** How many times to post when Slack's rate limit stops it. */
const ATTEMPTS = 3;

type Author = { login: string } | null;
type Pull = {
  number: number; title: string; url: string; state: 'OPEN' | 'CLOSED' | 'MERGED'; isDraft: boolean;
  createdAt: string; mergedAt: string | null; author: Author;
};
type Issue = {
  number: number; title: string; url: string; state: 'OPEN' | 'CLOSED'; stateReason: string | null;
  closedAt: string | null; closedByPullRequestsReferences: { nodes: Pull[] };
};
type Page<T> = { data: { search: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: T[] } } };
/** What the update says. */
type Update = { repo: string; since: Date; closed: Issue[]; progress: Issue[]; pulls: Pull[] };

const PULL = 'number title url state isDraft createdAt mergedAt author { login }';
// One line: tests/fake-gh.ts logs each call on a line.
const QUERY = `query($q: String!, $after: String) {
  search(query: $q, type: ISSUE, first: 100, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on Issue { number title url state stateReason closedAt
        closedByPullRequestsReferences(first: 20, includeClosedPrs: true) { nodes { ${PULL} } } }
      ... on PullRequest { ${PULL} }
    }
  }
}`.replace(/\s+/g, ' ');

const run = promisify(execFile);

/** What `gh <args>` prints, parsed. */
async function gh<T>(args: string[]): Promise<T> {
  try {
    const { stdout } = await run('gh', args, { maxBuffer: 2 ** 28 });
    return JSON.parse(stdout) as T;
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new Error(`gh ${args[0]} ${args[1]} failed${stderr ? `: ${stderr}` : ''}`);
  }
}

/** Every issue or pull request GitHub's search finds for `q`: every page. */
async function search<T>(q: string): Promise<T[]> {
  const found: T[] = [];
  let after: string | null = null;
  do {
    // The search last: tests/fake-gh.ts answers by the last argument.
    const page: Page<T> = await gh(['api', 'graphql', '-f', `query=${QUERY}`, ...(after ? ['-f', `after=${after}`] : []), '-f', `q=${q}`]);
    found.push(...page.data.search.nodes);
    after = page.data.search.pageInfo.hasNextPage ? page.data.search.pageInfo.endCursor : null;
  } while (after);
  return found;
}

const byNumber = (a: { number: number }, b: { number: number }) => a.number - b.number;
const since = (date: Date) => (at: string | null) => !!at && new Date(at) >= date;

/** What happened in `repo` since `date`. */
async function collect(repo: string, date: Date): Promise<Update> {
  // GitHub's search takes a time with its offset; it is checked again here, to the second.
  const at = `${date.toISOString().slice(0, 19)}+00:00`;
  const after = since(date);
  const closed = (await search<Issue>(`repo:${repo} is:issue is:closed closed:>=${at}`))
    .filter((issue) => after(issue.closedAt));
  const progress = (await search<Issue>(`repo:${repo} is:issue is:open linked:pr`))
    .map((issue) => ({
      ...issue,
      closedByPullRequestsReferences: { nodes: issue.closedByPullRequestsReferences.nodes.filter((pull) => pull.state === 'OPEN') },
    }))
    .filter((issue) => issue.closedByPullRequestsReferences.nodes.length);
  // Every pull request of the window is in the update once: under its issue, or here.
  const shown = new Set([...closed, ...progress].flatMap((issue) => issue.closedByPullRequestsReferences.nodes.map((pull) => pull.url)));
  const pulls = new Map<string, Pull>();
  for (const q of [`repo:${repo} is:pr created:>=${at}`, `repo:${repo} is:pr merged:>=${at}`]) {
    for (const pull of await search<Pull>(q)) {
      if ((after(pull.createdAt) || after(pull.mergedAt)) && !shown.has(pull.url)) pulls.set(pull.url, pull);
    }
  }
  return { repo, since: date, closed: closed.sort(byNumber), progress: progress.sort(byNumber), pulls: [...pulls.values()].sort(byNumber) };
}

// Slack takes these three escaped in a message's text, and nothing else.
const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const link = (item: { url: string; number: number }) => `<${item.url}|#${item.number}>`;
const state = (pull: Pull) => (pull.state === 'MERGED' ? 'merged' : pull.state === 'CLOSED' ? 'closed' : pull.isDraft ? 'draft' : 'open');
const by = (pull: Pull) => `by @${pull.author?.login ?? 'ghost'}, ${state(pull)}`;
const REASONS: Record<string, string> = { NOT_PLANNED: 'not planned', DUPLICATE: 'duplicate' };

function issueLine(issue: Issue): string {
  const reason = REASONS[issue.stateReason ?? ''];
  const pulls = issue.closedByPullRequestsReferences.nodes.sort(byNumber);
  const closedBy = pulls.length ? pulls.map((pull) => `${link(pull)} ${by(pull)}`).join('; ') : 'no pull request';
  return `• ${link(issue)} ${escape(issue.title)}${reason ? ` (${reason})` : ''}: ${closedBy}`;
}

function section(title: string, lines: string[]): string {
  return [`*${title} (${lines.length})*`, ...(lines.length ? lines : ['_None_'])].join('\n');
}

/** The update, in Slack's markdown. */
function message({ repo, since, closed, progress, pulls }: Update): string {
  const when = `${since.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  return [
    `*Status update: <https://github.com/${repo}|${repo}>*, since ${when}`,
    section('Closed issues', closed.map(issueLine)),
    section('In progress', progress.map(issueLine)),
    section('Other pull requests', pulls.map((pull) => `• ${link(pull)} ${escape(pull.title)} ${by(pull)}`)),
  ].join('\n\n');
}

/** `text` in messages Slack shows whole: cut between lines. */
function messages(text: string): string[] {
  const parts: string[] = [];
  let part = '';
  for (const line of text.split('\n')) {
    if (part && part.length + 1 + line.length > MESSAGE_LENGTH) {
      parts.push(part);
      part = line;
    } else part = part ? `${part}\n${line}` : line;
  }
  return [...parts, part].map((piece) => piece.trim()).filter(Boolean);
}

/** What Slack's `method` answers, when it says ok; tried again when Slack's rate limit stops it. */
async function slack<T>(token: string, method: string, query: Record<string, string>, body?: object): Promise<T> {
  const url = `${API}/${method}${body ? '' : `?${new URLSearchParams(query)}`}`;
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { 'content-type': 'application/json; charset=utf-8' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    }).catch((error: Error) => {
      throw new Error(`Slack ${method} failed: ${error.message}`);
    });
    if (response.status === 429 && attempt < ATTEMPTS) {
      await sleep((Number(response.headers.get('retry-after') ?? 1) || 0) * 1000);
      continue;
    }
    if (!response.ok) throw new Error(`Slack ${method} failed: HTTP ${response.status}`);
    const answer = (await response.json()) as { ok: boolean; error?: string } & T;
    if (answer.ok) return answer;
    const hint = answer.error === 'not_in_channel' ? ' (invite the bot to the channel: /invite @<bot>)' : '';
    throw new Error(`Slack ${method} failed: ${answer.error ?? 'no reason given'}${hint}`);
  }
}

/** Posts `text` to `channel`, its rest in the thread of its first message; that message's link. */
async function post(token: string, channel: string, text: string): Promise<string> {
  let thread: string | undefined;
  for (const part of messages(text)) {
    const posted = await slack<{ ts: string }>(token, 'chat.postMessage', {}, {
      channel, text: part, unfurl_links: false, unfurl_media: false, ...(thread ? { thread_ts: thread } : {}),
    });
    thread ??= posted.ts;
  }
  const link = await slack<{ permalink: string }>(token, 'chat.getPermalink', { channel, message_ts: thread! });
  return link.permalink;
}

/** The start of the update: a date (its midnight, local time) or a date and time, not in the future. */
function date(text: string | undefined): Date {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(text ?? '');
  const time = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:?\d{2})?$/.test(text ?? '');
  const parsed = day ? new Date(`${text}T00:00`) : time ? new Date(text!.replace(' ', 'T')) : undefined;
  if (!parsed || Number.isNaN(parsed.getTime())) throw new Error(`Not a date and time: ${text ?? ''}`);
  if (parsed.getTime() > Date.now()) throw new Error(`In the future: ${text}`);
  return parsed;
}

function parse(args: string[]) {
  let since: Date | undefined;
  let repo: string | undefined;
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--since') since = date(args[++i]);
    else if (arg === '--repo') {
      repo = args[++i];
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? '')) throw new Error(`Not a repository, <owner>/<name>: ${repo ?? ''}`);
    } else if (arg === '--dry-run') dryRun = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!since) throw new Error('--since is required');
  return { since, repo, dryRun };
}

/** The environment posting needs: the token, and the channel's ID, not its name. */
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

/** What the script exits with, having printed the update. */
async function main(args: string[]): Promise<number> {
  let options: ReturnType<typeof parse>;
  try {
    options = parse(args);
  } catch (error) {
    console.error(`${(error as Error).message}\n${USAGE}`);
    return 1;
  }
  try {
    // Before asking GitHub: a missing token fails at once.
    const slackEnv = options.dryRun ? undefined : environment();
    const repo = options.repo ?? (await gh<{ nameWithOwner: string }>(['repo', 'view', '--json', 'nameWithOwner'])).nameWithOwner;
    const text = message(await collect(repo, options.since));
    console.log(text);
    if (slackEnv) console.log(`\nPosted: ${await post(slackEnv.token, slackEnv.channel, text)}`);
  } catch (error) {
    console.error((error as Error).message);
    return 1;
  }
  return 0;
}

// Not process.exit(): it would cut what is still being written to a pipe.
process.exitCode = await main(process.argv.slice(2));
