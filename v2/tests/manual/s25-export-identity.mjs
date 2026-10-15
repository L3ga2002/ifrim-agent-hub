// Offline identity preparation for the coordinator's fresh commit export. No provider/process/ACL operations.
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkLayout, physicalPath, exportManifest } from "./s25-parity-safety.mjs";
import { codexDeniedEntries, denyListFingerprint } from "../../server/policy/isolation.mjs";

export function exportIdentity({ parent, dedicatedRoot, commit }) {
  const hubRoot = path.join(parent, "hub"), homeDir = os.homedir();
  checkLayout({ parent, dedicatedRoot, hubRoot, projectDir: path.join(parent, "booking"), out: path.join(parent, "evidence"), homeDir, realpath: physicalPath });
  const manifest = exportManifest(hubRoot, commit);
  return { commit, dedicatedRoot, manifestSha256: manifest.sha256, files: manifest.files.length,
    fingerprint: denyListFingerprint(codexDeniedEntries({ hubRoot, homeDir })),
    provenance: "Offline digest only: coordinator must obtain this from the trusted commit archive before the rehearsal. Not independent Git tree verification." };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 6 || args[0] !== "--dedicated-root" || args[2] !== "--parent" || args[4] !== "--commit")
    throw new Error("Usage: --dedicated-root <folder created only for experiments> --parent <DEDICATED_ROOT>/<run> --commit <full SHA>");
  console.log(JSON.stringify(exportIdentity({ dedicatedRoot: args[1], parent: args[3], commit: args[5] })));
}
