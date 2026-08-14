export function findProofreadNotePosition({
  pageWidth,
  pageHeight,
  noteWidth,
  noteHeight,
  anchor,
  occupied,
  gap = 4,
  step = 6,
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
  return (
    candidates.find((candidate) =>
      occupied.every((rect) => !overlaps(candidate, rect)),
    ) || {
      x: Math.max(gap, Math.min(pageWidth - width - gap, anchor.x + gap)),
      y: Math.max(gap, Math.min(pageHeight - height - gap, anchor.y)),
      width,
      height,
    }
  );
}

export function findInlineProofreadPosition({
  pageWidth,
  pageHeight,
  noteLength,
  baseFontSize,
  anchorRect,
  occupied,
  gap = 2,
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
  const availableWidth = rightBoundary - anchorRight - gap * 2;
  const maximumFontSize = baseFontSize * 0.88;
  const minimumFontSize = baseFontSize * 0.72;
  const fontSize = Math.min(maximumFontSize, availableWidth);
  if (fontSize < minimumFontSize) return null;

  const width = fontSize;
  const height = Math.max(fontSize, noteLength * fontSize);
  const candidate = {
    x: anchorRight + gap + Math.max(0, (availableWidth - width) / 2),
    y: anchorRect.y,
    width,
    height,
    fontSize,
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
    return [
      anchor,
      { x: armX, y: anchor.y },
      { x: armX, y: destination.y },
    ];
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
