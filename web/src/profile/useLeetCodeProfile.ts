import { useEffect, useState } from "react";
import type { LeetCodeProfileResponse } from "../../../api/src/lcprofile/types";
import { api } from "../api";

// One request per visit to the app, shared by the header picture and the Profile sidebar (#61).
let request: Promise<LeetCodeProfileResponse | null> | undefined;

export function useLeetCodeProfile(enabled = true): LeetCodeProfileResponse | null | "loading" {
  const [data, setData] = useState<LeetCodeProfileResponse | null | "loading">("loading");
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    request ??= api("/api/leetcode-profile")
      .then((res) => (res.ok ? (res.json() as Promise<LeetCodeProfileResponse>) : null))
      .catch(() => null);
    void request.then((d) => {
      if (!d) request = undefined; // try again next time instead of keeping a failure
      if (live) setData(d);
    });
    return () => {
      live = false;
    };
  }, [enabled]);
  return data;
}
