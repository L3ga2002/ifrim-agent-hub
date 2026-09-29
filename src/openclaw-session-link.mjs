export function openClawSessionLink(metadata) {
  const key = metadata?.openclawSessionKey;
  if (typeof key !== "string" || !key || key.length > 2048) return "";
  const port = metadata.openclawGatewayPort ?? 18789;
  if (![18789, 18790].includes(port)) return "";
  return `http://127.0.0.1:${port}/chat?session=${encodeURIComponent(key)}`;
}
