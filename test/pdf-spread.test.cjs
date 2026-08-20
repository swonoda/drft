const test = require("node:test");
const assert = require("node:assert/strict");
const { PDFDocument, rgb } = require("pdf-lib");
const {
  combineFirstPages,
  combinePlannedPages,
  imposeRightBoundLogicalPages,
  imposeRightBoundSpreads,
  proofPdfPagePlan,
} = require("../src/pdf-spread.cjs");

test("個別に印刷したPDFの先頭ページを順番どおりにまとめる", async () => {
  const documents = [];
  for (let index = 0; index < 3; index++) {
    const document = await PDFDocument.create();
    document.addPage([420 + index, 595]);
    documents.push(await document.save());
  }
  const result = await PDFDocument.load(await combineFirstPages(documents));
  assert.equal(result.getPageCount(), 3);
  assert.deepEqual(result.getPage(0).getSize(), { width: 420, height: 595 });
  assert.deepEqual(result.getPage(2).getSize(), { width: 422, height: 595 });
});

test("タイトルと本文の奇数偶数指定から論理ページを組み立てる", () => {
  assert.deepEqual(
    proofPdfPagePlan({ contentPageCount: 3, bodyParity: "odd" }),
    [0, 1, 2],
  );
  assert.deepEqual(
    proofPdfPagePlan({ contentPageCount: 3, bodyParity: "even" }),
    [null, 0, 1, 2],
  );
  assert.deepEqual(
    proofPdfPagePlan({
      contentPageCount: 3,
      separateTitle: true,
      titleParity: "odd",
      bodyParity: "odd",
    }),
    [0, null, 1, 2],
  );
  assert.deepEqual(
    proofPdfPagePlan({
      contentPageCount: 3,
      separateTitle: true,
      titleParity: "odd",
      bodyParity: "even",
    }),
    [0, 1, 2],
  );
  assert.deepEqual(
    proofPdfPagePlan({
      contentPageCount: 3,
      separateTitle: true,
      titleParity: "even",
      bodyParity: "odd",
    }),
    [null, 0, 1, 2],
  );
  assert.deepEqual(
    proofPdfPagePlan({
      contentPageCount: 3,
      separateTitle: true,
      titleParity: "even",
      bodyParity: "even",
    }),
    [null, 0, null, 1, 2],
  );
});

test("ページ計画の空白を含めて単ページPDFを作る", async () => {
  const documents = [];
  for (let index = 0; index < 2; index++) {
    const document = await PDFDocument.create();
    document.addPage([420, 595]);
    documents.push(await document.save());
  }
  const logical = await PDFDocument.load(
    await combinePlannedPages(documents, [null, 0, null, 1]),
  );
  assert.equal(logical.getPageCount(), 4);
});

test("論理ページを右綴じ見開きへ面付けする", async () => {
  const source = await PDFDocument.create();
  for (let index = 0; index < 5; index++) {
    const page = source.addPage([420, 595]);
    page.drawRectangle({ x: 0, y: 0, width: 1, height: 1 });
  }
  const result = await PDFDocument.load(
    await imposeRightBoundLogicalPages(await source.save()),
  );
  assert.equal(result.getPageCount(), 3);
  for (const page of result.getPages()) {
    assert.deepEqual(page.getSize(), { width: 840, height: 595 });
  }
});

test("トンボ表示時は見開きの外側へ印刷領域を追加する", async () => {
  const source = await PDFDocument.create();
  for (let index = 0; index < 2; index++) {
    const page = source.addPage([420, 595]);
    page.drawRectangle({ x: 10, y: 10, width: 20, height: 20 });
  }

  const result = await PDFDocument.load(
    await imposeRightBoundLogicalPages(await source.save(), {
      cropMarks: true,
    }),
  );
  const page = result.getPage(0);
  const markMargin = (10 * 72) / 25.4;
  const bleed = (3 * 72) / 25.4;

  assert.equal(result.getPageCount(), 1);
  assert.ok(Math.abs(page.getWidth() - (840 + markMargin * 2)) < 0.001);
  assert.ok(Math.abs(page.getHeight() - (595 + markMargin * 2)) < 0.001);
  assert.deepEqual(page.getTrimBox(), {
    x: markMargin,
    y: markMargin,
    width: 840,
    height: 595,
  });
  assert.deepEqual(page.getBleedBox(), {
    x: markMargin - bleed,
    y: markMargin - bleed,
    width: 840 + bleed * 2,
    height: 595 + bleed * 2,
  });
});

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
