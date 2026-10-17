import { zip } from "./zip.mjs";

/**
 * A .docx writer for the documents the Hub prepares (WordprocessingML, ECMA-376): title, headings 1–2 (real Word heading styles, so
 * the navigation pane and the table of contents see them), paragraphs with bold runs, bullet lists (a real numbering definition, not a
 * typed "•"), tables with a header row repeated on every page, a note style and page margins. Fonts and spacing are one coherent set.
 *
 * Model: { title, subtitle?, author?, blocks: [ { type: "h1"|"h2"|"p"|"bullet"|"note"|"table"|"pagebreak", text?, runs?, header?, rows?, widths? } ] }
 * A paragraph's text may carry **bold** spans. Nothing here invents content: the caller passes it.
 */
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function runs(text, { bold = false } = {}) {
  // **bold** spans; a run keeps leading/trailing spaces (xml:space="preserve").
  const parts = String(text ?? "").split(/(\*\*[^*]+\*\*)/g).filter((s) => s !== "");
  return parts.map((p) => {
    const b = bold || /^\*\*.*\*\*$/.test(p);
    const t = /^\*\*.*\*\*$/.test(p) ? p.slice(2, -2) : p;
    return `<w:r>${b ? "<w:rPr><w:b/></w:rPr>" : ""}<w:t xml:space="preserve">${esc(t)}</w:t></w:r>`;
  }).join("");
}
const para = (style, text, extra = "") => `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}${extra}</w:pPr>${runs(text)}</w:p>`;

function table({ header = [], rows = [], widths = null }) {
  const cols = Math.max(header.length, ...rows.map((r) => r.length), 1);
  const total = 9360; // twips across A4 with 2.5 cm margins (≈ 16.5 cm)
  const w = widths && widths.length === cols ? widths.map((x) => Math.round((x / widths.reduce((a, b) => a + b, 0)) * total)) : Array(cols).fill(Math.floor(total / cols));
  const cell = (text, i, head) => `<w:tc><w:tcPr><w:tcW w:w="${w[i]}" w:type="dxa"/>${head ? '<w:shd w:val="clear" w:color="auto" w:fill="1F3A5F"/>' : ""}</w:tcPr>`
    + `<w:p><w:pPr><w:pStyle w:val="TableText"/></w:pPr>${head ? `<w:r><w:rPr><w:b/><w:color w:val="FFFFFF"/></w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>` : runs(text)}</w:p></w:tc>`;
  const headRow = header.length ? `<w:tr><w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>${header.map((h, i) => cell(h, i, true)).join("")}</w:tr>` : "";
  const body = rows.map((r) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${Array.from({ length: cols }, (_, i) => cell(r[i] ?? "", i, false)).join("")}</w:tr>`).join("");
  return `<w:tbl><w:tblPr><w:tblStyle w:val="HubTable"/><w:tblW w:w="${total}" w:type="dxa"/><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>`
    + `<w:tblGrid>${w.map((x) => `<w:gridCol w:w="${x}"/>`).join("")}</w:tblGrid>${headRow}${body}</w:tbl><w:p><w:pPr><w:pStyle w:val="Spacer"/></w:pPr></w:p>`;
}

export function documentXml(model) {
  const body = [];
  if (model.title) body.push(para("Title", model.title));
  if (model.subtitle) body.push(para("Subtitle", model.subtitle));
  for (const b of model.blocks || []) {
    if (b.type === "h1") body.push(para("Heading1", b.text));
    else if (b.type === "h2") body.push(para("Heading2", b.text));
    else if (b.type === "p") body.push(para(null, b.text));
    else if (b.type === "note") body.push(para("Note", b.text));
    else if (b.type === "bullet") body.push(para("ListBullet", b.text, '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'));
    else if (b.type === "table") body.push(table(b));
    else if (b.type === "pagebreak") body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
    else throw new Error(`Bloc de document necunoscut: ${b.type}`);
  }
  const sect = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1418" w:right="1418" w:bottom="1418" w:left="1418" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr>';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body.join("")}${sect}</w:body></w:document>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri" w:eastAsia="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="ro-RO"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="80"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri Light" w:hAnsi="Calibri Light"/><w:color w:val="1F3A5F"/><w:sz w:val="48"/><w:szCs w:val="48"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:color w:val="5A6B7D"/><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="320" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="1F3A5F"/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="2E5C8A"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="60"/><w:ind w:left="360" w:hanging="360"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Note"><w:name w:val="Note"/><w:basedOn w:val="Normal"/><w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="C98A1B"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="FFF6E5"/><w:ind w:left="200"/></w:pPr><w:rPr><w:i/><w:color w:val="5A4A2A"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="TableText"><w:name w:val="Table Text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="40" w:after="40" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Spacer"><w:name w:val="Spacer"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="120" w:lineRule="exact"/></w:pPr></w:style>
<w:style w:type="table" w:styleId="HubTable"><w:name w:val="Hub Table"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="B7C3D0"/><w:left w:val="single" w:sz="4" w:space="0" w:color="B7C3D0"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="B7C3D0"/><w:right w:val="single" w:sz="4" w:space="0" w:color="B7C3D0"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="B7C3D0"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="B7C3D0"/></w:tblBorders><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
</w:styles>`;

const NUMBERING = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="360" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;

export function buildDocx(model, { created = new Date() } = {}) {
  const iso = new Date(created).toISOString().replace(/\.\d+Z$/, "Z");
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(model.title || "")}</dc:title><dc:creator>${esc(model.author || "Ifrim Agent Hub")}</dc:creator><dc:language>ro-RO</dc:language><dcterms:created xsi:type="dcterms:W3CDTF">${iso}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${iso}</dcterms:modified></cp:coreProperties>`;
  return zip([
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>` },
    { name: "word/_rels/document.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>` },
    { name: "word/document.xml", data: documentXml(model) },
    { name: "word/styles.xml", data: STYLES },
    { name: "word/numbering.xml", data: NUMBERING },
    { name: "docProps/core.xml", data: core },
  ]);
}

/** What the document should contain, for the checks (structure only: headings, tables, rows, the declared-demo note). */
export function expectedDocxShape(model) {
  const blocks = model.blocks || [];
  return {
    headings: blocks.filter((b) => b.type === "h1" || b.type === "h2").map((b) => b.text),
    tables: blocks.filter((b) => b.type === "table").map((t) => ({ rows: (t.rows || []).length + (t.header?.length ? 1 : 0), cols: Math.max(t.header?.length || 0, ...(t.rows || []).map((r) => r.length)) })),
    bullets: blocks.filter((b) => b.type === "bullet").length,
  };
}
