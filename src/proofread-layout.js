export function findProofreadNotePosition({
  pageWidth,
  pageHeight,
  noteWidth,
  noteHeight,
  anchor,
  occupied,
  gap = 4,
  step = 6,
  allowOverlapFallback = true,
}) {
  const overlaps = (a, b) =>
    !(
      a.x + a.width + gap <= b.x ||
      b.x + b.width + gap <= a.x ||
      a.y + a.height + gap <= b.y ||
      b.y + b.height + gap <= a.y
    );
  const width = Math.min(noteWidth, Math.max(1, pageWidth - gap * 2));
  const height = Math.min(noteHeight, Math.max(1, pageHeight - gap * 2));
  const candidates = [];
  for (let y = gap; y <= pageHeight - height - gap; y += step) {
    for (let x = gap; x <= pageWidth - width - gap; x += step) {
      const distanceX = Math.max(x - anchor.x, anchor.x - (x + width), 0);
      const distanceY = Math.max(y - anchor.y, anchor.y - (y + height), 0);
      candidates.push({
        x,
        y,
        width,
        height,
        distance: distanceX + distanceY,
      });
    }
  }
  candidates.sort((a, b) => a.distance - b.distance || b.y - a.y);
  const available = candidates.find((candidate) =>
    occupied.every((rect) => !overlaps(candidate, rect)),
  );
  if (available || !allowOverlapFallback) return available || null;
  return {
    x: Math.max(gap, Math.min(pageWidth - width - gap, anchor.x + gap)),
    y: Math.max(gap, Math.min(pageHeight - height - gap, anchor.y)),
    width,
    height,
  };
}

export function findProofreadBlockPosition({
  pageWidth,
  pageHeight,
  noteLines,
  baseFontSize,
  anchor,
  occupied,
  gap = 4,
  step = 6,
}) {
  const lines = noteLines?.length ? noteLines : [0];
  const maximumCapacity = Math.max(
    1,
    Math.floor((pageHeight - gap * 2) / baseFontSize),
  );
  const columnPitch = baseFontSize * 1.15;
  const maximumColumns = Math.max(
    1,
    Math.floor((pageWidth - gap * 2) / columnPitch),
  );
  const requiredColumns = (capacity) =>
    lines.reduce(
      (columns, length) =>
        columns + Math.max(1, Math.ceil(Math.max(1, length) / capacity)),
      0,
    );
  const minimumColumns = requiredColumns(maximumCapacity);
  const triedShapes = new Set();

  for (
    let targetColumns = minimumColumns;
    targetColumns <= maximumColumns;
    targetColumns++
  ) {
    let low = 1;
    let high = maximumCapacity;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (requiredColumns(middle) <= targetColumns) high = middle;
      else low = middle + 1;
    }
    const columns = requiredColumns(low);
    if (columns > maximumColumns) continue;
    const shapeKey = `${columns}:${low}`;
    if (triedShapes.has(shapeKey)) continue;
    triedShapes.add(shapeKey);
    const position = findProofreadNotePosition({
      pageWidth,
      pageHeight,
      noteWidth: columns * columnPitch,
      noteHeight: low * baseFontSize,
      anchor,
      occupied,
      gap,
      step,
      allowOverlapFallback: false,
    });
    if (position) {
      return {
        ...position,
        columns,
        charactersPerColumn: low,
      };
    }
  }
  return null;
}

export function findInlineProofreadPosition({
  pageWidth,
  pageHeight,
  noteLength,
  baseFontSize,
  anchorRect,
  occupied,
  gap = 2,
  minimumLeaderLength = baseFontSize * 0.65,
}) {
  const anchorRight = anchorRect.x + anchorRect.width;
  const rightNeighbors = occupied.filter(
    (rect) =>
      rect.x >= anchorRight &&
      rect.y < pageHeight &&
      rect.y + rect.height > anchorRect.y,
  );
  const rightBoundary = rightNeighbors.length
    ? Math.min(...rightNeighbors.map((rect) => rect.x))
    : pageWidth;
  const availableWidth =
    rightBoundary - anchorRight - gap * 2 - minimumLeaderLength;
  const maximumFontSize = baseFontSize * 0.88;
  const minimumFontSize = baseFontSize * 0.72;
  const fontSize = Math.min(maximumFontSize, availableWidth);
  if (fontSize < minimumFontSize) return null;

  const width = fontSize;
  const height = Math.max(fontSize, noteLength * fontSize);
  const candidate = {
    x: anchorRight + gap + minimumLeaderLength,
    y: anchorRect.y,
    width,
    height,
    fontSize,
    leaderLength: minimumLeaderLength,
  };
  if (candidate.y + candidate.height + gap > pageHeight) return null;

  const overlaps = (a, b) =>
    !(
      a.x + a.width <= b.x ||
      b.x + b.width <= a.x ||
      a.y + a.height <= b.y ||
      b.y + b.height <= a.y
    );
  return occupied.every((rect) => !overlaps(candidate, rect))
    ? candidate
    : null;
}

export function proofreadLeaderPoints({
  anchor,
  position,
  pageHeight,
  armLength = 8,
  laneOffset = 0,
  gutterOnly = false,
  armDirection,
}) {
  const destination = {
    x: Math.max(position.x, Math.min(position.x + position.width, anchor.x)),
    y: Math.max(position.y, Math.min(position.y + position.height, anchor.y)),
  };
  const deltaX = destination.x - anchor.x;
  const deltaY = destination.y - anchor.y;
  const horizontalDirection = armDirection ?? (deltaX < 0 ? -1 : 1);
  const armX =
    anchor.x + horizontalDirection * (armLength + Math.max(0, laneOffset));

  if (gutterOnly) {
    return [anchor, { x: armX, y: anchor.y }, { x: armX, y: destination.y }];
  }

  if (Math.abs(deltaY) >= Math.abs(deltaX)) {
    return [
      anchor,
      { x: armX, y: anchor.y },
      { x: armX, y: destination.y },
      destination,
    ];
  }

  const verticalDirection =
    deltaY === 0 ? (anchor.y <= pageHeight / 2 ? -1 : 1) : Math.sign(deltaY);
  const elbowY =
    anchor.y + verticalDirection * (armLength + Math.max(0, laneOffset));
  return [
    anchor,
    { x: armX, y: anchor.y },
    { x: armX, y: elbowY },
    { x: destination.x, y: elbowY },
    destination,
  ];
}
