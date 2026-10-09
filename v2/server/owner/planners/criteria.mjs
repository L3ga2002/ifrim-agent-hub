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

/** The request's shape: { shape, field?, entity, refused? } from the owner's words (already without the Lega prefix). */
export function requestShape(words) {
  const plain = LOOSE(words).replace(/[.!?]+$/, "");
  const entity = entityOf(plain);
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
      { text: `Serverul aplică cerința și când e apelat direct, fără browser: ${e.art} fără ${f.bare} sau cu ${f.bare} gol (doar spații) e ${adj(e, "refuzată", "refuzat")}, cu o eroare pentru câmpul ${f.label}, și nu se salvează nimic`, origin: `${said}: cerința e a aplicației, nu doar a formularului` },
      { text: `Câmpul ${f.label} trimis cu ${e.art} ${adj(e, "validă", "valid")} se păstrează în ${e.saved} și se poate citi înapoi după salvare (răspunsul la creare sau datele salvate)`, origin: `${said}: valoarea cerută nu se pierde` },
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
