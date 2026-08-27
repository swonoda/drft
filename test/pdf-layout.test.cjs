const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { PDFDocument } = require("pdf-lib");

const {
  boxToImageBounds,
  parsePdfTextBoxes,
  pdfPageCount,
} = require("../src/pdf-layout.cjs");

test("pdftotextの文字座標をページ比率へ変換する", () => {
  const result = parsePdfTextBoxes(`
    <page width="200.000000" height="100.000000">
      <word xMin="20.000000" yMin="10.000000" xMax="60.000000" yMax="30.000000">赤&amp;字</word>
    </page>
  `);
  assert.deepEqual(result.words, [
    {
      text: "赤&字",
      left: 0.1,
      top: 0.1,
      width: 0.2,
      height: 0.2,
    },
  ]);
});

test("PDFのTrimBoxをレンダリング画像上の領域へ変換する", () => {
  const image = { width: 1600, height: 1200 };
  const media = { x: 0, y: 0, width: 800, height: 600 };
  const trim = { x: 40, y: 30, width: 720, height: 540 };

  assert.deepEqual(boxToImageBounds(trim, media, image), {
    left: 80,
    right: 1520,
    top: 60,
    bottom: 1140,
  });
});

test("原点がずれたPDFでもTrimBoxを正しく変換する", () => {
  const image = { width: 1000, height: 800 };
  const media = { x: 10, y: 20, width: 500, height: 400 };
  const trim = { x: 35, y: 40, width: 450, height: 360 };

  assert.deepEqual(boxToImageBounds(trim, media, image), {
    left: 50,
    right: 950,
    top: 40,
    bottom: 760,
  });
});

test("赤ゲラPDFのページ数を取得する", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "drft-pdf-count-"));
  const file = path.join(dir, "proof.pdf");
  try {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    pdf.addPage();
    await fs.writeFile(file, await pdf.save());
    assert.equal(await pdfPageCount(file), 2);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
