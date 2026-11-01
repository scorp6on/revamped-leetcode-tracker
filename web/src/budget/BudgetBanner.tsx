import { useEffect, useState } from "react";
import { WARN_AT, type BudgetStatus } from "../../../api/src/ai/types";
import { api } from "../api";

// On Home: 80% and 100% of the month's AI budget (#33). Attempts and SM-2 keep working either way.
export function BudgetBanner() {
  const [b, setB] = useState<BudgetStatus>();
  useEffect(() => {
    api("/api/budget")
      .then((res) => (res.ok ? (res.json() as Promise<BudgetStatus>) : undefined))
      .then(setB)
      .catch(() => {});
  }, []);

  if (!b || b.spentUsd < b.capUsd * WARN_AT) return null;
  const used = `$${b.spentUsd.toFixed(2)} of $${b.capUsd}`;
  return (
    <p role="status" className="rounded-[10px] border bg-subtle px-4 py-3">
      {b.spentUsd >= b.capUsd
        ? `AI reviews are paused: ${used} used this month. Grading still works, and you can request skipped reviews next month.`
        : `AI budget: ${used} used this month.`}
    </p>
  );
}
