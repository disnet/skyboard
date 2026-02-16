import {
  EditorView,
  Decoration,
  type DecorationSet,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { syntaxTree } from "@codemirror/language";

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }

  toDOM(view: EditorView) {
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = this.checked;
    cb.className = "cm-task-checkbox";
    cb.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const pos = view.posAtDOM(cb);
      const line = view.state.doc.lineAt(pos);
      const match = line.text.match(/\[([ xX])\]/);
      if (match && match.index !== undefined) {
        const from = line.from + match.index;
        const to = from + match[0].length;
        const newText = this.checked ? "[ ]" : "[x]";
        view.dispatch({ changes: { from, to, insert: newText } });
      }
    });
    return cb;
  }

  eq(other: CheckboxWidget) {
    return this.checked === other.checked;
  }

  ignoreEvent() {
    return false;
  }
}

function buildDecorations(view: EditorView): DecorationSet {
  const decs: ReturnType<Decoration["range"]>[] = [];
  const { from: curFrom, to: curTo } = view.state.selection.main;

  for (const { from: visFrom, to: visTo } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from: visFrom,
      to: visTo,
      enter(nodeRef) {
        const { from, to, name } = nodeRef;

        // If cursor overlaps this node, show raw markdown
        if (curFrom <= to && curTo >= from) return;

        switch (name) {
          case "StrongEmphasis": {
            const marks = nodeRef.node.getChildren("EmphasisMark");
            if (marks.length >= 2) {
              const first = marks[0];
              const last = marks[marks.length - 1];
              decs.push(
                Decoration.replace({}).range(first.from, first.to),
                Decoration.replace({}).range(last.from, last.to),
                Decoration.mark({ class: "cm-md-bold" }).range(
                  first.to,
                  last.from,
                ),
              );
            }
            return false;
          }

          case "Emphasis": {
            const marks = nodeRef.node.getChildren("EmphasisMark");
            if (marks.length >= 2) {
              const first = marks[0];
              const last = marks[marks.length - 1];
              decs.push(
                Decoration.replace({}).range(first.from, first.to),
                Decoration.replace({}).range(last.from, last.to),
                Decoration.mark({ class: "cm-md-italic" }).range(
                  first.to,
                  last.from,
                ),
              );
            }
            return false;
          }

          case "InlineCode": {
            const marks = nodeRef.node.getChildren("CodeMark");
            if (marks.length >= 2) {
              const first = marks[0];
              const last = marks[marks.length - 1];
              decs.push(
                Decoration.replace({}).range(first.from, first.to),
                Decoration.replace({}).range(last.from, last.to),
                Decoration.mark({ class: "cm-md-code" }).range(
                  first.to,
                  last.from,
                ),
              );
            }
            return false;
          }

          case "Strikethrough": {
            const marks = nodeRef.node.getChildren("StrikethroughMark");
            if (marks.length >= 2) {
              const first = marks[0];
              const last = marks[marks.length - 1];
              decs.push(
                Decoration.replace({}).range(first.from, first.to),
                Decoration.replace({}).range(last.from, last.to),
                Decoration.mark({ class: "cm-md-strikethrough" }).range(
                  first.to,
                  last.from,
                ),
              );
            }
            return false;
          }

          case "ATXHeading1":
          case "ATXHeading2":
          case "ATXHeading3":
          case "ATXHeading4":
          case "ATXHeading5":
          case "ATXHeading6": {
            const level = parseInt(name.slice(-1));
            const headerMarks = nodeRef.node.getChildren("HeaderMark");
            if (headerMarks.length > 0) {
              const openMark = headerMarks[0];
              let contentStart = openMark.to;
              if (
                view.state.doc.sliceString(contentStart, contentStart + 1) ===
                " "
              ) {
                contentStart++;
              }
              decs.push(
                Decoration.replace({}).range(openMark.from, contentStart),
              );
              // Hide closing header mark if present
              if (headerMarks.length > 1) {
                const closeMark = headerMarks[headerMarks.length - 1];
                decs.push(
                  Decoration.replace({}).range(closeMark.from, closeMark.to),
                );
              }
              if (contentStart < to) {
                decs.push(
                  Decoration.mark({
                    class: `cm-md-heading cm-md-h${level}`,
                  }).range(contentStart, to),
                );
              }
            }
            return false;
          }

          case "TaskMarker": {
            const text = view.state.doc.sliceString(from, to);
            const checked = text.includes("x") || text.includes("X");
            decs.push(
              Decoration.replace({
                widget: new CheckboxWidget(checked),
              }).range(from, to),
            );
            return false;
          }

          case "FencedCode": {
            decs.push(
              Decoration.mark({ class: "cm-md-fenced-code" }).range(from, to),
            );
            break;
          }

          case "Link": {
            const linkMarks = nodeRef.node.getChildren("LinkMark");
            const urls = nodeRef.node.getChildren("URL");
            if (linkMarks.length >= 4 && urls.length > 0) {
              // [text](url) — hide [ and ](url), style text as link
              decs.push(
                Decoration.replace({}).range(
                  linkMarks[0].from,
                  linkMarks[0].to,
                ),
                Decoration.replace({}).range(
                  linkMarks[1].from,
                  linkMarks[linkMarks.length - 1].to,
                ),
                Decoration.mark({ class: "cm-md-link" }).range(
                  linkMarks[0].to,
                  linkMarks[1].from,
                ),
              );
            }
            return false;
          }
        }
      },
    });
  }

  return Decoration.set(decs, true);
}

const plugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

const theme = EditorView.baseTheme({
  ".cm-md-bold": { fontWeight: "700" },
  ".cm-md-italic": { fontStyle: "italic" },
  ".cm-md-code": {
    backgroundColor: "rgba(128, 128, 128, 0.15)",
    borderRadius: "3px",
    padding: "1px 3px",
    fontFamily: "monospace",
    fontSize: "0.9em",
  },
  ".cm-md-strikethrough": {
    textDecoration: "line-through",
    opacity: "0.7",
  },
  ".cm-md-heading": { fontWeight: "700", lineHeight: "1.3" },
  ".cm-md-h1": { fontSize: "1.5em" },
  ".cm-md-h2": { fontSize: "1.3em" },
  ".cm-md-h3": { fontSize: "1.15em" },
  ".cm-md-h4": { fontSize: "1.05em" },
  ".cm-md-h5": { fontSize: "1em" },
  ".cm-md-h6": { fontSize: "0.95em", opacity: "0.8" },
  ".cm-md-link": {
    color: "var(--color-primary, #3b82f6)",
    textDecoration: "underline",
  },
  ".cm-md-fenced-code": {
    backgroundColor: "rgba(128, 128, 128, 0.08)",
    borderRadius: "4px",
  },
  ".cm-task-checkbox": {
    cursor: "pointer",
    margin: "0 2px 0 0",
    verticalAlign: "middle",
    position: "relative",
    top: "-1px",
  },
});

const codeHighlight = HighlightStyle.define([
  { tag: [tags.link, tags.url], color: "var(--color-primary, #3b82f6)" },
  { tag: tags.keyword, color: "#8b5cf6" },
  { tag: tags.string, color: "#16a34a" },
  { tag: tags.comment, color: "#6b7280", fontStyle: "italic" },
  { tag: tags.number, color: "#d97706" },
  { tag: tags.bool, color: "#d97706" },
  { tag: tags.null, color: "#d97706" },
  { tag: tags.function(tags.variableName), color: "#2563eb" },
  { tag: tags.typeName, color: "#0d9488" },
  { tag: tags.className, color: "#0d9488" },
  { tag: tags.operator, color: "#dc2626" },
  { tag: tags.propertyName, color: "#2563eb" },
  { tag: tags.definition(tags.variableName), color: "#2563eb" },
  { tag: tags.angleBracket, color: "#6b7280" },
  { tag: tags.tagName, color: "#dc2626" },
  { tag: tags.attributeName, color: "#d97706" },
  { tag: tags.attributeValue, color: "#16a34a" },
  { tag: tags.regexp, color: "#d97706" },
  { tag: tags.self, color: "#8b5cf6" },
]);

export const markdownLivePreview = [
  plugin,
  theme,
  syntaxHighlighting(codeHighlight),
];
