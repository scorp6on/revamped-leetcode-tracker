import { useEffect, useState } from "react";

type Health = { ok: boolean; db: string };

// CloudFront forwards /api/* to API Gateway, so the app calls its own origin.
export function App() {
  const [health, setHealth] = useState<Health | "loading" | "error">("loading");

  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.json() as Promise<Health>)
      .then(setHealth)
      .catch(() => setHealth("error"));
  }, []);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
      <h1>LeetCode Tracker</h1>
      <p>
        {health === "loading" && "Checking API…"}
        {health === "error" && "API unreachable"}
        {typeof health === "object" &&
          `${health.ok ? "API healthy" : "API unhealthy"} · DB ${health.db}`}
      </p>
    </main>
  );
}
