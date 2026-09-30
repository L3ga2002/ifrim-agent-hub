import { memo, useMemo, useState } from "react";
import { Copy, Check } from "lucide-react";
import { parseMarkdown } from "../lib/markdown.js";

function Inline({ tokens, highlight }) {
  return tokens.map((t, i) => {
    if (t.t === "code") return <code key={i} className="md-code">{t.v}</code>;
    if (t.t === "bold") return <strong key={i}><Hl text={t.v} q={highlight} /></strong>;
    if (t.t === "italic") return <em key={i}><Hl text={t.v} q={highlight} /></em>;
    if (t.t === "link") return <a key={i} href={t.href} target={t.href.startsWith("#") ? undefined : "_blank"} rel="noreferrer noopener"><Hl text={t.v} q={highlight} /></a>;
    return <Hl key={i} text={t.v} q={highlight} />;
  });
}

/** Search highlight inside text nodes only (never builds HTML). */
function Hl({ text, q }) {
  if (!q || q.length < 2) return text;
  const lower = text.toLowerCase(); const needle = q.toLowerCase();
  const parts = []; let at = 0; let idx;
  while ((idx = lower.indexOf(needle, at)) >= 0) { parts.push(text.slice(at, idx)); parts.push(<mark key={idx}>{text.slice(idx, idx + q.length)}</mark>); at = idx + q.length; }
  parts.push(text.slice(at));
  return parts;
}

function CodeBlock({ lang, value, open }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    // Explicit user action only (no automatic clipboard writes).
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };
  return (
    <div className="md-pre">
      <div className="md-pre-head"><span className="mono">{lang || "text"}{open ? " · în curs" : ""}</span>
        <button className="btn sm ghost" onClick={copy} aria-label="Copiază codul">{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? "Copiat" : "Copiază"}</button>
      </div>
      <pre><code>{value}</code></pre>
    </div>
  );
}

/** Renders agent/user text as Markdown tokens. Raw HTML is shown as text; nothing is injected. */
export const Markdown = memo(function Markdown({ text, highlight = "" }) {
  const blocks = useMemo(() => parseMarkdown(text || ""), [text]);
  return (
    <div className="md">
      {blocks.map((b, i) => {
        if (b.t === "heading") { const H = `h${Math.min(6, b.level + 2)}`; return <H key={i}><Inline tokens={b.c} highlight={highlight} /></H>; }
        if (b.t === "code") return <CodeBlock key={i} lang={b.lang} value={b.v} open={b.open} />;
        if (b.t === "list") { const L = b.ordered ? "ol" : "ul"; return <L key={i}>{b.items.map((it, k) => <li key={k}><Inline tokens={it} highlight={highlight} /></li>)}</L>; }
        if (b.t === "quote") return <blockquote key={i}><Inline tokens={b.c} highlight={highlight} /></blockquote>;
        return <p key={i}><Inline tokens={b.c} highlight={highlight} /></p>;
      })}
    </div>
  );
});
