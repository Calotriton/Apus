// Apus page: choices, settings and results. The work happens in worker.js.
const $ = (id) => document.getElementById(id);
const AUDIO = /\.(wav|flac|ogg|mp3|m4a|aiff?)$/i;
const FIELDS = ['threshold', 'hop_s', 'top_k', 'csv_separator', 'raven_tables', 'extract_clips', 'clips_per_band',
                'clip_extra_s', 'clip_species', 'resume', 'backend'];
const state = { recordings: null, inputDir: null, list: null, listPath: null, synonyms: null, folder: null,
                ready: false, running: false, lastRun: null };

// ── Settings, saved in this browser ───────────────────────────────────────────────────────────────────────
const valueOf = (el) => (el.type === 'checkbox' ? el.checked : el.value);
function loadSettings() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('apus.settings')) || {}; } catch { /* storage blocked */ }
  for (const k of FIELDS) {
    if (!(k in saved)) continue;
    if ($(k).type === 'checkbox') $(k).checked = saved[k]; else $(k).value = saved[k];
  }
}
function saveSettings() {
  try { localStorage.setItem('apus.settings', JSON.stringify(Object.fromEntries(FIELDS.map((k) => [k, valueOf($(k))])))); }
  catch { /* storage blocked */ }
}
function minTopK() { return Math.floor(1 / Number($('threshold').value) + 1e-9); }
function checkTopK() {
  const min = minTopK();
  if (Number.isFinite(min) && Number($('top_k').value) < min) {
    $('top_k').value = min;
    $('top-k-hint').textContent = `Raised to ${min}: up to ${min} species can reach this threshold in one window`;
  }
}
// The key settings, repeated beside the Run button
function settingsLine() {
  $('settings-text').textContent = `Threshold ${Number($('threshold').value).toFixed(2)} · ${$('hop_s').value} s hop · ` +
    `${$('top_k').value} species per window`;
}
loadSettings();
$('threshold-range').value = $('threshold').value;
$('clip-options').hidden = !$('extract_clips').checked;
for (const k of FIELDS) $(k).addEventListener('change', () => { checkTopK(); saveSettings(); settingsLine(); });
$('threshold-range').addEventListener('input', () => { $('threshold').value = Number($('threshold-range').value).toFixed(2); settingsLine(); });
$('threshold-range').addEventListener('change', () => $('threshold').dispatchEvent(new Event('change')));
$('threshold').addEventListener('input', () => { $('threshold-range').value = $('threshold').value; });
$('extract_clips').addEventListener('change', () => { $('clip-options').hidden = !$('extract_clips').checked; });
$('backend').addEventListener('change', () => location.reload());
settingsLine();

// ── Day and night ─────────────────────────────────────────────────────────────────────────────────────────
// The page follows the system until the user picks the other mode; picking the system's mode follows it again
const systemDark = matchMedia('(prefers-color-scheme: dark)');
const isDark = () => (document.documentElement.dataset.theme ?? (systemDark.matches ? 'dark' : 'light')) === 'dark';
function labelTheme() {
  const label = isDark() ? 'Day mode' : 'Night mode';
  $('theme').setAttribute('aria-label', label);
  $('theme').title = label;
}
$('theme').addEventListener('click', () => {
  const next = isDark() ? 'light' : 'dark';
  const differs = (next === 'dark') !== systemDark.matches;
  if (differs) document.documentElement.dataset.theme = next;
  else delete document.documentElement.dataset.theme;
  try { if (differs) localStorage.setItem('apus.theme', next); else localStorage.removeItem('apus.theme'); }
  catch { /* storage blocked: the choice lasts until the page closes */ }
  labelTheme();
});
systemDark.addEventListener('change', labelTheme);
labelTheme();

// ── Small helpers ─────────────────────────────────────────────────────────────────────────────────────────
function alertBox(text) { $('alert').hidden = !text; $('alert').textContent = text || ''; }
function log(lines) {
  for (const line of lines) {
    const li = document.createElement('li');
    li.textContent = line;
    $('log').append(li);
  }
}
// A confirmation that names its consequence; resolves true when the user picks `yes`
function ask(text, yes, destructive = false) {
  const dialog = $('ask');
  $('ask-text').textContent = text;
  $('ask-yes').textContent = yes;
  $('ask-yes').classList.toggle('danger', destructive);
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise((resolve) => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'yes'), { once: true }));
}

// ── The worker ────────────────────────────────────────────────────────────────────────────────────────────
const worker = new Worker('worker.js', { type: 'module' });
worker.postMessage({ type: 'init', backend: $('backend').value });
worker.onmessage = ({ data }) => handlers[data.type]?.(data);

function chip(text, progress, mode = '') {
  $('model-text').textContent = text;
  $('model-bar').style.width = progress == null ? '0' : `${Math.round(progress * 100)}%`;
  $('model').classList.toggle('ready', mode === 'ready');
  $('model').classList.toggle('failed', mode === 'failed');
}

const handlers = {
  status: ({ text, progress }) => {
    if (state.running) $('progress-text').textContent = text;
    else chip(progress == null ? `${text}…` : `${text}: ${Math.round(progress * 100)}%`, progress);
  },
  ready: ({ backend, note }) => {
    state.ready = true;
    chip(`Perch 2.0 ready · ${backend}`, null, 'ready');
    if (note) log([note]);
    if (!self.crossOriginIsolated) log(['This page is not cross-origin isolated, so the CPU uses one thread (slower).']);
    updateRun();
  },
  log: ({ lines }) => log(lines),
  progress: ({ file, i, n, done, total, rate }) => {
    const pct = (100 * done) / Math.max(total, 1);
    $('bar-fill').style.width = `${pct}%`;
    $('bar').setAttribute('aria-valuenow', Math.round(pct));
    $('progress-pct').textContent = `${Math.floor(pct)}%`;
    const left = (total - done) / Math.max(rate, 1e-9);
    $('progress-text').textContent = `Recording ${i} of ${n}: ${file} · ${rate.toFixed(1)} windows/s · ` +
      `${left < 90 ? `${Math.max(1, Math.round(left))} s` : `about ${Math.round(left / 60)} min`} left`;
  },
  'confirm-replace': async () => {
    if (await ask('The output already holds results. Replace them with this run?', 'Replace', true)) start(true);
    else finish();
  },
  done: ({ result, backend, saved, windows, seconds, prepSeconds, modelSeconds }) => {
    finish();
    showResults(result, backend, saved, windows, seconds);
    log([`Timing: ${windows} windows in ${seconds.toFixed(1)} s: preparing audio ${prepSeconds.toFixed(1)} s, ` +
         `model ${modelSeconds.toFixed(1)} s.`]);
  },
  stopped: () => {
    finish();
    alertBox('Stopped. Run again with "Continue a stopped run" on (in Advanced) to carry on where it stopped.');
  },
  error: ({ message }) => {
    finish();
    if (!state.ready) chip('Perch could not start', null, 'failed');
    alertBox(message);
  },
};

// ── Choices ───────────────────────────────────────────────────────────────────────────────────────────────
const pick = (button, input) => $(button).addEventListener('click', () => $(input).click());
pick('pick-folder', 'folder-input');
pick('pick-files', 'files-input');
pick('pick-list-file', 'list-file-input');
pick('pick-list-folder', 'list-folder-input');
pick('pick-syn', 'syn-input');

const topFolder = (f) => f.webkitRelativePath.split('/')[0];

// `items` are {file, rel}: rel is the path inside the chosen folder, starting with its name, or the file's name
function setRecordings(items, folder) {
  const audio = items.filter(({ file }) => AUDIO.test(file.name));
  if (!audio.length) { alertBox('There are no audio files there. Choose WAV, FLAC or OGG files, or a folder of them.'); return; }
  alertBox('');
  const top = folder ? items[0].rel.split('/')[0] : 'recordings';
  state.inputDir = `in/${top}`;
  state.recordings = items.map(({ file, rel }) => ({ path: `in/${folder ? rel : `recordings/${file.name}`}`, file }));
  const datasets = new Set(audio.map(({ rel }) => { const parts = rel.split('/'); return parts.length > 2 ? parts[1] : top; }));
  const gb = audio.reduce((s, { file }) => s + file.size, 0) / 1e9;
  $('recordings-summary').textContent = `${audio.length} recording${audio.length === 1 ? '' : 's'} in ` +
    `${datasets.size} dataset${datasets.size === 1 ? '' : 's'} (${gb < 0.1 ? `${Math.round(gb * 1000)} MB` : `${gb.toFixed(1)} GB`})` +
    (folder ? ` from ${top}` : '');
  $('recordings').classList.add('chosen');
  updateRun();
}
$('folder-input').addEventListener('change', (e) =>
  setRecordings([...e.target.files].map((f) => ({ file: f, rel: f.webkitRelativePath })), true));
$('files-input').addEventListener('change', (e) =>
  setRecordings([...e.target.files].map((f) => ({ file: f, rel: f.name })), false));

// Drag and drop anywhere on the page: one folder is read like a chosen folder, loose files like chosen files
async function walk(entry, out) {
  if (entry.isFile) {
    out.push({ file: await new Promise((ok, fail) => entry.file(ok, fail)), rel: entry.fullPath.replace(/^\//, '') });
    return;
  }
  const reader = entry.createReader();     // gives a folder's entries in batches, then an empty one
  for (let batch; (batch = await new Promise((ok, fail) => reader.readEntries(ok, fail))).length;) {
    for (const child of batch) await walk(child, out);
  }
}
addEventListener('dragover', (e) => {
  e.preventDefault();                      // also stops the browser from opening a file dropped elsewhere
  if (!state.running) document.body.classList.add('dragging');
});
addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('dragging'); });
addEventListener('drop', async (e) => {
  e.preventDefault();
  document.body.classList.remove('dragging');
  if (state.running) return;
  const entries = [...e.dataTransfer.items].map((item) => item.webkitGetAsEntry?.()).filter(Boolean);  // read before any await
  const folders = entries.filter((entry) => entry.isDirectory);
  if (folders.length && entries.length > 1) { alertBox('Drop one folder, or one or more audio files.'); return; }
  if (!entries.length) {
    setRecordings([...e.dataTransfer.files].map((f) => ({ file: f, rel: f.name })), false);
    return;
  }
  const items = [];
  try { for (const entry of entries) await walk(entry, items); }
  catch { alertBox('That folder could not be read. Choose it with "Choose a folder" instead.'); return; }
  setRecordings(items, folders.length === 1);
});

function setList(files, folder) {
  if (!files.length) return;
  state.list = files.map((f) => ({ path: `lists/${folder ? f.webkitRelativePath : f.name}`, file: f }));
  state.listPath = `/data/lists/${folder ? topFolder(files[0]) : files[0].name}`;
  $('list-name').textContent = folder ? `${topFolder(files[0])} (${files.length} files)` : files[0].name;
  $('list-name').parentElement.classList.add('set');
  $('clear-list').hidden = false;
}
$('list-file-input').addEventListener('change', (e) => setList([...e.target.files], false));
$('list-folder-input').addEventListener('change', (e) => setList([...e.target.files], true));
$('clear-list').addEventListener('click', () => {
  state.list = state.listPath = null;
  $('list-name').textContent = 'None: every Perch class is kept';
  $('list-name').parentElement.classList.remove('set');
  $('clear-list').hidden = true;
});
$('syn-input').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (!f) return;
  state.synonyms = { path: `syn/${f.name}`, file: f };
  $('syn-name').textContent = f.name;
  $('syn-name').parentElement.classList.add('set');
  $('clear-syn').hidden = false;
});
$('clear-syn').addEventListener('click', () => {
  state.synonyms = null;
  $('syn-name').textContent = 'None';
  $('syn-name').parentElement.classList.remove('set');
  $('clear-syn').hidden = true;
});

// Chrome and Edge can write the results straight into a folder; every browser can keep them and offer a ZIP
if ('showDirectoryPicker' in self) {
  $('folder-row').hidden = false;
  $('output-hint').textContent = 'Recommended: the results are written there as the run goes. ' +
    'Without a folder, they stay in this browser and you download them as a ZIP file at the end.';
  $('pick-output').addEventListener('click', async () => {
    try {
      state.folder = await showDirectoryPicker({ id: 'apus-output', mode: 'readwrite' });
      $('output-name').textContent = state.folder.name;
      $('folder-row').classList.add('set');
    } catch { /* cancelled */ }
  });
}
$('clear-stored').addEventListener('click', async () => {
  if (!await ask('Delete the results stored in this browser? Results saved in folders are kept.', 'Delete', true)) return;
  try { await (await navigator.storage.getDirectory()).removeEntry('apus-results', { recursive: true }); } catch { /* none */ }
  alertBox('');
});

// ── Run ───────────────────────────────────────────────────────────────────────────────────────────────────
function updateRun() {
  $('run').disabled = !(state.ready && state.recordings) || state.running;
  $('run-hint').textContent = !state.recordings ? 'Choose your recordings first.'
    : !state.ready ? 'Waiting for Perch to load…' : '';
  $('run-hint').hidden = !$('run-hint').textContent;
  $('settings-line').hidden = !$('run-hint').hidden;
}

let wakeLock = null;
function start(replace = false) {
  checkTopK();
  const clipSpecies = $('clip_species').value.split(',').map((s) => s.trim()).filter(Boolean);
  const settings = {
    threshold: Number($('threshold').value), hop_s: Number($('hop_s').value), top_k: Number($('top_k').value),
    csv_separator: $('csv_separator').value, raven_tables: $('raven_tables').checked, resume: $('resume').checked,
    species_list: state.listPath, synonyms_file: state.synonyms ? `/data/${state.synonyms.path}` : null,
    extract_clips: $('extract_clips').checked, clips_per_band: Number($('clips_per_band').value),
    clip_extra_s: Number($('clip_extra_s').value), clip_species: clipSpecies.length ? clipSpecies : null,
  };
  const files = [...state.recordings, ...(state.list || []), ...(state.synonyms ? [state.synonyms] : [])];
  state.running = true;
  state.lastRun = { folder: state.folder };
  alertBox('');
  $('log').replaceChildren();
  $('results').hidden = true;
  $('results-empty').hidden = true;
  $('progress').hidden = false;
  $('bar-fill').style.width = '0';
  $('bar').setAttribute('aria-valuenow', 0);
  $('progress-pct').textContent = '0%';
  $('progress-text').textContent = 'Starting…';
  $('stop').hidden = false;
  updateRun();
  navigator.wakeLock?.request('screen').then((l) => { wakeLock = l; }).catch(() => {});
  worker.postMessage({ type: 'run', files, inputDir: state.inputDir, settings, folder: state.folder, replace });
}
function finish() {
  state.running = false;
  $('stop').hidden = true;
  $('progress').hidden = true;
  $('results-empty').hidden = !$('results').hidden;    // back after a stop or an error; showResults hides it
  wakeLock?.release().catch(() => {});
  wakeLock = null;
  updateRun();
}
$('run').addEventListener('click', () => start(false));
$('stop').addEventListener('click', () => { worker.postMessage({ type: 'stop' }); $('progress-text').textContent = 'Stopping…'; });
addEventListener('beforeunload', (e) => { if (state.running) e.preventDefault(); });

// ── Results ───────────────────────────────────────────────────────────────────────────────────────────────
const fmt = (v) => (typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(3) : String(v));
const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const sum = (rows, k) => rows.reduce((s, r) => s + r[k], 0);

function table(el, rows, columns, italic) {
  let sortKey = null, asc = false;
  const render = () => {
    const sorted = sortKey == null ? rows : [...rows].sort((a, b) =>
      (a[sortKey] > b[sortKey] ? 1 : a[sortKey] < b[sortKey] ? -1 : 0) * (asc ? 1 : -1));
    const head = `<thead><tr>${columns.map(([k, label]) => `<th scope="col" data-k="${k}"` +
      `${k === sortKey ? ` aria-sort="${asc ? 'ascending' : 'descending'}"` : ''}><button type="button">${label}</button></th>`).join('')}</tr></thead>`;
    const body = sorted.map((r) => `<tr>${columns.map(([k], i) =>
      `<td class="${i === 0 && italic ? 'species' : ''}">${escapeHtml(fmt(r[k]))}</td>`).join('')}</tr>`).join('');
    el.innerHTML = `${head}<tbody>${body}</tbody>`;
    el.querySelectorAll('th').forEach((th) => th.firstChild.addEventListener('click', () => {
      asc = sortKey === th.dataset.k ? !asc : th.dataset.k === columns[0][0];
      sortKey = th.dataset.k;
      render();
      el.querySelector(`th[data-k="${sortKey}"] button`).focus();
    }));
  };
  render();
}

// A bar list of the most detected species, each value at the tip of its bar; the species table has every value
function chart(rows) {
  const top = rows.slice(0, 20);
  if (!top.length) { $('chart').innerHTML = '<p class="hint">No detections at this threshold: try a lower one.</p>'; return; }
  const max = Math.max(...top.map((r) => r.detections));
  $('chart').innerHTML = `<ol class="bars" aria-label="Detections of the ${top.length} most detected species">${top.map((r) => {
    const name = escapeHtml(r.species);
    return `<li title="${name}: ${r.detections} detections"><span class="name">${name}</span>` +
      `<span class="track"><span class="fill" style="--f: ${r.detections / max}"></span><span class="n">${r.detections}</span></span></li>`;
  }).join('')}</ol>`;
}

function tiles(result, seconds) {
  const items = [
    ['Recordings', sum(result.datasets, 'recordings_analysed')],
    ['Datasets', result.datasets.length],
    ['Detections', sum(result.species, 'detections')],
    ['Species', result.species.length],
    ['Run time', seconds < 90 ? `${Math.round(seconds)} s` : `${Math.round(seconds / 60)} min`],
  ];
  $('tiles').innerHTML = items.map(([label, value]) =>
    `<div class="tile"><span class="label">${label}</span><span class="value">${typeof value === 'number' ? value.toLocaleString('en') : value}</span></div>`).join('');
}

function showResults(result, backend, saved, windows, seconds) {
  tiles(result, seconds);
  $('summary').innerHTML = result.lines.map((l) => `<p>${escapeHtml(l)}</p>`).join('') +
    `<p>Run on ${escapeHtml(backend)}: ${windows} windows in ${Math.round(seconds)} s.</p>`;
  $('failed').hidden = !result.failed.length;
  $('failed').innerHTML = result.failed.length ? '<svg aria-hidden="true"><use href="#i-warn"/></svg>' +
    `<strong>${result.failed.length} recording${result.failed.length === 1 ? ' was' : 's were'} not analysed</strong>` +
    `<ul>${result.failed.map((f) => `<li>${escapeHtml(f.file)}: ${escapeHtml(f.error)}</li>`).join('')}</ul>` : '';
  table($('species-table'), result.species, [['species', 'Species'], ['detections', 'Detections'],
    ['recordings', 'Recordings'], ['datasets', 'Datasets'], ['mean_confidence', 'Mean confidence'],
    ['max_confidence', 'Highest confidence']], true);
  table($('dataset-table'), result.datasets, [['dataset', 'Dataset'], ['recordings_analysed', 'Recordings analysed'],
    ['recordings_with_detections', 'With detections'], ['detections', 'Detections'], ['species', 'Species']], false);
  chart(result.species);
  log([...result.messages, ...result.failed.map((f) => `⚠ Not analysed: ${f.file} (${f.error})`)]);
  const downloads = $('downloads');
  downloads.replaceChildren();
  if (saved === 'folder') {
    downloads.innerHTML = `<p class="hint">Saved in the folder <strong>${escapeHtml(state.lastRun.folder.name)}</strong></p>`;
  } else {
    const button = document.createElement('button');
    button.className = 'primary';
    button.innerHTML = '<svg aria-hidden="true"><use href="#i-download"/></svg>Download the results (ZIP)';
    button.addEventListener('click', downloadZip);
    downloads.append(button);
  }
  $('results').hidden = false;
  $('results-empty').hidden = true;
  $('announce').textContent = `Done: ${sum(result.species, 'detections')} detections of ${result.species.length} species.`;
  $('results').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  $('results').focus({ preventScroll: true });
}

async function downloadZip() {
  const { zipSync } = await import('https://cdn.jsdelivr.net/npm/fflate@0.8.3/esm/browser.js');
  const files = {};
  async function walkDir(dir, prefix) {
    for await (const [name, h] of dir.entries()) {
      if (h.kind === 'directory') await walkDir(h, `${prefix}${name}/`);
      else files[`${prefix}${name}`] = new Uint8Array(await (await h.getFile()).arrayBuffer());
    }
  }
  await walkDir(await (await navigator.storage.getDirectory()).getDirectoryHandle('apus-results'), 'apus-results/');
  const url = URL.createObjectURL(new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: 'apus-results.zip' });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
