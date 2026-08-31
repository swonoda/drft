const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildProofDraft,
  findSingleEdit,
  inferProofChangeType,
  updateProofChangeRanges,
} = require("../src/proof-apply-engine.cjs");

test("追加・置換・削除を元の座標から仮反映する", () => {
  const source = "甲乙丙丁戊";
  const result = buildProofDraft(source, [
    { id: "add", start: 1, end: 1, replacement: "追", type: "addition" },
    {
      id: "replace",
      start: 2,
      end: 3,
      original: "丙",
      replacement: "新",
      type: "replacement",
    },
    { id: "delete", start: 4, end: 5, original: "戊", type: "deletion" },
  ]);

  assert.equal(result.text, "甲追乙新丁");
  assert.deepEqual(
    result.changes.map(({ id, draftStart, draftEnd, original }) => ({
      id,
      draftStart,
      draftEnd,
      original,
    })),
    [
      { id: "add", draftStart: 1, draftEnd: 2, original: "" },
      { id: "replace", draftStart: 3, draftEnd: 4, original: "丙" },
      { id: "delete", draftStart: 5, draftEnd: 5, original: "戊" },
    ],
  );
});

test("重複範囲と元文字列の不一致を拒否する", () => {
  assert.throws(
    () =>
      buildProofDraft("abcdef", [
        { start: 1, end: 4, replacement: "x" },
        { start: 3, end: 5, replacement: "y" },
      ]),
    /重なっている/,
  );
  assert.throws(
    () =>
      buildProofDraft("abcdef", [
        { start: 1, end: 2, original: "x", replacement: "y" },
      ]),
    /元文字列が一致しません/,
  );
});

test("一回の編集範囲を検出する", () => {
  assert.deepEqual(findSingleEdit("abcde", "abXYde"), {
    start: 2,
    beforeEnd: 3,
    afterEnd: 4,
    delta: 1,
  });
  assert.equal(findSingleEdit("same", "same"), null);
});

test("選択範囲と入力内容から変更方法を決める", () => {
  assert.equal(inferProofChangeType(3, 3, "追加"), "addition");
  assert.equal(inferProofChangeType(3, 5, "置換"), "replacement");
  assert.equal(inferProofChangeType(3, 5, ""), "deletion");
  assert.equal(inferProofChangeType(3, 3, ""), null);
});

test("仮反映文字を編集しても後続候補の位置を保つ", () => {
  const draft = buildProofDraft("甲乙丙丁", [
    { id: "first", start: 1, end: 2, replacement: "一" },
    { id: "second", start: 3, end: 4, replacement: "二" },
  ]);
  const after = "甲長い修正丙二";
  const ranges = updateProofChangeRanges(draft.changes, draft.text, after);
  assert.deepEqual(
    ranges.map(({ id, draftStart, draftEnd, edited }) => ({
      id,
      draftStart,
      draftEnd,
      edited,
    })),
    [
      { id: "first", draftStart: 1, draftEnd: 5, edited: true },
      { id: "second", draftStart: 6, draftEnd: 7, edited: false },
    ],
  );
});
