const test = require("node:test");
const assert = require("node:assert/strict");
const {
  proofPdfDefaultPath,
  ensurePdfExtension,
} = require("../src/proof-pdf.cjs");

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
