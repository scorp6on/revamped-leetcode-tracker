import type { Difficulty } from "../../../api/src/catalog/types";
import { cn } from "../lib/utils";

// The one place color appears (decision #40); the word still carries the meaning.
const styles: Record<Difficulty, string> = {
  Easy: "text-easy bg-easy-bg border-easy-border",
  Medium: "text-medium bg-medium-bg border-medium-border",
  Hard: "text-hard bg-hard-bg border-hard-border",
};

export function DifficultyBadge({ difficulty }: { difficulty: Difficulty }) {
  return (
    <span className={cn("inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium", styles[difficulty])}>
      {difficulty}
    </span>
  );
}
