const assert = require("node:assert/strict");
const test = require("node:test");

const { boxToImageBounds } = require("../src/pdf-layout.cjs");

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
