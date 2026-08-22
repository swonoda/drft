const { app, BrowserWindow, dialog } = require("electron");
const path = require("node:path");
const { installApplicationMenu } = require("./app-menu.cjs");
const {
  createMainWindow,
  createSplashWindow,
  createDictionaryWindow,
  createDiffWindow,
  createProofApplyWindow,
} = require("./app-windows.cjs");
const { registerDiffIpc } = require("./diff-ipc.cjs");
const { registerDocumentIpc } = require("./document-ipc.cjs");
const { registerExportIpc } = require("./export-ipc.cjs");
const { registerProofApplyIpc } = require("./proof-apply-ipc.cjs");
const {
  EMPTY_SESSION,
  readSessionState,
  writeSessionState,
} = require("./session-state.cjs");

let win;
let dictionaryWin;
let splashWin;
const diffWindows = new Set();
let proofApplyWin;
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
  dictionaryWin = createDictionaryWindow(win, appIcon);
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
  const diffWindow = createDiffWindow(appIcon);
  diffWindow.currentDocument = currentDocument;
  diffWindow.diffDocuments = { left: null, right: { ...currentDocument } };
  diffWindows.add(diffWindow);
  diffWindow.once("ready-to-show", () => diffWindow.show());
  diffWindow.on("closed", () => diffWindows.delete(diffWindow));
}

function openProofApplyReview(state) {
  if (proofApplyWin && !proofApplyWin.isDestroyed()) {
    proofApplyWin.focus();
    return proofApplyWin;
  }
  proofApplyWin = createProofApplyWindow(win, appIcon);
  proofApplyWin.proofApplyState = state;
  proofApplyWin.proofAllowClose = false;
  proofApplyWin.once("ready-to-show", () => proofApplyWin.show());
  proofApplyWin.on("close", (event) => {
    if (proofApplyWin?.proofAllowClose) return;
    event.preventDefault();
    proofApplyWin?.webContents.send("proof:close-request");
  });
  proofApplyWin.on("closed", () => {
    proofApplyWin = null;
  });
  return proofApplyWin;
}

registerDocumentIpc({
  getMainWindow: () => win,
  getCurrentPath: () => currentPath,
  getSessionState: () => sessionState,
  useDocument,
  persistSession,
  closeDictionaryWindow,
  openDictionaryWindow,
  sendMenuCommand,
});
registerExportIpc({
  getMainWindow: () => win,
  getCurrentPath: () => currentPath,
});
registerDiffIpc({ openDiffWindow });
registerProofApplyIpc({
  getMainWindow: () => win,
  getCurrentPath: () => currentPath,
  openProofApplyWindow: openProofApplyReview,
});

app.whenReady().then(async () => {
  app.setName("DRFT");
  sessionState = await readSessionState(sessionFile());
  currentPath = sessionState.currentPath;
  if (process.platform === "darwin") app.dock.setIcon(appIcon);
  installApplicationMenu({
    sendMenuCommand,
    saveFocusedDocument,
    openDictionaryWindow,
  });
  splashWin = createSplashWindow();
  win = createMainWindow(appIcon);
  win.once("ready-to-show", () => {
    win.show();
    if (splashWin && !splashWin.isDestroyed()) splashWin.destroy();
    splashWin = null;
  });
});

app.on("before-quit", () => {
  isQuitting = true;
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
