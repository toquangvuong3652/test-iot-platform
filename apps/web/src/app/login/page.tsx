"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { storeTokens, type TokenPair } from "@/lib/auth";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const pair = await api<TokenPair>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      storeTokens(pair);
      window.location.href = "/dashboard";
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="card">
        <h1>IoT Platform</h1>
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label>
            <span className="lbl">Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </label>
          <label>
            <span className="lbl">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          <button type="submit" disabled={busy}>
            {busy ? "…" : "Sign in"}
          </button>
          {err && <div className="error">{err}</div>}
        </form>
      </div>
    </div>
  );
}
