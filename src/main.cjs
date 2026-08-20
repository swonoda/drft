const { app, BrowserWindow, dialog, ipcMain, Menu } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const {
  combinePlannedPages,
  imposeRightBoundLogicalPages,
  imposeRightBoundSpreads,
  proofPdfPagePlan,
} = require("./pdf-spread.cjs");
const { createEpubArchive } = require("./epub-archive.cjs");
const { decodeText, encodeText } = require("./text-encoding.cjs");
const { buildDiffParts, buildProofreadChanges } = require("./diff-engine.cjs");
const { analyzePdfLayout } = require("./pdf-layout.cjs");
const { ensureTxtExtension, snapshotDefaultPath } = require("./snapshot.cjs");
const { proofPdfDefaultPath, ensurePdfExtension } = require("./proof-pdf.cjs");
const {
  EMPTY_SESSION,
  readSessionState,
  writeSessionState,
  dictionaryFilePath,
} = require("./session-state.cjs");

let win;
let dictionaryWin;
let splashWin;
const diffWindows = new Set();
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

function currentDiffDocument(document) {
  const filePath =
    typeof document?.path === "string" && document.path ? document.path : null;
  return {
    name: filePath ? path.basename(filePath) : "現在の原稿（未保存）",
    path: filePath,
    text: typeof document?.text === "string" ? document.text : "",
    encoding: document?.encoding === "shift_jis" ? "shift_jis" : "utf8",
    current: true,
  };
}

function openDiffWindow(document) {
  const currentDocument = currentDiffDocument(document);
  const diffWin = new BrowserWindow({
    width: 1380,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: "ファイル比較 — DRFT",
    icon: appIcon,
    backgroundColor: "#fdfdff",
    webPreferences: {
      preload: path.join(__dirname, "diff-preload.cjs"),
      contextIsolation: true,
    },
  });
  diffWin.setMenu(null);
  diffWin.currentDocument = currentDocument;
  diffWin.diffDocuments = { left: null, right: { ...currentDocument } };
  diffWindows.add(diffWin);
  diffWin.loadFile(path.join(__dirname, "diff.html"));
  diffWin.once("ready-to-show", () => diffWin.show());
  diffWin.on("closed", () => diffWindows.delete(diffWin));
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
          label: "エクスポート",
          submenu: [
            {
              label: "PDF出力…",
              accelerator: "CmdOrCtrl+Shift+P",
              click: () => sendMenuCommand("pdf"),
            },
            {
              label: "EPUB出力…",
              click: () => sendMenuCommand("epub"),
            },
          ],
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
      label: "ツール",
      submenu: [
        {
          label: "ファイルを比較…",
          click: () => sendMenuCommand("compare"),
        },
        {
          label: "組版を調整…",
          click: () => sendMenuCommand("adjust-layout"),
        },
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

async function chooseAndAnalyzePdf(parentWindow) {
  const result = await dialog.showOpenDialog(parentWindow, {
    title: "ゲラPDFを選択",
    properties: ["openFile"],
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (result.canceled) return null;
  const pdfPath = result.filePaths[0];
  return {
    path: pdfPath,
    sourceName: path.basename(pdfPath),
    ...(await analyzePdfLayout(pdfPath)),
  };
}

ipcMain.handle("file:analyzePdf", () => chooseAndAnalyzePdf(win));

ipcMain.handle("diff:analyzePdfLayout", (event) => {
  const diffWin = BrowserWindow.fromWebContents(event.sender);
  if (!diffWin) throw new Error("比較ウィンドウを取得できません");
  return chooseAndAnalyzePdf(diffWin);
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

async function renderSpreadPdf(html) {
  const pdfWin = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true },
  });
  try {
    await pdfWin.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
    );
    const data = await pdfWin.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
    });
    return imposeRightBoundSpreads(data);
  } finally {
    pdfWin.destroy();
  }
}

async function renderProofSpreadPdf(html, bodyWidth, pageSettings) {
  const pdfWin = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true },
  });
  try {
    await pdfWin.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
    );
    await pdfWin.webContents.executeJavaScript("document.fonts.ready");
    const pageCounts = await pdfWin.webContents.executeJavaScript(`
      (() => {
        document.body.dataset.proofTarget = "content";
        const content = document.querySelector(
          ".proof-content-sheet .preview-page-content"
        );
        if (!content) throw new Error("校正原稿の本文を読み込めません");
        const contentPageCount = Math.max(
          1,
          Math.ceil((content.scrollWidth - 1) / ${JSON.stringify(bodyWidth)})
        );
        const appendix = document.querySelector(
          ".proof-appendix-sheet .proofread-appendix-content"
        );
        if (!appendix) return { content: contentPageCount, appendix: 0 };
        document.body.dataset.proofTarget = "appendix";
        const appendixPageCount = Math.max(
          1,
          Math.ceil((appendix.scrollWidth - 1) / ${JSON.stringify(bodyWidth)})
        );
        document.body.dataset.proofTarget = "content";
        return { content: contentPageCount, appendix: appendixPageCount };
      })()
    `);
    const singlePages = [];
    for (const target of ["content", "appendix"]) {
      for (let pageIndex = 0; pageIndex < pageCounts[target]; pageIndex++) {
        const offset = `${pageIndex * bodyWidth}px`;
        await pdfWin.webContents.executeJavaScript(`
          document.body.dataset.proofTarget = ${JSON.stringify(target)};
          const sheet = document.querySelector(
            ${JSON.stringify(
              target === "content"
                ? ".proof-content-sheet"
                : ".proof-appendix-sheet",
            )}
          );
          sheet.style.setProperty(
            "--proof-content-offset",
            ${JSON.stringify(offset)}
          );
          new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
            if (${JSON.stringify(target)} === "content") {
              window.positionProofreadNotes?.(
                sheet.querySelector(".proof-page")
              );
            }
            requestAnimationFrame(resolve);
          })));
        `);
        singlePages.push(
          await pdfWin.webContents.printToPDF({
            printBackground: true,
            preferCSSPageSize: true,
          }),
        );
      }
    }
    const pagePlan = proofPdfPagePlan({
      contentPageCount: pageCounts.content + pageCounts.appendix,
      ...pageSettings,
    });
    return imposeRightBoundLogicalPages(
      await combinePlannedPages(singlePages, pagePlan),
      { cropMarks: Boolean(pageSettings.cropMarks) },
    );
  } finally {
    pdfWin.destroy();
  }
}

ipcMain.handle("file:exportPdf", async (_e, html) => {
  const r = await dialog.showSaveDialog(win, {
    defaultPath: "原稿.pdf",
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (r.canceled) return null;
  await fs.writeFile(r.filePath, await renderSpreadPdf(html));
  return r.filePath;
});

ipcMain.handle("file:exportEpub", async (_event, book) => {
  if (!book || typeof book.title !== "string") {
    throw new Error("EPUBの書誌情報を作成できません");
  }
  const safeTitle =
    book.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim() || "無題";
  const result = await dialog.showSaveDialog(win, {
    defaultPath: `${safeTitle}.epub`,
    filters: [{ name: "EPUB", extensions: ["epub"] }],
  });
  if (result.canceled) return null;
  const file = result.filePath.toLowerCase().endsWith(".epub")
    ? result.filePath
    : `${result.filePath}.epub`;
  await fs.writeFile(file, await createEpubArchive(book.files));
  return file;
});

function diffWindowState(diffWin) {
  const documents = diffWin?.diffDocuments;
  if (!documents) throw new Error("比較ウィンドウを読み込めません");
  const fileInfo = (document) =>
    document
      ? {
          name: document.name || path.basename(document.path || ""),
          path: document.path || "",
          encoding: document.encoding,
          text: document.text,
          current: Boolean(document.current),
        }
      : null;
  const parts =
    documents.left && documents.right
      ? buildDiffParts(documents.left.text, documents.right.text)
      : null;
  return {
    left: fileInfo(documents.left),
    right: fileInfo(documents.right),
    parts,
    proofreadChanges:
      documents.left && documents.right
        ? buildProofreadChanges(documents.left.text, documents.right.text)
        : [],
  };
}

ipcMain.handle("diff:load", (event) => {
  const diffWin = BrowserWindow.fromWebContents(event.sender);
  return diffWindowState(diffWin);
});

ipcMain.handle("diff:choose", async (event, side) => {
  if (side !== "left" && side !== "right") {
    throw new Error("比較する側を選択できません");
  }
  const diffWin = BrowserWindow.fromWebContents(event.sender);
  if (!diffWin?.diffDocuments) {
    throw new Error("比較ウィンドウを読み込めません");
  }
  const result = await dialog.showOpenDialog(diffWin, {
    title: `${side === "left" ? "古い" : "新しい"}ファイルを選択`,
    properties: ["openFile"],
    filters: [{ name: "テキスト", extensions: ["txt"] }],
  });
  if (result.canceled) return null;
  const file = result.filePaths[0];
  diffWin.diffDocuments[side] = {
    name: path.basename(file),
    path: file,
    current: false,
    ...decodeText(await fs.readFile(file)),
  };
  return diffWindowState(diffWin);
});

ipcMain.handle("file:openDiff", (_event, document) => {
  openDiffWindow(document);
});

ipcMain.handle("diff:chooseRightSource", async (event) => {
  const diffWin = BrowserWindow.fromWebContents(event.sender);
  if (!diffWin?.diffDocuments || !diffWin.currentDocument) {
    throw new Error("比較ウィンドウを読み込めません");
  }
  const result = await dialog.showMessageBox(diffWin, {
    type: "question",
    message: "新しい原稿として使う内容を選択してください",
    buttons: ["別のファイルを選択…", "現在の原稿を使用", "キャンセル"],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  });
  if (result.response === 2) return null;
  if (result.response === 1) {
    diffWin.diffDocuments.right = { ...diffWin.currentDocument };
    return diffWindowState(diffWin);
  }
  const selected = await dialog.showOpenDialog(diffWin, {
    title: "新しいファイルを選択",
    properties: ["openFile"],
    filters: [{ name: "テキスト", extensions: ["txt"] }],
  });
  if (selected.canceled) return null;
  const file = selected.filePaths[0];
  diffWin.diffDocuments.right = {
    name: path.basename(file),
    path: file,
    current: false,
    ...decodeText(await fs.readFile(file)),
  };
  return diffWindowState(diffWin);
});

ipcMain.handle("diff:proofPdfDefaultPath", (event) => {
  const diffWin = BrowserWindow.fromWebContents(event.sender);
  const sourcePath = diffWin?.diffDocuments?.left?.path;
  if (!sourcePath) throw new Error("古いファイルが選択されていません");
  return proofPdfDefaultPath(sourcePath);
});

ipcMain.handle("diff:chooseProofPdfPath", async (event, defaultPath) => {
  const diffWin = BrowserWindow.fromWebContents(event.sender);
  if (!diffWin?.diffDocuments?.left) {
    throw new Error("古いファイルが選択されていません");
  }
  const result = await dialog.showSaveDialog(diffWin, {
    defaultPath:
      typeof defaultPath === "string" && defaultPath
        ? defaultPath
        : proofPdfDefaultPath(diffWin.diffDocuments.left.path),
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  return result.canceled ? null : ensurePdfExtension(result.filePath);
});

ipcMain.handle("diff:exportProofPdf", async (event, payload) => {
  const diffWin = BrowserWindow.fromWebContents(event.sender);
  if (!diffWin?.diffDocuments?.left) {
    throw new Error("古いファイルが選択されていません");
  }
  if (!payload || typeof payload.html !== "string") {
    throw new Error("縦書きプレビューをPDFへ変換できません");
  }
  if (!Number.isFinite(payload.bodyWidth) || payload.bodyWidth <= 0) {
    throw new Error("PDFへ出力する本文幅を取得できません");
  }
  if (typeof payload.filePath !== "string" || !payload.filePath.trim()) {
    throw new Error("PDFの保存場所を指定してください");
  }
  const file = ensurePdfExtension(payload.filePath.trim());
  await fs.writeFile(
    file,
    await renderProofSpreadPdf(payload.html, payload.bodyWidth, {
      separateTitle: Boolean(payload.separateTitle),
      titleParity: payload.titleParity,
      bodyParity: payload.bodyParity,
      cropMarks: Boolean(payload.cropMarks),
    }),
  );
  return file;
});
