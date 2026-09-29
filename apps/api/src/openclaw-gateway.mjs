import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function gatewayConnectionError(error) {
  const transportCodes = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EHOSTUNREACH", "EACCES", "EPERM"]);
  const authCodes = new Set(["AUTH_REQUIRED", "AUTH_UNAUTHORIZED", "AUTH_TOKEN_MISSING", "AUTH_TOKEN_MISMATCH", "AUTH_PASSWORD_MISSING", "AUTH_PASSWORD_MISMATCH", "AUTH_DEVICE_TOKEN_MISMATCH"]);
  const detail = error?.details?.code;
  const code = error?.code;
  const result = new Error("OpenClaw connection failed");
  result.category = "unknown";
  if (transportCodes.has(code)) { result.code = code; result.category = code === "ETIMEDOUT" ? "timeout" : "transport"; }
  if (authCodes.has(detail)) { result.detailCode = detail; result.category = "authentication"; }
  else if (detail === "AUTH_SCOPE_MISMATCH" || code === "FORBIDDEN") { result.category = "permission"; result.code = "FORBIDDEN"; }
  return result;
}

export async function connectOpenClaw(onEvent = () => {}, verifiedConfig = null, dependencies = null) {
  const home = process.env.USERPROFILE;
  const sdk = path.join(process.env.APPDATA, "npm", "node_modules", "openclaw", "dist", "plugin-sdk", "gateway-runtime.js");
  const { GatewayClient } = dependencies || await import(pathToFileURL(sdk).href);
  const config = verifiedConfig || JSON.parse(await fs.readFile(path.join(home, ".openclaw", "openclaw.json"), "utf8"));
  const token = config.gateway?.auth?.token;
  if (typeof token !== "string" || !token) throw new Error("OpenClaw local token unavailable; authenticated connection required");
  let client;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { client?.stop(); reject(new Error("OpenClaw connection timeout")); }, 30000);
    client = new GatewayClient({
      url: `ws://127.0.0.1:${Number(config.gateway?.port || 18789)}`, token,
      clientName: "gateway-client", clientDisplayName: "Ifrim Agent Hub", clientVersion: "0.3.0", mode: "backend",
      role: "operator", scopes: ["operator.read", "operator.write", "operator.admin"],
      sharedStateMode: "read-only", deviceIdentity: null,
      onEvent,
      onHelloOk: () => { clearTimeout(timer); resolve(); },
      onConnectError: (error) => { clearTimeout(timer); client.stop(); reject(gatewayConnectionError(error)); },
    });
    client.start();
  });
  return client;
}
