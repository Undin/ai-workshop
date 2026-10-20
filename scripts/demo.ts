// `npm run demo <name> [-- --publish <pr>]`: records demos/<name>.demo.ts, turns the video into
// demos/out/<name>.mp4 and .gif (ffmpeg), and with --publish uploads both to the `demos` pre-release
// and prints the Markdown for the pull request's description.
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const REPOSITORY = 'Undin/ai-workshop';
const RELEASE = 'demos';
const OUT = 'demos/out';

const { positionals, values } = parseArgs({ allowPositionals: true, options: { publish: { type: 'string' } } });
const [name] = positionals;
if (!name || positionals.length > 1 || (values.publish !== undefined && !/^\d+$/.test(values.publish))) {
  console.error('Usage: npm run demo <name> [-- --publish <pr>]');
  process.exit(1);
}

const run = (command: string, args: string[], env = process.env) => execFileSync(command, args, { stdio: 'inherit', env });

run('npx', ['playwright', 'test', '-c', 'demos/playwright.config.ts', `${name}.demo.ts`]);
const video = `${OUT}/${name}.webm`;
run('ffmpeg', ['-loglevel', 'error', '-y', '-i', video, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', `${OUT}/${name}.mp4`]);
run('ffmpeg', [
  '-loglevel', 'error', '-y', '-i', video,
  '-vf', 'fps=12,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4',
  `${OUT}/${name}.gif`,
]);
console.log(`${OUT}/${name}.mp4\n${OUT}/${name}.gif`);

if (values.publish !== undefined) {
  // gh with its own login: a GITHUB_TOKEN of the environment may not be allowed to write.
  const env = { ...process.env };
  delete env.GITHUB_TOKEN;
  const gh = (...args: string[]) => run('gh', ['--repo', REPOSITORY, ...args], env);
  if (spawnSync('gh', ['--repo', REPOSITORY, 'release', 'view', RELEASE], { env, stdio: 'ignore' }).status !== 0) {
    gh('release', 'create', RELEASE, '--prerelease', '--title', 'Demo videos', '--notes', 'The demo videos of pull requests: `npm run demo`.');
  }
  // The pull request's own copies: a new demo of another one does not replace them.
  const asset = `pr-${values.publish}-${name}`;
  for (const extension of ['gif', 'mp4']) copyFileSync(`${OUT}/${name}.${extension}`, `${OUT}/${asset}.${extension}`);
  gh('release', 'upload', RELEASE, `${OUT}/${asset}.gif`, `${OUT}/${asset}.mp4`, '--clobber');
  const url = `https://github.com/${REPOSITORY}/releases/download/${RELEASE}/${asset}`;
  console.log(`\n![${name}](${url}.gif)\n\n[The video (MP4)](${url}.mp4)`);
}
