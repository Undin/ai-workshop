// The real CLI on real GitHub repositories, each pinned to a commit in repos.json, against what it
// printed when the pin was set: e2e/expected/<name>.stdout.txt and .stderr.txt.
// UPDATE_EXPECTED=1 writes those files instead, to add a repository or move a pin.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../skill-atlas', import.meta.url));
const EXPECTED = new URL('expected/', import.meta.url);
const repos: { name: string; url: string }[] = JSON.parse(readFileSync(new URL('repos.json', import.meta.url), 'utf8'));
const update = Boolean(process.env.UPDATE_EXPECTED);

/** `skill-atlas scan <url>`, as a user runs it; GITHUB_TOKEN comes from the environment. */
function scan(url: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(CLI, ['scan', url]);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

for (const { name, url } of repos) {
  test(`scan ${url}`, { timeout: 60_000 }, async () => {
    const result = await scan(url);
    assert.equal(result.code, 0, result.stderr);
    for (const stream of ['stdout', 'stderr'] as const) {
      const file = new URL(`${name}.${stream}.txt`, EXPECTED);
      if (update) writeFileSync(file, result[stream]);
      else assert.equal(result[stream], readFileSync(file, 'utf8'), `${stream} of ${url}`);
    }
  });
}
