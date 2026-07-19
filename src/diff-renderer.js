const $ = (id) => document.getElementById(id);
const leftDocument = $("leftDocument");
const rightDocument = $("rightDocument");
let changeIds = [];
let currentChangeIndex = -1;
let syncingScroll = false;
let currentState = null;

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
