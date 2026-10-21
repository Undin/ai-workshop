// GitHub through `gh` for the skills' scripts (implement-issue's wait-for-review.ts, status-update's
// status-update.ts): logged in, or GH_TOKEN; a fake one on the PATH in tests (tests/fake-gh.ts).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** What `gh <args>` prints, parsed; a failure says `gh <what> failed` and what gh said. */
export async function gh<T>(args: string[], what: string): Promise<T> {
  try {
    const { stdout } = await run('gh', args, { maxBuffer: 2 ** 28 });
    return JSON.parse(stdout) as T;
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new Error(`gh ${what} failed${stderr ? `: ${stderr}` : ''}`);
  }
}
