// Run after `npx playwright install chromium`. IPC is mocked; Windows IME needs manual testing.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { chromium } from "playwright";

const root = resolve(".");
const server = createServer(async (req, res) => {
  const path = resolve(
    root,
    "." + new URL(req.url, "http://localhost").pathname,
  );
  if (!path.startsWith(root + "/")) {
    res.writeHead(403).end();
    return;
  }
  try {
    res.setHeader(
      "Content-Type",
      { ".js": "text/javascript", ".html": "text/html", ".css": "text/css" }[
        extname(path)
      ] || "application/octet-stream",
    );
    res.end(await readFile(path));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({
  channel: "chromium",
  headless: true,
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept());
  const text =
    "長編試験\n# 第一章\n" +
    "日本語の長い原稿です。｜漢字《かんじ》も残します。\n".repeat(9000);
  const manuscript = text.slice(0, 204076) + "\n末尾の目印です";
  await page.addInitScript(
    ({ manuscript }) => {
      window.saved = [];
      window.nextDocument = null;
      window.saveDelay = 0;
      window.desktop = {
        restoreDocument: async () => ({
          path: "long.txt",
          text: manuscript,
          encoding: "utf8",
        }),
        onMenuCommand: (callback) => {
          window.menu = callback;
        },
        onProofApplied: (callback) => {
          window.proofApplied = callback;
        },
        save: async (text) => {
          window.saved.push(text);
          if (window.saveDelay)
            await new Promise((resolve) =>
              setTimeout(resolve, window.saveDelay),
            );
          return "long.txt";
        },
        saveAs: async (text) => {
          window.saved.push(text);
          return "saved.txt";
        },
        newFile: async () => {},
        open: async () => window.nextDocument,
      };
    },
    { manuscript },
  );
  await page.goto(`http://127.0.0.1:${server.address().port}/src/index.html`);
  const input = page.locator(".cm-content");
  await input.waitFor();
  await page.waitForFunction(
    () => document.querySelector("#state").textContent === "long.txt",
  );
  const command = (cmd) => page.evaluate((cmd) => window.menu(cmd), cmd);
  const savedText = async () => {
    await command("save");
    return page.evaluate(() => window.saved.at(-1));
  };
  assert.equal(await savedText(), manuscript);
  const lineCount = await page.locator(".cm-line").count();
  assert.ok(
    lineCount < 300,
    `DOM lines should be virtualized, got ${lineCount}`,
  );
  await input.focus();
  await page.keyboard.press("Control+Home");
  await page.keyboard.insertText("冒頭追記");
  assert.equal(await savedText(), "冒頭追記" + manuscript);
  await command("undo");
  assert.equal(await savedText(), manuscript);
  await page.keyboard.press("Control+End");
  const start = performance.now();
  await page.keyboard.insertText("末尾追記");
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(resolve)),
  );
  console.log(
    `204k end insert + next frame: ${(performance.now() - start).toFixed(1)}ms (headless, not Windows IME)`,
  );
  assert.equal(await savedText(), manuscript + "末尾追記");
  await command("undo");
  assert.equal(await savedText(), manuscript);
  await command("redo");
  assert.equal(await savedText(), manuscript + "末尾追記");
  await command("undo");

  // Chromium composition at the very end, including a pause longer than autosave.
  const cdp = await page.context().newCDPSession(page);
  await page.keyboard.press("Control+End");
  await cdp.send("Input.imeSetComposition", {
    text: "へんかん",
    selectionStart: 4,
    selectionEnd: 4,
  });
  const savesBefore = await page.evaluate(() => window.saved.length);
  await page.waitForTimeout(1400);
  assert.equal(
    await page.evaluate(() => window.saved.length),
    savesBefore,
    "no autosave during composition",
  );
  await cdp.send("Input.insertText", { text: "変換" });
  assert.equal(await savedText(), manuscript + "変換");
  await page.waitForFunction(() =>
    document.querySelector("#state").textContent.startsWith("保存済み"),
  );

  await command("find");
  await page.locator("#needle").fill("末尾の目印");
  await page.locator("#findNext").click();
  await page.locator("#replacement").fill("終端の目印");
  await page.locator("#replaceOne").click();
  assert.equal(
    await savedText(),
    manuscript.replace("末尾の目印", "終端の目印") + "変換",
  );
  await page.locator("#needle").fill("日本語");
  await page.locator("#replacement").fill("にほんご");
  await page.locator("#replaceAll").click();
  const replaced =
    manuscript
      .replace("末尾の目印", "終端の目印")
      .replaceAll("日本語", "にほんご") + "変換";
  assert.equal(await savedText(), replaced);
  await page.evaluate(() => document.querySelector("#findDialog").close());
  await input.focus();
  await command("undo");
  assert.equal(
    await savedText(),
    manuscript.replace("末尾の目印", "終端の目印") + "変換",
  );
  await command("redo");
  assert.equal(await savedText(), replaced);

  // Selection spans unrendered text, deletion/undo preserves the complete document.
  await command("selectAll");
  await page.keyboard.press("Backspace");
  assert.equal(await savedText(), "");
  await command("undo");
  assert.equal(await savedText(), replaced);

  // Settings and preview still work on the same document.
  await command("settings");
  await page.locator("#fontSize").evaluate((el) => {
    el.value = "22";
    el.dispatchEvent(new Event("input"));
  });
  assert.equal(
    await input.evaluate((el) => getComputedStyle(el).fontSize),
    "22px",
  );
  await page.evaluate(() => document.querySelector("#settingsDialog").close());
  await command("toggle-preview");
  assert.ok(await page.locator("#previewContent").textContent());
  await command("toggle-preview");

  // A delayed save must not label a subsequent edit as saved.
  await input.focus();
  await page.keyboard.press("Control+End");
  await page.evaluate(() => {
    window.saveDelay = 300;
    window.menu("save");
  });
  await page.keyboard.insertText("未保存追記");
  await page.waitForTimeout(400);
  assert.match(await page.locator("#state").textContent(), /^未保存/);
  await page.evaluate(() => {
    window.saveDelay = 0;
  });
  assert.equal(await savedText(), replaced + "未保存追記");

  // Loading a different file clears pending autosaves and the old undo history.
  await page.evaluate(() => {
    window.nextDocument = {
      path: "next.txt",
      encoding: "utf8",
      text: "別の原稿\n本文",
    };
  });
  await command("open");
  await page.waitForFunction(
    () => document.querySelector("#state").textContent === "next.txt",
  );
  await input.focus();
  await command("undo");
  assert.equal(await savedText(), "別の原稿\n本文");
  await page.evaluate(() => window.proofApplied({ text: "ゲラ反映\n本文" }));
  assert.equal(await savedText(), "ゲラ反映\n本文");
  await command("undo");
  assert.equal(await savedText(), "別の原稿\n本文");
  await command("new");
  await page.waitForFunction(
    () => document.querySelector("#state").textContent === "新規",
  );
  await command("undo");
  assert.equal(await savedText(), "");
  assert.deepEqual(errors, []);
  console.log(
    `PASS: ${manuscript.length} characters, ${lineCount} initial DOM lines; full-document editing, composition, save, find/replace, history, settings, preview, file switches`,
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
