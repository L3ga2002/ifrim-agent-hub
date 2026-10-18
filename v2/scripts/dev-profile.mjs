// The local development profile of THIS Hub instance (stage before M12): on → the owner's page opens the owner session without a
// Windows Hello dialog (an audited "local_dev_profile" authority, never a WebAuthn result); off → back to Windows Hello at once (the Hub
// re-reads the file within 2 s and ends the dev-profile sessions). The file lives in the Hub's private data folder and names this computer
// and this Windows account; a copy elsewhere is OFF.
//
//   node v2/scripts/dev-profile.mjs status
//   node v2/scripts/dev-profile.mjs on [--note "text"]
//   node v2/scripts/dev-profile.mjs off
import { DATA_DIR } from "./common.mjs";
import { readDevProfile, writeDevProfile } from "../server/owner/dev-profile.mjs";

const [cmd = "status", ...rest] = process.argv.slice(2);
const noteAt = rest.indexOf("--note");
const note = noteAt >= 0 ? String(rest[noteAt + 1] || "") : "";
let out;
if (cmd === "on") out = writeDevProfile(DATA_DIR, { enabled: true, note });
else if (cmd === "off") out = writeDevProfile(DATA_DIR, { enabled: false });
else if (cmd === "status") out = readDevProfile({ dataDir: DATA_DIR });
else { console.error("Folosire: node v2/scripts/dev-profile.mjs status | on [--note text] | off"); process.exit(2); }
console.log(JSON.stringify({ ...out, dataDir: DATA_DIR }, null, 2));
