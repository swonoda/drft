const { dialog, ipcMain } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { createEpubArchive } = require("./epub-archive.cjs");
const { analyzePdfLayout } = require("./pdf-layout.cjs");
const { renderSpreadPdf } = require("./pdf-render.cjs");
const {
  pdfDefaultPath,
  ensurePdfExtension,
  normalizePdfPageSettings,
} = require("./proof-pdf.cjs");

async function chooseAndAnalyzePdf(parentWindow) {
  const result = await dialog.showOpenDialog(parentWindow, {
    title: "ゲラPDFを選択",
    properties: ["openFile"],
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (result.canceled) return null;
  const pdfPath = result.filePaths[0];
  return {
    path: pdfPath,
    sourceName: path.basename(pdfPath),
    ...(await analyzePdfLayout(pdfPath)),
  };
}

async function choosePdfPath(parentWindow, defaultPath) {
  const result = await dialog.showSaveDialog(parentWindow, {
    defaultPath,
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  return result.canceled ? null : ensurePdfExtension(result.filePath);
}

function registerExportIpc({ getMainWindow, getCurrentPath }) {
  ipcMain.handle("file:analyzePdf", () => chooseAndAnalyzePdf(getMainWindow()));

  ipcMain.handle("file:exportPdf", async (_event, request) => {
    const htmlDocuments = Array.isArray(request?.html)
      ? request.html
      : [typeof request === "string" ? request : request?.html];
    if (
      !htmlDocuments.length ||
      htmlDocuments.some((html) => typeof html !== "string" || !html)
    ) {
      throw new Error("PDFの原稿を作成できません");
    }
    const pageSettings = normalizePdfPageSettings(request?.pageSettings);
    if (typeof request?.filePath !== "string" || !request.filePath.trim()) {
      throw new Error("PDFの保存場所を指定してください");
    }
    const file = ensurePdfExtension(request.filePath.trim());
    await fs.writeFile(
      file,
      await renderSpreadPdf(htmlDocuments, pageSettings),
    );
    return file;
  });

  ipcMain.handle("file:pdfDefaultPath", () => pdfDefaultPath(getCurrentPath()));

  ipcMain.handle("file:choosePdfPath", (_event, defaultPath) =>
    choosePdfPath(
      getMainWindow(),
      typeof defaultPath === "string" && defaultPath
        ? defaultPath
        : pdfDefaultPath(getCurrentPath()),
    ),
  );

  ipcMain.handle("file:exportEpub", async (_event, book) => {
    if (!book || typeof book.title !== "string") {
      throw new Error("EPUBの書誌情報を作成できません");
    }
    const safeTitle =
      book.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim() || "無題";
    const result = await dialog.showSaveDialog(getMainWindow(), {
      defaultPath: `${safeTitle}.epub`,
      filters: [{ name: "EPUB", extensions: ["epub"] }],
    });
    if (result.canceled) return null;
    const file = result.filePath.toLowerCase().endsWith(".epub")
      ? result.filePath
      : `${result.filePath}.epub`;
    await fs.writeFile(file, await createEpubArchive(book.files));
    return file;
  });
}

module.exports = {
  chooseAndAnalyzePdf,
  choosePdfPath,
  registerExportIpc,
};
