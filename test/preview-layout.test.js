import assert from "node:assert/strict";
import test from "node:test";
import {
  previewPageBodyWidth,
  previewPageCount,
  previewPageForOffset,
  editorMarginWithPreview,
  fixedSpreadPreviewLayout,
} from "../src/preview-layout.js";

test("指定行数から縦書きプレビューの本文幅を計算する", () => {
  assert.equal(previewPageBodyWidth(18, 1.75, 16), 504);
  assert.equal(previewPageBodyWidth(18, 1.75, 20), 630);
  assert.equal(previewPageBodyWidth(18, 1.75, 24), 756);
});

test("本文幅を固定ページへ分割する", () => {
  assert.equal(previewPageCount(1001, 500), 3);
  assert.equal(previewPageCount(1001, 500, 1), 2);
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

test("A4見開きの外形を固定して余白・行数・文字数から組版を計算する", () => {
  const layout = fixedSpreadPreviewLayout({
    verticalMarginMm: 15,
    horizontalMarginMm: 15,
    charactersPerLine: 40,
    linesPerPage: 20,
    pixelsPerMm: 4,
  });
  assert.deepEqual(layout, {
    pageWidth: 594,
    pageHeight: 840,
    bodyWidth: 473.75,
    bodyHeight: 720,
    verticalMargin: 60,
    horizontalMargin: 60,
    linePitch: 23.6875,
    fontSize: 18,
  });
});

test("余白を変えてもA4見開きの縦横比は変わらない", () => {
  const compact = fixedSpreadPreviewLayout({
    verticalMarginMm: 10,
    horizontalMarginMm: 10,
    charactersPerLine: 40,
    linesPerPage: 20,
    pixelsPerMm: 4,
  });
  const wide = fixedSpreadPreviewLayout({
    verticalMarginMm: 30,
    horizontalMarginMm: 30,
    charactersPerLine: 40,
    linesPerPage: 20,
    pixelsPerMm: 4,
  });
  assert.equal(compact.pageWidth, wide.pageWidth);
  assert.equal(compact.pageHeight, wide.pageHeight);
  assert.equal(compact.pageWidth * 2, 1188);
  assert.equal(compact.pageHeight, 840);
  assert.ok(wide.fontSize < compact.fontSize);
});

test("文字サイズと行送りを文字数・行数から独立して計算する", () => {
  const layout = fixedSpreadPreviewLayout({
    verticalMarginMm: 15,
    horizontalMarginMm: 15,
    charactersPerLine: 40,
    linesPerPage: 30,
    pixelsPerMm: 4,
  });
  assert.equal(layout.fontSize, 18);
  assert.equal(layout.linePitch, 15.796875);
  assert.equal(layout.bodyWidth, layout.linePitch * 30);
});
