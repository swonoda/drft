const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

async function resolvePdfToPpm() {
  const candidates = [
    process.env.PDFTOPPM,
    path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "bin", "override", process.platform === "win32" ? "pdftoppm.cmd" : "pdftoppm"),
    "pdftoppm",
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate === "pdftoppm") {
      try { await execFileAsync(process.platform === "win32" ? "where.exe" : "which", [candidate], { windowsHide: true }); return candidate; } catch { continue; }
    }
    try { await fs.access(candidate); return candidate; } catch { /* try next candidate */ }
  }
  throw new Error("PDFを画像化するためのpdftoppmが見つかりません。");
}
const PDF_LAYOUT_ERROR = "PDFから本文領域を検出できませんでした。";

async function renderPage(pdfPath) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "drft-pdf-"));
  const prefix = path.join(dir, "page");
  try {
    const command = await resolvePdfToPpm();
    await execFileAsync(command, ["-f", "1", "-l", "1", "-r", "150", "-mono", "-pbm", pdfPath, prefix], { windowsHide: true });
    const file = `${prefix}-1.pbm`;
    return parsePbm(await fs.readFile(file));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function parsePbm(buffer) {
  let offset = 0;
  const nextToken = () => {
    while (offset < buffer.length && /\\s/.test(String.fromCharCode(buffer[offset]))) offset += 1;
    if (buffer[offset] === 35) {
      while (offset < buffer.length && buffer[offset] !== 10) offset += 1;
      return nextToken();
    }
    const start = offset;
    while (offset < buffer.length && !/\\s/.test(String.fromCharCode(buffer[offset]))) offset += 1;
    return buffer.subarray(start, offset).toString("ascii");
  };
  if (nextToken() !== "P4") throw new Error(PDF_LAYOUT_ERROR);
  const width = Number(nextToken());
  const height = Number(nextToken());
  while (offset < buffer.length && /\\s/.test(String.fromCharCode(buffer[offset]))) offset += 1;
  const rowBytes = Math.ceil(width / 8);
  return { width, height, rowBytes, data: buffer.subarray(offset) };
}

function isInk(image, x, y) {
  return (image.data[y * image.rowBytes + (x >> 3)] & (0x80 >> (x & 7))) !== 0;
}

function projection(image, axis, start, end) {
  const values = [];
  for (let i = start; i < end; i += 1) {
    let count = 0;
    if (axis === "x") for (let y = 0; y < image.height; y += 1) count += isInk(image, i, y) ? 1 : 0;
    else for (let x = 0; x < image.width; x += 1) count += isInk(image, x, i) ? 1 : 0;
    values.push(count);
  }
  return values;
}

function denseSpan(values, minimum) {
  const threshold = Math.max(2, Math.round(values.reduce((a, b) => a + b, 0) / Math.max(1, values.length) * 0.18), minimum);
  const active = values.map((value) => value >= threshold);
  const spans = [];
  let start = -1;
  active.forEach((on, index) => {
    if (on && start < 0) start = index;
    if ((!on || index === active.length - 1) && start >= 0) {
      const end = on && index === active.length - 1 ? index + 1 : index;
      if (end - start > 4) spans.push({ start, end });
      start = -1;
    }
  });
  return spans.sort((a, b) => (b.end - b.start) - (a.end - a.start))[0] || { start: 0, end: values.length };
}

function segments(values, threshold) {
  const result = [];
  let start = -1;
  values.forEach((value, index) => {
    if (value >= threshold && start < 0) start = index;
    if ((value < threshold || index === values.length - 1) && start >= 0) {
      const end = value >= threshold && index === values.length - 1 ? index + 1 : index;
      if (end > start) result.push({ start, end });
      start = -1;
    }
  });
  return result;
}

function estimateHalf(image, left, right) {
  const xValues = projection(image, "x", left, right);
  const yValues = projection(image, "y", 0, image.height);
  const xSpan = denseSpan(xValues, Math.max(3, Math.round(image.height * 0.015)));
  const ySpan = denseSpan(yValues, Math.max(3, Math.round((right - left) * 0.01)));
  const bodyLeft = left + xSpan.start;
  const bodyRight = left + xSpan.end;
  const bodyTop = ySpan.start;
  const bodyBottom = ySpan.end;
  const bodyWidth = bodyRight - bodyLeft;
  const bodyHeight = bodyBottom - bodyTop;
  if (bodyWidth < 30 || bodyHeight < 30) throw new Error(PDF_LAYOUT_ERROR);

  const lineSegments = segments(xValues.slice(xSpan.start, xSpan.end), Math.max(2, Math.round(image.height * 0.01)));
  const rowSegments = segments(yValues.slice(ySpan.start, ySpan.end), Math.max(2, Math.round(bodyWidth * 0.01)));
  const linePitch = medianAdvance(lineSegments, bodyWidth / Math.max(1, lineSegments.length));
  const charPitch = medianAdvance(rowSegments, bodyHeight / Math.max(1, rowSegments.length));
  const linesPerPage = clamp(bodyWidth / linePitch, 8, 40);
  const charactersPerLine = clamp(bodyHeight / charPitch, 10, 80);
  return { linesPerPage, charactersPerLine };
}

function medianAdvance(spans, fallback) {
  if (spans.length < 2) return fallback;
  const advances = spans.slice(1).map((span, index) => span.start - spans[index].start);
  const sorted = advances.filter((value) => value > 0).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

async function analyzePdfLayout(pdfPath) {
  const image = await renderPage(pdfPath);
  const spread = image.width / image.height > 1.25;
  const halves = spread ? [[0, Math.floor(image.width / 2)], [Math.floor(image.width / 2), image.width]] : [[0, image.width]];
  const estimates = halves.map(([left, right]) => estimateHalf(image, left, right));
  return {
    pagesAnalyzed: 1,
    charactersPerLine: mode(estimates.map((item) => item.charactersPerLine)),
    linesPerPage: mode(estimates.map((item) => item.linesPerPage)),
    spread,
    confidence: "low",
  };
}

function mode(values) {
  const counts = new Map();
  values.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 0;
}

module.exports = { analyzePdfLayout, estimateHalf, parsePbm };
