import type { Difficulty } from "../../../api/src/catalog/types";
import { NOTE_SECTIONS, type HistoryAttempt, type NoteSection, type Outcome } from "../../../api/src/review/types";

// History filters and notes-journal search (#60): every word must appear, any case.

export const words = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean);
export const hasAll = (text: string, ws: string[]) => {
  const lower = text.toLowerCase();
  return ws.every((w) => lower.includes(w));
};

export interface HistoryFilter {
  q: string;
  outcome: Outcome | "";
  difficulty: Difficulty | "";
  tag: string;
}

export const filterHistory = (list: HistoryAttempt[], f: HistoryFilter) => {
  const ws = words(f.q);
  return list.filter(
    (a) =>
      (!f.outcome || a.outcome === f.outcome) &&
      (!f.difficulty || a.difficulty === f.difficulty) &&
      (!f.tag || a.tags.includes(f.tag)) &&
      hasAll(`${a.problemId}. ${a.title}`, ws),
  );
};

// The words you wrote, without image links, link URLs or Markdown symbols, so search only
// matches your text.
export const plainText = (md: string) =>
  md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links keep their text
    .replace(/^\s*```.*$/gm, " ") // code fence lines
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "") // headings, quotes, list markers
    .replace(/(\*\*|__|`|~~)/g, "") // emphasis and code marks
    .replace(/\s+/g, " ")
    .trim();

// The journal's sections: your three note boxes, plus the single box of older attempts.
export type JournalSection = NoteSection | "notes";
export const JOURNAL_SECTIONS: Record<JournalSection, string> = { ...NOTE_SECTIONS, notes: "Notes" };

export interface JournalEntry {
  attempt: HistoryAttempt;
  section: JournalSection;
  text: string;
  plain: string;
}

export const journalEntries = (attempts: HistoryAttempt[]): JournalEntry[] =>
  attempts.flatMap((attempt) =>
    (Object.keys(JOURNAL_SECTIONS) as JournalSection[]).flatMap((section) => {
      const text = attempt[section]?.trim();
      return text ? [{ attempt, section, text, plain: plainText(text) }] : [];
    }),
  );

export const searchJournal = (entries: JournalEntry[], query: string, section: JournalSection | "") => {
  const ws = words(query);
  return entries.filter((e) => (!section || e.section === section) && hasAll(e.plain, ws));
};
