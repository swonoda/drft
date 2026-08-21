const { BrowserWindow } = require("electron");
const {
  applyPdfPagePlan,
  combinePdfDocuments,
  combinePlannedPages,
  imposeRightBoundLogicalPages,
  pdfPagePlan,
} = require("./pdf-spread.cjs");

async function withPdfWindow(callback) {
  const pdfWindow = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true },
  });
  try {
    return await callback(pdfWindow);
  } finally {
    pdfWindow.destroy();
  }
}

async function loadPdfHtml(pdfWindow, html, label = "原稿") {
  try {
    await pdfWindow.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
    );
    await pdfWindow.webContents.executeJavaScript("document.fonts.ready");
  } catch (error) {
    throw new Error(`${label}を読み込めません: ${error.message}`);
  }
}

function printPdfPage(pdfWindow) {
  return pdfWindow.webContents.printToPDF({
    printBackground: true,
    preferCSSPageSize: true,
  });
}

async function renderSpreadPdf(htmlDocuments, pageSettings) {
  return withPdfWindow(async (pdfWindow) => {
    const documents = [];
    for (const html of htmlDocuments) {
      await loadPdfHtml(pdfWindow, html);
      documents.push(await printPdfPage(pdfWindow));
    }
    const data =
      documents.length === 1
        ? documents[0]
        : await combinePdfDocuments(documents);
    const logicalPages = await applyPdfPagePlan(data, pageSettings);
    return imposeRightBoundLogicalPages(logicalPages, {
      cropMarks: Boolean(pageSettings.cropMarks),
    });
  });
}

async function renderProofSpreadPdf(
  html,
  appendixHtml,
  bodyWidth,
  pageSettings,
) {
  return withPdfWindow(async (pdfWindow) => {
    const renderPages = async (sourceHtml, positionNotes, label) => {
      await loadPdfHtml(pdfWindow, sourceHtml, label);
      let pageCount;
      try {
        pageCount = await pdfWindow.webContents.executeJavaScript(`
          (() => {
            const content = document.querySelector(".preview-page-content");
            if (!content) return null;
            return Math.max(
              1,
              Math.ceil((content.scrollWidth - 1) / ${JSON.stringify(bodyWidth)})
            );
          })()
        `);
      } catch (error) {
        throw new Error(`${label}のページ数を計算できません: ${error.message}`);
      }
      if (!Number.isFinite(pageCount) || pageCount < 1) {
        throw new Error(`${label}の本文領域が見つかりません`);
      }
      const renderedPages = [];
      for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
        const offset = `${pageIndex * bodyWidth}px`;
        try {
          await pdfWindow.webContents.executeJavaScript(`
            (() => {
              const pages = document.querySelector(".proof-pages");
              const page = document.querySelector(".proof-page");
              if (!pages || !page) return Promise.reject(
                new Error("印刷ページが見つかりません")
              );
              pages.style.setProperty(
                "--proof-content-offset",
                ${JSON.stringify(offset)}
              );
              return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
                if (${JSON.stringify(positionNotes)}) {
                  window.positionProofreadNotes?.(page);
                }
                requestAnimationFrame(resolve);
              })));
            })()
          `);
        } catch (error) {
          throw new Error(
            `${label}${pageIndex + 1}ページ目を組版できません: ${error.message}`,
          );
        }
        renderedPages.push(await printPdfPage(pdfWindow));
      }
      return renderedPages;
    };

    const singlePages = await renderPages(html, true, "本文");
    if (typeof appendixHtml === "string" && appendixHtml) {
      singlePages.push(...(await renderPages(appendixHtml, false, "追記")));
    }
    const pagePlan = pdfPagePlan({
      contentPageCount: singlePages.length,
      ...pageSettings,
    });
    return imposeRightBoundLogicalPages(
      await combinePlannedPages(singlePages, pagePlan),
      { cropMarks: Boolean(pageSettings.cropMarks) },
    );
  });
}

module.exports = { renderSpreadPdf, renderProofSpreadPdf };
