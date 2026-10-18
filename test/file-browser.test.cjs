const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { readDirectory, readTextDocument } = require("../src/file-browser.cjs");
const { encodeText } = require("../src/text-encoding.cjs");

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "drft-browser-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test("フォルダ優先・自然順で全ファイルを表示し、TXTだけを開ける", async (t) => {
  const root = await fixture(t);
  await fs.mkdir(path.join(root, "資料"));
  for (const file of ["原稿10.txt", "原稿2.TXT", "資料.pdf"])
    await fs.writeFile(path.join(root, file), "本文");
  const result = await readDirectory(root);
  assert.deepEqual(
    result.entries.map((e) => e.name),
    ["資料", "原稿2.TXT", "原稿10.txt", "資料.pdf"],
  );
  assert.deepEqual(
    result.entries.map((e) => e.canOpen),
    [false, true, true, false],
  );
  const child = await readDirectory(path.join(root, "資料"));
  assert.equal(child.parent, root);
  assert.deepEqual(child.entries, []);
  assert.equal((await readDirectory(path.parse(root).root)).parent, null);
  await assert.rejects(
    readDirectory(path.join(root, "消えたフォルダ")),
    /ENOENT/,
  );
  await assert.rejects(readDirectory(12), /パス/);
});

test("UTF-8とShift_JISの原稿を既存の文字コード判定で開く", async (t) => {
  const root = await fixture(t);
  for (const encoding of ["utf8", "shift_jis"]) {
    const file = path.join(root, encoding + ".txt");
    await fs.writeFile(file, encodeText("日本語の原稿\n次の行", encoding));
    const result = await readTextDocument(file);
    assert.equal(result.text, "日本語の原稿\n次の行");
    assert.equal(result.encoding, encoding);
    assert.equal(result.path, file);
  }
  await assert.rejects(readTextDocument(path.join(root, "画像.pdf")), /TXT/);
  await fs.mkdir(path.join(root, "directory.txt"));
  await assert.rejects(
    readTextDocument(path.join(root, "directory.txt")),
    /ファイルを選択/,
  );
});

test("IPCのフォルダ移動は原稿を変更せず、開く操作は読込成功後だけ保存先を切り替える", async (t) => {
  const root = await fixture(t);
  const old = path.join(root, "旧原稿.txt"),
    next = path.join(root, "次の原稿.txt");
  await fs.writeFile(old, "旧本文");
  await fs.writeFile(next, "新本文");
  let current = old,
    closed = 0,
    result = { canceled: true };
  const handlers = new Map();
  const filename = require.resolve("../src/document-ipc.cjs");
  const realRequire = createRequire(filename);
  const context = {
    module: { exports: {} },
    require: (name) =>
      name === "electron"
        ? {
            app: { getPath: () => root },
            ipcMain: {
              handle: (name, callback) => handlers.set(name, callback),
            },
            dialog: { showOpenDialog: async () => result },
          }
        : realRequire(name),
  };
  vm.runInNewContext(await fs.readFile(filename, "utf8"), context, {
    filename,
  });
  context.module.exports.registerDocumentIpc({
    getMainWindow: () => null,
    getCurrentPath: () => current,
    getSessionState: () => ({}),
    useDocument: (file) => {
      current = file;
    },
    persistSession: async () => {},
    closeDictionaryWindow: () => closed++,
    openDictionaryWindow: () => {},
    sendMenuCommand: () => {},
  });
  const call = (name, ...args) => handlers.get(name)({}, ...args);
  assert.equal((await call("folder:list")).path, root);
  assert.equal(await call("file:open"), null);
  assert.equal(current, old);
  await assert.rejects(
    call("file:openPath", path.join(root, "missing.txt")),
    /ENOENT/,
  );
  assert.equal(current, old);
  assert.equal(closed, 0);
  await call("file:save", "変更後の旧本文", "utf8");
  assert.equal(await fs.readFile(old, "utf8"), "変更後の旧本文");
  assert.equal((await call("file:openPath", next)).text, "新本文");
  assert.equal(current, next);
  assert.equal(closed, 1);
  result = { canceled: false, filePaths: [old] };
  assert.equal((await call("file:open")).text, "変更後の旧本文");
  current = null;
  assert.equal((await call("folder:list")).path, root);
});
