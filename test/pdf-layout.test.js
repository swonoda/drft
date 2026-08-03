import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { estimateLayout, parseTextRuns, textTokenCount } = require("../src/pdf-layout.cjs");

test("PDFの縦書きテキストランから字数と行数を推定する", () => {
  const content = Array.from({ length: 12 }, (_, index) =>
    `BT 1 0 0 1 ${index * 20} 100 Tm <001200170014001500160017001200170014001500160017001200170014001500160017001200170014001500160017> Tj ET`,
  ).join("\n");
  const runs = parseTextRuns(content);
  assert.equal(runs.length, 12);
  assert.equal(textTokenCount("<001200170014> Tj"), 3);
  assert.deepEqual(estimateLayout(runs, 420, 700), {
    charactersPerLine: 24,
    linesPerPage: 12,
    spread: false,
    confidence: "high",
  });
});

test("見開きPDFは左右を一ページずつとして行数を推定する", () => {
  const runs = Array.from({ length: 24 }, (_, index) => ({ chars: 43, x: index, y: 0 }));
  const layout = estimateLayout(runs, 900, 600);
  assert.equal(layout.charactersPerLine, 43);
  assert.equal(layout.linesPerPage, 12);
  assert.equal(layout.spread, true);
});
