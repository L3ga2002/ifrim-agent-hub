// Preview server of the "Programări detailing" demo. Local only (127.0.0.1), synthetic data in data/, no external service.
// The port comes from config.json.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./src/server-app.js";

const here = path.dirname(fileURLToPath(import.meta.url));

/** The port in config.json: an integer between 1024 and 65535. */
function configuredPort() {
  let port;
  try { port = JSON.parse(fs.readFileSync(path.join(here, "config.json"), "utf8")).port; }
  catch { throw new Error("config.json lipsește sau nu este JSON valid"); }
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("config.json: „port” trebuie să fie un număr întreg între 1024 și 65535");
  return port;
}

try {
  const port = configuredPort();
  let server;
  try { server = await startServer({ port, dbPath: path.join(here, "data", "bookings.db") }); }
  catch (error) {
    if (error?.code === "EADDRINUSE") throw new Error(`portul ${port} este ocupat de alt proces; demo-ul nu pornește peste alt server`);
    throw error;
  }
  console.log(`Programări detailing — demo local, date sintetice: ${server.url}`);
  const stop = () => { server.close().then(() => process.exit(0), () => process.exit(1)); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
} catch (error) {
  console.error(`Demo-ul nu a pornit: ${error?.message || error}`);
  process.exit(1);
}
