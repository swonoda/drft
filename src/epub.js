import {
  escapeHtml,
  inlineMarkup,
  manuscriptText,
  parseDocument,
  stripFixMarks,
} from "./parser.js";

function xhtmlPage(title, body, bodyClass = "") {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="ja" xml:lang="ja">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" type="text/css" href="style.css" />
</head>
<body class="${bodyClass}">${body}</body>
</html>`;
}

function paragraphMarkup(raw) {
  return inlineMarkup(stripFixMarks(raw)).replaceAll("\n", "<br />");
}

function bodyDocument(document) {
  let chapterNumber = 0;
  const contents = ['<main id="body-start">'];
  for (const section of document.sections) {
    if (section.type === "chapter") {
      chapterNumber++;
      contents.push(
        `<h2 id="chapter-${chapterNumber}">${inlineMarkup(section.label)}</h2>`,
      );
    } else {
      contents.push(`<p>${paragraphMarkup(section.raw)}</p>`);
    }
  }
  contents.push("</main>");
  return contents.join("");
}

function navigationDocument(document) {
  let chapterNumber = 0;
  const chapters = document.sections.flatMap((section) => {
    if (section.type !== "chapter") return [];
    chapterNumber++;
    const label = manuscriptText(section.label).trim();
    if (/^[0-9０-９]+$/.test(label)) return [];
    return [{ label, number: chapterNumber }];
  });
  const items = chapters.length
    ? chapters
        .map(
          (chapter) =>
            `<li><a href="body.xhtml#chapter-${chapter.number}">${escapeHtml(
              chapter.label,
            )}</a></li>`,
        )
        .join("")
    : '<li><a href="body.xhtml#body-start">本文</a></li>';
  return `<nav epub:type="toc" id="toc"><h1>目次</h1><ol>${items}</ol></nav>`;
}

const stylesheet = `@charset "UTF-8";
html {
  writing-mode: vertical-rl;
  -webkit-writing-mode: vertical-rl;
  line-break: strict;
  word-break: normal;
}
body {
  margin: 5%;
  padding: 0;
  font-size: 1em;
  line-height: 1.9;
}
@page {
  @bottom-center {
    content: counter(page);
  }
}
body.title-page {
  margin-block: 18%;
}
h1 {
  margin: 0;
  font-size: 1.5em;
  font-weight: 600;
}
h2 {
  margin: 0 0 0 2em;
  break-before: page;
  page-break-before: always;
  font-size: 1.25em;
  font-weight: 600;
}
p {
  margin: 0 0 0 1em;
  padding: 0;
  white-space: pre-wrap;
}
nav ol {
  margin: 2em 0 0;
  padding: 0;
  list-style: none;
}
nav li {
  margin: 0 0 0 1em;
}
a {
  color: inherit;
  text-decoration: none;
}
ruby rt {
  font-size: 0.5em;
}
.bout {
  font-style: normal;
  text-emphasis-style: filled sesame;
  -webkit-text-emphasis-style: filled sesame;
}`;

export function buildEpubBook(
  text,
  {
    identifier = `urn:uuid:${crypto.randomUUID()}`,
    modified = new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  } = {},
) {
  const document = parseDocument(text);
  const title = manuscriptText(document.title).trim() || "無題";
  const packageDocument = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="ja" prefix="rendition: http://www.idpf.org/vocab/rendition/#">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:identifier id="book-id">${escapeHtml(identifier)}</dc:identifier>
  <dc:title>${escapeHtml(title)}</dc:title>
  <dc:language>ja</dc:language>
  <meta property="dcterms:modified">${escapeHtml(modified)}</meta>
  <meta property="rendition:layout">reflowable</meta>
  <meta property="rendition:orientation">auto</meta>
  <meta property="rendition:spread">auto</meta>
</metadata>
<manifest>
  <item id="style" href="style.css" media-type="text/css" />
  <item id="title" href="title.xhtml" media-type="application/xhtml+xml" />
  <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
  <item id="body" href="body.xhtml" media-type="application/xhtml+xml" />
</manifest>
<spine page-progression-direction="rtl">
  <itemref idref="title" />
  <itemref idref="nav" />
  <itemref idref="body" />
</spine>
</package>`;

  return {
    title,
    identifier,
    files: [
      {
        path: "META-INF/container.xml",
        content: `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml" />
  </rootfiles>
</container>`,
      },
      { path: "EPUB/package.opf", content: packageDocument },
      { path: "EPUB/style.css", content: stylesheet },
      {
        path: "EPUB/title.xhtml",
        content: xhtmlPage(
          title,
          `<main><h1>${inlineMarkup(stripFixMarks(document.title))}</h1></main>`,
          "title-page",
        ),
      },
      {
        path: "EPUB/nav.xhtml",
        content: xhtmlPage("目次", navigationDocument(document), "toc-page"),
      },
      {
        path: "EPUB/body.xhtml",
        content: xhtmlPage(title, bodyDocument(document), "body-page"),
      },
    ],
  };
}
