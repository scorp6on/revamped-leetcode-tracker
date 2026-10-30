// Text edits behind the note toolbar (#51). Pure: they take the text and the selection and
// return the new text and selection, so the editor just applies the result.

export interface Edit {
  text: string;
  start: number; // selection start
  end: number; // selection end
}

// **bold** / _italic_ / `code`. With nothing selected, the cursor lands between the markers.
export function wrap({ text, start, end }: Edit, marker: string): Edit {
  const inner = text.slice(start, end);
  return {
    text: text.slice(0, start) + marker + inner + marker + text.slice(end),
    start: start + marker.length,
    end: end + marker.length,
  };
}

const lineStart = (text: string, i: number) => text.lastIndexOf("\n", i - 1) + 1;
const lineEnd = (text: string, i: number) => {
  const n = text.indexOf("\n", i);
  return n === -1 ? text.length : n;
};

// "- " in front of every line the selection touches.
export function bulletList({ text, start, end }: Edit): Edit {
  const from = lineStart(text, start);
  const to = lineEnd(text, end);
  const lines = text.slice(from, to).split("\n").map((l) => (l.startsWith("- ") ? l : `- ${l}`));
  const block = lines.join("\n");
  return { text: text.slice(0, from) + block + text.slice(to), start: from, end: from + block.length };
}

// Inline `code` for part of a line; a fenced block for whole or several lines.
export function code(edit: Edit): Edit {
  const { text, start, end } = edit;
  const selected = text.slice(start, end);
  const wholeLines = start === lineStart(text, start) && end === lineEnd(text, end);
  if (!selected.includes("\n") && !(wholeLines && selected)) return wrap(edit, "`");
  const before = start > 0 && text[start - 1] !== "\n" ? "\n" : "";
  const fenced = `${before}\`\`\`\n${selected}\n\`\`\`\n`;
  const at = start + before.length + 4; // just after the opening fence
  return { text: text.slice(0, start) + fenced + text.slice(end), start: at, end: at + selected.length };
}

// Puts a snippet (an image) on its own line at the cursor; the cursor moves past it.
export function insertBlock({ text, start, end }: Edit, snippet: string): Edit {
  const before = start > 0 && text[start - 1] !== "\n" ? "\n" : "";
  const inserted = before + snippet + "\n";
  const cursor = start + inserted.length;
  return { text: text.slice(0, start) + inserted + text.slice(end), start: cursor, end: cursor };
}

// While an image uploads, the note holds a placeholder unique to that upload, then the real link.
export const uploadingToken = (id: string) => `![Uploading…](uploading:${id})`;
export const imageMarkdown = (path: string) => `![](${path})`;

export const replaceToken = (text: string, token: string, replacement: string) => {
  if (replacement) return text.replace(token, replacement);
  // Removing a failed upload also removes the line it sat on.
  return text.replace(`${token}\n`, "").replace(token, "");
};

// ---- Code-block typing (#54): only inside ``` fences, the box acts like a small code editor. ----

export const INDENT = "    ";

// Inside a fence = an odd number of ``` lines start before the cursor's line.
export function inCodeBlock(text: string, cursor: number): boolean {
  const before = text.slice(0, lineStart(text, cursor));
  return (before.match(/^[ \t]*```/gm)?.length ?? 0) % 2 === 1;
}

const leading = (line: string) => line.match(/^[ \t]*/)![0];

// Enter: keep the line's indent, one level deeper after ":" (Python) or "{" (braces).
// Between "{" and "}", the "}" drops to its own line at the outer indent.
export function newline({ text, start, end }: Edit): Edit {
  const before = text.slice(lineStart(text, start), start);
  const indent = leading(before);
  const opens = /[:{]\s*$/.test(before);
  const inner = opens ? indent + INDENT : indent;
  const split = /\{\s*$/.test(before) && text[end] === "}";
  const inserted = "\n" + inner + (split ? "\n" + indent : "");
  const cursor = start + 1 + inner.length;
  return { text: text.slice(0, start) + inserted + text.slice(end), start: cursor, end: cursor };
}

// Tab: 4 spaces at the cursor, or in front of every selected line.
export function indent({ text, start, end }: Edit): Edit {
  if (start === end || !text.slice(start, end).includes("\n")) {
    return { text: text.slice(0, start) + INDENT + text.slice(end), start: start + 4, end: start + 4 };
  }
  const from = lineStart(text, start);
  const to = lineEnd(text, end);
  const block = text.slice(from, to).split("\n").map((l) => INDENT + l).join("\n");
  return { text: text.slice(0, from) + block + text.slice(to), start: from, end: from + block.length };
}

// Shift+Tab: up to 4 leading spaces off every touched line.
export function outdent({ text, start, end }: Edit): Edit {
  const from = lineStart(text, start);
  const to = lineEnd(text, end);
  const lines = text.slice(from, to).split("\n");
  const removedFirst = Math.min(leading(lines[0]).length, 4);
  const block = lines.map((l) => l.slice(Math.min(leading(l).length, 4))).join("\n");
  if (start === end) {
    const cursor = Math.max(from, start - removedFirst);
    return { text: text.slice(0, from) + block + text.slice(to), start: cursor, end: cursor };
  }
  return { text: text.slice(0, from) + block + text.slice(to), start: from, end: from + block.length };
}

// Backspace in an indent removes a whole step back to the previous multiple of 4.
// Returns null when the normal one-character backspace should happen.
export function backspace({ text, start, end }: Edit): Edit | null {
  if (start !== end) return null;
  const before = text.slice(lineStart(text, start), start);
  if (!before || !/^ +$/.test(before)) return null;
  const n = before.length % 4 || 4;
  return { text: text.slice(0, start - n) + text.slice(start), start: start - n, end: start - n };
}

// "}" typed on a blank, indented line steps out one level first. null = type it normally.
export function closeBrace({ text, start, end }: Edit): Edit | null {
  if (start !== end) return null;
  const from = lineStart(text, start);
  const before = text.slice(from, start);
  if (before.length < 4 || !/^ +$/.test(before)) return null;
  const outer = before.slice(4);
  const cursor = from + outer.length + 1;
  return { text: text.slice(0, from) + outer + "}" + text.slice(start), start: cursor, end: cursor };
}
