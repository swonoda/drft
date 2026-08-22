const $ = (id) => document.getElementById(id);
const editor = $("workingEditor");
const backdrop = $("highlightBackdrop");
let state;
let changes = [];
let activeIndex = -1;
let previousText = "";
let closeDecisionPending = false;
let pdfPage = 1;
let pdfPageCount = 1;
let pdfZoom = 1;
let pdfLoadToken = 0;

function updateRanges(before, after) {
  changes = window.proofApplyApi.updateChangeRanges(changes, before, after);
}

function appendHighlight(change, start, end) {
  const span = document.createElement("span");
  span.className = "proof-highlight";
  if (start === end) {
    span.classList.add("deletion");
    span.textContent = "\u200b";
  } else {
    span.textContent = editor.value.slice(start, end);
  }
  if (change.edited) span.classList.add("edited");
  if (changes[activeIndex]?.id === change.id) span.classList.add("current");
  backdrop.append(span);
}

function renderHighlights() {
  backdrop.replaceChildren();
  let cursor = 0;
  const visible = changes
    .filter((change) => !change.reverted)
    .sort((left, right) => left.draftStart - right.draftStart);
  for (const change of visible) {
    const start = Math.max(
      cursor,
      Math.min(editor.value.length, change.draftStart),
    );
    const end = Math.max(start, Math.min(editor.value.length, change.draftEnd));
    backdrop.append(document.createTextNode(editor.value.slice(cursor, start)));
    appendHighlight(change, start, end);
    cursor = end;
  }
  backdrop.append(document.createTextNode(editor.value.slice(cursor)));
  backdrop.scrollTop = editor.scrollTop;
  backdrop.scrollLeft = editor.scrollLeft;
  updateToolbar();
}

function changeDescription(change) {
  if (!change) return "変更候補はありません";
  if (change.reverted) return "この変更は元に戻しました";
  if (change.type === "addition") return `追加：${change.replacement}`;
  if (change.type === "deletion") return `削除：${change.original}`;
  if (change.type === "replacement") {
    return `置換：${change.original} → ${change.replacement}`;
  }
  return change.label || "その他の変更";
}

function updateToolbar() {
  const change = changes[activeIndex];
  $("changeState").textContent = changes.length
    ? `${activeIndex + 1} / ${changes.length}`
    : "0 / 0";
  $("changeDescription").textContent = changeDescription(change);
  $("previousChange").disabled = changes.length === 0;
  $("nextChange").disabled = changes.length === 0;
  $("revertChange").disabled = !change || change.reverted;
}

function selectActive(index) {
  if (!changes.length) {
    activeIndex = -1;
    renderHighlights();
    return;
  }
  activeIndex = (index + changes.length) % changes.length;
  const change = changes[activeIndex];
  editor.focus();
  editor.setSelectionRange(change.draftStart, change.draftEnd);
  renderHighlights();
}

function revertActiveChange() {
  const change = changes[activeIndex];
  if (!change || change.reverted) return;
  const before = editor.value;
  const after =
    before.slice(0, change.draftStart) +
    change.original +
    before.slice(change.draftEnd);
  editor.value = after;
  updateRanges(before, after);
  const current = changes.find((candidate) => candidate.id === change.id);
  if (current) current.reverted = true;
  previousText = after;
  renderHighlights();
}

editor.addEventListener("input", () => {
  updateRanges(previousText, editor.value);
  previousText = editor.value;
  renderHighlights();
});
editor.addEventListener("scroll", () => {
  backdrop.scrollTop = editor.scrollTop;
  backdrop.scrollLeft = editor.scrollLeft;
});
editor.addEventListener("click", () => {
  const caret = editor.selectionStart;
  const index = changes.findIndex(
    (change) =>
      !change.reverted &&
      caret >= change.draftStart &&
      caret <= Math.max(change.draftStart, change.draftEnd),
  );
  if (index >= 0 && index !== activeIndex) {
    activeIndex = index;
    renderHighlights();
  }
});

$("previousChange").onclick = () => selectActive(activeIndex - 1);
$("nextChange").onclick = () => selectActive(activeIndex + 1);
$("revertChange").onclick = revertActiveChange;
$("commitButton").onclick = () => window.proofApplyApi.commit(editor.value);
$("discardButton").onclick = () => window.proofApplyApi.discard();

function updatePdfToolbar() {
  $("pdfPageState").textContent = `${pdfPage} / ${pdfPageCount}`;
  $("previousPdfPage").disabled = pdfPage <= 1;
  $("nextPdfPage").disabled = pdfPage >= pdfPageCount;
  $("pdfZoomState").textContent = `${Math.round(pdfZoom * 100)}%`;
  $("zoomOutPdf").disabled = pdfZoom <= 0.6;
  $("zoomInPdf").disabled = pdfZoom >= 2.4;
  $("proofPdfPage").style.width = `${pdfZoom * 100}%`;
}

async function showPdfPage(pageNumber) {
  pdfPage = Math.max(1, Math.min(pdfPageCount, pageNumber));
  const token = ++pdfLoadToken;
  const image = $("proofPdfPage");
  const message = $("pdfLoading");
  message.textContent = `PDF ${pdfPage}ページ目を読み込み中…`;
  message.hidden = false;
  image.hidden = true;
  updatePdfToolbar();
  try {
    const dataUrl = await window.proofApplyApi.pdfPage(pdfPage);
    if (token !== pdfLoadToken) return;
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("PDF画像を表示できません。"));
      image.src = dataUrl;
    });
    if (token !== pdfLoadToken) return;
    image.hidden = false;
    message.hidden = true;
    $("proofPdfViewport").scrollTo({ top: 0, left: 0 });
  } catch (error) {
    if (token !== pdfLoadToken) return;
    message.textContent = `PDFを表示できません: ${error.message}`;
    message.hidden = false;
  }
}

$("previousPdfPage").onclick = () => showPdfPage(pdfPage - 1);
$("nextPdfPage").onclick = () => showPdfPage(pdfPage + 1);
$("zoomOutPdf").onclick = () => {
  pdfZoom = Math.max(0.6, Math.round((pdfZoom - 0.2) * 10) / 10);
  updatePdfToolbar();
};
$("zoomInPdf").onclick = () => {
  pdfZoom = Math.min(2.4, Math.round((pdfZoom + 0.2) * 10) / 10);
  updatePdfToolbar();
};

window.proofApplyApi.onCloseRequest(async () => {
  if (closeDecisionPending) return;
  closeDecisionPending = true;
  try {
    const decision = await window.proofApplyApi.closeDecision();
    if (decision === "commit") await window.proofApplyApi.commit(editor.value);
    if (decision === "discard") await window.proofApplyApi.discard();
  } finally {
    closeDecisionPending = false;
  }
});

async function initialize() {
  state = await window.proofApplyApi.load();
  editor.value = state?.text || "";
  previousText = editor.value;
  changes = Array.isArray(state?.changes)
    ? state.changes.map((change) => ({ ...change }))
    : [];
  activeIndex = changes.length ? 0 : -1;
  $("sourceState").textContent =
    `${state?.sourceName || "原稿"} — 反映前スナップショットを保存済み`;
  $("pdfName").textContent = state?.pdfName || "赤ゲラPDF";
  pdfPageCount = Math.max(1, Number(state?.pdfPageCount) || 1);
  if (state?.notice) {
    $("notice").textContent = state.notice;
    $("notice").hidden = false;
  }
  renderHighlights();
  updatePdfToolbar();
  showPdfPage(1);
  editor.focus();
}

initialize();
