const { BrowserWindow, dialog, ipcMain } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { buildDiffParts, buildProofreadChanges } = require("./diff-engine.cjs");
const { chooseAndAnalyzePdf, choosePdfPath } = require("./export-ipc.cjs");
const { renderProofSpreadPdf } = require("./pdf-render.cjs");
const {
  proofPdfDefaultPath,
  ensurePdfExtension,
  normalizePdfPageSettings,
} = require("./proof-pdf.cjs");
const { decodeText } = require("./text-encoding.cjs");

function diffWindowState(diffWindow) {
  const documents = diffWindow?.diffDocuments;
  if (!documents) throw new Error("比較ウィンドウを読み込めません");
  const fileInfo = (document) =>
    document
      ? {
          name: document.name || path.basename(document.path || ""),
          path: document.path || "",
          encoding: document.encoding,
          text: document.text,
          current: Boolean(document.current),
        }
      : null;
  const parts =
    documents.left && documents.right
      ? buildDiffParts(documents.left.text, documents.right.text)
      : null;
  return {
    left: fileInfo(documents.left),
    right: fileInfo(documents.right),
    parts,
    proofreadChanges:
      documents.left && documents.right
        ? buildProofreadChanges(documents.left.text, documents.right.text)
        : [],
  };
}

function eventWindow(event) {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) throw new Error("比較ウィンドウを取得できません");
  return window;
}

function registerDiffIpc({ openDiffWindow }) {
  ipcMain.handle("diff:analyzePdfLayout", (event) =>
    chooseAndAnalyzePdf(eventWindow(event)),
  );

  ipcMain.handle("diff:load", (event) => diffWindowState(eventWindow(event)));

  ipcMain.handle("diff:choose", async (event, side) => {
    if (side !== "left" && side !== "right") {
      throw new Error("比較する側を選択できません");
    }
    const diffWindow = eventWindow(event);
    if (!diffWindow.diffDocuments) {
      throw new Error("比較ウィンドウを読み込めません");
    }
    const result = await dialog.showOpenDialog(diffWindow, {
      title: `${side === "left" ? "古い" : "新しい"}ファイルを選択`,
      properties: ["openFile"],
      filters: [{ name: "テキスト", extensions: ["txt"] }],
    });
    if (result.canceled) return null;
    const file = result.filePaths[0];
    diffWindow.diffDocuments[side] = {
      name: path.basename(file),
      path: file,
      current: false,
      ...decodeText(await fs.readFile(file)),
    };
    return diffWindowState(diffWindow);
  });

  ipcMain.handle("file:openDiff", (_event, document) => {
    openDiffWindow(document);
  });

  ipcMain.handle("diff:chooseRightSource", async (event) => {
    const diffWindow = eventWindow(event);
    if (!diffWindow.diffDocuments || !diffWindow.currentDocument) {
      throw new Error("比較ウィンドウを読み込めません");
    }
    const result = await dialog.showMessageBox(diffWindow, {
      type: "question",
      message: "新しい原稿として使う内容を選択してください",
      buttons: ["別のファイルを選択…", "現在の原稿を使用", "キャンセル"],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    if (result.response === 2) return null;
    if (result.response === 1) {
      diffWindow.diffDocuments.right = { ...diffWindow.currentDocument };
      return diffWindowState(diffWindow);
    }
    const selected = await dialog.showOpenDialog(diffWindow, {
      title: "新しいファイルを選択",
      properties: ["openFile"],
      filters: [{ name: "テキスト", extensions: ["txt"] }],
    });
    if (selected.canceled) return null;
    const file = selected.filePaths[0];
    diffWindow.diffDocuments.right = {
      name: path.basename(file),
      path: file,
      current: false,
      ...decodeText(await fs.readFile(file)),
    };
    return diffWindowState(diffWindow);
  });

  ipcMain.handle("diff:proofPdfDefaultPath", (event) => {
    const sourcePath = eventWindow(event).diffDocuments?.left?.path;
    if (!sourcePath) throw new Error("古いファイルが選択されていません");
    return proofPdfDefaultPath(sourcePath);
  });

  ipcMain.handle("diff:chooseProofPdfPath", (event, defaultPath) => {
    const diffWindow = eventWindow(event);
    if (!diffWindow.diffDocuments?.left) {
      throw new Error("古いファイルが選択されていません");
    }
    return choosePdfPath(
      diffWindow,
      typeof defaultPath === "string" && defaultPath
        ? defaultPath
        : proofPdfDefaultPath(diffWindow.diffDocuments.left.path),
    );
  });

  ipcMain.handle("diff:exportProofPdf", async (event, payload) => {
    const diffWindow = eventWindow(event);
    if (!diffWindow.diffDocuments?.left) {
      throw new Error("古いファイルが選択されていません");
    }
    if (!payload || typeof payload.html !== "string") {
      throw new Error("縦書きプレビューをPDFへ変換できません");
    }
    if (!Number.isFinite(payload.bodyWidth) || payload.bodyWidth <= 0) {
      throw new Error("PDFへ出力する本文幅を取得できません");
    }
    if (typeof payload.filePath !== "string" || !payload.filePath.trim()) {
      throw new Error("PDFの保存場所を指定してください");
    }
    const file = ensurePdfExtension(payload.filePath.trim());
    await fs.writeFile(
      file,
      await renderProofSpreadPdf(
        payload.html,
        payload.appendixHtml,
        payload.bodyWidth,
        normalizePdfPageSettings(payload),
      ),
    );
    return file;
  });
}

module.exports = { registerDiffIpc };
