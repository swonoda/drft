const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { unpackedAsarPath } = require("../src/packaged-path.cjs");

test("配布版の実行ファイルをapp.asar.unpacked側から参照する", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "drft-asar-"));
  try {
    const packed = path.join(
      root,
      "resources",
      "app.asar",
      "node_modules",
      "tool",
      "tool.exe",
    );
    const unpacked = path.join(
      root,
      "resources",
      "app.asar.unpacked",
      "node_modules",
      "tool",
      "tool.exe",
    );
    fs.mkdirSync(path.dirname(unpacked), { recursive: true });
    fs.writeFileSync(unpacked, "tool");
    assert.equal(unpackedAsarPath(packed), unpacked);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("通常実行時のパスは変更しない", () => {
  assert.equal(
    unpackedAsarPath("C:\\tools\\pdftoppm.exe"),
    "C:\\tools\\pdftoppm.exe",
  );
});
