import { useEffect, useState } from "react";
import { Route, Routes } from "react-router";
import { api, setUnauthorizedHandler } from "./api";
import { AppHeader } from "./components/AppHeader";
import { Home } from "./Home";
import { Login } from "./Login";
import { ProblemPage } from "./problem/ProblemPage";
import { ScrollMemory } from "./ScrollMemory";
import { useTheme } from "./theme";

type Session = "checking" | "in" | "out";

// When logged out, Login shows in place of the page without changing the URL,
// so logging in lands you back exactly where you were.
export function App() {
  const { theme, toggle } = useTheme();
  const [session, setSession] = useState<Session>("checking");

  useEffect(() => {
    setUnauthorizedHandler(() => setSession("out"));
    api("/api/me")
      .then((res) => setSession(res.ok ? "in" : "out"))
      .catch(() => setSession("out"));
  }, []);

  const logout = async () => {
    await api("/api/logout", { method: "POST" });
    setSession("out");
  };

  return (
    <div className="flex min-h-svh flex-col">
      <AppHeader
        theme={theme}
        onToggleTheme={toggle}
        loggedIn={session === "in"}
        onLogout={logout}
      />
      {session === "out" && <Login onLoggedIn={() => setSession("in")} />}
      {session === "in" && <ScrollMemory />}
      {session === "in" && (
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/problems/:slug" element={<ProblemPage />} />
          <Route
            path="*"
            element={<p className="mx-auto w-full max-w-[1120px] px-6 py-10 text-muted-foreground">Page not found.</p>}
          />
        </Routes>
      )}
    </div>
  );
}
