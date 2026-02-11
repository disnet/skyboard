import { EditorView, showTooltip, type Tooltip } from "@codemirror/view";
import { StateField } from "@codemirror/state";

interface FormatAction {
  label: string;
  title: string;
  marker: string;
  kind: "wrap" | "link";
}

const FORMAT_ACTIONS: FormatAction[] = [
  { label: "B", title: "Bold", marker: "**", kind: "wrap" },
  { label: "I", title: "Italic", marker: "*", kind: "wrap" },
  { label: "<>", title: "Code", marker: "`", kind: "wrap" },
  { label: "S", title: "Strikethrough", marker: "~~", kind: "wrap" },
  { label: "Link", title: "Link", marker: "", kind: "link" },
];

function applyFormat(view: EditorView, action: FormatAction) {
  const { from, to } = view.state.selection.main;
  if (from === to) return;

  const selected = view.state.doc.sliceString(from, to);

  if (action.kind === "link") {
    const replacement = `[${selected}](url)`;
    view.dispatch({
      changes: { from, to, insert: replacement },
      // Place cursor selecting "url" inside the parens
      selection: { anchor: from + selected.length + 3, head: from + selected.length + 6 },
    });
    view.focus();
    return;
  }

  const m = action.marker;
  const len = m.length;

  // Check if already wrapped — look at surrounding text
  const before = view.state.doc.sliceString(Math.max(0, from - len), from);
  const after = view.state.doc.sliceString(to, Math.min(view.state.doc.length, to + len));

  if (before === m && after === m) {
    // Toggle off: remove the surrounding markers
    view.dispatch({
      changes: [
        { from: from - len, to: from, insert: "" },
        { from: to, to: to + len, insert: "" },
      ],
      selection: { anchor: from - len, head: to - len },
    });
  } else {
    // Wrap selection with markers
    const replacement = `${m}${selected}${m}`;
    view.dispatch({
      changes: { from, to, insert: replacement },
      selection: { anchor: from + len, head: to + len },
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

export const formattingToolbar = [toolbarTooltip, toolbarTheme];
