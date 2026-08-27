const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFile, spawnSync } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

function runtimeDirectory() {
  return (
    process.env.DRFT_PROOF_RUNTIME ||
    process.env.DRFT_OCR_RUNTIME ||
    path.join(
      process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
      "DRFT",
      "ocr-runtime",
    )
  );
}

function pythonCandidates() {
  const executable = process.platform === "win32" ? "python.exe" : "python";
  const runtimePython = path.join(
    runtimeDirectory(),
    process.platform === "win32" ? "Scripts" : "bin",
    executable,
  );
  return [
    process.env.DRFT_PROOF_PYTHON,
    fs.existsSync(runtimePython) ? runtimePython : null,
    process.env.PYTHON,
    process.platform === "win32" ? "python" : "python3",
    "python",
  ].filter(Boolean);
}

function resolveOpenCvPython() {
  for (const candidate of [...new Set(pythonCandidates())]) {
    const result = spawnSync(
      candidate,
      ["-c", "import cv2, numpy; print(cv2.__version__)"],
      { encoding: "utf8", windowsHide: true, shell: false },
    );
    if (result.status === 0) return candidate;
  }
  throw new Error(
    "変更箇所の検出環境がありません。npm run proof:setup を一度実行してください。",
  );
}

async function locateProofMarks(pngBuffer, { words = [] } = {}) {
  const directory = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "drft-proof-location-"),
  );
  const imagePath = path.join(directory, "page.png");
  const requestPath = path.join(directory, "request.json");
  try {
    await Promise.all([
      fsPromises.writeFile(imagePath, pngBuffer),
      fsPromises.writeFile(requestPath, JSON.stringify({ words }), "utf8"),
    ]);
    const python = resolveOpenCvPython();
    const script = path.join(__dirname, "proof-location-opencv.py");
    const { stdout, stderr } = await execFileAsync(
      python,
      [script, imagePath, requestPath],
      {
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true,
      },
    );
    const result = JSON.parse(stdout);
    if (!result || !Array.isArray(result.locations)) {
      throw new Error(
        stderr.trim() || "OpenCVから検出結果を受け取れませんでした。",
      );
    }
    return result;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("OpenCVから受け取った検出結果が壊れています。");
    }
    throw error;
  } finally {
    await fsPromises.rm(directory, { recursive: true, force: true });
  }
}

module.exports = { locateProofMarks, resolveOpenCvPython, runtimeDirectory };
