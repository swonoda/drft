const JSZip = require("jszip");

function validateFiles(files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error("EPUBの内容がありません");
  }
  for (const file of files) {
    if (
      !file ||
      typeof file.path !== "string" ||
      typeof file.content !== "string" ||
      file.path.startsWith("/") ||
      file.path.includes("..") ||
      file.path === "mimetype"
    ) {
      throw new Error("EPUBに不正なファイルが含まれています");
    }
  }
}

async function createEpubArchive(files) {
  validateFiles(files);
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  for (const file of files) {
    zip.file(file.path, file.content);
  }
  return zip.generateAsync({
    type: "nodebuffer",
    mimeType: "application/epub+zip",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
    platform: "DOS",
  });
}

module.exports = { createEpubArchive };
