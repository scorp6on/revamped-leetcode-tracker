import { useState, type FormEvent } from "react";
import { api } from "./api";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";

export function Login({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const res = await api("/api/login", { method: "POST", body: JSON.stringify({ password }) });
      if (res.ok) return onLoggedIn();
      if (res.status === 429) {
        const { retryAfterSeconds } = await res.json();
        setError(`Too many attempts. Try again in ${Math.ceil(retryAfterSeconds / 60)} min.`);
      } else {
        setError("Wrong password.");
      }
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setBusy(false);
      setPassword("");
    }
  };

  return (
    <div className="flex flex-1 items-center justify-center px-6 py-12">
      <form onSubmit={submit} className="flex w-full max-w-[360px] flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-[28px] font-semibold tracking-tight">Welcome back</h1>
          <p className="text-muted-foreground">Enter your password to continue.</p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            aria-invalid={!!error}
            aria-describedby={error ? "login-error" : undefined}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && (
            <p id="login-error" role="alert" className="text-[13px]">
              {error}
            </p>
          )}
        </div>

        <Button type="submit" disabled={busy || !password}>
          {busy ? "Logging in…" : "Log in"}
        </Button>
      </form>
    </div>
  );
}
