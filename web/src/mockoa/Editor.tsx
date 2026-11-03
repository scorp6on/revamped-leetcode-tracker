import { indentWithTab } from "@codemirror/commands";
import { python } from "@codemirror/lang-python";
import { HighlightStyle, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "react";

// LeetCode-style colors (#62), from CSS variables so they follow the light / dark toggle.
const colors = HighlightStyle.define([
  { tag: [t.controlKeyword, t.moduleKeyword], color: "var(--syn-keyword)" },
  { tag: [t.definitionKeyword, t.keyword, t.operatorKeyword, t.bool, t.null], color: "var(--syn-def)" },
  { tag: [t.function(t.variableName), t.function(t.definition(t.variableName)), t.function(t.propertyName)], color: "var(--syn-function)" },
  { tag: [t.className, t.definition(t.className), t.typeName], color: "var(--syn-type)" },
  { tag: t.number, color: "var(--syn-number)" },
  { tag: [t.string, t.special(t.string)], color: "var(--syn-string)" },
  { tag: [t.comment, t.lineComment], color: "var(--syn-comment)", fontStyle: "normal" },
  { tag: t.self, color: "var(--syn-self)" },
]);

const look = EditorView.theme({
  "&": { fontSize: "13px", backgroundColor: "var(--subtle)", color: "var(--foreground)", height: "100%" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "'Geist Mono Variable', ui-monospace, monospace", lineHeight: "1.65" },
  ".cm-gutters": { backgroundColor: "var(--subtle)", color: "var(--muted-foreground)", border: "none" },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "color-mix(in srgb, var(--foreground) 5%, transparent)" },
  ".cm-cursor": { borderLeftColor: "var(--foreground)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in srgb, var(--foreground) 18%, transparent) !important",
  },
  ".cm-content": { caretColor: "var(--foreground)" },
});

// The Python editor (CodeMirror 6, #62): light enough for phones, Tab indents by 4 spaces.
export function Editor({
  value,
  onChange,
  readOnly = false,
  label,
}: {
  value: string;
  onChange: (code: string) => void;
  readOnly?: boolean;
  label: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>(null);
  const changed = useRef(onChange);
  changed.current = onChange;

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          python(),
          indentUnit.of("    "),
          keymap.of([indentWithTab]),
          syntaxHighlighting(colors),
          look,
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
          EditorView.contentAttributes.of({ "aria-label": label, autocapitalize: "off", autocorrect: "off", spellcheck: "false" }),
          EditorView.updateListener.of((u) => u.docChanged && changed.current(u.state.doc.toString())),
        ],
      }),
    });
    view.current = v;
    return () => v.destroy();
    // A new editor per problem or lock state; typing never re-creates it (value is read once here).
  }, [readOnly, label]);

  // A new value from outside (switching problems, the server's copy): replace the text.
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  return <div ref={host} className="h-full min-h-[280px] overflow-hidden rounded-b-[10px] text-left" />;
}
