// Local audio analysis for the voice gate (M06 §08–§10). Pure functions (no DOM, no network): the browser runs them on the
// microphone samples it already holds; tests run them on synthetic signals. Only the SUMMARY of a speech segment (a short
// vector of MFCC statistics + speech duration, SNR, clipping) ever leaves this module — never the audio.

export const FEATURE_VERSION = "mfcc-stats-v1";
const N_MFCC = 20; // c0..c19; c0 (energy) is not used for the speaker vector
const LIFTER = 22;

/** In-place iterative radix-2 FFT (length must be a power of two). */
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang); const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1; let ci = 0;
      for (let k = 0; k < len / 2; k += 1) {
        const ar = re[i + k]; const ai = im[i + k];
        const br = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const bi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ar + br; im[i + k] = ai + bi;
        re[i + k + len / 2] = ar - br; im[i + k + len / 2] = ai - bi;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

const hz2mel = (f) => 2595 * Math.log10(1 + f / 700);
const mel2hz = (m) => 700 * (10 ** (m / 2595) - 1);

const filterCache = new Map();
export function melFilterbank(nfft, sampleRate, nMels = 26, fmin = 60, fmax = Math.min(7600, sampleRate / 2)) {
  const key = `${nfft}:${sampleRate}:${nMels}:${fmin}:${fmax}`;
  if (filterCache.has(key)) return filterCache.get(key);
  const points = Array.from({ length: nMels + 2 }, (_, i) => mel2hz(hz2mel(fmin) + ((hz2mel(fmax) - hz2mel(fmin)) * i) / (nMels + 1)));
  const bins = points.map((f) => Math.floor(((nfft + 1) * f) / sampleRate));
  const filters = [];
  for (let m = 1; m <= nMels; m += 1) {
    const f = new Float64Array(nfft / 2 + 1);
    for (let k = bins[m - 1]; k < bins[m]; k += 1) if (k >= 0 && k < f.length) f[k] = (k - bins[m - 1]) / Math.max(1, bins[m] - bins[m - 1]);
    for (let k = bins[m]; k < bins[m + 1]; k += 1) if (k >= 0 && k < f.length) f[k] = (bins[m + 1] - k) / Math.max(1, bins[m + 1] - bins[m]);
    filters.push(f);
  }
  filterCache.set(key, filters);
  return filters;
}

function dct(values, n) {
  const N = values.length; const out = new Float64Array(n);
  for (let k = 0; k < n; k += 1) { let s = 0; for (let i = 0; i < N; i += 1) s += values[i] * Math.cos((Math.PI * k * (i + 0.5)) / N); out[k] = s; }
  return out;
}

/** Frame energies (dB) and MFCCs for a mono PCM Float32Array. */
export function analyse(pcm, sampleRate, { frameMs = 25, hopMs = 10 } = {}) {
  const frameLen = Math.round((sampleRate * frameMs) / 1000);
  const hop = Math.round((sampleRate * hopMs) / 1000);
  let nfft = 1; while (nfft < frameLen) nfft <<= 1;
  const filters = melFilterbank(nfft, sampleRate);
  const window = Float64Array.from({ length: frameLen }, (_, i) => 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (frameLen - 1)));
  const frames = [];
  for (let start = 0; start + frameLen <= pcm.length; start += hop) {
    const re = new Float64Array(nfft); const im = new Float64Array(nfft);
    let energy = 0; let prev = start > 0 ? pcm[start - 1] : 0;
    for (let i = 0; i < frameLen; i += 1) {
      const x = pcm[start + i]; energy += x * x;
      re[i] = (x - 0.97 * prev) * window[i]; prev = x;
    }
    fft(re, im);
    const power = new Float64Array(nfft / 2 + 1);
    for (let k = 0; k <= nfft / 2; k += 1) power[k] = (re[k] * re[k] + im[k] * im[k]) / nfft;
    const mel = filters.map((f) => { let s = 0; for (let k = 0; k < f.length; k += 1) s += f[k] * power[k]; return Math.log(Math.max(s, 1e-10)); });
    const c = dct(mel, N_MFCC);
    for (let k = 1; k < N_MFCC; k += 1) c[k] *= 1 + (LIFTER / 2) * Math.sin((Math.PI * k) / LIFTER);
    let low = 0; let mid = 0;
    for (let k = 0; k <= nfft / 2; k += 1) { const hz = (k * sampleRate) / nfft; if (hz < 200) low += power[k]; else if (hz < 4000) mid += power[k]; }
    frames.push({ db: 10 * Math.log10(energy / frameLen + 1e-12), mfcc: c, lowRatio: low / (mid + 1e-12) });
  }
  return { frames, hopMs };
}

/** Energy VAD with an adaptive noise floor (10th percentile) and a short hangover. */
export function speechMask(frames, { marginDb = 9, hangover = 8 } = {}) {
  if (!frames.length) return { mask: [], noiseDb: -120 };
  const sorted = frames.map((f) => f.db).sort((a, b) => a - b);
  const noiseDb = sorted[Math.floor(sorted.length * 0.1)];
  const threshold = noiseDb + marginDb;
  const mask = new Array(frames.length).fill(false);
  let hang = 0;
  for (let i = 0; i < frames.length; i += 1) {
    if (frames[i].db > threshold) { mask[i] = true; hang = hangover; } else if (hang > 0) { mask[i] = true; hang -= 1; }
  }
  return { mask, noiseDb, threshold };
}

/**
 * The summary of one segment: { version, embedding (38 numbers), speechMs, snrDb, clipping, playbackLike }. Nothing in it
 * can be turned back into the audio.
 */
export function segmentFeatures(pcm, sampleRate) {
  const { frames, hopMs } = analyse(pcm, sampleRate);
  const { mask, noiseDb } = speechMask(frames);
  const speech = frames.filter((_, i) => mask[i]);
  let clipped = 0; for (let i = 0; i < pcm.length; i += 1) if (Math.abs(pcm[i]) >= 0.99) clipped += 1;
  const speechMs = speech.length * hopMs;
  const meanDb = speech.length ? speech.reduce((s, f) => s + f.db, 0) / speech.length : noiseDb;
  const dims = N_MFCC - 1;
  const mean = new Array(dims).fill(0); const sq = new Array(dims).fill(0);
  for (const f of speech) for (let k = 1; k < N_MFCC; k += 1) { mean[k - 1] += f.mfcc[k]; sq[k - 1] += f.mfcc[k] * f.mfcc[k]; }
  const n = Math.max(1, speech.length);
  const mu = mean.map((s) => s / n);
  const sd = sq.map((s, i) => Math.sqrt(Math.max(0, s / n - mu[i] * mu[i])));
  const lowRatio = speech.length ? speech.reduce((s, f) => s + f.lowRatio, 0) / speech.length : 0;
  return { version: FEATURE_VERSION, embedding: [...mu, ...sd].map((x) => Math.round(x * 1e4) / 1e4), speechMs, snrDb: Math.round((meanDb - noiseDb) * 10) / 10,
    clipping: pcm.length ? clipped / pcm.length : 0, playbackLike: speech.length > 20 && lowRatio < 0.002 };
}

/** Energy envelope (one value per hop) used to compare the microphone with what Lega was playing at the same time. */
export function envelope(pcm, sampleRate, hopMs = 20) {
  const hop = Math.max(1, Math.round((sampleRate * hopMs) / 1000));
  const out = [];
  for (let i = 0; i + hop <= pcm.length; i += hop) { let s = 0; for (let j = 0; j < hop; j += 1) s += pcm[i + j] * pcm[i + j]; out.push(Math.sqrt(s / hop)); }
  return out;
}

/** Best Pearson correlation of two envelopes over lags up to `maxLag` steps (Lega's own voice re-entering the microphone). */
export function bestCorrelation(a, b, maxLag = 15) {
  let best = 0;
  for (let lag = -maxLag; lag <= maxLag; lag += 1) {
    const pairs = [];
    for (let i = 0; i < a.length; i += 1) { const j = i + lag; if (j >= 0 && j < b.length) pairs.push([a[i], b[j]]); }
    if (pairs.length < 10) continue;
    const ma = pairs.reduce((s, p) => s + p[0], 0) / pairs.length; const mb = pairs.reduce((s, p) => s + p[1], 0) / pairs.length;
    let num = 0; let da = 0; let db = 0;
    for (const [x, y] of pairs) { num += (x - ma) * (y - mb); da += (x - ma) ** 2; db += (y - mb) ** 2; }
    const r = da && db ? num / Math.sqrt(da * db) : 0;
    if (r > best) best = r;
  }
  return Math.round(best * 1000) / 1000;
}

/** Input devices that carry another program's audio instead of a microphone. */
export const isVirtualDevice = (label) => /cable|virtual|vb-audio|voicemeeter|stereo mix|loopback|blackhole|soundflower|what u hear/i.test(String(label || ""));
