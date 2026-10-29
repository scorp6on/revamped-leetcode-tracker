import DOMPurify from "dompurify";
import { Marked } from "marked";
import { useMemo } from "react";
import { cn } from "../lib/utils";

const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

const marked = new Marked({
  gfm: true,
  breaks: true, // a new line in the box is a new line on screen
  renderer: {
    // Images keep their shape, are capped in height by CSS, and open full size on tap (#52).
    // No caption: the bracket text stays alt text for screen readers.
    image({ href, text }) {
      if (href.startsWith("uploading:")) return `<span class="note-uploading">Uploading image…</span>`;
      const src = escapeAttr(href);
      return `<a href="${src}" target="_blank" rel="noopener noreferrer" class="note-img"><img src="${src}" alt="${escapeAttr(text)}" loading="lazy"></a>`;
    },
  },
});

// Your notes in Markdown, turned into HTML and then cleaned, like problem statements (#53).
export function Markdown({ text, className }: { text: string; className?: string }) {
  const html = useMemo(
    () => DOMPurify.sanitize(marked.parse(text, { async: false }), { ADD_ATTR: ["target"] }),
    [text],
  );
  return <div className={cn("note", className)} dangerouslySetInnerHTML={{ __html: html }} />;
}
