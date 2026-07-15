const fs = require("node:fs/promises");
const path = require("node:path");

const EMPTY_SESSION = Object.freeze({
  currentPath: null,
  dictionaryOpen: false,
});

function normalizeSessionState(value) {
  return {
    currentPath:
      value && typeof value.currentPath === "string" ? value.currentPath : null,
    dictionaryOpen: Boolean(value && value.dictionaryOpen),
  };
}

async function readSessionState(file) {
  try {
    return normalizeSessionState(JSON.parse(await fs.readFile(file, "utf8")));
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError)
      return { ...EMPTY_SESSION };
    throw error;
  }
}

async function writeSessionState(file, state) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(
    file,
    `${JSON.stringify(normalizeSessionState(state), null, 2)}\n`,
    "utf8",
  );
}

function dictionaryFilePath(manuscriptPath) {
  const extension = path.extname(manuscriptPath);
  const name = path.basename(manuscriptPath, extension);
  return path.join(path.dirname(manuscriptPath), `${name}_辞書.md`);
}

module.exports = {
  EMPTY_SESSION,
  normalizeSessionState,
  readSessionState,
  writeSessionState,
  dictionaryFilePath,
};
