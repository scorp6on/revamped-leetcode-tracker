import { NavLink } from "react-router";
import { cn } from "../lib/utils";
import type { Theme } from "../theme";
import { Button } from "./ui/button";

const MoonIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
  </svg>
);

const SunIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);

// Mock OA, Stats and Profile join as each page is built.
const LINKS = [{ to: "/", label: "Home" }];

export function AppHeader({
  theme,
  onToggleTheme,
  loggedIn,
  onLogout,
}: {
  theme: Theme;
  onToggleTheme: () => void;
  loggedIn: boolean;
  onLogout: () => void;
}) {
  return (
    <header className="border-b">
      {/* Wraps onto a second row on narrow phones instead of overflowing. */}
      <nav aria-label="Main" className="mx-auto flex min-h-15 max-w-[1120px] flex-wrap items-center gap-x-8 gap-y-2 px-4 py-2 sm:px-6">
        <span className="font-mono text-[15px] font-medium tracking-tight">lc/tracker</span>
        {loggedIn && (
          <div className="order-last flex w-full gap-6 sm:order-none sm:w-auto">
            {LINKS.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end
                className={({ isActive }) =>
                  cn("py-2", isActive ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground")
                }
              >
                {l.label}
              </NavLink>
            ))}
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={onToggleTheme}
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          >
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          </Button>
          {loggedIn && (
            <Button variant="outline" size="sm" className="h-11" onClick={onLogout}>
              Log out
            </Button>
          )}
        </div>
      </nav>
    </header>
  );
}
