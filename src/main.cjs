const { app, BrowserWindow, dialog, ipcMain, Menu } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { imposeRightBoundSpreads } = require("./pdf-spread.cjs");
const { decodeText, encodeText } = require("./text-encoding.cjs");
const { ensureTxtExtension, snapshotDefaultPath } = require("./snapshot.cjs");
const {
  EMPTY_SESSION,
  readSessionState,
  writeSessionState,
  dictionaryFilePath,
} = require("./session-state.cjs");

let win;
let dictionaryWin;
let splashWin;
let currentPath = null;
let sessionState = { ...EMPTY_SESSION };
let sessionWrite = Promise.resolve();
let isQuitting = false;
const appIcon = path.join(__dirname, "../build/icon.png");

function sessionFile() {
  return path.join(app.getPath("userData"), "session.json");
}

function persistSession(patch) {
  sessionState = { ...sessionState, ...patch };
  const snapshot = { ...sessionState };
  sessionWrite = sessionWrite
    .catch(() => {})
    .then(() => writeSessionState(sessionFile(), snapshot));
  return sessionWrite;
}

function useDocument(file) {
  currentPath = file;
  persistSession({ currentPath: file });
}

function createWindow() {
  win = new BrowserWindow({
    show: false,
    width: 1500,
    height: 940,
    minWidth: 980,
    minHeight: 640,
    icon: appIcon,
    backgroundColor: "#fdfdff",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
    },
  });
  win.setMenuBarVisibility(true);
  win.loadFile(path.join(__dirname, "index.html"));
  win.once("ready-to-show", () => {
    win.show();
    if (splashWin && !splashWin.isDestroyed()) splashWin.destroy();
    splashWin = null;
  });
}

function createSplashWindow() {
  splashWin = new BrowserWindow({
    width: 230,
    height: 210,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: true,
    webPreferences: { sandbox: true },
  });
  splashWin.loadFile(path.join(__dirname, "splash.html"));
  splashWin.center();
}

function sendMenuCommand(command) {
  if (win && !win.isDestroyed()) win.webContents.send("menu:command", command);
}

function saveFocusedDocument() {
  const focused = BrowserWindow.getFocusedWindow();
  if (dictionaryWin && focused === dictionaryWin) {
    dictionaryWin.webContents.send("dictionary:save-request");
  } else {
    sendMenuCommand("save");
  }
}

function closeDictionaryWindow() {
  if (dictionaryWin && !dictionaryWin.isDestroyed()) dictionaryWin.close();
}

function openDictionaryWindow() {
  if (!currentPath) {
    dialog.showMessageBox(win, {
      type: "info",
      message: "先に原稿を開くか、原稿を保存してください。",
    });
    return;
  }
  if (dictionaryWin && !dictionaryWin.isDestroyed()) {
    dictionaryWin.show();
    dictionaryWin.focus();
    return;
  }
  persistSession({ dictionaryOpen: true });
  dictionaryWin = new BrowserWindow({
    width: 760,
    height: 580,
    minWidth: 600,
    minHeight: 420,
    parent: win,
    show: false,
    title: "辞書 — DRFT",
    icon: appIcon,
    webPreferences: {
      preload: path.join(__dirname, "dictionary-preload.cjs"),
      contextIsolation: true,
    },
  });
  dictionaryWin.loadFile(path.join(__dirname, "dictionary.html"));
  dictionaryWin.once("ready-to-show", () => dictionaryWin.show());
  dictionaryWin.on("closed", () => {
    dictionaryWin = null;
    if (!isQuitting) persistSession({ dictionaryOpen: false });
  });
}

function createMenu() {
  const replaceAccelerator =
    process.platform === "darwin" ? "Cmd+Alt+F" : "Ctrl+H";
  const template = [
    ...(process.platform === "darwin"
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    {
      label: "ファイル",
      submenu: [
        {
          label: "新規作成",
          accelerator: "CmdOrCtrl+N",
          click: () => sendMenuCommand("new"),
        },
        {
          label: "開く…",
          accelerator: "CmdOrCtrl+O",
          click: () => sendMenuCommand("open"),
        },
        { type: "separator" },
        {
          label: "保存",
          accelerator: "CmdOrCtrl+S",
          click: saveFocusedDocument,
        },
        {
          label: "名前をつけて保存…",
          accelerator: "CmdOrCtrl+Shift+S",
          click: () => sendMenuCommand("save-as"),
        },
        {
          label: "スナップショットを保存…",
          click: () => sendMenuCommand("snapshot"),
        },
        { type: "separator" },
        {
          label: "PDF出力…",
          accelerator: "CmdOrCtrl+Shift+P",
          click: () => sendMenuCommand("pdf"),
        },
        ...(process.platform === "darwin"
          ? [{ type: "separator" }, { role: "close" }]
          : [{ type: "separator" }, { role: "quit" }]),
      ],
    },
    {
      label: "編集",
      submenu: [
        { role: "undo", label: "元に戻す" },
        { role: "redo", label: "やり直す" },
        { type: "separator" },
        { role: "cut", label: "切り取り" },
        { role: "copy", label: "コピー" },
        { role: "paste", label: "貼り付け" },
        { role: "selectAll", label: "すべて選択" },
        { type: "separator" },
        {
          label: "検索…",
          accelerator: "CmdOrCtrl+F",
          click: () => sendMenuCommand("find"),
        },
        {
          label: "置換…",
          accelerator: replaceAccelerator,
          click: () => sendMenuCommand("replace"),
        },
      ],
    },
    {
      label: "表示",
      submenu: [
        {
          label: "構成を表示／非表示",
          accelerator: "CmdOrCtrl+Alt+O",
          click: () => sendMenuCommand("toggle-outline"),
        },
        {
          label: "縦書きプレビューを表示／非表示",
          accelerator: "CmdOrCtrl+Shift+V",
          click: () => sendMenuCommand("toggle-preview"),
        },
        { type: "separator" },
        {
          label: "表示設定…",
          click: () => sendMenuCommand("settings"),
        },
        {
          label: "辞書",
          accelerator: "CmdOrCtrl+Shift+D",
          click: openDictionaryWindow,
        },
        { type: "separator" },
        { role: "togglefullscreen", label: "フルスクリーン" },
      ],
    },
    {
      label: "ウィンドウ",
      submenu: [
        { role: "minimize", label: "最小化" },
        ...(process.platform === "darwin"
          ? [{ role: "zoom", label: "拡大／縮小" }, { role: "front" }]
          : []),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
  app.setName("DRFT");
  sessionState = await readSessionState(sessionFile());
  currentPath = sessionState.currentPath;
  if (process.platform === "darwin") app.dock.setIcon(appIcon);
  createMenu();
  createSplashWindow();
  createWindow();
});
app.on("before-quit", () => {
  isQuitting = true;
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("file:open", async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ["openFile"],
    filters: [{ name: "テキスト", extensions: ["txt"] }],
  });
  if (r.canceled) return null;
  closeDictionaryWindow();
  useDocument(r.filePaths[0]);
  const document = decodeText(await fs.readFile(currentPath));
  return { path: currentPath, ...document };
});

ipcMain.handle("file:restore", async () => {
  if (!currentPath) return null;
  try {
    const document = decodeText(await fs.readFile(currentPath));
    return {
      path: currentPath,
      ...document,
      dictionaryOpen: sessionState.dictionaryOpen,
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
  const file = dictionaryFilePath(currentPath);
  try {
    return await fs.readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      const legacy = path.join(path.dirname(currentPath), "辞書.md");
      try {
        return await fs.readFile(legacy, "utf8");
      } catch (legacyError) {
        if (legacyError.code === "ENOENT") return "";
        throw legacyError;
      }
    }
    throw error;
  }
});

ipcMain.handle("dictionary:save", async (_event, markdown) => {
  if (!currentPath) throw new Error("原稿が開かれていません");
  const folder = path.dirname(currentPath);
  await fs.mkdir(folder, { recursive: true });
  const file = dictionaryFilePath(currentPath);
  await fs.writeFile(file, markdown, "utf8");
  return file;
});

ipcMain.handle("dictionary:open", () => openDictionaryWindow());

ipcMain.handle("dictionary:find", (_event, heading) => {
  sendMenuCommand({ type: "dictionary-find", heading });
});

ipcMain.handle("file:saveAs", async (_e, text, encoding) => {
  const r = await dialog.showSaveDialog(win, {
    defaultPath: currentPath || "新しい小説.txt",
    filters: [{ name: "テキスト", extensions: ["txt"] }],
  });
  if (r.canceled) return null;
  closeDictionaryWindow();
  useDocument(r.filePath.endsWith(".txt") ? r.filePath : `${r.filePath}.txt`);
  await fs.writeFile(currentPath, encodeText(text, encoding));
  return currentPath;
});

ipcMain.handle("file:save", async (_e, text, encoding) => {
  if (!currentPath) return null;
  await fs.writeFile(currentPath, encodeText(text, encoding));
  return currentPath;
});

ipcMain.handle("file:snapshot", async (_e, text, encoding) => {
  const defaultPath = snapshotDefaultPath(currentPath);
  if (currentPath) {
    await fs.mkdir(path.dirname(defaultPath), { recursive: true });
  }
  const r = await dialog.showSaveDialog(win, {
    defaultPath,
    filters: [{ name: "テキスト", extensions: ["txt"] }],
  });
  if (r.canceled) return null;
  const file = ensureTxtExtension(r.filePath);
  await fs.writeFile(file, encodeText(text, encoding));
  return file;
});

ipcMain.handle("file:exportPdf", async (_e, html) => {
  const r = await dialog.showSaveDialog(win, {
    defaultPath: "原稿.pdf",
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (r.canceled) return null;
  const pdfWin = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true },
  });
  await pdfWin.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
  );
  const data = await pdfWin.webContents.printToPDF({
    printBackground: true,
    preferCSSPageSize: true,
  });
  await fs.writeFile(r.filePath, await imposeRightBoundSpreads(data));
  pdfWin.destroy();
  return r.filePath;
});
