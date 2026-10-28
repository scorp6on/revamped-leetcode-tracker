import { useEffect, useState } from "react";
import { api, setUnauthorizedHandler } from "./api";
import { AppHeader } from "./components/AppHeader";
import { Login } from "./Login";
import { useTheme } from "./theme";

type Health = { ok: boolean; db: string };
type Session = "checking" | "in" | "out";

// CloudFront forwards /api/* to API Gateway, so the app calls its own origin.
export function App() {
  const { theme, toggle } = useTheme();
  const [session, setSession] = useState<Session>("checking");
  const [health, setHealth] = useState<Health | "error">();

  useEffect(() => {
    setUnauthorizedHandler(() => setSession("out"));
    api("/api/me")
      .then((res) => setSession(res.ok ? "in" : "out"))
      .catch(() => setSession("out"));
  }, []);

  useEffect(() => {
    if (session !== "in") return;
    api("/api/health")
      .then((res) => res.json() as Promise<Health>)
      .then(setHealth)
      .catch(() => setHealth("error"));
  }, [session]);

  const logout = async () => {
    await api("/api/logout", { method: "POST" });
    setSession("out");
  };

  return (
    <div className="flex min-h-svh flex-col">
      <AppHeader theme={theme} onToggleTheme={toggle} onLogout={session === "in" ? logout : undefined} />
      {session === "out" && <Login onLoggedIn={() => setSession("in")} />}
      {session === "in" && (
        // Placeholder until Home (queue + catalog) arrives in M2.
        <main className="mx-auto w-full max-w-[1120px] px-6 py-10">
          <h1 className="text-[28px] font-semibold tracking-tight">Home</h1>
          <p className="mt-2 font-mono text-[13px] text-muted-foreground">
            {health === undefined && "checking api…"}
            {health === "error" && "api unreachable"}
            {typeof health === "object" && `${health.ok ? "api healthy" : "api unhealthy"} · db ${health.db}`}
          </p>
        </main>
      )}
    </div>
  );
}
