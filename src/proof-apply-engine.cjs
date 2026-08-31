function normalizedChange(change, index, sourceLength) {
  const start = Number(change?.start);
  const end = Number(change?.end);
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    throw new TypeError(`変更 ${index + 1} の位置が不正です`);
  }
  if (start < 0 || end < start || end > sourceLength) {
    throw new RangeError(`変更 ${index + 1} の範囲が本文外です`);
  }
  return {
    id: String(change.id || `proof-change-${index + 1}`),
    groupId: change.groupId ? String(change.groupId) : null,
    type:
      change.type === "addition" ||
      change.type === "deletion" ||
      change.type === "replacement" ||
      change.type === "other"
        ? change.type
        : start === end
          ? "addition"
          : change.replacement
            ? "replacement"
            : "deletion",
    start,
    end,
    original: typeof change.original === "string" ? change.original : undefined,
    replacement:
      typeof change.replacement === "string" ? change.replacement : "",
    label: typeof change.label === "string" ? change.label : "",
    confidence: Number.isFinite(Number(change.confidence))
      ? Number(change.confidence)
      : null,
  };
}

function buildProofDraft(source, proposedChanges = []) {
  const text = typeof source === "string" ? source : "";
  const changes = proposedChanges
    .map((change, index) => normalizedChange(change, index, text.length))
    .sort((left, right) => left.start - right.start || left.end - right.end);

  let sourceCursor = 0;
  let draft = "";
  const mapped = [];
  for (const change of changes) {
    if (change.start < sourceCursor) {
      throw new RangeError("重なっている校正候補は同時に反映できません");
    }
    const actual = text.slice(change.start, change.end);
    if (change.original !== undefined && change.original !== actual) {
      throw new Error(
        `校正候補「${change.label || change.id}」の元文字列が一致しません`,
      );
    }
    draft += text.slice(sourceCursor, change.start);
    const draftStart = draft.length;
    draft += change.replacement;
    mapped.push({
      ...change,
      original: actual,
      draftStart,
      draftEnd: draft.length,
      edited: false,
    });
    sourceCursor = change.end;
  }
  draft += text.slice(sourceCursor);
  return { text: draft, changes: mapped };
}

function findSingleEdit(before, after) {
  if (before === after) return null;
  let start = 0;
  const shared = Math.min(before.length, after.length);
  while (start < shared && before[start] === after[start]) start += 1;

  let beforeEnd = before.length;
  let afterEnd = after.length;
  while (
    beforeEnd > start &&
    afterEnd > start &&
    before[beforeEnd - 1] === after[afterEnd - 1]
  ) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }
  return { start, beforeEnd, afterEnd, delta: after.length - before.length };
}

function updateProofChangeRanges(changes, before, after) {
  const edit = findSingleEdit(before, after);
  if (!edit) return changes.map((change) => ({ ...change }));

  return changes.map((change) => {
    let draftStart = change.draftStart;
    let draftEnd = change.draftEnd;
    let edited = Boolean(change.edited);

    if (draftEnd <= edit.start) {
      return { ...change, draftStart, draftEnd, edited };
    }
    if (draftStart >= edit.beforeEnd) {
      return {
        ...change,
        draftStart: draftStart + edit.delta,
        draftEnd: draftEnd + edit.delta,
        edited,
      };
    }

    edited = true;
    draftStart = Math.min(draftStart, edit.start);
    if (change.draftStart === change.draftEnd) {
      draftEnd = draftStart;
    } else if (change.draftEnd > edit.beforeEnd) {
      draftEnd = change.draftEnd + edit.delta;
    } else {
      draftEnd = edit.afterEnd;
    }
    return { ...change, draftStart, draftEnd, edited };
  });
}

function inferProofChangeType(selectionStart, selectionEnd, replacement) {
  const start = Number(selectionStart);
  const end = Number(selectionEnd);
  const text = typeof replacement === "string" ? replacement : "";
  if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) {
    throw new TypeError("原稿の選択位置が不正です");
  }
  if (start === end) return text ? "addition" : null;
  return text ? "replacement" : "deletion";
}

module.exports = {
  buildProofDraft,
  findSingleEdit,
  inferProofChangeType,
  updateProofChangeRanges,
};
