// The local web view: the page in src/web, and the scan as JSON. The same core as the CLI;
// nothing is stored, each scan is a fresh one.
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { AtlasError } from './core/errors.ts';
import { firstSentence, skillLink, type Skill } from './core/model.ts';
import { scan, type ScanResult, type Source } from './core/scan.ts';

export type ServerOptions = {
  /** Opens what the user asked to scan. */
  open(input: string): Promise<Source>;
};

/** What GET /api/scan answers: the scan, each skill with its link and first sentence. */
export type ScanAnswer = Omit<ScanResult, 'skills'> & { skills: (Skill & { link: string; summary: string })[] };
/** What a request that cannot be answered gets instead. */
export type ErrorAnswer = { error: string };

/** The names the server answers to; the first is the one it prints. */
const HOSTS = ['127.0.0.1', 'localhost'];

const web = (file: string) => fileURLToPath(new URL(`web/${file}`, import.meta.url));

/** The files the page loads: its own, and the browser builds of its two libraries. */
const JS = 'text/javascript; charset=utf-8';
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
    server.listen(port, HOSTS[0], () => {
      const address = server.address();
      // The address it listens on: `localhost` may resolve to ::1 first.
      resolve(new URL(`http://${HOSTS[0]}:${typeof address === 'object' && address ? address.port : port}/`));
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
    return send(response, 403, { error: `Not served to ${request.headers.host ?? 'no host'}: open http://${HOSTS[0]}:${port}/` });
  }
  const url = new URL(request.url ?? '/', 'http://localhost');
  // A scan only for GET: HEAD would scan for nothing.
  const methods = url.pathname === '/api/scan' ? ['GET'] : ['GET', 'HEAD'];
  if (!methods.includes(request.method ?? '')) return send(response, 405, { error: `Only ${methods.join(' and ')}` });
  if (url.pathname === '/api/scan') return send(response, ...(await scanAnswer(url.searchParams.get('source'), open)));
  const file = FILES[url.pathname];
  if (!file) return send(response, 404, { error: `Not found: ${url.pathname}` });
  response.writeHead(200, { 'Content-Type': file.type, 'Content-Security-Policy': POLICY, 'Cache-Control': 'no-store' });
  response.end(request.method === 'HEAD' ? undefined : await readFile(file.path));
}

/** The scan as the page shows it: each skill with its link and first sentence. */
async function scanAnswer(source: string | null, open: ServerOptions['open']): Promise<[number, ScanAnswer | ErrorAnswer]> {
  if (!source?.trim()) return [400, { error: 'Enter a GitHub repository URL or a directory' }];
  try {
    const result = await scan(await open(source.trim()));
    const skills = result.skills.map((skill) => ({
      ...skill,
      link: skillLink(result.repository, skill),
      summary: firstSentence(skill.description),
    }));
    return [200, { repository: result.repository, skills, warnings: result.warnings }];
  } catch (error) {
    if (!(error instanceof AtlasError)) throw error;
    return [400, { error: error.message }];
  }
}

function send(response: ServerResponse, status: number, body: ScanAnswer | ErrorAnswer) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}
