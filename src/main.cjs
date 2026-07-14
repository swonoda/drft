const { app, BrowserWindow, dialog, ipcMain, Menu } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { imposeRightBoundSpreads } = require("./pdf-spread.cjs");

let win;
let dictionaryWin;
let splashWin;
let currentPath = null;
let workspacePath = null;
const appIcon = path.join(__dirname, "../build/icon.png");

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

async function chooseWorkspaceManuscript(folder) {
  const names = (await fs.readdir(folder))
    .filter(
      (name) => name.toLowerCase().endsWith(".txt") && !name.startsWith("."),
    )
    .sort((a, b) => a.localeCompare(b, "ja"));
  if (!names.length) {
    await dialog.showMessageBox(win, {
      type: "info",
      message: "このフォルダにはTXT原稿がありません。",
    });
    return null;
  }
  if (names.length === 1) return path.join(folder, names[0]);
  const result = await dialog.showMessageBox(win, {
    type: "question",
    message: "主原稿を選んでください",
    buttons: [...names, "キャンセル"],
    cancelId: names.length,
  });
  return result.response < names.length
    ? path.join(folder, names[result.response])
    : null;
}

function openDictionaryWindow() {
  if (!currentPath) {
    dialog.showMessageBox(win, {
      type: "info",
      message: "先に原稿または作品フォルダを開いてください。",
    });
    return;
  }
  if (dictionaryWin && !dictionaryWin.isDestroyed()) {
    dictionaryWin.show();
    dictionaryWin.focus();
    return;
  }
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
        {
          label: "作品フォルダを開く…",
          accelerator: "CmdOrCtrl+Shift+O",
          click: () => sendMenuCommand("open-workspace"),
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

app.whenReady().then(() => {
  app.setName("DRFT");
  if (process.platform === "darwin") app.dock.setIcon(appIcon);
  createMenu();
  createSplashWindow();
  createWindow();
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
  currentPath = r.filePaths[0];
  workspacePath = path.dirname(currentPath);
  return { path: currentPath, text: await fs.readFile(currentPath, "utf8") };
});

ipcMain.handle("file:new", () => {
  closeDictionaryWindow();
  currentPath = null;
  workspacePath = null;
});

ipcMain.handle("workspace:open", async () => {
  const result = await dialog.showOpenDialog(win, {
    properties: ["openDirectory"],
  });
  if (result.canceled) return null;
  const folder = result.filePaths[0];
  const manuscript = await chooseWorkspaceManuscript(folder);
  if (!manuscript) return null;
  closeDictionaryWindow();
  workspacePath = folder;
  currentPath = manuscript;
  return {
    path: manuscript,
    text: await fs.readFile(manuscript, "utf8"),
    workspace: folder,
  };
});

ipcMain.handle("dictionary:load", async () => {
  const file = path.join(workspacePath || path.dirname(currentPath), "辞書.md");
  try {
    return await fs.readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
});

ipcMain.handle("dictionary:save", async (_event, markdown) => {
  if (!currentPath) throw new Error("原稿が開かれていません");
  const folder = workspacePath || path.dirname(currentPath);
  await fs.mkdir(folder, { recursive: true });
  const file = path.join(folder, "辞書.md");
  await fs.writeFile(file, markdown, "utf8");
  return file;
});

ipcMain.handle("dictionary:find", (_event, heading) => {
  sendMenuCommand({ type: "dictionary-find", heading });
});

ipcMain.handle("file:saveAs", async (_e, text) => {
  const r = await dialog.showSaveDialog(win, {
    defaultPath: currentPath || "新しい小説.txt",
    filters: [{ name: "テキスト", extensions: ["txt"] }],
  });
  if (r.canceled) return null;
  currentPath = r.filePath.endsWith(".txt") ? r.filePath : `${r.filePath}.txt`;
  await fs.writeFile(currentPath, text, "utf8");
  return currentPath;
});

ipcMain.handle("file:save", async (_e, text) => {
  if (!currentPath) return null;
  await fs.writeFile(currentPath, text, "utf8");
  return currentPath;
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
