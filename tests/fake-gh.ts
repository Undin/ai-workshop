// `gh api [--paginate --slurp] <path>` for tests/wait-for-review.test.ts, answered from the JSON file
// in FAKE_GH: for each path, what GitHub answers each time it is asked (pages of a list, an object, or
// an error to fail with); the last answer repeats. Every call is appended to FAKE_GH.log.
import { appendFileSync, readFileSync } from 'node:fs';

export type Answer = unknown[][] | Record<string, unknown> | { error: string };
export type Answers = Record<string, Answer[]>;

const file = process.env.FAKE_GH!;
const args = process.argv.slice(2);
appendFileSync(`${file}.log`, `${args.join(' ')}\n`);

const path = args.at(-1)!;
const asked = readFileSync(`${file}.log`, 'utf8').split('\n').filter((line) => line.endsWith(` ${path}`)).length;
const answers = (JSON.parse(readFileSync(file, 'utf8')) as Answers)[path] ?? [{ error: `HTTP 404: Not Found (${path})` }];
const answer = answers[Math.min(asked, answers.length) - 1];

if ('error' in answer) {
  console.error(answer.error);
  process.exit(1);
}
console.log(JSON.stringify(answer));
