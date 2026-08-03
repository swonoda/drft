const { PDFDocument, PDFArray, PDFName } = require("pdf-lib");

function decodeStream(stream) {
  if (!stream) return "";
  const bytes = typeof stream.getContents === "function" ? stream.getContents() : stream.contents;
  return bytes ? Buffer.from(bytes).toString("latin1") : "";
}

function pageContent(pdf, page) {
  const contents =
    typeof page.node.Contents === "function"
      ? page.node.Contents()
      : page.node.get(PDFName.of("Contents"));
  if (!contents) return "";
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
  return refs
    .map((ref) => decodeStream(pdf.context.lookup(ref)))
    .join("\n");
}

function hexGlyphCount(hex) {
  if (!hex) return 0;
  return hex.length % 4 === 0 ? hex.length / 4 : Math.ceil(hex.length / 2);
}

function literalGlyphCount(literal) {
  return literal.replace(/\\(?:[0-7]{1,3}|.)/g, "x").length;
}

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
    const matrix = body.match(/(-?[\d.]+)\s+-?[\d.]+\s+-?[\d.]+\s+-?[\d.]+\s+(-?[\d.]+)\s+(-?[\d.]+)\s+Tm/);
    const chars = textTokenCount(body);
    if (!matrix || chars === 0) continue;
    runs.push({ chars, x: Number(matrix[2]), y: Number(matrix[3]) });
  }
  return runs;
}

function mode(values) {
  const counts = new Map();
  values.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] || 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function estimateLayout(runs, pageWidth, pageHeight) {
  const candidates = runs.map((run) => run.chars).filter((chars) => chars >= 8);
  if (!candidates.length) throw new Error("PDFから本文の文字配置を読み取れませんでした。");
  const charactersPerLine = mode(candidates);
  const completeLines = candidates.filter((chars) => chars >= Math.max(8, charactersPerLine * 0.78)).length;
  const spread = pageWidth / pageHeight > 1.25;
  return {
    charactersPerLine: clamp(charactersPerLine, 10, 80),
    linesPerPage: clamp(completeLines / (spread ? 2 : 1), 8, 30),
    spread,
    confidence: candidates.length >= 8 ? "high" : "low",
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
