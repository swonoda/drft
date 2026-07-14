const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("desktop", {
  newFile: () => ipcRenderer.invoke("file:new"),
  openWorkspace: () => ipcRenderer.invoke("workspace:open"),
  open: () => ipcRenderer.invoke("file:open"),
  save: (text) => ipcRenderer.invoke("file:save", text),
  saveAs: (text) => ipcRenderer.invoke("file:saveAs", text),
  exportPdf: (html) => ipcRenderer.invoke("file:exportPdf", html),
  onMenuCommand: (callback) =>
    ipcRenderer.on("menu:command", (_event, command) => callback(command)),
});
