// Stage before M12 (§25 closure) — acceptance criteria derived from a natural request (pure, no model, no file access).
//
// Before, a request with no structured criteria became ONE criterion: the owner's words („Butonul de programare trebuie să ceară și
// numărul de telefon”). One sentence about a form, proven by a node test, was rejected twice by the independent test review („poate fi
// trecut de o implementare trivială”). The meaning was clear; the plan was too thin. Here the planner recognises the SHAPE of a request
// and derives the checks that shape needs, from the result asked for and the project's existing behaviour (its approved browser flows):
//
//   required_field  „X trebuie să ceară (și) Y”, „adaugă câmpul Y (obligatoriu)”, „Y să fie obligatoriu”, „formularul să conțină Y”
//                   → the field is labelled and usable in the real form (browser), a missing / empty value stops the action with a
//                     visible message (browser), the server enforces it when called directly (test), a valid request with the value is
//                     still accepted (test, „păstrare”: rejects an implementation that refuses everything), the value is kept in the
//                     saved record (test), and the existing flows keep working with the new field filled (browser, inherited).
//   refuse          „X să nu accepte / să refuze / să nu permită Y” → Y is refused with a message (test), a valid request is still
//                   accepted (test, „păstrare”).
//   hide_public     (R-PRIV) „Y rămâne obligatoriu și salvat, dar lista publică nu afișează și nu transmite Y” → two NEW checks that fail
//                   today: the public list answered by the server carries neither the property nor the value, and parameters anyone can
//                   add to that request (includeY=1, fields=Y, debug=1 …) do not bring it back; three „păstrare” checks: Y still
//                   required (refused without it, nothing saved), Y kept exactly in the app's own storage (read through its internal
//                   layer in the test, never through a public or new anonymous route), a valid request still accepted; in the browser
//                   the value never shows on the page. The option belongs to the project (hidden by default), not a global rule. An
//                   earlier Hub-written test that read Y back from the app's answers conflicts with the new contract: it is listed as
//                   superseded (kept unchanged, linked to its original version), never rewritten (conflictingHubTests).
//   generic         anything else: the owner's words as one criterion (unchanged behaviour), plus the inherited flows.
//
// Nothing is invented: no national phone format, no SMS check, no CRM, no business rule the owner did not say. The field's technical
// name follows the project's own convention (English keys: name, vehicle → phone) and is stated as an assumption, with the provenance
// of every criterion (`origin`), so the writer, the reviewers and the owner read the same contract.

const LOOSE = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[„”"“'`]/g, " ").replace(/\s+/g, " ").trim();

/** Known field nouns → the label shown to the user, the key in the project's own (English) convention and a fictive value. */
const FIELDS = Object.freeze([
  { re: /\b(?:numarul? de telefon|nr\.? de telefon|telefonul|telefon|numarul de mobil|mobilul)\b/, label: "Telefon", key: "phone", value: "0700 123 456", noun: "telefonul", gen: "telefonului", bare: "telefon" },
  { re: /\b(?:adresa de e-?mail|e-?mailul|e-?mail)\b/, label: "Email", key: "email", value: "client.demo@exemplu.test", noun: "emailul", gen: "emailului", bare: "email" },
  { re: /\b(?:numarul de inmatriculare|nr\.? de inmatriculare|numarul masinii|inmatricularea)\b/, label: "Număr de înmatriculare", key: "plate", value: "B 00 DEM", noun: "numărul de înmatriculare", gen: "numărului de înmatriculare", bare: "număr de înmatriculare" },
  { re: /\b(?:observatiile|observatii|mentiunile|mentiuni|notitele|nota)\b/, label: "Observații", key: "notes", value: "Fără observații", noun: "observațiile", gen: "observațiilor", bare: "observații" },
  { re: /\b(?:adresa|adresa clientului)\b/, label: "Adresă", key: "address", value: "Strada Demo 1", noun: "adresa", gen: "adresei", bare: "adresă" },
  { re: /\b(?:prenumele)\b/, label: "Prenume", key: "firstName", value: "Demo", noun: "prenumele", gen: "prenumelui", bare: "prenume" },
]);

const ENTITIES = Object.freeze([
  { re: /\bprogramar/, noun: "programarea", bare: "programare", art: "o programare", gen: "programării", saved: "programarea salvată", fem: true, slot: ", pe un interval liber," },
  { re: /\brezervar/, noun: "rezervarea", bare: "rezervare", art: "o rezervare", gen: "rezervării", saved: "rezervarea salvată", fem: true, slot: ", pe un interval liber," },
  { re: /\bcomand/, noun: "comanda", bare: "comandă", art: "o comandă", gen: "comenzii", saved: "comanda salvată", fem: true, slot: "" },
  { re: /\b(?:inscrier|inregistrar)/, noun: "înscrierea", bare: "înscriere", art: "o înscriere", gen: "înscrierii", saved: "înscrierea salvată", fem: true, slot: "" },
  { re: /\bcontact/, noun: "mesajul de contact", bare: "contact", art: "un mesaj de contact", gen: "mesajului de contact", saved: "mesajul salvat", fem: false, slot: "" },
]);
const DEFAULT_ENTITY = Object.freeze({ noun: "trimiterea formularului", bare: "trimiterea formularului", art: "o trimitere a formularului", gen: "formularului", saved: "datele salvate", fem: true, slot: "" });
const adj = (e, fem, masc) => (e.fem === false ? masc : fem);

const REQUIRED_VERBS = /\b(?:trebuie sa|sa|va|vreau sa|as vrea sa)?\s*(?:ceara|cera|solicite|aiba|contina|includa|primeasca)\s+(?:si\s+)?(?:campul\s+|campul de\s+)?(.{2,60})$/;
const ADD_FIELD = /\badauga(?:ti)?\s+(?:si\s+)?(?:un\s+)?camp(?:ul)?(?:\s+de|\s+pentru)?\s+(.{2,60}?)(?:\s+(?:obligatoriu|necesar))?$/;
const MANDATORY = /^(?:.*?\s)?(?:campul\s+)?(.{2,40}?)\s+(?:sa fie|e|este|devine|trebuie sa fie)\s+(?:obligatoriu|obligatorie|necesar|necesara|cerut|cerut[aă])\b/;
const REFUSE = /\b(?:sa nu (?:accepte|permita|lase)|sa refuze|nu trebuie sa (?:accepte|permita))\s+(.{3,80})$/;

function fieldOf(phrase) {
  const p = LOOSE(phrase).replace(/[.,;:!?].*$/, "").trim();
  for (const f of FIELDS) if (f.re.test(p)) return { ...f, known: true };
  const words = p.replace(/\b(?:si|un|o|campul|camp|de|al|a|clientului|utilizatorului)\b/g, " ").split(/\s+/).filter((w) => /^[a-z][a-z-]{1,24}$/.test(w)).slice(0, 3);
  if (!words.length) return null;
  const key = words.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join("").replace(/-/g, "");
  const label = words.join(" ");
  return { label: label[0].toUpperCase() + label.slice(1), key, value: "Valoare demo", noun: label, gen: label, bare: label, known: false };
}

function entityOf(plain) {
  for (const e of ENTITIES) if (e.re.test(plain)) return e;
  return DEFAULT_ENTITY;
}

/** R-PRIV: a public list / page / answer named, and the field not shown or not sent there. */
const PUBLIC_SCOPE = /\b(?:lista|listele|listei|pagina|paginile|raspunsul|raspunsurile|afisarea|vizualizarea)\b[^.;]{0,40}\bpublic(?:a|e|i|ul)?\b|\bpublic(?:a|e)?\b[^.;]{0,20}\blist/;
const WANTS_SHOWN = /\bvreau sa (?:apara|se vada|fie afisat|afiseze)|\bsa (?:apara|se vada|fie afisat[ae]?)\b|\binvers\b|\bar trebui sa (?:apara|afiseze)/;
const NOT_EXPOSED = /\bnu (?:mai )?(?:afiseaza|arata|transmite|trimite|expune|include|contine|returneaza|apare)\b|\bsa nu (?:mai )?(?:afiseze|arate|transmita|trimita|expuna|includa|contina|returneze|apara)\b|\bascun(?:de|da|s|sa)\b/;

/** The request's shape: { shape, field?, entity, refused?, keepsRequired? } from the owner's words (already without the Lega prefix). */
export function requestShape(words) {
  const plain = LOOSE(words).replace(/[.!?]+$/, "");
  const entity = entityOf(plain);
  // R-PRIV first: such a sentence may also say the field stays required („rămâne obligatoriu”), which is NOT a new required field.
  // Review F4: the field must be in the same clause as the public scope and the not-shown verb, and a wish to SEE it („vreau să apară”,
  // „să fie afișat”, „invers”) is a bug report the other way, never this shape. keepsRequired only for a „obligatoriu” that is not negated.
  if (PUBLIC_SCOPE.test(plain) && NOT_EXPOSED.test(plain) && !WANTS_SHOWN.test(plain)) {
    const clauses = plain.split(/[.;,]|\s(?:dar|insa|iar|ci)\s/).map((c) => c.trim()).filter(Boolean);
    const clause = clauses.find((c) => PUBLIC_SCOPE.test(c) && NOT_EXPOSED.test(c) && FIELDS.some((f) => f.re.test(c)))
      || clauses.find((c) => NOT_EXPOSED.test(c) && FIELDS.some((f) => f.re.test(c)) && PUBLIC_SCOPE.test(plain) && !clauses.some((o) => o !== c && NOT_EXPOSED.test(o)));
    const field = clause ? FIELDS.find((f) => f.re.test(clause)) : null;
    if (field) {
      const required = clauses.some((c) => field.re.test(c) && /\bobligatori/.test(c) && !/\bnu (?:mai )?(?:e |este |ramane |fie |sa fie )?obligatori/.test(c));
      return { shape: "hide_public", field: { ...field, known: true }, entity, keepsRequired: required };
    }
  }
  let m = plain.match(REFUSE);
  if (m) return { shape: "refuse", refused: m[1].replace(/\s+/g, " ").trim(), entity };
  m = plain.match(ADD_FIELD);
  if (m) { const field = fieldOf(m[1]); if (field) return { shape: "required_field", field, entity }; }
  m = plain.match(MANDATORY);
  if (m) { const field = fieldOf(m[1]); if (field && field.known) return { shape: "required_field", field, entity }; }
  m = plain.match(REQUIRED_VERBS);
  // An unknown noun after „să aibă / să conțină” is a field only when the owner says „câmpul” („să aibă un design nou” is not one).
  if (m) { const field = fieldOf(m[1]); if (field && (field.known || /\bcamp/.test(m[0]))) return { shape: "required_field", field, entity }; }
  return { shape: "generic", entity };
}

const stepKind = (s) => (s && typeof s === "object" ? Object.keys(s)[0] : null);

/**
 * An inherited flow with the new field filled before the submit: [expectLabel, fill] go right before the last click that precedes the
 * flow's final expectText. → steps | null when the flow has no such shape (it is then kept unchanged).
 */
export function withField(steps, field) {
  if (!Array.isArray(steps)) return null;
  const lastText = steps.map(stepKind).lastIndexOf("expectText");
  if (lastText < 1) return null;
  let submit = -1;
  for (let i = lastText - 1; i >= 0; i -= 1) if (stepKind(steps[i]) === "click") { submit = i; break; }
  if (submit < 0) return null;
  const sel = `[name='${field.key}']`;
  return [...steps.slice(0, submit), { expectLabel: { selector: sel, text: field.label } }, { fill: { selector: sel, value: field.value } }, ...steps.slice(submit)];
}

/** The same flow without the field, submitted: the field is marked invalid with a visible message and the success text never shows. */
export function withoutField(steps, field) {
  if (!Array.isArray(steps)) return null;
  const lastText = steps.map(stepKind).lastIndexOf("expectText");
  if (lastText < 1) return null;
  const success = steps[lastText].expectText;
  const sel = `[name='${field.key}']`;
  return [...steps.slice(0, lastText), { expectInvalid: sel }, { expectNoText: success }];
}

/**
 * The criteria of a natural request. `flows` are the project's approved browser flows a delivery revision inherits ([{ text, verify:
 * "e2e", steps }]; may be empty). Returns { shape, test: [{ text, guard?, origin }], browser: [{ text, verify: "e2e", steps, origin }],
 * flows: the inherited flows to keep (augmented with the field when the shape needs it), assumptions: [], constraints: [] }.
 * `generic` returns test: [] — the planner then keeps the owner's words as the single criterion (unchanged).
 */
export function deriveCriteria({ words, flows = [] } = {}) {
  const s = requestShape(words);
  const inherited = (Array.isArray(flows) ? flows : []).filter((f) => f && f.verify === "e2e" && Array.isArray(f.steps));
  const out = { shape: s.shape, test: [], browser: [], flows: inherited, assumptions: [], constraints: [] };
  if (s.shape === "required_field") {
    const { field: f, entity: e } = s;
    const said = "derivat din cererea ta";
    out.test.push(
      { text: `Serverul aplică cerința și când e apelat direct, fără browser: ${e.art} fără ${f.bare} sau cu ${f.bare} gol (doar spații) e ${adj(e, "refuzată", "refuzat")}, cu o eroare pentru câmpul ${f.label}, și nu se salvează nimic (o citire după refuz nu găsește ${e.noun})`, origin: `${said}: cerința e a aplicației, nu doar a formularului` },
      { text: `Câmpul ${f.label} trimis cu ${e.art} ${adj(e, "validă", "valid")} se păstrează în ${e.saved}: o citire separată după salvare (datele proiectului) îl regăsește, nu doar ecoul din răspunsul la creare`, origin: `${said}: valoarea cerută nu se pierde` },
      { text: `${e.art[0].toUpperCase()}${e.art.slice(1)} cu ${f.bare} și celelalte date valide${e.slot} e în continuare ${adj(e, "acceptată", "acceptat")} (control: trece azi și după)`, guard: true, origin: "comportamentul existent al proiectului: o implementare care refuză tot nu trece" },
    );
    const augmented = inherited.map((flow) => {
      const steps = withField(flow.steps, f);
      return steps ? { ...flow, text: `${String(flow.text || "").replace(/\s+$/, "")}; câmpul „${f.label}” are etichetă și se completează`, steps, origin: "fluxul existent al proiectului, cu câmpul nou completat" } : { ...flow, origin: "fluxul existent al proiectului" };
    });
    out.flows = augmented;
    const usable = inherited.filter((flow) => withoutField(flow.steps, f));
    const base = usable.find((flow) => flow.steps.some((st) => st?.viewport?.width >= 1024)) || usable[0] || null;
    if (base) {
      out.browser.push({ text: `În formular, fără ${f.bare} (câmp gol), ${e.noun} nu se finalizează: câmpul ${f.label} e marcat invalid cu un mesaj vizibil, iar confirmarea nu apare`, verify: "e2e", steps: withoutField(base.steps, f), origin: `${said}: lipsa valorii oprește acțiunea, cu un mesaj inteligibil` });
    } else {
      // No approved browser flow to start from: the form part is proven by the test against the page the app serves.
      out.test.unshift({ text: `Pagina aplicației are în formularul ${e.gen} câmpul ${f.label}, cu etichetă vizibilă, trimis odată cu celelalte date`, origin: `${said} (fără un flux de browser aprobat în proiect, verificat prin pagina servită)` });
    }
    out.assumptions.push(
      `Am înțeles: câmpul ${f.label} devine obligatoriu la ${e.bare}; verific formularul în browser, serverul apelat direct, păstrarea valorii și că restul aplicației merge ca înainte`,
      `Numele tehnic al câmpului: „${f.key}” (după convenția proiectului, ca name / vehicle); eticheta văzută de client: „${f.label}”`,
      `Fără reguli noi nespuse: nu impun un format național, verificare prin SMS sau alt sistem; doar că valoarea nu lipsește și nu e goală`,
    );
    out.constraints.push(`Testele existente ale proiectului care creează ${e.art} fără ${f.bare} se actualizează să trimită și ${f.bare} (contractul nou); nu se șterg și nu se slăbesc`);
    return out;
  }
  if (s.shape === "hide_public") {
    const { field: f, entity: e } = s;
    const said = "derivat din cererea ta";
    const art = `${e.art[0].toUpperCase()}${e.art.slice(1)}`;
    const includeKey = `include${f.key[0].toUpperCase()}${f.key.slice(1)}`;
    out.test.push(
      { text: `Lista publică a zilei, cerută direct de la server (fără browser), nu conține câmpul „${f.key}” și nici valoarea ${f.gen}, pentru nicio ${e.bare}: nici pentru cele existente, nici pentru ${e.art} ${adj(e, "validă", "valid")} creată chiar atunci cu ${f.bare}`, origin: `${said}: lista publică nu afișează și nu transmite ${f.noun}`, kind: "public_omits" },
      { text: `Parametrii pe care oricine îi poate adăuga la cererea listei publice (de exemplu ${includeKey}=1, ${f.key}=1, fields=${f.key}, debug=1, all=1) nu fac ${f.noun} să apară: omiterea e făcută de server, nu e o opțiune a clientului`, origin: `${said}: o cale anonimă nu ocolește omiterea`, kind: "anon_params" },
    );
    if (s.keepsRequired) out.test.push({ text: `${art} fără ${f.bare} sau cu ${f.bare} gol (doar spații) e în continuare ${adj(e, "refuzată", "refuzat")} de server, cu o eroare pentru câmpul ${f.label}, și nu se salvează nimic (control: trece azi și după)`, guard: true, origin: `cererea ta: ${f.noun} rămâne obligatoriu`, kind: "required_refusal" });
    out.test.push(
      { text: `${f.label} trimis cu ${e.art} ${adj(e, "validă", "valid")} se păstrează exact în datele salvate ale aplicației: testul citește înregistrarea prin stocarea internă a aplicației în mediul de test (fișierul sau stratul ei de date), nu printr-o rută publică; nu se adaugă nicio rută anonimă pentru recitirea ${f.gen} (control: trece azi și după)`, guard: true, origin: `cererea ta: ${f.noun} e salvat corect`, kind: "internal_persistence" },
      { text: `${art} cu ${f.bare} și celelalte date valide${e.slot} e în continuare ${adj(e, "acceptată", "acceptat")} (control: trece azi și după)`, guard: true, origin: "comportamentul existent al proiectului: o implementare care refuză tot nu trece", kind: "valid_accepted" },
    );
    const augmented = inherited.map((flow) => {
      const steps = withField(flow.steps, f);
      return steps ? { ...flow, text: `${String(flow.text || "").replace(/\s+$/, "")}; câmpul „${f.label}” are etichetă și se completează`, steps, origin: "fluxul existent al proiectului, cu câmpul completat" } : { ...flow, origin: "fluxul existent al proiectului" };
    });
    out.flows = augmented;
    const shown = augmented.find((flow) => flow.steps.some((st) => st?.viewport?.width >= 1024) && flow.steps.some((st) => stepKind(st) === "fill" && st.fill?.value === f.value))
      || augmented.find((flow) => flow.steps.some((st) => stepKind(st) === "fill" && st.fill?.value === f.value)) || null;
    if (shown) out.browser.push({ text: `În pagină, după ${e.art} cu ${f.bare} completat, valoarea ${f.gen} nu apare în textul paginii (lista zilei inclusă)`, verify: "e2e", steps: [...shown.steps, { expectNoText: f.value }], origin: `${said}: lista publică nu afișează ${f.noun}` });
    out.assumptions.push(
      `Am înțeles: ${f.noun} rămâne ${s.keepsRequired ? "obligatoriu și " : ""}salvat, dar lista publică a zilei nu îl mai trimite și nu îl afișează; verific serverul apelat direct (cu și fără parametri adăugați), pagina, păstrarea valorii în datele interne și că restul aplicației merge ca înainte`,
      `Opțiunea aparține acestui proiect (configurația lui, pe server), cu ${f.noun} ascuns implicit; nu schimb alte proiecte și nu adaug login, administrare sau roluri; o eventuală opțiune de diagnostic pentru date sintetice e doar pe server, explicită, nu un parametru de cerere`,
      `Ascunderea prin CSS nu e suficientă: câmpul „${f.key}” nu pleacă deloc de pe server în lista publică; răspunsul la crearea ${e.gen} nu e lista publică`,
    );
    out.constraints.push(`Nu se adaugă nicio rută anonimă care recitește ${f.noun}; persistența se verifică prin stocarea internă a aplicației, în test`);
    return out;
  }
  if (s.shape === "refuse") {
    out.test.push(
      { text: `Aplicația refuză ${s.refused}, cu un mesaj clar, și nu salvează nimic`, origin: "derivat din cererea ta" },
      { text: `O cerere validă (fără ${s.refused}) e în continuare acceptată (control: trece azi și după)`, guard: true, origin: "comportamentul existent al proiectului: o implementare care refuză tot nu trece" },
    );
    out.assumptions.push(`Am înțeles: aplicația refuză ${s.refused}; verific refuzul, mesajul și că cererile valide merg ca înainte`);
    return out;
  }
  return out;
}

/**
 * R-PRIV: the earlier Hub-written tests of the project (`hubTests`: [{ ref, sha256, text, missionId?, specVersion? }]) that a hide_public
 * request makes incompatible — a test that READS the field's value back from the app's answers (an assert on `.<key>` outside an
 * `errors.` object) in a file that also reads through a GET. Such a test belonged to the earlier contract; it is superseded (kept unchanged,
 * linked to its version), never rewritten to pass. A test that only checks the refusal of a missing value (errors.<key>) stays compatible.
 * Closure R-SUP: these are CANDIDATES only. A candidate is retired only with the explicit contract of factory/supersede.mjs
 * retirementContract (provenance, the public route the case reads, the coverage of every other case), checked again before the move.
 * → [{ testRef, sha256, missionId, specVersion, reason }]
 */
export function conflictingHubTests({ field, hubTests = [] } = {}) {
  if (!field?.key || !/^[A-Za-z][A-Za-z0-9]{0,40}$/.test(field.key)) return [];
  const key = field.key;
  const out = [];
  for (const t of Array.isArray(hubTests) ? hubTests : []) {
    const text = String(t?.text || "");
    if (!/^test\/hub\/[a-z0-9][a-z0-9-]{0,63}\.test\.mjs$/.test(String(t?.ref || "")) || !/^[0-9a-f]{64}$/.test(String(t?.sha256 || ""))) continue;
    // Review F5: the variables bound to a GET answer (httpGet(…), fetch(…) without a POST/PUT/PATCH/DELETE method, request(…, "GET")).
    const vars = new Set();
    for (const m of text.matchAll(/(?:const|let|var)\s+(?:\{[^}]*\}|([A-Za-z_$][\w$]*))\s*=\s*await\s+([A-Za-z_$][\w$.]*)\(([^;]*?)\)\s*;/g)) {
      const callee = m[2], args = m[3] || "";
      const isGet = /httpGet|(?:^|\.)get$/i.test(callee) || (/fetch|request/i.test(callee) && !/["'`](?:POST|PUT|PATCH|DELETE)["'`]/i.test(args) && (/fetch/i.test(callee) || /["'`]GET["'`]/i.test(args)));
      if (!isGet) continue;
      if (m[1]) vars.add(m[1]);
      else for (const d of m[0].match(/\{([^}]*)\}/)[1].split(",")) { const n = d.split(":").pop().trim(); if (/^[A-Za-z_$][\w$]*$/.test(n)) vars.add(n); }
    }
    if (!vars.size) continue;
    const names = [...vars].map((v) => v.replace(/\$/g, "\\$")).join("|");
    const readOfGet = new RegExp(`\\b(?:${names})\\b[\\w$.?\\[\\]"'\`\\s]*?(?:\\.${key}\\b|\\[["'\`]${key}["'\`]\\])`);
    // One statement at a time (an assert spread over lines included); a refusal check on errors.<key> is compatible and ignored.
    const statements = text.split(";").map((st) => st.replace(/\berrors?\??\.\w+/g, " "));
    const reads = statements.some((st) => /\bassert\b/.test(st) && readOfGet.test(st));
    if (!reads) continue;
    out.push({ testRef: t.ref, sha256: t.sha256, missionId: t.missionId || null, specVersion: Number.isInteger(t.specVersion) ? t.specVersion : null,
      reason: `citește valoarea câmpului „${field.key}” din răspunsurile aplicației (contractul anterior); cerința nouă o scoate din lista publică` });
  }
  return out.slice(0, 10);
}
