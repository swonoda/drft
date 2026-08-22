const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("desktop", {
  newFile: () => ipcRenderer.invoke("file:new"),
  defaultDocument: () => ipcRenderer.invoke("file:default"),
  restoreDocument: () => ipcRenderer.invoke("file:restore"),
  open: () => ipcRenderer.invoke("file:open"),
  save: (text, encoding) => ipcRenderer.invoke("file:save", text, encoding),
  saveAs: (text, encoding) => ipcRenderer.invoke("file:saveAs", text, encoding),
  saveSnapshot: (text, encoding) =>
    ipcRenderer.invoke("file:snapshot", text, encoding),
  pdfDefaultPath: () => ipcRenderer.invoke("file:pdfDefaultPath"),
  choosePdfPath: (defaultPath) =>
    ipcRenderer.invoke("file:choosePdfPath", defaultPath),
  exportPdf: (request) => ipcRenderer.invoke("file:exportPdf", request),
  exportEpub: (book) => ipcRenderer.invoke("file:exportEpub", book),
  openDictionary: () => ipcRenderer.invoke("dictionary:open"),
  openDiff: (document) => ipcRenderer.invoke("file:openDiff", document),
  openProofApply: (document) =>
    ipcRenderer.invoke("file:openProofApply", document),
  onProofApplied: (callback) =>
    ipcRenderer.on("proof:applied", (_event, result) => callback(result)),
  onMenuCommand: (callback) =>
    ipcRenderer.on("menu:command", (_event, command) => callback(command)),
  analyzePdfLayout: () => ipcRenderer.invoke("file:analyzePdf"),
});
