// The web view's page: the repository field, its skills, and the chosen skill's SKILL.md, from
// GET /api/scan; for an organization, its repositories as they are scanned, each linked to its
// page, shown from that scan while it goes on. A SKILL.md is untrusted: its Markdown is sanitized
// before it is shown.
import { marked } from '/vendor/marked.js';
import DOMPurify from '/vendor/purify.js';

const $ = (selector) => document.querySelector(selector);
const form = $('#scan');
const input = $('#source');
const status = $('#status');
const main = $('main');
const organization = $('#organization');
const progress = $('#progress');
const filter = $('#filter');

// Links in a SKILL.md open outside the page.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

/** The scan in progress, so a newer one replaces it. */
let current;
/** The scanned skills, each with its list item, for the filter. */
let listed = [];
/**
 * The organization's scan, kept in the page while it is open: its page and its repositories'
 * pages show what it has, as it goes on, without a new scan.
 */
let organizationScan;
/** Whether the page shows the organization's scan: its page, or one of its repositories'. */
let fromOrganization = false;

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const source = input.value.trim();
  const url = new URL(location.href);
  url.search = source ? `?source=${encodeURIComponent(source)}` : '';
  history.pushState(null, '', url);
  scan(source);
});

filter.addEventListener('input', applyFilter);
$('#stop').addEventListener('click', stopOrganization);
inPage($('#progress-organization'));

addEventListener('popstate', start);
start();

/**
 * The address keeps the repository: a reload or a shared link scans it again. The organization
 * being scanned and its scanned repositories are shown from its scan.
 */
function start() {
  const source = new URLSearchParams(location.search).get('source') ?? '';
  input.value = source;
  if (organizationScan && source === organizationScan.source) return showOrganization();
  const scanned = organizationScan?.repositories.get(source)?.answer;
  if (scanned) return showRepository(scanned);
  if (source) return scan(source);
  // Back to no repository: a scan still running must not show its result here.
  current?.abort();
  forgetOrganization();
  show('');
}

/** A fresh scan: it replaces the one running, an organization's too. */
async function scan(source) {
  current?.abort();
  forgetOrganization();
  const controller = (current = new AbortController());
  show(`Scanning ${source || 'nothing'}…`);
  try {
    const response = await fetch(`/api/scan?source=${encodeURIComponent(source)}`, { signal: controller.signal });
    // An organization: a line for each repository as it is scanned.
    if (response.headers.get('content-type')?.startsWith('application/x-ndjson')) {
      return await followOrganization(source, lines(response.body), controller);
    }
    const answer = await response.json();
    if (controller.signal.aborted) return;
    if (!response.ok) return show(answer.error ?? `The server answered ${response.status}`, { error: true });
    render(answer);
  } catch (error) {
    if (!controller.signal.aborted) show(`Cannot reach the Skill Atlas server: ${error.message}`, { error: true });
  }
}

/** A message instead of a result, or above `view`: the repository's (`main`) or the organization's; red with `error`. */
function show(message, { view, error = false } = {}) {
  status.hidden = !message;
  status.textContent = message;
  status.classList.toggle('error', error);
  main.hidden = view !== main;
  organization.hidden = view !== organization;
}

function render({ repository, skills, warnings }) {
  show(skills.length ? '' : 'No skills found', { view: main });
  $('#repository').textContent = `${repository.id} · ${count(skills.length, 'skill', 'skills')}`;
  $('#warnings').replaceChildren(...warnings.map((warning) => element('li', `warning: ${warning}`)));

  const items = skills.map((skill) => {
    const button = element('button', '');
    button.type = 'button';
    const name = element('span', skill.name, 'name');
    button.append(name);
    const summary = skill.summary ? element('span', skill.summary, 'summary') : undefined;
    if (summary) {
      summary.title = skill.summary;
      button.append(summary);
    }
    if (skill.copies.length) button.append(element('span', alsoIn(skill), 'copies'));
    button.addEventListener('click', () => choose(skill, button));
    const item = element('li', '');
    item.append(button);
    return { skill, item, button, name, summary };
  });
  $('#skills').replaceChildren(...items.map(({ item }) => item));
  listed = items;
  // A new scan, a new list: the filter starts empty.
  filter.value = '';
  $('#filtering').hidden = !skills.length;
  applyFilter();
  if (skills.length) choose(skills[0], items[0].button);
  else $('#skill').hidden = true;
}

/**
 * The organization's repositories at once, then each one's skill count as it is scanned, a link
 * to its page once it is; the warnings as the CLI prints them. The scan is kept in the page.
 */
async function followOrganization(source, answer, controller) {
  const scanning = { source, controller, running: true, message: '', error: false, total: 0, scanned: 0, repositories: new Map() };
  const warnings = $('#organization-warnings');
  try {
    for await (const line of answer) {
      if (controller.signal.aborted) return;
      if (line.organization) {
        Object.assign(scanning, { id: line.organization.id, total: line.repositories.length });
        if (!scanning.total) scanning.message = 'No repositories found';
        $('#organization-name').textContent = `${scanning.id} · ${count(scanning.total, 'repository', 'repositories')}`;
        warnings.replaceChildren();
        $('#repositories').replaceChildren(
          ...line.repositories.map(({ id, url }) => {
            const row = element('span', '', 'row');
            const state = element('span', '…', 'count');
            row.append(element('span', id, 'name'), state);
            scanning.repositories.set(url, { row, state });
            const item = element('li', '');
            item.append(row);
            return item;
          }),
        );
        organizationScan = scanning;
        showOrganization();
      } else if (line.id) {
        const repository = scanning.repositories.get(line.url);
        repository.scanned = true;
        scanning.scanned++;
        if (line.error) {
          repository.state.textContent = `not scanned: ${line.error}`;
          repository.state.classList.add('error');
        } else {
          repository.answer = line;
          repository.state.textContent = count(line.skills.length, 'skill', 'skills');
          // Scanned: a link to its page, shown from this scan.
          const link = element('a', '', 'row');
          link.href = `/?source=${encodeURIComponent(line.url)}`;
          link.append(...repository.row.childNodes);
          inPage(link);
          repository.row.replaceWith(link);
          warnings.append(...line.warnings.map((warning) => element('li', `warning: ${line.id}: ${warning}`)));
        }
        updateProgress();
      } else {
        // GitHub answers no more.
        return finish(scanning, line.error, true);
      }
    }
    finish(scanning, scanning.message, false);
  } catch (error) {
    if (!controller.signal.aborted) finish(scanning, `Cannot reach the Skill Atlas server: ${error.message}`, true);
  }
}

/** The organization's scan is over: the repositories left are not scanned. */
function finish(scanning, message, error) {
  Object.assign(scanning, { running: false, message, error });
  for (const repository of scanning.repositories.values()) if (!repository.scanned) repository.state.textContent = 'not scanned';
  if (scanning !== organizationScan) return;
  updateProgress();
  if (!organization.hidden) showOrganization();
}

/** Stops the organization's scan, here or on one of its repositories' pages. */
function stopOrganization() {
  const scanning = organizationScan;
  scanning.controller.abort();
  finish(scanning, `Stopped after ${scanning.scanned} of ${count(scanning.total, 'repository', 'repositories')}`, false);
}

/** No organization's scan any more: another scan, or no repository. */
function forgetOrganization() {
  organizationScan = undefined;
  fromOrganization = false;
  updateProgress();
}

/** The organization's page, as its scan has it. */
function showOrganization() {
  fromOrganization = true;
  show(organizationScan.message, { view: organization, error: organizationScan.error });
  updateProgress();
}

/** A repository's page, from the organization's scan: no new scan. */
function showRepository(answer) {
  fromOrganization = true;
  render(answer);
  updateProgress();
}

/** While the organization's scan runs, on its page and its repositories': how far it is, a link to its page, Stop. */
function updateProgress() {
  const scanning = organizationScan;
  progress.hidden = !(scanning?.running && scanning.total && fromOrganization);
  if (progress.hidden) return;
  const link = $('#progress-organization');
  link.textContent = scanning.id;
  link.href = `/?source=${encodeURIComponent(scanning.source)}`;
  $('#progress-count').textContent = `: ${scanning.scanned} of ${count(scanning.total, 'repository', 'repositories')}…`;
}

/** A link to a page of the organization's scan: shown from what it has, the scan goes on. A new tab scans afresh. */
function inPage(link) {
  link.addEventListener('click', (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    history.pushState(null, '', link.href);
    start();
  });
}

/** Each line of an NDJSON body, parsed, as it arrives. */
async function* lines(body) {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let rest = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const parts = (rest + value).split('\n');
    rest = parts.pop();
    for (const part of parts) if (part) yield JSON.parse(part);
  }
  if (rest) yield JSON.parse(rest);
}

/** Keeps the skills whose name or first sentence contains the filter's text, in any case; marks it there. */
function applyFilter() {
  const text = filter.value.trim();
  // The text as it is typed, not a pattern: `.` is a dot.
  const wanted = text && new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
  let shown = 0;
  for (const { skill, item, name, summary } of listed) {
    const kept = !wanted || [skill.name, skill.summary].some((field) => field.search(wanted) >= 0);
    item.hidden = !kept;
    if (!kept) continue;
    shown++;
    name.replaceChildren(...highlighted(skill.name, wanted));
    summary?.replaceChildren(...highlighted(skill.summary, wanted));
  }
  $('#shown').textContent = shown ? `Showing ${shown} of ${count(listed.length, 'skill', 'skills')}` : `No skills match ${text}`;
}

/** The skill's SKILL.md: the front matter as a table, the body as Markdown. */
function choose(skill, button) {
  for (const other of document.querySelectorAll('#skills button')) other.removeAttribute('aria-current');
  button.setAttribute('aria-current', 'true');

  $('#skill').hidden = false;
  $('#skill-name').textContent = skill.name;
  // A web page cannot open a file:// link: a local skill shows its path.
  if (skill.link.startsWith('file:')) {
    $('#skill-location').replaceChildren(element('code', decodeURIComponent(new URL(skill.link).pathname)));
  } else {
    const link = element('a', skill.path);
    link.href = skill.link;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    $('#skill-location').replaceChildren(link);
  }
  $('#skill-copies').textContent = skill.copies.length ? alsoIn(skill) : '';
  $('#skill-copies').hidden = !skill.copies.length;

  const rows = Object.entries({ name: skill.name, description: skill.description, ...skill.properties }).map(([key, value]) => {
    const row = element('tr', '');
    row.append(element('th', key), element('td', typeof value === 'string' ? value : JSON.stringify(value)));
    return row;
  });
  $('#front-matter tbody').replaceChildren(...rows);
  $('#skill-body').innerHTML = DOMPurify.sanitize(marked.parse(skill.body, { async: false }));
}

/** The text, each match of `wanted` in a `<mark>`. */
function highlighted(text, wanted) {
  if (!wanted) return [text];
  const parts = [];
  let end = 0;
  for (const match of text.matchAll(wanted)) {
    parts.push(text.slice(end, match.index), element('mark', match[0]));
    end = match.index + match[0].length;
  }
  parts.push(text.slice(end));
  return parts.filter((part) => part !== '');
}

/** `1 skill`, `2 skills`. */
function count(number, one, many) {
  return `${number} ${number === 1 ? one : many}`;
}

function alsoIn(skill) {
  return `also in ${skill.copies.join(', ')}`;
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}
