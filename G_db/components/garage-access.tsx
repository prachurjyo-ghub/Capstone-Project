"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { FiTool } from "react-icons/fi";
import { ThemeToggle } from "./theme-toggle";
import { GarageSelect } from "./ui/select";
import { changePassword, garageIdentity, loadWorkspace, login, logout, type GarageRole } from "./workspace-state";

const destination = (role: GarageRole) => role === "OWNER" ? "/owner" : "/mechanic";
const errorText = (error: unknown) => error instanceof Error ? error.message : "Unable to reach the garage service.";

function AccessCard({ children }: { children: ReactNode }) {
  return <main className="access-page"><section className="panel access-card">
    <div className="access-header"><div className="workspace-brand"><span className="brand-mark"><FiTool aria-hidden="true" /></span><div><strong>Parts Arc</strong><span>Garage Workspace</span></div></div><ThemeToggle /></div>
    {children}
  </section></main>;
}

export function GarageLogin() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const role = fields.get("role") === "MECHANIC" ? "MECHANIC" : "OWNER";
    setBusy(true);
    setError("");
    try {
      const identity = await login(String(fields.get("username")), String(fields.get("password")), role);
      router.replace(destination(identity.role));
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  return <AccessCard><h1>Sign in</h1><form className="stack-form" onSubmit={submit}>
    <div className="field-label"><span>Sign in as</span><GarageSelect label="Sign in as" name="role" defaultValue="OWNER" options={[{ value: "OWNER", label: "Garage owner" }, { value: "MECHANIC", label: "Mechanic" }]} /></div>
    <label>Username<input name="username" autoComplete="username" required /></label>
    <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button type="submit" className="button primary full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
  </form></AccessCard>;
}

export function GarageGate({ role, children }: { role: GarageRole; children: ReactNode }) {
  const router = useRouter();
  const [stage, setStage] = useState<"loading" | "password" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    async function open() {
      try {
        const identity = await garageIdentity();
        if (!current) return;
        if (identity.role !== role) {
          router.replace(destination(identity.role));
        } else if (identity.mustChangePassword) {
          setStage("password");
        } else {
          await loadWorkspace();
          if (current) setStage("ready");
        }
      } catch (error) {
        if (current) {
          setError(errorText(error));
          setStage("error");
        }
      }
    }
    void open();
    return () => { current = false; };
  }, [role, router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await changePassword(String(fields.get("currentPassword")), String(fields.get("newPassword")));
      await loadWorkspace();
      setStage("ready");
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  if (stage === "ready") return children;
  if (stage === "error") return <AccessCard><h1>Garage access</h1><p role="alert">{error}</p><a href="/login" className="button primary">Go to sign in</a></AccessCard>;
  if (stage === "loading") return <AccessCard><p role="status">Opening workspace…</p></AccessCard>;
  return <AccessCard><h1>Set a new password</h1><form className="stack-form" onSubmit={submit}>
    <label>Temporary password<input name="currentPassword" type="password" autoComplete="current-password" required /></label>
    <label>New password<input name="newPassword" type="password" autoComplete="new-password" minLength={12} required /></label>
    <p className="muted">Use 12 or more characters, including uppercase, lowercase and a number.</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="button primary" disabled={busy}>Update password</button>
    <button className="button secondary" type="button" onClick={async () => {
      try { await logout(); router.replace("/login"); } catch (error) { setError(errorText(error)); }
    }}>Sign out</button>
  </form></AccessCard>;
}
