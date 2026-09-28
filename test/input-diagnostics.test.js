import test from 'node:test';
import assert from 'node:assert/strict';
import { createInputDiagnostics } from '../src/input-diagnostics.js';

test('diagnostics are opt-in, bounded, text-free and preserve actions', async () => {
  const elements = [];
  const intervals = new Set();
  const frames = [];
  class Element {
    children = []; listeners = {}; style = {}; attrs = {};
    append(...nodes) { this.children.push(...nodes); }
    setAttribute(k, v) { this.attrs[k] = v; }
    addEventListener(k, f) { this.listeners[k] = f; }
  }
  const footer = new Element();
  const body = new Element();
  const originals = Object.fromEntries(['document', 'setInterval', 'clearInterval', 'requestAnimationFrame'].map(k => [k, globalThis[k]]));
  globalThis.document = { hidden: false, body, createElement() { const e = new Element(); elements.push(e); return e; }, getElementById() { return { parentElement: footer }; }, addEventListener() {} };
  globalThis.setInterval = fn => { intervals.add(fn); return fn; };
  globalThis.clearInterval = fn => intervals.delete(fn);
  globalThis.requestAnimationFrame = fn => frames.push(fn);
  try {
    const editor = new Element();
    const d = createInputDiagnostics(editor);
    assert.equal(intervals.size, 0);
    assert.equal(d.measure('result', () => 42), 42);
    const button = footer.children[0];
    const panel = body.children[0];
    const [note, copy, clear, close, output] = panel.children;
    button.onclick();
    assert.equal(intervals.size, 1);
    assert.equal(panel.hidden, false);
    const text = '原稿の秘密'.repeat(40817).slice(0, 204084);
    for (let i = 0; i < 200; i++) editor.listeners.input({ data: text, timeStamp: performance.now(), isComposing: true });
    d.measure('全文解析', () => text.split('\n'));
    assert.throws(() => d.measure('例外', () => { throw new Error('test'); }), /test/);
    for (const f of intervals) f();
    assert.match(output.textContent, /全文解析/);
    assert.match(output.textContent, /変換中/);
    assert.doesNotMatch(output.textContent, /原稿の秘密/);
    assert.ok(output.textContent.split('直近の履歴\n')[1].split('\n').length <= 100);
    assert.equal(frames.length, 1);
    const stale = d.begin();
    close.onclick();
    assert.equal(intervals.size, 0);
    assert.equal(panel.hidden, true);
    button.onclick();
    frames.shift()();
    d.end('古い計測', stale);
    for (const f of intervals) f();
    assert.doesNotMatch(output.textContent, /古い計測|入力→次フレーム/);
    clear.onclick();
    assert.doesNotMatch(output.textContent, /全文解析/);
    close.onclick();
  } finally { Object.assign(globalThis, originals); }
});
