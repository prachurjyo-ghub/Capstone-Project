"use client";

import { useState, type FormEvent } from "react";
import { FiArrowRight, FiCheck, FiImage, FiVideo } from "react-icons/fi";
import { saveJob, type Job, type PartsAvailability } from "./demo-state";
import { formatMoney, parseAmount } from "./finance";
import { GarageSelect } from "./ui/select";

const tabs = ["Report", "Quotation", "Evidence"] as const;
const availabilityOptions: PartsAvailability[] = ["Customer supplies parts", "Can source on request", "Availability to be confirmed"];

export function JobHandover({ job }: { job: Job }) {
  const [tab, setTab] = useState<(typeof tabs)[number]>("Report");
  const [selected, setSelected] = useState(job.sharedEvidence ?? []);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const report = job.report;
  if (!report) return null;
  const quotation = job.quotation;
  const canHandover = job.status === "Ready for review" || job.status === "Shared";

  function submitQuotation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const intent = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value");
    const form = new FormData(event.currentTarget);
    const labour = parseAmount(String(form.get("labour")).trim());
    if (labour === null) {
      setError("Enter a labour charge with up to two decimal places.");
      return;
    }
    const parts = String(form.get("parts")).split("\n").map((part) => part.trim()).filter(Boolean);
    const availability = availabilityOptions.find((option) => option === form.get("availability")) ?? availabilityOptions[2];
    const handingOver = intent === "handover";
    saveJob({
      ...job,
      status: handingOver ? "Shared" : "Ready for review",
      quotation: { labour, parts, availability, note: String(form.get("note")).trim(), status: handingOver ? "Ready to hand over" : "Draft" },
    });
    setError("");
    setMessage(handingOver ? "Quotation ready for customer handover." : "Quotation draft saved.");
  }

  return (
    <section className="detail-report" aria-label="Job handover">
      <div className="segmented handover-tabs" aria-label="Handover sections">
        {tabs.map((item) => <button type="button" key={item} aria-pressed={tab === item} onClick={() => { setTab(item); setMessage(""); setError(""); }}>{item}</button>)}
      </div>
      {tab === "Report" && (
        <>
          <h4>Inspection report</h4>
          <p>{report.summary}</p>
          {report.findings.map((finding, index) => <div className="finding-read" key={index}><strong>{finding.component}</strong><p>{finding.issue}</p><span>{finding.nextStep}</span></div>)}
          {job.status === "Ready for review" && <button className="button secondary full" type="button" onClick={() => saveJob({ ...job, status: "In progress", sharedEvidence: [] })}>Return for edits</button>}
        </>
      )}
      {tab === "Quotation" && (
        <>
          <h4>Repair quotation</h4>
          {quotation?.status === "Ready to hand over" && <p className="share-message"><FiCheck aria-hidden="true" /> Labour total {formatMoney(quotation.labour)} · ready for handover</p>}
          {canHandover && <form className="stack-form" onSubmit={submitQuotation}>
            <label>Required parts<textarea name="parts" rows={2} defaultValue={quotation?.parts.join("\n")} placeholder="One part per line" /></label>
            <label>Labour charge (BDT)<input name="labour" inputMode="decimal" required defaultValue={quotation ? quotation.labour / 100 : ""} placeholder="0.00" /></label>
            <div className="field-label"><span>Parts availability</span><GarageSelect label="Parts availability" name="availability" options={availabilityOptions} defaultValue={quotation?.availability ?? availabilityOptions[2]} /></div>
            <label>Note for customer <small className="muted">Optional</small><textarea name="note" rows={2} defaultValue={quotation?.note} /></label>
            <p className="muted">The labour total excludes parts. Confirm sourcing separately if requested.</p>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="handover-actions">
              <button className="button secondary" type="submit" value="draft">Save draft</button>
              <button className="button primary" type="submit" value="handover">Prepare handover <FiArrowRight aria-hidden="true" /></button>
            </div>
          </form>}
        </>
      )}
      {tab === "Evidence" && (
        <>
          <h4>Customer evidence</h4>
          <label className="evidence-choice">
            <input type="checkbox" checked={!!job.evidenceRequested} disabled={!canHandover} onChange={(event) => {
              saveJob({ ...job, evidenceRequested: event.currentTarget.checked });
              setMessage("");
            }} /> Customer requested photo or video
          </label>
          {report.evidence.length ? report.evidence.map((item) => (
            <label key={item.id} className="evidence-choice">
              <input type="checkbox" checked={selected.includes(item.id)} disabled={!canHandover} onChange={(event) => {
                const checked = event.currentTarget.checked;
                setSelected((ids) => checked ? [...ids, item.id] : ids.filter((id) => id !== item.id));
              }} />
              {item.kind === "photo" ? <FiImage aria-hidden="true" /> : <FiVideo aria-hidden="true" />} {item.name}
            </label>
          )) : <p className="muted">This inspection has no photos or clips attached.</p>}
          {!!job.sharedEvidence?.length && <p className="share-message"><FiCheck aria-hidden="true" /> Prepared {job.sharedEvidence.length} selected {job.sharedEvidence.length === 1 ? "file" : "files"} for sharing.</p>}
          {canHandover && report.evidence.length > 0 && (
            <button className="button primary full" type="button" disabled={!selected.length} onClick={() => {
              saveJob({ ...job, sharedEvidence: selected });
              setMessage("Selected evidence is ready for customer handover.");
            }}>Prepare selected evidence</button>
          )}
          {canHandover && !!job.sharedEvidence?.length && <button className="button secondary full" type="button" onClick={() => {
            saveJob({ ...job, sharedEvidence: [] });
            setSelected([]);
            setMessage("Evidence removed from the handover.");
          }}>Remove from handover</button>}
        </>
      )}
      {message && <p className="success-text" role="status"><FiCheck aria-hidden="true" /> {message}</p>}
    </section>
  );
}
