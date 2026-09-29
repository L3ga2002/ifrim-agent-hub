import { connectOpenClaw } from "../apps/api/src/openclaw-gateway.mjs";
const client = await connectOpenClaw();
try {
  const result = await client.request("sessions.list", { limit: 1 }, { timeoutMs: 30000 });
  console.log(JSON.stringify({ connected: true, resultKeys: Object.keys(result), sessionCount: result.sessions?.length || 0 }));
} finally { await client.stopAndWait(); }
