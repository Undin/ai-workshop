// Slack's Web API for the skills' scripts (implement-issue's ask-slack.ts, status-update's
// status-update.ts): a call as the bot of SLACK_BOT_TOKEN, and the environment it needs.

/** Slack's Web API; another one in tests. */
const API = process.env.SLACK_API || 'https://slack.com/api';

/** A failure that passes: Slack's rate limit (`status` 429) or a server error, the network (`status` 0). */
export class Unavailable extends Error {
  /** How many seconds Slack asks to wait (`Retry-After`), if it does. */
  retryAfter: number;
  status: number;
  constructor(message: string, status: number, retryAfter = 0) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

/** What Slack's `method` answers, when it says ok: a GET of `query`, or a POST of `body`. */
export async function slack<T>(token: string, method: string, query: Record<string, string>, body?: object): Promise<T> {
  const url = `${API}/${method}${body ? '' : `?${new URLSearchParams(query)}`}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { 'content-type': 'application/json; charset=utf-8' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    throw new Unavailable(`Slack ${method} failed: ${(error as Error).message}`, 0);
  }
  const failed = `Slack ${method} failed: HTTP ${response.status}`;
  if (response.status === 429) {
    throw new Unavailable(failed, 429, Number(response.headers.get('retry-after')) || 0);
  }
  if (response.status >= 500) throw new Unavailable(failed, response.status);
  if (!response.ok) throw new Error(failed);
  const answer = (await response.json()) as { ok: boolean; error?: string } & T;
  if (answer.ok) return answer;
  const hint = answer.error === 'not_in_channel' ? ' (invite the bot to the channel: /invite @<bot>)' : '';
  throw new Error(`Slack ${method} failed: ${answer.error ?? 'no reason given'}${hint}`);
}

/** The environment a call needs: the token, and the channel's ID, not its name. */
export function environment() {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_CHANNEL;
  if (!token) throw new Error('SLACK_BOT_TOKEN is not set');
  if (!channel) throw new Error('SLACK_CHANNEL is not set');
  if (!/^[CG][A-Z0-9]+$/.test(channel)) {
    throw new Error(`SLACK_CHANNEL is not a channel ID (C…, in the channel's details in Slack): ${channel}`);
  }
  return { token, channel };
}
