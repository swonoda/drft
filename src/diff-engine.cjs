const { diffChars, diffWordsWithSpace } = require("diff");

const wordSegmenter =
  typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter("ja", { granularity: "word" })
    : null;

function wordBoundaries(text) {
  const boundaries = new Set([0, text.length]);
  if (!wordSegmenter) return boundaries;
  for (const segment of wordSegmenter.segment(text)) {
    boundaries.add(segment.index);
    boundaries.add(segment.index + segment.segment.length);
  }
  return boundaries;
}

function preservesWordBoundary(
  value,
  leftStart,
  rightStart,
  leftBoundaries,
  rightBoundaries,
) {
  if (/^[\s、。，．！？!?「」『』（）()【】〔〕〈〉《》]+$/u.test(value)) {
    return true;
  }
  return (
    leftBoundaries.has(leftStart) &&
    leftBoundaries.has(leftStart + value.length) &&
    rightBoundaries.has(rightStart) &&
    rightBoundaries.has(rightStart + value.length)
  );
}

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

function parseRubyDocument(input) {
  const text = String(input || "");
  const annotations = [];
  const boundaries = [0];
  let visibleText = "";
  let rawCursor = 0;
  const pattern =
    /([｜|])([^《\n]+)《([^》\n]+)》|([\p{Script=Han}々〆ヵヶ]+)《([^》\n]+)》/gu;

  const appendRaw = (start, end) => {
    for (let index = start; index < end; index++) {
      if (!Number.isInteger(boundaries[visibleText.length])) {
        boundaries[visibleText.length] = index;
      }
      visibleText += text[index];
      boundaries[visibleText.length] = index + 1;
    }
  };

  let match;
  while ((match = pattern.exec(text))) {
    appendRaw(rawCursor, match.index);
    const explicit = Boolean(match[1]);
    const base = explicit ? match[2] : match[4];
    const reading = explicit ? match[3] : match[5];
    const baseStart = match.index + (explicit ? match[1].length : 0);
    const baseEnd = baseStart + base.length;
    const visibleStart = visibleText.length;
    appendRaw(baseStart, baseEnd);
    annotations.push({
      base,
      reading,
      rawBaseStart: baseStart,
      rawBaseEnd: baseEnd,
      rawStart: match.index,
      rawEnd: match.index + match[0].length,
      visibleStart,
      visibleEnd: visibleText.length,
    });
    rawCursor = match.index + match[0].length;
  }
  appendRaw(rawCursor, text.length);
  return { text: visibleText, annotations, boundaries };
}

function unchangedBoundaryMap(left, right) {
  const result = new Map();
  let leftOffset = 0;
  let rightOffset = 0;
  for (const part of diffChars(left, right)) {
    if (!part.added && !part.removed) {
      for (let offset = 0; offset <= part.value.length; offset++) {
        result.set(leftOffset + offset, rightOffset + offset);
      }
      leftOffset += part.value.length;
      rightOffset += part.value.length;
    } else if (part.removed) leftOffset += part.value.length;
    else rightOffset += part.value.length;
  }
  return result;
}

function rubyReadingChanges(leftAnnotation, rightAnnotation, anchor) {
  const oldReading = leftAnnotation?.reading || "";
  const newReading = rightAnnotation?.reading || "";
  const changes = [];
  let oldOffset = 0;
  let current = null;
  const pushCurrent = () => {
    if (!current || (!current.removed && !current.replacement)) return;
    changes.push({
      ...anchor,
      removed: current.removed,
      replacement: current.replacement || null,
      type: !current.removed
        ? "ruby-add"
        : current.replacement
          ? "ruby-replace"
          : "ruby-delete",
      rubyBase: leftAnnotation?.base || rightAnnotation?.base || "",
      rubyStart: current.start,
      rubyEnd: current.end,
    });
    current = null;
  };

  for (const part of diffChars(oldReading, newReading)) {
    if (!part.added && !part.removed) {
      pushCurrent();
      oldOffset += part.value.length;
      continue;
    }
    current ||= {
      start: oldOffset,
      end: oldOffset,
      removed: "",
      replacement: "",
    };
    if (part.removed) {
      current.removed += part.value;
      oldOffset += part.value.length;
      current.end = oldOffset;
    } else current.replacement += part.value;
  }
  pushCurrent();
  if (changes.length > 1 && oldReading && newReading) {
    return [
      {
        ...anchor,
        removed: oldReading,
        replacement: newReading,
        type: "ruby-replace",
        rubyBase: leftAnnotation?.base || rightAnnotation?.base || "",
        rubyStart: 0,
        rubyEnd: oldReading.length,
      },
    ];
  }
  return changes;
}

function lineSimilarity(left, right) {
  const minimum = Math.min(left.length, right.length);
  if (!minimum) return left === right ? 1 : 0;
  const common = diffChars(left, right)
    .filter((part) => !part.added && !part.removed)
    .reduce((length, part) => length + part.value.length, 0);
  return common / minimum;
}

function lineChanges(leftLine, rightLine) {
  if (leftLine.text === rightLine.text) return [];
  const result = [];
  let offset = leftLine.start;
  let leftOffset = 0;
  let rightOffset = 0;
  let current = null;
  const parts = diffChars(leftLine.text, rightLine.text);
  const leftBoundaries = wordBoundaries(leftLine.text);
  const rightBoundaries = wordBoundaries(rightLine.text);
  const pushCurrent = () => {
    if (current && (current.removed || current.replacement)) {
      result.push(current);
    }
    current = null;
  };
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    if (!part.added && !part.removed) {
      const next = parts[index + 1];
      const absorbCommonText =
        current &&
        next &&
        (next.added || next.removed) &&
        !preservesWordBoundary(
          part.value,
          leftOffset,
          rightOffset,
          leftBoundaries,
          rightBoundaries,
        );
      if (absorbCommonText) {
        current.removed += part.value;
        current.replacement += part.value;
        current.end += part.value.length;
      } else {
        pushCurrent();
      }
      offset += part.value.length;
      leftOffset += part.value.length;
      rightOffset += part.value.length;
      continue;
    }
    current ||= { start: offset, end: offset, removed: "", replacement: "" };
    if (part.removed) {
      current.removed += part.value;
      offset += part.value.length;
      leftOffset += part.value.length;
      current.end = offset;
    } else {
      current.replacement += part.value;
      rightOffset += part.value.length;
    }
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
    if (text[index] === "\n") {
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

function buildTextProofreadChanges(left, right) {
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
    changes.push(...lineChanges(leftUnit, rightUnit));
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
    const addedUnits = rightGap.slice(paired);
    if (addedUnits.length) {
      const firstUnit = rightUnits[addedUnits[0]];
      const lastUnit = rightUnits[addedUnits.at(-1)];
      changes.push({
        start: insertionOffset,
        end: insertionOffset,
        removed: "",
        replacement: normalizedRight.slice(firstUnit.start, lastUnit.end),
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
    .map((change) => ({
      ...change,
      replacement: change.replacement || null,
      type: !change.removed ? "add" : change.replacement ? "replace" : "delete",
    }));
}

function buildProofreadChanges(left, right) {
  const normalizedLeft = left.replaceAll("\r\n", "\n");
  const normalizedRight = right.replaceAll("\r\n", "\n");
  const leftDocument = parseRubyDocument(normalizedLeft);
  const rightDocument = parseRubyDocument(normalizedRight);
  const changes = buildTextProofreadChanges(
    leftDocument.text,
    rightDocument.text,
  ).map((change) => ({
    ...change,
    start: leftDocument.boundaries[change.start] ?? change.start,
    end: leftDocument.boundaries[change.end] ?? change.end,
  }));

  const leftToRight = unchangedBoundaryMap(
    leftDocument.text,
    rightDocument.text,
  );
  const rightToLeft = unchangedBoundaryMap(
    rightDocument.text,
    leftDocument.text,
  );
  const matchedRight = new Set();

  for (const leftAnnotation of leftDocument.annotations) {
    const rightStart = leftToRight.get(leftAnnotation.visibleStart);
    const rightEnd = leftToRight.get(leftAnnotation.visibleEnd);
    if (!Number.isInteger(rightStart) || !Number.isInteger(rightEnd)) continue;
    const rightAnnotation = rightDocument.annotations.find(
      (candidate, index) =>
        !matchedRight.has(index) &&
        candidate.visibleStart === rightStart &&
        candidate.visibleEnd === rightEnd &&
        candidate.base === leftAnnotation.base,
    );
    if (rightAnnotation) {
      matchedRight.add(rightDocument.annotations.indexOf(rightAnnotation));
    }
    changes.push(
      ...rubyReadingChanges(leftAnnotation, rightAnnotation, {
        start: leftAnnotation.rawBaseStart,
        end: leftAnnotation.rawBaseEnd,
      }),
    );
  }

  rightDocument.annotations.forEach((rightAnnotation, index) => {
    if (matchedRight.has(index)) return;
    const leftStart = rightToLeft.get(rightAnnotation.visibleStart);
    const leftEnd = rightToLeft.get(rightAnnotation.visibleEnd);
    if (!Number.isInteger(leftStart) || !Number.isInteger(leftEnd)) return;
    if (leftDocument.text.slice(leftStart, leftEnd) !== rightAnnotation.base) {
      return;
    }
    changes.push(
      ...rubyReadingChanges(null, rightAnnotation, {
        start: leftDocument.boundaries[leftStart] ?? leftStart,
        end: leftDocument.boundaries[leftEnd] ?? leftEnd,
      }),
    );
  });

  return changes
    .sort(
      (leftChange, rightChange) =>
        leftChange.start - rightChange.start ||
        leftChange.end - rightChange.end ||
        Number(leftChange.rubyStart || 0) - Number(rightChange.rubyStart || 0),
    )
    .map((change, index) => ({ id: index + 1, ...change }));
}

module.exports = {
  buildDiffParts,
  buildProofreadChanges,
  parseRubyDocument,
};
