export function previewPageBodyWidth(fontSize, lineHeight, linesPerPage) {
  const size = Number(fontSize);
  const height = Number(lineHeight);
  const lines = Number(linesPerPage);
  if (![size, height, lines].every(Number.isFinite)) return 1;
  return Math.max(1, Math.ceil(size * height * lines));
}

export function previewPageCount(
  contentWidth,
  pageWidth,
  roundingTolerance = 0,
) {
  const tolerance = Math.max(0, Number(roundingTolerance) || 0);
  return Math.max(
    1,
    Math.ceil((Math.max(0, contentWidth) - tolerance) / Math.max(1, pageWidth)),
  );
}

export function fixedSpreadPreviewLayout({
  verticalMarginMm,
  horizontalMarginMm,
  charactersPerLine,
  linesPerPage,
  pageWidthMm = 148.5,
  pageHeightMm = 210,
  pixelsPerMm = 96 / 25.4,
}) {
  const snapToLayoutPixel = (value) =>
    Math.max(1 / 64, Math.floor(value * 64) / 64);
  const pageWidth = Math.max(1, Number(pageWidthMm) * Number(pixelsPerMm));
  const pageHeight = Math.max(1, Number(pageHeightMm) * Number(pixelsPerMm));
  const verticalMargin = Math.min(
    Math.max(0, Number(verticalMarginMm) || 0) * Number(pixelsPerMm),
    Math.max(0, pageHeight / 2 - 1),
  );
  const horizontalMargin = Math.min(
    Math.max(0, Number(horizontalMarginMm) || 0) * Number(pixelsPerMm),
    Math.max(0, pageWidth / 2 - 1),
  );
  const characters = Math.max(1, Number(charactersPerLine) || 1);
  const lines = Math.max(1, Number(linesPerPage) || 1);
  const availableBodyWidth = Math.max(1, pageWidth - horizontalMargin * 2);
  const availableBodyHeight = Math.max(1, pageHeight - verticalMargin * 2);
  const linePitch = snapToLayoutPixel(availableBodyWidth / lines);
  const fontSize = snapToLayoutPixel(availableBodyHeight / characters);
  const bodyWidth = linePitch * lines;
  const bodyHeight = fontSize * characters;
  return {
    pageWidth,
    pageHeight,
    bodyWidth,
    bodyHeight,
    verticalMargin,
    horizontalMargin,
    linePitch,
    fontSize,
  };
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
