const test = require("node:test");
const assert = require("node:assert/strict");
const { PNG } = require("pngjs");
const {
  locateSourceRange,
  recognizeProofChanges,
  redMask,
} = require("../src/proof-recognition.cjs");

function imageWithPixel({ red = false } = {}) {
  const png = new PNG({ width: 20, height: 20 });
  png.data.fill(255);
  if (red) {
    for (let y = 2; y < 18; y += 1) {
      for (let x = 2; x < 18; x += 1) {
        const offset = (y * png.width + x) * 4;
        png.data[offset] = 230;
        png.data[offset + 1] = 20;
        png.data[offset + 2] = 20;
        png.data[offset + 3] = 255;
      }
    }
  }
  return PNG.sync.write(png);
}

test("赤い画素だけを変更箇所の検出対象にする", () => {
  assert.equal(redMask(imageWithPixel()).pixels, 0);
  assert.equal(redMask(imageWithPixel({ red: true })).pixels, 256);
});

test("PDFの完全一致文字列から原稿位置を求める", () => {
  assert.deepEqual(
    locateSourceRange(
      "前文。サイドミラーがへし折られていた。後文。",
      {
        text: "サイドミラーが",
        left: 0.2,
        top: 0.1,
        width: 0.1,
        height: 0.6,
      },
      { x: 0.25, y: 0.55 },
    ),
    { draftStart: 8, draftEnd: 9, matchedText: "ー" },
  );
});

test("PDF文字列が原稿中で一意でなければ位置を推測しない", () => {
  assert.equal(
    locateSourceRange(
      "同じ語と同じ語",
      { text: "同じ語", left: 0, top: 0, width: 1, height: 1 },
      { x: 0.5, y: 0.5 },
    ),
    null,
  );
});

test("赤字のないPDFは本文を推測で変更しない", async () => {
  let locateCalls = 0;
  const result = await recognizeProofChanges(
    "赤ゲラ.pdf",
    "文章はそのまま保持する。",
    {
      countPages: async () => 1,
      renderPage: async () => imageWithPixel(),
      locatePage: async () => {
        locateCalls += 1;
        return { locations: [] };
      },
    },
  );

  assert.deepEqual(result.changes, []);
  assert.deepEqual(result.notes, []);
  assert.equal(locateCalls, 0);
  assert.match(result.notice, /本文は変更していません/);
});

test("OpenCVの変更箇所とPDF文字位置を原稿候補として返す", async () => {
  const word = {
    text: "原稿",
    left: 0.4,
    top: 0.2,
    width: 0.05,
    height: 0.2,
  };
  const result = await recognizeProofChanges("赤ゲラ.pdf", "これは原稿です", {
    countPages: async () => 1,
    renderPage: async () => imageWithPixel({ red: true }),
    extractTextPage: async () => ({ words: [word] }),
    locatePage: async () => ({
      locations: [
        {
          bounds: { left: 0.3, top: 0.1, width: 0.2, height: 0.5 },
          targetBounds: word,
          targetPoint: { x: 0.42, y: 0.25 },
          targetWordIndex: 0,
          confidence: 80,
        },
      ],
    }),
  });

  assert.deepEqual(result.changes, []);
  assert.equal(result.notes.length, 1);
  assert.equal(result.notes[0].text, "");
  assert.equal(result.notes[0].matchedText, "原");
  assert.equal(result.notes[0].draftStart, 3);
  assert.match(result.notice, /1件/);
});

test("OpenCVは赤字ページでだけ起動し、文字認識結果を作らない", async () => {
  let locateCalls = 0;
  const result = await recognizeProofChanges("赤ゲラ.pdf", "元原稿", {
    countPages: async () => 2,
    renderPage: async (_pdfPath, page) => imageWithPixel({ red: page === 2 }),
    extractTextPage: async () => ({ words: [] }),
    locatePage: async () => {
      locateCalls += 1;
      return {
        locations: [
          {
            bounds: { left: 0.1, top: 0.1, width: 0.1, height: 0.1 },
            confidence: 0,
          },
        ],
      };
    },
  });

  assert.equal(locateCalls, 1);
  assert.equal(result.notes[0].page, 2);
  assert.equal(result.notes[0].text, "");
  assert.equal(result.notes[0].draftStart, null);
});

test("変更箇所検出の進捗率を0%から100%まで通知する", async () => {
  const events = [];
  await recognizeProofChanges("赤ゲラ.pdf", "元原稿", {
    countPages: async () => 2,
    renderPage: async () => imageWithPixel({ red: true }),
    extractTextPage: async () => ({ words: [] }),
    locatePage: async () => ({ locations: [] }),
    onProgress: (progress) => events.push(progress),
  });

  assert.equal(events[0].percent, 0);
  assert.equal(events.at(-1).percent, 100);
  assert.ok(events.some((event) => event.percent === 25));
  assert.ok(events.some((event) => event.percent === 75));
  assert.ok(events.every((event) => /ページ|変更箇所/u.test(event.message)));
});
