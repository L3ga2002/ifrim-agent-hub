// Preview server for the "Solicitare serviciu" fixture. Local only (127.0.0.1), test database, no external service.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./src/server-app.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(fs.readFileSync(path.join(here, "config.json"), "utf8"));
fs.mkdirSync(path.join(here, "data"), { recursive: true });
const app = createApp({ dbFile: path.join(here, "data", "preview.sqlite"), publicDir: path.join(here, "public") });
http.createServer(app.handle).listen(config.port, "127.0.0.1", () => console.log(`Solicitare serviciu: http://127.0.0.1:${config.port}/`));
