import { describe, expect, it } from "vitest";
import type { HistoryAttempt } from "../../../api/src/review/types";
import { calendar, streaks } from "./activity";
import { filterHistory, journalEntries, plainText, searchJournal } from "./search";

const TODAY = "2026-11-03"; // a Tuesday

const attempt = (over: Partial<HistoryAttempt>): HistoryAttempt => ({
  problemId: "1",
  slug: "two-sum",
  title: "Two Sum",
  difficulty: "Easy",
  tags: ["array"],
  outcome: "solved",
  confidence: 4,
  minutes: 10,
  failureMode: null,
  approach: "",
  learned: "",
  reflection: "",
  localDate: TODAY,
  createdAt: `${TODAY}T12:00:00.000Z`,
  ...over,
});

describe("streaks", () => {
  it("counts back from today", () => {
    expect(streaks(["2026-11-01", "2026-11-02", "2026-11-03"], TODAY).current).toBe(3);
  });

  it("still counts through yesterday when today has no attempt yet", () => {
    expect(streaks(["2026-11-01", "2026-11-02"], TODAY).current).toBe(2);
  });

  it("breaks after a full missed day", () => {
    expect(streaks(["2026-10-31", "2026-11-01"], TODAY).current).toBe(0);
  });

  it("finds the longest run and its dates", () => {
    const s = streaks(["2026-07-04", "2026-07-05", "2026-07-06", "2026-09-01", "2026-11-03"], TODAY);
    expect(s.longest).toEqual({ days: 3, from: "2026-07-04", to: "2026-07-06" });
    expect(s).toMatchObject({ activeDays: 5, first: "2026-07-04", current: 1 });
  });

  it("handles no attempts at all", () => {
    expect(streaks([], TODAY)).toEqual({ current: 0, longest: null, activeDays: 0, first: null });
  });
});

describe("calendar", () => {
  const weeks = calendar(new Map([["2026-11-03", 2]]), TODAY, "2026-03-02");

  it("covers a rolling year of Monday-first weeks ending this week", () => {
    expect(weeks).toHaveLength(53);
    expect(weeks[0].start).toBe("2025-11-03");
    expect(weeks[52].start).toBe("2026-11-02");
    expect(weeks.every((w) => w.days.length === 7)).toBe(true);
  });

  it("leaves days after today and before your first attempt blank", () => {
    const last = weeks[52].days;
    expect(last[1]).toEqual({ date: TODAY, count: 2, blank: false });
    expect(last[2].blank).toBe(true); // Wednesday, tomorrow
    expect(weeks[0].days[0].blank).toBe(true); // before Mar 2
  });

  it("labels the first column and each week a month starts in", () => {
    expect(weeks[0].month).not.toBeNull();
    const labelled = weeks.filter((w) => w.month).map((w) => w.start);
    expect(labelled).toContain("2026-10-26"); // Nov 1 is that Sunday
    expect(labelled).toHaveLength(13);
  });
});

describe("history filters", () => {
  const list = [
    attempt({ problemId: "1", title: "Two Sum" }),
    attempt({ problemId: "76", title: "Minimum Window Substring", difficulty: "Hard", outcome: "struggled", tags: ["string"] }),
  ];

  it("filters by outcome, difficulty, topic and words in the title or number", () => {
    const none = { q: "", outcome: "", difficulty: "", tag: "" } as const;
    expect(filterHistory(list, { ...none, outcome: "struggled" }).map((a) => a.problemId)).toEqual(["76"]);
    expect(filterHistory(list, { ...none, difficulty: "Easy" }).map((a) => a.problemId)).toEqual(["1"]);
    expect(filterHistory(list, { ...none, tag: "string" }).map((a) => a.problemId)).toEqual(["76"]);
    expect(filterHistory(list, { ...none, q: "window MIN" }).map((a) => a.problemId)).toEqual(["76"]);
    expect(filterHistory(list, { ...none, q: "76" }).map((a) => a.problemId)).toEqual(["76"]);
  });
});

describe("notes journal", () => {
  it("searches the words you wrote, not image links or Markdown", () => {
    expect(plainText("## Idea\n- **Shrink** the [window](https://x.io/jpg)\n![diagram](/img/abc.jpg)\n```python\nx = 1\n```")).toBe(
      "Idea Shrink the window x = 1",
    );
  });

  it("makes one entry per filled section, including old single notes", () => {
    const entries = journalEntries([
      attempt({ learned: "Use a **window**", reflection: "  " }),
      attempt({ notes: "old box about windows" }),
    ]);
    expect(entries.map((e) => e.section)).toEqual(["learned", "notes"]);
  });

  it("matches every word in any case, optionally in one section", () => {
    const entries = journalEntries([
      attempt({ learned: "Shrink the Window while valid", approach: "two pointers" }),
      attempt({ reflection: "window was hard", learned: "img only ![window](/img/w.jpg)" }),
    ]);
    expect(searchJournal(entries, "window SHRINK", "").map((e) => e.section)).toEqual(["learned"]);
    expect(searchJournal(entries, "window", "reflection")).toHaveLength(1);
    expect(searchJournal(entries, "", "")).toHaveLength(4);
  });
});
