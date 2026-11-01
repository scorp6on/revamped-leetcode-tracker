import { useState } from "react";
import { Link, useLocation } from "react-router";
import { Button, buttonVariants } from "../components/ui/button";
import { countLabel } from "./group";
import { usePending } from "./PendingContext";

// One small notification at a time, one per waiting problem (#19, #57). Later dismisses it for this
// visit; the bell still counts it. Nothing shows for the problem you're already on.
export function Notification() {
  const { groups } = usePending();
  const { pathname } = useLocation();
  const [dismissed, setDismissed] = useState<string[]>([]);
  const dismiss = (slug: string) => setDismissed((d) => [...d, slug]);

  const g = groups.find((x) => !dismissed.includes(x.slug) && pathname !== `/problems/${x.slug}`);
  if (!g) return null;
  return (
    <aside
      role="status"
      className="fixed top-20 right-4 z-20 flex w-[320px] max-w-[calc(100vw-32px)] flex-col gap-2 rounded-[10px] border bg-background p-3.5 shadow-lg"
    >
      <strong className="font-semibold">Ready to grade</strong>
      <span>
        {g.title} · {countLabel(g.submissions.length)}
      </span>
      <div className="flex gap-2">
        <Link to={`/problems/${g.slug}`} onClick={() => dismiss(g.slug)} className={buttonVariants({ size: "default" })}>
          Grade
        </Link>
        <Button variant="ghost" className="text-muted-foreground" onClick={() => dismiss(g.slug)}>
          Later
        </Button>
      </div>
    </aside>
  );
}
