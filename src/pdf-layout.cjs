const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { PDFDocument } = require("pdf-lib");

const execFileAsync = promisify(execFile);

async function resolvePdfToPpm() {
  let npmPdftoppm = null;

  if (process.platform === "win32") {
    try {
      const popplerDir = require("node-poppler-win32");
      npmPdftoppm = path.join(popplerDir, "pdftoppm.exe");
    } catch (error) {
      console.warn("node-poppler-win32の読み込みに失敗しました:", error);
    }
  }

  const candidates = [
    process.env.PDFTOPPM,
    npmPdftoppm,

    path.join(
      os.homedir(),
      ".cache",
      "codex-runtimes",
      "codex-primary-runtime",
      "dependencies",
      "bin",
      "override",
      process.platform === "win32" ? "pdftoppm.cmd" : "pdftoppm",
    ),
    "pdftoppm",
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate === "pdftoppm") {
      try {
        await execFileAsync(
          process.platform === "win32" ? "where.exe" : "which",
          [candidate],
          { windowsHide: true },
        );
        return candidate;
      } catch {
        continue;
      }
    }
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      /* try next candidate */
    }
  }
  throw new Error("PDFを画像化するためのpdftoppmが見つかりません。");
}
const PDF_LAYOUT_ERROR = "PDFから本文領域を検出できませんでした。";

async function renderPage(pdfPath) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "drft-pdf-"));
  const prefix = path.join(dir, "page");
  try {
    const command = await resolvePdfToPpm();
    await execFileAsync(
      command,
      [
        "-f",
        "1",
        "-l",
        "1",
        "-singlefile",
        "-r",
        "150",
        "-mono",
        pdfPath,
        prefix,
      ],
      { windowsHide: true, shell: command.endsWith(".cmd") },
    );
    const file = `${prefix}.pbm`;
    return parsePbm(await fs.readFile(file));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function firstPageBoxes(pdfPath) {
  const pdf = await PDFDocument.load(await fs.readFile(pdfPath));
  const page = pdf.getPage(0);
  return { media: page.getMediaBox(), trim: page.getTrimBox() };
}

function boxToImageBounds(box, media, image) {
  const scaleX = image.width / media.width;
  const scaleY = image.height / media.height;
  return {
    left: Math.max(0, Math.round((box.x - media.x) * scaleX)),
    right: Math.min(
      image.width,
      Math.round((box.x + box.width - media.x) * scaleX),
    ),
    top: Math.max(
      0,
      Math.round(image.height - (box.y + box.height - media.y) * scaleY),
    ),
    bottom: Math.min(
      image.height,
      Math.round(image.height - (box.y - media.y) * scaleY),
    ),
  };
}

function parsePbm(buffer) {
  let offset = 0;
  const nextToken = () => {
    while (
      offset < buffer.length &&
      /\s/.test(String.fromCharCode(buffer[offset]))
    )
      offset += 1;
    if (buffer[offset] === 35) {
      while (offset < buffer.length && buffer[offset] !== 10) offset += 1;
      return nextToken();
    }
    const start = offset;
    while (
      offset < buffer.length &&
      !/\s/.test(String.fromCharCode(buffer[offset]))
    )
      offset += 1;
    return buffer.subarray(start, offset).toString("ascii");
  };
  if (nextToken() !== "P4") throw new Error(PDF_LAYOUT_ERROR);
  const width = Number(nextToken());
  const height = Number(nextToken());
  while (
    offset < buffer.length &&
    /\s/.test(String.fromCharCode(buffer[offset]))
  )
    offset += 1;
  const rowBytes = Math.ceil(width / 8);
  return { width, height, rowBytes, data: buffer.subarray(offset) };
}

function isInk(image, x, y) {
  return (image.data[y * image.rowBytes + (x >> 3)] & (0x80 >> (x & 7))) !== 0;
}

function projection(image, axis, start, end, bounds = {}) {
  const left = bounds.left ?? 0;
  const right = bounds.right ?? image.width;
  const top = bounds.top ?? 0;
  const bottom = bounds.bottom ?? image.height;
  const values = [];
  for (let i = start; i < end; i += 1) {
    let count = 0;
    if (axis === "x")
      for (let y = top; y < bottom; y += 1) count += isInk(image, i, y) ? 1 : 0;
    else
      for (let x = left; x < right; x += 1) count += isInk(image, x, i) ? 1 : 0;
    values.push(count);
  }
  return values;
}

function denseSpan(values, minimum) {
  const threshold = Math.max(
    2,
    Math.round(
      (values.reduce((a, b) => a + b, 0) / Math.max(1, values.length)) * 0.18,
    ),
    minimum,
  );
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
  return (
    spans.sort((a, b) => b.end - b.start - (a.end - a.start))[0] || {
      start: 0,
      end: values.length,
    }
  );
}

function clusteredSpan(values, minimum, maxGap) {
  const threshold = Math.max(
    2,
    Math.round(
      (values.reduce((a, b) => a + b, 0) / Math.max(1, values.length)) * 0.18,
    ),
    minimum,
  );

  const rawSpans = segments(values, threshold).filter(
    ({ start, end }) => end - start > 4,
  );

  if (!rawSpans.length) {
    return { start: 0, end: values.length };
  }

  const clusters = [];
  let current = { ...rawSpans[0] };

  for (const span of rawSpans.slice(1)) {
    const gap = span.start - current.end;

    if (gap <= maxGap) {
      current.end = span.end;
    } else {
      clusters.push(current);
      current = { ...span };
    }
  }

  clusters.push(current);

  return clusters.sort((a, b) => b.end - b.start - (a.end - a.start))[0];
}

function segments(values, threshold) {
  const result = [];
  let start = -1;
  values.forEach((value, index) => {
    if (value >= threshold && start < 0) start = index;
    if ((value < threshold || index === values.length - 1) && start >= 0) {
      const end =
        value >= threshold && index === values.length - 1 ? index + 1 : index;
      if (end > start) result.push({ start, end });
      start = -1;
    }
  });
  return result;
}

function estimateHalf(image, left, right, top = 0, bottom = image.height) {
  const pageWidth = right - left;
  const pageHeight = bottom - top;
  const xValues = projection(image, "x", left, right, { top, bottom });
  const yValues = projection(image, "y", top, bottom, { left, right });
  const xSpan = clusteredSpan(
    xValues,
    Math.max(3, Math.round(pageHeight * 0.015)),
    Math.round(pageWidth * 0.06),
  );

  const ySpan = clusteredSpan(
    yValues,
    Math.max(3, Math.round(pageWidth * 0.01)),
    Math.round(pageHeight * 0.015),
  );
  const bodyLeft = left + xSpan.start;
  const bodyRight = left + xSpan.end;
  const bodyTop = top + ySpan.start;
  const bodyBottom = top + ySpan.end;
  const bodyWidth = bodyRight - bodyLeft;
  const bodyHeight = bodyBottom - bodyTop;
  if (bodyWidth < 30 || bodyHeight < 30) throw new Error(PDF_LAYOUT_ERROR);

  const lineSegments = segments(
    xValues.slice(xSpan.start, xSpan.end),
    Math.max(2, Math.round(pageHeight * 0.01)),
  );
  const rowSegments = segments(
    yValues.slice(ySpan.start, ySpan.end),
    Math.max(2, Math.round(bodyWidth * 0.01)),
  );
  const linePitch = medianAdvance(
    lineSegments,
    bodyWidth / Math.max(1, lineSegments.length),
  );
  const charPitch = medianAdvance(
    rowSegments,
    bodyHeight / Math.max(1, rowSegments.length),
  );
  const linesPerPage = clamp(bodyWidth / linePitch, 8, 40);
  const charactersPerLine = clamp(bodyHeight / charPitch, 10, 80);
  return {
    linesPerPage,
    charactersPerLine,
    horizontalMarginRatio:
      (bodyLeft - left + (right - bodyRight)) / 2 / pageWidth,
    verticalMarginRatio:
      (bodyTop - top + (bottom - bodyBottom)) / 2 / pageHeight,
  };
}

function medianAdvance(spans, fallback) {
  if (spans.length < 2) return fallback;
  const advances = spans
    .slice(1)
    .map((span, index) => span.start - spans[index].start);
  const sorted = advances.filter((value) => value > 0).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

async function analyzePdfLayout(pdfPath) {
  const [image, boxes] = await Promise.all([
    renderPage(pdfPath),
    firstPageBoxes(pdfPath),
  ]);
  const trim = boxToImageBounds(boxes.trim, boxes.media, image);
  const trimWidth = trim.right - trim.left;
  const trimHeight = trim.bottom - trim.top;
  const spread = trimWidth / trimHeight > 1.25;
  const halves = spread
    ? [
        [trim.left, Math.floor((trim.left + trim.right) / 2)],
        [Math.floor((trim.left + trim.right) / 2), trim.right],
      ]
    : [[trim.left, trim.right]];
  const estimates = halves.map(([left, right]) =>
    estimateHalf(image, left, right, trim.top, trim.bottom),
  );
  return {
    pagesAnalyzed: 1,
    charactersPerLine: mode(estimates.map((item) => item.charactersPerLine)),
    linesPerPage: mode(estimates.map((item) => item.linesPerPage)),
    verticalMarginMm: roundHalf(
      mean(estimates.map((item) => item.verticalMarginRatio)) * 210,
    ),
    horizontalMarginMm: roundHalf(
      mean(estimates.map((item) => item.horizontalMarginRatio)) * 148.5,
    ),
    spread,
    confidence: "low",
  };
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundHalf(value) {
  return Math.round(value * 2) / 2;
}

function mode(values) {
  const counts = new Map();
  values.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 0;
}

module.exports = {
  analyzePdfLayout,
  boxToImageBounds,
  estimateHalf,
  parsePbm,
};
