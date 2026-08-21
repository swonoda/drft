const { BrowserWindow } = require("electron");
const path = require("node:path");

function createMainWindow(appIcon) {
  const window = new BrowserWindow({
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
  window.setMenuBarVisibility(true);
  window.loadFile(path.join(__dirname, "index.html"));
  return window;
}

function createSplashWindow() {
  const window = new BrowserWindow({
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
  window.loadFile(path.join(__dirname, "splash.html"));
  window.center();
  return window;
}

function createDictionaryWindow(parent, appIcon) {
  const window = new BrowserWindow({
    width: 760,
    height: 580,
    minWidth: 600,
    minHeight: 420,
    parent,
    show: false,
    title: "辞書 — DRFT",
    icon: appIcon,
    webPreferences: {
      preload: path.join(__dirname, "dictionary-preload.cjs"),
      contextIsolation: true,
    },
  });
  window.loadFile(path.join(__dirname, "dictionary.html"));
  return window;
}

function createDiffWindow(appIcon) {
  const window = new BrowserWindow({
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
  window.setMenu(null);
  window.loadFile(path.join(__dirname, "diff.html"));
  return window;
}

module.exports = {
  createMainWindow,
  createSplashWindow,
  createDictionaryWindow,
  createDiffWindow,
};
