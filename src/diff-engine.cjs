const { diffChars, diffLines, diffWordsWithSpace } = require("diff");

function buildDiffParts(left, right) {
  const changes = diffWordsWithSpace(
    left.replaceAll("\r\n", "\n"),
    right.replaceAll("\r\n", "\n"),
  );
  let changeId = 0;
  let insideChange = false;

  return changes.map((change, index) => {
    const changed = Boolean(change.added || change.removed);
    if (changed && !insideChange) changeId++;
    insideChange = changed;
    return {
      id: index,
      value: change.value,
      added: Boolean(change.added),
      removed: Boolean(change.removed),
      changeId: changed ? changeId : null,
    };
  });
}

function blockLines(value, startOffset = 0) {
  const lines = [];
  let cursor = 0;
  for (const raw of value.match(/[^\n]*(?:\n|$)/g) || []) {
    if (!raw) continue;
    const text = raw.endsWith("\n") ? raw.slice(0, -1) : raw;
    lines.push({
      text,
      start: startOffset + cursor,
      end: startOffset + cursor + text.length,
    });
    cursor += raw.length;
  }
  return lines;
}

function lineSimilarity(left, right) {
  const minimum = Math.min(left.length, right.length);
  if (!minimum) return left === right ? 1 : 0;
  const common = diffChars(left, right)
    .filter((part) => !part.added && !part.removed)
    .reduce((length, part) => length + part.value.length, 0);
  return common / minimum;
}

function alignRelatedLines(leftLines, rightLines) {
  const table = Array.from({ length: leftLines.length + 1 }, () =>
    Array(rightLines.length + 1).fill(0),
  );
  for (let i = 1; i <= leftLines.length; i++) {
    for (let j = 1; j <= rightLines.length; j++) {
      const related =
        lineSimilarity(leftLines[i - 1].text, rightLines[j - 1].text) >= 0.5;
      table[i][j] = related
        ? table[i - 1][j - 1] + 1
        : Math.max(table[i - 1][j], table[i][j - 1]);
    }
  }
  const pairs = [];
  let i = leftLines.length;
  let j = rightLines.length;
  while (i && j) {
    const related =
      lineSimilarity(leftLines[i - 1].text, rightLines[j - 1].text) >= 0.5;
    if (related && table[i][j] === table[i - 1][j - 1] + 1) {
      pairs.unshift([i - 1, j - 1]);
      i--;
      j--;
    } else if (table[i - 1][j] >= table[i][j - 1]) i--;
    else j--;
  }
  return pairs;
}

function lineChanges(leftLine, rightLine) {
  const result = [];
  let offset = leftLine.start;
  let current = null;
  const pushCurrent = () => {
    if (current && (current.removed || current.replacement)) {
      result.push(current);
    }
    current = null;
  };
  for (const part of diffChars(leftLine.text, rightLine.text)) {
    if (!part.added && !part.removed) {
      pushCurrent();
      offset += part.value.length;
      continue;
    }
    current ||= { start: offset, end: offset, removed: "", replacement: "" };
    if (part.removed) {
      current.removed += part.value;
      offset += part.value.length;
      current.end = offset;
    } else current.replacement += part.value;
  }
  pushCurrent();
  return result;
}

function comparisonUnits(text) {
  const units = [];
  const closingMarks = new Set([
    "」",
    "』",
    "）",
    "】",
    "〕",
    "〉",
    "》",
    "”",
    "’",
  ]);
  const pushUnit = (rawStart, rawEnd) => {
    let start = rawStart;
    let end = rawEnd;
    while (start < end && text[start] === "\n") start++;
    while (end > start && text[end - 1] === "\n") end--;
    if (start < end) units.push({ text: text.slice(start, end), start, end });
  };
  let start = 0;
  let index = 0;
  while (index < text.length) {
    if (text[index] === "\n" && text[index + 1] === "\n") {
      pushUnit(start, index);
      while (text[index] === "\n") index++;
      start = index;
      continue;
    }
    if (/[。！？!?]/u.test(text[index])) {
      index++;
      while (index < text.length && closingMarks.has(text[index])) index++;
      pushUnit(start, index);
      start = index;
      continue;
    }
    index++;
  }
  pushUnit(start, text.length);
  return units;
}

function alignRelatedUnits(leftUnits, rightUnits) {
  const table = Array.from({ length: leftUnits.length + 1 }, () =>
    Array(rightUnits.length + 1).fill(0),
  );
  const similarity = (leftIndex, rightIndex) =>
    lineSimilarity(leftUnits[leftIndex].text, rightUnits[rightIndex].text);
  for (let i = 1; i <= leftUnits.length; i++) {
    for (let j = 1; j <= rightUnits.length; j++) {
      const score = similarity(i - 1, j - 1);
      table[i][j] = Math.max(
        table[i - 1][j],
        table[i][j - 1],
        score >= 0.35 ? table[i - 1][j - 1] + score : -1,
      );
    }
  }
  const pairs = [];
  let i = leftUnits.length;
  let j = rightUnits.length;
  while (i && j) {
    const score = similarity(i - 1, j - 1);
    if (
      score >= 0.35 &&
      Math.abs(table[i][j] - (table[i - 1][j - 1] + score)) < 1e-9
    ) {
      pairs.unshift([i - 1, j - 1]);
      i--;
      j--;
    } else if (table[i - 1][j] >= table[i][j - 1]) i--;
    else j--;
  }
  return pairs;
}

function lineScopedChanges(left, right, initialLeftOffset = 0) {
  const lineDiff = diffLines(left, right);
  const deletions = [];
  let leftOffset = initialLeftOffset;
  let index = 0;
  while (index < lineDiff.length) {
    const part = lineDiff[index];
    if (!part.added && !part.removed) {
      leftOffset += part.value.length;
      index++;
      continue;
    }
    const removed = part.removed ? part : null;
    const addedIndex = index + (removed ? 1 : 0);
    const added = lineDiff[addedIndex]?.added ? lineDiff[addedIndex] : null;
    if (!removed && added) {
      for (const line of blockLines(added.value)) {
        if (!line.text) continue;
        deletions.push({
          start: leftOffset,
          end: leftOffset,
          removed: "",
          replacement: line.text,
        });
      }
      index++;
      continue;
    }
    if (!removed) {
      index++;
      continue;
    }
    const leftLines = blockLines(removed.value, leftOffset);
    const rightLines = blockLines(added?.value || "");
    const pairs = alignRelatedLines(leftLines, rightLines);
    const pairedLeft = new Set(pairs.map(([leftIndex]) => leftIndex));
    const pairedRight = new Set(pairs.map(([, rightIndex]) => rightIndex));
    const blockDeletions = [];
    for (const [leftIndex, rightIndex] of pairs) {
      blockDeletions.push(
        ...lineChanges(leftLines[leftIndex], rightLines[rightIndex]),
      );
    }
    for (const [leftIndex, line] of leftLines.entries()) {
      if (!pairedLeft.has(leftIndex) && line.text) {
        blockDeletions.push({
          start: line.start,
          end: line.end,
          removed: line.text,
          replacement: "",
        });
      }
    }
    blockDeletions.sort((a, b) => a.start - b.start);
    const additions = rightLines
      .filter((_, rightIndex) => !pairedRight.has(rightIndex))
      .map((line) => line.text)
      .filter(Boolean);
    const available = blockDeletions
      .filter((change) => !change.replacement)
      .slice(-additions.length);
    available.forEach((change, additionIndex) => {
      change.replacement = additions[additionIndex] || "";
    });
    for (const addition of additions.slice(available.length)) {
      blockDeletions.push({
        start: leftOffset + removed.value.length,
        end: leftOffset + removed.value.length,
        removed: "",
        replacement: addition,
      });
    }
    deletions.push(...blockDeletions);
    leftOffset += removed.value.length;
    index += added ? 2 : 1;
  }
  return deletions;
}

function buildProofreadChanges(left, right) {
  const normalizedLeft = left.replaceAll("\r\n", "\n");
  const normalizedRight = right.replaceAll("\r\n", "\n");
  const leftUnits = comparisonUnits(normalizedLeft);
  const rightUnits = comparisonUnits(normalizedRight);
  const anchors = alignRelatedUnits(leftUnits, rightUnits);
  const changes = [];
  let previousLeft = -1;
  let previousRight = -1;
  const processPair = (leftIndex, rightIndex) => {
    const leftUnit = leftUnits[leftIndex];
    const rightUnit = rightUnits[rightIndex];
    changes.push(
      ...lineScopedChanges(leftUnit.text, rightUnit.text, leftUnit.start),
    );
  };
  const processGap = (nextLeft, nextRight) => {
    const leftGap = [];
    const rightGap = [];
    for (let index = previousLeft + 1; index < nextLeft; index++) {
      leftGap.push(index);
    }
    for (let index = previousRight + 1; index < nextRight; index++) {
      rightGap.push(index);
    }
    const paired = Math.min(leftGap.length, rightGap.length);
    for (let index = 0; index < paired; index++) {
      processPair(leftGap[index], rightGap[index]);
    }
    for (const leftIndex of leftGap.slice(paired)) {
      const unit = leftUnits[leftIndex];
      changes.push({
        start: unit.start,
        end: unit.end,
        removed: unit.text,
        replacement: "",
      });
    }
    const insertionOffset =
      nextLeft < leftUnits.length
        ? leftUnits[nextLeft].start
        : previousLeft >= 0
          ? leftUnits[previousLeft].end
          : 0;
    for (const rightIndex of rightGap.slice(paired)) {
      changes.push({
        start: insertionOffset,
        end: insertionOffset,
        removed: "",
        replacement: rightUnits[rightIndex].text,
      });
    }
  };

  for (const [leftIndex, rightIndex] of anchors) {
    processGap(leftIndex, rightIndex);
    processPair(leftIndex, rightIndex);
    previousLeft = leftIndex;
    previousRight = rightIndex;
  }
  processGap(leftUnits.length, rightUnits.length);

  return changes
    .sort(
      (a, b) =>
        a.start - b.start ||
        a.end - b.end ||
        Number(Boolean(b.removed)) - Number(Boolean(a.removed)),
    )
    .map((change, changeIndex) => ({
      id: changeIndex + 1,
      ...change,
      replacement: change.replacement || null,
      type: !change.removed ? "add" : change.replacement ? "replace" : "delete",
    }));
}

module.exports = { buildDiffParts, buildProofreadChanges };
