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
  const pathOpens = [];
  let directoryReads = 0;
  let menu, proof, finishSave;
  let delayed = false;
  window.confirm = () => true;
  window.desktop = {
    listDirectory: async () => {
      directoryReads++;
      return {
        path: "/books",
        name: "books",
        parent: "/",
        entries: [
          { name: "other.txt", path: "other.txt", kind: "file", canOpen: true },
          {
            name: "missing.txt",
            path: "missing.txt",
            kind: "file",
            canOpen: true,
          },
        ],
      };
    },
    chooseDirectory: async () => null,
    openPath: async (path) => {
      pathOpens.push(path);
      if (path === "missing.txt") throw new Error("ファイルがありません");
      return { path, encoding: "shift_jis", text: "他の原稿" };
    },
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
    assert.equal(
      directoryReads,
      0,
      "hidden file tab does not read folders during editing",
    );
    document.querySelector("#filesTab").click();
    await tick();
    assert.equal(document.querySelector("#fileBrowser").hidden, false);
    assert.equal(document.querySelector("#outline").hidden, true);
    assert.equal(document.querySelector("#fixList").hidden, true);
    assert.equal(directoryReads, 1);
    const fileButton = (name) =>
      [...document.querySelectorAll(".file-entry")].find(
        (button) => button.textContent === name,
      );
    view.dispatch({
      changes: { from: view.state.doc.length, insert: "未保存" },
    });
    assert.equal(directoryReads, 1, "editing does not rescan the folder");
    window.confirm = () => false;
    await fileButton("other.txt").onclick();
    assert.deepEqual(pathOpens, []);
    assert.equal(view.state.doc.toString(), "次の原稿未保存");
    window.confirm = () => true;
    delayed = true;
    menu("save");
    const opening = fileButton("other.txt").onclick();
    await tick();
    assert.deepEqual(
      pathOpens,
      [],
      "wait for pending write before opening another file",
    );
    assert.equal(view.dom.inert, true);
    finishSave();
    await opening;
    delayed = false;
    await tick();
    assert.deepEqual(pathOpens, ["other.txt"]);
    assert.equal(view.state.doc.toString(), "他の原稿");
    assert.equal(document.querySelector("#encoding").value, "shift_jis");
    assert.equal(
      document.querySelector(".file-entry.current").textContent,
      "other.txt",
    );
    menu("undo");
    assert.equal(view.state.doc.toString(), "他の原稿");
    await fileButton("missing.txt").onclick();
    assert.equal(view.state.doc.toString(), "他の原稿");
    assert.equal(view.dom.inert, false);
    assert.match(
      document.querySelector("#state").textContent,
      /ファイルがありません/,
    );
    document.querySelector("#fixTab").click();
    assert.equal(document.querySelector("#fileBrowser").hidden, true);
    assert.equal(document.querySelector("#fixList").hidden, false);
    menu("open"); // clear pending refresh/save timers before closing the test DOM
    await tick();
  } finally {
    view.destroy();
    window.close();
  }
});
