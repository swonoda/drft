const fs = require("node:fs/promises");
const path = require("node:path");
const { decodeText } = require("./text-encoding.cjs");

const collator = new Intl.Collator("ja", {
  numeric: true,
  sensitivity: "base",
});
function isTextFile(file) {
  return (
    typeof file === "string" && path.extname(file).toLowerCase() === ".txt"
  );
}

async function readDirectory(directory) {
  if (typeof directory !== "string" || !path.isAbsolute(directory))
    throw new Error("フォルダのパスを確認してください。");
  const current = path.resolve(directory);
  const dirents = await fs.readdir(current, { withFileTypes: true });
  const entries = await Promise.all(
    dirents.map(async (entry) => {
      const file = path.join(current, entry.name);
      const info = entry.isSymbolicLink()
        ? await fs.stat(file).catch(() => null)
        : entry;
      const kind = info?.isDirectory()
        ? "directory"
        : info?.isFile()
          ? "file"
          : "other";
      return {
        name: entry.name,
        path: file,
        kind,
        canOpen: kind === "file" && isTextFile(file),
      };
    }),
  );
  entries.sort(
    (a, b) =>
      Number(b.kind === "directory") - Number(a.kind === "directory") ||
      collator.compare(a.name, b.name),
  );
  const parent = path.dirname(current);
  return {
    path: current,
    name: path.basename(current) || current,
    parent: parent === current ? null : parent,
    entries,
  };
}

async function readTextDocument(file) {
  if (!isTextFile(file) || !path.isAbsolute(file))
    throw new Error("TXTファイルを選択してください。");
  const resolved = path.resolve(file);
  if (!(await fs.stat(resolved)).isFile())
    throw new Error("ファイルを選択してください。");
  return { path: resolved, ...decodeText(await fs.readFile(resolved)) };
}

module.exports = { readDirectory, readTextDocument };
