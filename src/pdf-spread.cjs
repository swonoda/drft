const { PDFDocument } = require("pdf-lib");

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

module.exports = { imposeRightBoundSpreads };
