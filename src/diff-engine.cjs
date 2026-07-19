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

module.exports = { buildDiffParts };
