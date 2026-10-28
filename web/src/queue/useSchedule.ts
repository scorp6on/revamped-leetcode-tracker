import { useEffect, useState } from "react";
import type { ScheduleResponse } from "../../../api/src/review/types";
import { api } from "../api";

// Kept after the first load so Home renders at once when you come back (and the scroll position
// can be restored onto it); refreshed in the background each time, so a new attempt shows up.
let cached: ScheduleResponse | undefined;

export function useSchedule(): ScheduleResponse | "loading" | "error" {
  const [data, setData] = useState<ScheduleResponse | "loading" | "error">(cached ?? "loading");

  useEffect(() => {
    let live = true;
    api("/api/schedule")
      .then((res) => (res.ok ? (res.json() as Promise<ScheduleResponse>) : Promise.reject(res.status)))
      .then((d) => live && setData((cached = d)))
      .catch(() => live && !cached && setData("error"));
    return () => {
      live = false;
    };
  }, []);

  return data;
}

// "Tue, Nov 3" for a YYYY-MM-DD in your local day.
export const shortDate = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
};
