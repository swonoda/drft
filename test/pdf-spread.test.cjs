const test = require("node:test");
const assert = require("node:assert/strict");
const { PDFDocument, rgb } = require("pdf-lib");
const { imposeRightBoundSpreads } = require("../src/pdf-spread.cjs");

test("A5単ページを右綴じ見開きへ面付けする", async () => {
  const source = await PDFDocument.create();
  for (let index = 0; index < 5; index++) {
    const page = source.addPage([420, 595]);
    page.drawRectangle({
      x: 10,
      y: 10,
      width: 20,
      height: 20,
      color: rgb(index / 5, 0, 0),
    });
  }
  const result = await PDFDocument.load(
    await imposeRightBoundSpreads(await source.save()),
  );
  assert.equal(result.getPageCount(), 3);
  for (const page of result.getPages()) {
    assert.deepEqual(page.getSize(), { width: 840, height: 595 });
  }
});
