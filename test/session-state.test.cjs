const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  dictionaryFilePath,
  readSessionState,
  writeSessionState,
} = require("../src/session-state.cjs");

test("前回開いた原稿と辞書ウィンドウの状態を保存して復元する", async (t) => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "drft-session-"));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const file = path.join(folder, "session.json");
  const state = {
    currentPath: path.join(folder, "作品.txt"),
    dictionaryOpen: true,
  };

  await writeSessionState(file, state);
  assert.deepEqual(await readSessionState(file), state);
});

test("原稿ごとの辞書ファイル名を作る", () => {
  assert.equal(
    dictionaryFilePath(path.join("作品", "長編.txt")),
    path.join("作品", "長編_辞書.md"),
  );
});
