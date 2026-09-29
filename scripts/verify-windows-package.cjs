// Fail the release before publishing if platform-specific runtime files are missing.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const asar = require("@electron/asar");
const { unpackedAsarPath } = require("../src/packaged-path.cjs");
const archive = path.resolve("dist/win-unpacked/resources/app.asar");
const config = require("../package.json");
const packaged = JSON.parse(
  asar.extractFile(archive, "package.json").toString(),
);
assert.equal(packaged.version, config.version);
assert.ok(asar.statFile(archive, "src/generated/editor.js").size > 0);
const poppler = asar
  .listPackage(archive)
  .filter(
    (file) =>
      file
        .replaceAll("\\", "/")
        .startsWith("/node_modules/node-poppler-win32/") &&
      /\.exe$/i.test(file),
  );
for (const name of ["pdftoppm.exe", "pdftotext.exe"]) {
  assert.ok(
    poppler.some(
      (file) => file.endsWith("/" + name) || file.endsWith("\\" + name),
    ),
    `${name} is missing`,
  );
}
for (const file of [
  "src/proof-location-opencv.py",
  "src/proof-ocr-paddle.py",
  ...poppler.map((file) => file.replace(/^[/\\]/, "")),
]) {
  assert.equal(
    asar.statFile(archive, file).unpacked,
    true,
    `${file} is packed inside asar`,
  );
  assert.ok(
    fs.existsSync(unpackedAsarPath(path.join(archive, file))),
    `${file} is not accessible outside asar`,
  );
}
console.log(
  `Verified Windows package ${packaged.version}: editor, Poppler, Python scripts`,
);
