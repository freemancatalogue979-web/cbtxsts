import { useState } from "react";
import { api, setToken, ApiError } from "../lib/api";
import type { User } from "../lib/types";
import { ErrorNote, Field } from "../components/ui";
import { CloverMark } from "../components/Logo";

export function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ token: string; user: User }>("/auth/login", { email, password });
      setToken(res.token);
      onLogin(res.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-ink flex items-center justify-center p-4 relative overflow-hidden">
      {/* subtle crimson glow, no noise */}
      <div className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 w-[36rem] h-[36rem] rounded-full bg-crim/[0.05] blur-3xl" />
      <div className="w-full max-w-sm relative">
        <div className="flex flex-col items-center mb-8">
          <CloverMark size={56} />
          <div className="mt-4 text-2xl font-extrabold tracking-[0.25em]">
            9&nbsp;<span className="text-crim">CLOVER</span>
          </div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.35em] text-faint mt-2">
            Competitive Operations
          </div>
          <div className="mt-5 chip border-leaf/30 text-leaf/90 text-[10px] tracking-[0.2em] uppercase">
            Play. Review. Adapt. Dominate.
          </div>
        </div>

        <form onSubmit={submit} className="card p-5 space-y-4">
          <Field label="Email">
            <input className="input" type="email" autoComplete="email" required
              value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@9clover.gg" />
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

        <div className="text-center text-[11px] text-faint mt-5 leading-relaxed">
          Invite-only. Staff accounts are issued by the team admin.
          <br />
          <span className="text-faint/70">Every game teaches us something.</span>
        </div>
      </div>
    </div>
  );
}
