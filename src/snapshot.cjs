const path = require("node:path");

function pad(value) {
  return String(value).padStart(2, "0");
}

function snapshotTimestamp(date = new Date()) {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

function snapshotDefaultPath(currentPath, date = new Date()) {
  const timestamp = snapshotTimestamp(date);
  if (!currentPath) {
    return `新しい小説_スナップショット_${timestamp}.txt`;
  }

  const parsed = path.parse(currentPath);
  return path.join(
    parsed.dir,
    "スナップショット",
    `${parsed.name}_スナップショット_${timestamp}.txt`,
  );
}

function ensureTxtExtension(filePath) {
  return filePath.toLowerCase().endsWith(".txt") ? filePath : `${filePath}.txt`;
}

module.exports = {
  ensureTxtExtension,
  snapshotDefaultPath,
  snapshotTimestamp,
};
