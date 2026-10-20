// The skill-atlas commands. The same code serves the Node CLI and the browser
// terminal: everything that differs between them comes in through the context.
import { AtlasError } from './core/errors.ts';
import { firstSentence, skillLink, type Repository, type Skill } from './core/model.ts';
import { scan, type Source } from './core/scan.ts';

export type Context = {
  /** Opens what the user asked to scan. */
  open(input: string): Promise<Source>;
  print(text: string): void;
  /** Errors and warnings. */
  error(text: string): void;
  /** Starts the web view on the port, and returns its address; only where there is a server. */
  serve?(port: number): Promise<URL>;
};

const DEFAULT_PORT = 3000;

/** The commands this client can run: `serve` only where there is a server. */
function usage({ serve }: Context): string {
  return [
    'Usage: skill-atlas <command>',
    '',
    '  scan <GitHub URL | directory>   find every SKILL.md in a repository and print it',
    ...(serve ? [`  serve [--port <port>]           open the web view, on port ${DEFAULT_PORT} by default`] : []),
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
  if (args.length !== 1) throw new AtlasError('Usage: skill-atlas scan <GitHub URL | directory>');
  const result = await scan(await context.open(args[0]));
  printRepository(result.repository, result.skills, context);
  for (const warning of result.warnings) context.error(`warning: ${warning}`);
}

async function serveCommand(args: string[], serve: NonNullable<Context['serve']>, { print }: Context) {
  const serveUsage = 'Usage: skill-atlas serve [--port <port>]';
  if (args.length !== 0 && (args.length !== 2 || args[0] !== '--port')) throw new AtlasError(serveUsage);
  // Digits only: Number() would also take '', 0x1F90 and 1e3.
  if (args.length && (!/^\d+$/.test(args[1]) || Number(args[1]) > 65535)) {
    throw new AtlasError(`Not a port: ${args[1]}\n${serveUsage}`);
  }
  print(`Skill Atlas: ${(await serve(args.length ? Number(args[1]) : DEFAULT_PORT)).href}`);
}

/** `<owner>/<repo> · N skills`, then each skill's name, first sentence and link. */
function printRepository(repository: Repository, skills: Skill[], { print }: Context) {
  print(`${repository.id} · ${skills.length} ${skills.length === 1 ? 'skill' : 'skills'}`);
  for (const skill of skills) {
    print(skill.description ? `${skill.name} — ${firstSentence(skill.description)}` : skill.name);
    print(`  ${skillLink(repository, skill)}`);
    if (skill.copies.length > 0) print(`  also in ${skill.copies.join(', ')}`);
  }
}
