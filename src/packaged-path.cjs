const fs = require("node:fs");
const path = require("node:path");

function unpackedAsarPath(filePath) {
  if (typeof filePath !== "string") return filePath;
  const marker = `${path.sep}app.asar${path.sep}`;
  if (!filePath.includes(marker)) return filePath;
  const unpacked = filePath.replace(
    marker,
    `${path.sep}app.asar.unpacked${path.sep}`,
  );
  return fs.existsSync(unpacked) ? unpacked : filePath;
}

module.exports = { unpackedAsarPath };
