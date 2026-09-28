// Opt-in diagnostics. Never record manuscript text, event.data or printable keys.
export function createInputDiagnostics(editor) {
  let enabled = false;
  let generation = 0;
  let timer;
  let observer;
  let framePending = false;
  let rows = [];
  const stats = new Map();
  const button = document.createElement('button');
  button.textContent = '入力診断';
  button.type = 'button';
  button.setAttribute('aria-expanded', 'false');
  document.getElementById('state').parentElement.append(button);
  const panel = document.createElement('section');
  panel.hidden = true;
  panel.setAttribute('aria-label', '入力診断');
  panel.style.cssText = 'position:fixed;right:12px;bottom:44px;width:480px;max-width:90vw;height:330px;overflow:auto;z-index:10000;background:#fff;color:#111;border:1px solid #777;padding:12px;font:12px/1.5 monospace;box-shadow:0 2px 12px #0003;contain:content';
  const note = document.createElement('div');
  note.textContent = '処理時間と直近の履歴（ms）。停止中は表示も止まり、復帰後に記録します。原稿・入力文字は記録しません。';
  const copy = document.createElement('button');
  copy.textContent = '診断をコピー';
  const clear = document.createElement('button');
  clear.textContent = '履歴を消去';
  const close = document.createElement('button');
  close.textContent = '診断を停止';
  const output = document.createElement('pre');
  output.style.cssText = 'white-space:pre-wrap;font:inherit;margin:8px 0';
  panel.append(note, copy, clear, close, output);
  document.body.append(panel);

  function record(name, duration = null) {
    if (!enabled) return;
    const at = performance.now();
    rows.push(`${at.toFixed(0)}ms ${name}${duration === null ? '' : `: ${duration.toFixed(1)}ms`}`);
    if (rows.length > 100) rows.shift();
    if (duration !== null) {
      const stat = stats.get(name) || { count: 0, max: 0, last: 0 };
      stat.count++;
      stat.last = duration;
      stat.max = Math.max(stat.max, duration);
      stats.set(name, stat);
    }
  }
  function report() {
    return 'DRFT 入力診断\n時間は起動からの経過 / 各計測は重複あり\n' +
      [...stats].map(([name, s]) => `${name}: 最新 ${s.last.toFixed(1)} / 最大 ${s.max.toFixed(1)} / ${s.count}回`).join('\n') +
      '\n\n直近の履歴\n' + rows.join('\n');
  }
  function stop() {
    enabled = false;
    generation++;
    clearInterval(timer);
    observer?.disconnect();
    observer = null;
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  }
  function start() {
    enabled = true;
    generation++;
    framePending = false;
    rows = [];
    stats.clear();
    panel.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    record('診断開始');
    let previous = performance.now();
    timer = setInterval(() => {
      const now = performance.now();
      if (!document.hidden) {
        const lag = now - previous - 500;
        if (lag > 50) record('イベントループ遅延（原因未特定）', lag);
        output.textContent = report();
      }
      previous = now;
    }, 500);
    if (globalThis.PerformanceObserver?.supportedEntryTypes?.includes('longtask')) {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) record('長時間タスク（原因未特定）', entry.duration);
      });
      observer.observe({ type: 'longtask' });
    }
    output.textContent = report();
  }
  button.onclick = () => enabled ? stop() : start();
  close.onclick = stop;
  clear.onclick = () => { rows = []; stats.clear(); output.textContent = report(); };
  copy.onclick = async () => {
    try { await navigator.clipboard.writeText(report()); copy.textContent = 'コピー済み'; }
    catch { copy.textContent = 'コピー失敗：下の履歴を選択してください'; }
  };
  for (const type of ['keydown', 'beforeinput', 'input', 'compositionstart', 'compositionupdate', 'compositionend']) {
    editor.addEventListener(type, (event) => {
      if (!enabled) return;
      const key = type === 'keydown' ? (event.code === 'Space' ? ' Space' : event.code === 'Enter' ? ' Enter' : ' その他') : '';
      record(`${type}${key}${event.isComposing ? '（変換中）' : ''}`);
      const delay = performance.now() - event.timeStamp;
      if (delay >= 0 && delay < 60000) record('イベント到着遅延', delay);
      if (!framePending) {
        framePending = true;
        const since = performance.now();
        const session = generation;
        requestAnimationFrame(() => {
          if (!enabled || generation !== session) return;
          framePending = false;
          record('入力→次フレーム（描画完了ではない）', performance.now() - since);
        });
      }
    }, { capture: true });
  }
  document.addEventListener('visibilitychange', () => {
    if (enabled) record(document.hidden ? '画面非表示' : '画面復帰');
  });
  return {
    begin() { return enabled ? { at: performance.now(), generation } : null; },
    end(name, token) {
      if (token && enabled && token.generation === generation) record(name, performance.now() - token.at);
    },
    measure(name, action) {
      if (!enabled) return action();
      const token = this.begin();
      try { return action(); } finally { this.end(name, token); }
    },
  };
}
