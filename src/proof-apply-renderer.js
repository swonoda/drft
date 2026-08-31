const $ = (id) => document.getElementById(id);
const editor = $("workingEditor");
const backdrop = $("highlightBackdrop");
const noteBackdrop = $("noteBackdrop");
const backdropLayers = [noteBackdrop, backdrop];
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
  const mappedNotes = notes.filter(
    (note) =>
      Number.isInteger(note.draftStart) && Number.isInteger(note.draftEnd),
  );
  const updated = new Map(
    window.proofApplyApi
      .updateChangeRanges(mappedNotes, before, after)
      .map((note) => [note.id, note]),
  );
  notes = notes.map((note) => updated.get(note.id) || note);
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

function syncBackdropGeometry() {
  const width = editor.clientWidth;
  const height = editor.clientHeight;
  if (!width || !height) return;
  for (const layer of backdropLayers) {
    layer.style.width = `${width}px`;
    layer.style.height = `${height}px`;
  }
}

function punctuationRangeAt(text, start, end = start) {
  const value = String(text || "");
  const boundary = /[、。！？!?\n]/u;
  const closer = /[」』）】》〉]/u;
  let rangeStart = Math.max(0, Math.min(value.length, start));
  let rangeEnd = Math.max(rangeStart, Math.min(value.length, end));
  while (rangeStart > 0 && !boundary.test(value[rangeStart - 1])) {
    rangeStart -= 1;
  }
  while (rangeEnd < value.length && !boundary.test(value[rangeEnd])) {
    rangeEnd += 1;
  }
  if (rangeEnd < value.length) rangeEnd += 1;
  while (rangeEnd < value.length && closer.test(value[rangeEnd])) {
    rangeEnd += 1;
  }
  return { start: rangeStart, end: rangeEnd };
}

function renderNoteHighlight() {
  noteBackdrop.replaceChildren();
  const note = noteForId(selectedNoteId);
  if (!Number.isInteger(note?.draftStart)) {
    noteBackdrop.textContent = editor.value;
  } else {
    const range = punctuationRangeAt(
      editor.value,
      note.draftStart,
      note.draftEnd,
    );
    const span = document.createElement("span");
    span.className = "proof-note-range";
    span.textContent = editor.value.slice(range.start, range.end) || "\u200b";
    noteBackdrop.append(
      document.createTextNode(editor.value.slice(0, range.start)),
      span,
      document.createTextNode(editor.value.slice(range.end)),
    );
  }
  noteBackdrop.scrollTop = editor.scrollTop;
  noteBackdrop.scrollLeft = editor.scrollLeft;
}

function renderHighlights() {
  syncBackdropGeometry();
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
  renderNoteHighlight();
  updateToolbar();
}

function noteChange(note, { includeReverted = false } = {}) {
  if (!note) return null;
  return [...changes]
    .reverse()
    .find(
      (change) =>
        change.groupId === note.id && (includeReverted || !change.reverted),
    );
}

function selectedNoteIndex() {
  return notes.findIndex((note) => note.id === selectedNoteId);
}

function updateToolbar() {
  const note = noteForId(selectedNoteId);
  const noteIndex = selectedNoteIndex();
  const change = noteChange(note);
  $("changeState").textContent = notes.length
    ? `${noteIndex + 1} / ${notes.length}`
    : "0 / 0";
  $("previousChange").disabled = notes.length === 0;
  $("nextChange").disabled = notes.length === 0;
  $("candidateText").disabled = !note;
  $("candidateText").readOnly = Boolean(change);
  $("candidateText").placeholder = note
    ? Number.isInteger(note.draftStart)
      ? "赤字の内容"
      : "赤字の内容（原稿位置は手動で選択）"
    : "変更箇所はありません";
  const displayedText = change
    ? change.replacement
    : typeof note?.text === "string"
      ? note.text
      : "";
  if ($("candidateText").value !== displayedText) {
    $("candidateText").value = displayedText;
  }
  $("applyCandidate").disabled = !note;
  const actionLabel = change ? "この変更を元に戻す" : "選択位置へ反映";
  $("applyCandidate").textContent = change ? "↶" : "✓";
  $("applyCandidate").title = actionLabel;
  $("applyCandidate").setAttribute("aria-label", actionLabel);
}

function selectRelativeNote(offset) {
  if (!notes.length) return;
  const current = Math.max(0, selectedNoteIndex());
  const next = (current + offset + notes.length) % notes.length;
  selectNote(notes[next].id);
}

function revertChange(note, change) {
  if (!change || change.reverted) return;
  const before = editor.value;
  const restoredStart = change.draftStart;
  const restoredEnd = restoredStart + change.original.length;
  const after =
    before.slice(0, change.draftStart) +
    change.original +
    before.slice(change.draftEnd);
  editor.value = after;
  updateRanges(before, after);
  const current = changes.find((candidate) => candidate.id === change.id);
  if (current) current.reverted = true;
  const currentNote = noteForId(note?.id);
  if (currentNote) currentNote.used = false;
  activeIndex = -1;
  previousText = after;
  manualEdits = true;
  window.proofApplyApi.updateDraft(after);
  editor.focus({ preventScroll: true });
  editor.setSelectionRange(restoredStart, restoredEnd);
  renderHighlights();
  renderNotes();
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
  noteBackdrop.scrollTop = editor.scrollTop;
  noteBackdrop.scrollLeft = editor.scrollLeft;
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
    if (changes[index].groupId && noteForId(changes[index].groupId)) {
      selectedNoteId = changes[index].groupId;
      renderNotes();
      renderNoteOverlay();
    }
    renderHighlights();
  }
});

if (typeof ResizeObserver === "function") {
  new ResizeObserver(() => renderHighlights()).observe(editor);
} else {
  window.addEventListener("resize", renderHighlights);
}

$("previousChange").onclick = () => selectRelativeNote(-1);
$("nextChange").onclick = () => selectRelativeNote(1);
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

function syncNoteUsage() {
  for (const note of notes) {
    note.used = Boolean(noteChange(note));
  }
}

function revealEditorRange(start, end = start) {
  const boundedStart = Math.max(0, Math.min(editor.value.length, start));
  const boundedEnd = Math.max(boundedStart, Math.min(editor.value.length, end));

  // setSelectionRangeだけでは、Electronが画面外の選択位置までtextareaを
  // スクロールしないことがある。同じ組版の背面要素で位置を測ってから、
  // 選択箇所が上から1/3付近へ来るよう明示的に移動する。
  const anchor = document.createElement("span");
  anchor.className = "proof-scroll-anchor";
  anchor.textContent = "\u200b";
  backdrop.replaceChildren(
    document.createTextNode(editor.value.slice(0, boundedStart)),
    anchor,
    document.createTextNode(editor.value.slice(boundedStart)),
  );
  const anchorTop = anchor.offsetTop;

  editor.focus({ preventScroll: true });
  editor.setSelectionRange(boundedStart, boundedEnd);
  const maximum = Math.max(0, editor.scrollHeight - editor.clientHeight);
  editor.scrollTop = Math.max(
    0,
    Math.min(maximum, anchorTop - editor.clientHeight / 3),
  );
  renderHighlights();
}

function noteDisplayBounds(note) {
  const boxes = [note?.bounds, note?.targetBounds].filter(Boolean);
  if (!boxes.length) return null;
  const left = Math.min(...boxes.map((box) => Number(box.left) || 0));
  const top = Math.min(...boxes.map((box) => Number(box.top) || 0));
  const right = Math.max(
    ...boxes.map((box) => (Number(box.left) || 0) + (Number(box.width) || 0)),
  );
  const bottom = Math.max(
    ...boxes.map((box) => (Number(box.top) || 0) + (Number(box.height) || 0)),
  );
  return { left, top, width: right - left, height: bottom - top };
}

function revealPdfNote(note) {
  if (!note || note.page !== pdfPage) return;
  const bounds = noteDisplayBounds(note);
  const canvas = $("proofPdfCanvas");
  const viewport = $("proofPdfViewport");
  if (!bounds || canvas.hidden || !canvas.clientWidth || !canvas.clientHeight)
    return;
  const centerX =
    canvas.offsetLeft + (bounds.left + bounds.width / 2) * canvas.clientWidth;
  const centerY =
    canvas.offsetTop + (bounds.top + bounds.height / 2) * canvas.clientHeight;
  viewport.scrollTo({
    left: Math.max(0, centerX - viewport.clientWidth / 2),
    top: Math.max(0, centerY - viewport.clientHeight / 2),
    behavior: "smooth",
  });
}

async function selectNote(id) {
  const note = noteForId(id);
  if (!note) return;
  selectedNoteId = id;
  const change = noteChange(note);
  activeIndex = change
    ? changes.findIndex((candidate) => candidate.id === change.id)
    : -1;
  updateToolbar();
  renderNotes();
  renderNoteOverlay();
  if (note.page !== pdfPage) await showPdfPage(note.page);
  else renderNoteOverlay();
  revealPdfNote(note);
  if (Number.isInteger(note.draftStart) && Number.isInteger(note.draftEnd)) {
    revealEditorRange(note.draftStart, note.draftEnd);
  }
}

function renderNotes() {
  const list = $("noteList");
  const previousScrollTop = list.scrollTop;
  list.replaceChildren();
  $("noteState").textContent = recognitionRunning
    ? "検出中…"
    : `${notes.length}件`;
  if (!notes.length && !recognitionRunning) {
    const empty = document.createElement("span");
    empty.className = "proof-pdf-title";
    empty.textContent =
      "変更箇所を検出できませんでした。PDFを見ながら直接入力できます。";
    list.append(empty);
    return;
  }
  let selectedButton = null;
  for (const note of notes) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "proof-note-item";
    if (note.id === selectedNoteId) {
      button.classList.add("selected");
      selectedButton = button;
    }
    if (note.used) button.classList.add("used");
    button.title = Number.isInteger(note.draftStart)
      ? "原稿位置の候補あり"
      : "原稿位置は未特定";
    const page = document.createElement("span");
    page.className = "page";
    page.textContent = `${note.page}p`;
    const text = document.createElement("span");
    text.className = "text";
    text.textContent = note.label;
    button.append(page, text);
    button.onclick = () => selectNote(note.id);
    list.append(button);
  }
  list.scrollTop = previousScrollTop;
  if (selectedButton) {
    const top =
      selectedButton.getBoundingClientRect().top -
      list.getBoundingClientRect().top +
      list.scrollTop;
    const bottom = top + selectedButton.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = bottom - list.clientHeight;
    }
  }
}

function renderNoteOverlay() {
  const overlay = $("proofNoteOverlay");
  overlay.replaceChildren();
  for (const note of notes.filter(
    (candidate) =>
      candidate.page === pdfPage &&
      (candidate.bounds || candidate.targetBounds),
  )) {
    if (note.bounds) {
      const marker = document.createElement("button");
      marker.type = "button";
      marker.className = "proof-note-marker annotation";
      if (note.id === selectedNoteId) marker.classList.add("selected");
      marker.style.left = `${note.bounds.left * 100}%`;
      marker.style.top = `${note.bounds.top * 100}%`;
      marker.style.width = `${note.bounds.width * 100}%`;
      marker.style.height = `${note.bounds.height * 100}%`;
      marker.title = note.label;
      marker.onclick = () => selectNote(note.id);
      overlay.append(marker);
    }
    if (note.targetBounds) {
      const target = document.createElement("button");
      target.type = "button";
      target.className = "proof-target-marker";
      if (note.id === selectedNoteId) target.classList.add("selected");
      target.style.left = `${note.targetBounds.left * 100}%`;
      target.style.top = `${note.targetBounds.top * 100}%`;
      target.style.width = `${note.targetBounds.width * 100}%`;
      target.style.height = `${note.targetBounds.height * 100}%`;
      target.title = `${note.label}が指している本文位置の候補`;
      target.onclick = () => selectNote(note.id);
      overlay.append(target);
    }
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
      `表示済み ${canvas.width}×${canvas.height}px・${payload.byteLength.toLocaleString()} bytes` +
      `（${payload.renderer || "PDF変換器不明"} → Canvas v3）`;
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
  requestAnimationFrame(() => revealPdfNote(noteForId(selectedNoteId)));
};
$("zoomInPdf").onclick = () => {
  pdfZoom = Math.min(2.4, Math.round((pdfZoom + 0.2) * 10) / 10);
  updatePdfToolbar();
  requestAnimationFrame(() => revealPdfNote(noteForId(selectedNoteId)));
};

function nextPendingNote(afterId) {
  if (!notes.length) return null;
  const start = Math.max(
    0,
    notes.findIndex((note) => note.id === afterId),
  );
  for (let offset = 1; offset <= notes.length; offset += 1) {
    const note = notes[(start + offset) % notes.length];
    if (!note.used && !noteChange(note)) return note;
  }
  return null;
}

$("candidateText").oninput = () => {
  const note = noteForId(selectedNoteId);
  if (note && !noteChange(note)) note.text = $("candidateText").value;
};

$("applyCandidate").onclick = async () => {
  const note = noteForId(selectedNoteId);
  if (!note) return;
  const applied = noteChange(note);
  if (applied) {
    revertChange(note, applied);
    return;
  }

  const selectionStart = editor.selectionStart;
  const selectionEnd = editor.selectionEnd;
  const replacement = $("candidateText").value;
  const type = window.proofApplyApi.inferChangeType(
    selectionStart,
    selectionEnd,
    replacement,
  );
  if (!type) {
    showNotice(
      "削除する文字を選択するか、追加する位置へカーソルを置いて赤字の内容を入力してください。",
    );
    return;
  }
  const start = selectionStart;
  const end = selectionEnd;
  const before = editor.value;
  const original = before.slice(start, end);
  const after = before.slice(0, start) + replacement + before.slice(end);
  updateRanges(before, after);
  const id = `manual-${Date.now()}-${changes.length + 1}`;
  const noteId = note.id;
  changes.push({
    id,
    groupId: noteId,
    type,
    original,
    replacement,
    draftStart: start,
    draftEnd: start + replacement.length,
    edited: false,
    reverted: false,
    label: replacement || original,
    confidence: note.confidence / 100,
    page: note.page,
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
  const currentNote = noteForId(noteId);
  if (currentNote) {
    currentNote.used = true;
    currentNote.text = replacement;
  }
  window.proofApplyApi.updateDraft(after);
  renderHighlights();
  renderNotes();
  const next = nextPendingNote(noteId);
  if (next) await selectNote(next.id);
  else editor.focus();
};

async function runRecognition() {
  if (recognitionRunning) return;
  recognitionRunning = true;
  $("recognizeButton").disabled = true;
  showProgress("赤い書き込みの変更箇所を検出する準備中…", 0);
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
    syncNoteUsage();
    selectedNoteId = notes[0]?.id || null;
    if (notes[0]) {
      selectNote(notes[0].id);
    }
    showProgress(result?.notice || "変更箇所の検出が完了しました。", 100);
  } catch (error) {
    hideProgress();
    showNotice(
      `変更箇所を検出できません: ${error.message}。PDFを見ながら手入力できます。`,
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
  syncNoteUsage();
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
  await showPdfPage(1);
  runRecognition();
  editor.focus();
}

initialize().catch((error) => {
  $("pdfStatus").textContent = `初期化エラー：${error.message}`;
  hideProgress();
  showNotice(`反映画面を初期化できません: ${error.message}`);
});
