export function escapeHtml(s) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function inlineMarkup(input) {
  let s = escapeHtml(input);
  // 青空: ｜漢字《かんじ》 / 漢字《かんじ》、カクヨム: |漢字《かんじ》
  s = s.replace(/[｜|]([^《\n]+)《([^》\n]+)》/g, "<ruby>$1<rt>$2</rt></ruby>");
  s = s.replace(
    /([\p{Script=Han}々〆ヵヶ]+)《([^》\n]+)》/gu,
    "<ruby>$1<rt>$2</rt></ruby>",
  );
  // 青空傍点: 語［＃「語」に傍点］ / カクヨム: 《《語》》
  s = s.replace(
    /([^［\n]+)［＃「([^」]+)」に傍点］/g,
    (match, prefix, target) =>
      prefix.endsWith(target)
        ? `${prefix.slice(0, -target.length)}<em class="bout">${target}</em>`
        : `${prefix}<em class="bout">${target}</em>`,
  );
  // 注記だけの旧入力も引き続き表示する。
  s = s.replace(/［＃「([^」]+)」に傍点］/g, '<em class="bout">$1</em>');
  s = s.replace(/《《([^》]+)》》/g, '<em class="bout">$1</em>');
  return s;
}

function safeCaretIndex(input, index) {
  const tokens =
    /#fix\[[^\]]*\]|[｜|][^《\n]+《[^》\n]+》|[\p{Script=Han}々〆ヵヶ]+《[^》\n]+》|［＃「[^」]+」に傍点］|《《[^》]+》》/gu;
  let match;
  while ((match = tokens.exec(input))) {
    if (index > match.index && index < match.index + match[0].length) {
      const middle = match.index + match[0].length / 2;
      return index < middle ? match.index : match.index + match[0].length;
    }
  }
  return Math.max(0, Math.min(index, input.length));
}

function markFirstRenderedCharacter(html) {
  const tokens = /<[^>]+>|&[^;\s]+;|[\s\S]/gu;
  let inRubyText = false;
  let match;
  while ((match = tokens.exec(html))) {
    const token = match[0];
    if (/^<rt\b/i.test(token)) inRubyText = true;
    if (/^<\/rt\b/i.test(token)) inRubyText = false;
    if (token.startsWith("<") || inRubyText) continue;
    if (token === "\n") return null;
    return `${html.slice(0, match.index)}<span class="preview-caret">${token}</span>${html.slice(match.index + token.length)}`;
  }
  return null;
}

function markLastRenderedCharacter(html) {
  const tokens = /<[^>]+>|&[^;\s]+;|[\s\S]/gu;
  let inRubyText = false;
  let candidate = null;
  let match;
  while ((match = tokens.exec(html))) {
    const token = match[0];
    if (/^<rt\b/i.test(token)) inRubyText = true;
    if (/^<\/rt\b/i.test(token)) inRubyText = false;
    if (!token.startsWith("<") && !inRubyText && token !== "\n") {
      candidate = { index: match.index, token };
    }
  }
  if (!candidate) {
    return `<span class="preview-caret" aria-hidden="true"></span>${html}`;
  }
  const end = candidate.index + candidate.token.length;
  return `${html.slice(0, candidate.index)}<span class="preview-caret">${candidate.token}</span>${html.slice(end)}`;
}

export function inlineMarkupWithCaret(input, index) {
  const split = safeCaretIndex(input, index);
  const before = stripFixMarks(input.slice(0, split));
  const after = stripFixMarks(input.slice(split));
  const beforeHtml = inlineMarkup(before);
  const afterHtml = inlineMarkup(after);
  const markedAfter = markFirstRenderedCharacter(afterHtml);
  return markedAfter === null
    ? `${markLastRenderedCharacter(beforeHtml)}${afterHtml}`
    : `${beforeHtml}${markedAfter}`;
}

export function stripFixMarks(input) {
  return input.replace(/#fix\[[^\]]*\]/g, "");
}

export function findFixMarks(input) {
  const marks = [];
  const pattern = /#fix\[([^\]]*)\]/g;
  let match;
  while ((match = pattern.exec(input))) {
    const lineStart = input.lastIndexOf("\n", match.index - 1) + 1;
    const lineEnd = input.indexOf("\n", match.index);
    const context = stripFixMarks(
      input.slice(lineStart, lineEnd < 0 ? input.length : lineEnd),
    ).trim();
    marks.push({
      comment: match[1].trim(),
      context,
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return marks;
}

export function manuscriptText(input) {
  let text = stripFixMarks(input).replaceAll("\r\n", "\n");
  text = text.replace(/[｜|]([^《\n]+)《[^》\n]+》/g, "$1");
  text = text.replace(/([\p{Script=Han}々〆ヵヶ]+)《[^》\n]+》/gu, "$1");
  text = text.replace(
    /([^［\n]+)［＃「([^」]+)」に傍点］/g,
    (match, prefix, target) =>
      prefix.endsWith(target) ? prefix : `${prefix}${target}`,
  );
  text = text.replace(/［＃「([^」]+)」に傍点］/g, "$1");
  text = text.replace(/《《([^》]+)》》/g, "$1");
  return text.replaceAll("\n", "");
}

export function manuscriptCharacterCount(input) {
  return [...manuscriptText(input)].length;
}

export function manuscriptSheetCount(input) {
  return Math.ceil(manuscriptCharacterCount(input) / 400);
}

export function parseDocument(text) {
  const normalized = text.replaceAll("\r\n", "\n");
  const lines = normalized.split("\n");
  const title = lines[0] || "無題";
  const bodyLines = lines.slice(1);
  const sections = [];
  let blankRun = 0;
  let start = 1;
  let buffer = [];
  let chapter = null;

  const pushParagraph = () => {
    const raw = buffer.join("\n");
    if (!raw.trim()) return;
    const item = {
      type: "paragraph",
      label: stripFixMarks(raw).trim().replace(/\s+/g, " ").slice(0, 36),
      raw,
      start,
    };
    sections.push(item);
    buffer = [];
  };

  for (let i = 0; i <= bodyLines.length; i++) {
    const line = bodyLines[i];
    if (line === "" || line === undefined) {
      blankRun++;
      if (buffer.length) pushParagraph();
      continue;
    }
    if (blankRun >= 2) {
      chapter = {
        type: "chapter",
        label: stripFixMarks(line).trim().slice(0, 50),
        start: i + 1,
      };
      sections.push(chapter);
      blankRun = 0;
      continue;
    }
    blankRun = 0;
    if (!buffer.length) start = i + 1;
    buffer.push(line);
  }
  return { title, sections };
}

export function renderBody(text, caretOffset = null) {
  const normalized = text.replaceAll("\r\n", "\n");
  const lines = normalized.split("\n");
  const lineOffsets = [];
  let offset = 0;
  for (const line of lines) {
    lineOffsets.push(offset);
    offset += line.length + 1;
  }
  const doc = parseDocument(text);
  const renderedSections = doc.sections.map((section) => {
    const raw =
      section.type === "chapter"
        ? lines[section.start] || section.label
        : section.raw;
    const start = lineOffsets[section.start] ?? 0;
    return { section, raw, start, end: start + raw.length };
  });
  let activeIndex = -1;
  let activeLocal = 0;
  if (caretOffset !== null && renderedSections.length) {
    activeIndex = renderedSections.findIndex(
      ({ start, end }) => caretOffset >= start && caretOffset <= end,
    );
    if (activeIndex < 0) {
      activeIndex = renderedSections.findIndex(
        ({ start }) => start > caretOffset,
      );
      if (activeIndex < 0) activeIndex = renderedSections.length - 1;
    }
    const active = renderedSections[activeIndex];
    activeLocal = Math.max(
      0,
      Math.min(caretOffset - active.start, active.raw.length),
    );
  }
  return renderedSections
    .map(({ section, raw }, index) => {
      const html =
        index === activeIndex
          ? inlineMarkupWithCaret(raw, activeLocal)
          : inlineMarkup(stripFixMarks(raw));
      return section.type === "chapter"
        ? `<h2>${html}</h2>`
        : `<p>${html.replaceAll("\n", "<br>")}</p>`;
    })
    .join("");
}

export function renderPreviewDocument(text, caretOffset = null) {
  const normalized = text.replaceAll("\r\n", "\n");
  const title = normalized.split("\n")[0] || "無題";
  const titleActive = caretOffset !== null && caretOffset <= title.length;
  const titleHtml = titleActive
    ? inlineMarkupWithCaret(title, caretOffset)
    : inlineMarkup(title);
  return `<h1>${titleHtml}</h1>${renderBody(normalized, titleActive ? null : caretOffset)}`;
}

export function serializeDocument(title, sections) {
  let text = title;
  for (const section of sections) {
    text +=
      section.type === "chapter"
        ? `\n\n\n${section.label}`
        : `\n\n${section.raw}`;
  }
  return text;
}

export function moveParagraphSection(document, from, to, after = false) {
  const source = document.sections[from];
  if (!source || source.type !== "paragraph" || from === to) return null;
  const sections = [...document.sections];
  let destination = to + (after ? 1 : 0);
  const [moved] = sections.splice(from, 1);
  if (from < destination) destination--;
  sections.splice(destination, 0, moved);
  return serializeDocument(document.title, sections);
}
