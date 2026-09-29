import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createManuscriptEditor } from "../src/editor.js";

// These tests verify document transactions/history, not layout or native IME.
const dom = new JSDOM('<div id="editor"></div>', { pretendToBeVisual: true });
for (const name of [
  "window",
  "document",
  "MutationObserver",
  "HTMLElement",
  "Node",
  "getComputedStyle",
])
  globalThis[name] =
    name === "getComputedStyle"
      ? dom.window[name].bind(dom.window)
      : dom.window[name];
const manuscript = "原稿\n｜漢字《かんじ》と日本語。\n"
  .repeat(15000)
  .slice(0, 204084);

function withEditor(run) {
  let changes = 0;
  const editor = createManuscriptEditor(document.querySelector("#editor"), {
    onChange: () => changes++,
  });
  try {
    run(editor, () => changes);
  } finally {
    editor.destroy();
  }
}

test("204084文字の冒頭・末尾を編集しても全文とUndo/Redoを保持する", () =>
  withEditor((editor, changes) => {
    editor.loadDocument(manuscript);
    assert.equal(editor.value, manuscript);
    assert.equal(changes(), 0);
    editor.setSelectionRange(0);
    editor.setRangeText("冒頭");
    editor.setSelectionRange(editor.value.length);
    editor.setRangeText("末尾");
    assert.equal(editor.value, "冒頭" + manuscript + "末尾");
    editor.runCommand("undo");
    assert.equal(editor.value, "冒頭" + manuscript);
    editor.runCommand("undo");
    assert.equal(editor.value, manuscript);
    editor.runCommand("redo");
    editor.runCommand("redo");
    assert.equal(editor.value, "冒頭" + manuscript + "末尾");
  }));

test("全文置換と全選択の削除をそれぞれ一回のUndoで戻せる", () =>
  withEditor((editor) => {
    editor.loadDocument(manuscript);
    const replaced = manuscript.replaceAll("日本語", "にほんご");
    editor.value = replaced;
    assert.equal(editor.value, replaced);
    editor.runCommand("undo");
    assert.equal(editor.value, manuscript);
    editor.runCommand("redo");
    editor.runCommand("selectAll");
    assert.equal(editor.selectionStart, 0);
    assert.equal(editor.selectionEnd, replaced.length);
    editor.setRangeText("");
    assert.equal(editor.value, "");
    editor.runCommand("undo");
    assert.equal(editor.value, replaced);
  }));

test("ファイルを開き直すと以前の原稿のUndo履歴を持ち越さない", () =>
  withEditor((editor, changes) => {
    editor.loadDocument(manuscript);
    editor.value = "ゲラ反映";
    assert.equal(changes(), 1);
    editor.loadDocument("別原稿\n本文");
    editor.runCommand("undo");
    assert.equal(editor.value, "別原稿\n本文");
    assert.equal(changes(), 1);
    editor.loadDocument("");
    editor.runCommand("undo");
    assert.equal(editor.value, "");
  }));

test("改行とサロゲートペアを含む置換・目次位置を扱う", () =>
  withEditor((editor) => {
    editor.loadDocument("題名\r\n本文😀\r\n終わり");
    assert.equal(editor.value, "題名\n本文😀\n終わり"); // same LF normalization as textarea
    assert.equal(editor.lineStart(2), "題名\n本文😀\n".length);
    editor.setSelectionRange(3, 7);
    editor.setRangeText("差し替え\r\n😀");
    assert.equal(editor.value, "題名\n差し替え\n😀\n終わり");
    assert.equal(editor.selectionStart, "題名\n差し替え\n😀".length);
    editor.runCommand("undo");
    assert.equal(editor.value, "題名\n本文😀\n終わり");
  }));

test("改行時にコード向けの自動インデントを追加しない", () =>
  withEditor((editor) => {
    editor.loadDocument("  本文");
    editor.setSelectionRange(editor.value.length);
    editor.contentDOM.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    assert.equal(editor.value, "  本文\n");
  }));
