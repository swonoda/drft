const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildDiffParts,
  buildProofreadChanges,
} = require("../src/diff-engine.cjs");

test("変更部分を単語単位で識別する", () => {
  const parts = buildDiffParts("白熊が歩く。", "白熊がゆっくり歩く。");
  assert.equal(
    parts.map((part) => part.value).join(""),
    "白熊がゆっくり歩く。",
  );
  assert.deepEqual(
    parts.filter((part) => part.added).map((part) => part.value),
    ["ゆっくり"],
  );
  assert.equal(parts.filter((part) => part.removed).length, 0);
});

test("連続する削除と追加を同じ変更箇所として扱う", () => {
  const parts = buildDiffParts("氷。", "雪。");
  const changed = parts.filter((part) => part.changeId !== null);
  assert.ok(changed.length >= 2);
  assert.equal(new Set(changed.map((part) => part.changeId)).size, 1);
});

test("離れた変更には別々の変更番号を付ける", () => {
  const parts = buildDiffParts("春の朝。夏の夜。", "秋の朝。冬の夜。");
  assert.deepEqual(
    [...new Set(parts.flatMap((part) => part.changeId ?? []))],
    [1, 2],
  );
});

test("改行コードを揃えて比較する", () => {
  const parts = buildDiffParts("一行目\r\n二行目", "一行目\n二行目");
  assert.equal(
    parts.some((part) => part.changeId !== null),
    false,
  );
});

test("削除をトル指定用の範囲へ変換する", () => {
  const parts = buildDiffParts("白熊が歩く。", "白熊が。");
  assert.deepEqual(buildProofreadChanges(parts), [
    {
      id: 1,
      start: 3,
      end: 5,
      removed: "歩く",
      replacement: null,
      type: "delete",
    },
  ]);
});

test("隣接する削除と追加を置き換え指定へ変換する", () => {
  const parts = buildDiffParts("氷が光る。", "雪が光る。");
  assert.deepEqual(buildProofreadChanges(parts), [
    {
      id: 1,
      start: 0,
      end: 1,
      removed: "氷",
      replacement: "雪",
      type: "replace",
    },
  ]);
});

test("追加だけの変更は削除・置き換え指定に含めない", () => {
  const parts = buildDiffParts("白熊。", "大きな白熊。");
  assert.deepEqual(buildProofreadChanges(parts), []);
});
