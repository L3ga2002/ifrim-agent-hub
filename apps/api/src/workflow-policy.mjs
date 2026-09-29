import { validatePacketModelPolicy } from "./model-policy.mjs";

export function findReusableWorkflowChild(parentRunId, findChild) {
  const seen = new Set();
  while (!seen.has(parentRunId)) {
    seen.add(parentRunId);
    const child = findChild(parentRunId);
    if (!child) return { existing: null, parentRunId };
    let packet = child.packet;
    try { packet ||= JSON.parse(child.packet_json || "null"); } catch {}
    if (!validatePacketModelPolicy(packet) && packet.backup?.status === "created" && !packet.backup?.manifest?.error) {
      return { existing: child, parentRunId };
    }
    parentRunId = child.id;
  }
  throw new Error("Workflow history contains a cycle; refresh blocked.");
}
