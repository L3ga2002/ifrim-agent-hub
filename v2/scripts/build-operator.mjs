// Builds the Desktop Operator helper (M10) from v2/desktop/operator/IfrimOperator.cs with the .NET Framework 4.x C# compiler that ships
// with Windows (no download, no installer). The output goes to the Hub's work dir (outside the repo and OneDrive once relocated;
// writers cannot reach it) together with a manifest binding the binary's sha256 to the source's sha256 — the Hub refuses to start a
// helper whose manifest does not match the current source. Run from the Hub root:
//   node v2/scripts/build-operator.mjs [--out <dir>]
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../server/config.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const OPERATOR_SOURCE = path.resolve(here, "..", "desktop", "operator", "IfrimOperator.cs");
const FW = path.join(process.env.WINDIR || "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319");

export const sha256File = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

export function buildOperator(outDir) {
  if (process.platform !== "win32") throw new Error("Helperul se construiește doar pe Windows.");
  const csc = path.join(FW, "csc.exe");
  if (!fs.existsSync(csc)) throw new Error(`Compilatorul C# al .NET Framework lipsește (${csc}).`);
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, "IfrimOperator.exe");
  const tmpOut = path.join(outDir, `IfrimOperator.build-${process.pid}.exe`);
  const refs = [path.join(FW, "WPF", "UIAutomationClient.dll"), path.join(FW, "WPF", "UIAutomationTypes.dll"), path.join(FW, "WPF", "WindowsBase.dll"),
    path.join(FW, "System.Web.Extensions.dll"), path.join(FW, "Microsoft.CSharp.dll"), path.join(FW, "System.Core.dll")];
  for (const r of refs) if (!fs.existsSync(r)) throw new Error(`Referința lipsește: ${r}`);
  const args = ["/nologo", "/codepage:65001", "/target:exe", "/platform:x64", "/optimize+", "/warn:3", `/out:${tmpOut}`, ...refs.map((r) => `/r:${r}`), OPERATOR_SOURCE];
  const r = spawnSync(csc, args, { encoding: "utf8", windowsHide: true, timeout: 180000 });
  if (r.status !== 0) { fs.rmSync(tmpOut, { force: true }); throw new Error(`Compilarea a eșuat:\n${(r.stdout || "") + (r.stderr || "")}`.slice(0, 6000)); }
  fs.renameSync(tmpOut, out);
  const manifest = { exe: out, sha256: sha256File(out), sourceSha256: sha256File(OPERATOR_SOURCE), builtAt: new Date().toISOString(), compiler: csc, warnings: (r.stdout || "").trim().split(/\r?\n/).filter((l) => /warning/i.test(l)).slice(0, 20) };
  fs.writeFileSync(path.join(outDir, "IfrimOperator.manifest.json"), JSON.stringify(manifest, null, 2));
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf("--out");
  const outDir = i > 0 ? path.resolve(process.argv[i + 1]) : path.dirname(loadConfig({}).desktop.operatorExe);
  try { console.log(JSON.stringify(buildOperator(outDir), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
