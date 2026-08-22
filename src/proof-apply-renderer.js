const $ = (id) => document.getElementById(id);
const editor = $("workingEditor");
const backdrop = $("highlightBackdrop");
let state;
let changes = [];
let notes = [];
let activeIndex = -1;
let selectedNoteId = null;
let previousText = "";
let manualEdits = false;
let recognitionRunning = false;
let pdfPage = 1;
let pdfPageCount = 1;
let pdfZoom = 1;
let pdfLoadToken = 0;

function showNotice(message) {
  $("noticeText").textContent = message;
  $("notice").hidden = false;
}

function showProgress(message, percent) {
  showNotice(message);
  const value = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
  $("recognitionProgress").value = value;
  $("progressPercent").textContent = `${value}%`;
  $("progressRow").hidden = false;
}

function hideProgress() {
  $("progressRow").hidden = true;
}

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
  if (change.type === "replacement")
    return `置換：${change.original} → ${change.replacement}`;
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
  if (change.page && change.page !== pdfPage) showPdfPage(change.page);
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
  manualEdits = true;
  window.proofApplyApi.updateDraft(after);
  renderHighlights();
}

editor.addEventListener("input", () => {
  updateRanges(previousText, editor.value);
  previousText = editor.value;
  manualEdits = true;
  window.proofApplyApi.updateDraft(editor.value);
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
$("commitButton").onclick = async () => {
  $("commitButton").disabled = true;
  try {
    await window.proofApplyApi.commit(editor.value);
  } catch (error) {
    showNotice(`本原稿へ反映できません: ${error.message}`);
    $("commitButton").disabled = false;
  }
};
$("discardButton").onclick = async () => {
  $("discardButton").disabled = true;
  try {
    await window.proofApplyApi.discard();
  } catch (error) {
    showNotice(`画面を閉じられません: ${error.message}`);
    $("discardButton").disabled = false;
  }
};

function updatePdfToolbar() {
  $("pdfPageState").textContent = `${pdfPage} / ${pdfPageCount}`;
  $("previousPdfPage").disabled = pdfPage <= 1;
  $("nextPdfPage").disabled = pdfPage >= pdfPageCount;
  $("pdfZoomState").textContent = `${Math.round(pdfZoom * 100)}%`;
  $("zoomOutPdf").disabled = pdfZoom <= 0.6;
  $("zoomInPdf").disabled = pdfZoom >= 2.4;
  $("proofPdfCanvas").style.width = `${pdfZoom * 100}%`;
}

function noteForId(id) {
  return notes.find((note) => note.id === id);
}

function selectNote(id) {
  const note = noteForId(id);
  if (!note) return;
  selectedNoteId = id;
  $("candidateText").value = note.text;
  if (/トル|削除/u.test(note.text)) $("candidateType").value = "deletion";
  updateCandidateControls();
  renderNotes();
  renderNoteOverlay();
  if (note.page !== pdfPage) showPdfPage(note.page);
}

function renderNotes() {
  const list = $("noteList");
  list.replaceChildren();
  $("noteState").textContent = recognitionRunning
    ? "読取中…"
    : `${notes.length}件`;
  if (!notes.length && !recognitionRunning) {
    const empty = document.createElement("span");
    empty.className = "proof-pdf-title";
    empty.textContent =
      "候補はありません。PDFを見ながら赤字の内容を直接入力できます。";
    list.append(empty);
    return;
  }
  for (const note of notes) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "proof-note-item";
    if (note.id === selectedNoteId) button.classList.add("selected");
    if (note.used) button.classList.add("used");
    button.title = `OCR確信度 ${Math.round(note.confidence)}%`;
    const page = document.createElement("span");
    page.className = "page";
    page.textContent = `${note.page}p`;
    const text = document.createElement("span");
    text.className = "text";
    text.textContent = note.text;
    button.append(page, text);
    button.onclick = () => selectNote(note.id);
    list.append(button);
  }
}

function renderNoteOverlay() {
  const overlay = $("proofNoteOverlay");
  overlay.replaceChildren();
  for (const note of notes.filter(
    (candidate) => candidate.page === pdfPage && candidate.bounds,
  )) {
    const marker = document.createElement("button");
    marker.type = "button";
    marker.className = "proof-note-marker";
    if (note.id === selectedNoteId) marker.classList.add("selected");
    marker.style.left = `${note.bounds.left * 100}%`;
    marker.style.top = `${note.bounds.top * 100}%`;
    marker.style.width = `${note.bounds.width * 100}%`;
    marker.style.height = `${note.bounds.height * 100}%`;
    marker.title = note.text;
    marker.onclick = () => selectNote(note.id);
    overlay.append(marker);
  }
}

async function showPdfPage(pageNumber) {
  pdfPage = Math.max(1, Math.min(pdfPageCount, pageNumber));
  const token = ++pdfLoadToken;
  const canvas = $("proofPdfPage");
  const message = $("pdfLoading");
  message.textContent = `PDF ${pdfPage}ページ目を読み込み中…`;
  $("pdfStatus").textContent = `PDFを画像へ変換中… 10%（Canvas v3）`;
  message.hidden = false;
  $("proofPdfCanvas").hidden = true;
  updatePdfToolbar();
  try {
    const payload = await window.proofApplyApi.pdfPage(pdfPage);
    if (token !== pdfLoadToken) return;
    $("pdfStatus").textContent = `画像データを検査中… 40%（Canvas v3）`;
    if (!payload?.base64 || !Number.isInteger(payload.byteLength)) {
      throw new Error("PDF画像のデータを受け取れませんでした。");
    }
    const binary = atob(payload.base64);
    if (binary.length !== payload.byteLength) {
      throw new Error("PDF画像のデータが途中で欠けています。");
    }
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    $("pdfStatus").textContent = `画像を復元中… 70%（Canvas v3）`;
    const bitmap = await createImageBitmap(
      new Blob([bytes], { type: payload.mimeType || "image/png" }),
    );
    if (token !== pdfLoadToken) {
      bitmap.close();
      return;
    }
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) {
      bitmap.close();
      throw new Error("PDF描画用のキャンバスを作成できませんでした。");
    }
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    $("pdfStatus").textContent = `画面へ描画中… 90%（Canvas v3）`;
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    $("proofPdfCanvas").hidden = false;
    message.hidden = true;
    $("pdfStatus").textContent =
      `表示済み ${canvas.width}×${canvas.height}px・${payload.byteLength.toLocaleString()} bytes（Canvas v3）`;
    renderNoteOverlay();
    $("proofPdfViewport").scrollTo({ top: 0, left: 0 });
  } catch (error) {
    if (token !== pdfLoadToken) return;
    canvas.width = 0;
    canvas.height = 0;
    $("proofPdfCanvas").hidden = true;
    message.textContent = `PDFを表示できません: ${error.message}`;
    $("pdfStatus").textContent = `表示エラー（Canvas v3）：${error.message}`;
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

function updateCandidateControls() {
  const type = $("candidateType").value;
  $("candidateText").disabled = type === "deletion" || type === "other";
  $("applyCandidate").textContent =
    type === "other" ? "確認済みにする" : "選択位置へ反映";
}

$("candidateType").onchange = updateCandidateControls;
$("applyCandidate").onclick = () => {
  const type = $("candidateType").value;
  const note = noteForId(selectedNoteId);
  if (type === "other") {
    if (note) note.used = true;
    renderNotes();
    return;
  }
  const selectionStart = editor.selectionStart;
  const selectionEnd = editor.selectionEnd;
  const start = selectionStart;
  const end = type === "addition" ? selectionStart : selectionEnd;
  if (type !== "addition" && end <= start) {
    $("candidateHint").textContent =
      "置換・削除する元の文字を左の原稿で選択してください";
    return;
  }
  const replacement = type === "deletion" ? "" : $("candidateText").value;
  if (type !== "deletion" && !replacement) {
    $("candidateHint").textContent = "赤字の内容を入力してください";
    return;
  }
  const before = editor.value;
  const original = before.slice(start, end);
  const after = before.slice(0, start) + replacement + before.slice(end);
  updateRanges(before, after);
  const id = `manual-${Date.now()}-${changes.length + 1}`;
  changes.push({
    id,
    groupId: note?.id || null,
    type,
    original,
    replacement,
    draftStart: start,
    draftEnd: start + replacement.length,
    edited: false,
    reverted: false,
    label: note?.text || replacement,
    confidence: note ? note.confidence / 100 : null,
    page: note?.page || pdfPage,
  });
  changes.sort(
    (left, right) =>
      left.draftStart - right.draftStart || left.draftEnd - right.draftEnd,
  );
  activeIndex = changes.findIndex((change) => change.id === id);
  editor.value = after;
  editor.setSelectionRange(start, start + replacement.length);
  previousText = after;
  manualEdits = true;
  if (note) note.used = true;
  window.proofApplyApi.updateDraft(after);
  $("candidateHint").textContent =
    "仮反映しました。背景色の付いた箇所はそのまま直接編集できます";
  renderHighlights();
  renderNotes();
  editor.focus();
};

async function runRecognition() {
  if (recognitionRunning) return;
  recognitionRunning = true;
  $("recognizeButton").disabled = true;
  showProgress("赤い書き込みの読取準備中…", 0);
  renderNotes();
  try {
    const result = await window.proofApplyApi.recognize();
    if (!manualEdits && typeof result?.text === "string") {
      editor.value = result.text;
      previousText = result.text;
      changes = Array.isArray(result.changes)
        ? result.changes.map((change) => ({ ...change }))
        : [];
      activeIndex = changes.length ? 0 : -1;
      window.proofApplyApi.updateDraft(editor.value);
    }
    notes = Array.isArray(result?.notes)
      ? result.notes.map((note) => ({ ...note }))
      : [];
    selectedNoteId = notes[0]?.id || null;
    if (notes[0]) $("candidateText").value = notes[0].text;
    showProgress(result?.notice || "赤字の読み取りが完了しました。", 100);
  } catch (error) {
    hideProgress();
    showNotice(
      `赤字を読み取れません: ${error.message}。PDFを見ながら手入力できます。`,
    );
  } finally {
    recognitionRunning = false;
    $("recognizeButton").disabled = false;
    renderHighlights();
    renderNotes();
    renderNoteOverlay();
  }
}

$("recognizeButton").onclick = runRecognition;
if (window.proofApplyApi) {
  window.proofApplyApi.onRecognitionProgress((progress) => {
    if (recognitionRunning && progress?.message) {
      showProgress(progress.message, progress.percent);
    }
  });
}

async function initialize() {
  if (!window.proofApplyApi) {
    throw new Error(
      "ゲラ画面の事前処理を読み込めませんでした。アプリを終了し、npm startで起動し直してください。",
    );
  }
  $("pdfStatus").textContent = "画面を初期化中… 0%（Canvas v3）";
  state = await window.proofApplyApi.load();
  editor.value = state?.text || "";
  previousText = editor.value;
  changes = Array.isArray(state?.changes)
    ? state.changes.map((change) => ({ ...change }))
    : [];
  notes = Array.isArray(state?.notes)
    ? state.notes.map((note) => ({ ...note }))
    : [];
  manualEdits =
    changes.length > 0 || editor.value !== (state?.sourceText || editor.value);
  activeIndex = changes.length ? 0 : -1;
  $("sourceState").textContent =
    `${state?.sourceName || "原稿"} — 反映前スナップショットを保存済み`;
  $("pdfName").textContent = state?.pdfName || "赤ゲラPDF";
  pdfPageCount = Math.max(1, Number(state?.pdfPageCount) || 1);
  showNotice(state?.notice || "PDFを読み込みました。");
  renderHighlights();
  renderNotes();
  updatePdfToolbar();
  updateCandidateControls();
  await showPdfPage(1);
  runRecognition();
  editor.focus();
}

initialize().catch((error) => {
  $("pdfStatus").textContent = `初期化エラー：${error.message}`;
  hideProgress();
  showNotice(`反映画面を初期化できません: ${error.message}`);
});
