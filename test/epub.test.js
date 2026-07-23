import test from "node:test";
import assert from "node:assert/strict";
import { buildEpubBook } from "../src/epub.js";

const options = {
  identifier: "urn:uuid:test-book",
  modified: "2026-07-23T00:00:00Z",
};

test("タイトルと章から縦書きEPUBの本文と目次を作る", () => {
  const book = buildEpubBook(
    "流氷\n\n前書き。\n\n\n第一章\n\n本文。\n\n\n1\n\n節本文。\n\n\n第二章\n\n続き。",
    options,
  );
  const file = (path) =>
    book.files.find((entry) => entry.path === path)?.content;
  assert.equal(book.title, "流氷");
  assert.match(file("EPUB/package.opf"), /page-progression-direction="rtl"/);
  assert.match(file("EPUB/nav.xhtml"), /第一章/);
  assert.doesNotMatch(file("EPUB/nav.xhtml"), />1<\/a>/);
  assert.match(file("EPUB/nav.xhtml"), /body\.xhtml#chapter-3/);
  assert.match(file("EPUB/body.xhtml"), /id="chapter-1">第一章/);
  assert.match(file("EPUB/style.css"), /writing-mode: vertical-rl/);
  assert.match(file("EPUB/style.css"), /list-style: none/);
  assert.match(file("EPUB/style.css"), /content: counter\(page\)/);
});

test("ルビと傍点を反映し、修正マークはEPUBから除外する", () => {
  const book = buildEpubBook(
    "題名\n\n｜流氷《りゅうひょう》を《《見る》》。#fix[要確認]",
    options,
  );
  const body = book.files.find(
    (entry) => entry.path === "EPUB/body.xhtml",
  ).content;
  assert.match(body, /<ruby>流氷<rt>りゅうひょう<\/rt><\/ruby>/);
  assert.match(body, /<em class="bout">見る<\/em>/);
  assert.doesNotMatch(body, /#fix/);
});

test("章がない原稿にも本文への目次を作る", () => {
  const book = buildEpubBook("題名\n\n本文だけ。", options);
  const nav = book.files.find(
    (entry) => entry.path === "EPUB/nav.xhtml",
  ).content;
  assert.match(nav, /body\.xhtml#body-start">本文<\/a>/);
});
