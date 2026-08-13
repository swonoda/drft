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
  for (const part of diffChars(leftLine.text, rightLine.text)) {
    if (!part.added && !part.removed) {
      if (current?.removed) result.push(current);
      current = null;
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
  if (current?.removed) result.push(current);
  return result;
}

function buildProofreadChanges(left, right) {
  const normalizedLeft = left.replaceAll("\r\n", "\n");
  const normalizedRight = right.replaceAll("\r\n", "\n");
  const lineDiff = diffLines(normalizedLeft, normalizedRight);
  const deletions = [];
  let leftOffset = 0;
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
    deletions.push(...blockDeletions);
    leftOffset += removed.value.length;
    index += added ? 2 : 1;
  }
  return deletions.map((change, changeIndex) => ({
    id: changeIndex + 1,
    ...change,
    replacement: change.replacement || null,
    type: change.replacement ? "replace" : "delete",
  }));
}

module.exports = { buildDiffParts, buildProofreadChanges };
