import { describe, expect, it } from "vitest";
import type { Submission } from "../../../api/src/sync/types";
import { groupPending, prefillMinutes } from "./group";

const T = 1_793_390_000; // seconds
const sub = (id: string, slug: string, timestamp: number): Submission => ({
  id, slug, title: slug, status: "Accepted", accepted: true, lang: "python3",
  runtime: null, memory: null, timestamp, code: null, source: "extension",
});
const iso = (seconds: number) => new Date(seconds * 1000).toISOString();

describe("groupPending", () => {
  it("makes one entry per problem, oldest submission first, latest problem first", () => {
    const groups = groupPending([sub("3", "a", T + 300), sub("1", "a", T), sub("2", "b", T + 600)]);
    expect(groups.map((g) => g.slug)).toEqual(["b", "a"]);
    expect(groups[1].submissions.map((s) => s.id)).toEqual(["1", "3"]);
  });
});

describe("prefillMinutes", () => {
  const subs = [sub("1", "a", T + 900), sub("2", "a", T + 1980)];

  it("runs from the prediction to the last submission", () => {
    expect(prefillMinutes(iso(T), subs)).toBe(33);
  });

  it("leaves it empty with no prediction, or one made after you submitted", () => {
    expect(prefillMinutes(null, subs)).toBeNull();
    expect(prefillMinutes(iso(T + 1000), subs)).toBeNull();
  });

  it("stays within what the form accepts", () => {
    expect(prefillMinutes(iso(T + 900), [sub("1", "a", T + 900)])).toBe(1);
    expect(prefillMinutes(iso(T - 86_400), subs)).toBe(600);
  });
});
