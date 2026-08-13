const { diffWordsWithSpace } = require("diff");

function buildDiffParts(left, right) {
  const changes = diffWordsWithSpace(
    left.replaceAll("\r\n", "\n"),
    right.replaceAll("\r\n", "\n"),
  );
  let changeId = 0;
  let insideChange = false;

  return changes.map((change, index) => {
    const changed = Boolean(change.added || change.removed);
    if (changed && !insideChange) changeId++;
    insideChange = changed;
    return {
      id: index,
      value: change.value,
      added: Boolean(change.added),
      removed: Boolean(change.removed),
      changeId: changed ? changeId : null,
    };
  });
}

function buildProofreadChanges(parts) {
  const groups = new Map();
  let leftOffset = 0;

  for (const part of parts) {
    if (part.changeId !== null) {
      const group = groups.get(part.changeId) || {
        id: part.changeId,
        start: null,
        end: null,
        removed: "",
        added: "",
      };
      if (part.removed) {
        if (group.start === null) group.start = leftOffset;
        group.removed += part.value;
        leftOffset += part.value.length;
        group.end = leftOffset;
      } else if (part.added) {
        group.added += part.value;
      }
      groups.set(part.changeId, group);
      continue;
    }
    leftOffset += part.value.length;
  }

  return [...groups.values()]
    .filter((group) => group.removed && group.start !== null)
    .map((group) => ({
      id: group.id,
      start: group.start,
      end: group.end,
      removed: group.removed,
      replacement: group.added || null,
      type: group.added ? "replace" : "delete",
    }));
}

module.exports = { buildDiffParts, buildProofreadChanges };
