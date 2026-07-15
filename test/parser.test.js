import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  inlineMarkup,
  manuscriptCharacterCount,
  manuscriptSheetCount,
  parseDocument,
  moveParagraphSection,
  findFixMarks,
  renderBody,
  renderPreviewDocument,
  sentenceRangeAt,
} from "../src/parser.js";
test("デフォルト原稿にDRFTの説明文を読み込める", () => {
  const source = readFileSync(
    new URL("../src/default.txt", import.meta.url),
    "utf8",
  );
  const document = parseDocument(source);
  assert.equal(document.title, "DRFT");
  assert.equal(document.sections[0].label, "DRFTについて");
  assert.match(source, /DRFTはWindows向け軽量小説執筆エディタです。/);
});
test("青空とカクヨムのルビを変換する", () => {
  assert.match(
    inlineMarkup("｜白熊《しろくま》"),
    /<ruby>白熊<rt>しろくま<\/rt><\/ruby>/,
  );
  assert.match(inlineMarkup("|東京《とうきょう》"), /<ruby>東京/);
  assert.match(inlineMarkup("東京《とうきょう》"), /<ruby>東京/);
});
test("傍点を変換する", () => {
  assert.match(inlineMarkup("《《重要》》"), /class="bout">重要/);
  assert.match(inlineMarkup("［＃「重要」に傍点］"), /class="bout">重要/);
  const aozora = inlineMarkup("怪我［＃「怪我」に傍点］");
  assert.match(aozora, /class="bout">怪我/);
  assert.equal((aozora.match(/怪我/g) || []).length, 1);
  assert.equal(manuscriptCharacterCount("怪我［＃「怪我」に傍点］"), 2);
});
test("先頭行をタイトル、二行空き後を章として解析する", () => {
  const d = parseDocument("題名\n\n段落一\n\n\n第一章\n\n段落二");
  assert.equal(d.title, "題名");
  assert.equal(d.sections.filter((x) => x.type === "chapter").length, 1);
  assert.equal(d.sections.find((x) => x.type === "chapter").label, "第一章");
  assert.equal(d.sections.filter((x) => x.type === "paragraph").length, 2);
});
test("節の先頭の全角空白を保持する", () => {
  const d = parseDocument("題名\n\n　段落の本文");
  assert.equal(d.sections[0].raw, "　段落の本文");
  assert.equal(d.sections[0].label, "段落の本文");
});
test("文字数は改行とルビ・傍点の記法を除いて数える", () => {
  const source = "題名\n｜白熊《しろくま》と《《流氷》》";
  assert.equal(manuscriptCharacterCount(source), 7);
});
test("修正マークを一覧化し、プレビューと文字数から除外する", () => {
  const source = "題名\n\n白熊が歩く。#fix[足跡の描写を足す]";
  const marks = findFixMarks(source);
  assert.equal(marks.length, 1);
  assert.equal(marks[0].comment, "足跡の描写を足す");
  assert.equal(marks[0].context, "白熊が歩く。");
  assert.doesNotMatch(renderBody(source), /#fix/);
  assert.equal(manuscriptCharacterCount(source), 8);
});
test("カーソルを含む一文をプレビュー用ハイライトへ変換する", () => {
  const source = "題名\n\n最初の文。本文です。次の文。";
  const html = renderPreviewDocument(source, source.indexOf("で"));
  assert.match(
    html,
    /最初の文。<span class="preview-highlight" data-caret-offset="2">本文です。<\/span>次の文。/,
  );
  assert.equal((html.match(/preview-highlight/g) || []).length, 1);
});
test("文末のカーソルは直前の文全体をハイライトする", () => {
  const source = "題名\n\n最初です。次です。";
  assert.match(
    renderPreviewDocument(source, source.indexOf("次") - 1),
    /<span class="preview-highlight"[^>]*>最初です。<\/span>次です。/,
  );
});
test("タイトルのカーソルは本文先頭へ二重表示しない", () => {
  const source = "題名\n\n本文";
  const html = renderPreviewDocument(source, 1);
  assert.match(
    html,
    /<h1><span class="preview-highlight"[^>]*>題名<\/span><\/h1>/,
  );
  assert.doesNotMatch(html, /<p><span class="preview-highlight"/);
  assert.equal((html.match(/preview-highlight/g) || []).length, 1);
});
test("複数行の節でもカーソル位置を正しく変換する", () => {
  const source = "題名\n\n一行目。\n二行目。\n三行目。";
  const document = parseDocument(source);
  assert.equal(document.sections[0].start, 2);
  const caret = source.indexOf("三行目") + 2;
  const html = renderPreviewDocument(source, caret);
  assert.match(html, /<span class="preview-highlight"[^>]*>三行目。<\/span>/);
  assert.equal((html.match(/preview-highlight/g) || []).length, 1);
});
test("章と節の間の空行では次の要素へカーソルを対応させる", () => {
  const source = "題名\n\n\n第一章\n\n本文";
  const html = renderPreviewDocument(source, source.indexOf("第一章") - 1);
  assert.match(html, /<h2><span class="preview-highlight"/);
  assert.equal((html.match(/preview-highlight/g) || []).length, 1);
});
test("閉じ括弧までを一文として扱う", () => {
  const source = "「行く。」次の文。";
  assert.deepEqual(sentenceRangeAt(source, source.indexOf("」") + 1), {
    start: 0,
    end: 5,
  });
});
test("原稿用紙換算は400字単位で余りを切り上げる", () => {
  assert.equal(manuscriptSheetCount(""), 0);
  assert.equal(manuscriptSheetCount("あ".repeat(400)), 1);
  assert.equal(manuscriptSheetCount("あ".repeat(401)), 2);
  assert.equal(manuscriptSheetCount("あ".repeat(800)), 2);
  assert.equal(manuscriptSheetCount("あ".repeat(801)), 3);
});
test("節を章の下へ移動してTXTへ戻す", () => {
  const source = "題名\n\n段落A\n\n\n第一章\n\n段落B";
  const document = parseDocument(source);
  const moved = moveParagraphSection(document, 0, 1, true);
  assert.equal(moved, "題名\n\n\n第一章\n\n段落A\n\n段落B");
});
