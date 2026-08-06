import { renderPreviewDocument } from "./parser.js";
import { previewPageBodyWidth } from "./preview-layout.js";

const $ = (id) => document.getElementById(id);
const leftDocument = $("leftDocument");
const rightDocument = $("rightDocument");
const comparison = document.querySelector(".comparison");
const oldPreview = $("oldPreview");
let viewMode = "diff";
let changeIds = [];
let currentChangeIndex = -1;
let syncingScroll = false;
let currentState = null;
let previewRenderFrame = null;

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


function previewSettings() {
  return {
    font:
      localStorage.getItem("display.font") || "Yu Mincho, YuMincho, serif",
    fontSize: Number(localStorage.getItem("display.fontSize")) || 18,
    letterSpacing: Number(localStorage.getItem("display.letterSpacing")) || 0,
    lineHeight: Number(localStorage.getItem("display.lineHeight")) || 1.75,
    charactersPerLine: Number(localStorage.getItem("display.lineChars")) || 40,
    linesPerPage: Number(localStorage.getItem("display.previewLines")) || 16,
  };
}

function renderOldPreview(text) {
  oldPreview.replaceChildren();
  if (!text) {
    const message = document.createElement("p");
    message.className = "empty-message";
    message.textContent = "古いファイルを選択してください";
    oldPreview.append(message);
    return;
  }

  const settings = previewSettings();
  const bodyWidth = previewPageBodyWidth(
    settings.fontSize,
    settings.lineHeight,
    settings.linesPerPage,
  );
  const pageHeight =
    settings.charactersPerLine *
      settings.fontSize *
      (1 + settings.letterSpacing) +
    64;
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
  oldPreview.style.setProperty(
    "--diff-preview-page-width",
    `${bodyWidth + 64}px`,
  );
  oldPreview.style.setProperty(
    "--diff-preview-page-height",
    `${pageHeight}px`,
  );

  const html = renderPreviewDocument(text);
  const pageContents = [];
  for (const pageIndex of [1, 0]) {
    const page = document.createElement("article");
    page.className = "preview-page";
    const content = document.createElement("div");
    content.className = "preview-page-content";
    content.innerHTML = html;
    page.append(content);
    oldPreview.append(page);
    pageContents[pageIndex] = content;
  }

  const rightPage = pageContents[0].parentElement;
  const pageStyle = getComputedStyle(rightPage);
  const spreadPageOffset = Math.max(
    1,
    rightPage.clientWidth -
      parseFloat(pageStyle.paddingLeft) -
      parseFloat(pageStyle.paddingRight),
  );
  pageContents[0].style.transform = "translateX(0)";
  pageContents[1].style.transform = `translateX(${spreadPageOffset}px)`;
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
  if (preview) scheduleOldPreviewRender();
}

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
