const test = require("node:test");
const assert = require("node:assert/strict");
const { recognizeProofChanges } = require("../src/proof-recognition.cjs");

test("認識処理が未接続の間は本文を推測で変更しない", async () => {
  const source = "文章はそのまま保持する。";
  const result = await recognizeProofChanges("赤ゲラ.pdf", source);

  assert.deepEqual(result.changes, []);
  assert.match(result.notice, /まだ接続されていません/);
});
