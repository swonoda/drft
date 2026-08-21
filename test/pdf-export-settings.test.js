import test from "node:test";
import assert from "node:assert/strict";
import {
  readPdfExportSettings,
  writePdfExportSettings,
  createPdfExportSettingsController,
} from "../src/pdf-export-settings.js";

const keys = {
  separateTitle: "pdf.separateTitle",
  titleParity: "pdf.titleParity",
  bodyParity: "pdf.bodyParity",
  cropMarks: "pdf.cropMarks",
};

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

function control(value) {
  return {
    value,
    checked: false,
    disabled: false,
    addEventListener(_event, listener) {
      this.listener = listener;
    },
  };
}

test("PDF設定は未保存なら既定値を使う", () => {
  assert.deepEqual(readPdfExportSettings(memoryStorage(), keys), {
    separateTitle: false,
    titleParity: "odd",
    bodyParity: "even",
    cropMarks: false,
  });
});

test("PDF設定を指定したキーへ保存して読み戻す", () => {
  const storage = memoryStorage();
  const settings = {
    separateTitle: true,
    titleParity: "even",
    bodyParity: "odd",
    cropMarks: true,
  };
  writePdfExportSettings(storage, keys, settings);
  assert.deepEqual(readPdfExportSettings(storage, keys), settings);
});

test("タイトルを独立させないとタイトルページ指定を無効にする", () => {
  const controls = {
    separateTitle: control(),
    titleParity: control("odd"),
    bodyParity: control("even"),
    cropMarks: control(),
  };
  const controller = createPdfExportSettingsController({
    controls,
    keys,
    storage: memoryStorage(),
  });
  controller.load();
  assert.equal(controls.titleParity.disabled, true);
  controls.separateTitle.checked = true;
  controls.separateTitle.listener();
  assert.equal(controls.titleParity.disabled, false);
});
