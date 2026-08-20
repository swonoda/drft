const { PDFDocument, rgb } = require("pdf-lib");

const POINTS_PER_MM = 72 / 25.4;
const PRINT_MARK_MARGIN = 10 * POINTS_PER_MM;
const BLEED = 3 * POINTS_PER_MM;
const MARK_GAP = 1 * POINTS_PER_MM;
const MARK_LENGTH = 5 * POINTS_PER_MM;
const CENTER_MARK_OFFSET = 5 * POINTS_PER_MM;
const CENTER_MARK_HALF = 2.5 * POINTS_PER_MM;
const MARK_THICKNESS = 0.25;

function drawLine(page, start, end) {
  page.drawLine({
    start,
    end,
    thickness: MARK_THICKNESS,
    color: rgb(0, 0, 0),
  });
}

function drawCross(page, x, y) {
  drawLine(
    page,
    { x: x - CENTER_MARK_HALF, y },
    { x: x + CENTER_MARK_HALF, y },
  );
  drawLine(
    page,
    { x, y: y - CENTER_MARK_HALF },
    { x, y: y + CENTER_MARK_HALF },
  );
}

function drawSpreadPrintMarks(page, trimBox) {
  const { x: left, y: bottom, width, height } = trimBox;
  const right = left + width;
  const top = bottom + height;
  const leftMarkStart = left - MARK_GAP - MARK_LENGTH;
  const leftMarkEnd = left - MARK_GAP;
  const rightMarkStart = right + MARK_GAP;
  const rightMarkEnd = right + MARK_GAP + MARK_LENGTH;
  const bottomMarkStart = bottom - MARK_GAP - MARK_LENGTH;
  const bottomMarkEnd = bottom - MARK_GAP;
  const topMarkStart = top + MARK_GAP;
  const topMarkEnd = top + MARK_GAP + MARK_LENGTH;

  for (const y of [bottom, bottom - BLEED, top, top + BLEED]) {
    drawLine(page, { x: leftMarkStart, y }, { x: leftMarkEnd, y });
    drawLine(page, { x: rightMarkStart, y }, { x: rightMarkEnd, y });
  }
  for (const x of [left, left - BLEED, right, right + BLEED]) {
    drawLine(page, { x, y: bottomMarkStart }, { x, y: bottomMarkEnd });
    drawLine(page, { x, y: topMarkStart }, { x, y: topMarkEnd });
  }

  drawCross(page, left + width / 2, top + CENTER_MARK_OFFSET);
  drawCross(page, left + width / 2, bottom - CENTER_MARK_OFFSET);
  drawCross(page, left - CENTER_MARK_OFFSET, bottom + height / 2);
  drawCross(page, right + CENTER_MARK_OFFSET, bottom + height / 2);
}

function normalizeParity(value, fallback) {
  return value === "odd" || value === "even" ? value : fallback;
}

function proofPdfPagePlan({
  contentPageCount,
  separateTitle = false,
  titleParity = "odd",
  bodyParity = "even",
}) {
  const pageCount = Math.max(1, Math.floor(Number(contentPageCount) || 1));
  const titleSide = normalizeParity(titleParity, "odd");
  const bodySide = normalizeParity(bodyParity, "even");
  const plan = [];
  const alignNextPage = (parity) => {
    const nextPageIsOdd = (plan.length + 1) % 2 === 1;
    if ((parity === "odd") !== nextPageIsOdd) plan.push(null);
  };

  if (separateTitle) {
    alignNextPage(titleSide);
    plan.push(0);
    if (pageCount > 1) {
      alignNextPage(bodySide);
      for (let index = 1; index < pageCount; index++) plan.push(index);
    }
    return plan;
  }

  alignNextPage(bodySide);
  for (let index = 0; index < pageCount; index++) plan.push(index);
  return plan;
}

async function combineFirstPages(pdfDocuments) {
  const output = await PDFDocument.create();
  for (const bytes of pdfDocuments) {
    const source = await PDFDocument.load(bytes);
    if (!source.getPageCount()) continue;
    const [page] = await output.copyPages(source, [0]);
    output.addPage(page);
  }
  return output.save();
}

async function combinePlannedPages(pdfDocuments, pagePlan) {
  const sources = await Promise.all(
    pdfDocuments.map((bytes) => PDFDocument.load(bytes)),
  );
  const firstSource = sources.find((source) => source.getPageCount());
  if (!firstSource) return (await PDFDocument.create()).save();
  const { width, height } = firstSource.getPage(0).getSize();
  const output = await PDFDocument.create();

  for (const sourceIndex of pagePlan) {
    if (sourceIndex === null) {
      const blank = output.addPage([width, height]);
      blank.drawRectangle({
        x: 0,
        y: 0,
        width,
        height,
        color: rgb(1, 1, 1),
      });
      continue;
    }
    const source = sources[sourceIndex];
    if (!source?.getPageCount()) continue;
    const [page] = await output.copyPages(source, [0]);
    output.addPage(page);
  }
  return output.save();
}

async function imposeRightBoundLogicalPages(
  sourceBytes,
  { cropMarks = false } = {},
) {
  const source = await PDFDocument.load(sourceBytes);
  const output = await PDFDocument.create();
  const sourcePages = source.getPages();
  if (!sourcePages.length) return output.save();

  const embedded = await output.embedPdf(
    source,
    sourcePages.map((_page, index) => index),
  );
  const { width, height } = sourcePages[0].getSize();
  const spreadWidth = width * 2;
  const pageOffset = cropMarks ? PRINT_MARK_MARGIN : 0;
  const outputWidth = spreadWidth + pageOffset * 2;
  const outputHeight = height + pageOffset * 2;
  let sheet;
  for (let index = 0; index < embedded.length; index++) {
    const logicalPage = index + 1;
    if (logicalPage % 2 === 1) {
      sheet = output.addPage([outputWidth, outputHeight]);
      if (cropMarks) {
        sheet.setTrimBox(pageOffset, pageOffset, spreadWidth, height);
        sheet.setBleedBox(
          pageOffset - BLEED,
          pageOffset - BLEED,
          spreadWidth + BLEED * 2,
          height + BLEED * 2,
        );
        drawSpreadPrintMarks(sheet, {
          x: pageOffset,
          y: pageOffset,
          width: spreadWidth,
          height,
        });
      }
    }
    sheet.drawPage(embedded[index], {
      x: pageOffset + (logicalPage % 2 === 0 ? 0 : width),
      y: pageOffset,
      width,
      height,
    });
  }
  output.setTitle("原稿（見開き）");
  output.setCreator("DRFT (codename: Ryuhyo)");
  return output.save();
}

async function imposeRightBoundSpreads(sourceBytes) {
  const source = await PDFDocument.load(sourceBytes);
  const output = await PDFDocument.create();
  const sourcePages = source.getPages();
  if (!sourcePages.length) return output.save();

  const embedded = await output.embedPdf(
    source,
    sourcePages.map((_page, index) => index),
  );
  const { width, height } = sourcePages[0].getSize();
  let sheet = output.addPage([width * 2, height]);
  sheet.drawPage(embedded[0], { x: 0, y: 0, width, height });

  for (let index = 1; index < embedded.length; index++) {
    const logicalPage = index + 2;
    if (logicalPage % 2 === 1) sheet = output.addPage([width * 2, height]);
    sheet.drawPage(embedded[index], {
      x: logicalPage % 2 === 0 ? 0 : width,
      y: 0,
      width,
      height,
    });
  }
  output.setTitle("原稿（見開き）");
  output.setCreator("DRFT (codename: Ryuhyo)");
  return output.save();
}

module.exports = {
  combineFirstPages,
  combinePlannedPages,
  imposeRightBoundLogicalPages,
  imposeRightBoundSpreads,
  proofPdfPagePlan,
};
