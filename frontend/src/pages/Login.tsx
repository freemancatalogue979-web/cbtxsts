import { useState } from "react";
import { api, setToken, ApiError } from "../lib/api";
import type { User } from "../lib/types";
import { AmbientBackdrop } from "../components/AmbientBackdrop";
import { ErrorNote, Field } from "../components/ui";
import { HeroMark } from "../components/Logo";
import { InstallAppButton } from "../components/AppControls";

export function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ token: string; user: User }>("/auth/login", { username: username.trim(), password });
      setToken(res.token);
      onLogin(res.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-ink flex items-center justify-center p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] relative overflow-hidden">
      <AmbientBackdrop section="login" motion />
      <div className="w-full max-w-sm relative z-10">
        <div className="flex flex-col items-center mb-8">
          <HeroMark size={188} />
          <div className="mt-4 text-2xl font-extrabold tracking-[0.25em]">
            9&nbsp;<span className="text-crim">Clover</span>
          </div>
          <div className="mt-5 chip border-leaf/30 text-leaf/90 text-[10px] tracking-[0.2em]">
            Play. Review. Adapt. Dominate.
          </div>
        </div>

        <form onSubmit={submit} className="card p-5 space-y-4">
          <Field label="Username">
            <input className="input" type="text" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required
              value={username} onChange={(e) => setUsername(e.target.value)} placeholder="admin" />
          </Field>
          <Field label="Password">
            <input className="input" type="password" autoComplete="current-password" required
              value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          </Field>
          <ErrorNote error={error} />
          <button className="btn-primary w-full" disabled={busy}>
            {busy ? "Signing in…" : "Enter the hub"}
          </button>
        </form>

        <div className="mt-3"><InstallAppButton variant="full" /></div>

        <div className="text-center text-[11px] text-faint mt-5 leading-relaxed">
          Invite-only. Staff accounts are issued by the team admin.
          <br />
          <span className="text-faint/70">Every game teaches us something.</span>
        </div>
      </div>
    </div>
  );
}
