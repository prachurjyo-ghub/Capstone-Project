"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { FiArrowLeft, FiArrowRight, FiBriefcase, FiCheckCircle, FiEye, FiEyeOff, FiLock, FiTool, FiUser } from "react-icons/fi";
import { ThemeToggle } from "./theme-toggle";
import "../app/garage-login.css";
import { changePassword, garageIdentity, loadWorkspace, login, logout, requestOwnerRecovery, type GarageRole } from "./workspace-state";

const destination = (role: GarageRole) => role === "OWNER" ? "/owner" : "/mechanic";
const errorText = (error: unknown) => error instanceof Error ? error.message : "Unable to reach the garage service.";

function AccessCard({ children }: { children: ReactNode }) {
  return <main className="access-page"><section className="panel access-card">
    <div className="access-header"><div className="workspace-brand"><span className="brand-mark"><FiTool aria-hidden="true" /></span><div><strong>Parts Arc</strong><span>Garage Workspace</span></div></div><ThemeToggle /></div>
    {children}
  </section></main>;
}

const roleOptions = [
  { value: "OWNER", label: "Garage Owner", icon: FiBriefcase },
  { value: "MECHANIC", label: "Mechanic", icon: FiTool },
] as const;

export function GarageLogin() {
  const router = useRouter();
  const [role, setRole] = useState<GarageRole>("OWNER");
  const [stage, setStage] = useState<"login" | "recovery" | "sent">("login");
  const [username, setUsername] = useState("");
  const [visiblePassword, setVisiblePassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  function switchStage(next: typeof stage) {
    setError("");
    setVisiblePassword(false);
    setStage(next);
    heading.current?.focus();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      if (stage === "recovery") {
        await requestOwnerRecovery(username, String(fields.get("email")));
        switchStage("sent");
      } else {
        const identity = await login(username, String(fields.get("password")), role);
        router.replace(destination(identity.role));
      }
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  const title = stage === "login" ? "Sign in to your workspace" : stage === "recovery" ? "Request a password reset" : "Request submitted";

  return (
    <main className="garage-login">
      <section className="garage-login-photo" aria-label="Parts Arc Garage Operations">
        <div className="garage-login-brand"><span><FiTool aria-hidden="true" /></span><strong>Parts Arc</strong></div>
        <div className="garage-login-caption">
          <p>Garage Operations</p>
          <span>Jobs, inspections and workshop records in one place.</span>
        </div>
      </section>
      <section className="garage-login-panel" aria-labelledby="garage-login-title">
        <div className="garage-login-toolbar"><ThemeToggle /></div>
        <div className="garage-login-inner">
          {stage !== "login" && <button className="garage-login-link garage-login-back" type="button" disabled={busy} onClick={() => switchStage("login")}><FiArrowLeft aria-hidden="true" /> Back to sign in</button>}
          {stage === "sent" && <span className="garage-login-confirmation"><FiCheckCircle aria-hidden="true" /></span>}
          <h1 id="garage-login-title" ref={heading} tabIndex={-1}>{title}</h1>

          {stage === "sent" ? (
            <p className="garage-login-help" role="status">If your details match an active garage owner account, an admin will review the request and send a temporary password to your registered email.</p>
          ) : (
            <form className="garage-login-form" onSubmit={submit} key={stage}>
              {stage === "login" && (
                <fieldset className="garage-login-roles">
                  <legend>Sign in as</legend>
                  {roleOptions.map(({ value, label, icon: Icon }) => <label key={value}>
                    <input className="visually-hidden" type="radio" name="role" value={value} checked={role === value} disabled={busy}
                      onChange={() => { setRole(value); setUsername(""); setVisiblePassword(false); setError(""); }} />
                    <span className="garage-login-role"><Icon aria-hidden="true" />{label}</span>
                  </label>)}
                </fieldset>
              )}
              <label className="garage-login-field">Username
                <span><FiUser aria-hidden="true" /><input name="username" autoComplete="username" autoCapitalize="none" spellCheck={false}
                  placeholder="Enter your username" value={username} onChange={(event) => setUsername(event.target.value)} required maxLength={64} /></span>
              </label>
              {stage === "recovery" ? (
                <label className="garage-login-field">Registered email
                  <input type="email" name="email" placeholder="owner@example.com" autoComplete="email" required maxLength={254} />
                </label>
              ) : (
                <div className="garage-login-password">
                  <label className="garage-login-field">Password
                    <span><FiLock aria-hidden="true" /><input key={role} name="password" type={visiblePassword ? "text" : "password"}
                      autoComplete="current-password" placeholder="Enter your password" required maxLength={128} /></span>
                  </label>
                  <button className="garage-login-eye" type="button" aria-label={visiblePassword ? "Hide password" : "Show password"}
                    onClick={() => setVisiblePassword((current) => !current)}>{visiblePassword ? <FiEyeOff /> : <FiEye />}</button>
                </div>
              )}
              {stage === "login" && (role === "OWNER"
                ? <button className="garage-login-link garage-login-forgot" type="button" disabled={busy} onClick={() => switchStage("recovery")}>Forgot password?</button>
                : <p className="garage-login-help">Forgot your password? Ask your garage owner to reset it.</p>)}
              {stage === "recovery" && <p className="garage-login-help">An admin reviews your request and sends a temporary password to the email registered for your garage.</p>}
              {error && <p className="form-error" role="alert">{error}</p>}
              <button type="submit" className="garage-login-submit" disabled={busy}>
                {busy ? (stage === "login" ? "Signing in…" : "Sending request…") : stage === "login" ? "Sign in" : "Send reset request"}
                <FiArrowRight aria-hidden="true" />
              </button>
            </form>
          )}
        </div>
      </section>
    </main>
  );
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
