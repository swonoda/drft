const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("diffApi", {
  load: () => ipcRenderer.invoke("diff:load"),
  choose: (side) => ipcRenderer.invoke("diff:choose", side),
});
