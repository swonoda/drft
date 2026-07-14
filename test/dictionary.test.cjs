const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseDictionary,
  serializeDictionary,
} = require("../src/dictionary.cjs");

test("辞書Markdownの見出しと説明を解析する", () => {
  const source =
    "# ジェームズ\n\n若手弁護士。\n依頼人に肩入れしやすい。\n\n# スターリング\n\n主要舞台。\n";
  assert.deepEqual(parseDictionary(source), [
    {
      heading: "ジェームズ",
      description: "若手弁護士。\n依頼人に肩入れしやすい。",
    },
    { heading: "スターリング", description: "主要舞台。" },
  ]);
});

test("辞書を人間が読めるMarkdownへ戻す", () => {
  const entries = [{ heading: "流氷", description: "海を漂う氷。" }];
  assert.equal(serializeDictionary(entries), "# 流氷\n\n海を漂う氷。\n");
});
