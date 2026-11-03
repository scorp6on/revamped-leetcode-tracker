import { useState } from "react";
import { cn } from "../lib/utils";

// Your LeetCode picture, loaded straight from LeetCode without telling it which site asked
// (no referrer); a letter in a gray circle if there's no picture or it fails to load (#61).
export function Avatar({ src, name, className }: { src: string | null | undefined; name: string | null | undefined; className?: string }) {
  const [broken, setBroken] = useState<string | null>(null);
  const letter = (name?.trim()[0] ?? "?").toUpperCase();
  const base = cn("flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted-foreground font-semibold text-background", className);
  if (!src || broken === src) {
    return (
      <span aria-hidden="true" className={base}>
        {letter}
      </span>
    );
  }
  return <img src={src} alt="" referrerPolicy="no-referrer" onError={() => setBroken(src)} className={cn(base, "object-cover")} />;
}
