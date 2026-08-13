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
  assert.deepEqual(buildProofreadChanges("白熊が歩く。", "白熊が。"), [
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
  assert.deepEqual(buildProofreadChanges("氷が光る。", "雪が光る。"), [
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
  assert.deepEqual(buildProofreadChanges("白熊。", "大きな白熊。"), []);
});

test("改行をまたぐ置き換えを行ごとの校正指示へ分ける", () => {
  const oldText =
    "あいうえお\n\nあいうえお\nかきくけこ\nさしすせそ\nたちつてと";
  const newText =
    "あいうえお\n\nあお\nかき\nさし\nみはあさがいちばん\nでも食べるなら夜かな。";
  assert.deepEqual(buildProofreadChanges(oldText, newText), [
    {
      id: 1,
      start: 8,
      end: 11,
      removed: "いうえ",
      replacement: null,
      type: "delete",
    },
    {
      id: 2,
      start: 15,
      end: 18,
      removed: "くけこ",
      replacement: null,
      type: "delete",
    },
    {
      id: 3,
      start: 21,
      end: 24,
      removed: "すせそ",
      replacement: "みはあさがいちばん",
      type: "replace",
    },
    {
      id: 4,
      start: 25,
      end: 30,
      removed: "たちつてと",
      replacement: "でも食べるなら夜かな。",
      type: "replace",
    },
  ]);
});
