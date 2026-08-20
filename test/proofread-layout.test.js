import assert from "node:assert/strict";
import test from "node:test";
import {
  findProofreadBlockPosition,
  findInlineProofreadPosition,
  findProofreadNotePosition,
  proofreadLeaderPoints,
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
    pageWidth: 140,
    pageHeight: 200,
    noteLength: 3,
    baseFontSize: 16,
    anchorRect: { x: 50, y: 40, width: 12, height: 48 },
    occupied: [
      { x: 50, y: 20, width: 12, height: 100 },
      { x: 105, y: 20, width: 12, height: 100 },
    ],
  });
  assert.ok(position);
  assert.ok(position.x > 72 && position.x < 105);
  assert.ok(position.fontSize < 16);
  assert.ok(position.leaderLength >= 10);
});

test("引出線の長さを確保できない行間は欄外配置へ回す", () => {
  assert.equal(
    findInlineProofreadPosition({
      pageWidth: 120,
      pageHeight: 200,
      noteLength: 1,
      baseFontSize: 16,
      anchorRect: { x: 50, y: 40, width: 12, height: 16 },
      occupied: [
        { x: 50, y: 20, width: 12, height: 100 },
        { x: 80, y: 20, width: 12, height: 100 },
      ],
    }),
    null,
  );
});

test("長い追加文は空き領域へ収まる複数列のブロックにする", () => {
  const position = findProofreadBlockPosition({
    pageWidth: 140,
    pageHeight: 200,
    noteLines: [52],
    baseFontSize: 10,
    anchor: { x: 70, y: 80 },
    occupied: [{ x: 0, y: 0, width: 140, height: 118 }],
    gap: 2,
    step: 2,
  });
  assert.ok(position);
  assert.ok(position.y >= 120);
  assert.ok(position.columns >= 7);
  assert.ok(position.height <= 78);
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

test("上余白への引出線は始点の横へ短く出してから上へ曲げる", () => {
  assert.deepEqual(
    proofreadLeaderPoints({
      anchor: { x: 50, y: 60 },
      position: { x: 45, y: 10, width: 10, height: 20 },
      pageHeight: 100,
      armLength: 8,
    }),
    [
      { x: 50, y: 60 },
      { x: 58, y: 60 },
      { x: 58, y: 30 },
      { x: 50, y: 30 },
    ],
  );
});

test("下余白への引出線は始点の横へ短く出してから下へ曲げる", () => {
  assert.deepEqual(
    proofreadLeaderPoints({
      anchor: { x: 50, y: 40 },
      position: { x: 45, y: 75, width: 10, height: 20 },
      pageHeight: 100,
      armLength: 8,
    }),
    [
      { x: 50, y: 40 },
      { x: 58, y: 40 },
      { x: 58, y: 75 },
      { x: 50, y: 75 },
    ],
  );
});

test("左右余白への引出線も始点側に折れを作る", () => {
  assert.deepEqual(
    proofreadLeaderPoints({
      anchor: { x: 50, y: 60 },
      position: { x: 80, y: 50, width: 10, height: 20 },
      pageHeight: 100,
      armLength: 8,
    }),
    [
      { x: 50, y: 60 },
      { x: 58, y: 60 },
      { x: 58, y: 68 },
      { x: 80, y: 68 },
      { x: 80, y: 60 },
    ],
  );
});

test("置換の引出線は右の行間へ出たあと注記側へ戻らない", () => {
  assert.deepEqual(
    proofreadLeaderPoints({
      anchor: { x: 50, y: 48 },
      position: { x: 45, y: 75, width: 10, height: 20 },
      pageHeight: 100,
      armLength: 8,
      gutterOnly: true,
      armDirection: 1,
    }),
    [
      { x: 50, y: 48 },
      { x: 58, y: 48 },
      { x: 58, y: 75 },
    ],
  );
});
