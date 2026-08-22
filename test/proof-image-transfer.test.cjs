const assert = require("node:assert/strict");
const test = require("node:test");
const { createPngPayload } = require("../src/proof-image-transfer.cjs");

test("PDFページのPNGを欠落検査付きで画面用データへ変換する", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const payload = createPngPayload(png);

  assert.equal(payload.mimeType, "image/png");
  assert.equal(payload.byteLength, png.length);
  assert.deepEqual(Buffer.from(payload.base64, "base64"), png);
});

test("PNGではない変換結果を画面へ渡さない", () => {
  assert.throws(() => createPngPayload(Buffer.from("not png")), /PNG形式/);
});
