const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const { spawn } = require("node:child_process");

function pythonCandidates() {
  const executable = process.platform === "win32" ? "python.exe" : "python";
  const venvBin = process.platform === "win32" ? "Scripts" : "bin";
  const candidates = [
    process.env.DRFT_OCR_PYTHON,
    path.join(
      os.homedir(),
      "AppData",
      "Local",
      "DRFT",
      "ocr-runtime",
      venvBin,
      executable,
    ),
    path.resolve(__dirname, "..", ".ocrvenv", venvBin, executable),
    path.resolve(__dirname, "..", "..", "..", ".ocrvenv", venvBin, executable),
    process.platform === "win32" ? null : "python3",
    "python",
  ];
  return candidates.filter(Boolean);
}

function resolvePython() {
  for (const candidate of pythonCandidates()) {
    if (!path.isAbsolute(candidate) || fs.existsSync(candidate))
      return candidate;
  }
  throw new Error(
    "PaddleOCRの実行環境がありません。ターミナルで npm run ocr:setup を一度実行してください。",
  );
}

function defaultCacheDir() {
  const applicationData =
    process.env.LOCALAPPDATA || path.join(os.homedir(), ".cache");
  return path.join(applicationData, "DRFT", "proof-ocr");
}

class PaddleProofOcrSession {
  constructor({ cacheDir, onStatus } = {}) {
    this.cacheDir = cacheDir || process.env.DRFT_OCR_CACHE || defaultCacheDir();
    this.onStatus = onStatus;
    this.pending = new Map();
    this.requestId = 0;
    this.readyPromise = null;
    this.child = null;
  }

  start() {
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = new Promise((resolve, reject) => {
      let settled = false;
      const child = spawn(
        resolvePython(),
        [path.join(__dirname, "proof-ocr-paddle.py")],
        {
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
          env: {
            ...process.env,
            DRFT_OCR_CACHE_DIR: this.cacheDir,
            PYTHONIOENCODING: "utf-8",
            PYTHONUTF8: "1",
          },
        },
      );
      this.child = child;
      const output = readline.createInterface({ input: child.stdout });
      output.on("line", (line) => {
        if (!line.startsWith("DRFT_JSON:")) return;
        let message;
        try {
          message = JSON.parse(line.slice("DRFT_JSON:".length));
        } catch {
          return;
        }
        if (message.type === "status") {
          this.onStatus?.(message);
        } else if (message.type === "ready") {
          settled = true;
          resolve();
        } else if (message.type === "progress") {
          this.pending.get(message.id)?.onProgress?.(message);
        } else if (message.type === "result") {
          const pending = this.pending.get(message.id);
          this.pending.delete(message.id);
          pending?.resolve(Array.isArray(message.notes) ? message.notes : []);
        } else if (message.type === "error") {
          const pending = this.pending.get(message.id);
          this.pending.delete(message.id);
          pending?.reject(
            new Error(message.message || "赤字を読み取れませんでした。"),
          );
        } else if (message.type === "fatal") {
          const error = new Error(
            message.message || "PaddleOCRを起動できませんでした。",
          );
          if (!settled) reject(error);
          this.failPending(error);
        }
      });
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr = `${stderr}${chunk}`.slice(-4000);
      });
      child.once("error", (error) => {
        if (!settled) reject(error);
        this.failPending(error);
      });
      child.once("exit", (code) => {
        const error = new Error(
          code === 0
            ? "PaddleOCRが終了しました。"
            : `PaddleOCRが異常終了しました（終了コード ${code}）。${stderr ? ` ${stderr.trim()}` : ""}`,
        );
        if (!settled) reject(error);
        this.failPending(error);
        this.child = null;
      });
    });
    return this.readyPromise;
  }

  failPending(error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  async recognize(pngBuffer, page, onProgress) {
    await this.start();
    const directory = await fsPromises.mkdtemp(
      path.join(os.tmpdir(), "drft-ocr-"),
    );
    const imagePath = path.join(directory, `page-${page}.png`);
    await fsPromises.writeFile(imagePath, pngBuffer);
    const id = ++this.requestId;
    try {
      return await new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject, onProgress });
        this.child.stdin.write(
          `${JSON.stringify({ id, page, imagePath })}\n`,
          (error) => {
            if (!error) return;
            this.pending.delete(id);
            reject(error);
          },
        );
      });
    } finally {
      await fsPromises.rm(directory, { recursive: true, force: true });
    }
  }

  async close() {
    const child = this.child;
    if (!child) return;
    child.stdin.write(`${JSON.stringify({ type: "close" })}\n`);
    child.stdin.end();
    await new Promise((resolve) => {
      if (!this.child) resolve();
      else child.once("exit", resolve);
    });
  }
}

function createPaddleProofRecognizer(options) {
  return new PaddleProofOcrSession(options);
}

module.exports = {
  PaddleProofOcrSession,
  createPaddleProofRecognizer,
  pythonCandidates,
  resolvePython,
};
