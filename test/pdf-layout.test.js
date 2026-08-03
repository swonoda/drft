import test from "node:test";
import assert from "node:assert/strict";
import { parsePbm } from "../src/pdf-layout.cjs";

test("PBM画像を読み込める", () => {
  const image = parsePbm(Buffer.from("P4\n8 2\n\x80\x01", "binary"));
  assert.equal(image.width, 8);
  assert.equal(image.height, 2);
  assert.equal(image.rowBytes, 1);
});
