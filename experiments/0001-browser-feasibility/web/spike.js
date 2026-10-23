// Browser feasibility test for Apus: JS preprocessing + ONNX Runtime Web vs the notebook's TF output.
// URL options: ep=wasm|webgpu, threads=N, batch=N, gpu=high, fixture=0, long=0, tag=name
import * as ort from './ort/ort.webgpu.min.mjs';
import { parseWav, Resampler, windowCount, buildWindows, peakNormalize, softmax, WINDOW } from './audio.js';

const P = new URLSearchParams(location.search);
const cfg = {
  ep: P.get('ep') || 'wasm', threads: +(P.get('threads') || 0), batch: +(P.get('batch') || 8),
  gpu: P.get('gpu') || 'default', fixture: P.get('fixture') !== '0', long: P.get('long') !== '0',
  tag: P.get('tag') || 'run',
};
const N_CLASSES = 14795, HOP = 160000, THRESHOLD = 0.10;
const out = { cfg, ua: navigator.userAgent, cores: navigator.hardwareConcurrency,
              isolated: self.crossOriginIsolated, started: new Date().toISOString() };
const logEl = document.getElementById('log');
const log = (s) => { logEl.textContent += `${s}\n`; document.title = s.slice(0, 80); };
const post = (o) => fetch(`/results/${cfg.tag}`, { method: 'POST', body: JSON.stringify(o, null, 1) });
const getBuf = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.arrayBuffer(); };

ort.env.wasm.wasmPaths = new URL('./ort/', location.href).href;
if (cfg.threads) ort.env.wasm.numThreads = cfg.threads;

async function runFile(session, f) {
  const buf = await getBuf(f.wav), wav = parseWav(buf);
  const rs = new Resampler(wav.sr, wav.frames), nWin = windowCount(rs.nOut, HOP);
  const ref = new Float32Array(await getBuf(`ref/${f.name}.probs.f32`));
  const refWin = new Float32Array(await getBuf(`ref/${f.name}.win.f32`));
  const r = { name: f.name, sr: wav.sr, channels: wav.channels, bits: wav.bits, windows: nWin,
              windowsNotebook: f.n_windows, maxAbsWindowDiff: 0, maxAbsDp: 0, detectionsNotebook: 0,
              detectionsDiffer: 0, top10Differ: 0, preMs: 0, inferMs: 0 };
  for (let w0 = 0; w0 < nWin; w0 += cfg.batch) {
    const w1 = Math.min(nWin, w0 + cfg.batch), b = w1 - w0;
    let t = performance.now();
    const x = buildWindows(buf, wav, rs, w0, w1, HOP);
    for (let w = 0; w < b; w++) peakNormalize(x, w * WINDOW);
    r.preMs += performance.now() - t;
    for (let w = w0; w < Math.min(w1, f.n_win_saved); w++) {
      for (let i = 0; i < WINDOW; i++) {
        const d = Math.abs(x[(w - w0) * WINDOW + i] - refWin[w * WINDOW + i]);
        if (d > r.maxAbsWindowDiff) r.maxAbsWindowDiff = d;
      }
    }
    t = performance.now();
    const res = await session.run({ inputs: new ort.Tensor('float32', x, [b, WINDOW]) }, ['label']);
    const probs = softmax(res.label.data, N_CLASSES, b);
    r.inferMs += performance.now() - t;
    for (let w = 0; w < b; w++) {
      const o = w * N_CLASSES, ro = (w0 + w) * N_CLASSES;
      for (let i = 0; i < N_CLASSES; i++) {
        const p = probs[o + i], q = ref[ro + i], d = Math.abs(p - q);
        if (d > r.maxAbsDp) r.maxAbsDp = d;
        if (q >= THRESHOLD) r.detectionsNotebook++;
        if ((p >= THRESHOLD) !== (q >= THRESHOLD)) r.detectionsDiffer++;
      }
      const top = (a, s) => Array.from({ length: N_CLASSES }, (_, i) => i).sort((i, j) => a[s + j] - a[s + i]).slice(0, 10).join();
      if (top(probs, o) !== top(ref, ro)) r.top10Differ++;
    }
    if ((w0 / cfg.batch) % 10 === 0) log(`${f.name}: ${w1}/${nWin} windows, ${(w1 / ((r.preMs + r.inferMs) / 1000)).toFixed(2)} windows/s`);
  }
  r.windowsPerS = +(nWin / ((r.preMs + r.inferMs) / 1000)).toFixed(3);
  return r;
}

(async () => {
  try {
    if (cfg.ep === 'webgpu') {
      // Pick the adapter ourselves, so the report can say which GPU ran the model
      const adapter = await navigator.gpu?.requestAdapter(cfg.gpu === 'high' ? { powerPreference: 'high-performance' } : {});
      if (!adapter) throw new Error('no WebGPU adapter');
      ort.env.webgpu.adapter = adapter;
      const i = adapter.info;
      out.gpuAdapter = { vendor: i.vendor, architecture: i.architecture, description: i.description, device: i.device };
    }
    const man = await (await fetch('manifest.json')).json();
    let t = performance.now();
    const session = await ort.InferenceSession.create('model/perch_v2.onnx',
      { executionProviders: [cfg.ep], graphOptimizationLevel: 'all' });
    out.modelLoadS = +((performance.now() - t) / 1000).toFixed(2);
    out.ortWasmThreads = ort.env.wasm.numThreads;
    log(`model loaded in ${out.modelLoadS} s (${cfg.ep})`);
    t = performance.now();
    await session.run({ inputs: new ort.Tensor('float32', new Float32Array(WINDOW), [1, WINDOW]) }, ['label']);
    out.firstRunS = +((performance.now() - t) / 1000).toFixed(2);
    if (cfg.fixture) {
      out.fixture = [];
      for (const f of man.files.filter((f) => !f.wav.startsWith('long/'))) out.fixture.push(await runFile(session, f));
      const fx = out.fixture;
      out.fixtureSummary = {
        windows: fx.reduce((s, r) => s + r.windows, 0),
        windowCountsMatch: fx.every((r) => r.windows === r.windowsNotebook),
        maxAbsWindowDiff: Math.max(...fx.map((r) => r.maxAbsWindowDiff)),
        maxAbsDp: Math.max(...fx.map((r) => r.maxAbsDp)),
        detectionsNotebook: fx.reduce((s, r) => s + r.detectionsNotebook, 0),
        detectionsDiffer: fx.reduce((s, r) => s + r.detectionsDiffer, 0),
        top10Differ: fx.reduce((s, r) => s + r.top10Differ, 0),
        windowsPerS: +(fx.reduce((s, r) => s + r.windows, 0) / (fx.reduce((s, r) => s + r.preMs + r.inferMs, 0) / 1000)).toFixed(3),
      };
      log(`fixture: ${JSON.stringify(out.fixtureSummary)}`);
    }
    if (cfg.long) {
      t = performance.now();
      out.long = await runFile(session, man.files.find((f) => f.wav.startsWith('long/')));
      out.long.wallS = +((performance.now() - t) / 1000).toFixed(1);
      log(`one hour: ${out.long.windowsPerS} windows/s, max |dp| ${out.long.maxAbsDp}`);
    }
    out.finished = new Date().toISOString();
    await post(out);
    log('DONE');
  } catch (e) {
    out.error = String((e && e.stack) || e);
    await post(out);
    log(`ERROR ${e}`);
  }
})();
