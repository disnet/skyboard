import {
  EditorView,
  showTooltip,
  keymap,
  type Tooltip,
} from "@codemirror/view";
import { StateField, Prec } from "@codemirror/state";

const isMac =
  typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
const mod = isMac ? "\u2318" : "Ctrl+";

interface FormatAction {
  label: string;
  title: string;
  marker: string;
  kind: "wrap" | "link";
}

const FORMAT_ACTIONS: FormatAction[] = [
  { label: "B", title: `Bold (${mod}B)`, marker: "**", kind: "wrap" },
  { label: "I", title: `Italic (${mod}I)`, marker: "*", kind: "wrap" },
  { label: "<>", title: `Code (${mod}E)`, marker: "`", kind: "wrap" },
  {
    label: "S",
    title: `Strikethrough (${mod}Shift+X)`,
    marker: "~~",
    kind: "wrap",
  },
  { label: "Link", title: `Link (${mod}K)`, marker: "", kind: "link" },
];

/** Find the word boundaries around the cursor position. */
function wordAt(
  view: EditorView,
  pos: number,
): { from: number; to: number } | null {
  const line = view.state.doc.lineAt(pos);
  const text = line.text;
  const offset = pos - line.from;
  if (
    (offset > 0 && /\w/.test(text[offset - 1])) ||
    (offset < text.length && /\w/.test(text[offset]))
  ) {
    let start = offset;
    let end = offset;
    while (start > 0 && /\w/.test(text[start - 1])) start--;
    while (end < text.length && /\w/.test(text[end])) end++;
    return { from: line.from + start, to: line.from + end };
  }
  return null;
}

function applyFormat(view: EditorView, action: FormatAction) {
  let { from, to } = view.state.selection.main;
  const hasSelection = from !== to;

  // No selection: expand to the word at cursor
  if (!hasSelection) {
    const word = wordAt(view, from);
    if (word) {
      from = word.from;
      to = word.to;
    }
  }

  const selected = view.state.doc.sliceString(from, to);
  const isEmpty = from === to;

  if (action.kind === "link") {
    if (!isEmpty) {
      const replacement = `[${selected}](url)`;
      view.dispatch({
        changes: { from, to, insert: replacement },
        selection: {
          anchor: from + selected.length + 3,
          head: from + selected.length + 6,
        },
      });
    } else {
      view.dispatch({
        changes: { from, to: from, insert: "[](url)" },
        selection: { anchor: from + 1 },
      });
    }
    view.focus();
    return;
  }

  const m = action.marker;
  const len = m.length;

  // Check if already wrapped — look at surrounding text
  const before = view.state.doc.sliceString(Math.max(0, from - len), from);
  const after = view.state.doc.sliceString(
    to,
    Math.min(view.state.doc.length, to + len),
  );

  if (before === m && after === m) {
    // Toggle off: remove the surrounding markers
    view.dispatch({
      changes: [
        { from: from - len, to: from, insert: "" },
        { from: to, to: to + len, insert: "" },
      ],
      selection: { anchor: from - len, head: isEmpty ? from - len : to - len },
    });
  } else if (!isEmpty) {
    const replacement = `${m}${selected}${m}`;
    view.dispatch({
      changes: { from, to, insert: replacement },
      selection: { anchor: from + len, head: to + len },
    });
  } else {
    // Cursor not near a word: insert markers and place cursor between them
    view.dispatch({
      changes: { from, to: from, insert: `${m}${m}` },
      selection: { anchor: from + len },
    });
  }
  view.focus();
}

function createToolbarDOM(view: EditorView): HTMLElement {
  const container = document.createElement("div");
  container.className = "cm-formatting-toolbar";

  for (const action of FORMAT_ACTIONS) {
    const btn = document.createElement("button");
    btn.className = "cm-fmt-btn";
    btn.textContent = action.label;
    btn.title = action.title;
    if (action.label === "B") btn.style.fontWeight = "700";
    if (action.label === "I") btn.style.fontStyle = "italic";
    if (action.label === "S") btn.style.textDecoration = "line-through";
    btn.onmousedown = (e) => {
      e.preventDefault(); // Prevent editor from losing focus/selection
      applyFormat(view, action);
    };
    container.appendChild(btn);
  }

  return container;
}

const toolbarTooltip = StateField.define<Tooltip | null>({
  create() {
    return null;
  },
  update(value, tr) {
    const sel = tr.state.selection.main;
    if (sel.empty) return null;
    // Only show if the editor is focused
    if (!tr.state.facet(EditorView.editable)) return null;
    return {
      pos: sel.from,
      end: sel.to,
      above: true,
      arrow: true,
      create: (view: EditorView) => ({
        dom: createToolbarDOM(view),
      }),
    };
  },
  provide: (f) => showTooltip.from(f),
});

const toolbarTheme = EditorView.baseTheme({
  // Override CodeMirror's default tooltip background/border on our toolbar
  ".cm-tooltip.cm-formatting-toolbar": {
    display: "flex",
    gap: "2px",
    padding: "3px 4px",
    background: "#1e1e1e",
    border: "none",
    borderRadius: "6px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
    color: "#e0e0e0",
  },
  ".cm-formatting-toolbar .cm-fmt-btn": {
    border: "none",
    background: "transparent",
    color: "#e0e0e0",
    fontSize: "13px",
    fontFamily: "inherit",
    padding: "2px 7px",
    borderRadius: "4px",
    cursor: "pointer",
    lineHeight: "1.4",
    minWidth: "26px",
    textAlign: "center",
  },
  ".cm-formatting-toolbar .cm-fmt-btn:hover": {
    background: "rgba(255,255,255,0.15)",
    color: "#fff",
  },
  // Arrow color matching toolbar background
  ".cm-tooltip-above.cm-formatting-toolbar .cm-tooltip-arrow::before": {
    borderTopColor: "#1e1e1e",
  },
  ".cm-tooltip-above.cm-formatting-toolbar .cm-tooltip-arrow::after": {
    borderTopColor: "#1e1e1e",
  },
  ".cm-tooltip-below.cm-formatting-toolbar .cm-tooltip-arrow::before": {
    borderBottomColor: "#1e1e1e",
  },
  ".cm-tooltip-below.cm-formatting-toolbar .cm-tooltip-arrow::after": {
    borderBottomColor: "#1e1e1e",
  },
});

const formatKeymap = Prec.high(
  keymap.of([
    {
      key: "Mod-b",
      run: (view) => {
        applyFormat(view, FORMAT_ACTIONS[0]);
        return true;
      },
    },
    {
      key: "Mod-i",
      run: (view) => {
        applyFormat(view, FORMAT_ACTIONS[1]);
        return true;
      },
    },
    {
      key: "Mod-e",
      run: (view) => {
        applyFormat(view, FORMAT_ACTIONS[2]);
        return true;
      },
    },
    {
      key: "Mod-Shift-x",
      run: (view) => {
        applyFormat(view, FORMAT_ACTIONS[3]);
        return true;
      },
    },
    {
      key: "Mod-k",
      run: (view) => {
        applyFormat(view, FORMAT_ACTIONS[4]);
        return true;
      },
    },
  ]),
);

export { formatKeymap as formattingKeymap };
export const formattingToolbar = [toolbarTooltip, toolbarTheme, formatKeymap];
