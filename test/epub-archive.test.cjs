const test = require("node:test");
const assert = require("node:assert/strict");
const JSZip = require("jszip");
const { createEpubArchive } = require("../src/epub-archive.cjs");

test("mimetypeを先頭かつ無圧縮で格納したEPUBを作る", async () => {
  const archive = await createEpubArchive([
    { path: "META-INF/container.xml", content: "<container />" },
    { path: "EPUB/package.opf", content: "<package />" },
  ]);
  assert.equal(archive.readUInt32LE(0), 0x04034b50);
  assert.equal(archive.readUInt16LE(8), 0);
  const nameLength = archive.readUInt16LE(26);
  const extraLength = archive.readUInt16LE(28);
  const name = archive.subarray(30, 30 + nameLength).toString("utf8");
  const contentStart = 30 + nameLength + extraLength;
  assert.equal(name, "mimetype");
  assert.equal(
    archive
      .subarray(contentStart, contentStart + "application/epub+zip".length)
      .toString("utf8"),
    "application/epub+zip",
  );

  const zip = await JSZip.loadAsync(archive);
  assert.equal(
    await zip.file("mimetype").async("string"),
    "application/epub+zip",
  );
  assert.ok(zip.file("EPUB/package.opf"));
});
