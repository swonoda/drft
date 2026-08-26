const test = require("node:test");
const assert = require("node:assert/strict");
const { PNG } = require("pngjs");
const {
  cleanOcrText,
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

test("赤い画素だけをOCR対象として検出する", () => {
  assert.equal(redMask(imageWithPixel()).pixels, 0);
  assert.equal(redMask(imageWithPixel({ red: true })).pixels, 256);
});

test("OCRの改行や空白を本文候補へ持ち込まない", () => {
  assert.equal(cleanOcrText(" 万\n事 に ｜ "), "万事に");
});

test("赤字のないPDFは本文を推測で変更しない", async () => {
  let recognizeCalls = 0;
  const result = await recognizeProofChanges(
    "赤ゲラ.pdf",
    "文章はそのまま保持する。",
    {
      countPages: async () => 1,
      renderPage: async () => imageWithPixel(),
      recognizePage: async () => {
        recognizeCalls += 1;
        return [];
      },
    },
  );

  assert.deepEqual(result.changes, []);
  assert.deepEqual(result.notes, []);
  assert.equal(recognizeCalls, 0);
  assert.match(result.notice, /本文は変更していません/);
});

test("ローカルOCRの赤字候補を本文とは分離して返す", async () => {
  const note = { id: "n1", page: 1, text: "万事に", confidence: 72 };
  const result = await recognizeProofChanges("赤ゲラ.pdf", "元原稿", {
    countPages: async () => 1,
    renderPage: async () => imageWithPixel({ red: true }),
    recognizePage: async () => [note],
  });

  assert.deepEqual(result.changes, []);
  assert.deepEqual(result.notes, [note]);
  assert.match(result.notice, /1件/);
});

test("PaddleOCRは赤字ページでだけ起動し、処理後に終了する", async () => {
  let createCalls = 0;
  let recognizeCalls = 0;
  let closeCalls = 0;
  const result = await recognizeProofChanges("赤ゲラ.pdf", "元原稿", {
    countPages: async () => 2,
    renderPage: async (_pdfPath, page) => imageWithPixel({ red: page === 2 }),
    createRecognizer: () => {
      createCalls += 1;
      return {
        recognize: async (_png, page) => {
          recognizeCalls += 1;
          return [{ id: "n1", page, text: "万事に", confidence: 72 }];
        },
        close: async () => {
          closeCalls += 1;
        },
      };
    },
  });

  assert.equal(createCalls, 1);
  assert.equal(recognizeCalls, 1);
  assert.equal(closeCalls, 1);
  assert.equal(result.notes[0].page, 2);
});

test("OCRの処理内容と進捗率を0%から100%まで通知する", async () => {
  const events = [];
  await recognizeProofChanges("赤ゲラ.pdf", "元原稿", {
    countPages: async () => 2,
    renderPage: async () => imageWithPixel({ red: true }),
    recognizePage: async (_png, page, onProgress) => {
      onProgress({ message: `${page}ページをOCR中`, progress: 0.5 });
      return [];
    },
    onProgress: (progress) => events.push(progress),
  });

  assert.equal(events[0].percent, 0);
  assert.equal(events.at(-1).percent, 100);
  assert.ok(events.some((event) => event.percent === 25));
  assert.ok(events.some((event) => event.percent === 75));
  assert.ok(events.every((event) => /ページ|赤字/u.test(event.message)));
});
