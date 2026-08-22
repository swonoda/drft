const { contextBridge, ipcRenderer } = require("electron");
const { updateProofChangeRanges } = require("./proof-apply-engine.cjs");

contextBridge.exposeInMainWorld("proofApplyApi", {
  load: () => ipcRenderer.invoke("proof:load"),
  pdfPage: (pageNumber) => ipcRenderer.invoke("proof:pdfPage", pageNumber),
  recognize: () => ipcRenderer.invoke("proof:recognize"),
  updateDraft: (text) => ipcRenderer.send("proof:updateDraft", text),
  commit: (text) => ipcRenderer.invoke("proof:commit", text),
  discard: () => ipcRenderer.invoke("proof:discard"),
  updateChangeRanges: (changes, before, after) =>
    updateProofChangeRanges(changes, before, after),
  onRecognitionProgress: (callback) =>
    ipcRenderer.on("proof:recognition-progress", (_event, progress) =>
      callback(progress),
    ),
});
