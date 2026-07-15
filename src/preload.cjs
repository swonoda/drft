const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("desktop", {
  newFile: () => ipcRenderer.invoke("file:new"),
  defaultDocument: () => ipcRenderer.invoke("file:default"),
  restoreDocument: () => ipcRenderer.invoke("file:restore"),
  open: () => ipcRenderer.invoke("file:open"),
  save: (text, encoding) => ipcRenderer.invoke("file:save", text, encoding),
  saveAs: (text, encoding) => ipcRenderer.invoke("file:saveAs", text, encoding),
  exportPdf: (html) => ipcRenderer.invoke("file:exportPdf", html),
  openDictionary: () => ipcRenderer.invoke("dictionary:open"),
  onMenuCommand: (callback) =>
    ipcRenderer.on("menu:command", (_event, command) => callback(command)),
});
