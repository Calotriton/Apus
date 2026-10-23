// Perch preprocessing as the notebook does it (perch-hoplite's recipe), for WAV files:
// librosa.load(sr=32000, mono=True, res_type="polyphase") -> librosa.util.frame (pad_center when
// shorter than 5 s) -> per window: remove the mean, scale the peak to 0.25.
// Every step copies the float32/float64 arithmetic of soundfile, librosa, scipy and numpy, so the
// windows match the notebook's, and the resampler works on any slice of a long file.

export const SAMPLE_RATE = 32000;
export const WINDOW = 160000;          // 5 s at 32 kHz, fixed by the model
const TARGET_PEAK = 0.25;

export function parseWav(buf) {
  const v = new DataView(buf);
  const tag = (o) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (v.byteLength < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV file');
  let o = 12, fmt = null;
  while (o + 8 <= v.byteLength) {
    const id = tag(o), size = v.getUint32(o + 4, true), body = o + 8;
    if (id === 'fmt ') {
      let format = v.getUint16(body, true);
      if (format === 0xfffe) format = v.getUint16(body + 24, true);   // WAVE_FORMAT_EXTENSIBLE sub-format
      fmt = { format, channels: v.getUint16(body + 2, true), sr: v.getUint32(body + 4, true),
              blockAlign: v.getUint16(body + 12, true), bits: v.getUint16(body + 14, true) };
    } else if (id === 'data') {
      if (!fmt) throw new Error('WAV data before its format chunk');
      const length = Math.min(size, v.byteLength - body);   // a truncated file keeps what it has
      return { ...fmt, offset: body, frames: Math.floor(length / fmt.blockAlign) };
    }
    o = body + size + (size & 1);
  }
  throw new Error('WAV file without audio data');
}

// soundfile/libsndfile's conversion to float32
function sampleReader(v, format, bits) {
  if (format === 1 && bits === 16) return (o) => v.getInt16(o, true) / 32768;
  if (format === 1 && bits === 24) return (o) => (v.getUint8(o) | (v.getUint8(o + 1) << 8) | (v.getInt8(o + 2) << 16)) / 8388608;
  if (format === 1 && bits === 32) return (o) => Math.fround(v.getInt32(o, true)) / 2147483648;
  if (format === 1 && bits === 8) return (o) => (v.getUint8(o) - 128) / 128;
  if (format === 3 && bits === 32) return (o) => v.getFloat32(o, true);
  if (format === 3 && bits === 64) return (o) => Math.fround(v.getFloat64(o, true));
  throw new Error(`unsupported WAV encoding (format ${format}, ${bits} bit)`);
}

// Mono samples [f0, f1): librosa.to_mono = float32 mean over channels
export function decodeMono(buf, wav, f0, f1) {
  const n = f1 - f0, C = wav.channels, bps = wav.blockAlign / C, out = new Float32Array(n);
  const v = new DataView(buf, wav.offset + f0 * wav.blockAlign, n * wav.blockAlign);
  const read = sampleReader(v, wav.format, wav.bits);
  for (let i = 0, o = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < C; c++, o += bps) s = Math.fround(s + read(o));
    out[i] = C === 1 ? s : s / C;
  }
  return out;
}

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

function besselI0(x) {                  // power series; scipy uses Cephes, equal to ~1e-16
  const q = (x * x) / 4;
  let sum = 1, term = 1;
  for (let k = 1; term > sum * 1e-17; k++) { term *= q / (k * k); sum += term; }
  return sum;
}

// numpy's pairwise summation (the order np.sum and np.mean use on contiguous data)
function pairwiseSum(a, i0, n, round) {
  if (n < 8) { let r = -0; for (let i = 0; i < n; i++) r = round(r + a[i0 + i]); return r; }
  if (n <= 128) {
    const r = [a[i0], a[i0 + 1], a[i0 + 2], a[i0 + 3], a[i0 + 4], a[i0 + 5], a[i0 + 6], a[i0 + 7]];
    let i = 8;
    for (; i < n - (n % 8); i += 8) for (let j = 0; j < 8; j++) r[j] = round(r[j] + a[i0 + i + j]);
    let res = round(round(round(r[0] + r[1]) + round(r[2] + r[3])) + round(round(r[4] + r[5]) + round(r[6] + r[7])));
    for (; i < n; i++) res = round(res + a[i0 + i]);
    return res;
  }
  let n2 = Math.floor(n / 2);
  n2 -= n2 % 8;
  return round(pairwiseSum(a, i0, n2, round) + pairwiseSum(a, i0 + n2, n - n2, round));
}
const f64 = (x) => x;

// scipy.signal.firwin(numtaps, cutoff, window=("kaiser", beta)), cutoff relative to Nyquist
function firwinKaiser(numtaps, cutoff, beta) {
  const alpha = 0.5 * (numtaps - 1), i0beta = besselI0(beta), h = new Float64Array(numtaps);
  for (let i = 0; i < numtaps; i++) {
    const m = i - alpha, y = Math.PI * (cutoff * m === 0 ? 1e-20 : cutoff * m);   // numpy.sinc
    const r = m / alpha;
    h[i] = cutoff * (Math.sin(y) / y) * (besselI0(beta * Math.sqrt(1 - r * r)) / i0beta);
  }
  const s = pairwiseSum(h, 0, numtaps, f64);
  for (let i = 0; i < numtaps; i++) h[i] /= s;
  return h;
}

// librosa.resample(res_type="polyphase") of a signal with nIn samples: scipy.signal.resample_poly in
// float64 (same summation order), librosa's fix_length to ceil(nIn * ratio), then float32.
// run() computes any slice of the output, so long files never have to sit in memory whole.
export class Resampler {
  constructor(srIn, nIn, srOut = SAMPLE_RATE) {
    this.nIn = nIn;
    this.same = srIn === srOut;
    if (this.same) { this.nOut = nIn; return; }
    const g = gcd(srIn, srOut), up = srOut / g, down = srIn / g;
    const maxRate = Math.max(up, down), halfLen = 10 * maxRate;
    const h = firwinKaiser(2 * halfLen + 1, 1 / maxRate, 5.0);
    for (let i = 0; i < h.length; i++) h[i] *= up;
    const nPrePad = down - (halfLen % down);
    Object.assign(this, {
      up, down, h, nPrePad,
      nPreRemove: Math.floor((halfLen + nPrePad) / down),
      nPoly: Math.ceil((nIn * up) / down),               // resample_poly's length
      nOut: Math.ceil(nIn * (srOut / srIn)),             // librosa's fix_length target (float ratio, as librosa)
    });
  }

  // input samples [k0, k1) that outputs [n0, n1) depend on
  inputRange(n0, n1) {
    if (this.same) return [Math.min(n0, this.nIn), Math.min(n1, this.nIn)];
    const { up, down, h, nPrePad, nPreRemove, nIn } = this;
    const lo = Math.ceil(((n0 + nPreRemove) * down - nPrePad - h.length + 1) / up);
    const hi = Math.floor(((n1 - 1 + nPreRemove) * down - nPrePad) / up) + 1;
    return [Math.min(Math.max(lo, 0), nIn), Math.min(Math.max(hi, 0), nIn)];
  }

  // outputs [n0, n1), given x = input samples from k0 on
  run(n0, n1, x, k0) {
    const y = new Float32Array(n1 - n0);
    if (this.same) { y.set(x.subarray(n0 - k0, Math.min(n1, this.nIn) - k0)); return y; }
    const { up, down, h, nPrePad, nPreRemove, nIn } = this, L = h.length, end = Math.min(n1, this.nPoly);
    for (let n = n0; n < end; n++) {
      const base = (n + nPreRemove) * down - nPrePad;
      const kHi = Math.min(nIn - 1, Math.floor(base / up));
      let acc = 0;
      for (let k = Math.max(0, Math.ceil((base - L + 1) / up)); k <= kHi; k++) acc += x[k - k0] * h[base - k * up];
      y[n - n0] = acc;
    }
    return y;                            // samples past resample_poly's length stay 0 (fix_length pads)
  }
}

// librosa.util.frame: windows of 5 s every hop samples; a file under 5 s gives one centred window
export const windowCount = (nOut, hop) => (nOut < WINDOW ? 1 : 1 + Math.floor((nOut - WINDOW) / hop));

// Windows [w0, w1) as one Float32Array [w1 - w0, WINDOW], read and resampled on demand
export function buildWindows(buf, wav, rs, w0, w1, hop) {
  const out = new Float32Array((w1 - w0) * WINDOW);
  const n0 = rs.nOut < WINDOW ? 0 : w0 * hop;
  const n1 = rs.nOut < WINDOW ? rs.nOut : (w1 - 1) * hop + WINDOW;
  const [k0, k1] = rs.inputRange(n0, n1);
  const y = rs.run(n0, n1, decodeMono(buf, wav, k0, k1), k0);
  if (rs.nOut < WINDOW) out.set(y, Math.floor((WINDOW - rs.nOut) / 2));   // librosa.util.pad_center
  else for (let w = w0; w < w1; w++) out.set(y.subarray(w * hop - n0, w * hop - n0 + WINDOW), (w - w0) * WINDOW);
  return out;
}

// Per window, in place: remove the float32 mean, scale the peak to TARGET_PEAK (silence stays 0)
export function peakNormalize(x, off) {
  const mean = Math.fround(pairwiseSum(x, off, WINDOW, Math.fround) / WINDOW);
  let peak = 0;
  for (let i = off; i < off + WINDOW; i++) {
    x[i] -= mean;
    const a = Math.abs(x[i]);
    if (a > peak) peak = a;
  }
  for (let i = off; i < off + WINDOW; i++) x[i] = peak > 0 ? (x[i] / peak) * TARGET_PEAK : 0;
}

export function softmax(logits, nClasses, b) {
  const out = new Float32Array(b * nClasses), e = new Float64Array(nClasses);
  for (let w = 0; w < b; w++) {
    const o = w * nClasses;
    let m = -Infinity, s = 0;
    for (let i = 0; i < nClasses; i++) if (logits[o + i] > m) m = logits[o + i];
    for (let i = 0; i < nClasses; i++) s += (e[i] = Math.exp(logits[o + i] - m));
    for (let i = 0; i < nClasses; i++) out[o + i] = e[i] / s;
  }
  return out;
}
