// The local web view: the page in src/web, and the scan as JSON. The same core as the CLI;
// nothing is stored, each scan is a fresh one.
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { AtlasError } from './core/errors.ts';
import { firstSentence, skillLink } from './core/model.ts';
import { parseSkill } from './core/parse.ts';
import { scan, type Source } from './core/scan.ts';

export type ServerOptions = {
  /** Opens what the user asked to scan. */
  open(input: string): Promise<Source>;
};

const web = (file: string) => fileURLToPath(new URL(`web/${file}`, import.meta.url));

/** The files the page loads: its own, and the browser builds of its two libraries. */
const FILES: Record<string, { path: string; type: string }> = {
  '/': { path: web('index.html'), type: 'text/html; charset=utf-8' },
  '/app.js': { path: web('app.js'), type: 'text/javascript; charset=utf-8' },
  '/style.css': { path: web('style.css'), type: 'text/css; charset=utf-8' },
  '/vendor/marked.js': { path: fileURLToPath(import.meta.resolve('marked')), type: 'text/javascript; charset=utf-8' },
  '/vendor/purify.js': { path: fileURLToPath(import.meta.resolve('dompurify')), type: 'text/javascript; charset=utf-8' },
};

// Scripts only from the server itself; a SKILL.md may show images from anywhere.
const POLICY = "default-src 'self'; img-src 'self' https: data:; object-src 'none'; base-uri 'none'";

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
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      resolve(new URL(`http://localhost:${typeof address === 'object' && address ? address.port : port}/`));
    });
  });
}

async function handle(request: IncomingMessage, response: ServerResponse, open: ServerOptions['open']) {
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (request.method !== 'GET' && request.method !== 'HEAD') return send(response, 405, { error: 'Only GET' });
  if (url.pathname === '/api/scan') return send(response, ...(await scanAnswer(url.searchParams.get('source'), open)));
  const file = FILES[url.pathname];
  if (!file) return send(response, 404, { error: `Not found: ${url.pathname}` });
  response.writeHead(200, { 'Content-Type': file.type, 'Content-Security-Policy': POLICY, 'Cache-Control': 'no-store' });
  response.end(request.method === 'HEAD' ? undefined : await readFile(file.path));
}

/** The scan as the page shows it: each skill with its link, first sentence and SKILL.md parts. */
async function scanAnswer(source: string | null, open: ServerOptions['open']): Promise<[number, unknown]> {
  if (!source?.trim()) return [400, { error: 'Enter a GitHub repository URL or a directory' }];
  try {
    const result = await scan(await open(source.trim()));
    const skills = result.skills.map((skill) => {
      const { properties, body } = parseSkill(skill.text);
      return { ...skill, link: skillLink(result.repository, skill), summary: firstSentence(skill.description), properties, body };
    });
    return [200, { repository: result.repository, skills, warnings: result.warnings }];
  } catch (error) {
    if (!(error instanceof AtlasError)) throw error;
    return [400, { error: error.message }];
  }
}

function send(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}
