"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { FiArrowRight, FiCamera, FiCheck, FiClipboard, FiClock, FiImage, FiPlus, FiTool, FiVideo, FiX } from "react-icons/fi";
import { sampleMechanicId, saveJob, useGarageDemo, type Evidence, type Finding, type Job, type Report } from "./demo-state";
import { MechanicProfile } from "./mechanic-profile";
import { mechanicTabs, Status, Workspace, type MechanicTab } from "./workspace";

const emptyReport: Report = { summary: "", findings: [], evidence: [] };

function isOpen(job: Job) {
  return job.status === "Assigned" || job.status === "In progress";
}

function ReportEditor({ job, onSubmitted }: { job: Job; onSubmitted: () => void }) {
  const [draft, setDraft] = useState<Report | null>(null);
  const report = draft ?? job.report ?? emptyReport;
  const [message, setMessage] = useState("");
  const [fileError, setFileError] = useState("");
  const [previewUrl, setPreviewUrl] = useState<{ id: string; url: string } | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const clipInput = useRef<HTMLInputElement>(null);
  const editable = isOpen(job);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl.url);
    };
  }, [previewUrl]);

  function editReport(update: (current: Report) => Report) {
    setDraft((current) => update(current ?? job.report ?? emptyReport));
  }

  function updateFinding(index: number, field: keyof Finding, value: string) {
    editReport((current) => ({ ...current, findings: current.findings.map((finding, position) => position === index ? { ...finding, [field]: value } : finding) }));
  }

  function addEvidence(event: ChangeEvent<HTMLInputElement>, kind: Evidence["kind"]) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;

    const photo = kind === "photo";
    const supported = photo ? ["image/jpeg", "image/png"] : ["video/mp4"];
    const sizeLimit = photo ? 5 : 30;
    const countLimit = photo ? 5 : 1;
    const error = !supported.includes(file.type)
      ? (photo ? "Choose a JPG or PNG photo." : "Choose an MP4 clip.")
      : file.size > sizeLimit * 1024 * 1024
        ? `Choose a file under ${sizeLimit} MiB.`
        : report.evidence.filter((item) => item.kind === kind).length >= countLimit
          ? `You can add up to ${countLimit} ${photo ? "photos" : "clip"}.`
          : "";

    setFileError(error);
    if (error) return;

    const item: Evidence = { id: crypto.randomUUID(), name: file.name, kind, size: file.size };
    editReport((current) => ({ ...current, evidence: [...current.evidence, item] }));
    if (photo) setPreviewUrl({ id: item.id, url: URL.createObjectURL(file) });
    setMessage("");
  }

  function persist(next: Job["status"]) {
    const summary = report.summary.trim();
    if (next === "Ready for review" && !summary) {
      setMessage("Add an inspection summary before submitting.");
      return;
    }
    saveJob({ ...job, report: { ...report, summary }, status: next });
    setDraft(null);
    setMessage(next === "Ready for review" ? "Report ready for owner review." : "Draft saved in this browser.");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    persist("Ready for review");
    if (report.summary.trim()) onSubmitted();
  }

  return (
    <article className="panel inspection" id="inspection-report" aria-labelledby="inspection-title">
      <div className="inspection-top">
        <div><p className="job-ref">{job.id} · {job.service}</p><h2 id="inspection-title">{job.vehicle}</h2><p className="muted">{job.registration}</p></div>
        <Status status={job.status} />
      </div>
      <div className="concern"><span>Customer concern</span><p>{job.concern || "No concern added."}</p></div>

      <form className="inspection-form" onSubmit={submit}>
        <section className="inspection-section">
          <h3>Inspection report</h3>
          <label className="report-label">Summary <span>Required to submit</span>
            <textarea rows={3} value={report.summary} disabled={!editable} placeholder="Describe what you checked and what you found." onChange={(event) => {
              const summary = event.currentTarget.value;
              editReport((current) => ({ ...current, summary }));
              setMessage("");
            }} />
          </label>
          {report.findings.map((finding, index) => (
            <fieldset className="finding-fields stack-form" key={index}>
              <legend>Finding {index + 1}</legend>
              <label>Component<input value={finding.component} disabled={!editable} onChange={(event) => updateFinding(index, "component", event.currentTarget.value)} /></label>
              <label>What you observed<input value={finding.issue} disabled={!editable} onChange={(event) => updateFinding(index, "issue", event.currentTarget.value)} /></label>
              <label>Recommended next step<input value={finding.nextStep} disabled={!editable} onChange={(event) => updateFinding(index, "nextStep", event.currentTarget.value)} /></label>
              {editable && <button type="button" className="text-button" onClick={() => editReport((current) => ({ ...current, findings: current.findings.filter((_, position) => position !== index) }))}>Remove finding</button>}
            </fieldset>
          ))}
          {editable && <button className="button secondary" type="button" onClick={() => editReport((current) => ({ ...current, findings: [...current.findings, { component: "", issue: "", nextStep: "" }] }))}><FiPlus aria-hidden="true" /> Add finding</button>}
        </section>

        <section className="inspection-section evidence-section" aria-labelledby="evidence-title">
          <div className="section-title"><h3 id="evidence-title">Evidence</h3><span>{job.consent ? "Consent recorded" : "Consent required"}</span></div>
          {job.consent ? (
            <>
              {editable && (
                <div className="upload-grid">
                  <button type="button" className="upload" onClick={() => photoInput.current?.click()}><FiCamera aria-hidden="true" /><span><strong>Add photo</strong><small>JPG or PNG · up to 5 MiB</small></span></button>
                  <button type="button" className="upload" onClick={() => clipInput.current?.click()}><FiVideo aria-hidden="true" /><span><strong>Add video clip</strong><small>MP4 · up to 30 MiB</small></span></button>
                  <input ref={photoInput} type="file" accept="image/jpeg,image/png" aria-label="Choose inspection photo" hidden onChange={(event) => addEvidence(event, "photo")} />
                  <input ref={clipInput} type="file" accept="video/mp4" aria-label="Choose inspection clip" hidden onChange={(event) => addEvidence(event, "clip")} />
                </div>
              )}
              {fileError && <p className="form-error" role="alert">{fileError}</p>}
              {!!report.evidence.length && <ul className="evidence-list">
                {report.evidence.map((item) => (
                  <li key={item.id}>
                    {previewUrl?.id === item.id
                      ? <img src={previewUrl.url} alt="Selected inspection evidence" />
                      : item.kind === "photo" ? <FiImage aria-hidden="true" /> : <FiVideo aria-hidden="true" />}
                    <span>{item.name}<small>{Math.max(1, Math.round(item.size / 1024))} KiB</small></span>
                    {editable && <button type="button" className="icon-button" aria-label={`Remove ${item.name}`} onClick={() => {
                      if (previewUrl?.id === item.id) setPreviewUrl(null);
                      editReport((current) => ({ ...current, evidence: current.evidence.filter((evidence) => evidence.id !== item.id) }));
                      setFileError("");
                    }}><FiX /></button>}
                  </li>
                ))}
              </ul>}
            </>
          ) : <p className="muted">You can submit a text report for this job.</p>}
        </section>

        <div className="inspection-footer">
          {message && <p className={report.summary.trim() ? "success-text" : "form-error"} role="status">{report.summary.trim() && <FiCheck aria-hidden="true" />}{message}</p>}
          {editable && <div className="report-actions">
            <button className="button secondary" type="button" onClick={() => persist("In progress")}>Save draft</button>
            <button className="button primary" type="submit">Submit report <FiArrowRight aria-hidden="true" /></button>
          </div>}
        </div>
      </form>
    </article>
  );
}

export function MechanicWorkspace() {
  const { jobs, mechanics, profile } = useGarageDemo();
  const mechanic = mechanics.find((item) => item.id === sampleMechanicId);
  const [tab, setTab] = useState<MechanicTab>("Dashboard");
  const [showClosed, setShowClosed] = useState(false);
  const [selectedId, setSelectedId] = useState("JOB-104");
  const myJobs = jobs.filter((job) => mechanic?.active && job.mechanicId === mechanic.id);
  const openJobs = myJobs.filter(isOpen);
  const visibleJobs = showClosed ? myJobs.filter((job) => !isOpen(job)) : openJobs;
  const selectedJob = visibleJobs.find((job) => job.id === selectedId) ?? visibleJobs[0];

  function jumpToJob(job: Job) {
    setShowClosed(!isOpen(job));
    setSelectedId(job.id);
    setTab("My Jobs");
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  const metrics = [
    { label: "Active jobs", count: openJobs.length, icon: FiClock, tone: "blue" },
    { label: "Awaiting review", count: myJobs.filter((job) => job.status === "Ready for review").length, icon: FiClipboard, tone: "purple" },
    { label: "Completed", count: myJobs.filter((job) => job.status === "Shared" || job.status === "Closed").length, icon: FiCheck, tone: "green" },
  ];

  return (
    <Workspace role="mechanic" name={mechanic?.name ?? "Mechanic"} photo={mechanic?.photo} garage={profile.name} tab={tab} tabs={mechanicTabs} onTab={setTab}>
      {tab === "Dashboard" && (
        <>
          <div className="dashboard-banner mechanic-banner"><div><p className="banner-label">Mechanic dashboard</p><h1>Hi, {mechanic?.name.split(" ")[0] ?? "mechanic"}</h1><p>{profile.name}</p></div><button className="button banner-button" type="button" onClick={() => setTab("My Jobs")}>My jobs <FiArrowRight aria-hidden="true" /></button></div>
          <div className="metric-grid mechanic-metrics" aria-label="My job totals">
            {metrics.map(({ label, count, icon: Icon, tone }) => <article className="panel finance-total" key={label}><span className={`metric-icon tone-${tone}`}><Icon aria-hidden="true" /></span><span className="metric-label">{label}</span><strong>{count}</strong></article>)}
          </div>
          <section className="panel dashboard-list mechanic-next" aria-labelledby="next-jobs-title">
            <div className="list-heading"><div><h2 id="next-jobs-title">Next jobs</h2><p className="muted">Pick a vehicle to open its inspection.</p></div><span className="detail-icon"><FiTool aria-hidden="true" /></span></div>
            <ul>{openJobs.map((job) => <li key={job.id}><button type="button" className="dashboard-job" onClick={() => jumpToJob(job)}><span className="vehicle-icon"><FiTool aria-hidden="true" /></span><span><strong>{job.vehicle}</strong><small>{job.id} · {job.service}</small></span><Status status={job.status} /><FiArrowRight className="next-job-arrow" aria-hidden="true" /></button></li>)}</ul>
            {!openJobs.length && <p className="empty-state">No active jobs assigned.</p>}
          </section>
        </>
      )}

      {tab === "Profile" && (
        <>
          <div className="page-heading"><div><h1>My profile</h1><p>Manage your photo and contact information.</p></div></div>
          {mechanic && <MechanicProfile mechanic={mechanic} />}
        </>
      )}

      {tab === "My Jobs" && (
        <>
          <div className="page-heading"><div><h1>My jobs</h1><p>Open a vehicle to work on its inspection.</p></div></div>
          <div className="mechanic-grid">
            <section className="panel mechanic-list" aria-labelledby="assigned-title">
              <div className="list-heading"><div><h2 id="assigned-title">Job list</h2><p className="muted">{openJobs.length} active jobs</p></div><span className="detail-icon"><FiClipboard aria-hidden="true" /></span></div>
              <div className="segmented mechanic-filter">
                <button type="button" aria-pressed={!showClosed} onClick={() => setShowClosed(false)}>Active</button>
                <button type="button" aria-pressed={showClosed} onClick={() => setShowClosed(true)}>Submitted / closed</button>
              </div>
              <ul>
                {visibleJobs.map((job) => (
                  <li key={job.id}><button type="button" className="mechanic-job" aria-pressed={selectedJob?.id === job.id} onClick={() => {
                    setSelectedId(job.id);
                    if (window.matchMedia("(max-width: 840px)").matches) document.getElementById("inspection-report")?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}>
                    <span className="vehicle-icon"><FiTool aria-hidden="true" /></span>
                    <span className="mechanic-job-name"><strong>{job.vehicle}</strong><small>{job.id} · {job.service}</small><Status status={job.status} /></span>
                    <FiArrowRight className="next-job-arrow" aria-hidden="true" />
                  </button></li>
                ))}
              </ul>
              {!visibleJobs.length && <p className="empty-state">No jobs in this view.</p>}
            </section>
            {selectedJob && <ReportEditor key={selectedJob.id} job={selectedJob} onSubmitted={() => setShowClosed(true)} />}
          </div>
        </>
      )}
    </Workspace>
  );
}
