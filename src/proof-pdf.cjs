const path = require("node:path");

function pdfDefaultPath(sourcePath) {
  if (!sourcePath) return "原稿.pdf";
  const parsed = path.parse(sourcePath);
  return path.join(parsed.dir, `${parsed.name}.pdf`);
}

function proofPdfDefaultPath(sourcePath) {
  if (!sourcePath) return "朱入り原稿.pdf";
  const parsed = path.parse(sourcePath);
  return path.join(parsed.dir, `${parsed.name}_朱入り原稿.pdf`);
}

function ensurePdfExtension(filePath) {
  return filePath.toLowerCase().endsWith(".pdf") ? filePath : `${filePath}.pdf`;
}

module.exports = { pdfDefaultPath, proofPdfDefaultPath, ensurePdfExtension };
