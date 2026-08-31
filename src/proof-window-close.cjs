function installProofCloseHandler(
  proofWindow,
  { dialog, isQuitting = () => false },
) {
  proofWindow.proofAllowClose = false;
  proofWindow.proofClosePromptPending = false;
  proofWindow.on("close", (event) => {
    if (proofWindow.proofAllowClose || isQuitting()) return;
    event.preventDefault();
    if (proofWindow.proofClosePromptPending) return;
    proofWindow.proofClosePromptPending = true;
    dialog
      .showMessageBox(proofWindow, {
        type: "question",
        message: "ゲラの反映内容を本原稿へ反映しますか？",
        detail: "反映前の原稿はスナップショットに保存されています。",
        buttons: ["反映して閉じる", "破棄して閉じる", "戻る"],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
      })
      .then(({ response }) => {
        if (proofWindow.isDestroyed() || response === 2) return;
        if (response === 0) proofWindow.proofCommit?.();
        proofWindow.proofAllowClose = true;
        proofWindow.close();
      })
      .finally(() => {
        if (!proofWindow.isDestroyed())
          proofWindow.proofClosePromptPending = false;
      });
  });
}

module.exports = { installProofCloseHandler };
