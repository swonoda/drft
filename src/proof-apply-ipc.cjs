const { BrowserWindow, dialog, ipcMain } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pdfPageCount, renderPdfPagePng } = require("./pdf-layout.cjs");
const { buildProofDraft } = require("./proof-apply-engine.cjs");
const { recognizeProofChanges } = require("./proof-recognition.cjs");
const { proofReviewSnapshotPath } = require("./snapshot.cjs");
const { encodeText } = require("./text-encoding.cjs");

function eventWindow(event) {
  return BrowserWindow.fromWebContents(event.sender);
}

function registerProofApplyIpc({
  getMainWindow,
  getCurrentPath,
  openProofApplyWindow,
  recognize = recognizeProofChanges,
}) {
  ipcMain.handle("file:openProofApply", async (_event, document) => {
    const currentPath = getCurrentPath();
    if (!currentPath) {
      await dialog.showMessageBox(getMainWindow(), {
        type: "info",
        message: "ゲラを反映する前に原稿を保存してください。",
      });
      return null;
    }

    const selected = await dialog.showOpenDialog(getMainWindow(), {
      properties: ["openFile"],
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (selected.canceled) return null;

    const pdfPath = selected.filePaths[0];
    const pageCount = await pdfPageCount(pdfPath);
    if (!pageCount) throw new Error("PDFに表示できるページがありません。");

    const sourceText = typeof document?.text === "string" ? document.text : "";
    const encoding = document?.encoding === "shift_jis" ? "shift_jis" : "utf8";
    const snapshotPath = proofReviewSnapshotPath(currentPath);
    await fs.mkdir(path.dirname(snapshotPath), { recursive: true });
    await fs.writeFile(snapshotPath, encodeText(sourceText, encoding));

    const recognition = await recognize(pdfPath, sourceText);
    const draft = buildProofDraft(sourceText, recognition?.changes || []);
    openProofApplyWindow({
      sourcePath: currentPath,
      sourceName: path.basename(currentPath),
      sourceText,
      encoding,
      snapshotPath,
      pdfPath,
      pdfName: path.basename(pdfPath),
      pdfPageCount: pageCount,
      text: draft.text,
      changes: draft.changes,
      notice: recognition?.notice || "",
    });
    return { snapshotPath, changeCount: draft.changes.length };
  });

  ipcMain.handle("proof:load", (event) => eventWindow(event)?.proofApplyState);

  ipcMain.handle("proof:pdfPage", async (event, pageNumber) => {
    const proofWindow = eventWindow(event);
    const proofState = proofWindow?.proofApplyState;
    const page = Number(pageNumber);
    if (
      !proofState ||
      !Number.isInteger(page) ||
      page < 1 ||
      page > proofState.pdfPageCount
    ) {
      throw new RangeError("PDFのページ番号が不正です。");
    }
    proofWindow.proofPdfPageCache ||= new Map();
    if (!proofWindow.proofPdfPageCache.has(page)) {
      const rendered = renderPdfPagePng(proofState.pdfPath, page)
        .then((png) => `data:image/png;base64,${png.toString("base64")}`)
        .catch((error) => {
          proofWindow.proofPdfPageCache.delete(page);
          throw error;
        });
      proofWindow.proofPdfPageCache.set(page, rendered);
    }
    return proofWindow.proofPdfPageCache.get(page);
  });

  ipcMain.handle("proof:commit", (event, text) => {
    const proofWindow = eventWindow(event);
    if (!proofWindow?.proofApplyState || typeof text !== "string") return false;
    getMainWindow()?.webContents.send("proof:applied", {
      text,
      snapshotPath: proofWindow.proofApplyState.snapshotPath,
    });
    proofWindow.proofAllowClose = true;
    proofWindow.close();
    return true;
  });

  ipcMain.handle("proof:discard", (event) => {
    const proofWindow = eventWindow(event);
    if (!proofWindow) return false;
    proofWindow.proofAllowClose = true;
    proofWindow.close();
    return true;
  });

  ipcMain.handle("proof:closeDecision", (event) =>
    dialog
      .showMessageBox(eventWindow(event), {
        type: "question",
        message: "ゲラの反映内容を本原稿へ反映しますか？",
        detail: "反映前の原稿はスナップショットに保存されています。",
        buttons: ["反映して閉じる", "破棄して閉じる", "戻る"],
        defaultId: 0,
        cancelId: 2,
      })
      .then(({ response }) => ["commit", "discard", "cancel"][response]),
  );
}

module.exports = { registerProofApplyIpc };
