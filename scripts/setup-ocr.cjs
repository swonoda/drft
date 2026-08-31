const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const runtimeDir =
  process.env.DRFT_OCR_RUNTIME ||
  path.join(
    process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
    "DRFT",
    "ocr-runtime",
  );
const venvPython = path.join(
  runtimeDir,
  process.platform === "win32" ? "Scripts" : "bin",
  process.platform === "win32" ? "python.exe" : "python",
);

function launch(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    windowsHide: true,
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `${command} が終了コード ${result.status} で失敗しました。`,
    );
}

function findPython() {
  const bundled = path.join(
    os.homedir(),
    ".cache",
    "codex-runtimes",
    "codex-primary-runtime",
    "dependencies",
    "python",
    process.platform === "win32" ? "python.exe" : "bin/python",
  );
  const candidates = [
    process.env.PYTHON ? [process.env.PYTHON, []] : null,
    fs.existsSync(bundled) ? [bundled, []] : null,
    process.platform === "win32" ? ["py", ["-3"]] : null,
    ["python3", []],
    ["python", []],
  ].filter(Boolean);
  for (const [command, prefix] of candidates) {
    const result = spawnSync(
      command,
      [...prefix, "-c", "import sys; print(sys.executable)"],
      {
        encoding: "utf8",
        windowsHide: true,
        shell: false,
      },
    );
    if (result.status === 0) return { command, prefix };
  }
  throw new Error(
    "Python 3が見つかりません。Python 3.12をインストールしてから、もう一度実行してください。",
  );
}

try {
  if (!fs.existsSync(venvPython)) {
    const python = findPython();
    console.log(`赤ゲラ検出専用環境を準備します: ${runtimeDir}`);
    launch(python.command, [...python.prefix, "-m", "venv", runtimeDir]);
  }
  console.log(
    "OpenCVをインストールしています。少し時間がかかることがあります。",
  );
  launch(venvPython, [
    "-m",
    "pip",
    "install",
    "--disable-pip-version-check",
    "opencv-python-headless>=4.10,<5",
  ]);
  console.log(
    "変更箇所検出の準備が完了しました。npm startでDRFTを起動できます。",
  );
} catch (error) {
  console.error(`変更箇所検出の準備に失敗しました: ${error.message}`);
  process.exitCode = 1;
}
