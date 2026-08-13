import { renderPreviewDocument } from "./parser.js";
import {
  previewPageBodyWidth,
  previewPageCount,
  previewPageFrame,
} from "./preview-layout.js";

const $ = (id) => document.getElementById(id);
const leftDocument = $("leftDocument");
const rightDocument = $("rightDocument");
const comparison = document.querySelector(".comparison");
const oldPreview = $("oldPreview");
const layoutButton = $("layoutButton");
const layoutDialog = $("layoutDialog");
const proofPdfButton = $("proofPdfButton");
const proofPdfDialog = $("proofPdfDialog");
let viewMode = "diff";
let changeIds = [];
let currentChangeIndex = -1;
let syncingScroll = false;
let currentState = null;
let previewRenderFrame = null;
let proofPdfPreview = null;
const proofPdfLayout = {
  marginTopMm: 10,
  marginRightMm: 10,
  marginBottomMm: 10,
  marginLeftMm: 10,
};

function makePart(part, side) {
  const span = document.createElement("span");
  span.className = "diff-part";
  span.dataset.part = String(part.id);
  if (part.changeId !== null) span.dataset.change = String(part.changeId);

  const visible =
    (!part.added && !part.removed) ||
    (side === "left" && part.removed) ||
    (side === "right" && part.added);
  if (!visible) span.classList.add("diff-placeholder");
  if (visible && part.removed) span.classList.add("diff-removed");
  if (visible && part.added) span.classList.add("diff-added");
  span.textContent = part.value;
  return span;
}

function renderParts(parts) {
  const left = document.createDocumentFragment();
  const right = document.createDocumentFragment();
  for (const part of parts) {
    left.append(makePart(part, "left"));
    right.append(makePart(part, "right"));
  }
  leftDocument.replaceChildren(left);
  rightDocument.replaceChildren(right);
  changeIds = [...new Set(parts.flatMap((part) => part.changeId ?? []))];
}

function storedNumber(key, fallback) {
  const saved = localStorage.getItem(key);
  if (saved === null) return fallback;
  const value = Number(saved);
  return Number.isFinite(value) ? value : fallback;
}

function previewSettings() {
  return {
    font:
      localStorage.getItem("diffPreview.font") ||
      localStorage.getItem("display.font") ||
      "Yu Mincho, YuMincho, serif",
    fontSize: Number(localStorage.getItem("display.fontSize")) || 18,
    letterSpacing: Number(localStorage.getItem("display.letterSpacing")) || 0,
    lineHeight: Number(localStorage.getItem("display.lineHeight")) || 1.75,
    charactersPerLine: Number(localStorage.getItem("display.lineChars")) || 40,
    linesPerPage: Number(localStorage.getItem("display.previewLines")) || 16,
    verticalMargin: storedNumber("diffPreview.verticalMargin", 32),
    horizontalMargin: storedNumber("diffPreview.horizontalMargin", 32),
  };
}

function renderOldPreview(text) {
  proofPdfPreview = null;
  oldPreview.replaceChildren();
  if (!text) {
    const message = document.createElement("p");
    message.className = "empty-message";
    message.textContent = "古いファイルを選択してください";
    oldPreview.append(message);
    updateProofPdfButton();
    return;
  }

  const settings = previewSettings();
  const bodyWidth = previewPageBodyWidth(
    settings.fontSize,
    settings.lineHeight,
    settings.linesPerPage,
  );
  const textHeight =
    settings.charactersPerLine *
    settings.fontSize *
    (1 + settings.letterSpacing);
  const { pageWidth, pageHeight } = previewPageFrame(
    bodyWidth,
    textHeight,
    settings.verticalMargin,
    settings.horizontalMargin,
  );
  oldPreview.style.setProperty("--diff-preview-font", settings.font);
  oldPreview.style.setProperty("--diff-preview-size", `${settings.fontSize}px`);
  oldPreview.style.setProperty(
    "--diff-preview-letter-spacing",
    `${settings.letterSpacing}em`,
  );
  oldPreview.style.setProperty(
    "--diff-preview-line-height",
    String(settings.lineHeight),
  );
  oldPreview.style.setProperty(
    "--diff-preview-line-pitch",
    `${settings.fontSize * settings.lineHeight}px`,
  );
  oldPreview.style.setProperty("--diff-preview-body-width", `${bodyWidth}px`);
  oldPreview.style.setProperty(
    "--diff-preview-vertical-margin",
    `${Math.max(0, settings.verticalMargin)}px`,
  );
  oldPreview.style.setProperty(
    "--diff-preview-horizontal-margin",
    `${Math.max(0, settings.horizontalMargin)}px`,
  );
  oldPreview.style.setProperty("--diff-preview-page-width", `${pageWidth}px`);
  oldPreview.style.setProperty("--diff-preview-page-height", `${pageHeight}px`);

  const html = renderPreviewDocument(text);
  const pageContents = [];
  for (const pageIndex of [1, 0]) {
    const page = document.createElement("article");
    page.className = "preview-page";
    const pageBody = document.createElement("div");
    pageBody.className = "preview-page-body";
    const content = document.createElement("div");
    content.className = "preview-page-content";
    content.innerHTML = html;
    pageBody.append(content);
    page.append(pageBody);
    oldPreview.append(page);
    pageContents[pageIndex] = content;
  }

  pageContents[0].style.transform = "translateX(0)";
  pageContents[1].style.transform = `translateX(${bodyWidth}px)`;
  proofPdfPreview = {
    bodyWidth,
    pageWidth,
    pageHeight,
    pageCount: previewPageCount(pageContents[0].scrollWidth, bodyWidth),
    template: pageContents[0].closest(".preview-page"),
  };
  updateProofPdfButton();
}

function updateProofPdfButton() {
  proofPdfButton.hidden =
    viewMode !== "preview" || !currentState?.left || !proofPdfPreview;
}

function scheduleOldPreviewRender() {
  if (previewRenderFrame !== null) {
    cancelAnimationFrame(previewRenderFrame);
  }
  previewRenderFrame = requestAnimationFrame(() => {
    previewRenderFrame = null;
    if (viewMode !== "preview" || oldPreview.hidden) return;
    renderOldPreview(currentState?.left?.text ?? "");
  });
}

function setViewMode(mode) {
  viewMode = mode;
  const preview = mode === "preview";
  comparison.classList.toggle("preview-mode", preview);
  oldPreview.hidden = !preview;
  $("diffViewButton").classList.toggle("active", !preview);
  $("oldPreviewButton").classList.toggle("active", preview);
  $("diffViewButton").setAttribute("aria-pressed", String(!preview));
  $("oldPreviewButton").setAttribute("aria-pressed", String(preview));
  layoutButton.hidden = !preview;
  if (!preview && layoutDialog.open) layoutDialog.close();
  if (preview) scheduleOldPreviewRender();
  updateProofPdfButton();
}

function openLayoutDialog() {
  const settings = previewSettings();
  $("previewFont").value = settings.font;
  $("previewVerticalMargin").value = settings.verticalMargin;
  $("previewHorizontalMargin").value = settings.horizontalMargin;
  if (!layoutDialog.open) layoutDialog.show();
}

function saveLayoutSettings() {
  localStorage.setItem("diffPreview.font", $("previewFont").value.trim());
  localStorage.setItem(
    "diffPreview.verticalMargin",
    String(Math.max(0, Number($("previewVerticalMargin").value) || 0)),
  );
  localStorage.setItem(
    "diffPreview.horizontalMargin",
    String(Math.max(0, Number($("previewHorizontalMargin").value) || 0)),
  );
  scheduleOldPreviewRender();
}

layoutButton.onclick = openLayoutDialog;
for (const control of [
  $("previewFont"),
  $("previewVerticalMargin"),
  $("previewHorizontalMargin"),
]) {
  control.addEventListener("input", saveLayoutSettings);
}

function stylesheetText() {
  return Array.from(document.styleSheets)
    .flatMap((sheet) => {
      try {
        return Array.from(sheet.cssRules, (rule) => rule.cssText);
      } catch {
        return [];
      }
    })
    .join("\n");
}

function buildProofPdfHtml() {
  if (!proofPdfPreview?.template) {
    throw new Error("縦書きプレビューを表示してください");
  }
  const { bodyWidth, pageWidth, pageHeight, pageCount, template } =
    proofPdfPreview;
  const { marginTopMm, marginRightMm, marginBottomMm, marginLeftMm } =
    proofPdfLayout;
  const pages = document.createElement("main");
  pages.className = "proof-pages";
  pages.style.cssText = oldPreview.style.cssText;
  const availableWidth = ((148 - marginRightMm - marginLeftMm) / 25.4) * 96;
  const availableHeight = ((210 - marginTopMm - marginBottomMm) / 25.4) * 96;
  const scale = Math.min(
    availableWidth / pageWidth,
    availableHeight / pageHeight,
  );
  pages.style.setProperty("--proof-page-scale", String(scale));
  pages.style.setProperty("--proof-page-width", `${pageWidth * scale}px`);
  pages.style.setProperty("--proof-page-height", `${pageHeight * scale}px`);
  pages.style.setProperty("--proof-margin-top", `${marginTopMm}mm`);
  pages.style.setProperty("--proof-margin-right", `${marginRightMm}mm`);
  pages.style.setProperty("--proof-margin-bottom", `${marginBottomMm}mm`);
  pages.style.setProperty("--proof-margin-left", `${marginLeftMm}mm`);

  const sheet = document.createElement("section");
  sheet.className = "proof-sheet";
  const page = template.cloneNode(true);
  page.classList.add("proof-page");
  page.querySelector(".preview-page-content").style.transform =
    "translateX(var(--proof-content-offset))";
  const frame = document.createElement("div");
  frame.className = "proof-page-frame";
  frame.append(page);
  sheet.append(frame);
  pages.append(sheet);

  const printCss = `
    @page { size: A5 portrait; margin: 0; }
    html, body { width: auto; height: auto; margin: 0; overflow: visible; background: #fff; }
    body { display: block; }
    .proof-pages { display: block; min-height: 0; padding: 0; background: #fff; }
    .proof-sheet {
      display: grid;
      place-items: center;
      box-sizing: border-box;
      width: 148mm;
      height: 210mm;
      padding: var(--proof-margin-top) var(--proof-margin-right) var(--proof-margin-bottom) var(--proof-margin-left);
      overflow: hidden;
    }
    .proof-page-frame {
      position: relative;
      width: var(--proof-page-width);
      height: var(--proof-page-height);
      overflow: hidden;
    }
    .proof-page {
      position: absolute;
      top: 0;
      left: 0;
      width: var(--diff-preview-page-width);
      height: var(--diff-preview-page-height);
      min-height: 0;
      transform: scale(var(--proof-page-scale));
      transform-origin: top left;
    }
    .proof-page::after { border: 0; }
  `;
  return {
    html: `<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>${stylesheetText()}${printCss}</style></head><body>${pages.outerHTML}</body></html>`,
    pageCount,
    bodyWidth,
  };
}

async function openProofPdfDialog() {
  try {
    $("proofPdfPath").value = await window.diffApi.proofPdfDefaultPath();
    proofPdfDialog.showModal();
  } catch (error) {
    $("status").textContent = `PDFを出力できません: ${error.message}`;
  }
}

proofPdfButton.onclick = openProofPdfDialog;
$("browseProofPdfPath").onclick = async () => {
  const file = await window.diffApi.chooseProofPdfPath($("proofPdfPath").value);
  if (file) $("proofPdfPath").value = file;
};
$("cancelProofPdf").onclick = () => proofPdfDialog.close();
$("proofPdfForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = $("exportProofPdf");
  submit.disabled = true;
  $("status").textContent = "朱入り原稿PDFを作成しています…";
  try {
    const proofPdf = buildProofPdfHtml();
    const file = await window.diffApi.exportProofPdf({
      filePath: $("proofPdfPath").value,
      ...proofPdf,
    });
    proofPdfDialog.close();
    $("status").textContent = `PDF出力済み — ${file}`;
  } catch (error) {
    $("status").textContent = `PDFを出力できません: ${error.message}`;
  } finally {
    submit.disabled = false;
  }
});

function showEmptyPane(pane, message) {
  const empty = document.createElement("span");
  empty.className = "empty-message";
  empty.textContent = message;
  pane.replaceChildren(empty);
}

function caretOffsetAtPoint(event, part) {
  const position = document.caretPositionFromPoint?.(
    event.clientX,
    event.clientY,
  );
  if (position?.offsetNode === part.firstChild) return position.offset;
  const range = document.caretRangeFromPoint?.(event.clientX, event.clientY);
  if (range?.startContainer === part.firstChild) return range.startOffset;
  return 0;
}

function placeCaret(pane, partId, offset) {
  pane.querySelector(".synced-caret")?.remove();
  const part = pane.querySelector(`[data-part="${partId}"]`);
  const text = part?.firstChild;
  if (!text) return;

  const range = document.createRange();
  range.setStart(text, Math.min(offset, text.length));
  range.collapse(true);
  const rect = range.getBoundingClientRect();
  const paneRect = pane.getBoundingClientRect();
  const caret = document.createElement("span");
  caret.className = "synced-caret";
  caret.style.left = `${rect.left - paneRect.left + pane.scrollLeft}px`;
  caret.style.top = `${rect.top - paneRect.top + pane.scrollTop}px`;
  caret.style.height = `${rect.height || parseFloat(getComputedStyle(pane).lineHeight)}px`;
  pane.append(caret);
}

function setSyncedCarets(partId, offset) {
  placeCaret(leftDocument, partId, offset);
  placeCaret(rightDocument, partId, offset);
}

function focusChange(index) {
  if (!changeIds.length) return;
  currentChangeIndex = (index + changeIds.length) % changeIds.length;
  const changeId = changeIds[currentChangeIndex];
  document.querySelectorAll(".diff-current").forEach((element) => {
    element.classList.remove("diff-current");
  });
  const targets = document.querySelectorAll(`[data-change="${changeId}"]`);
  targets.forEach((element) => element.classList.add("diff-current"));
  const target = leftDocument.querySelector(`[data-change="${changeId}"]`);
  target?.scrollIntoView({ block: "center" });
  rightDocument.scrollTop = leftDocument.scrollTop;
  $("changeCount").textContent =
    `${currentChangeIndex + 1} / ${changeIds.length}`;
}

function synchronizeScroll(source, target) {
  source.addEventListener("scroll", () => {
    if (syncingScroll) return;
    syncingScroll = true;
    const sourceRange = source.scrollHeight - source.clientHeight;
    const targetRange = target.scrollHeight - target.clientHeight;
    const ratio = sourceRange > 0 ? source.scrollTop / sourceRange : 0;
    target.scrollTop = ratio * targetRange;
    target.scrollLeft = source.scrollLeft;
    requestAnimationFrame(() => {
      syncingScroll = false;
    });
  });
}

for (const pane of [leftDocument, rightDocument]) {
  pane.addEventListener("click", (event) => {
    const part = event.target.closest(".diff-part");
    if (!part) return;
    setSyncedCarets(part.dataset.part, caretOffsetAtPoint(event, part));
    const changeId = Number(part.dataset.change);
    const index = changeIds.indexOf(changeId);
    if (index >= 0) {
      currentChangeIndex = index;
      $("changeCount").textContent = `${index + 1} / ${changeIds.length}`;
    }
  });
}

synchronizeScroll(leftDocument, rightDocument);
synchronizeScroll(rightDocument, leftDocument);
$("previousChange").onclick = () => focusChange(currentChangeIndex - 1);
$("nextChange").onclick = () => focusChange(currentChangeIndex + 1);

function applyState(comparison) {
  currentState = comparison;
  proofPdfPreview = null;
  updateProofPdfButton();
  if (viewMode === "preview") scheduleOldPreviewRender();
  $("leftFile").textContent = comparison.left?.name ?? "古いファイルを選択…";
  $("rightFile").textContent =
    comparison.right?.name ?? "新しいファイルを選択…";
  $("leftFile").title = comparison.left?.path ?? "";
  $("rightFile").title = comparison.right?.path ?? "";
  $("leftPath").textContent = comparison.left?.path ?? "";
  $("rightPath").textContent = comparison.right?.path ?? "";

  if (!comparison.parts) {
    showEmptyPane(
      leftDocument,
      comparison.left
        ? "新しいファイルを選択してください"
        : "古いファイルを選択してください",
    );
    showEmptyPane(
      rightDocument,
      comparison.right
        ? "古いファイルを選択してください"
        : "新しいファイルを選択してください",
    );
    changeIds = [];
    currentChangeIndex = -1;
    $("previousChange").disabled = true;
    $("nextChange").disabled = true;
    $("changeCount").textContent = "— / —";
    $("status").textContent = "古いファイルと新しいファイルを選択してください";
    document.title = "ファイル比較 — DRFT";
    return;
  }

  renderParts(comparison.parts);
  const hasChanges = changeIds.length > 0;
  $("previousChange").disabled = !hasChanges;
  $("nextChange").disabled = !hasChanges;
  $("changeCount").textContent = hasChanges
    ? `1 / ${changeIds.length}`
    : "0 / 0";
  $("status").textContent = hasChanges
    ? `${changeIds.length}か所の変更`
    : "差分はありません";
  document.title = `${comparison.left.name} ↔ ${comparison.right.name} — DRFT`;
  if (hasChanges) focusChange(0);
}

async function chooseFile(side) {
  $("status").textContent = "ファイルを読み込んでいます…";
  try {
    const comparison = await window.diffApi.choose(side);
    if (comparison) applyState(comparison);
    else if (currentState) applyState(currentState);
  } catch (error) {
    $("status").textContent = `比較できません: ${error.message}`;
  }
}

$("leftFile").onclick = () => chooseFile("left");
$("rightFile").onclick = () => chooseFile("right");

try {
  applyState(await window.diffApi.load());
} catch (error) {
  $("status").textContent = `比較できません: ${error.message}`;
}

$("diffViewButton").onclick = () => setViewMode("diff");
$("oldPreviewButton").onclick = () => setViewMode("preview");
