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
loadSettings();
$('clip-options').hidden = !$('extract_clips').checked;
for (const k of FIELDS) $(k).addEventListener('change', () => { checkTopK(); saveSettings(); });
$('extract_clips').addEventListener('change', () => { $('clip-options').hidden = !$('extract_clips').checked; });
$('backend').addEventListener('change', () => location.reload());

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

// ── The worker ────────────────────────────────────────────────────────────────────────────────────────────
const worker = new Worker('worker.js', { type: 'module' });
worker.postMessage({ type: 'init', backend: $('backend').value });
worker.onmessage = ({ data }) => handlers[data.type]?.(data);

function chip(text, progress, ready = false) {
  $('model-text').textContent = text;
  $('model-bar').style.width = progress == null ? '0' : `${Math.round(progress * 100)}%`;
  $('model').classList.toggle('ready', ready);
}
function alertBox(text) { $('alert').hidden = !text; $('alert').textContent = text || ''; }
function log(lines) {
  for (const line of lines) {
    const li = document.createElement('li');
    li.textContent = line;
    $('log').append(li);
  }
}

const handlers = {
  status: ({ text, progress }) => {
    if (state.running) $('progress-text').textContent = text;
    else chip(progress == null ? `${text}…` : `${text}: ${Math.round(progress * 100)}%`, progress);
  },
  ready: ({ backend, note }) => {
    state.ready = true;
    chip(`Perch 2.0 ready · ${backend}`, null, true);
    if (note) log([note]);
    if (!self.crossOriginIsolated) log(['This page is not cross-origin isolated, so the CPU uses one thread (slower).']);
    updateRun();
  },
  log: ({ lines }) => log(lines),
  progress: ({ file, i, n, done, total, rate }) => {
    $('bar-fill').style.width = `${(100 * done) / Math.max(total, 1)}%`;
    const left = (total - done) / Math.max(rate, 1e-9);
    $('progress-text').textContent = `Recording ${i} of ${n}: ${file} · ${rate.toFixed(1)} windows/s · ` +
      `${left < 90 ? `${Math.max(1, Math.round(left))} s` : `about ${Math.round(left / 60)} min`} left`;
  },
  'confirm-replace': () => {
    if (confirm('The output already holds results. Replace them with a new run?')) start(true);
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
    if (!state.ready) chip('Perch could not start', null);
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

function setRecordings(files, folder) {
  const audio = files.filter((f) => AUDIO.test(f.name));
  if (!audio.length) { alertBox('No audio files there (WAV, FLAC, OGG, MP3, M4A, AIFF).'); return; }
  alertBox('');
  if (folder) {
    state.inputDir = `in/${topFolder(files[0])}`;
    state.recordings = files.map((f) => ({ path: `in/${f.webkitRelativePath}`, file: f }));
  } else {
    state.inputDir = 'in/recordings';
    state.recordings = files.map((f) => ({ path: `in/recordings/${f.name}`, file: f }));
  }
  const datasets = new Set(audio.map((f) => {
    const parts = (f.webkitRelativePath || f.name).split('/');
    return parts.length > 2 ? parts[1] : (folder ? parts[0] : 'recordings');
  }));
  const gb = audio.reduce((s, f) => s + f.size, 0) / 1e9;
  $('recordings-summary').textContent = `${audio.length} recording${audio.length === 1 ? '' : 's'} in ` +
    `${datasets.size} dataset${datasets.size === 1 ? '' : 's'} (${gb < 0.1 ? `${Math.round(gb * 1000)} MB` : `${gb.toFixed(1)} GB`})` +
    (folder ? ` from ${topFolder(files[0])}` : '');
  updateRun();
}
$('folder-input').addEventListener('change', (e) => setRecordings([...e.target.files], true));
$('files-input').addEventListener('change', (e) => setRecordings([...e.target.files], false));

function setList(files, folder) {
  if (!files.length) return;
  state.list = files.map((f) => ({ path: `lists/${folder ? f.webkitRelativePath : f.name}`, file: f }));
  state.listPath = `/data/lists/${folder ? topFolder(files[0]) : files[0].name}`;
  $('list-name').textContent = folder ? `${topFolder(files[0])} (${files.length} files)` : files[0].name;
  $('clear-list').hidden = false;
}
$('list-file-input').addEventListener('change', (e) => setList([...e.target.files], false));
$('list-folder-input').addEventListener('change', (e) => setList([...e.target.files], true));
$('clear-list').addEventListener('click', () => {
  state.list = state.listPath = null;
  $('list-name').textContent = 'None: every Perch class is kept';
  $('clear-list').hidden = true;
});
$('syn-input').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (!f) return;
  state.synonyms = { path: `syn/${f.name}`, file: f };
  $('syn-name').textContent = f.name;
  $('clear-syn').hidden = false;
});
$('clear-syn').addEventListener('click', () => {
  state.synonyms = null;
  $('syn-name').textContent = 'None';
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
    } catch { /* cancelled */ }
  });
}
$('clear-stored').addEventListener('click', async () => {
  if (!confirm('Delete the results stored in this browser? Results saved in folders are not touched.')) return;
  try { await (await navigator.storage.getDirectory()).removeEntry('apus-results', { recursive: true }); } catch { /* none */ }
  alertBox('');
});

// ── Run ───────────────────────────────────────────────────────────────────────────────────────────────────
function updateRun() {
  $('run').disabled = !(state.ready && state.recordings) || state.running;
  $('run-hint').textContent = !state.recordings ? 'Choose your recordings first.'
    : !state.ready ? 'Waiting for Perch to load…' : '';
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
  $('progress').hidden = false;
  $('bar-fill').style.width = '0';
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
  wakeLock?.release().catch(() => {});
  wakeLock = null;
  updateRun();
}
$('run').addEventListener('click', () => start(false));
$('stop').addEventListener('click', () => { worker.postMessage({ type: 'stop' }); $('progress-text').textContent = 'Stopping…'; });
addEventListener('beforeunload', (e) => { if (state.running) e.preventDefault(); });

// ── Results ───────────────────────────────────────────────────────────────────────────────────────────────
const fmt = (v) => (typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(3) : String(v));

function table(el, rows, columns, italic) {
  let sortKey = null, asc = false;
  const render = () => {
    const sorted = sortKey == null ? rows : [...rows].sort((a, b) =>
      (a[sortKey] > b[sortKey] ? 1 : a[sortKey] < b[sortKey] ? -1 : 0) * (asc ? 1 : -1));
    const head = `<tr>${columns.map(([k, label]) => `<th data-k="${k}">${label}</th>`).join('')}</tr>`;
    const body = sorted.map((r) => `<tr>${columns.map(([k], i) =>
      `<td class="${i === 0 && italic ? 'species' : ''}">${escapeHtml(fmt(r[k]))}</td>`).join('')}</tr>`).join('');
    el.innerHTML = head + body;
    el.querySelectorAll('th').forEach((th) => th.addEventListener('click', () => {
      asc = sortKey === th.dataset.k ? !asc : th.dataset.k === columns[0][0];
      sortKey = th.dataset.k;
      render();
    }));
  };
  render();
}
const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function chart(rows) {
  const top = rows.slice(0, 20);
  if (!top.length) { $('chart').innerHTML = '<p class="hint">No detections at this threshold: try a lower one.</p>'; return; }
  const max = Math.max(...top.map((r) => r.detections));
  const rowH = 24, labelW = 230, width = 760, barW = width - labelW - 60;
  const bars = top.map((r, i) => {
    const y = i * rowH, w = Math.max(1, (barW * r.detections) / max);
    return `<text class="name" x="${labelW - 8}" y="${y + 16}" text-anchor="end">${escapeHtml(r.species)}</text>` +
      `<rect x="${labelW}" y="${y + 5}" width="${w}" height="${rowH - 10}" rx="3"></rect>` +
      `<text x="${labelW + w + 6}" y="${y + 16}">${r.detections}</text>`;
  }).join('');
  $('chart').innerHTML = `<svg viewBox="0 0 ${width} ${top.length * rowH}" role="img" ` +
    `aria-label="Detections of the ${top.length} most detected species">${bars}</svg>`;
}

function showResults(result, backend, saved, windows, seconds) {
  $('summary').innerHTML = result.lines.map((l) => `<p>${escapeHtml(l)}</p>`).join('') +
    `<p class="hint">Run on ${escapeHtml(backend)}: ${windows} windows in ${Math.round(seconds)} s.</p>`;
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
    downloads.innerHTML = `<p class="hint">Saved in the folder <strong>${escapeHtml(state.lastRun.folder.name)}</strong>.</p>`;
  } else {
    const button = document.createElement('button');
    button.className = 'primary';
    button.textContent = 'Download the results (ZIP)';
    button.addEventListener('click', downloadZip);
    downloads.append(button);
  }
  $('results').hidden = false;
  $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function downloadZip() {
  const { zipSync } = await import('https://cdn.jsdelivr.net/npm/fflate@0.8.3/esm/browser.js');
  const files = {};
  async function walk(dir, prefix) {
    for await (const [name, h] of dir.entries()) {
      if (h.kind === 'directory') await walk(h, `${prefix}${name}/`);
      else files[`${prefix}${name}`] = new Uint8Array(await (await h.getFile()).arrayBuffer());
    }
  }
  await walk(await (await navigator.storage.getDirectory()).getDirectoryHandle('apus-results'), 'apus-results/');
  const url = URL.createObjectURL(new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: 'apus-results.zip' });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
