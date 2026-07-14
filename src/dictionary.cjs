function parseDictionary(markdown) {
  const normalized = markdown.replaceAll("\r\n", "\n");
  const lines = normalized.split("\n");
  const entries = [];
  let current = null;
  for (const line of lines) {
    const match = line.match(/^#\s+(.+)$/);
    if (match) {
      if (current) {
        current.description = current.description.join("\n").trim();
        entries.push(current);
      }
      current = { heading: match[1].trim(), description: [] };
    } else if (current) {
      current.description.push(line);
    }
  }
  if (current) {
    current.description = current.description.join("\n").trim();
    entries.push(current);
  }
  return entries;
}

function serializeDictionary(entries) {
  return entries
    .filter((entry) => entry.heading.trim())
    .map(
      (entry) => `# ${entry.heading.trim()}\n\n${entry.description.trim()}\n`,
    )
    .join("\n");
}

module.exports = { parseDictionary, serializeDictionary };
