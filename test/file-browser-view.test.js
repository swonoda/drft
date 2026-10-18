import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { createFileBrowser } from "../src/file-browser-view.js";
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const entry = (name, kind = "file", canOpen = true) => ({
  name,
  path: "/books/" + name,
  kind,
  canOpen,
});
const books = {
  path: "/books",
  name: "books",
  parent: "/",
  entries: [
    entry("sub", "directory", false),
    entry("first.txt"),
    entry("second.txt"),
    entry("notes.pdf", "file", false),
  ],
};

async function setup(t, api, openFile = async () => {}) {
  const dom = new JSDOM(
    await readFile(new URL("../src/index.html", import.meta.url), "utf8"),
  );
  globalThis.document = dom.window.document;
  t.after(() => {
    dom.window.close();
    delete globalThis.document;
  });
  const root = document.querySelector("#fileBrowser");
  return { root, view: createFileBrowser({ root, desktop: api, openFile }) };
}

test("ファイルタブは表示時だけ読み込み、親・子フォルダへ移動できる", async (t) => {
  const calls = [],
    opened = [];
  const { root, view } = await setup(
    t,
    {
      listDirectory: async (p) => {
        calls.push(p);
        if (p === "/")
          return { path: "/", name: "/", parent: null, entries: [] };
        if (p === "/books/sub")
          return { path: p, name: "sub", parent: "/books", entries: [] };
        return books;
      },
      chooseDirectory: async () => null,
    },
    async (p) => opened.push(p),
  );
  view.setCurrentFile("/books/first.txt");
  assert.equal(calls.length, 0);
  view.setVisible(true);
  await tick();
  assert.equal(root.querySelector(".current").textContent, "first.txt");
  assert.equal(root.querySelectorAll(".file-entry")[3].disabled, true);
  await root.querySelectorAll(".file-entry")[2].onclick();
  assert.deepEqual(opened, ["/books/second.txt"]);
  await root.querySelectorAll(".file-entry")[0].onclick();
  assert.match(root.querySelector("#fileStatus").textContent, /空/);
  await root.querySelector("#fileUp").onclick();
  assert.equal(root.querySelector("#fileLocation").title, "/books");
  await root.querySelector("#fileChoose").onclick();
  assert.equal(root.querySelector("#fileLocation").title, "/books");
  await root.querySelector("#fileUp").onclick();
  assert.equal(root.querySelector("#fileUp").disabled, true);
  view.setVisible(false);
  const count = calls.length;
  view.setCurrentFile("/elsewhere/new.txt");
  assert.equal(calls.length, count);
});

test("原稿切替後に古いフォルダの応答が来ても表示を戻さない", async (t) => {
  const resolvers = [];
  const { root, view } = await setup(t, {
    listDirectory: () => new Promise((resolve) => resolvers.push(resolve)),
    chooseDirectory: async () => null,
  });
  view.setVisible(true);
  view.setCurrentFile("/new/current.txt");
  resolvers[1]({ path: "/new", name: "new", parent: "/", entries: [] });
  await tick();
  resolvers[0](books);
  await tick();
  assert.equal(root.querySelector("#fileLocation").title, "/new");
});

test("読込エラーでも移動元を保持し、ファイル名をHTMLとして解釈しない", async (t) => {
  let fail = false;
  const { root, view } = await setup(t, {
    listDirectory: async () => {
      if (fail) throw new Error("アクセス拒否");
      return { ...books, entries: [entry("<img src=x>.txt")] };
    },
    chooseDirectory: async () => null,
  });
  view.setVisible(true);
  await tick();
  assert.equal(root.querySelectorAll("img").length, 0);
  assert.equal(
    root.querySelector(".file-entry").textContent,
    "<img src=x>.txt",
  );
  fail = true;
  await root.querySelector("#fileRefresh").onclick();
  assert.match(root.querySelector("#fileStatus").textContent, /アクセス拒否/);
  assert.equal(root.querySelector("#fileLocation").title, "/books");
  assert.equal(root.querySelector("#fileChoose").disabled, false);
});
