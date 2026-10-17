/**
 * Software Factory demo fixture "booking-demo" (M11 „Ifrim Delivery”): a synthetic appointments app for a fictive detailing
 * workshop, kept in v2/fixtures/factory/booking-demo. The agreed problem is visible only on a phone width: booked slots look
 * free. The protected acceptance test already exists in the fixture and fails at baseline for exactly that reason (AC-1).
 *
 * This file has no imports and no side effects. It is registered as FACTORY_DEMOS["booking-demo"] in fixtures.mjs (with the
 * marker field data: "synthetic") and mapped in v2/scripts/create-factory-fixture.mjs (dirName, checkFile) after the M10.2
 * probe; until then nothing in the Hub imports it.
 *
 * Shape: the keys of a FACTORY_DEMOS entry (name, stack, workType, title, objective, spec — the input of factory.prepare,
 * valid for factory/spec.mjs checkSpec) plus:
 *   key, dirName, checkFile   the fixture folder, the project folder under PROJECTS_ROOT and the file the script syntax-checks
 *   data, port                the marker's data kind and the preview port of config.json (also in spec.verification.preview.url)
 *   limits                    mission limits for factory.prepare; the models are the pilot's (intel/packages.mjs PILOT_MODELS)
 *   delivery                  Hub-side presentation block. It is NOT part of the spec, so it never changes the spec hash:
 *     noun            the domain noun of the capture markers („programare desktop”, „programare mobil”)
 *     issue           the owner-facing title of the agreed problem
 *     proofSelector   visible only after a confirmed booking (the capture's proof marker)
 *     bannerSelector  the synthetic-data banner every page of the fixture shows (the capture's page guard requires it)
 *     evidenceNote    the note of the clip's evidence marker (what the highlighted booked slot proves)
 *     exportPrefix    the head of the local export folder: <exportPrefix>-<project slug>-<yyyymmdd>
 *     texts           per clip slot (hook, desktop, mobile, cta): { criteria, business, technical }. A slot's text is used
 *                     only when all its criteria are PASS; `business` and `technical` are the two tones. A text names only
 *                     criteria of its own list (the hook is gated on AC-1 alone, so it cites AC-1 alone): a criterion it is
 *                     not gated on could be NOT PASS while the text is on screen.
 *     variant         the vertical variant: platformKey and overrides { hookText, ctaText } (shorter texts for 9:16)
 * The block is read through delivery/template.mjs normalizeDeliveryBlock, which documents the same shape.
 */
const freeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};

const PREVIEW_PORT = 4620;
const ACCEPTANCE_TEST = "test/acceptance.test.mjs";

/** The approved browser flow (AC-6 on a phone width, AC-7 on desktop): the same steps, only the viewport differs. */
const bookingFlow = (viewport) => [
  { viewport },
  { goto: "/" },
  { noHorizontalOverflow: true },
  { click: "label[data-service='spalare-exterior']" },
  { click: "button[data-day='1']" },
  { expectSelector: ".slot[data-booked='true'][aria-disabled='true']" },
  { click: ".slot[data-booked='false'][aria-disabled='false']" },
  { fill: { selector: "input[name='name']", value: "Client Demo {run}" } },
  { fill: { selector: "input[name='vehicle']", value: "Autoturism test" } },
  { click: "button[type='submit']" },
  { expectText: "Programare confirmată" },
];

export const BOOKING_DEMO = freeze({
  key: "booking-demo",
  name: "Demo Livrare — Detailing (programări)",
  dirName: "ifrim-delivery-demo-detailing",
  checkFile: "src/server-app.js",
  stack: "Node.js (node:http, node:sqlite, node:test)",
  data: "synthetic",
  port: PREVIEW_PORT,
  workType: "BUGFIX",
  title: "Pe telefon, intervalele ocupate apar libere",
  objective: "Pe lățimea unui telefon (390 px), grila de programări arată intervalele ocupate ca libere: pot fi alese, iar la confirmare serverul refuză. Pe desktop afișarea este corectă. Reproduce, găsește cauza și repară minim afișarea de pe telefon, fără să schimbi afișarea de pe desktop sau API-ul.",
  spec: {
    inScope: ["public/js/slots-view.mjs", "public/styles.css (doar dacă este necesar)", "teste noi de regresie"],
    outOfScope: ["API-ul și serverul (src/)", "date reale", "autentificare, plăți, SMS, e-mail", "dependențe noi"],
    acceptance: [
      { id: "AC-1", text: "Pe telefon un interval ocupat apare indisponibil și nu poate fi ales", verify: "test", testRef: ACCEPTANCE_TEST, expectFailure: "interval_ocupat_liber_pe_mobil" },
      { id: "AC-2", text: "Pe desktop afișarea intervalelor rămâne aceeași", verify: "test", testRef: ACCEPTANCE_TEST },
      { id: "AC-3", text: "API: 201 + listă + persistență după repornire; 409 pe interval ocupat; 400 pe interval trecut / date invalide", verify: "test", testRef: ACCEPTANCE_TEST },
      { id: "AC-4", text: "Cauza și fixul sunt explicate și revizuite independent", verify: "review" },
      { id: "AC-5", text: "Preview local pornit din versiunea verificată", verify: "preview" },
      { id: "AC-6", text: "Fluxul complet în browser la lățimea unui telefon (390 px în Chromium): fără derulare orizontală, un interval ocupat este indisponibil, un interval liber se programează cu succes", verify: "e2e", steps: bookingFlow({ width: 390, height: 844 }) },
      { id: "AC-7", text: "Același flux în browser pe desktop (1280×800): un interval ocupat este indisponibil, un interval liber se programează cu succes", verify: "e2e", steps: bookingFlow({ width: 1280, height: 800 }) },
    ],
    constraints: ["Fix minim", "Fără dependențe noi", "Doar date sintetice"],
    risks: ["O corecție care atinge ramura de desktop poate schimba afișarea de acolo"],
    verification: { checks: ["node --test"], acceptance: [`node --test ${ACCEPTANCE_TEST}`], preview: { command: "node server.js", url: `http://127.0.0.1:${PREVIEW_PORT}/` } },
    workspace: { ignore: ["data"] },
    sources: {
      user: ["Pe telefon, intervalele ocupate apar libere."],
      code: [{ ref: "public/js/slots-view.mjs", note: "pe telefon, disponibilitatea unui interval se decide altfel decât pe desktop" }],
      assumptions: ["„Telefon” înseamnă lățimea de 390 px în Chromium, fără emularea unui dispozitiv", "Afișarea de pe desktop este cea corectă"],
    },
  },
  limits: { maxDurationMin: 60, maxRepairCycles: 2 },
  delivery: {
    noun: "programare",
    issue: "Pe telefon, intervalele ocupate apar libere",
    proofSelector: "[data-state='success']",
    bannerSelector: "[data-demo-banner]",
    evidenceNote: "interval ocupat pe telefon",
    exportPrefix: "demo-programari",
    variant: { platformKey: "shorts_9x16" },
    presentations: [
      {
        "key": "booking-mobile-fix",
        "version": 1,
        "label": "Corectura intervalelor ocupate pe telefon",
        "reference": {
          "label": "Specificația fixture-ului booking-demo",
          "specSha": "f0009c3896e399cc0528aff370056707ea861fb38823aa7ffe65c1b5879f910b",
          "previewCommand": "node server.js",
          "criteria": {
            "AC-1": {
              "verify": "test",
              "fp": "892f4108e69bd00652966cfd22c0ddb8c784d985c600905d14815ee2ef89e363"
            },
            "AC-2": {
              "verify": "test",
              "fp": "3a15d9b288778945b093bf3adb4a5bd11458df610deff2d1f62f59167a9458a0"
            },
            "AC-3": {
              "verify": "test",
              "fp": "2028c020e03fe1ca6a669b9e13ec63ab65fc3db271a348ad0ccefacf870516e8"
            },
            "AC-4": {
              "verify": "review",
              "fp": "95e63fe723e1eca8c872b793a1c41ae1e2e2aba05ab55c50c674f89be69c8ab6"
            },
            "AC-5": {
              "verify": "preview",
              "fp": "204cc97ad913e1338dde68ebf78cf4a071a81d950edd140a821b88e8c2725500"
            },
            "AC-6": {
              "verify": "e2e",
              "fp": "425e8c39c7ed3ad3d618bffa231e3d2cc195c0da8f2a5d6a429482bef398e487"
            },
            "AC-7": {
              "verify": "e2e",
              "fp": "12453ee91df7ffe491d77cc1adf9f7403a9faaf4046dd24b9287bf9f4a7a8cd9"
            }
          }
        },
        "anchors": [
          "AC-1"
        ],
        "clip": {
          "hook": {
            "needs": [
              "AC-1"
            ],
            "business": "Programări online pentru detailing — demo",
            "technical": "Fix verificat: intervalele ocupate pe telefon ({cite})"
          },
          "desktop": {
            "needs": [
              "AC-7"
            ],
            "business": "Clientul alege serviciul și ora",
            "technical": "E2E desktop 1280×800: PASS"
          },
          "mobile": {
            "needs": [
              "AC-1",
              "AC-6"
            ],
            "business": "Pe telefon, orele ocupate nu mai pot fi alese",
            "technical": "{cite}: interval ocupat → indisponibil (390 px)"
          },
          "cta": {
            "needs": [],
            "business": "Hai să discutăm",
            "technical": "Pachet local, gata de verificare"
          }
        },
        "variant": {
          "hookText": "Programări online — demo",
          "ctaText": "Hai să vorbim"
        },
        "summary": {
          "problem": {
            "needs": [
              "AC-1"
            ],
            "text": "Clienții care programează de pe telefon pot alege ore deja ocupate; programarea pică abia la confirmare."
          },
          "demonstrates": [
            {
              "needs": [
                "AC-1",
                "AC-6"
              ],
              "text": "Clientul își face programarea de pe telefon și nu poate alege o oră ocupată."
            },
            {
              "needs": [
                "AC-2",
                "AC-7"
              ],
              "text": "Același flux funcționează pe desktop."
            },
            {
              "needs": [
                "AC-3"
              ],
              "text": "O oră deja rezervată este refuzată, iar programarea confirmată apare imediat."
            },
            {
              "needs": [
                "AC-4"
              ],
              "text": "Corectura a fost verificată de un reviewer independent."
            }
          ],
          "how": {
            "needs": [
              "AC-6",
              "AC-7"
            ],
            "lines": [
              "Clientul alege serviciul, ziua și o oră liberă.",
              "Completează numele și mașina.",
              "Primește confirmarea programării pe loc.",
              "Orele ocupate apar indisponibile și nu pot fi alese, nici pe telefon."
            ]
          },
          "benefits": [
            {
              "needs": [
                "AC-1",
                "AC-6"
              ],
              "text": "Pe telefon, clientul vede doar orele pe care le poate rezerva."
            },
            {
              "needs": [
                "AC-2",
                "AC-7"
              ],
              "text": "Aceeași programare funcționează și pe desktop."
            },
            {
              "needs": [
                "AC-3"
              ],
              "text": "O oră ocupată nu poate fi rezervată a doua oară."
            }
          ],
          "limits": [],
          "questions": [
            "Cum primiți acum programările (telefon, mesaje, alt sistem)?",
            "Ce servicii și ce durate ar trebui să apară în listă?",
            "Cine confirmă programările și cum vreți să fiți anunțat?",
            "De pe ce dispozitive programează clienții dumneavoastră?"
          ]
        }
      },
      {
        "key": "phone-privacy",
        "version": 1,
        "label": "Telefonul nu apare în lista publică",
        "reference": {
          "label": "Specificația aprobată §25",
          "specSha": "a69b8e9f182601a2aa3c0584c6c2c45a3db9babcfb455a348eca28a1e0544da4",
          "previewCommand": "node server.js",
          "criteria": {
            "AC-1": {
              "verify": "test",
              "fp": "a99c2df4e7ea120851470370c2bc6f941704e7847a65e6863a80c561c1736fc3"
            },
            "AC-2": {
              "verify": "test",
              "fp": "9218585c5710edb0ab6d2272c2d32f56ca82bb714839059da76a8309123086b1"
            },
            "AC-3": {
              "verify": "test",
              "fp": "dae850a0f97edde6df39ddc13aeb66fdf2bdf95780e1fe059bdb53b3b19a23fb"
            },
            "AC-4": {
              "verify": "test",
              "fp": "79427072929ba99d59722ec7c54dc01b7368a13af8e24b9e9151775079c7cdef"
            },
            "AC-5": {
              "verify": "test",
              "fp": "18110f58428a25d844ede2a1a1e55afa03f14abfecf62c48a0fd500b8b0896fc"
            },
            "AC-6": {
              "verify": "preview",
              "fp": "204cc97ad913e1338dde68ebf78cf4a071a81d950edd140a821b88e8c2725500"
            },
            "AC-7": {
              "verify": "e2e",
              "fp": "dbbe27cbcae5e4c7e947c76089e7f2ce24281595c28167acc2ed5030e8ef0189"
            },
            "AC-8": {
              "verify": "e2e",
              "fp": "f426bf9669b315f0e9d3ec2a1e2c4dd23e28eca1dbcd091e7aa1de8d3f1ccef3"
            },
            "AC-9": {
              "verify": "e2e",
              "fp": "aa2e6306256676b58ce9aaecc3ea70cbf282a52dda0ef22139c5956ac0ee491c"
            },
            "AC-10": {
              "verify": "e2e",
              "fp": "61480e5e33a5753a1b6774ac7fbad04d529099ddedafd33f905fc8ace9ead62c"
            },
            "AC-11": {
              "verify": "review",
              "fp": "6b885ff9652d37fcfbe6344b8275d0cfb0b19c12b68d2e96fc09222bb2e40ef7"
            }
          }
        },
        "anchors": [
          "AC-1",
          "AC-2"
        ],
        "clip": {
          "hook": {
            "needs": [
              "AC-1",
              "AC-2",
              "AC-10"
            ],
            "business": "Programări online: telefonul nu apare în lista publică",
            "technical": "Lista publică a zilei fără telefon ({cite})"
          },
          "desktop": {
            "needs": [
              "AC-8"
            ],
            "business": "Clientul alege ora și își lasă telefonul",
            "technical": "{cite}: desktop 1280×800, câmpul „Telefon” etichetat, programare confirmată"
          },
          "mobile": {
            "needs": [
              "AC-7"
            ],
            "business": "Pe telefon, orele ocupate rămân indisponibile",
            "technical": "{cite}: 390 px, interval ocupat indisponibil, programare confirmată"
          },
          "cta": {
            "needs": [],
            "business": "Hai să discutăm",
            "technical": "Pachet local, gata de verificare"
          }
        },
        "variant": {
          "hookText": "Telefonul nu apare în lista publică — demo",
          "ctaText": "Hai să vorbim"
        },
        "summary": {
          "problem": {
            "needs": [
              "AC-1",
              "AC-2",
              "AC-3"
            ],
            "text": "Lista publică a zilei nu trebuie să afișeze sau să transmită telefonul clientului, iar telefonul rămâne obligatoriu la programare."
          },
          "demonstrates": [
            {
              "needs": [
                "AC-1"
              ],
              "text": "Lista publică a zilei, cerută direct de la server, nu conține telefonul niciunei programări testate: cele inițiale, cea păstrată după repornire și cea nouă."
            },
            {
              "needs": [
                "AC-2"
              ],
              "text": "Nici cererile anonime testate (includePhone=1, phone=1, fields=phone, debug=1, all=1) nu fac lista publică să trimită telefonul."
            },
            {
              "needs": [
                "AC-3"
              ],
              "text": "Serverul refuză în continuare o programare fără telefon (lipsă, gol sau doar spații) și nu salvează nimic."
            },
            {
              "needs": [
                "AC-9"
              ],
              "text": "În formular, fără telefon, programarea nu se finalizează, iar câmpul „Telefon” este marcat cu un mesaj vizibil."
            },
            {
              "needs": [
                "AC-4"
              ],
              "text": "Telefonul trimis cu o programare validă se păstrează exact în datele interne ale aplicației."
            },
            {
              "needs": [
                "AC-5"
              ],
              "text": "O programare validă, cu telefon, pe un interval liber, este acceptată în continuare."
            },
            {
              "needs": [
                "AC-7",
                "AC-8"
              ],
              "text": "Fluxul de programare merge pe desktop și la lățimea unui telefon (390 px, Chromium), cu câmpul „Telefon” etichetat."
            },
            {
              "needs": [
                "AC-10"
              ],
              "text": "După programare, telefonul nu apare în textul paginii, inclusiv în lista zilei."
            },
            {
              "needs": [
                "AC-11"
              ],
              "text": "Modificarea a fost revizuită independent, doar în citire."
            }
          ],
          "how": {
            "needs": [
              "AC-7",
              "AC-8",
              "AC-10"
            ],
            "lines": [
              "Clientul alege serviciul, ziua și o oră liberă.",
              "Completează numele, mașina și telefonul.",
              "Primește mesajul „Programare confirmată”.",
              "Telefonul nu apare în pagină, nici în lista zilei."
            ]
          },
          "benefits": [
            {
              "needs": [
                "AC-1",
                "AC-2",
                "AC-10"
              ],
              "text": "Telefonul clienților nu apare în lista publică a zilei, nici la cererile anonime testate."
            },
            {
              "needs": [
                "AC-3",
                "AC-4"
              ],
              "text": "Telefonul rămâne obligatoriu și se păstrează exact cum a fost trimis."
            },
            {
              "needs": [
                "AC-5",
                "AC-7",
                "AC-8"
              ],
              "text": "Programarea funcționează în continuare pe telefon și pe desktop."
            }
          ],
          "limits": [
            "Am verificat lista publică a zilei (direct de la server și cu parametrii anonimi enumerați) și textul paginii; alte rute sau exporturi nu sunt acoperite de aceste probe.",
            "Nu afirmăm o protecție completă a datelor personale (acces, criptare, conformitate): nu au fost verificate."
          ],
          "questions": [
            "Cine din echipă trebuie să vadă telefonul clientului și unde?",
            "Ce alte date ale clientului nu trebuie să apară public?",
            "Cum primiți acum programările (telefon, mesaje, alt sistem)?",
            "Cum vreți să fie anunțat clientul după programare?"
          ]
        }
      }
    ],
  },
});
