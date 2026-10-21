// The skill-atlas commands. The same code serves the Node CLI and the browser
// terminal: everything that differs between them comes in through the context.
import { AtlasError } from './core/errors.ts';
import { firstSentence, skillLink, type Repository, type Skill } from './core/model.ts';
import { scan, scanOrganization, type OrganizationSource, type Source } from './core/scan.ts';

/** `cache: false` with `--no-cache`: GitHub is asked for everything, nothing is kept. */
export type CacheChoice = { cache: boolean };

export type Context = {
  /** Opens what the user asked to scan: a repository, or an organization's repositories. */
  open(input: string, options: CacheChoice): Promise<Source | OrganizationSource>;
  print(text: string): void;
  /** Errors and warnings. */
  error(text: string): void;
  /** Starts the web view on the port, and returns its address; only where there is a server. */
  serve?(port: number, options: CacheChoice): Promise<URL>;
  /** Where GitHub's answers are kept on disk, which `--no-cache` turns off; only where there is a disk. */
  cacheDirectory?: string;
};

const DEFAULT_PORT = 3000;

/** The commands this client can run: `serve` only where there is a server, `--no-cache` where there is a cache. */
function usage({ serve, cacheDirectory }: Context): string {
  return [
    'Usage: skill-atlas <command>',
    '',
    '  scan <GitHub URL | directory>   find every SKILL.md in a repository and print it;',
    '                                  in each repository of a GitHub organization, count them',
    ...(serve ? [`  serve [--port <port>]           open the web view, on port ${DEFAULT_PORT} by default`] : []),
    ...(cacheDirectory ? [`  --no-cache                      with ${serve ? 'scan or serve' : 'scan'}: ask GitHub for everything, keep nothing in ${cacheDirectory}/`] : []),
    '  help                            show this help',
  ].join('\n');
}

/** Runs one command; returns its exit code. */
export async function run(args: string[], context: Context): Promise<number> {
  const [command = 'help', ...rest] = args;
  try {
    if (command === 'scan') await scanCommand(rest, context);
    else if (command === 'serve' && context.serve) await serveCommand(rest, context.serve, context);
    else if (command === 'help') context.print(usage(context));
    else throw new AtlasError(`Unknown command: ${command}\n\n${usage(context)}`);
    return 0;
  } catch (error) {
    if (!(error instanceof AtlasError)) throw error;
    context.error(error.message);
    return 1;
  }
}

async function scanCommand(args: string[], context: Context) {
  // `--no-cache` before or after the link, once.
  const at = context.cacheDirectory ? args.indexOf('--no-cache') : -1;
  const rest = at < 0 ? args : args.toSpliced(at, 1);
  if (rest.length !== 1) throw new AtlasError(`Usage: skill-atlas scan ${context.cacheDirectory ? '[--no-cache] ' : ''}<GitHub URL | directory>`);
  const opened = await context.open(rest[0], { cache: at < 0 });
  if ('organization' in opened) return printOrganization(opened, context);
  const result = await scan(opened);
  printRepository(result.repository, result.skills, context);
  for (const warning of result.warnings) context.error(`warning: ${warning}`);
}

/** `<owner> · N repositories`, then each repository's line as soon as it is scanned, and its warnings. */
async function printOrganization(source: OrganizationSource, { print, error }: Context) {
  print(`${source.organization.id} · ${count(source.repositories.length, 'repository', 'repositories')}`);
  for await (const scanned of scanOrganization(source)) {
    if ('error' in scanned) {
      print(`${scanned.id} · not scanned: ${scanned.error}`);
      continue;
    }
    print(`${scanned.id} · ${count(scanned.result.skills.length, 'skill', 'skills')}`);
    for (const warning of scanned.result.warnings) error(`warning: ${scanned.id}: ${warning}`);
  }
}

async function serveCommand(args: string[], serve: NonNullable<Context['serve']>, { print, cacheDirectory }: Context) {
  const serveUsage = `Usage: skill-atlas serve [--port <port>]${cacheDirectory ? ' [--no-cache]' : ''}`;
  // `--port <port>` and `--no-cache` in any order, each once.
  let port: string | undefined;
  let cache = true;
  for (let index = 0; index < args.length; index++) {
    if (cacheDirectory && args[index] === '--no-cache' && cache) cache = false;
    else if (args[index] === '--port' && port === undefined && index + 1 < args.length) port = args[++index];
    else throw new AtlasError(serveUsage);
  }
  // Digits only: Number() would also take '', 0x1F90 and 1e3.
  if (port !== undefined && (!/^\d+$/.test(port) || Number(port) > 65535)) {
    throw new AtlasError(`Not a port: ${port}\n${serveUsage}`);
  }
  print(`Skill Atlas: ${(await serve(port === undefined ? DEFAULT_PORT : Number(port), { cache })).href}`);
}

/** `<owner>/<repo> · N skills`, then each skill's name, first sentence and link. */
function printRepository(repository: Repository, skills: Skill[], { print }: Context) {
  print(`${repository.id} · ${count(skills.length, 'skill', 'skills')}`);
  for (const skill of skills) {
    print(skill.description ? `${skill.name} — ${firstSentence(skill.description)}` : skill.name);
    print(`  ${skillLink(repository, skill)}`);
    if (skill.copies.length > 0) print(`  also in ${skill.copies.join(', ')}`);
  }
}

/** `1 skill`, `2 skills`. */
function count(number: number, one: string, many: string): string {
  return `${number} ${number === 1 ? one : many}`;
}
