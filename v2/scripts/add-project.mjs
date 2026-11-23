// 2.20 — adds one of YOUR project folders to this Hub.
//   node v2/scripts/add-project.mjs --dir "C:\Users\<tu>\IfrimHub\Proiecte\demo-magazin" [--name "Demo magazin"] [--stack "React + Node"] [--real]
// Default (a DEMO project): the folder gets the Hub's test-project marker (.ifrim-hub-test.json) and is registered as a test project,
// so L3ga's plans may give Codex WRITE access to it on this computer (Windows route). The Hub then checks the whole folder: no
// links/junctions, no secret-like files (.env, keys…), at most 5000 entries (leave node_modules and build output out).
// --real: the folder is only added to PROJECTS.md (read-only context until you enable runs in Proiecte; plans never give a writing
// agent to a real project on the Windows route — that needs the isolated wsl-runner environment).
// The folder must be a direct child of the projects folder (the parent of the Hub folder) and must not be the Hub itself.
import fs from "node:fs";
import path from "node:path";
import { HUB_ROOT, request } from "./common.mjs";

const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : null; };
const fail = (msg) => { console.error(`✗ ${msg}`); process.exit(1); };
const projectsRoot = path.resolve(HUB_ROOT, "..");
const registry = path.join(projectsRoot, "PROJECTS.md");
const MARKER = ".ifrim-hub-test.json";
const dirArg = opt("dir");
if (!dirArg) fail("Lipsește --dir <folderul proiectului>");
const dir = path.resolve(dirArg);
const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
if (!fs.existsSync(dir) || !fs.lstatSync(dir).isDirectory() || fs.lstatSync(dir).isSymbolicLink()) fail(`Folderul ${dir} nu există (sau este o scurtătură).`);
if (!same(path.dirname(dir), projectsRoot)) fail(`Proiectul trebuie să fie direct în ${projectsRoot} (mută folderul acolo).`);
if (same(dir, HUB_ROOT)) fail("Acesta este folderul Hub-ului, nu un proiect.");
const name = String(opt("name") || path.basename(dir)).trim().replace(/[\r\n#]/g, " ").slice(0, 80);
if (name.length < 2) fail("Numele trebuie să aibă cel puțin 2 caractere.");
const stack = String(opt("stack") || "").replace(/[\r\n]/g, " ").slice(0, 120);
const session = await request("GET", "/api/session");
const token = session.json?.token || null;

if (!argv.includes("--real")) {
  if (!token) fail("Pornește întâi Hub-ul (un proiect demo se înregistrează prin Hub, care îi verifică folderul).");
  const markerFile = path.join(dir, MARKER);
  if (!fs.existsSync(markerFile)) {
    fs.writeFileSync(markerFile, `${JSON.stringify({ createdBy: "ifrim-agent-hub", purpose: "live-validation", name, stack: stack || null, note: "Proiect demo adăugat cu add-project.mjs: fără date reale sau secrete." }, null, 2)}\n`, "utf8");
    console.log(`✓ Marcaj de proiect demo scris: ${markerFile}`);
  }
  const r = await request("POST", "/api/projects/test", { body: { path: dir, name }, token });
  if (r.status === 200 || r.status === 201) console.log(`✓ ${name} este înregistrat ca proiect demo${r.json?.alreadyRegistered ? " (era deja)" : ""}. Îl găsești în L3ga și în Proiecte.`);
  else fail(`Hub-ul a refuzat proiectul: ${r.json?.error?.message || r.status}. Scoate ce spune mesajul (de ex. node_modules, .env) și rulează din nou.`);
  process.exit(0);
}

const current = fs.existsSync(registry) ? fs.readFileSync(registry, "utf8") : "# Proiecte\n\nRegistrul proiectelor văzute de Ifrim Agent Hub. Fiecare secțiune `## Nume` are cel puțin linia `- Path:`.\n";
if (current.split(/\r?\n/).some((l) => /^- Path:/i.test(l) && same(l.replace(/^- Path:\s*/i, "").replace(/^`|`$/g, "").trim(), dir))) {
  console.log(`Proiectul este deja în registru (${registry}).`);
} else {
  const section = `\n## ${name}\n\n- Path: \`${dir}\`\n${stack ? `- Stack: ${stack}\n` : ""}- Status: demo\n`;
  fs.writeFileSync(registry, `${current.replace(/\s*$/, "\n")}${section}`, "utf8");
  console.log(`✓ Adăugat în ${registry}: ${name}`);
}
if (token) {
  const r = await request("POST", "/api/projects/sync", { body: {}, token });
  console.log(r.status === 200 ? "✓ Hub-ul a recitit registrul: proiectul apare în Proiecte (doar citire până permiți execuții)." : `Hub-ul nu a recitit registrul (${r.status}); repornește Hub-ul.`);
} else console.log("Hub-ul nu rulează acum; proiectul apare la următoarea pornire.");
