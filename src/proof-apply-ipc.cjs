const { BrowserWindow, dialog, ipcMain } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pdfPageCount, renderPdfPagePng } = require("./pdf-layout.cjs");
const { buildProofDraft } = require("./proof-apply-engine.cjs");
const { recognizeProofChanges } = require("./proof-recognition.cjs");
const { createPngPayload } = require("./proof-image-transfer.cjs");
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
  const commitProofWindow = (proofWindow, text) => {
    if (!proofWindow?.proofApplyState || typeof text !== "string") return false;
    getMainWindow()?.webContents.send("proof:applied", {
      text,
      snapshotPath: proofWindow.proofApplyState.snapshotPath,
    });
    proofWindow.proofApplyState.text = text;
    return true;
  };

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

    const proofWindow = openProofApplyWindow({
      sourcePath: currentPath,
      sourceName: path.basename(currentPath),
      sourceText,
      encoding,
      snapshotPath,
      pdfPath,
      pdfName: path.basename(pdfPath),
      pdfPageCount: pageCount,
      text: sourceText,
      changes: [],
      notes: [],
      notice: "PDFを表示しました。赤字は端末内のOCRで読み取ります。",
    });
    proofWindow.proofCommit = () =>
      commitProofWindow(proofWindow, proofWindow.proofApplyState.text);
    return { snapshotPath, changeCount: 0 };
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
        .then(createPngPayload)
        .catch((error) => {
          proofWindow.proofPdfPageCache.delete(page);
          throw error;
        });
      proofWindow.proofPdfPageCache.set(page, rendered);
    }
    return proofWindow.proofPdfPageCache.get(page);
  });

  ipcMain.handle("proof:recognize", async (event) => {
    const proofWindow = eventWindow(event);
    const state = proofWindow?.proofApplyState;
    if (!proofWindow || !state)
      throw new Error("ゲラ反映画面の状態を取得できません。");
    if (!proofWindow.proofRecognitionPromise) {
      proofWindow.proofRecognitionPromise = recognize(
        state.pdfPath,
        state.sourceText,
        {
          onProgress: (progress) => {
            if (!proofWindow.isDestroyed())
              proofWindow.webContents.send(
                "proof:recognition-progress",
                progress,
              );
          },
        },
      )
        .then((recognition) => {
          const draft = buildProofDraft(
            state.sourceText,
            recognition?.changes || [],
          );
          Object.assign(state, {
            text: draft.text,
            changes: draft.changes,
            notes: Array.isArray(recognition?.notes) ? recognition.notes : [],
            notice: recognition?.notice || "赤字の読み取りが完了しました。",
          });
          return {
            text: state.text,
            changes: state.changes,
            notes: state.notes,
            notice: state.notice,
          };
        })
        .finally(() => {
          proofWindow.proofRecognitionPromise = null;
        });
    }
    return proofWindow.proofRecognitionPromise;
  });

  ipcMain.on("proof:updateDraft", (event, text) => {
    const proofWindow = eventWindow(event);
    if (proofWindow?.proofApplyState && typeof text === "string") {
      proofWindow.proofApplyState.text = text;
    }
  });

  ipcMain.handle("proof:commit", (event, text) => {
    const proofWindow = eventWindow(event);
    if (!commitProofWindow(proofWindow, text)) return false;
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
}

module.exports = { registerProofApplyIpc };
