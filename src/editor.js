import { EditorState, Transaction } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import {
  standardKeymap,
  insertNewline,
  history,
  historyKeymap,
  isolateHistory,
  redo,
  selectAll,
  undo,
} from "@codemirror/commands";

// The entire manuscript lives in CM's document. Only its visible portion is DOM.
export function createManuscriptEditor(parent, { onChange, onSelection } = {}) {
  let cachedDoc, cachedText;
  const extensions = [
    history(),
    keymap.of([
      { key: "Enter", run: insertNewline, shift: insertNewline },
      ...historyKeymap,
      ...standardKeymap,
    ]),
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({
      spellcheck: "false",
      "aria-label": "本文",
    }),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) onChange?.();
      if (update.selectionSet && !update.docChanged) onSelection?.();
    }),
  ];
  const view = new EditorView({
    parent,
    state: EditorState.create({ extensions }),
  });
  function replace(from, to, text) {
    const insert = view.state.toText(text);
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + insert.length },
      annotations: [
        Transaction.userEvent.of("input.replace"),
        isolateHistory.of("full"),
      ],
    });
  }
  return {
    dom: view.dom,
    contentDOM: view.contentDOM,
    get value() {
      if (cachedDoc !== view.state.doc) {
        cachedDoc = view.state.doc;
        cachedText = cachedDoc.toString();
      }
      return cachedText;
    },
    set value(text) {
      if (text !== this.value) replace(0, view.state.doc.length, text);
    },
    // Opening another file starts a new undo history and does not mark it dirty.
    loadDocument(text) {
      view.setState(EditorState.create({ doc: text, extensions }));
    },
    get selectionStart() {
      return view.state.selection.main.from;
    },
    get selectionEnd() {
      return view.state.selection.main.to;
    },
    setSelectionRange(start, end = start) {
      const limit = (pos) => Math.max(0, Math.min(pos, view.state.doc.length));
      view.dispatch({ selection: { anchor: limit(start), head: limit(end) } });
    },
    setRangeText(text) {
      replace(this.selectionStart, this.selectionEnd, text);
    },
    lineStart(index) {
      return view.state.doc.line(
        Math.max(1, Math.min(index + 1, view.state.doc.lines)),
      ).from;
    },
    reveal(start, end = start) {
      this.setSelectionRange(start, end);
      view.dispatch({
        effects: EditorView.scrollIntoView(start, { y: "center" }),
      });
      view.focus();
    },
    destroy() {
      view.destroy();
    },
    focus() {
      view.focus();
    },
    requestMeasure() {
      view.requestMeasure();
    },
    runCommand(command) {
      return { undo, redo, selectAll }[command]?.(view) ?? false;
    },
  };
}
