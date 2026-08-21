const { app, Menu } = require("electron");

function installApplicationMenu({
  sendMenuCommand,
  saveFocusedDocument,
  openDictionaryWindow,
}) {
  const replaceAccelerator =
    process.platform === "darwin" ? "Cmd+Alt+F" : "Ctrl+H";
  const template = [
    ...(process.platform === "darwin"
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    {
      label: "ファイル",
      submenu: [
        {
          label: "新規作成",
          accelerator: "CmdOrCtrl+N",
          click: () => sendMenuCommand("new"),
        },
        {
          label: "開く…",
          accelerator: "CmdOrCtrl+O",
          click: () => sendMenuCommand("open"),
        },
        { type: "separator" },
        {
          label: "保存",
          accelerator: "CmdOrCtrl+S",
          click: saveFocusedDocument,
        },
        {
          label: "名前をつけて保存…",
          accelerator: "CmdOrCtrl+Shift+S",
          click: () => sendMenuCommand("save-as"),
        },
        {
          label: "スナップショットを保存…",
          click: () => sendMenuCommand("snapshot"),
        },
        { type: "separator" },
        {
          label: "エクスポート",
          submenu: [
            {
              label: "PDF出力…",
              accelerator: "CmdOrCtrl+Shift+P",
              click: () => sendMenuCommand("pdf"),
            },
            {
              label: "EPUB出力…",
              click: () => sendMenuCommand("epub"),
            },
          ],
        },
        ...(process.platform === "darwin"
          ? [{ type: "separator" }, { role: "close" }]
          : [{ type: "separator" }, { role: "quit" }]),
      ],
    },
    {
      label: "編集",
      submenu: [
        { role: "undo", label: "元に戻す" },
        { role: "redo", label: "やり直す" },
        { type: "separator" },
        { role: "cut", label: "切り取り" },
        { role: "copy", label: "コピー" },
        { role: "paste", label: "貼り付け" },
        { role: "selectAll", label: "すべて選択" },
        { type: "separator" },
        {
          label: "検索…",
          accelerator: "CmdOrCtrl+F",
          click: () => sendMenuCommand("find"),
        },
        {
          label: "置換…",
          accelerator: replaceAccelerator,
          click: () => sendMenuCommand("replace"),
        },
      ],
    },
    {
      label: "表示",
      submenu: [
        {
          label: "構成を表示／非表示",
          accelerator: "CmdOrCtrl+Alt+O",
          click: () => sendMenuCommand("toggle-outline"),
        },
        {
          label: "縦書きプレビューを表示／非表示",
          accelerator: "CmdOrCtrl+Shift+V",
          click: () => sendMenuCommand("toggle-preview"),
        },
        { type: "separator" },
        {
          label: "表示設定…",
          click: () => sendMenuCommand("settings"),
        },
        {
          label: "辞書",
          accelerator: "CmdOrCtrl+Shift+D",
          click: openDictionaryWindow,
        },
        { type: "separator" },
        { role: "togglefullscreen", label: "フルスクリーン" },
      ],
    },
    {
      label: "ツール",
      submenu: [
        {
          label: "ファイルを比較…",
          click: () => sendMenuCommand("compare"),
        },
        {
          label: "組版を調整…",
          click: () => sendMenuCommand("adjust-layout"),
        },
      ],
    },
    {
      label: "ウィンドウ",
      submenu: [
        { role: "minimize", label: "最小化" },
        ...(process.platform === "darwin"
          ? [{ role: "zoom", label: "拡大／縮小" }, { role: "front" }]
          : []),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { installApplicationMenu };
