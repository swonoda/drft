import assert from "node:assert/strict";
import test from "node:test";
import {
  previewPageBodyWidth,
  previewPageCount,
  previewPageForOffset,
  editorMarginWithPreview,
} from "../src/preview-layout.js";

test("指定行数から縦書きプレビューの本文幅を計算する", () => {
  assert.equal(previewPageBodyWidth(18, 1.75, 16), 504);
});

test("本文幅を固定ページへ分割する", () => {
  assert.equal(previewPageCount(1001, 500), 3);
  assert.equal(previewPageForOffset(0, 500, 3), 0);
  assert.equal(previewPageForOffset(500, 500, 3), 1);
  assert.equal(previewPageForOffset(1200, 500, 3), 2);
});

test("プレビュー幅の半分をエディタの左右余白から引く", () => {
  assert.equal(editorMarginWithPreview(300, 400), 100);
  assert.equal(editorMarginWithPreview(120, 400), 40);
  assert.equal(editorMarginWithPreview(120, 0), 120);
  assert.equal(editorMarginWithPreview(0, 0), 0);
});
