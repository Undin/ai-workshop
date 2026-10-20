#!/usr/bin/env node
// Step 7 of ../SKILL.md, the part that needs no judgement: what review on a pull request is still
// unanswered, now or once it comes. Asks GitHub through `gh api` every interval, until there is some
// (printed as JSON, exit 0) or the quiet period passes without any (`[]`, exit 2). Exit 1: an error.
import { execFile } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';

/** How long to wait without new review before giving up (`--quiet`). */
const QUIET_MINUTES = 30;
/** How often to ask GitHub (`--interval`). */
const INTERVAL_SECONDS = 60;
const USAGE = `Usage: wait-for-review.ts <pr> [--quiet <minutes: ${QUIET_MINUTES}>] [--interval <seconds: ${INTERVAL_SECONDS}>]`;
/** Ends every reply the skill posts. */
const REPLY = '<!-- implement-issue -->';
/** End status comments: neither review nor reply. */
const STATUS = ['<!-- implement-issue:started -->', '<!-- code-review:started -->'];

type User = { login: string } | null;
type Review = { id: number; user: User; state: string; body: string | null; html_url: string; submitted_at: string };
type Comment = { id: number; user: User; body: string; html_url: string; created_at: string };
type Inline = Comment & { in_reply_to_id?: number; path: string; line: number | null; original_line: number | null };

/** What is still to answer. `id` is what a reply goes to: the thread's root for inline comments. */
type Unanswered =
  | { kind: 'inline'; id: number; url: string; path: string; line: number | null; comments: Said[] }
  | { kind: 'conversation' | 'review'; id: number; url: string; author: string; body: string };
type Said = { author: string; url: string; body: string };

const run = promisify(execFile);

/** Every page of a list `gh api` answers, as one list. */
async function list<T>(path: string): Promise<T[]> {
  try {
    const { stdout } = await run('gh', ['api', '--paginate', '--slurp', path], { maxBuffer: 2 ** 28 });
    return (JSON.parse(stdout) as T[][]).flat();
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new Error(`gh api ${path} failed${stderr ? `: ${stderr}` : ''}`);
  }
}

const isReply = (body: string | null) => !!body?.includes(REPLY);
const isStatus = (body: string | null) => STATUS.some((marker) => body?.includes(marker));
const isLgtm = (body: string) => /^LGTM[.!]*$/i.test(body.trim().split('\n')[0].trim());
const author = (user: User) => user?.login ?? 'ghost';
const said = (comment: Comment): Said => ({ author: author(comment.user), url: comment.html_url, body: comment.body });

/** The review on pull request `pr` that no reply answers yet, oldest first. */
async function unanswered(pr: number): Promise<Unanswered[]> {
  const reviews = await list<Review>(`repos/{owner}/{repo}/pulls/${pr}/reviews`);
  const conversation = await list<Comment>(`repos/{owner}/{repo}/issues/${pr}/comments`);
  const inline = await list<Inline>(`repos/{owner}/{repo}/pulls/${pr}/comments`);
  const found: { at: string; item: Unanswered }[] = [];

  // A thread is answered when a reply comes after its last comment that isn't one.
  const threads = Map.groupBy(
    inline.filter((comment) => !isStatus(comment.body)),
    (comment) => comment.in_reply_to_id ?? comment.id,
  );
  for (const [root, thread] of threads) {
    thread.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id);
    const open = thread.slice(thread.findLastIndex((comment) => isReply(comment.body)) + 1);
    if (!open.length) continue;
    const first = thread.find((comment) => comment.id === root) ?? thread[0];
    const line = first.line ?? first.original_line; // null once outdated
    const item = { kind: 'inline', id: root, url: first.html_url, path: first.path, line, comments: open.map(said) } as const;
    found.push({ at: open[0].created_at, item });
  }

  // No threads here: one is answered when a later reply links to it.
  const replies = conversation.filter((comment) => isReply(comment.body));
  const linked = (url: string, at: string) =>
    replies.some((reply) => reply.created_at >= at && reply.body.includes(url));
  for (const comment of conversation) {
    if (isReply(comment.body) || isStatus(comment.body)) continue;
    if (linked(comment.html_url, comment.created_at)) continue;
    found.push({ at: comment.created_at, item: { kind: 'conversation', id: comment.id, ...said(comment) } });
  }
  for (const review of reviews) {
    // `LGTM` (code-review's approval, or its comment when it can't approve), drafts and reviews that
    // only carry inline comments have nothing to answer.
    if (review.state === 'PENDING' || !review.body?.trim() || isLgtm(review.body)) continue;
    if (isReply(review.body) || isStatus(review.body) || linked(review.html_url, review.submitted_at)) continue;
    const item = { kind: 'review', id: review.id, url: review.html_url, author: author(review.user), body: review.body } as const;
    found.push({ at: review.submitted_at, item });
  }

  return found.sort((a, b) => a.at.localeCompare(b.at)).map(({ item }) => item);
}

/** A number of `what` from the command line: not negative. */
function amount(text: string | undefined, what: string): number {
  const value = Number(text);
  if (!text?.trim() || !Number.isFinite(value) || value < 0) {
    throw new Error(`Not a number of ${what}: ${text ?? ''}`);
  }
  return value;
}

function parse(args: string[]) {
  let pr: number | undefined;
  let quiet = QUIET_MINUTES;
  let interval = INTERVAL_SECONDS;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--quiet') quiet = amount(args[++i], 'minutes');
    else if (arg === '--interval') interval = amount(args[++i], 'seconds');
    else if (pr === undefined && /^[1-9]\d*$/.test(arg)) pr = Number(arg);
    else throw new Error(`Not a pull request number: ${arg}`);
  }
  if (pr === undefined) throw new Error('No pull request number');
  return { pr, quiet, interval };
}

/** What the script exits with, having printed what it found. */
async function main(args: string[]): Promise<number> {
  let options: ReturnType<typeof parse>;
  try {
    options = parse(args);
  } catch (error) {
    console.error(`${(error as Error).message}\n${USAGE}`);
    return 1;
  }
  const { pr, quiet, interval } = options;
  const deadline = Date.now() + quiet * 60_000;
  try {
    // Once now, then every interval, the last time when the quiet period ends.
    for (;;) {
      const found = await unanswered(pr);
      if (found.length) {
        console.log(JSON.stringify(found, null, 2));
        return 0;
      }
      const left = deadline - Date.now();
      if (left <= 0) break;
      await sleep(Math.min(interval * 1000, left));
    }
  } catch (error) {
    console.error((error as Error).message);
    return 1;
  }
  console.log('[]');
  console.error(`No unanswered review on #${pr} in ${quiet} minutes.`);
  return 2;
}

// Not process.exit(): it would cut what is still being written to a pipe.
process.exitCode = await main(process.argv.slice(2));
