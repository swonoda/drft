const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("dictionaryApi", {
  load: () => ipcRenderer.invoke("dictionary:load"),
  save: (markdown) => ipcRenderer.invoke("dictionary:save", markdown),
  findInManuscript: (heading) => ipcRenderer.invoke("dictionary:find", heading),
  onSaveRequest: (callback) =>
    ipcRenderer.on("dictionary:save-request", () => callback()),
});
