"use client";

import { useEffect, useState } from "react";
import { apiFileRequest, apiRequest, errorMessage } from "@/lib/api";
import { useSite } from "@/components/site-context";

type Shared = {
  jobId: string; vehicle: string; service: string; garage: string; sharedAt: string; evidenceRequested: boolean;
  report: { summary: string; findings: Array<{component: string; issue: string; nextStep: string}> };
  quotation: null | { labour: number; parts: string[]; availability: string; note: string };
  files: Array<{ id: string; name: string; kind: string }>;
};

export default function GarageReports() {
  const { customer, ready, openLogin } = useSite();
  const [items, setItems] = useState<Shared[]>();
  const [error, setError] = useState("");
  useEffect(() => {
    if (!customer) return;
    let current = true;
    apiRequest<Shared[]>("/customers/me/garage-reports")
      .then((data) => { if (current) setItems(data); })
      .catch((failure) => { if (current) setError(errorMessage(failure)); });
    return () => { current = false; };
  }, [customer]);

  async function requestEvidence(item: Shared) {
    try {
      await apiRequest(`/customers/me/garage-reports/${item.jobId}/request-evidence`, { method: "POST" });
      setItems((current) => current?.map((entry) => entry.jobId === item.jobId ? { ...entry, evidenceRequested: true } : entry));
    } catch (failure) { setError(errorMessage(failure)); }
  }

  async function download(item: Shared, file: Shared["files"][number]) {
    try {
      const response = await apiFileRequest(`/customers/me/garage-reports/${item.jobId}/evidence/${file.id}`);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url; link.download = file.name; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) { setError(errorMessage(failure)); }
  }

  return <main id="main-content" className="shell grid max-w-4xl gap-4 py-12">
    <h1 className="font-heading text-3xl font-extrabold">Garage Reports</h1>
    {!ready && <p role="status">Checking your session…</p>}
    {ready && !customer && <button className="parts-action w-fit" onClick={() => openLogin("signin", true)}>Sign in to view your reports</button>}
    {error && <p role="alert" className="dark-error">{error}</p>}
    {customer && !items && !error && <p role="status">Loading reports…</p>}
    {customer && items?.length === 0 && <p>Your garage has not shared an inspection yet.</p>}
    {customer && items?.map((item) => <article key={item.jobId} className="dash-card grid gap-3 p-5">
      <div><h2 className="text-xl font-bold">{item.vehicle}</h2><p>{item.garage} · {item.service}</p></div>
      <p>{item.report.summary}</p>
      <ul>{item.report.findings.map((finding, i) => <li className="mb-2" key={i}><strong>{finding.component}</strong> {finding.issue} {finding.nextStep}</li>)}</ul>
      {item.quotation && <section className="grid gap-1"><h3 className="font-bold">Repair quotation</h3><p>Labour charge ৳{(item.quotation.labour / 100).toFixed(2)}</p><p>Parts {item.quotation.parts.join(", ") || "—"}</p><p>{item.quotation.availability}</p><p>{item.quotation.note}</p></section>}
      {item.files.map((file) => <button className="text-left font-semibold text-[var(--accent)]" key={file.id} onClick={() => void download(item, file)}>Download {file.name}</button>)}
      <button className="text-left font-semibold text-[var(--accent)]" disabled={item.evidenceRequested} onClick={() => void requestEvidence(item)}>
        {item.evidenceRequested ? "Evidence requested" : "Request photo or video evidence"}
      </button>
    </article>)}
  </main>;
}
