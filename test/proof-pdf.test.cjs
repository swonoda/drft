const test = require("node:test");
const assert = require("node:assert/strict");
const {
  pdfDefaultPath,
  proofPdfDefaultPath,
  ensurePdfExtension,
  normalizePdfPageSettings,
} = require("../src/proof-pdf.cjs");

test("開いているファイル名から通常PDFの保存先を作る", () => {
  assert.equal(pdfDefaultPath("原稿.txt"), "原稿.pdf");
  assert.equal(pdfDefaultPath(null), "原稿.pdf");
});

test("古いファイル名から朱入り原稿PDFの保存先を作る", () => {
  assert.equal(
    proofPdfDefaultPath("C:\\novel\\原稿.txt"),
    "C:\\novel\\原稿_朱入り原稿.pdf",
  );
});

test("PDF拡張子がなければ追加する", () => {
  assert.equal(ensurePdfExtension("C:\\novel\\原稿"), "C:\\novel\\原稿.pdf");
  assert.equal(
    ensurePdfExtension("C:\\novel\\原稿.PDF"),
    "C:\\novel\\原稿.PDF",
  );
});

test("通常PDFと朱入り原稿PDFのページ設定を同じ形式に揃える", () => {
  assert.deepEqual(
    normalizePdfPageSettings({
      separateTitle: 1,
      titleParity: "odd",
      bodyParity: "even",
      cropMarks: 0,
    }),
    {
      separateTitle: true,
      titleParity: "odd",
      bodyParity: "even",
      cropMarks: false,
    },
  );
});
