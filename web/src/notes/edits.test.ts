import { describe, expect, it } from "vitest";
import { bulletList, code, imageMarkdown, insertBlock, replaceToken, uploadingToken, wrap, type Edit } from "./edits";

// Write the selection inline as [brackets] for readable tests: "a [b] c" selects "b".
const at = (s: string): Edit => {
  const start = s.indexOf("[");
  const end = s.indexOf("]") - 1;
  return { text: s.replace("[", "").replace("]", ""), start, end };
};
const show = ({ text, start, end }: Edit) => text.slice(0, start) + "[" + text.slice(start, end) + "]" + text.slice(end);

describe("toolbar edits", () => {
  it("wraps the selection, or puts the cursor between markers when nothing is selected", () => {
    expect(show(wrap(at("use a [hash map] here"), "**"))).toBe("use a **[hash map]** here");
    expect(show(wrap(at("x []y"), "_"))).toBe("x _[]_y");
  });

  it("turns every touched line into a list item, without doubling existing bullets", () => {
    expect(show(bulletList(at("one\nt[wo\nthr]ee\nfour")))).toBe("one\n[- two\n- three]\nfour");
    expect(show(bulletList(at("- a\n[b]")))).toBe("- a\n[- b]");
  });

  it("uses inline code inside a line and a fenced block for whole lines", () => {
    expect(show(code(at("call [solve()] first")))).toBe("call `[solve()]` first");
    expect(show(code(at("[l = 0\nr = 0]")))).toBe("```\n[l = 0\nr = 0]\n```\n");
    expect(show(code(at("intro\n[x += 1]")))).toBe("intro\n```\n[x += 1]\n```\n");
  });

  it("puts an image on its own line", () => {
    expect(show(insertBlock(at("see this[]"), "![](/img/a.jpg)"))).toBe("see this\n![](/img/a.jpg)\n[]");
    expect(show(insertBlock(at("[]"), "![](/img/a.jpg)"))).toBe("![](/img/a.jpg)\n[]");
  });
});

describe("upload placeholders", () => {
  it("swaps a finished upload's placeholder for its image, leaving other uploads alone", () => {
    const text = `a\n${uploadingToken("1")}\n${uploadingToken("2")}\nb`;
    expect(replaceToken(text, uploadingToken("1"), imageMarkdown("/img/x.jpg"))).toBe(
      `a\n![](/img/x.jpg)\n${uploadingToken("2")}\nb`,
    );
  });

  it("removes a failed upload's placeholder and its line", () => {
    expect(replaceToken(`a\n${uploadingToken("1")}\nb`, uploadingToken("1"), "")).toBe("a\nb");
  });
});
