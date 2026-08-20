const { PDFDocument, rgb } = require("pdf-lib");

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

async function imposeRightBoundLogicalPages(sourceBytes) {
  const source = await PDFDocument.load(sourceBytes);
  const output = await PDFDocument.create();
  const sourcePages = source.getPages();
  if (!sourcePages.length) return output.save();

  const embedded = await output.embedPdf(
    source,
    sourcePages.map((_page, index) => index),
  );
  const { width, height } = sourcePages[0].getSize();
  let sheet;
  for (let index = 0; index < embedded.length; index++) {
    const logicalPage = index + 1;
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
