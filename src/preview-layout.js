export function previewPageBodyWidth(fontSize, lineHeight, linesPerPage) {
  const size = Number(fontSize);
  const height = Number(lineHeight);
  const lines = Number(linesPerPage);
  if (![size, height, lines].every(Number.isFinite)) return 1;
  return Math.max(1, Math.ceil(size * height * lines));
}

export function previewPageCount(contentWidth, pageWidth) {
  return Math.max(1, Math.ceil(contentWidth / Math.max(1, pageWidth)));
}

export function previewPageForOffset(offsetFromRight, pageWidth, pageCount) {
  return Math.max(
    0,
    Math.min(
      Math.max(1, pageCount) - 1,
      Math.floor(Math.max(0, offsetFromRight) / Math.max(1, pageWidth)),
    ),
  );
}

export function editorMarginWithPreview(
  configuredMargin,
  previewWidth,
  minimumMargin = 40,
) {
  const margin = Number(configuredMargin);
  const width = Number(previewWidth);
  const minimum = Number(minimumMargin);
  if (![margin, width, minimum].every(Number.isFinite)) return minimumMargin;
  if (width <= 0) return Math.max(0, margin);
  return Math.max(minimum, margin - Math.max(0, width) / 2);
}
