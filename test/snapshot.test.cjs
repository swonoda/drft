const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  ensureTxtExtension,
  snapshotDefaultPath,
  snapshotTimestamp,
} = require("../src/snapshot.cjs");

const date = new Date(2026, 6, 17, 14, 3, 9);

test("スナップショット用の日時をファイル名向けに整形する", () => {
  assert.equal(snapshotTimestamp(date), "20260717-140309");
});

test("原稿と同じ場所に日時付きスナップショット名を作る", () => {
  const source = path.join("作品", "長編.txt");
  assert.equal(
    snapshotDefaultPath(source, date),
    path.join("作品", "長編_スナップショット_20260717-140309.txt"),
  );
});

test("新規原稿にもスナップショット名を作る", () => {
  assert.equal(
    snapshotDefaultPath(null, date),
    "新しい小説_スナップショット_20260717-140309.txt",
  );
});

test("保存先にtxt拡張子がなければ追加する", () => {
  assert.equal(ensureTxtExtension("改稿前"), "改稿前.txt");
  assert.equal(ensureTxtExtension("改稿前.TXT"), "改稿前.TXT");
});
