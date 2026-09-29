import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { EditorView } from "@codemirror/view";

// Renderer/IPC integration only: layout and OS composition are not emulated.
test("長文を保存し、変換中は保留、確定後は保存再開、別原稿へUndoを持ち越さない", async () => {
  const dom = new JSDOM(
    await readFile(new URL("../src/index.html", import.meta.url), "utf8"),
    { url: "http://localhost", pretendToBeVisual: true },
  );
  const { window } = dom;
  window.requestAnimationFrame = () => 0;
  window.cancelAnimationFrame = () => {};
  for (const name of [
    "window",
    "document",
    "MutationObserver",
    "HTMLElement",
    "Node",
    "NodeFilter",
    "localStorage",
    "requestAnimationFrame",
    "cancelAnimationFrame",
  ])
    globalThis[name] = name === "window" ? window : window[name];
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  const manuscript = "本文。\n".repeat(51021);
  const saved = [];
  let menu, proof, finishSave;
  let delayed = false;
  window.confirm = () => true;
  window.desktop = {
    restoreDocument: async () => ({
      path: "long.txt",
      encoding: "utf8",
      text: manuscript,
    }),
    onMenuCommand: (callback) => {
      menu = callback;
    },
    onProofApplied: (callback) => {
      proof = callback;
    },
    save: async (text) => {
      saved.push(text);
      if (delayed)
        await new Promise((resolve) => {
          finishSave = resolve;
        });
      return "long.txt";
    },
    open: async () => ({
      path: "next.txt",
      encoding: "utf8",
      text: "次の原稿",
    }),
  };
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  await import("../src/renderer.js");
  await tick();
  const view = EditorView.findFromDOM(document.querySelector(".cm-editor"));
  try {
    assert.equal(view.state.doc.length, 204084);
    menu("save");
    await tick();
    assert.equal(saved.at(-1), manuscript);
    view.contentDOM.dispatchEvent(
      new window.CompositionEvent("compositionstart", { bubbles: true }),
    );
    view.dispatch({ changes: { from: view.state.doc.length, insert: "変換" } });
    const count = saved.length;
    await new Promise((resolve) => setTimeout(resolve, 1300));
    assert.equal(saved.length, count);
    view.contentDOM.dispatchEvent(
      new window.CompositionEvent("compositionend", { bubbles: true }),
    );
    await new Promise((resolve) => setTimeout(resolve, 1300));
    assert.equal(saved.at(-1), manuscript + "変換");
    assert.match(document.querySelector("#state").textContent, /^自動保存済み/);
    delayed = true;
    menu("save");
    view.dispatch({ changes: { from: view.state.doc.length, insert: "追記" } });
    finishSave();
    await tick();
    assert.match(document.querySelector("#state").textContent, /^未保存/);
    delayed = false;
    menu("open");
    await tick();
    view.focus();
    menu("undo");
    assert.equal(view.state.doc.toString(), "次の原稿");
    proof({ text: "校正反映" });
    assert.equal(view.state.doc.toString(), "校正反映");
    menu("undo");
    assert.equal(view.state.doc.toString(), "次の原稿");
    menu("save");
    await tick();
    menu("open"); // clear pending refresh/save timers before closing the test DOM
    await tick();
  } finally {
    view.destroy();
    window.close();
  }
});
