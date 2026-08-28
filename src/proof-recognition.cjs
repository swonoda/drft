const { PNG } = require("pngjs");
const {
  extractPdfTextPage,
  pdfPageCount,
  renderPdfPagePng,
} = require("./pdf-layout.cjs");
const { locateProofMarks } = require("./opencv-proof-locator.cjs");

function redMask(pngBuffer) {
  const image = PNG.sync.read(pngBuffer);
  const mask = new Uint8Array(image.width * image.height);
  let pixels = 0;
  for (let index = 0; index < mask.length; index += 1) {
    const offset = index * 4;
    const red = image.data[offset];
    const green = image.data[offset + 1];
    const blue = image.data[offset + 2];
    if (red >= 115 && red - green >= 48 && red - blue >= 48) {
      mask[index] = 1;
      pixels += 1;
    }
  }
  return { width: image.width, height: image.height, mask, pixels };
}

function removeStraightRuns(image, minimum = 60) {
  const { width, height, mask } = image;
  const clearRun = (indexes) => {
    if (indexes.length < minimum) return;
    for (const index of indexes) mask[index] = 0;
  };
  for (let y = 0; y < height; y += 1) {
    let run = [];
    for (let x = 0; x <= width; x += 1) {
      const index = y * width + x;
      if (x < width && mask[index]) run.push(index);
      else {
        clearRun(run);
        run = [];
      }
    }
  }
  for (let x = 0; x < width; x += 1) {
    let run = [];
    for (let y = 0; y <= height; y += 1) {
      const index = y * width + x;
      if (y < height && mask[index]) run.push(index);
      else {
        clearRun(run);
        run = [];
      }
    }
  }
  return image;
}

function connectedComponents({ width, height, mask }) {
  const visited = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  const components = [];
  const neighbors = [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
  ];
  for (let seed = 0; seed < mask.length; seed += 1) {
    if (!mask[seed] || visited[seed]) continue;
    let head = 0;
    let tail = 1;
    queue[0] = seed;
    visited[seed] = 1;
    let left = seed % width;
    let right = left;
    let top = Math.floor(seed / width);
    let bottom = top;
    let pixels = 0;
    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = Math.floor(index / width);
      pixels += 1;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
      for (const [dx, dy] of neighbors) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const next = ny * width + nx;
        if (!mask[next] || visited[next]) continue;
        visited[next] = 1;
        queue[tail++] = next;
      }
    }
    if (pixels >= 3) components.push({ left, right, top, bottom, pixels });
  }
  return components;
}

function boxGap(left, right) {
  const x = Math.max(
    0,
    Math.max(left.left, right.left) - Math.min(left.right, right.right),
  );
  const y = Math.max(
    0,
    Math.max(left.top, right.top) - Math.min(left.bottom, right.bottom),
  );
  return { x, y };
}

function groupTextRegions(components, gap = 32) {
  const usable = components.filter((box) => {
    const width = box.right - box.left + 1;
    const height = box.bottom - box.top + 1;
    return !(
      (height > 100 && height > width * 8) ||
      (width > 100 && width > height * 8)
    );
  });
  const parent = usable.map((_, index) => index);
  const find = (index) => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  const union = (left, right) => {
    const a = find(left);
    const b = find(right);
    if (a !== b) parent[b] = a;
  };
  for (let left = 0; left < usable.length; left += 1) {
    for (let right = left + 1; right < usable.length; right += 1) {
      const distance = boxGap(usable[left], usable[right]);
      if (distance.x <= gap && distance.y <= gap) union(left, right);
    }
  }
  const regions = new Map();
  usable.forEach((box, index) => {
    const root = find(index);
    const region = regions.get(root) || { ...box };
    region.left = Math.min(region.left, box.left);
    region.right = Math.max(region.right, box.right);
    region.top = Math.min(region.top, box.top);
    region.bottom = Math.max(region.bottom, box.bottom);
    region.pixels = (region.pixels || 0) + (regions.has(root) ? box.pixels : 0);
    regions.set(root, region);
  });
  return [...regions.values()].filter((box) => {
    const width = box.right - box.left + 1;
    const height = box.bottom - box.top + 1;
    return (
      box.pixels >= 10 &&
      width >= 6 &&
      height >= 6 &&
      width <= 900 &&
      height <= 900
    );
  });
}

function cropMaskPng(image, bounds, padding = 14, scale = 2) {
  const left = Math.max(0, bounds.left - padding);
  const right = Math.min(image.width - 1, bounds.right + padding);
  const top = Math.max(0, bounds.top - padding);
  const bottom = Math.min(image.height - 1, bounds.bottom + padding);
  const width = right - left + 1;
  const height = bottom - top + 1;
  const output = new PNG({ width: width * scale, height: height * scale });
  output.data.fill(255);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!image.mask[(top + y) * image.width + left + x]) continue;
      for (let sy = 0; sy < scale; sy += 1) {
        for (let sx = 0; sx < scale; sx += 1) {
          const offset = ((y * scale + sy) * output.width + x * scale + sx) * 4;
          output.data[offset] = 0;
          output.data[offset + 1] = 0;
          output.data[offset + 2] = 0;
          output.data[offset + 3] = 255;
        }
      }
    }
  }
  return PNG.sync.write(output);
}

function cleanOcrText(text) {
  return typeof text === "string" ? text.replace(/[\s|｜]+/gu, "").trim() : "";
}

function compactCharacters(text) {
  const characters = [];
  const rawIndexes = [];
  let rawIndex = 0;
  for (const character of String(text || "")) {
    if (!/\s/u.test(character)) {
      characters.push(character);
      rawIndexes.push(rawIndex);
    }
    rawIndex += character.length;
  }
  return { characters, rawIndexes };
}

function uniqueSequenceIndex(haystack, needle) {
  if (!needle.length || needle.length > haystack.length) return -1;
  let found = -1;
  for (let index = 0; index <= haystack.length - needle.length; index += 1) {
    let matches = true;
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[index + offset] !== needle[offset]) {
        matches = false;
        break;
      }
    }
    if (!matches) continue;
    if (found >= 0) return -1;
    found = index;
  }
  return found;
}

function locateSourceRange(
  sourceText,
  word,
  targetPoint,
  contextWords = null,
  targetWordIndex = -1,
) {
  if (!word?.text) return null;
  const source = compactCharacters(sourceText);
  const target = compactCharacters(word.text).characters;

  let characterIndex = 0;
  if (target.length > 1 && targetPoint) {
    const vertical = word.height > word.width * 1.25;
    const origin = vertical ? word.top : word.left;
    const size = vertical ? word.height : word.width;
    const position = vertical ? targetPoint.y : targetPoint.x;
    const ratio = size > 0 ? (position - origin) / size : 0;
    characterIndex = Math.max(
      0,
      Math.min(target.length - 1, Math.floor(ratio * target.length)),
    );
  }

  let sequenceStart = -1;
  let targetOffset = 0;
  if (
    Array.isArray(contextWords) &&
    Number.isInteger(targetWordIndex) &&
    targetWordIndex >= 0 &&
    targetWordIndex < contextWords.length
  ) {
    // pdftotextは縦書き本文を一文字ずつwordへ分けることがある。
    // 一文字だけを原稿全体から探すと、偶然一意だった別の文字へ飛び得るため、
    // PDF上の前後語を連結した十分な長さの文脈で位置を確定する。
    const maximumRadius = Math.min(12, contextWords.length - 1);
    for (let radius = 0; radius <= maximumRadius; radius += 1) {
      const start = Math.max(0, targetWordIndex - radius);
      const end = Math.min(contextWords.length, targetWordIndex + radius + 1);
      const parts = contextWords
        .slice(start, end)
        .map((candidate) => compactCharacters(candidate?.text).characters);
      const context = parts.flat();
      if (context.length < 6) continue;
      const found = uniqueSequenceIndex(source.characters, context);
      if (found < 0) continue;
      sequenceStart = found;
      targetOffset = parts
        .slice(0, targetWordIndex - start)
        .reduce((total, characters) => total + characters.length, 0);
      break;
    }
    if (sequenceStart < 0 && target.length >= 2) {
      sequenceStart = uniqueSequenceIndex(source.characters, target);
    }
    if (sequenceStart < 0) return null;
  } else {
    sequenceStart = uniqueSequenceIndex(source.characters, target);
    if (sequenceStart < 0) return null;
  }

  const compactStart = sequenceStart + targetOffset + characterIndex;
  const draftStart = source.rawIndexes[compactStart];
  const character = source.characters[compactStart];
  return {
    draftStart,
    draftEnd: draftStart + character.length,
    matchedText: character,
  };
}

async function recognizeProofChanges(
  pdfPath,
  sourceText,
  {
    onProgress,
    countPages = pdfPageCount,
    renderPage = renderPdfPagePng,
    extractTextPage = extractPdfTextPage,
    locatePage = locateProofMarks,
  } = {},
) {
  const pages = await countPages(pdfPath);
  const notes = [];
  let redPages = 0;
  let pagesWithoutText = 0;
  for (let page = 1; page <= pages; page += 1) {
    onProgress?.({
      message: `${page} / ${pages}ページを画像化中`,
      percent: Math.round(((page - 1) / pages) * 100),
      page,
      pages,
    });
    const png = await renderPage(pdfPath, page, 300);
    const image = redMask(png);
    if (image.pixels >= 40) {
      redPages += 1;
      onProgress?.({
        message: `${page} / ${pages}ページの変更箇所を検出中`,
        percent: Math.round(((page - 0.5) / pages) * 100),
        page,
        pages,
      });
      let textPage = { words: [] };
      try {
        textPage = await extractTextPage(pdfPath, page);
      } catch {
        textPage = { words: [] };
      }
      if (!textPage.words?.length) pagesWithoutText += 1;
      const located = await locatePage(png, { words: textPage.words || [] });
      for (const location of located.locations || []) {
        const word = Number.isInteger(location.targetWordIndex)
          ? textPage.words[location.targetWordIndex]
          : null;
        const sourceRange = locateSourceRange(
          sourceText,
          word,
          location.targetPoint,
          textPage.words,
          location.targetWordIndex,
        );
        const number = notes.length + 1;
        notes.push({
          id: `location-${page}-${number}`,
          page,
          text: "",
          label: `変更箇所 ${number}`,
          bounds: location.bounds,
          targetBounds: location.targetBounds,
          targetPoint: location.targetPoint,
          confidence: Number(location.confidence) || 0,
          draftStart: sourceRange?.draftStart ?? null,
          draftEnd: sourceRange?.draftEnd ?? null,
          matchedText: sourceRange?.matchedText || "",
        });
      }
    }
    onProgress?.({
      message: `${page} / ${pages}ページの検出完了`,
      percent: Math.round((page / pages) * 100),
      page,
      pages,
    });
  }
  onProgress?.({ message: "変更箇所の検出が完了しました", percent: 100 });
  const mapped = notes.filter((note) =>
    Number.isInteger(note.draftStart),
  ).length;
  let notice;
  if (!redPages) {
    notice =
      "赤い書き込みのあるページは見つかりませんでした。本文は変更していません。";
  } else if (!notes.length) {
    notice =
      "赤字は見つかりましたが、変更箇所として分けられませんでした。本文は変更していません。";
  } else {
    notice = `変更箇所を${notes.length}件検出しました。${mapped}件は原稿中の候補位置まで特定できました。赤字の内容は手入力して確認してください。`;
    if (pagesWithoutText) {
      notice +=
        " PDFに文字情報がない箇所は原稿位置を自動選択できないため、左の原稿で選択してください。";
    }
  }
  return {
    changes: [],
    notes,
    notice,
  };
}

module.exports = {
  cleanOcrText,
  connectedComponents,
  cropMaskPng,
  groupTextRegions,
  locateSourceRange,
  recognizeProofChanges,
  redMask,
  removeStraightRuns,
};
