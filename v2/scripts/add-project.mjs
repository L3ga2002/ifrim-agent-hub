// 2.20 — adds one of YOUR project folders to this Hub's project registry (PROJECTS.md next to the Hub folder), so the Hub sees it.
//   node v2/scripts/add-project.mjs --dir "C:\Users\<tu>\IfrimHub\Proiecte\demo-magazin" [--name "Demo magazin"] [--stack "React + Node"]
// The folder must be a direct child of the projects folder (the parent of the Hub folder) and must not be the Hub itself. The script
// only appends a section to PROJECTS.md (never edits or removes one) and then asks the running Hub to re-read the registry.
// A registered project is read-only until you enable it in the Hub (Proiecte → permite execuția), exactly like every project.
import fs from "node:fs";
import path from "node:path";
import { HUB_ROOT, request } from "./common.mjs";

const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : null; };
const fail = (msg) => { console.error(`✗ ${msg}`); process.exit(1); };
const projectsRoot = path.resolve(HUB_ROOT, "..");
const registry = path.join(projectsRoot, "PROJECTS.md");
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
const current = fs.existsSync(registry) ? fs.readFileSync(registry, "utf8") : "# Proiecte\n\nRegistrul proiectelor văzute de Ifrim Agent Hub. Fiecare secțiune `## Nume` are cel puțin linia `- Path:`.\n";
if (current.split(/\r?\n/).some((l) => /^- Path:/i.test(l) && same(l.replace(/^- Path:\s*/i, "").replace(/^`|`$/g, "").trim(), dir))) {
  console.log(`Proiectul este deja în registru (${registry}).`);
} else {
  const section = `\n## ${name}\n\n- Path: \`${dir}\`\n${stack ? `- Stack: ${stack}\n` : ""}- Status: demo\n`;
  fs.writeFileSync(registry, `${current.replace(/\s*$/, "\n")}${section}`, "utf8");
  console.log(`✓ Adăugat în ${registry}: ${name}`);
}
const session = await request("GET", "/api/session");
if (session.json?.token) {
  const r = await request("POST", "/api/projects/sync", { body: {}, token: session.json.token });
  console.log(r.status === 200 ? "✓ Hub-ul a recitit registrul: proiectul apare în Proiecte." : `Hub-ul nu a recitit registrul (${r.status}); apasă „Sincronizează” în Proiecte.`);
} else console.log("Hub-ul nu rulează acum; proiectul apare la următoarea pornire.");
