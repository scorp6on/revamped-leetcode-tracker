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

// Page links (Home, Mock OA, Stats, Profile) join the bar as each page is built.
export function AppHeader({
  theme,
  onToggleTheme,
  onLogout,
}: {
  theme: Theme;
  onToggleTheme: () => void;
  onLogout?: () => void;
}) {
  return (
    <header className="border-b">
      <nav aria-label="Main" className="mx-auto flex h-15 max-w-[1120px] items-center gap-8 px-6">
        <span className="font-mono text-[15px] font-medium tracking-tight">lc/tracker</span>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={onToggleTheme}
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          >
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          </Button>
          {onLogout && (
            <Button variant="outline" size="sm" className="h-11" onClick={onLogout}>
              Log out
            </Button>
          )}
        </div>
      </nav>
    </header>
  );
}
