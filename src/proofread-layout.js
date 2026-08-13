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
