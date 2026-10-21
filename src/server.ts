// The local web view: the page in src/web, and the scan as JSON, each skill with its last update.
// The same core as the CLI; nothing is stored, each scan is a fresh one.
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { cluster } from './core/cluster.ts';
import { AtlasError } from './core/errors.ts';
import { firstSentence, skillLink, type Organization, type Skill } from './core/model.ts';
import { scan, scanOrganization, type OrganizationSource, type ScanResult, type Source } from './core/scan.ts';

export type ServerOptions = {
  /** Opens what the user asked to scan: a repository, or an organization's repositories. */
  open(input: string): Promise<Source | OrganizationSource>;
};

/** What GET /api/scan answers: the scan, each skill with its link, first sentence, group and last update. */
export type ScanAnswer = Omit<ScanResult, 'skills'> & { skills: (Skill & { link: string; summary: string; group: { id: string; name: string; order: number } })[] };
/** What a request that cannot be answered gets instead. */
export type ErrorAnswer = { error: string };
/**
 * A line of what GET /api/scan answers for an organization: its repositories first, then each one
 * as it is scanned, the same answer as for the repository alone, or why not; an error last, if the
 * scan cannot go on.
 */
export type OrganizationLine =
  | { organization: Organization; repositories: { id: string; url: string }[] }
  | ({ id: string; url: string } & ScanAnswer)
  | { id: string; url: string; error: string }
  | ErrorAnswer;

/** The address the server listens on and prints: `localhost` may resolve to ::1 first. */
const ADDRESS = '127.0.0.1';
/** The names the server answers to. */
const HOSTS = [ADDRESS, 'localhost'];

const web = (file: string) => fileURLToPath(new URL(`web/${file}`, import.meta.url));

const JS = 'text/javascript; charset=utf-8';
/** The files the page loads: its own, and the browser builds of its two libraries. */
const FILES: Record<string, { path: string; type: string }> = {
  '/': { path: web('index.html'), type: 'text/html; charset=utf-8' },
  '/app.js': { path: web('app.js'), type: JS },
  '/style.css': { path: web('style.css'), type: 'text/css; charset=utf-8' },
  '/vendor/marked.js': { path: fileURLToPath(import.meta.resolve('marked')), type: JS },
  '/vendor/purify.js': { path: fileURLToPath(import.meta.resolve('dompurify')), type: JS },
};

// Everything from the server itself: an untrusted SKILL.md can neither run a script nor load a
// remote image, which would tell its server who opened it.
const POLICY = "default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'";

export function createAtlasServer({ open }: ServerOptions): Server {
  return createServer((request, response) => {
    handle(request, response, open).catch((error: unknown) => {
      if (response.headersSent) return response.destroy();
      send(response, 500, { error: `Unexpected error: ${error instanceof Error ? error.message : String(error)}` });
    });
  });
}

/** Listens on the loopback interface only: the server reads local directories. */
export function listen(server: Server, port: number): Promise<URL> {
  return new Promise((resolve, reject) => {
    server.once('error', (error: NodeJS.ErrnoException) =>
      reject(error.code === 'EADDRINUSE' ? new AtlasError(`Port ${port} is in use; try --port <another>`) : error),
    );
    server.listen(port, ADDRESS, () => {
      const address = server.address();
      resolve(new URL(`http://${ADDRESS}:${typeof address === 'object' && address ? address.port : port}/`));
    });
  });
}

/**
 * Against DNS rebinding: a page on another site that resolves its own name to 127.0.0.1 is not
 * let in, so it cannot read local directories or use GITHUB_TOKEN. Browsers leave out port 80.
 */
export function isServedHost(host: string | undefined, port: number): boolean {
  const match = /^([^:]+)(?::(\d+))?$/.exec(host ?? '');
  return !!match && HOSTS.includes(match[1].toLowerCase()) && Number(match[2] ?? 80) === port;
}

async function handle(request: IncomingMessage, response: ServerResponse, open: ServerOptions['open']) {
  const port = request.socket.localPort ?? 0;
  if (!isServedHost(request.headers.host, port)) {
    return send(response, 403, { error: `Not served to ${request.headers.host ?? 'no host'}: open http://${ADDRESS}:${port}/` });
  }
  const url = new URL(request.url ?? '/', 'http://localhost');
  const scanning = url.pathname === '/api/scan';
  // A scan only for GET: HEAD would scan for nothing.
  const methods = scanning ? ['GET'] : ['GET', 'HEAD'];
  if (!methods.includes(request.method ?? '')) return send(response, 405, { error: `Only ${methods.join(' and ')}` });
  if (scanning) return answerScan(url.searchParams.get('source'), open, response);
  const file = FILES[url.pathname];
  if (!file) return send(response, 404, { error: `Not found: ${url.pathname}` });
  response.writeHead(200, { 'Content-Type': file.type, 'Content-Security-Policy': POLICY, 'Cache-Control': 'no-store' });
  response.end(request.method === 'HEAD' ? undefined : await readFile(file.path));
}

/** The scan as the page shows it: a repository's skills, or an organization's repositories as they are scanned. */
async function answerScan(source: string | null, open: ServerOptions['open'], response: ServerResponse) {
  if (!source?.trim()) return send(response, 400, { error: 'Enter a GitHub repository URL or a directory' });
  let opened: Source | OrganizationSource;
  let result: ScanResult;
  try {
    opened = await open(source.trim());
    if ('organization' in opened) return await streamOrganization(opened, response);
    result = await scan(opened, { lastUpdates: true });
  } catch (error) {
    if (!(error instanceof AtlasError)) throw error;
    return send(response, 400, { error: error.message });
  }
  send(response, 200, scanAnswer(result));
}

/** The scan as the page shows it: each skill with its link, first sentence and group. */
function scanAnswer(result: ScanResult): ScanAnswer {
  const skills = result.skills.map((skill) => ({
    ...skill,
    link: skillLink(result.repository, skill),
    summary: firstSentence(skill.description),
    group: cluster(skill.cluster),
  }));
  return { repository: result.repository, skills, warnings: result.warnings };
}

/** A JSON line as soon as it is known; when the page is gone, the scan stops. */
async function streamOrganization(source: OrganizationSource, response: ServerResponse) {
  let gone = false;
  response.once('close', () => (gone = true));
  response.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' });
  const write = (line: OrganizationLine) => response.write(`${JSON.stringify(line)}\n`);
  write({ organization: source.organization, repositories: source.repositories.map(({ id, url }) => ({ id, url })) });
  try {
    for await (const scanned of scanOrganization(source, { lastUpdates: true })) {
      if (gone) return;
      write('error' in scanned ? scanned : { id: scanned.id, url: scanned.url, ...scanAnswer(scanned.result) });
    }
  } catch (error) {
    // GitHub answers no more: the page shows why, under what it already has.
    if (!(error instanceof AtlasError)) throw error;
    if (!gone) write({ error: error.message });
  }
  response.end();
}

function send(response: ServerResponse, status: number, body: ScanAnswer | ErrorAnswer) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}
