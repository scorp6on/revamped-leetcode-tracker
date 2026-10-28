import { useLayoutEffect } from "react";
import { useLocation, useNavigationType } from "react-router";

// Scroll position per history entry: Back returns to the same spot, a newly opened page starts at
// the top, and filter changes (URL replaces) leave the scroll alone.
const positions = new Map<string, number>();

export function ScrollMemory() {
  const { key } = useLocation();
  const navigationType = useNavigationType();

  useLayoutEffect(() => {
    // The browser's own restoration runs before our page has rendered, so we do it ourselves.
    window.history.scrollRestoration = "manual";
  }, []);

  useLayoutEffect(() => {
    if (navigationType === "POP") window.scrollTo(0, positions.get(key) ?? 0);
    if (navigationType === "PUSH") window.scrollTo(0, 0);
    const save = () => positions.set(key, window.scrollY);
    window.addEventListener("scroll", save, { passive: true });
    return () => window.removeEventListener("scroll", save);
  }, [key, navigationType]);

  return null;
}
