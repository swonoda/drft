const { PNG } = require("pngjs");
const { createWorker, PSM } = require("tesseract.js");
const { pdfPageCount, renderPdfPagePng } = require("./pdf-layout.cjs");
const { unpackedAsarPath } = require("./packaged-path.cjs");

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

function languageOptions(language) {
  const data = require(`@tesseract.js-data/${language}`);
  return {
    langPath: unpackedAsarPath(data.langPath),
    gzip: data.gzip,
    cacheMethod: "none",
    workerPath: require.resolve("tesseract.js/src/worker-script/node/index.js"),
  };
}

function cleanOcrText(text) {
  return typeof text === "string" ? text.replace(/[\s|｜]+/gu, "").trim() : "";
}

async function recognizeRedNotes(pngBuffer, page, onProgress) {
  const image = removeStraightRuns(redMask(pngBuffer));
  if (image.pixels < 40) return [];
  const regions = groupTextRegions(connectedComponents(image))
    .sort((left, right) => left.top - right.top || left.left - right.left)
    .slice(0, 60);
  if (!regions.length) return [];
  const workers = new Map();
  const workerFor = async (language) => {
    if (!workers.has(language))
      workers.set(
        language,
        createWorker(language, 1, languageOptions(language)),
      );
    return workers.get(language);
  };
  const notes = [];
  try {
    for (let index = 0; index < regions.length; index += 1) {
      const bounds = regions[index];
      const width = bounds.right - bounds.left + 1;
      const height = bounds.bottom - bounds.top + 1;
      const vertical = height > width * 1.15;
      const worker = await workerFor(vertical ? "jpn_vert" : "jpn");
      await worker.setParameters({
        tessedit_pageseg_mode: vertical
          ? PSM.SINGLE_BLOCK_VERT_TEXT
          : PSM.SINGLE_BLOCK,
        preserve_interword_spaces: "0",
      });
      onProgress?.({
        message: `${page}ページ目の赤字 ${index + 1} / ${regions.length} を読取中`,
      });
      const result = await worker.recognize(cropMaskPng(image, bounds));
      const text = cleanOcrText(result?.data?.text);
      if (!text) continue;
      notes.push({
        id: `red-note-${page}-${index + 1}`,
        page,
        text,
        confidence: Math.max(
          0,
          Math.min(100, Number(result?.data?.confidence) || 0),
        ),
        bounds: {
          left: bounds.left / image.width,
          top: bounds.top / image.height,
          width: width / image.width,
          height: height / image.height,
        },
      });
    }
  } finally {
    await Promise.all(
      [...workers.values()].map(async (workerPromise) =>
        (await workerPromise).terminate(),
      ),
    );
  }
  return notes;
}

async function recognizeProofChanges(
  pdfPath,
  _sourceText,
  {
    onProgress,
    countPages = pdfPageCount,
    renderPage = renderPdfPagePng,
    recognizePage = recognizeRedNotes,
  } = {},
) {
  const pages = await countPages(pdfPath);
  const notes = [];
  let redPages = 0;
  for (let page = 1; page <= pages; page += 1) {
    onProgress?.({
      message: `${page} / ${pages}ページを画像化中`,
      page,
      pages,
    });
    const png = await renderPage(pdfPath, page, 220);
    const image = redMask(png);
    if (image.pixels < 40) continue;
    redPages += 1;
    notes.push(...(await recognizePage(png, page, onProgress)));
  }
  return {
    changes: [],
    notes,
    notice: redPages
      ? `赤い書き込みを${notes.length}件の候補に分けました。候補文字を確認し、左の選択位置へ追加・置換・削除してください。`
      : "赤い書き込みのあるページは見つかりませんでした。本文は変更していません。",
  };
}

module.exports = {
  cleanOcrText,
  connectedComponents,
  cropMaskPng,
  groupTextRegions,
  recognizeProofChanges,
  redMask,
  removeStraightRuns,
};
