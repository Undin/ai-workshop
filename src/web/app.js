// The web view's page: the repository field, its skills, and the chosen skill's SKILL.md, from
// GET /api/scan. A SKILL.md is untrusted: its Markdown is sanitized before it is shown.
import { marked } from '/vendor/marked.js';
import DOMPurify from '/vendor/purify.js';

const $ = (selector) => document.querySelector(selector);
const form = $('#scan');
const input = $('#source');
const status = $('#status');
const main = $('main');

// Links in a SKILL.md open outside the page.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

/** The scan in progress, so a newer one replaces it. */
let current;

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const source = input.value.trim();
  const url = new URL(location.href);
  url.search = source ? `?source=${encodeURIComponent(source)}` : '';
  history.pushState(null, '', url);
  scan(source);
});

addEventListener('popstate', start);
start();

/** The address keeps the repository: a reload or a shared link scans it again. */
function start() {
  const source = new URLSearchParams(location.search).get('source') ?? '';
  input.value = source;
  if (source) scan(source);
  else show('', false);
}

async function scan(source) {
  current?.abort();
  const controller = (current = new AbortController());
  show(`Scanning ${source || 'nothing'}…`, false);
  try {
    const response = await fetch(`/api/scan?source=${encodeURIComponent(source)}`, { signal: controller.signal });
    const answer = await response.json();
    if (controller.signal.aborted) return;
    if (!response.ok) return show(answer.error ?? `The server answered ${response.status}`, false, true);
    render(answer);
  } catch (error) {
    if (!controller.signal.aborted) show(`Cannot reach the Skill Atlas server: ${error.message}`, false, true);
  }
}

/** A message instead of, or above, the result. */
function show(message, result, error = false) {
  status.hidden = !message;
  status.textContent = message;
  status.classList.toggle('error', error);
  main.hidden = !result;
}

function render({ repository, skills, warnings }) {
  show(skills.length ? '' : 'No skills found', true);
  $('#repository').textContent = `${repository.id} · ${skills.length} ${skills.length === 1 ? 'skill' : 'skills'}`;
  $('#warnings').replaceChildren(...warnings.map((warning) => element('li', `warning: ${warning}`)));

  const items = skills.map((skill) => {
    const button = element('button', '');
    button.type = 'button';
    button.append(element('span', skill.name, 'name'));
    if (skill.summary) {
      const summary = element('span', skill.summary, 'summary');
      summary.title = skill.summary;
      button.append(summary);
    }
    if (skill.copies.length) button.append(element('span', `also in ${skill.copies.join(', ')}`, 'copies'));
    button.addEventListener('click', () => choose(skill, button));
    const item = element('li', '');
    item.append(button);
    return { item, button };
  });
  $('#skills').replaceChildren(...items.map(({ item }) => item));
  if (skills.length) choose(skills[0], items[0].button);
  else $('#skill').hidden = true;
}

/** The skill's SKILL.md: the front matter as a table, the body as Markdown. */
function choose(skill, button) {
  for (const other of document.querySelectorAll('#skills button')) other.removeAttribute('aria-current');
  button.setAttribute('aria-current', 'true');

  $('#skill').hidden = false;
  $('#skill-name').textContent = skill.name;
  const link = $('#skill-link');
  link.href = skill.link;
  link.textContent = skill.path;
  $('#skill-copies').textContent = skill.copies.length ? `also in ${skill.copies.join(', ')}` : '';
  $('#skill-copies').hidden = !skill.copies.length;

  const rows = Object.entries({ name: skill.name, description: skill.description, ...skill.properties }).map(([key, value]) => {
    const row = element('tr', '');
    row.append(element('th', key), element('td', typeof value === 'string' ? value : JSON.stringify(value)));
    return row;
  });
  $('#front-matter tbody').replaceChildren(...rows);
  $('#skill-body').innerHTML = DOMPurify.sanitize(marked.parse(skill.body, { async: false }));
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}
