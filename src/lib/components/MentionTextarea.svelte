<script lang="ts">
  import { untrack } from "svelte";
  import { EditorView, basicSetup } from "codemirror";
  import { EditorState, Compartment } from "@codemirror/state";
  import { markdown } from "@codemirror/lang-markdown";
  import { languages } from "@codemirror/language-data";
  import { indentWithTab } from "@codemirror/commands";
  import { keymap, placeholder as cmPlaceholder } from "@codemirror/view";
  import { autocompletion } from "@codemirror/autocomplete";
  import { mentionCompletionSource } from "$lib/mention-completions.js";
  import { markdownLivePreview } from "$lib/markdown-live-preview.js";

  let {
    value = $bindable(""),
    placeholder = "",
    maxlength,
    disabled = false,
  }: {
    value?: string;
    placeholder?: string;
    maxlength?: number;
    disabled?: boolean;
  } = $props();

  let container: HTMLDivElement | undefined = $state();
  let editorView: EditorView | undefined;
  let updatingFromProp = false;
  const editableCompartment = new Compartment();

  $effect(() => {
    if (!container) return;

    const initialDoc = untrack(() => value);
    const isDisabled = untrack(() => disabled);
    const state = EditorState.create({
      doc: initialDoc,
      extensions: [
        basicSetup,
        markdown({ codeLanguages: languages }),
        EditorView.lineWrapping,
        keymap.of([indentWithTab]),
        cmPlaceholder(placeholder),
        autocompletion({ override: [mentionCompletionSource] }),
        markdownLivePreview,
        editableCompartment.of(EditorView.editable.of(!isDisabled)),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !updatingFromProp) {
            value = update.state.doc.toString();
          }
        }),
        EditorView.theme({
          "&": {
            fontSize: "0.8125rem",
            maxHeight: "20vh",
          },
          ".cm-scroller": {
            overflow: "auto",
            fontFamily: "inherit",
          },
          ".cm-content": {
            caretColor: "var(--color-primary)",
            padding: "0.375rem 0",
          },
          "&.cm-focused": {
            outline: "none",
          },
          ".cm-gutters": {
            display: "none",
          },
          ".cm-activeLine": {
            backgroundColor: "transparent",
          },
        }),
      ],
    });

    editorView = new EditorView({
      state,
      parent: container,
    });

    return () => {
      editorView?.destroy();
      editorView = undefined;
    };
  });

  // Sync external value changes (e.g. clearing after submit) into the editor
  $effect(() => {
    const currentValue = value;
    if (!editorView) return;
    const editorContent = editorView.state.doc.toString();
    if (currentValue !== editorContent) {
      updatingFromProp = true;
      editorView.dispatch({
        changes: { from: 0, to: editorView.state.doc.length, insert: currentValue },
      });
      updatingFromProp = false;
    }
  });

  // Sync disabled state
  $effect(() => {
    if (!editorView) return;
    editorView.dispatch({
      effects: editableCompartment.reconfigure(EditorView.editable.of(!disabled)),
    });
  });
</script>

<div class="mention-textarea-wrapper">
  <div
    class="editor-wrapper"
    class:disabled
    bind:this={container}
  ></div>
</div>

<style>
  .mention-textarea-wrapper {
    position: relative;
    width: 100%;
  }

  .editor-wrapper {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    overflow: hidden;
    min-height: 2.5rem;
    background: var(--color-surface);
  }

  .editor-wrapper:focus-within {
    border-color: var(--color-primary);
  }

  .editor-wrapper.disabled {
    opacity: 0.6;
    pointer-events: none;
  }
</style>
