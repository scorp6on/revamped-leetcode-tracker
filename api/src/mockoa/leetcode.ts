import type { Difficulty } from "../catalog/types";
import { NEUTRAL_CLASS, NEUTRAL_FUNCTION, type JudgeSpec, type TestCase } from "./types";

const QUERY = `query q($slug: String!) {
  question(titleSlug: $slug) {
    id: questionFrontendId
    title
    slug: titleSlug
    difficulty
    paid: isPaidOnly
    category: categoryTitle
    content
    examples: exampleTestcaseList
    metaData
    tags: topicTags { slug }
    snippets: codeSnippets { lang: langSlug code }
  }
}`;

export interface RawQuestion {
  id: string;
  title: string;
  slug: string;
  difficulty: Difficulty;
  paid: boolean;
  category: string;
  content: string | null;
  examples: string[] | null;
  metaData: string | null;
  tags: { slug: string }[];
  snippets: { lang: string; code: string }[] | null;
}

// Everything a Mock OA needs for one problem: its facts, the renamed statement and stub, and tests.
export interface JudgeProblem {
  problemId: string;
  slug: string;
  title: string;
  difficulty: Difficulty;
  tags: string[];
  statement: string;
  stub: string;
  spec: JudgeSpec;
  tests: TestCase[];
}

export const fetchQuestion = async (slug: string): Promise<RawQuestion | null> => {
  const res = await fetch("https://leetcode.com/graphql", {
    method: "POST",
    headers: { "content-type": "application/json", referer: `https://leetcode.com/problems/${slug}/` },
    body: JSON.stringify({ query: QUERY, variables: { slug } }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`LeetCode answered ${res.status} for ${slug}`);
  return (await res.json())?.data?.question ?? null;
};

const ENTITIES: Record<string, string> = { "&quot;": '"', "&#39;": "'", "&lt;": "<", "&gt;": ">", "&nbsp;": " ", "&amp;": "&" };
const decode = (s: string) => s.replace(/&(quot|#39|lt|gt|nbsp|amp);/g, (m) => ENTITIES[m]);

// The expected outputs of the statement's examples (#62: read from the statement). LeetCode writes them
// as "<strong>Output:</strong> <code>[0,1]</code>" or inside a <pre> block; null if any can't be read.
export const exampleOutputs = (content: string): string[] | null => {
  const outputs: string[] = [];
  for (const m of content.matchAll(/<strong[^>]*>\s*Output:?\s*<\/strong>:?/g)) {
    const rest = content.slice(m.index + m[0].length);
    const end = rest.search(/<strong|<\/p>|<\/pre>|\n\s*\n/);
    const text = decode((end === -1 ? rest : rest.slice(0, end)).replace(/<[^>]+>/g, "")).trim();
    try {
      JSON.parse(text);
    } catch {
      return null; // e.g. "2, nums = [1,2,_]": a custom checker we can't copy
    }
    outputs.push(text);
  }
  return outputs.length ? outputs : null;
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Replaces a name everywhere it stands as a word, keeping lowercase-first spellings lowercase
// ("LRUCache lRUCache = new LRUCache(2)" → "Design design = new Design(2)").
const rename = (text: string, from: string, to: string) =>
  text.replace(new RegExp(`\\b${escapeRe(from)}\\b`, "gi"), (m) => (m[0] === m[0].toLowerCase() ? to[0].toLowerCase() + to.slice(1) : to));

// Why a problem can't be used, or the problem ready for a Mock OA.
export const buildJudgeProblem = (q: RawQuestion): JudgeProblem | string => {
  if (q.paid) return "Premium";
  if (q.category !== "Algorithms") return `${q.category} problems need another language`;
  const python = q.snippets?.find((s) => s.lang === "python3")?.code;
  if (!python) return "no Python 3 version";
  if (!q.content || !q.metaData || !q.examples?.length) return "missing statement or examples";
  let meta: Record<string, unknown>;
  try {
    meta = JSON.parse(q.metaData);
  } catch {
    return "unreadable metaData";
  }
  if (meta.manual === true) return "interactive or custom-checked"; // #62 E
  const outputs = exampleOutputs(q.content);
  if (!outputs || outputs.length !== q.examples.length) return "couldn't read the example outputs";

  const design = typeof meta.classname === "string";
  const types = (ps: unknown) => ((ps as { type: string }[] | undefined) ?? []).map((p) => p.type);
  let spec: JudgeSpec;
  let stub = python;
  let statement = q.content;
  if (design) {
    const realName = meta.classname as string;
    const methods = Object.fromEntries(
      ((meta.methods as { name: string; params: unknown }[] | undefined) ?? []).map((m) => [m.name, types(m.params)]),
    );
    spec = {
      kind: "design",
      realName,
      paramNames: [],
      params: [],
      returnType: "",
      outputParam: null,
      design: { ctor: types((meta.constructor as { params?: unknown } | undefined)?.params), methods },
      anyOrder: false,
    };
    stub = rename(stub, realName, NEUTRAL_CLASS);
    statement = rename(statement, realName, NEUTRAL_CLASS);
  } else {
    const realName = meta.name as string;
    const params = (meta.params as { name: string; type: string }[] | undefined) ?? [];
    const output = meta.output as { paramindex?: number } | undefined;
    if (!realName || !new RegExp(`def ${escapeRe(realName)}\\(`).test(stub)) return "unexpected starter code";
    spec = {
      kind: "function",
      realName,
      paramNames: params.map((p) => p.name),
      params: params.map((p) => p.type),
      returnType: (meta.return as { type?: string } | undefined)?.type ?? "",
      outputParam: typeof output?.paramindex === "number" ? output.paramindex : null,
      design: null,
      // Read without tags: LeetCode often writes "in <strong>any order</strong>".
      anyOrder: /in\s+any\s+order/i.test(q.content.replace(/<[^>]+>/g, "")),
    };
    stub = stub.replace(new RegExp(`def ${escapeRe(realName)}\\(`), `def ${NEUTRAL_FUNCTION}(`);
    // Only where it's code (`<code>rotate</code>`, `rotate(`): a name like "search" is also an English word.
    const exact = new RegExp(`\\b${escapeRe(realName)}\\b`, "g");
    statement = statement
      .replace(/<code>([\s\S]*?)<\/code>/g, (_, inner: string) => `<code>${inner.replace(exact, NEUTRAL_FUNCTION)}</code>`)
      .replace(new RegExp(`\\b${escapeRe(realName)}\\(`, "g"), `${NEUTRAL_FUNCTION}(`);
  }

  return {
    problemId: q.id,
    slug: q.slug,
    title: q.title,
    difficulty: q.difficulty,
    tags: q.tags.map((t) => t.slug),
    statement,
    stub,
    spec,
    tests: q.examples.map((input, i) => ({ input, expected: outputs[i] })),
  };
};

// A test's input as you'd write it: "s = "AAAA", k = 0". Design tests show the call script as is.
export const showInput = (spec: JudgeSpec, input: string) => {
  const lines = input.split("\n");
  if (spec.kind === "design" || lines.length !== spec.paramNames.length) return input;
  return lines.map((v, i) => `${spec.paramNames[i]} = ${v}`).join(", ");
};
