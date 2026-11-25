"use client";

import { useState, type FormEvent } from "react";
import { FiArrowRight, FiCheck, FiImage, FiVideo } from "react-icons/fi";
import { downloadEvidence, jobAction, type Job, type PartsAvailability } from "./workspace-state";
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

  async function submitQuotation(event: FormEvent<HTMLFormElement>) {
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
    if (!await jobAction(job.id, {
      action: "quote",
      quotation: { labour, parts, availability, note: String(form.get("note")).trim(), status: handingOver ? "Ready to hand over" : "Draft" },
    })) return;
    setError("");
    setMessage(handingOver ? "Quotation sent to the customer." : "Quotation draft saved.");
  }

  async function update(action: Record<string, unknown>, text: string) {
    if (await jobAction(job.id, action)) setMessage(text);
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
          {report.findings.map((finding, index) => <div className="finding-read" key={index}><strong>{finding.component}</strong><p>{finding.issue}</p><span>{finding.nextStep}</span>{report.evidence.filter((file) => finding.evidenceIds?.includes(file.id)).map((file) => <button key={file.id} type="button" className="text-button" onClick={() => downloadEvidence(job.id, file)}>{file.name}</button>)}</div>)}
          {job.status === "Ready for review" && <button className="button secondary full" type="button" onClick={() => update({ action: "return" }, "Report returned for edits.")}>Return for edits</button>}
          {job.status === "Ready for review" && <button className="button primary full" type="button" onClick={() => update({ action: "share" }, "Inspection report shared.")}>Share inspection report</button>}
          {job.shared && <button className="button secondary full" type="button" onClick={() => {
            if (window.confirm("Remove the customer's access to this report and its evidence?")) {
              void update({ action: "revoke" }, "Customer access revoked.");
              setSelected([]);
            }
          }}>Revoke customer access</button>}
          {canHandover && <button className="button secondary full" type="button" onClick={() => update({ action: "close" }, "Job closed.")}>Close job</button>}
        </>
      )}
      {tab === "Quotation" && (
        <>
          <h4>Repair quotation</h4>
          {quotation?.status === "Ready to hand over" && <p className="share-message"><FiCheck aria-hidden="true" /> Labour total {formatMoney(quotation.labour)}</p>}
          {canHandover && <form className="stack-form" onSubmit={submitQuotation}>
            <label>Required parts<textarea name="parts" rows={2} defaultValue={quotation?.parts.join("\n")} placeholder="One part per line" /></label>
            <label>Labour charge (BDT)<input name="labour" inputMode="decimal" required defaultValue={quotation ? quotation.labour / 100 : ""} placeholder="0.00" /></label>
            <div className="field-label"><span>Parts availability</span><GarageSelect label="Parts availability" name="availability" options={availabilityOptions} defaultValue={quotation?.availability ?? availabilityOptions[2]} /></div>
            <label>Note for customer <small className="muted">Optional</small><textarea name="note" rows={2} defaultValue={quotation?.note} /></label>
            <p className="muted">The labour total excludes parts. Confirm sourcing separately if requested.</p>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="handover-actions">
              {!job.shared && <button className="button secondary" type="submit" value="draft">Save draft</button>}
              <button className="button primary" type="submit" value="handover">Send quotation <FiArrowRight aria-hidden="true" /></button>
            </div>
          </form>}
        </>
      )}
      {tab === "Evidence" && (
        <>
          <h4>Customer evidence</h4>
          {job.evidenceRequested && <p className="share-message">Customer requested photo or video.</p>}
          {report.evidence.length ? report.evidence.map((item) => (
            <div key={item.id} className="evidence-choice">
              <input type="checkbox" aria-label={`Share ${item.name}`} checked={selected.includes(item.id)} disabled={!job.shared || !job.evidenceRequested} onChange={(event) => {
                const checked = event.currentTarget.checked;
                setSelected((ids) => checked ? [...ids, item.id] : ids.filter((id) => id !== item.id));
              }} />
              {item.kind === "photo" ? <FiImage aria-hidden="true" /> : <FiVideo aria-hidden="true" />} <button type="button" className="text-button" onClick={() => downloadEvidence(job.id, item)}>{item.name}</button>
            </div>
          )) : <p className="muted">This inspection has no photos or clips attached.</p>}
          {!!job.sharedEvidence?.length && <p className="share-message"><FiCheck aria-hidden="true" /> Shared {job.sharedEvidence.length} selected {job.sharedEvidence.length === 1 ? "file" : "files"}.</p>}
          {job.shared && job.evidenceRequested && report.evidence.length > 0 && (
            <button className="button primary full" type="button" onClick={() => update({ action: "evidence", evidenceIds: selected }, "Customer evidence updated.")}>Update shared evidence</button>
          )}
        </>
      )}
      {message && <p className="success-text" role="status"><FiCheck aria-hidden="true" /> {message}</p>}
    </section>
  );
}
