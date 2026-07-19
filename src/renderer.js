import {
  parseDocument,
  renderBody,
  inlineMarkup,
  manuscriptCharacterCount,
  manuscriptSheetCount,
  moveParagraphSection,
  findFixMarks,
  renderPreviewDocument,
} from "./parser.js";
import {
  editorMarginWithPreview,
  previewPageBodyWidth,
  previewPageCount,
  previewPageForOffset,
} from "./preview-layout.js";
const $ = (id) => document.getElementById(id);
const editor = $("editor"),
  preview = $("preview"),
  previewContent = $("previewContent"),
  outline = $("outline"),
  fixList = $("fixList"),
  state = $("state");
let filePath = null,
  encoding = "utf8",
  dirty = false,
  renderTimer,
  saveTimer,
  cursorFrame,
  currentPage = 0;
let showFixHighlights =
  localStorage.getItem("preview.showFixHighlights") !== "false";

function setState(s) {
  state.textContent = s;
}
function updateCharacterCount() {
  const count = manuscriptCharacterCount(editor.value);
  const sheets = manuscriptSheetCount(editor.value);
  $("characterCount").textContent =
    `${count.toLocaleString("ja-JP")}字　原稿用紙 ${sheets.toLocaleString("ja-JP")}枚`;
}
function update() {
  const doc = parseDocument(editor.value);
  document.title = `${doc.title.trim() || "無題"} — DRFT`;
  const fixes = findFixMarks(editor.value);
  const previewOpen = $("previewPane").classList.contains("open");
  if (previewOpen) {
    previewContent.innerHTML = renderPreviewDocument(
      editor.value,
      editor.selectionStart,
    );
    installPreviewCaretAnchor();
  }
  outline.replaceChildren();
  let chapterSeen = false;
  doc.sections.forEach((item, index) => {
    if (item.type === "chapter") chapterSeen = true;
    const el = document.createElement("div");
    el.className = `outline-item ${item.type}`;
    el.textContent = item.label;
    el.draggable = item.type === "paragraph";
    el.dataset.index = index;
    if (item.type === "paragraph" && !chapterSeen) el.style.paddingLeft = "8px";
    el.onclick = () => jumpToLine(item.start);
    el.addEventListener("dragstart", (e) =>
      e.dataTransfer.setData("text/plain", index),
    );
    el.addEventListener("dragover", (e) => {
      e.preventDefault();
      el.classList.add("drag-over");
    });
    el.addEventListener("dragleave", () => el.classList.remove("drag-over"));
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      el.classList.remove("drag-over");
      const rect = el.getBoundingClientRect();
      const after =
        item.type === "chapter" || e.clientY > rect.top + rect.height / 2;
      moveParagraph(+e.dataTransfer.getData("text/plain"), index, after);
    });
    outline.append(el);
  });
  fixList.replaceChildren();
  fixes.forEach((fix, index) => {
    const el = document.createElement("button");
    el.className = "fix-item";
    const comment = document.createElement("strong");
    comment.textContent = fix.comment || "コメントなし";
    const context = document.createElement("span");
    context.textContent = fix.context || `修正マーク ${index + 1}`;
    el.append(comment, context);
    el.onclick = () => revealEditorPosition(fix.start, fix.end);
    fixList.append(el);
  });
  if (!fixes.length) {
    const empty = document.createElement("p");
    empty.className = "fix-empty";
    empty.textContent = "修正マークはありません";
    fixList.append(empty);
  }
  $("fixBadge").textContent = fixes.length;
  if (previewOpen) requestAnimationFrame(syncPreviewToCaret);
  updateCharacterCount();
}
function showSideView(view) {
  const fixes = view === "fix";
  outline.hidden = fixes;
  fixList.hidden = !fixes;
  $("outlineTab").classList.toggle("active", !fixes);
  $("fixTab").classList.toggle("active", fixes);
}
function pageCount() {
  return previewPageCount(previewContent.scrollWidth, pageWidth());
}
function pageWidth() {
  const style = getComputedStyle(preview);
  return Math.max(
    1,
    preview.clientWidth -
      parseFloat(style.paddingLeft) -
      parseFloat(style.paddingRight),
  );
}
function showCurrentPage() {
  const count = pageCount();
  currentPage = Math.max(0, Math.min(currentPage, count - 1));
  previewContent.style.transform = `translateX(${currentPage * pageWidth()}px)`;
  updatePageState();
}
function updatePageState() {
  const count = pageCount();
  currentPage = Math.max(0, Math.min(currentPage, count - 1));
  $("pageState").textContent = `${currentPage + 1} / ${count}`;
  $("pageBack").disabled = currentPage === 0;
  $("pageForward").disabled = currentPage >= count - 1;
}
function syncPreviewToCaret() {
  previewContent.style.transform = "translateX(0)";
  const marker = previewContent.querySelector(
    ".preview-caret-anchor, .preview-highlight",
  );
  if (!marker) {
    showCurrentPage();
    return;
  }
  const markerRect = marker.getBoundingClientRect();
  const contentRect = previewContent.getBoundingClientRect();
  const markerCenter = markerRect.left + markerRect.width / 2;
  const fromRight = Math.max(0, contentRect.right - markerCenter);
  currentPage = previewPageForOffset(fromRight, pageWidth(), pageCount());
  showCurrentPage();
}
function cursorMoved() {
  if (!$("previewPane").classList.contains("open")) return;
  cancelAnimationFrame(cursorFrame);
  cursorFrame = requestAnimationFrame(() => {
    previewContent.innerHTML = renderPreviewDocument(
      editor.value,
      editor.selectionStart,
    );
    installPreviewCaretAnchor();
    requestAnimationFrame(syncPreviewToCaret);
  });
}
function installPreviewCaretAnchor() {
  const highlight = previewContent.querySelector(".preview-highlight");
  if (!highlight) return;
  let remaining = Number(highlight.dataset.caretOffset) || 0;
  const walker = document.createTreeWalker(highlight, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return node.parentElement?.closest("rt")
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    },
  });
  let node;
  while ((node = walker.nextNode())) {
    if (remaining <= node.data.length) {
      const anchor = document.createElement("span");
      anchor.className = "preview-caret-anchor";
      anchor.setAttribute("aria-hidden", "true");
      const range = document.createRange();
      range.setStart(node, remaining);
      range.collapse(true);
      range.insertNode(anchor);
      return;
    }
    remaining -= node.data.length;
  }
  const anchor = document.createElement("span");
  anchor.className = "preview-caret-anchor";
  anchor.setAttribute("aria-hidden", "true");
  highlight.append(anchor);
}
function revealEditorPosition(start, end = start) {
  const style = getComputedStyle(editor);
  const mirror = document.createElement("div");
  const properties = [
    "boxSizing",
    "fontFamily",
    "fontSize",
    "fontStyle",
    "fontWeight",
    "letterSpacing",
    "lineHeight",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "borderTopWidth",
    "borderRightWidth",
    "borderBottomWidth",
    "borderLeftWidth",
    "tabSize",
    "textIndent",
    "textTransform",
    "wordSpacing",
  ];
  Object.assign(mirror.style, {
    position: "fixed",
    left: "-100000px",
    top: "0",
    width: `${editor.clientWidth}px`,
    height: "auto",
    visibility: "hidden",
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
    wordBreak: "normal",
  });
  for (const property of properties) mirror.style[property] = style[property];
  mirror.append(document.createTextNode(editor.value.slice(0, start)));
  const marker = document.createElement("span");
  marker.textContent =
    editor.value.slice(start, Math.max(start + 1, end)) || "\u200b";
  mirror.append(marker);
  document.body.append(mirror);
  const targetTop = marker.offsetTop;
  mirror.remove();

  editor.setSelectionRange(start, end);
  editor.focus({ preventScroll: true });
  editor.scrollTop = Math.max(0, targetTop - editor.clientHeight / 3);
}
function goToPage(page) {
  currentPage = Math.max(0, Math.min(page, pageCount() - 1));
  showCurrentPage();
}
function jumpToLine(line) {
  const lines = editor.value.split("\n");
  let p = 0;
  for (let i = 0; i < line; i++) p += lines[i].length + 1;
  revealEditorPosition(p);
}
function moveParagraph(from, to, after = false) {
  const doc = parseDocument(editor.value);
  const moved = moveParagraphSection(doc, from, to, after);
  if (moved === null) return;
  editor.value = moved;
  changed();
}
function changed() {
  dirty = true;
  setState(filePath ? `未保存 — ${filePath}` : "未保存 — 新規");
  clearTimeout(renderTimer);
  renderTimer = setTimeout(update, 180);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(autoSave, 1200);
}
async function autoSave() {
  if (dirty && filePath) {
    await window.desktop.save(editor.value, encoding);
    dirty = false;
    setState(`自動保存済み — ${filePath}`);
  }
}
editor.addEventListener("input", changed);
editor.addEventListener("select", cursorMoved);
editor.addEventListener("click", cursorMoved);
editor.addEventListener("keyup", cursorMoved);
$("outlineTab").onclick = () => showSideView("outline");
$("fixTab").onclick = () => showSideView("fix");
$("encoding").onchange = () => {
  encoding = $("encoding").value;
  changed();
};
loadInitialDocument();
async function loadInitialDocument() {
  const restored = await window.desktop.restoreDocument();
  if (restored) {
    filePath = restored.path;
    encoding = restored.encoding;
    $("encoding").value = encoding;
    editor.value = restored.text;
  } else {
    editor.value = await window.desktop.defaultDocument();
  }
  editor.setSelectionRange(0, 0);
  update();
  setState(filePath || "新規");
  editor.focus();
  if (restored?.dictionaryOpen) await window.desktop.openDictionary();
}
async function newDocument() {
  if (dirty && !window.confirm("未保存の変更を破棄して新規作成しますか？"))
    return;
  await window.desktop.newFile();
  filePath = null;
  encoding = "utf8";
  $("encoding").value = encoding;
  editor.value = "";
  dirty = false;
  currentPage = 0;
  update();
  setState("新規");
  editor.focus();
}
async function openDocument() {
  if (dirty && !window.confirm("未保存の変更を破棄して別の原稿を開きますか？"))
    return;
  const r = await window.desktop.open();
  if (r) {
    filePath = r.path;
    encoding = r.encoding;
    $("encoding").value = encoding;
    editor.value = r.text;
    dirty = false;
    update();
    setState(filePath);
  }
}
async function saveDocument() {
  let p = filePath
    ? await window.desktop.save(editor.value, encoding)
    : await window.desktop.saveAs(editor.value, encoding);
  if (p) {
    filePath = p;
    dirty = false;
    setState(`保存済み — ${p}`);
  }
}
async function saveDocumentAs() {
  const p = await window.desktop.saveAs(editor.value, encoding);
  if (p) {
    filePath = p;
    dirty = false;
    setState(`保存済み — ${p}`);
  }
}
async function saveSnapshot() {
  const p = await window.desktop.saveSnapshot(editor.value, encoding);
  if (p) setState(`スナップショット保存済み — ${p}`);
}
function openFindDialog(focusReplacement = false) {
  if (!$("findDialog").open) $("findDialog").showModal();
  $(focusReplacement ? "replacement" : "needle").focus();
}
function togglePreview() {
  setPreviewOpen(!$("previewPane").classList.contains("open"));
}
function setPreviewOpen(open) {
  $("previewPane").classList.toggle("open", open);
  document.querySelector("main").classList.toggle("preview-open", open);
  $("previewToggle").classList.toggle("active", open);
  $("previewToggle").setAttribute("aria-pressed", String(open));
  $("previewToggle").setAttribute(
    "aria-label",
    open ? "縦書きプレビューを閉じる" : "縦書きプレビューを表示",
  );
  $("previewToggle").title = open
    ? "縦書きプレビューを閉じる"
    : "縦書きプレビューを表示";
  updateEditorHorizontalMargin();
  update();
}
function toggleOutline() {
  document.querySelector("main").classList.toggle("outline-hidden");
}
$("previewToggle").onclick = togglePreview;
function applyFixHighlightVisibility() {
  const button = $("fixPreviewToggle");
  preview.classList.toggle("show-fix-highlights", showFixHighlights);
  button.classList.toggle("active", showFixHighlights);
  button.setAttribute("aria-pressed", String(showFixHighlights));
  button.title = showFixHighlights
    ? "修正箇所の背景を非表示"
    : "修正箇所の背景を表示";
}
$("fixPreviewToggle").onclick = () => {
  showFixHighlights = !showFixHighlights;
  localStorage.setItem("preview.showFixHighlights", String(showFixHighlights));
  applyFixHighlightVisibility();
};
applyFixHighlightVisibility();
$("pageForward").onclick = () => goToPage(currentPage + 1);
$("pageBack").onclick = () => goToPage(currentPage - 1);
new ResizeObserver(() => {
  updateEditorHorizontalMargin();
  if ($("previewPane").classList.contains("open"))
    requestAnimationFrame(syncPreviewToCaret);
}).observe($("previewPane"));
function findNext() {
  const n = $("needle").value;
  if (!n) return;
  let at = editor.value.indexOf(n, editor.selectionEnd);
  if (at < 0) at = editor.value.indexOf(n);
  if (at >= 0) {
    revealEditorPosition(at, at + n.length);
  }
}
function findDictionaryHeading(heading) {
  if (!heading) return;
  const matches = [];
  let offset = editor.value.indexOf(heading);
  while (offset >= 0) {
    matches.push(offset);
    offset = editor.value.indexOf(heading, offset + heading.length);
  }
  if (!matches.length) {
    setState(`辞書「${heading}」— 本文内に見つかりません`);
    return;
  }
  const next = matches.findIndex((position) => position >= editor.selectionEnd);
  const index = next >= 0 ? next : 0;
  const position = matches[index];
  revealEditorPosition(position, position + heading.length);
  setState(`辞書「${heading}」— ${index + 1} / ${matches.length}`);
}
$("findNext").onclick = findNext;
$("replaceOne").onclick = () => {
  const n = $("needle").value;
  if (editor.value.slice(editor.selectionStart, editor.selectionEnd) === n) {
    editor.setRangeText($("replacement").value);
    changed();
  }
  findNext();
};
$("replaceAll").onclick = () => {
  const n = $("needle").value;
  if (n) {
    editor.value = editor.value.split(n).join($("replacement").value);
    changed();
  }
};
function openSettings() {
  if (!$("settingsDialog").open) $("settingsDialog").showModal();
}
const displaySettings = [
  ["font", "--font", ""],
  ["fontSize", "--size", "px"],
  ["letterSpacing", "--ls", "em"],
  ["lineHeight", "--lh", ""],
  ["lineChars", "--line-chars", ""],
  ["previewLines", null, ""],
  ["verticalMargin", "--vertical-margin", "px"],
  ["horizontalMargin", "--horizontal-margin", "px"],
];
function applyPreviewPageSize() {
  const linePitch = Number($("fontSize").value) * Number($("lineHeight").value);
  const bodyWidth = previewPageBodyWidth(
    $("fontSize").value,
    $("lineHeight").value,
    $("previewLines").value,
  );
  document.documentElement.style.setProperty(
    "--preview-line-pitch",
    `${linePitch}px`,
  );
  document.documentElement.style.setProperty(
    "--preview-page-width",
    `${bodyWidth + 64}px`,
  );
  document.documentElement.style.setProperty(
    "--preview-pane-width",
    `${bodyWidth + 120}px`,
  );
}
function updateEditorHorizontalMargin() {
  const previewWidth = $("previewPane").getBoundingClientRect().width;
  const effectiveMargin = editorMarginWithPreview(
    $("horizontalMargin").value,
    previewWidth,
  );
  document.documentElement.style.setProperty(
    "--editor-horizontal-margin",
    `${effectiveMargin}px`,
  );
}
if (!localStorage.getItem("display.verticalMargin")) {
  const savedMargin = localStorage.getItem("display.margin");
  const savedPadding = localStorage.getItem("display.padding");
  const oldMargin = Number(savedMargin);
  const oldPadding = Number(savedPadding);
  if (
    savedMargin !== null &&
    savedPadding !== null &&
    Number.isFinite(oldMargin) &&
    Number.isFinite(oldPadding)
  ) {
    const inherited = Math.min(160, oldMargin + oldPadding);
    localStorage.setItem("display.verticalMargin", inherited);
    localStorage.setItem("display.horizontalMargin", inherited);
  }
}
for (const [id, key, suffix] of displaySettings) {
  const control = $(id),
    saved = localStorage.getItem(`display.${id}`);
  if (saved !== null) control.value = saved;
  const applySetting = () => {
    if (key)
      document.documentElement.style.setProperty(key, control.value + suffix);
  };
  applySetting();
  control.oninput = () => {
    applySetting();
    localStorage.setItem(`display.${id}`, control.value);
    applyPreviewPageSize();
    updateEditorHorizontalMargin();
    if ($("previewPane").classList.contains("open"))
      requestAnimationFrame(syncPreviewToCaret);
  };
}
applyPreviewPageSize();
updateEditorHorizontalMargin();
async function exportPdf() {
  const html = `<!doctype html><html lang="ja"><meta charset="utf-8"><style>@page{size:A5;margin:18mm;marks:crop cross;bleed:3mm}body{height:calc(${$("lineChars").value} * (1em + ${$("letterSpacing").value}em));font-family:${$("font").value};writing-mode:vertical-rl;text-orientation:upright;font-feature-settings:"vert" 1,"vrt2" 1;line-height:${$("lineHeight").value};letter-spacing:${$("letterSpacing").value}em;font-size:${$("fontSize").value}px;column-count:1;column-fill:auto;column-gap:3em;column-rule:0}h2{break-before:auto;break-after:avoid;break-inside:avoid}p{white-space:pre-wrap;margin:0 0 0 1em}.bout{text-emphasis:filled sesame}rt{font-size:.5em}</style><h1>${inlineMarkup(parseDocument(editor.value).title)}</h1>${renderBody(editor.value)}</html>`;
  const p = await window.desktop.exportPdf(html);
  if (p) setState(`PDF出力済み — ${p}`);
}

window.desktop.onMenuCommand((command) => {
  if (typeof command === "object" && command.type === "dictionary-find") {
    findDictionaryHeading(command.heading);
    return;
  }
  const actions = {
    new: newDocument,
    open: openDocument,
    save: saveDocument,
    "save-as": saveDocumentAs,
    snapshot: saveSnapshot,
    pdf: exportPdf,
    find: () => openFindDialog(false),
    replace: () => openFindDialog(true),
    "toggle-outline": toggleOutline,
    "toggle-preview": togglePreview,
    settings: openSettings,
  };
  actions[command]?.();
});
