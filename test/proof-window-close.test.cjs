const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { installProofCloseHandler } = require("../src/proof-window-close.cjs");

function fakeWindow(response) {
  const window = new EventEmitter();
  window.destroyed = false;
  window.closeCalls = 0;
  window.commitCalls = 0;
  window.isDestroyed = () => window.destroyed;
  window.proofCommit = () => {
    window.commitCalls += 1;
  };
  window.close = () => {
    window.closeCalls += 1;
    const event = {
      prevented: false,
      preventDefault() {
        this.prevented = true;
      },
    };
    window.emit("close", event);
    if (!event.prevented) window.destroyed = true;
  };
  const dialog = { showMessageBox: async () => ({ response }) };
  return { window, dialog };
}

test("右上の閉じるから反映して閉じられる", async () => {
  const { window, dialog } = fakeWindow(0);
  installProofCloseHandler(window, { dialog });
  window.close();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(window.commitCalls, 1);
  assert.equal(window.destroyed, true);
});

test("右上の閉じるから破棄して閉じられる", async () => {
  const { window, dialog } = fakeWindow(1);
  installProofCloseHandler(window, { dialog });
  window.close();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(window.commitCalls, 0);
  assert.equal(window.destroyed, true);
});

test("確認画面へ戻る場合はウィンドウを閉じない", async () => {
  const { window, dialog } = fakeWindow(2);
  installProofCloseHandler(window, { dialog });
  window.close();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(window.destroyed, false);
  assert.equal(window.closeCalls, 1);
});
