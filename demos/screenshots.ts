// The screenshots of the demos' key points that are committed, demos/<name>/screenshots/: the ones
// the Demos workflow took on this branch's last commit, pushed, its run green, not a local run's.
//   npm run demo:screenshots
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const run = (command: string, args: string[]) => execFileSync(command, args, { cwd: ROOT, encoding: 'utf8' }).trim();

const head = run('git', ['rev-parse', 'HEAD']);
const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
const runs = JSON.parse(
  run('gh', ['run', 'list', '--workflow', 'Demos', '--branch', branch, '--commit', head, '--json', 'databaseId,status,conclusion']),
) as { databaseId: number; status: string; conclusion: string }[];
const green = runs.find((demos) => demos.conclusion === 'success');
if (!green) {
  const states = runs.map((demos) => demos.conclusion || demos.status).join(', ') || 'none';
  throw new Error(`No green Demos run on ${head.slice(0, 7)} (${branch}): ${states}; push it and wait for it`);
}

const downloaded = mkdtempSync(join(tmpdir(), 'skill-atlas-screenshots-'));
try {
  run('gh', ['run', 'download', String(green.databaseId), '--pattern', '*-screenshots', '--dir', downloaded]);
  for (const artifact of readdirSync(downloaded)) {
    const name = artifact.replace(/-screenshots$/, '');
    const directory = join(ROOT, 'demos', name, 'screenshots');
    rmSync(directory, { recursive: true, force: true });
    cpSync(join(downloaded, artifact), directory, { recursive: true });
    console.log(`demos/${name}/screenshots/: ${readdirSync(directory).join(', ')}`);
  }
} finally {
  rmSync(downloaded, { recursive: true, force: true });
}
