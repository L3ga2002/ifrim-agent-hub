// Read-only preparation for a NEW coordinator-exported layout. No provider, ACL or process calls.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validIso } from "./s25-parity-safety.mjs";
import { exportIdentity } from "./s25-export-identity.mjs";

export function rehearsalInputs({ parent, commit, homeAclChangeApproved, claudeHeadroomChecked }) {
  if (!validIso(homeAclChangeApproved) || !validIso(claudeHeadroomChecked)) throw new Error("Supply the actual owner ACL approval time and fresh manual Claude headroom check time");
  const hubRoot = path.join(parent, "hub");
  const { manifestSha256, fingerprint } = exportIdentity({ parent, commit });
  const args = [path.join(hubRoot, "v2/tests/manual/s25-isolated-rehearsal.mjs"), "--real", "--parent", parent,
    "--commit", commit, "--manifest-sha256", manifestSha256, "--isolation-consent", fingerprint,
    "--home-acl-change-approved", homeAclChangeApproved, "--claude-headroom-checked", claudeHeadroomChecked];
  const quote = (s) => `'${String(s).replaceAll("'", "''")}'`;
  const command = `& ${[process.execPath, ...args].map(quote).join(" ")}`;
  return { commit, parent, manifestSha256, isolationConsent: fingerprint,
    preflightOnlyPowerShell: `${command} --preflight-only`, singleRehearsalPowerShell: command,
    warning: "Choose ONE command for this fresh layout. Preflight consumes its layout. Prepare a second fresh export and recompute inputs for the single rehearsal. Never preload s25-test-guard in real mode." };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), values = {};
  const names = { "--parent": "parent", "--commit": "commit", "--home-acl-change-approved": "homeAclChangeApproved", "--claude-headroom-checked": "claudeHeadroomChecked" };
  for (let i = 0; i < args.length; i += 2) {
    if (!names[args[i]] || values[names[args[i]]] || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error("Invalid or duplicate preparation argument");
    values[names[args[i]]] = args[i + 1];
  }
  if (Object.keys(values).length !== 4) throw new Error("Required: --parent --commit --home-acl-change-approved --claude-headroom-checked");
  console.log(JSON.stringify(rehearsalInputs(values), null, 2));
}
