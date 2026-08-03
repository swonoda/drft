const { PDFDocument, PDFArray, PDFName } = require("pdf-lib");
const zlib = require("node:zlib");
const PDF_LAYOUT_ERROR = "PDF\\u304b\\u3089\\u672c\\u6587\\u306e\\u6587\\u5b57\\u914d\\u7f6e\\u3092\\u8aad\\u307f\\u53d6\\u308c\\u307e\\u305b\\u3093\\u3067\\u3057\\u305f\\u3002";

function decodeStream(stream) {
  if (!stream) return "";
  const bytes = typeof stream.getContents === "function" ? stream.getContents() : stream.contents;
  if (!bytes) return "";
  const buffer = Buffer.from(bytes);
  let text = buffer.toString("latin1");
  if (!/\bBT\b/.test(text) && stream.dict?.get(PDFName.of("Filter"))) {
    try { text = zlib.inflateSync(buffer).toString("latin1"); } catch { /* already decoded */ }
  }
  return text;
}

function pageContent(pdf, page) {
  const contents = typeof page.node.Contents === "function" ? page.node.Contents() : page.node.get(PDFName.of("Contents"));
  if (!contents) return "";
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
  return refs.map((ref) => decodeStream(pdf.context.lookup(ref))).join("\n");
}

function hexGlyphCount(hex) { return hex ? (hex.length % 4 === 0 ? hex.length / 4 : Math.ceil(hex.length / 2)) : 0; }
function literalGlyphCount(literal) { return literal.replace(/\\(?:[0-7]{1,3}|.)/g, "x").length; }

function textTokenCount(block) {
  let count = 0;
  for (const match of block.matchAll(/<([0-9a-f]+)>\s*Tj/gi)) count += hexGlyphCount(match[1]);
  for (const match of block.matchAll(/\(((?:\\.|[^)])*)\)\s*Tj/g)) count += literalGlyphCount(match[1]);
  for (const match of block.matchAll(/\[([\s\S]*?)\]\s*TJ/g)) {
    for (const hex of match[1].matchAll(/<([0-9a-f]+)>/gi)) count += hexGlyphCount(hex[1]);
    for (const literal of match[1].matchAll(/\(((?:\\.|[^)])*)\)/g)) count += literalGlyphCount(literal[1]);
  }
  return count;
}

function parseTextRuns(content) {
  const runs = [];
  for (const block of content.matchAll(/BT([\s\S]*?)ET/g)) {
    const body = block[1];
    const matrix = body.match(/(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+Tm/);
    const chars = textTokenCount(body);
    if (!matrix || chars === 0) continue;
    runs.push({
      chars,
      x: Number(matrix[5]),
      y: Number(matrix[6]),
      xScale: Math.hypot(Number(matrix[1]), Number(matrix[2])),
      yScale: Math.hypot(Number(matrix[3]), Number(matrix[4])),
    });
  }
  return runs;
}

function mode(values) {
  const counts = new Map();
  values.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] || 0;
}

function median(values) {
  const sorted = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function coordinateSpacing(values) {
  const sorted = [...new Set(values.map((value) => Math.round(value * 100) / 100))].sort((a, b) => a - b);
  return median(sorted.slice(1).map((value, index) => value - sorted[index]));
}

function clamp(value, min, max) { return Math.max(min, Math.min(max, Math.round(value))); }

function estimateLayout(runs, pageWidth, pageHeight) {
  const candidates = runs.filter((run) => run.chars >= 8);
  if (!candidates.length) throw new Error(PDF_LAYOUT_ERROR);
  const spread = pageWidth / pageHeight > 1.25;
  const pages = spread
    ? [candidates.filter((run) => run.x < pageWidth / 2), candidates.filter((run) => run.x >= pageWidth / 2)]
    : [candidates];
  const pageEstimates = pages.filter((pageRuns) => pageRuns.length).map((pageRuns) => {
    const linePitch = coordinateSpacing(pageRuns.map((run) => run.x)) || median(pageRuns.map((run) => run.xScale));
    const ySpacing = coordinateSpacing(pageRuns.map((run) => run.y));
    const charPitch = ySpacing || median(pageRuns.map((run) => run.yScale).filter((value) => value > 1.5));
    const linePositions = pageRuns.map((run) => run.x);
    const lineSpan = Math.max(...linePositions) - Math.min(...linePositions);
    const lineCount = linePitch ? Math.round(lineSpan / linePitch) + 1 : pageRuns.length;
    const geometricCharacters = charPitch
      ? Math.round((Math.max(...pageRuns.map((run) => run.y)) - Math.min(...pageRuns.map((run) => run.y - (run.chars - 1) * charPitch))) / charPitch) + 1
      : 0;
    const modeCharacters = mode(pageRuns.map((run) => run.chars));
    const charactersPerLine = geometricCharacters >= 10 && geometricCharacters <= 80 ? geometricCharacters : modeCharacters;
    return { lineCount, charactersPerLine };
  });
  if (!pageEstimates.length) throw new Error(PDF_LAYOUT_ERROR);
  if (spread && pageEstimates.length === 1) pageEstimates[0].lineCount = Math.round(pageEstimates[0].lineCount / 2);
  return {
    charactersPerLine: clamp(mode(pageEstimates.map((page) => page.charactersPerLine)), 10, 80),
    linesPerPage: clamp(mode(pageEstimates.map((page) => page.lineCount)), 8, 30),
    spread,
    confidence: candidates.length >= 8 && pageEstimates.every((page) => page.lineCount >= 8) ? "high" : "low",
  };
}

async function analyzePdfLayout(bytes) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const layouts = pdf.getPages().map((page) => {
    const size = page.getSize();
    return estimateLayout(parseTextRuns(pageContent(pdf, page)), size.width, size.height);
  });
  return {
    pagesAnalyzed: layouts.length,
    charactersPerLine: mode(layouts.map((layout) => layout.charactersPerLine)),
    linesPerPage: mode(layouts.map((layout) => layout.linesPerPage)),
    spread: layouts.some((layout) => layout.spread),
    confidence: layouts.every((layout) => layout.confidence === "high") ? "high" : "low",
  };
}

module.exports = { analyzePdfLayout, estimateLayout, parseTextRuns, textTokenCount };
