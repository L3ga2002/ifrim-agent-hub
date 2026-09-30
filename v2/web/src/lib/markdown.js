// Minimal, safe Markdown → token tree. No HTML is produced or passed through: React renders the tokens as text,
// so agent output, files and pages stay data, never markup (Milestone 02 §24). Links are kept only for http(s).

const SAFE_LINK = /^(https?:\/\/|#\/)/i;

/** Inline tokens: code, bold, italic, link, text. */
export function parseInline(text) {
  const out = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0; let m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ t: "text", v: text.slice(last, m.index) });
    const s = m[0];
    if (m[1]) out.push({ t: "code", v: s.slice(1, -1) });
    else if (m[2]) out.push({ t: "bold", v: s.slice(2, -2) });
    else if (m[3]) out.push({ t: "italic", v: s.slice(1, -1) });
    else {
      const label = s.slice(1, s.indexOf("]"));
      const href = s.slice(s.indexOf("(") + 1, -1);
      out.push(SAFE_LINK.test(href) ? { t: "link", v: label, href } : { t: "text", v: `${label} (${href})` });
    }
    last = m.index + s.length;
  }
  if (last < text.length) out.push({ t: "text", v: text.slice(last) });
  return out;
}

/** Block tokens: heading, code (with lang), list (ordered/unordered), quote, paragraph. */
export function parseMarkdown(src = "") {
  const lines = String(src).replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^\s*```\s*([\w+-]*)\s*$/);
    if (fence) {
      const body = []; i += 1;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { body.push(lines[i]); i += 1; }
      blocks.push({ t: "code", lang: fence[1] || "", v: body.join("\n"), open: i >= lines.length });
      i += 1; continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) { blocks.push({ t: "heading", level: heading[1].length, c: parseInline(heading[2]) }); i += 1; continue; }
    if (/^\s*([-*]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*]|\d+[.)])\s+/.test(lines[i])) { items.push(parseInline(lines[i].replace(/^\s*([-*]|\d+[.)])\s+/, ""))); i += 1; }
      blocks.push({ t: "list", ordered, items }); continue;
    }
    if (/^>\s?/.test(line)) {
      const body = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { body.push(lines[i].replace(/^>\s?/, "")); i += 1; }
      blocks.push({ t: "quote", c: parseInline(body.join(" ")) }); continue;
    }
    if (!line.trim()) { i += 1; continue; }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^\s*```/.test(lines[i]) && !/^(#{1,4})\s/.test(lines[i]) && !/^\s*([-*]|\d+[.)])\s+/.test(lines[i]) && !/^>\s?/.test(lines[i])) { para.push(lines[i]); i += 1; }
    blocks.push({ t: "p", c: parseInline(para.join("\n")) });
  }
  return blocks;
}
