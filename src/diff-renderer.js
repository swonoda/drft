import { manuscriptText, renderPreviewDocument } from "./parser.js";
import {
  findInlineProofreadPosition,
  findProofreadNotePosition,
} from "./proofread-layout.js";
import {
  fixedSpreadPreviewLayout,
  previewPageCount,
} from "./preview-layout.js";

const $ = (id) => document.getElementById(id);
const leftDocument = $("leftDocument");
const rightDocument = $("rightDocument");
const comparison = document.querySelector(".comparison");
const oldPreview = $("oldPreview");
const layoutSidebar = $("layoutSidebar");
const layoutSidebarToggle = $("layoutSidebarToggle");
const proofPdfButton = $("proofPdfButton");
const proofPdfDialog = $("proofPdfDialog");
let viewMode = "diff";
let changeIds = [];
let currentChangeIndex = -1;
let syncingScroll = false;
let currentState = null;
let previewRenderFrame = null;
let previewRenderToken = 0;
let previewPagination = null;
let currentPreviewSpread = 0;
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
    charactersPerLine: storedNumber(
      "diffPreview.charactersPerLine",
      Number(localStorage.getItem("display.lineChars")) || 40,
    ),
    linesPerPage: storedNumber(
      "diffPreview.linesPerPage",
      Number(localStorage.getItem("display.previewLines")) || 16,
    ),
    verticalMarginMm: storedNumber("diffPreview.verticalMarginMm", 15),
    horizontalMarginMm: storedNumber("diffPreview.horizontalMarginMm", 15),
  };
}

function afterPreviewLayout(callback) {
  const fontsReady = document.fonts?.ready ?? Promise.resolve();
  fontsReady.then(() => {
    requestAnimationFrame(() => requestAnimationFrame(callback));
  });
}

function visibleProofreadChanges(text, changes) {
  const normalized = text.replaceAll("\r\n", "\n");
  return changes
    .map((change) => ({
      ...change,
      start: manuscriptText(normalized.slice(0, change.start)).length,
      end: manuscriptText(normalized.slice(0, change.end)).length,
      note:
        change.type === "replace" || change.type === "add"
          ? manuscriptText(change.replacement || "")
          : "トル",
    }))
    .filter(
      (change) =>
        change.note && (change.type === "add" || change.end > change.start),
    );
}

function applyProofreadChanges(container, text, changes) {
  const visibleChanges = visibleProofreadChanges(text, changes);
  container.dataset.proofreadChanges = JSON.stringify(visibleChanges);
}

function positionProofreadNotes(page) {
  page.querySelector(".proofread-note-layer")?.remove();
  const layer = document.createElement("div");
  layer.className = "proofread-note-layer";
  const content = page.querySelector(".preview-page-content");
  const changes = JSON.parse(content.dataset.proofreadChanges || "[]");
  if (!changes.length) return;
  const pageRect = page.getBoundingClientRect();
  const bodyRect = page
    .querySelector(".preview-page-body")
    .getBoundingClientRect();
  const scaleX = pageRect.width / page.offsetWidth;
  const scaleY = pageRect.height / page.offsetHeight;
  const toPageRect = (rect) => ({
    x: (rect.left - pageRect.left) / scaleX,
    y: (rect.top - pageRect.top) / scaleY,
    width: rect.width / scaleX,
    height: rect.height / scaleY,
  });
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let offset = 0;
  let node;
  while ((node = walker.nextNode())) {
    if (node.parentElement?.closest("rt")) continue;
    nodes.push({ node, start: offset, end: offset + node.data.length });
    offset += node.data.length;
  }
  const visible = (rect) =>
    rect.right > bodyRect.left &&
    rect.left < bodyRect.right &&
    rect.bottom > bodyRect.top &&
    rect.top < bodyRect.bottom;
  const occupied = [];
  for (const item of nodes) {
    const textRange = document.createRange();
    textRange.selectNodeContents(item.node);
    occupied.push(
      ...[...textRange.getClientRects()].filter(visible).map(toPageRect),
    );
  }
  const leaderSvg = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg",
  );
  leaderSvg.classList.add("proofread-leaders");
  leaderSvg.setAttribute(
    "viewBox",
    `0 0 ${page.offsetWidth} ${page.offsetHeight}`,
  );
  layer.append(leaderSvg);
  let leaderIndex = 0;
  const appendLeader = (anchor, position) => {
    const destination = {
      x: Math.max(position.x, Math.min(position.x + position.width, anchor.x)),
      y: Math.max(position.y, Math.min(position.y + position.height, anchor.y)),
    };
    const leader = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "polyline",
    );
    const laneNumber = Math.ceil(leaderIndex / 2);
    const laneOffset = laneNumber * 5 * (leaderIndex % 2 ? -1 : 1);
    leaderIndex++;
    const deltaX = Math.abs(destination.x - anchor.x);
    const deltaY = Math.abs(destination.y - anchor.y);
    const points =
      deltaX >= deltaY
        ? [
            anchor,
            { x: (anchor.x + destination.x) / 2 + laneOffset, y: anchor.y },
            {
              x: (anchor.x + destination.x) / 2 + laneOffset,
              y: destination.y,
            },
            destination,
          ]
        : [
            anchor,
            { x: anchor.x, y: (anchor.y + destination.y) / 2 + laneOffset },
            {
              x: destination.x,
              y: (anchor.y + destination.y) / 2 + laneOffset,
            },
            destination,
          ];
    leader.setAttribute(
      "points",
      points.map((point) => `${point.x},${point.y}`).join(" "),
    );
    leaderSvg.append(leader);
  };
  const insertionPoint = (changeOffset) => {
    const item =
      nodes.find(
        (candidate) =>
          changeOffset >= candidate.start && changeOffset < candidate.end,
      ) || nodes.at(-1);
    if (!item || !item.node.data.length) return null;
    const localOffset = Math.max(
      0,
      Math.min(changeOffset - item.start, item.node.data.length),
    );
    const range = document.createRange();
    const afterCharacter = localOffset >= item.node.data.length;
    if (afterCharacter) {
      range.setStart(item.node, item.node.data.length - 1);
      range.setEnd(item.node, item.node.data.length);
    } else {
      range.setStart(item.node, localOffset);
      range.setEnd(item.node, localOffset + 1);
    }
    const rect = [...range.getClientRects()].find(visible);
    if (!rect) return null;
    const pageCharacterRect = toPageRect(rect);
    return {
      item,
      anchor: {
        x: pageCharacterRect.x + pageCharacterRect.width / 2,
        y: afterCharacter
          ? pageCharacterRect.y + pageCharacterRect.height
          : pageCharacterRect.y,
      },
      characterRect: pageCharacterRect,
    };
  };
  for (const change of changes) {
    if (change.type === "add") {
      const insertion = insertionPoint(change.start);
      if (!insertion) continue;
      const fontSize = parseFloat(
        getComputedStyle(insertion.item.node.parentElement).fontSize,
      );
      const arm = fontSize * 0.34;
      const marker = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "polyline",
      );
      marker.classList.add("proofread-insert-caret");
      marker.setAttribute(
        "points",
        [
          `${insertion.anchor.x + arm},${insertion.anchor.y - arm}`,
          `${insertion.anchor.x},${insertion.anchor.y}`,
          `${insertion.anchor.x + arm},${insertion.anchor.y + arm}`,
        ].join(" "),
      );
      leaderSvg.append(marker);
      const markerLabel = document.createElement("span");
      markerLabel.className = "proofread-insert-label";
      markerLabel.textContent = "※入ル";
      markerLabel.style.fontSize = `${fontSize * 0.48}px`;
      markerLabel.style.top = `${insertion.anchor.y + arm}px`;
      markerLabel.style.left = `${insertion.anchor.x + arm}px`;
      layer.append(markerLabel);

      const note = document.createElement("span");
      note.className = "proofread-note proofread-note-add";
      note.textContent = `※${change.note}`;
      note.style.fontSize = `${fontSize}px`;
      const position = findProofreadNotePosition({
        pageWidth: page.offsetWidth,
        pageHeight: page.offsetHeight,
        noteWidth: fontSize * 1.15,
        noteHeight: Math.max(fontSize, [...note.textContent].length * fontSize),
        anchor: insertion.anchor,
        occupied,
        gap: Math.max(3, fontSize * 0.2),
        step: Math.max(4, fontSize * 0.35),
      });
      note.style.top = `${position.y}px`;
      note.style.left = `${position.x}px`;
      layer.append(note);
      occupied.push(position);
      appendLeader(insertion.anchor, position);
      continue;
    }

    const first = nodes.find((item) => change.start < item.end);
    const last = [...nodes].reverse().find((item) => change.end > item.start);
    if (!first || !last) continue;
    const range = document.createRange();
    range.setStart(first.node, Math.max(0, change.start - first.start));
    range.setEnd(
      last.node,
      Math.min(last.node.data.length, change.end - last.start),
    );
    const visibleRects = [...range.getClientRects()].filter(visible);
    for (const rect of visibleRects) {
      const strike = document.createElement("span");
      strike.className = "proofread-strike";
      strike.style.top = `${(rect.top - pageRect.top) / scaleY}px`;
      strike.style.left = `${(rect.left + rect.width / 2 - pageRect.left) / scaleX}px`;
      strike.style.height = `${rect.height / scaleY}px`;
      layer.append(strike);
    }
    const anchorRect = visibleRects[0];
    if (!anchorRect) continue;
    const note = document.createElement("span");
    note.className = `proofread-note proofread-note-${change.type}`;
    note.textContent = change.note;
    const fontSize = parseFloat(
      getComputedStyle(first.node.parentElement).fontSize,
    );
    if (change.type === "delete") {
      note.style.fontSize = `${fontSize * 0.5}px`;
      note.style.top = `${(anchorRect.top - pageRect.top) / scaleY}px`;
      note.style.left = `${(anchorRect.right - pageRect.left) / scaleX + 2}px`;
      layer.append(note);
      continue;
    }
    const anchorPageRect = toPageRect(anchorRect);
    const inlinePosition = findInlineProofreadPosition({
      pageWidth: page.offsetWidth,
      pageHeight: page.offsetHeight,
      noteLength: [...change.note].length,
      baseFontSize: fontSize,
      anchorRect: anchorPageRect,
      occupied,
      gap: Math.max(1, fontSize * 0.08),
    });
    if (inlinePosition) {
      note.classList.add("proofread-note-inline");
      note.style.fontSize = `${inlinePosition.fontSize}px`;
      note.style.top = `${inlinePosition.y}px`;
      note.style.left = `${inlinePosition.x}px`;
      layer.append(note);
      occupied.push(inlinePosition);
      continue;
    }

    note.style.fontSize = `${fontSize}px`;
    const anchor = {
      x: anchorPageRect.x + anchorPageRect.width / 2,
      y: anchorPageRect.y,
    };
    const position = findProofreadNotePosition({
      pageWidth: page.offsetWidth,
      pageHeight: page.offsetHeight,
      noteWidth: fontSize * 1.15,
      noteHeight: Math.max(fontSize, [...change.note].length * fontSize),
      anchor,
      occupied,
      gap: Math.max(3, fontSize * 0.2),
      step: Math.max(4, fontSize * 0.35),
    });
    note.style.top = `${position.y}px`;
    note.style.left = `${position.x}px`;
    layer.append(note);
    occupied.push(position);
    appendLeader(anchor, position);
  }
  page.append(layer);
}

function scheduleProofreadNotes(pages) {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => pages.forEach(positionProofreadNotes)),
  );
}

function updatePreviewSpread() {
  if (!previewPagination) return;
  const {
    bodyWidth,
    pageContents,
    pageCount,
    nextButton,
    backButton,
    pageState,
    pages,
  } = previewPagination;
  const maximumSpread = Math.max(0, Math.ceil(pageCount / 2) - 1);
  currentPreviewSpread = Math.max(
    0,
    Math.min(currentPreviewSpread, maximumSpread),
  );
  const rightPage = currentPreviewSpread * 2;
  const leftPage = rightPage + 1;
  pageContents[0].style.transform = `translateX(${rightPage * bodyWidth}px)`;
  pageContents[1].style.transform = `translateX(${leftPage * bodyWidth}px)`;
  pageContents[0].style.visibility =
    rightPage < pageCount ? "visible" : "hidden";
  pageContents[1].style.visibility =
    leftPage < pageCount ? "visible" : "hidden";
  nextButton.disabled = leftPage >= pageCount - 1;
  backButton.disabled = rightPage === 0;
  const lastVisiblePage = Math.min(leftPage + 1, pageCount);
  pageState.textContent =
    rightPage + 1 === lastVisiblePage
      ? `${rightPage + 1} / ${pageCount}`
      : `${rightPage + 1}–${lastVisiblePage} / ${pageCount}`;
  scheduleProofreadNotes(pages);
}

function renderOldPreview(text) {
  const renderToken = ++previewRenderToken;
  previewPagination = null;
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
  const {
    pageWidth,
    pageHeight,
    bodyWidth,
    bodyHeight,
    verticalMargin,
    horizontalMargin,
    linePitch,
    fontSize,
  } = fixedSpreadPreviewLayout(settings);
  const availableWidth = Math.max(1, oldPreview.clientWidth - 56 - 96);
  const availableHeight = Math.max(1, oldPreview.clientHeight - 56 - 24);
  const previewScale = Math.min(
    1,
    availableWidth / (pageWidth * 2),
    availableHeight / pageHeight,
  );
  oldPreview.style.setProperty("--diff-preview-font", settings.font);
  oldPreview.style.setProperty("--diff-preview-size", `${fontSize}px`);
  oldPreview.style.setProperty("--diff-preview-letter-spacing", "0em");
  oldPreview.style.setProperty("--diff-preview-line-height", `${linePitch}px`);
  oldPreview.style.setProperty("--diff-preview-line-pitch", `${linePitch}px`);
  oldPreview.style.setProperty("--diff-preview-body-width", `${bodyWidth}px`);
  oldPreview.style.setProperty("--diff-preview-body-height", `${bodyHeight}px`);
  oldPreview.style.setProperty(
    "--diff-preview-vertical-margin",
    `${verticalMargin}px`,
  );
  oldPreview.style.setProperty(
    "--diff-preview-horizontal-margin",
    `${horizontalMargin}px`,
  );
  oldPreview.style.setProperty("--diff-preview-page-width", `${pageWidth}px`);
  oldPreview.style.setProperty("--diff-preview-page-height", `${pageHeight}px`);

  const html = renderPreviewDocument(text);
  const pageContents = [];
  const pages = [];
  const reader = document.createElement("div");
  reader.className = "preview-reader";
  const nextButton = document.createElement("button");
  nextButton.className = "preview-turn preview-turn-next";
  nextButton.type = "button";
  nextButton.textContent = "‹";
  nextButton.disabled = true;
  nextButton.setAttribute("aria-label", "次の見開き");
  const backButton = document.createElement("button");
  backButton.className = "preview-turn preview-turn-back";
  backButton.type = "button";
  backButton.textContent = "›";
  backButton.disabled = true;
  backButton.setAttribute("aria-label", "前の見開き");
  const pageState = document.createElement("div");
  pageState.className = "preview-page-state";
  pageState.textContent = "1 / …";
  const spreadFrame = document.createElement("div");
  spreadFrame.className = "preview-spread-frame";
  spreadFrame.style.width = `${pageWidth * 2 * previewScale}px`;
  spreadFrame.style.height = `${pageHeight * previewScale}px`;
  const spread = document.createElement("div");
  spread.className = "preview-spread";
  spread.style.width = `${pageWidth * 2}px`;
  spread.style.height = `${pageHeight}px`;
  spread.style.transform = `scale(${previewScale})`;
  for (const pageIndex of [1, 0]) {
    const page = document.createElement("article");
    page.className = "preview-page";
    const pageBody = document.createElement("div");
    pageBody.className = "preview-page-body";
    const content = document.createElement("div");
    content.className = "preview-page-content";
    content.innerHTML = html;
    applyProofreadChanges(content, text, currentState?.proofreadChanges || []);
    pageBody.append(content);
    page.append(pageBody);
    spread.append(page);
    pageContents[pageIndex] = content;
    pages[pageIndex] = page;
  }
  spreadFrame.append(spread);
  reader.append(nextButton, spreadFrame, backButton, pageState);
  oldPreview.append(reader);

  nextButton.onclick = () => {
    currentPreviewSpread += 1;
    updatePreviewSpread();
  };
  backButton.onclick = () => {
    currentPreviewSpread -= 1;
    updatePreviewSpread();
  };
  afterPreviewLayout(() => {
    if (renderToken !== previewRenderToken) return;
    const pageCount = previewPageCount(
      pageContents[0].scrollWidth,
      bodyWidth,
      1,
    );
    previewPagination = {
      bodyWidth,
      pageContents,
      pageCount,
      nextButton,
      backButton,
      pageState,
      pages,
    };
    updatePreviewSpread();
    proofPdfPreview = {
      bodyWidth,
      pageWidth,
      pageHeight,
      pageCount,
    };
    updateProofPdfButton();
  });
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
  layoutSidebar.hidden = !preview;
  if (preview) scheduleOldPreviewRender();
  updateProofPdfButton();
}

function fillLayoutControls() {
  const settings = previewSettings();
  $("previewFont").value = settings.font;
  $("previewVerticalMargin").value = settings.verticalMarginMm;
  $("previewHorizontalMargin").value = settings.horizontalMarginMm;
  $("previewLinesPerPage").value = settings.linesPerPage;
  $("previewCharactersPerLine").value = settings.charactersPerLine;
}

function setLayoutSidebarOpen(open) {
  layoutSidebar.classList.toggle("is-collapsed", !open);
  layoutSidebarToggle.textContent = open ? "‹" : "›";
  layoutSidebarToggle.setAttribute("aria-expanded", String(open));
  layoutSidebarToggle.setAttribute(
    "aria-label",
    open ? "レイアウト調整を閉じる" : "レイアウト調整を開く",
  );
  localStorage.setItem("diffPreview.layoutPaneOpen", String(open));
  scheduleOldPreviewRender();
}

function saveLayoutSettings() {
  localStorage.setItem("diffPreview.font", $("previewFont").value.trim());
  localStorage.setItem(
    "diffPreview.verticalMarginMm",
    String(Math.max(0, Number($("previewVerticalMargin").value) || 0)),
  );
  localStorage.setItem(
    "diffPreview.horizontalMarginMm",
    String(Math.max(0, Number($("previewHorizontalMargin").value) || 0)),
  );
  localStorage.setItem(
    "diffPreview.linesPerPage",
    String(Math.max(1, Number($("previewLinesPerPage").value) || 1)),
  );
  localStorage.setItem(
    "diffPreview.charactersPerLine",
    String(Math.max(1, Number($("previewCharactersPerLine").value) || 1)),
  );
  scheduleOldPreviewRender();
}

fillLayoutControls();
setLayoutSidebarOpen(
  localStorage.getItem("diffPreview.layoutPaneOpen") === "true",
);
layoutSidebarToggle.onclick = () =>
  setLayoutSidebarOpen(layoutSidebar.classList.contains("is-collapsed"));
for (const control of [
  $("previewFont"),
  $("previewVerticalMargin"),
  $("previewHorizontalMargin"),
  $("previewLinesPerPage"),
  $("previewCharactersPerLine"),
]) {
  control.addEventListener("input", saveLayoutSettings);
}

$("sampleLayoutButton").onclick = async () => {
  const button = $("sampleLayoutButton");
  button.disabled = true;
  $("status").textContent = "サンプルPDFの組版を調べています…";
  try {
    const result = await window.diffApi.analyzePdfLayout();
    if (!result) {
      $("status").textContent = "サンプルPDFの選択をキャンセルしました";
      return;
    }
    const message =
      `${result.charactersPerLine}字 × ${result.linesPerPage}行、` +
      `上下${result.verticalMarginMm}mm、左右${result.horizontalMarginMm}mm\n\n` +
      "この設定を縦書きプレビューへ反映しますか？";
    if (!window.confirm(message)) {
      $("status").textContent = `解析済み — ${result.sourceName}`;
      return;
    }
    $("previewVerticalMargin").value = result.verticalMarginMm;
    $("previewHorizontalMargin").value = result.horizontalMarginMm;
    $("previewLinesPerPage").value = result.linesPerPage;
    $("previewCharactersPerLine").value = result.charactersPerLine;
    saveLayoutSettings();
    $("status").textContent = `組版設定を反映 — ${result.sourceName}`;
  } catch (error) {
    $("status").textContent = `PDFを解析できません: ${error.message}`;
  } finally {
    button.disabled = false;
  }
};

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
  const displayedPage = oldPreview.querySelector(".preview-page:last-child");
  if (!proofPdfPreview || !displayedPage) {
    throw new Error("縦書きプレビューを表示してください");
  }
  const { bodyWidth, pageWidth, pageHeight, pageCount } = proofPdfPreview;
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
  const page = displayedPage.cloneNode(true);
  page.classList.add("proof-page");
  page.style.visibility = "visible";
  page.querySelector(".proofread-note-layer")?.remove();
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
    html: `<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>${stylesheetText()}${printCss}</style></head><body>${pages.outerHTML}<script>window.findInlineProofreadPosition=${findInlineProofreadPosition.toString()};window.findProofreadNotePosition=${findProofreadNotePosition.toString()};window.positionProofreadNotes=${positionProofreadNotes.toString()};<\/script></body></html>`,
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
  const previousLeftPath = currentState?.left?.path;
  currentState = comparison;
  if (comparison.left?.path !== previousLeftPath) currentPreviewSpread = 0;
  proofPdfPreview = null;
  updateProofPdfButton();
  if (viewMode === "preview") scheduleOldPreviewRender();
  $("leftFile").textContent = comparison.left?.name ?? "古いファイルを選択…";
  $("rightFile").textContent = comparison.right
    ? `${comparison.right.name}${comparison.right.current ? "（現在の原稿）" : ""}`
    : "新しいファイルを選択…";
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

async function chooseRightSource() {
  $("status").textContent = "新しい原稿を選択しています…";
  try {
    const comparison = await window.diffApi.chooseRightSource();
    if (comparison) applyState(comparison);
    else if (currentState) applyState(currentState);
  } catch (error) {
    $("status").textContent = `比較できません: ${error.message}`;
  }
}

$("leftFile").onclick = () => chooseFile("left");
$("rightFile").onclick = chooseRightSource;

try {
  applyState(await window.diffApi.load());
} catch (error) {
  $("status").textContent = `比較できません: ${error.message}`;
}

$("diffViewButton").onclick = () => setViewMode("diff");
$("oldPreviewButton").onclick = () => setViewMode("preview");
window.addEventListener("resize", scheduleOldPreviewRender);
