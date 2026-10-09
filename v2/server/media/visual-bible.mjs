import fs from "node:fs";
import path from "node:path";
import { HubError } from "../core/errors.mjs";
import { hashCanonical } from "../core/canonical.mjs";
import { tx, json, parse } from "../storage/db.mjs";

/**
 * Visual bible: the five Ifrim style presets (version 1). A preset is a complete visual language that the IR references
 * by { id, version }: fonts (role → { family, file, license, fallback? }), palette, text styles, the caption style,
 * motion, allowed transitions, colour preset, loudness target, CTA and cover rules and accepted/rejected examples.
 *
 * Units: text sizes are fractions of the canvas HEIGHT (sizeRel), letterSpacing is in em, box padding/radius are
 * fractions of the canvas height, opacity 0..1, colours #RRGGBB. Motion fades are given in ms and as frames at the
 * 30 fps reference (`fadeFrames`); consumers convert with the IR fps. The loudness target (−14 LUFS integrated,
 * −1 dBTP) is an internal editorial target, not a platform standard.
 *
 * Fonts: Segoe UI / Segoe UI Variable / Bahnschrift / Consolas are Windows system fonts — used only rasterized into
 * rendered video, never copied into packs or exports. Cascadia Code is SIL OFL 1.1 (may be shipped with its licence).
 * `resolveFonts` checks the files on THIS machine (C:/Windows/Fonts by default) and reports missing ones; a role whose
 * primary file is absent uses its declared fallback, and the substitution is reported — never silent.
 *
 * Presets are immutable per version: `seedPresets` inserts missing (id, version) rows and never overwrites a stored
 * row; a stored row whose body differs from the code is reported as a conflict (a change needs version 2).
 * I/O: the DB seed/read and font file existence checks only.
 */

const WINDOWS_LICENSE = "Font de sistem Windows (Microsoft): folosit doar rasterizat în video randat; fișierul nu se copiază în pachete sau exporturi.";
const OFL_LICENSE = "SIL Open Font License 1.1 (Cascadia Code, Microsoft): poate fi distribuit împreună cu licența; nu se vinde separat.";
const LOUDNESS = Object.freeze({ targetLufs: -14, maxTruePeakDb: -1, note: "Țintă editorială internă (−14 LUFS integrat, −1 dBTP), nu un standard de platformă." });

const F = {
  segoeVariable: { family: "Segoe UI Variable", file: "SegUIVar.ttf", license: WINDOWS_LICENSE, fallback: { family: "Segoe UI", file: "segoeui.ttf", license: WINDOWS_LICENSE } },
  segoe: { family: "Segoe UI", file: "segoeui.ttf", license: WINDOWS_LICENSE },
  segoeSemibold: { family: "Segoe UI Semibold", file: "seguisb.ttf", license: WINDOWS_LICENSE, fallback: { family: "Segoe UI", file: "segoeuib.ttf", license: WINDOWS_LICENSE } },
  segoeBold: { family: "Segoe UI", file: "segoeuib.ttf", license: WINDOWS_LICENSE },
  segoeLight: { family: "Segoe UI Light", file: "segoeuil.ttf", license: WINDOWS_LICENSE, fallback: { family: "Segoe UI", file: "segoeui.ttf", license: WINDOWS_LICENSE } },
  bahnschrift: { family: "Bahnschrift", file: "bahnschrift.ttf", license: WINDOWS_LICENSE, fallback: { family: "Segoe UI", file: "segoeui.ttf", license: WINDOWS_LICENSE } },
  cascadia: { family: "Cascadia Code", file: "CascadiaCode.ttf", license: OFL_LICENSE, fallback: { family: "Consolas", file: "consola.ttf", license: WINDOWS_LICENSE } },
};

const style = (font, sizeRel, weight, color, extra = {}) => ({ font, sizeRel, weight, color, box: null, opacity: 1, letterSpacing: 0, uppercase: false, lineHeight: 1.15, shadow: null, ...extra });
const box = (color, opacity, padRel = 0.008, radiusRel = 0.006) => ({ color, opacity, padRel, radiusRel });

function deepFreeze(o) {
  if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); }
  return o;
}

export const PRESETS = deepFreeze({
  "ifrim-tech": {
    id: "ifrim-tech", version: 1, title: "Ifrim Tech",
    summary: "Demonstrații de produs clare și precise: grafit, accent cyan electric, casete de text semi-transparente, zoom-uri scurte pe detalii.",
    pace: "mediu-rapid",
    fonts: { display: F.segoeVariable, body: F.segoe, mono: F.cascadia },
    palette: { base: "#0B0D10", surface: "#151A21", text: "#F2F5F8", textMuted: "#9AA6B2", accent: "#2BD4FF", accentSoft: "#0E3A47", warning: "#FFB547", danger: "#FF5C5C" },
    textStyles: {
      hook: style("display", 0.052, 700, "#F2F5F8", { box: box("#0B0D10", 0.72), letterSpacing: -0.01 }),
      title: style("display", 0.042, 600, "#F2F5F8"),
      body: style("body", 0.03, 400, "#F2F5F8", { box: box("#151A21", 0.7) }),
      label: style("mono", 0.022, 400, "#2BD4FF", { box: box("#0B0D10", 0.8, 0.005), uppercase: true, letterSpacing: 0.04 }),
      cta: style("display", 0.04, 700, "#0B0D10", { box: box("#2BD4FF", 1, 0.012, 0.01) }),
      lower_third: style("body", 0.026, 600, "#F2F5F8", { box: box("#0B0D10", 0.75) }),
      code: style("mono", 0.026, 400, "#7FE6FF", { box: box("#0B0D10", 0.85) }),
    },
    captionStyle: { font: "display", sizeRel: 0.036, weight: 600, color: "#FFFFFF", box: box("#0B0D10", 0.62, 0.007), outlineColor: "#000000", outlineRel: 0, shadowRel: 0,
      anchor: "bottom", letterSpacing: 0, uppercase: false, maxChars: 32, maxLines: 2, highlight: "#2BD4FF" },
    motion: { fadeMs: 267, fadeFrames: 8, referenceFps: 30, maxZoom: 1.12, easing: "inOut", textIn: "fade", minShotMs: 1200, demoHoldMs: 2000 },
    transitions: { allowed: ["crossfade"], default: "crossfade", maxMs: 400 },
    color: { preset: "crisp" },
    loudness: LOUDNESS,
    cta: { position: "final", minMs: 2000, maxWords: 6, rules: ["Un singur CTA, la final, verb la imperativ („Programează un demo”).", "CTA-ul nu promite rezultate nedemonstrate în video.", "Contrast: text grafit pe accent cyan, în zona sigură."] },
    cover: { maxWords: 5, rules: ["Captură reală din produs, nu mockup.", "Maximum 5 cuvinte, font display, în treimea de sus.", "Fără săgeți roșii sau fețe exagerate."] },
    examples: {
      accepted: ["Hook „Raport în 3 secunde” peste captura reală, apoi zoom 1,1× pe butonul folosit.", "Etichetă mono „SIMULATION” pe toată durata unei reconstituiri."],
      rejected: ["Text alb fără casetă peste o interfață albă.", "Zoom 1,5× care taie butonul demonstrat.", "Tranziții „glitch” sau rotiri 3D."],
    },
  },
  "ifrim-cinematic": {
    id: "ifrim-cinematic", version: 1, title: "Ifrim Cinematic",
    summary: "Povești de brand lente și atmosferice: negru profund, accent chihlimbar cald, titluri Bahnschrift rarefiate, fără casete, fade-uri lungi.",
    pace: "lent",
    fonts: { display: F.bahnschrift, body: F.segoeLight },
    palette: { base: "#07080A", surface: "#121316", text: "#F4EFE6", textMuted: "#A39E94", accent: "#E8A54B", accentSoft: "#3A2A14", warning: "#E8A54B", danger: "#D9534F" },
    textStyles: {
      hook: style("display", 0.05, 300, "#F4EFE6", { uppercase: true, letterSpacing: 0.18, shadow: { color: "#000000", opacity: 0.6, blurRel: 0.004 } }),
      title: style("display", 0.04, 300, "#F4EFE6", { uppercase: true, letterSpacing: 0.22 }),
      body: style("body", 0.028, 300, "#E6E0D5", { shadow: { color: "#000000", opacity: 0.55, blurRel: 0.003 }, lineHeight: 1.3 }),
      label: style("display", 0.02, 400, "#E8A54B", { uppercase: true, letterSpacing: 0.3 }),
      cta: style("display", 0.034, 400, "#E8A54B", { uppercase: true, letterSpacing: 0.2 }),
      lower_third: style("body", 0.024, 300, "#F4EFE6", { letterSpacing: 0.06 }),
    },
    captionStyle: { font: "body", sizeRel: 0.032, weight: 300, color: "#F4EFE6", box: null, outlineColor: "#000000", outlineRel: 0.0015, shadowRel: 0.002, shadowColor: "#000000",
      anchor: "bottom", letterSpacing: 0.02, uppercase: false, maxChars: 38, maxLines: 2, highlight: "#E8A54B" },
    motion: { fadeMs: 600, fadeFrames: 18, referenceFps: 30, maxZoom: 1.06, easing: "inOut", textIn: "fade", minShotMs: 2500, demoHoldMs: 3000 },
    transitions: { allowed: ["crossfade", "fade"], default: "fade", maxMs: 1000 },
    color: { preset: "warm" },
    loudness: LOUDNESS,
    cta: { position: "final", minMs: 3000, maxWords: 4, rules: ["CTA discret, chihlimbar, după ultima imagine — nu întrerupe povestea.", "Fără butoane sau stickere animate.", "Sunetul se stinge înaintea CTA-ului."] },
    cover: { maxWords: 3, rules: ["Cadru atmosferic real, cu spațiu negativ.", "Titlu de cel mult 3 cuvinte, majuscule rarefiate.", "Fără colaje sau mai mult de o față."] },
    examples: {
      accepted: ["Deschidere de 2,5 s pe biroul real, titlu rarefiat care apare în 600 ms.", "Muzică ambientală la −20 dB sub vocea din off."],
      rejected: ["Tăieturi la fiecare jumătate de secundă.", "Casete colorate de text.", "Zoom-uri rapide sau tranziții de tip „whip”."],
    },
  },
  "ifrim-devlog": {
    id: "ifrim-devlog", version: 1, title: "Ifrim Devlog",
    summary: "Jurnal de dezvoltare onest: Cascadia Code peste tot, accent verde de terminal, doar tăieturi, zoom pe cod, ritm rapid.",
    pace: "rapid",
    fonts: { display: F.cascadia, body: F.segoe, mono: F.cascadia },
    palette: { base: "#111418", surface: "#1A1F26", text: "#E6EDF3", textMuted: "#8B949E", accent: "#7EE787", accentSoft: "#163B22", warning: "#D29922", danger: "#F85149" },
    textStyles: {
      hook: style("display", 0.044, 700, "#7EE787", { box: box("#111418", 0.9, 0.009, 0.002) }),
      title: style("display", 0.036, 600, "#E6EDF3", { box: box("#111418", 0.9, 0.008, 0.002) }),
      body: style("body", 0.028, 400, "#E6EDF3", { box: box("#1A1F26", 0.88, 0.007, 0.002) }),
      label: style("mono", 0.02, 400, "#111418", { box: box("#7EE787", 1, 0.004, 0.001), uppercase: true }),
      cta: style("display", 0.034, 700, "#111418", { box: box("#7EE787", 1, 0.01, 0.002) }),
      code: style("mono", 0.026, 400, "#E6EDF3", { box: box("#0D1117", 0.95, 0.008, 0.002) }),
    },
    captionStyle: { font: "mono", sizeRel: 0.03, weight: 400, color: "#E6EDF3", box: box("#0D1117", 0.85, 0.006), outlineColor: "#000000", outlineRel: 0, shadowRel: 0,
      anchor: "bottom", letterSpacing: 0, uppercase: false, maxChars: 30, maxLines: 2, highlight: "#7EE787" },
    motion: { fadeMs: 0, fadeFrames: 0, referenceFps: 30, maxZoom: 1.25, easing: "linear", textIn: "none", minShotMs: 800, demoHoldMs: 1500 },
    transitions: { allowed: [], default: null, maxMs: 0 },
    color: { preset: "neutral" },
    loudness: LOUDNESS,
    cta: { position: "final", minMs: 1500, maxWords: 6, rules: ["CTA ca linie de terminal („→ urmărește progresul”).", "Fără promisiuni de lansare nedatate.", "Un singur link/indicație."] },
    cover: { maxWords: 6, rules: ["Captură de cod sau terminal real, lizibil la dimensiunea de miniatură.", "Text mono cu accent verde.", "Ziua/numărul episodului vizibil."] },
    examples: {
      accepted: ["Tăietură directă de la test roșu la test verde, zoom 1,2× pe linia schimbată.", "Etichetă „REPLAY” pe o rulare reluată."],
      rejected: ["Tranziții decorative între pași.", "Cod cu chei sau date personale vizibile.", "Muzică peste explicația vocală."],
    },
  },
  "ifrim-business": {
    id: "ifrim-business", version: 2, title: "Ifrim Business",
    summary: "Rezultate pentru decidenți: bază grafit-ardezie, carduri luminoase cu text închis, accent albastru încrezător, mișcare sobră.",
    pace: "mediu",
    fonts: { display: F.segoeSemibold, body: F.segoe },
    palette: { base: "#14171C", surface: "#F4F6F8", text: "#0F1419", textMuted: "#5B6673", accent: "#3D7DFF", accentSoft: "#DCE7FF", warning: "#C77700", danger: "#C62828" },
    textStyles: {
      hook: style("display", 0.046, 600, "#0F1419", { box: box("#F4F6F8", 0.96, 0.011, 0.01) }),
      title: style("display", 0.04, 600, "#F4F6F8"),
      body: style("body", 0.029, 400, "#0F1419", { box: box("#F4F6F8", 0.94, 0.009, 0.008), lineHeight: 1.25 }),
      label: style("display", 0.02, 600, "#3D7DFF", { box: box("#F4F6F8", 0.96, 0.005), uppercase: true, letterSpacing: 0.06 }),
      // Stage before M12: white on the accent #3D7DFF is 3.8:1 (QA measured 3.94:1 on the pilot's CTA); the CTA plate is the deeper
      // #2B63E0 (5.3:1), so the final call to action passes the 4.5:1 legibility rule by construction.
      cta: style("display", 0.036, 600, "#FFFFFF", { box: box("#2B63E0", 1, 0.012, 0.012) }),
      lower_third: style("body", 0.025, 600, "#0F1419", { box: box("#F4F6F8", 0.95, 0.007, 0.006) }),
      metric: style("display", 0.06, 700, "#3D7DFF", { box: box("#F4F6F8", 0.96, 0.012, 0.01) }),
    },
    captionStyle: { font: "body", sizeRel: 0.033, weight: 400, color: "#0F1419", box: box("#F4F6F8", 0.92, 0.007), outlineColor: "#000000", outlineRel: 0, shadowRel: 0,
      anchor: "bottom", letterSpacing: 0, uppercase: false, maxChars: 34, maxLines: 2, highlight: "#3D7DFF" },
    motion: { fadeMs: 333, fadeFrames: 10, referenceFps: 30, maxZoom: 1.08, easing: "linear", textIn: "slide_up", minShotMs: 1500, demoHoldMs: 2500 },
    transitions: { allowed: ["crossfade"], default: "crossfade", maxMs: 500 },
    color: { preset: "cool" },
    loudness: LOUDNESS,
    cta: { position: "final", minMs: 2500, maxWords: 7, rules: ["CTA orientat spre rezultat („Cere o estimare gratuită”).", "Cifrele din video au sursă (dovadă) și definiție.", "Nu se folosesc logo-uri de clienți fără acord scris."] },
    cover: { maxWords: 6, rules: ["Un singur rezultat măsurat, cu unitate.", "Card luminos cu text închis, accent albastru.", "Fără grafice inventate."] },
    examples: {
      accepted: ["Card „−38% timp de raportare” cu sursa în descriere, apoi demonstrația fluxului.", "Lower third cu numele rolului, nu al persoanei, fără acord."],
      rejected: ["Cifre fără bază sau definiție.", "Grafice decorative care sugerează date reale.", "Muzică dramatică sub un mesaj de business."],
    },
  },
  "ifrim-ai-lab": {
    id: "ifrim-ai-lab", version: 1, title: "Ifrim AI Lab",
    summary: "Experimente AI documentate: imagine desaturată, accent violet cu cyan secundar, Bahnschrift + Cascadia pentru metrici, etichete de dezvăluire mereu vizibile.",
    pace: "mediu",
    fonts: { display: F.bahnschrift, body: F.segoeVariable, mono: F.cascadia },
    palette: { base: "#0A0B12", surface: "#161827", text: "#ECEBFF", textMuted: "#9C9AB8", accent: "#A78BFA", accentSoft: "#2A2150", warning: "#F5C451", danger: "#FF6B8A", accentAlt: "#5EEAD4" },
    textStyles: {
      hook: style("display", 0.05, 600, "#ECEBFF", { box: box("#161827", 0.8, 0.01, 0.014), letterSpacing: 0.02 }),
      title: style("display", 0.04, 600, "#A78BFA", { letterSpacing: 0.04 }),
      body: style("body", 0.029, 400, "#ECEBFF", { box: box("#161827", 0.78, 0.008, 0.012) }),
      label: style("mono", 0.021, 400, "#0A0B12", { box: box("#A78BFA", 1, 0.005, 0.004), uppercase: true, letterSpacing: 0.05 }),
      cta: style("display", 0.036, 600, "#0A0B12", { box: box("#5EEAD4", 1, 0.012, 0.016) }),
      metric: style("mono", 0.05, 700, "#5EEAD4", { box: box("#0A0B12", 0.85, 0.01, 0.01) }),
      code: style("mono", 0.025, 400, "#ECEBFF", { box: box("#0A0B12", 0.9, 0.008, 0.008) }),
    },
    captionStyle: { font: "body", sizeRel: 0.034, weight: 500, color: "#ECEBFF", box: box("#161827", 0.7, 0.007), outlineColor: "#000000", outlineRel: 0, shadowRel: 0,
      anchor: "bottom", letterSpacing: 0.01, uppercase: false, maxChars: 32, maxLines: 2, highlight: "#A78BFA" },
    motion: { fadeMs: 400, fadeFrames: 12, referenceFps: 30, maxZoom: 1.15, easing: "inOut", textIn: "fade", minShotMs: 1500, demoHoldMs: 2500 },
    transitions: { allowed: ["crossfade", "fade"], default: "crossfade", maxMs: 600 },
    color: { preset: "mono" },
    loudness: LOUDNESS,
    cta: { position: "final", minMs: 2000, maxWords: 6, rules: ["CTA spre metodologie („Vezi experimentul complet”).", "Orice rezultat generat poartă eticheta GENERATED/SIMULATION.", "Fără afirmații de performanță fără experiment înregistrat."] },
    cover: { maxWords: 5, rules: ["Metrica principală în mono cyan, cu unitate.", "Eticheta de dezvăluire vizibilă dacă imaginea e generată.", "Fără „roboți” sau imagini stock cu creiere."] },
    examples: {
      accepted: ["Comparație A/B cu eticheta „SIMULATION” și dimensiunea eșantionului pe ecran.", "Metrică mono „latență 420 ms (n=50)”."],
      rejected: ["Imagini generate fără etichetă.", "„AI-ul a crescut vânzările” fără experiment.", "Neoane saturate peste tot."],
    },
  },
});

export const PRESET_IDS = Object.freeze(Object.keys(PRESETS));
export const presetSha = (preset) => hashCanonical(preset);

/**
 * Inserts every code preset whose (id, version) is not stored yet. Idempotent; never overwrites. With `bus`, the inserts
 * and one `content.presets.seeded` event share a transaction. → { inserted[], existing[], conflicts[{ id, version, storedSha, codeSha }] }
 */
export function seedPresets(db, clock = () => new Date(), { bus = null, actor = "system:seed" } = {}) {
  const at = clock().toISOString();
  const select = db.prepare("SELECT sha256 FROM content_style_presets WHERE id = ? AND version = ?");
  const insert = db.prepare(`INSERT OR IGNORE INTO content_style_presets (id, version, title, body_json, sha256, status, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`);
  const result = { inserted: [], existing: [], conflicts: [] };
  const work = () => {
    for (const preset of Object.values(PRESETS)) {
      const sha = presetSha(preset);
      const row = select.get(preset.id, preset.version);
      if (row) {
        if (row.sha256 === sha) result.existing.push(`${preset.id}@${preset.version}`);
        else result.conflicts.push({ id: preset.id, version: preset.version, storedSha: row.sha256, codeSha: sha });
        continue;
      }
      const info = insert.run(preset.id, preset.version, preset.title, json(preset), sha, actor, at);
      if (Number(info.changes) === 1) result.inserted.push(`${preset.id}@${preset.version}`);
      else result.existing.push(`${preset.id}@${preset.version}`);
    }
    if (bus && (result.inserted.length || result.conflicts.length)) {
      bus.append({ type: "content.presets.seeded", scopeType: "content_preset", scopeId: "visual-bible", source: "hub",
        payload: { inserted: result.inserted, conflicts: result.conflicts.map((c) => `${c.id}@${c.version}`) } });
    }
  };
  if (bus) bus.transaction(work); else tx(db, work);
  return result;
}

function rowToPreset(row) {
  const body = parse(row.body_json, null);
  if (!body || presetSha(body) !== row.sha256) {
    throw new HubError("conflict", `Presetul „${row.id}” v${row.version} din baza de date nu corespunde amprentei sale (sha256); nu este folosit.`, { code: "PRESET_TAMPERED" });
  }
  return { ...body, status: row.status, sha256: row.sha256, createdAt: row.created_at };
}

/** A stored preset (integrity-checked) or null. Without `version`, the latest ACTIVE version. */
export function getPreset(db, id, version) {
  if (typeof id !== "string" || !/^[a-z0-9][a-z0-9-]{1,40}$/.test(id)) throw new HubError("validation", "Id de preset invalid.");
  if (version !== undefined && version !== null && (!Number.isInteger(version) || version < 1)) throw new HubError("validation", "Versiunea presetului trebuie să fie un întreg ≥ 1.");
  const row = version === undefined || version === null
    ? db.prepare("SELECT * FROM content_style_presets WHERE id = ? AND status = 'active' ORDER BY version DESC LIMIT 1").get(id)
    : db.prepare("SELECT * FROM content_style_presets WHERE id = ? AND version = ?").get(id, version);
  return row ? rowToPreset(row) : null;
}

/** Summaries of the stored presets (for the Studio UI). */
export function listPresets(db) {
  return db.prepare("SELECT id, version, title, status, sha256, created_at FROM content_style_presets ORDER BY id, version").all()
    .map((r) => ({ id: r.id, version: r.version, title: r.title, status: r.status, sha256: r.sha256, createdAt: r.created_at }));
}

const FONT_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,80}\.(ttf|otf|ttc)$/i;

/**
 * Checks the preset's font files on this machine. A role whose primary file is missing uses its fallback (reported in
 * `substitutions`); a role with neither is `missing`. Only plain file names inside `fontsDir` are accepted; symlinks are
 * not followed. → { ok, fontsDir, files: { [file]: absPath }, roles: { [role]: { family, file, absPath, license, substituted } },
 *   missing: [{ role, family, file }], substitutions: [{ role, wanted, used }] }
 */
export function resolveFonts(preset, { fontsDir = "C:/Windows/Fonts" } = {}) {
  if (!preset || typeof preset !== "object" || !preset.fonts || typeof preset.fonts !== "object") throw new HubError("validation", "Presetul nu are o secțiune de fonturi.");
  let listing = null;
  try { listing = new Map(fs.readdirSync(fontsDir).map((name) => [name.toLowerCase(), name])); } catch { listing = new Map(); }
  const locate = (file) => {
    if (typeof file !== "string" || !FONT_FILE_RE.test(file) || file !== path.basename(file)) return null;
    const real = listing.get(file.toLowerCase());
    if (!real) return null;
    const abs = path.join(fontsDir, real);
    try { const st = fs.lstatSync(abs); return st.isFile() && !st.isSymbolicLink() ? abs : null; } catch { return null; }
  };
  const out = { ok: true, fontsDir, files: {}, roles: {}, missing: [], substitutions: [] };
  for (const [role, font] of Object.entries(preset.fonts)) {
    const primary = locate(font?.file);
    if (primary) {
      out.files[font.file] = primary;
      out.roles[role] = { family: font.family, file: font.file, absPath: primary, license: font.license, substituted: false };
      continue;
    }
    const fb = font?.fallback ? locate(font.fallback.file) : null;
    if (fb) {
      out.files[font.fallback.file] = fb;
      out.roles[role] = { family: font.fallback.family, file: font.fallback.file, absPath: fb, license: font.fallback.license, substituted: true };
      out.substitutions.push({ role, wanted: `${font.family} (${font.file})`, used: `${font.fallback.family} (${font.fallback.file})` });
      continue;
    }
    out.missing.push({ role, family: font?.family ?? "?", file: font?.file ?? "?" });
  }
  out.ok = out.missing.length === 0;
  return out;
}
