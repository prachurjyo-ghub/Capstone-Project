"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api, message as errorMessage } from "@/lib/api";

type Garage = {
  id: string; name: string; contactPhone: string; endsAt: string; amount: number | null;
  published: boolean; status: "Active" | "Expired" | "Terminated";
  owner?: { username: string; user: { email: string; fullName: string } };
};

type Recovery = {
  memberId: string; requestedAt: string; username: string; garageName: string;
  ownerName: string | null; email: string;
};

export default function GaragesPage() {
  const [garages, setGarages] = useState<Garage[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [temporary, setTemporary] = useState("");
  const [recovery, setRecovery] = useState<Recovery[]>();
  const [recipient, setRecipient] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const reloadRecovery = async () => setRecovery(await api<Recovery[]>("/admin/garage-owner-recovery"));
  const reload = async () => setGarages(await api<Garage[]>("/admin/garages"));

  useEffect(() => {
    let current = true;
    api<Garage[]>("/admin/garages").then((items) => { if (current) setGarages(items); })
      .catch((failure) => { if (current) setError(errorMessage(failure)); })
      .finally(() => { if (current) setLoading(false); });
    api<Recovery[]>("/admin/garage-owner-recovery").then((items) => { if (current) setRecovery(items); })
      .catch((failure) => { if (current) setError(errorMessage(failure)); });
    return () => { current = false; };
  }, []);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const amount = String(values.get("amount")).trim();
    if (amount && !/^\d{1,8}(\.\d{1,2})?$/.test(amount)) {
      setError("Enter a valid BDT amount with up to two decimal places.");
      return;
    }
    setBusy(true); setError(""); setTemporary(""); setRecipient(""); setCopied(false);
    try {
      const result = await api<{ temporaryPassword: string }>("/admin/garages", {
        method: "POST",
        body: JSON.stringify({
          garageName: values.get("garageName"), name: values.get("name"), username: values.get("username"),
          email: values.get("email"), contactPhone: values.get("contactPhone"), months: Number(values.get("months")),
          amount: amount ? Math.round(Number(amount) * 100) : null,
        }),
      });
      setShowForm(false); setTemporary(result.temporaryPassword);
      await reload();
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }

  async function change(garage: Garage, action: "terminate" | "reset-owner") {
    const prompt = action === "terminate" ? "Terminate access for" : "Reset owner credentials for";
    if (!window.confirm(`${prompt} ${garage.name}?`)) return;
    setBusy(true); setError(""); setTemporary(""); setRecipient(""); setCopied(false);
    try {
      const result = await api<{ temporaryPassword?: string }>(`/admin/garages/${garage.id}/${action}`, { method: "POST" });
      setTemporary(result.temporaryPassword ?? "");
      await Promise.all([reload(), reloadRecovery()]);
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }

  async function refreshRequests() {
    setError("");
    try { await reloadRecovery(); }
    catch (failure) { setError(errorMessage(failure)); }
  }

  async function issuePassword(request: Recovery) {
    if (!window.confirm(`Issue a temporary password for ${request.garageName} and end the owner's current sessions?`)) return;
    setBusy(true); setError(""); setTemporary(""); setRecipient(""); setCopied(false);
    try {
      const result = await api<{ temporaryPassword: string; email: string }>(
        `/admin/garage-owner-recovery/${request.memberId}/reset`, { method: "POST" },
      );
      setTemporary(result.temporaryPassword);
      setRecipient(result.email);
      setRecovery((items) => items?.filter((item) => item.memberId !== request.memberId));
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }

  async function copyPassword() {
    try { await navigator.clipboard.writeText(temporary); setCopied(true); }
    catch { setError("Select and copy the temporary password manually."); }
  }


  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-bold">Garages</h1><p className="text-sm text-muted-foreground">Manage garage accounts and access periods.</p></div>
        <button className="rounded-lg bg-primary px-4 py-2.5 font-semibold text-primary-foreground" type="button" onClick={() => setShowForm((current) => !current)}>{showForm ? "Close form" : "Create Garage"}</button>
      </div>
      {error && <p role="alert" className="rounded-lg border p-3 text-danger">{error}</p>}
      {temporary && <div role="status" className="panel grid gap-2 p-4">
        <strong>Temporary password</strong><p>Share privately. The owner must change it at first sign-in.</p><code className="break-all">{temporary}</code>
        {recipient && <p className="break-all">Send to {recipient}</p>}
        <div className="flex flex-wrap gap-2">
          <button className="field w-fit" type="button" onClick={() => void copyPassword()}>{copied ? "Copied" : "Copy password"}</button>
          {recipient && <a className="field w-fit" href={`mailto:${encodeURIComponent(recipient)}?subject=Parts%20Arc%20garage%20password%20reset`}>Compose email</a>}
          <button className="field w-fit" type="button" onClick={() => { setTemporary(""); setRecipient(""); setCopied(false); }}>Dismiss password</button>
        </div>
      </div>}
      {showForm && <form className="panel grid gap-4 p-4 sm:grid-cols-2" onSubmit={create}>
        {([["garageName", "Garage name", "text"], ["name", "Owner full name", "text"], ["username", "Owner username", "text"],
          ["email", "Owner contact email", "email"], ["contactPhone", "Owner contact phone", "tel"]] as const).map(([name, label, type]) =>
          <label className="label grid gap-1" key={name}>{label}<input className="field" name={name} type={type} required /></label>,
        )}
        <label className="label grid gap-1">Access duration (months)<input className="field" name="months" type="number" min="1" max="120" defaultValue="1" required /></label>
        <label className="label grid gap-1">Amount received (BDT)<input className="field" name="amount" inputMode="decimal" /></label>
        <button className="self-end rounded-lg bg-primary px-4 py-2.5 font-semibold text-primary-foreground" type="submit" disabled={busy}>Save garage</button>
      </form>}
      <section className="panel grid gap-3 p-4" aria-labelledby="garage-recovery-title">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="garage-recovery-title" className="text-lg font-bold">Owner password requests{recovery && recovery.length > 0 ? ` (${recovery.length})` : ""}</h2>
          <button type="button" className="field w-fit" onClick={() => void refreshRequests()} disabled={busy}>Refresh requests</button>
        </div>
        {recovery?.length === 0 && <p className="text-sm text-muted-foreground">No pending owner password requests.</p>}
        {recovery?.map((request) => <article key={request.memberId} className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
          <div className="min-w-0">
            <h3 className="font-semibold">{request.garageName}</h3>
            <p className="break-all text-sm text-muted-foreground">{request.ownerName} (@{request.username}) · {request.email}</p>
            <time className="text-sm text-muted-foreground" dateTime={request.requestedAt}>{new Date(request.requestedAt).toLocaleString("en-GB", { timeZone: "Asia/Dhaka" })}</time>
          </div>
          <button type="button" className="field w-fit" onClick={() => void issuePassword(request)} disabled={busy}>Issue temporary password</button>
        </article>)}
      </section>
      <div className="grid gap-3">
        {loading && <p role="status">Loading garages…</p>}
        {!loading && !garages.length && <p className="panel p-4 text-muted-foreground">No garages have been created.</p>}
        {garages.map((garage) => <article className="panel grid gap-4 p-4 lg:grid-cols-[1fr_1fr_auto]" key={garage.id}>
          <div><h2 className="font-bold">{garage.name}</h2><p className="text-sm text-muted-foreground">@{garage.owner?.username} · {garage.owner?.user.email}</p><p className="text-sm">{garage.contactPhone}</p></div>
          <div><p className="font-semibold">{garage.status} · {garage.published && garage.status === "Active" ? "Listed" : "Hidden"}</p><p>Ends {new Date(garage.endsAt).toLocaleDateString("en-GB", { timeZone: "Asia/Dhaka" })}</p><p>Received {garage.amount === null ? "—" : `৳${(garage.amount / 100).toFixed(2)}`}</p></div>
          <div className="flex flex-wrap items-center gap-2">
            <button className="field w-auto" type="button" disabled={busy || !garage.owner} onClick={() => void change(garage, "reset-owner")}>Reset owner access</button>
            {garage.status !== "Terminated" && <button className="field w-auto text-danger" type="button" disabled={busy} onClick={() => void change(garage, "terminate")}>Terminate access</button>}
          </div>
        </article>)}
      </div>
    </div>
  );
}
