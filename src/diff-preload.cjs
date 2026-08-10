const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("diffApi", {
  load: () => ipcRenderer.invoke("diff:load"),
  choose: (side) => ipcRenderer.invoke("diff:choose", side),
  proofPdfDefaultPath: () => ipcRenderer.invoke("diff:proofPdfDefaultPath"),
  chooseProofPdfPath: (defaultPath) =>
    ipcRenderer.invoke("diff:chooseProofPdfPath", defaultPath),
  exportProofPdf: (payload) =>
    ipcRenderer.invoke("diff:exportProofPdf", payload),
});
