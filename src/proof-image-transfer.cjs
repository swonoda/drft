function createPngPayload(png) {
  if (
    !Buffer.isBuffer(png) ||
    png.length < 8 ||
    png[0] !== 0x89 ||
    png[1] !== 0x50 ||
    png[2] !== 0x4e ||
    png[3] !== 0x47
  ) {
    throw new Error("PDFから作成した画像がPNG形式ではありません。");
  }
  return {
    mimeType: "image/png",
    base64: png.toString("base64"),
    byteLength: png.length,
  };
}

module.exports = { createPngPayload };
