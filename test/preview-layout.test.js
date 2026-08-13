import assert from "node:assert/strict";
import test from "node:test";
import {
  previewPageBodyWidth,
  previewPageCount,
  previewPageForOffset,
  editorMarginWithPreview,
  previewPageFrame,
} from "../src/preview-layout.js";

test("指定行数から縦書きプレビューの本文幅を計算する", () => {
  assert.equal(previewPageBodyWidth(18, 1.75, 16), 504);
  assert.equal(previewPageBodyWidth(18, 1.75, 20), 630);
  assert.equal(previewPageBodyWidth(18, 1.75, 24), 756);
});

test("本文幅を固定ページへ分割する", () => {
  assert.equal(previewPageCount(1001, 500), 3);
  assert.equal(previewPageForOffset(0, 500, 3), 0);
  assert.equal(previewPageForOffset(500, 500, 3), 1);
  assert.equal(previewPageForOffset(1200, 500, 3), 2);
});

test("指定行数の境界で次のページへ進む", () => {
  const pageWidth = previewPageBodyWidth(18, 1.75, 20);
  assert.equal(previewPageForOffset(pageWidth - 1, pageWidth, 3), 0);
  assert.equal(previewPageForOffset(pageWidth, pageWidth, 3), 1);
  assert.equal(previewPageForOffset(pageWidth * 2 - 1, pageWidth, 3), 1);
  assert.equal(previewPageForOffset(pageWidth * 2, pageWidth, 3), 2);
});

test("プレビュー幅の半分をエディタの左右余白から引く", () => {
  assert.equal(editorMarginWithPreview(300, 400), 100);
  assert.equal(editorMarginWithPreview(120, 400), 40);
  assert.equal(editorMarginWithPreview(120, 0), 120);
  assert.equal(editorMarginWithPreview(0, 0), 0);
});

test("本文サイズと上下左右余白から比較プレビューのページ寸法を作る", () => {
  assert.deepEqual(previewPageFrame(504, 720, 40, 56), {
    pageWidth: 616,
    pageHeight: 800,
  });
  assert.deepEqual(previewPageFrame(504, 720, -10, -20), {
    pageWidth: 504,
    pageHeight: 720,
  });
});
