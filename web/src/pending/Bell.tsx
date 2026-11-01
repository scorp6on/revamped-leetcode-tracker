import { Link } from "react-router";
import { Button } from "../components/ui/button";
import { countLabel } from "./group";
import { usePending } from "./PendingContext";

const BellIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </svg>
);

// The count of problems waiting to be graded, and the list of them (#40, #57).
export function Bell() {
  const { groups, listOpen, setListOpen } = usePending();
  const n = groups.length;
  return (
    <div className="relative">
      <Button
        variant="outline"
        size="icon"
        className="relative"
        aria-expanded={listOpen}
        aria-label={`${n} problem${n === 1 ? "" : "s"} waiting to be graded`}
        onClick={() => setListOpen(!listOpen)}
      >
        <BellIcon />
        {n > 0 && (
          <span className="absolute top-1 right-1 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] leading-4 font-semibold text-primary-foreground">
            {n}
          </span>
        )}
      </Button>
      {listOpen && (
        <div className="absolute right-0 z-30 mt-2 w-[300px] max-w-[calc(100vw-32px)] rounded-[10px] border bg-background shadow-lg">
          {n === 0 ? (
            <p className="p-4 text-muted-foreground">Nothing waiting to be graded.</p>
          ) : (
            <ul className="max-h-[60vh] divide-y overflow-y-auto">
              {groups.map((g) => (
                <li key={g.slug}>
                  <Link to={`/problems/${g.slug}`} onClick={() => setListOpen(false)} className="flex min-h-11 flex-col justify-center px-4 py-2 hover:bg-subtle">
                    <span className="font-medium">{g.title}</span>
                    <span className="text-[13px] text-muted-foreground">{countLabel(g.submissions.length)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
