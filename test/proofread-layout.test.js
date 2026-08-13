import assert from "node:assert/strict";
import test from "node:test";
import {
  findInlineProofreadPosition,
  findProofreadNotePosition,
} from "../src/proofread-layout.js";

test("本文領域内を含む最寄りの空白へ校正文字を置く", () => {
  const position = findProofreadNotePosition({
    pageWidth: 100,
    pageHeight: 100,
    noteWidth: 10,
    noteHeight: 30,
    anchor: { x: 50, y: 40 },
    occupied: [{ x: 0, y: 0, width: 100, height: 65 }],
    gap: 2,
    step: 2,
  });
  assert.ok(position.y >= 67);
  assert.ok(position.x >= 38 && position.x <= 52);
});

test("空白候補は既存の校正文字とも重ならない", () => {
  const occupied = [
    { x: 40, y: 0, width: 20, height: 65 },
    { x: 38, y: 67, width: 10, height: 30 },
  ];
  const position = findProofreadNotePosition({
    pageWidth: 100,
    pageHeight: 100,
    noteWidth: 10,
    noteHeight: 30,
    anchor: { x: 50, y: 40 },
    occupied,
    gap: 2,
    step: 2,
  });
  assert.notDeepEqual({ x: position.x, y: position.y }, { x: 38, y: 68 });
});

test("長い校正文字でも中心ではなく最も近い辺までの距離で選ぶ", () => {
  const position = findProofreadNotePosition({
    pageWidth: 120,
    pageHeight: 240,
    noteWidth: 12,
    noteHeight: 100,
    anchor: { x: 70, y: 80 },
    occupied: [
      { x: 50, y: 20, width: 40, height: 60 },
      { x: 20, y: 0, width: 30, height: 200 },
      { x: 90, y: 0, width: 30, height: 200 },
    ],
    gap: 2,
    step: 2,
  });
  assert.ok(position.y >= 82);
  assert.ok(position.x >= 50 && position.x <= 78);
});

test("短い置換文字は取り消し線右側の行間へ置く", () => {
  const position = findInlineProofreadPosition({
    pageWidth: 120,
    pageHeight: 200,
    noteLength: 3,
    baseFontSize: 16,
    anchorRect: { x: 50, y: 40, width: 12, height: 48 },
    occupied: [
      { x: 50, y: 20, width: 12, height: 100 },
      { x: 80, y: 20, width: 12, height: 100 },
    ],
  });
  assert.ok(position);
  assert.ok(position.x > 62 && position.x < 80);
  assert.ok(position.fontSize < 16);
});

test("行間やページ下端へ収まらない置換文字は欄外配置へ回す", () => {
  assert.equal(
    findInlineProofreadPosition({
      pageWidth: 120,
      pageHeight: 100,
      noteLength: 8,
      baseFontSize: 16,
      anchorRect: { x: 50, y: 40, width: 12, height: 48 },
      occupied: [
        { x: 50, y: 20, width: 12, height: 80 },
        { x: 80, y: 20, width: 12, height: 80 },
      ],
    }),
    null,
  );
});
