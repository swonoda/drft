const { contextBridge, ipcRenderer } = require("electron");
const { updateProofChangeRanges } = require("./proof-apply-engine.cjs");

contextBridge.exposeInMainWorld("proofApplyApi", {
  load: () => ipcRenderer.invoke("proof:load"),
  pdfPage: (pageNumber) => ipcRenderer.invoke("proof:pdfPage", pageNumber),
  commit: (text) => ipcRenderer.invoke("proof:commit", text),
  discard: () => ipcRenderer.invoke("proof:discard"),
  closeDecision: () => ipcRenderer.invoke("proof:closeDecision"),
  updateChangeRanges: (changes, before, after) =>
    updateProofChangeRanges(changes, before, after),
  onCloseRequest: (callback) =>
    ipcRenderer.on("proof:close-request", () => callback()),
});
