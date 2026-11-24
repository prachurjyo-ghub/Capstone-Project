"use client";

import { useRef, useState, type FormEvent } from "react";
import { FiArrowRight, FiCheck, FiClipboard, FiClock, FiImage, FiPlus, FiTool, FiUser, FiVideo, FiX } from "react-icons/fi";
import { garageServices, saveJob, saveMechanic, saveProfile, useGarageDemo, type Job, type Mechanic } from "./demo-state";
import { Status, Workspace, type OwnerTab } from "./workspace";

type Filter = "All jobs" | "Needs assignment" | "In progress" | "Ready for review" | "Closed";
type Modal = "job" | "mechanic";
const filters: Filter[] = ["All jobs", "Needs assignment", "In progress", "Ready for review", "Closed"];

function matchesFilter(job: Job, filter: Filter) {
  switch (filter) {
    case "Needs assignment": return job.status === "Unassigned";
    case "In progress": return job.status === "Assigned" || job.status === "In progress";
    case "Ready for review": return job.status === "Ready for review";
    case "Closed": return job.status === "Closed" || job.status === "Shared";
    default: return true;
  }
}

function JobDetail({ job, mechanics }: { job: Job; mechanics: Mechanic[] }) {
  const [selectedEvidence, setSelectedEvidence] = useState<string[]>([]);

  function assign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const mechanicId = String(new FormData(event.currentTarget).get("mechanic"));
    if (mechanicId) saveJob({ ...job, mechanicId, status: "Assigned" });
  }

  const canAssign = !job.report && ["Unassigned", "Assigned"].includes(job.status);
  return (
    <aside className="panel job-detail" id="job-detail" aria-label="Job details">
      <div className="detail-top"><span className="detail-icon"><FiClipboard aria-hidden="true" /></span><Status status={job.status} /></div>
      <p className="job-ref">{job.id}</p>
      <h3>{job.vehicle}</h3>
      <p className="muted">{job.registration || job.service}</p>
      <dl className="detail-fields">
        <div><dt>Service</dt><dd>{job.service}</dd></div>
        <div><dt>Mechanic</dt><dd>{mechanics.find((mechanic) => mechanic.id === job.mechanicId)?.name ?? "Unassigned"}</dd></div>
      </dl>
      <div className="concern"><span>Customer concern</span><p>{job.concern || "No concern added."}</p></div>

      {canAssign && (
        <form className="stack-form" onSubmit={assign}>
          <label>Assign mechanic
            <select name="mechanic" defaultValue={job.mechanicId} required>
              <option value="">Select mechanic</option>
              {mechanics.filter((mechanic) => mechanic.active).map((mechanic) => <option value={mechanic.id} key={mechanic.id}>{mechanic.name}</option>)}
            </select>
          </label>
          <button className="button primary full" type="submit"><FiUser aria-hidden="true" /> {job.mechanicId ? "Update assignment" : "Assign mechanic"}</button>
        </form>
      )}

      {job.report && ["Ready for review", "Shared", "Closed"].includes(job.status) && (
        <section className="detail-report" aria-label="Inspection report">
          <h4>Inspection report</h4>
          <p>{job.report.summary}</p>
          {job.report.findings.map((finding, index) => <div className="finding-read" key={index}><strong>{finding.component}</strong><p>{finding.issue}</p><span>{finding.nextStep}</span></div>)}
          {job.status === "Ready for review" && (
            <>
              {job.report.evidence.length > 0 && <p className="muted">Select files to share with the report.</p>}
              {job.report.evidence.map((item) => (
                <label key={item.id} className="evidence-choice">
                  <input type="checkbox" checked={selectedEvidence.includes(item.id)} onChange={(event) => {
                    const checked = event.currentTarget.checked;
                    setSelectedEvidence((ids) => checked ? [...ids, item.id] : ids.filter((id) => id !== item.id));
                  }} />
                  {item.kind === "photo" ? <FiImage aria-hidden="true" /> : <FiVideo aria-hidden="true" />} {item.name}
                </label>
              ))}
              <button className="button primary full" type="button" onClick={() => saveJob({ ...job, status: "Shared", sharedEvidence: selectedEvidence })}>Share with customer <FiArrowRight aria-hidden="true" /></button>
              <button className="button secondary full" type="button" onClick={() => saveJob({ ...job, status: "In progress" })}>Return for edits</button>
            </>
          )}
          {job.status === "Shared" && (
            <>
              <p className="share-message" role="status"><FiCheck aria-hidden="true" /> Marked shared in this preview ({job.sharedEvidence?.length ?? 0} files).</p>
              <button className="button secondary full" type="button" onClick={() => saveJob({ ...job, status: "Ready for review", sharedEvidence: undefined })}>Revoke preview share</button>
            </>
          )}
        </section>
      )}
    </aside>
  );
}

function ProfileForm() {
  const { profile } = useGarageDemo();
  const [saved, setSaved] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    saveProfile({
      name: String(fields.get("name")).trim(),
      area: String(fields.get("area")),
      type: String(fields.get("type")),
      address: String(fields.get("address")).trim(),
      phone: String(fields.get("phone")).trim(),
      hours: String(fields.get("hours")).trim(),
      services: fields.getAll("service").map(String),
    });
    setSaved(true);
  }

  return (
    <form className="panel profile-form stack-form" onSubmit={submit} onChange={() => setSaved(false)}>
      <h2>Public garage information</h2>
      <div className="form-grid">
        <label>Garage name<input name="name" required defaultValue={profile.name} /></label>
        <label>Area<select name="area" defaultValue={profile.area} required>{["Mirpur", "Dhanmondi", "Uttara"].map((area) => <option key={area}>{area}</option>)}</select></label>
        <label>Garage type<select name="type" defaultValue={profile.type} required>{["General workshop", "Specialist workshop", "Body shop"].map((type) => <option key={type}>{type}</option>)}</select></label>
        <label>Public phone<input name="phone" type="tel" defaultValue={profile.phone} placeholder="e.g. +880 1…" /></label>
        <label>Street address<input name="address" defaultValue={profile.address} required /></label>
        <label>Opening hours<input name="hours" defaultValue={profile.hours} /></label>
      </div>
      <fieldset className="service-choices">
        <legend>Services offered</legend>
        {garageServices.map((service) => <label key={service}><input type="checkbox" name="service" value={service} defaultChecked={profile.services.includes(service)} /> {service}</label>)}
      </fieldset>
      <div className="form-actions">
        <button className="button primary" type="submit">Save profile</button>
        {saved && <span className="success-text" role="status"><FiCheck aria-hidden="true" /> Saved in this browser</span>}
      </div>
    </form>
  );
}

export function OwnerWorkspace() {
  const { jobs, mechanics, profile } = useGarageDemo();
  const [tab, setTab] = useState<OwnerTab>("Jobs");
  const [filter, setFilter] = useState<Filter>("All jobs");
  const [selectedId, setSelectedId] = useState("JOB-103");
  const [modal, setModal] = useState<Modal>("job");
  const [formError, setFormError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const visibleJobs = jobs.filter((job) => matchesFilter(job, filter));
  const selectedJob = jobs.find((job) => job.id === selectedId) ?? visibleJobs[0];

  function applyFilter(nextFilter: Filter) {
    setFilter(nextFilter);
    if (!selectedJob || !matchesFilter(selectedJob, nextFilter)) {
      setSelectedId(jobs.find((job) => matchesFilter(job, nextFilter))?.id ?? "");
    }
  }

  function openModal(nextModal: Modal) {
    setModal(nextModal);
    setFormError("");
    dialog.current?.showModal();
  }

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const field = (name: string) => String(data.get(name) ?? "").trim();

    if (modal === "mechanic") {
      const username = field("username").toLowerCase();
      if (!/^[a-z0-9_.-]+$/.test(username)) {
        setFormError("Use letters, numbers, dots, underscores or hyphens for the username.");
        return;
      }
      if (mechanics.some((mechanic) => mechanic.username === username)) {
        setFormError("This username already exists in the preview.");
        return;
      }
      saveMechanic({ id: crypto.randomUUID(), name: field("name"), username, email: field("email"), active: true });
    } else {
      const nextNumber = Math.max(...jobs.map((job) => Number(job.id.slice(4)))) + 1;
      const id = `JOB-${nextNumber}`;
      saveJob({
        id, vehicle: field("vehicle"), registration: field("registration"), service: field("service"),
        customer: field("customer"), concern: field("concern"), mechanicId: "", status: "Unassigned", consent: data.has("consent"),
      });
      setFilter("All jobs");
      setSelectedId(id);
    }

    form.reset();
    dialog.current?.close();
  }

  const metrics = [
    { label: "Needs assignment", icon: FiUser, tone: "amber" },
    { label: "In progress", icon: FiClock, tone: "blue" },
    { label: "Ready for review", icon: FiClipboard, tone: "purple" },
  ] as const;

  return (
    <Workspace role="owner" name="Farhan Ahmed" garage={profile.name} tab={tab} onTab={setTab}>
      <div className="page-heading">
        <div><h1>{tab === "Jobs" ? "Garage jobs" : tab}</h1><p>{tab === "Jobs" ? "Assign jobs and review vehicle inspections." : tab === "Mechanics" ? "Manage the people who inspect vehicles at your garage." : "Edit the details customers see in the garage directory."}</p></div>
        {tab !== "Garage Profile" && <button className="button primary" type="button" onClick={() => openModal(tab === "Jobs" ? "job" : "mechanic")}><FiPlus aria-hidden="true" /> {tab === "Jobs" ? "New job" : "Add mechanic"}</button>}
      </div>

      {tab === "Jobs" && (
        <>
          <div className="metric-grid" aria-label="Job counts">
            {metrics.map(({ label, icon: Icon, tone }) => (
              <button type="button" className="panel metric" key={label} onClick={() => applyFilter(label)} aria-pressed={filter === label}>
                <span className={`metric-icon tone-${tone}`}><Icon aria-hidden="true" /></span>
                <span className="metric-label">{label}</span>
                <strong>{jobs.filter((job) => matchesFilter(job, label)).length}</strong>
              </button>
            ))}
          </div>
          <div className="owner-jobs-grid">
            <section className="panel job-list" aria-labelledby="job-list-title">
              <div className="list-heading">
                <div><h2 id="job-list-title">Job queue</h2><p className="muted">{visibleJobs.length} {visibleJobs.length === 1 ? "job" : "jobs"}</p></div>
                <label className="visually-hidden" htmlFor="job-filter">Filter jobs</label>
                <select id="job-filter" value={filter} onChange={(event) => applyFilter(event.currentTarget.value as Filter)}>{filters.map((item) => <option key={item}>{item}</option>)}</select>
              </div>
              <div className="queue-labels" aria-hidden="true"><span>Vehicle</span><span>Mechanic</span><span>Status</span></div>
              <ul className="queue">
                {visibleJobs.map((job) => (
                  <li key={job.id}><button className="queue-row" aria-pressed={selectedJob?.id === job.id} type="button" onClick={() => {
                    setSelectedId(job.id);
                    if (window.matchMedia("(max-width: 840px)").matches) document.getElementById("job-detail")?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}>
                    <span className="queue-vehicle"><span className="vehicle-icon"><FiTool aria-hidden="true" /></span><span><strong>{job.vehicle}</strong><small>{job.id} · {job.service}</small></span></span>
                    <span className="queue-mechanic">{mechanics.find((mechanic) => mechanic.id === job.mechanicId)?.name ?? "Unassigned"}</span>
                    <Status status={job.status} />
                    <FiArrowRight className="queue-arrow" aria-hidden="true" />
                  </button></li>
                ))}
              </ul>
              {!visibleJobs.length && <p className="empty-state">No jobs in this status.</p>}
            </section>
            {selectedJob && <JobDetail key={selectedJob.id} job={selectedJob} mechanics={mechanics} />}
          </div>
        </>
      )}

      {tab === "Mechanics" && (
        <section className="panel team-list" aria-label="Mechanics">
          {mechanics.map((mechanic) => (
            <div className="team-row" key={mechanic.id}>
              <span className="avatar"><FiUser aria-hidden="true" /></span>
              <div><strong>{mechanic.name}</strong><p className="muted">@{mechanic.username} · {mechanic.active ? "Active" : "Inactive"}</p></div>
              <button className="button secondary" type="button" onClick={() => saveMechanic({ ...mechanic, active: !mechanic.active })}>{mechanic.active ? "Deactivate" : "Activate"}</button>
            </div>
          ))}
        </section>
      )}

      {tab === "Garage Profile" && <ProfileForm />}

      <dialog className="workspace-dialog" ref={dialog} aria-labelledby="create-title">
        <div className="dialog-heading"><h2 id="create-title">{modal === "job" ? "New job" : "Add mechanic"}</h2><button className="icon-button" type="button" aria-label="Close form" onClick={() => dialog.current?.close()}><FiX /></button></div>
        <form className="stack-form" onSubmit={create} key={modal}>
          {modal === "job" ? (
            <>
              <label>Vehicle<input name="vehicle" placeholder="e.g. Toyota Axio" required /></label>
              <label>Registration number<input name="registration" /></label>
              <label>Customer email<input name="customer" type="email" placeholder="customer@example.test" required /></label>
              <label>Service<select name="service">{garageServices.map((service) => <option key={service}>{service}</option>)}</select></label>
              <label>Customer concern<textarea name="concern" rows={2} /></label>
              <label className="check-row"><input type="checkbox" name="consent" /> Customer agreed to photo and video evidence</label>
            </>
          ) : (
            <>
              <label>Full name<input name="name" required /></label>
              <label>Username<input name="username" required /></label>
              <label>Email<input name="email" type="email" required /></label>
              <p className="muted">Preview accounts are saved in this browser.</p>
            </>
          )}
          {formError && <p className="form-error" role="alert">{formError}</p>}
          <button className="button primary full" type="submit">{modal === "job" ? "Create job" : "Add mechanic"}</button>
        </form>
      </dialog>
    </Workspace>
  );
}
