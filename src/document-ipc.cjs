const { dialog, ipcMain } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { decodeText, encodeText } = require("./text-encoding.cjs");
const { ensureTxtExtension, snapshotDefaultPath } = require("./snapshot.cjs");
const { dictionaryFilePath } = require("./session-state.cjs");

function registerDocumentIpc({
  getMainWindow,
  getCurrentPath,
  getSessionState,
  useDocument,
  persistSession,
  closeDictionaryWindow,
  openDictionaryWindow,
  sendMenuCommand,
}) {
  ipcMain.handle("file:open", async () => {
    const result = await dialog.showOpenDialog(getMainWindow(), {
      properties: ["openFile"],
      filters: [{ name: "テキスト", extensions: ["txt"] }],
    });
    if (result.canceled) return null;
    closeDictionaryWindow();
    useDocument(result.filePaths[0]);
    const file = getCurrentPath();
    const document = decodeText(await fs.readFile(file));
    return { path: file, ...document };
  });

  ipcMain.handle("file:restore", async () => {
    const file = getCurrentPath();
    if (!file) return null;
    try {
      const document = decodeText(await fs.readFile(file));
      return {
        path: file,
        ...document,
        dictionaryOpen: getSessionState().dictionaryOpen,
      };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      useDocument(null);
      await persistSession({ dictionaryOpen: false });
      return null;
    }
  });

  ipcMain.handle("file:default", () =>
    fs.readFile(path.join(__dirname, "default.txt"), "utf8"),
  );

  ipcMain.handle("file:new", () => {
    closeDictionaryWindow();
    useDocument(null);
  });

  ipcMain.handle("dictionary:load", async () => {
    const currentPath = getCurrentPath();
    const file = dictionaryFilePath(currentPath);
    try {
      return await fs.readFile(file, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const legacy = path.join(path.dirname(currentPath), "辞書.md");
      try {
        return await fs.readFile(legacy, "utf8");
      } catch (legacyError) {
        if (legacyError.code === "ENOENT") return "";
        throw legacyError;
      }
    }
  });

  ipcMain.handle("dictionary:save", async (_event, markdown) => {
    const currentPath = getCurrentPath();
    if (!currentPath) throw new Error("原稿が開かれていません");
    await fs.mkdir(path.dirname(currentPath), { recursive: true });
    const file = dictionaryFilePath(currentPath);
    await fs.writeFile(file, markdown, "utf8");
    return file;
  });

  ipcMain.handle("dictionary:open", () => openDictionaryWindow());
  ipcMain.handle("dictionary:find", (_event, heading) => {
    sendMenuCommand({ type: "dictionary-find", heading });
  });

  ipcMain.handle("file:saveAs", async (_event, text, encoding) => {
    const result = await dialog.showSaveDialog(getMainWindow(), {
      defaultPath: getCurrentPath() || "新しい小説.txt",
      filters: [{ name: "テキスト", extensions: ["txt"] }],
    });
    if (result.canceled) return null;
    closeDictionaryWindow();
    useDocument(
      result.filePath.endsWith(".txt")
        ? result.filePath
        : `${result.filePath}.txt`,
    );
    const file = getCurrentPath();
    await fs.writeFile(file, encodeText(text, encoding));
    return file;
  });

  ipcMain.handle("file:save", async (_event, text, encoding) => {
    const file = getCurrentPath();
    if (!file) return null;
    await fs.writeFile(file, encodeText(text, encoding));
    return file;
  });

  ipcMain.handle("file:snapshot", async (_event, text, encoding) => {
    const currentPath = getCurrentPath();
    const defaultPath = snapshotDefaultPath(currentPath);
    if (currentPath) {
      await fs.mkdir(path.dirname(defaultPath), { recursive: true });
    }
    const result = await dialog.showSaveDialog(getMainWindow(), {
      defaultPath,
      filters: [{ name: "テキスト", extensions: ["txt"] }],
    });
    if (result.canceled) return null;
    const file = ensureTxtExtension(result.filePath);
    await fs.writeFile(file, encodeText(text, encoding));
    return file;
  });
}

module.exports = { registerDocumentIpc };
