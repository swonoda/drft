const test = require("node:test");
const assert = require("node:assert/strict");
const {
  UTF8,
  SHIFT_JIS,
  decodeText,
  encodeText,
} = require("../src/text-encoding.cjs");

test("UTF-8のTXTを判定して復元する", () => {
  const source = "流氷の向こうに朝日が見える。";
  const decoded = decodeText(encodeText(source, UTF8));
  assert.equal(decoded.encoding, UTF8);
  assert.equal(decoded.text, source);
});

test("Shift_JISのTXTを判定して復元する", () => {
  const source = "流氷の向こうに朝日が見える。";
  const decoded = decodeText(encodeText(source, SHIFT_JIS));
  assert.equal(decoded.encoding, SHIFT_JIS);
  assert.equal(decoded.text, source);
});
