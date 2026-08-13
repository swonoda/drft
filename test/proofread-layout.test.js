import assert from "node:assert/strict";
import test from "node:test";
import { findProofreadNotePosition } from "../src/proofread-layout.js";

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
