"use client";

import { useRef, useState, type FormEvent } from "react";
import { FiArrowRight, FiCheck, FiClipboard, FiClock, FiEdit2, FiKey, FiPlus, FiTool, FiUser, FiX } from "react-icons/fi";
import { garageServices, saveJob, saveMechanic, saveProfile, useGarageDemo, type Job, type Mechanic } from "./demo-state";
import { FinanceTotals, FinanceView } from "./finance";
import { JobHandover } from "./job-handover";
import { GarageSelect } from "./ui/select";
import { ownerTabs, Status, Workspace, type OwnerTab } from "./workspace";

type Filter = "All jobs" | "Needs assignment" | "In progress" | "Ready for review" | "Closed";
type Modal = "job" | "mechanic" | "reset";
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
  function assign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const mechanicId = String(new FormData(event.currentTarget).get("mechanic") ?? "");
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
          <div className="field-label"><span>Assign mechanic</span><GarageSelect
            label="Assign mechanic" name="mechanic" defaultValue={job.mechanicId} placeholder="Select mechanic" required
            options={mechanics.filter((mechanic) => mechanic.active).map((mechanic) => ({ value: mechanic.id, label: mechanic.name }))}
          /></div>
          <button className="button primary full" type="submit"><FiUser aria-hidden="true" /> {job.mechanicId ? "Update assignment" : "Assign mechanic"}</button>
        </form>
      )}

      {job.report && ["Ready for review", "Shared", "Closed"].includes(job.status) && <JobHandover job={job} />}
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
        <div className="field-label"><span>Area</span><GarageSelect label="Area" name="area" defaultValue={profile.area} options={["Mirpur", "Dhanmondi", "Uttara"]} required /></div>
        <div className="field-label"><span>Garage type</span><GarageSelect label="Garage type" name="type" defaultValue={profile.type} options={["General workshop", "Specialist workshop", "Body shop"]} required /></div>
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
  const { jobs, mechanics, profile, finance } = useGarageDemo();
  const [tab, setTab] = useState<OwnerTab>("Dashboard");
  const [filter, setFilter] = useState<Filter>("All jobs");
  const [selectedId, setSelectedId] = useState("JOB-103");
  const [modal, setModal] = useState<Modal>("job");
  const [formError, setFormError] = useState("");
  const [editing, setEditing] = useState<Mechanic | null>(null);
  const [resetCode, setResetCode] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const visibleJobs = jobs.filter((job) => matchesFilter(job, filter));
  const selectedJob = jobs.find((job) => job.id === selectedId) ?? visibleJobs[0];

  function applyFilter(nextFilter: Filter) {
    setFilter(nextFilter);
    if (!selectedJob || !matchesFilter(selectedJob, nextFilter)) {
      setSelectedId(jobs.find((job) => matchesFilter(job, nextFilter))?.id ?? "");
    }
  }

  function openModal(nextModal: Modal, mechanic: Mechanic | null = null) {
    setModal(nextModal);
    setEditing(mechanic);
    setResetCode("");
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
      if (mechanics.some((mechanic) => mechanic.username === username && mechanic.id !== editing?.id)) {
        setFormError("This username already exists in the preview.");
        return;
      }
      if (!field("name")) {
        setFormError("Enter the mechanic’s full name.");
        return;
      }
      saveMechanic({ ...editing, id: editing?.id ?? crypto.randomUUID(), name: field("name"), username, email: field("email"), active: editing?.active ?? true });
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

  const urgentJobs = jobs.filter((job) => job.status === "Unassigned" || job.status === "Ready for review").slice(0, 4);

  function openJob(job: Job) {
    setFilter("All jobs");
    setSelectedId(job.id);
    setTab("Jobs");
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  return (
    <Workspace role="owner" name="Farhan Ahmed" garage={profile.name} tab={tab} tabs={ownerTabs} onTab={setTab}>
      {tab === "Dashboard" && (
        <>
          <div className="dashboard-banner owner-banner">
            <div><p className="banner-label">Garage overview</p><h1>{profile.name}</h1><p>Workshop activity and recorded finances at a glance.</p></div>
            <button type="button" className="button banner-button" onClick={() => openModal("job")}><FiPlus aria-hidden="true" /> New job</button>
          </div>
          <FinanceTotals entries={finance} />
          <div className="dashboard-grid">
            <section className="panel dashboard-list" aria-labelledby="attention-heading">
              <div className="list-heading"><div><h2 id="attention-heading">Needs your attention</h2><p className="muted">Jobs awaiting assignment or report review</p></div><button className="text-link" type="button" onClick={() => setTab("Jobs")}>All jobs <FiArrowRight aria-hidden="true" /></button></div>
              <ul>{urgentJobs.map((job) => <li key={job.id}><button type="button" className="dashboard-job" onClick={() => openJob(job)}><span className="vehicle-icon"><FiTool aria-hidden="true" /></span><span><strong>{job.vehicle}</strong><small>{job.id} · {job.service}</small></span><Status status={job.status} /></button></li>)}</ul>
              {!urgentJobs.length && <p className="empty-state">No jobs need attention.</p>}
            </section>
            <section className="panel dashboard-shortcut"><span className="metric-icon tone-blue"><FiClipboard aria-hidden="true" /></span><h2>Finance activity</h2><p className="muted">Record labour payments or expenses to update your totals.</p><button className="button secondary" type="button" onClick={() => setTab("Finance")}>Open Finance <FiArrowRight aria-hidden="true" /></button></section>
          </div>
        </>
      )}

      {tab === "Finance" && <FinanceView entries={finance} />}
      {tab !== "Dashboard" && tab !== "Finance" && (
        <div className="page-heading">
          <div><h1>{tab === "Jobs" ? "Garage jobs" : tab}</h1><p>{tab === "Jobs" ? "Assign jobs, review inspections and prepare customer quotations." : tab === "Mechanics" ? "Manage workshop accounts and access." : "Edit the details customers see in the garage directory."}</p></div>
          {tab !== "Garage Profile" && <button className="button primary" type="button" onClick={() => openModal(tab === "Jobs" ? "job" : "mechanic")}><FiPlus aria-hidden="true" /> {tab === "Jobs" ? "New job" : "Add mechanic"}</button>}
        </div>
      )}

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
                <GarageSelect label="Filter jobs" value={filter} onValueChange={(value) => applyFilter(value as Filter)} options={filters} compact />
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
              <div className="team-actions">
                <button className="button secondary" type="button" onClick={() => openModal("mechanic", mechanic)}><FiEdit2 aria-hidden="true" /> Edit</button>
                <button className="button secondary" type="button" onClick={() => openModal("reset", mechanic)}><FiKey aria-hidden="true" /> Reset access</button>
                <button className="button secondary" type="button" onClick={() => saveMechanic({ ...mechanic, active: !mechanic.active })}>{mechanic.active ? "Deactivate" : "Activate"}</button>
              </div>
            </div>
          ))}
        </section>
      )}

      {tab === "Garage Profile" && <ProfileForm />}

      <dialog className="workspace-dialog" ref={dialog} aria-labelledby="create-title" onClose={() => setResetCode("")}>
        <div className="dialog-heading"><h2 id="create-title">{modal === "job" ? "New job" : modal === "reset" ? "Reset mechanic access" : editing ? "Edit mechanic" : "Add mechanic"}</h2><button className="icon-button" type="button" aria-label="Close form" onClick={() => dialog.current?.close()}><FiX /></button></div>
        {modal === "reset" ? (
          <div className="stack-form">
            <p>Generate a temporary code for <strong>{editing?.name}</strong> (@{editing?.username}).</p>
            <p className="muted">This preview illustrates the reset flow. Real credentials will be issued by the backend.</p>
            {resetCode ? <div className="temporary-code" role="status"><span>Preview code</span><strong>{resetCode}</strong></div>
              : <button type="button" className="button primary" onClick={() => setResetCode(`Demo-${crypto.randomUUID().slice(0, 8)}`)}>Generate preview code</button>}
          </div>
        ) : <form className="stack-form" onSubmit={create} key={`${modal}-${editing?.id ?? "new"}`}>
          {modal === "job" ? (
            <>
              <label>Vehicle<input name="vehicle" placeholder="e.g. Toyota Axio" required /></label>
              <label>Registration number<input name="registration" /></label>
              <label>Customer email<input name="customer" type="email" placeholder="customer@example.test" required /></label>
              <div className="field-label"><span>Service</span><GarageSelect label="Service" name="service" defaultValue={garageServices[0]} options={garageServices} required /></div>
              <label>Customer concern<textarea name="concern" rows={2} /></label>
              <label className="check-row"><input type="checkbox" name="consent" /> Customer agreed to photo and video evidence</label>
            </>
          ) : (
            <>
              <label>Full name<input name="name" required defaultValue={editing?.name} /></label>
              <label>Username<input name="username" required defaultValue={editing?.username} /></label>
              <label>Email<input name="email" type="email" required defaultValue={editing?.email} /></label>
              <p className="muted">Preview accounts are saved in this browser.</p>
            </>
          )}
          {formError && <p className="form-error" role="alert">{formError}</p>}
          <button className="button primary full" type="submit">{modal === "job" ? "Create job" : editing ? "Save mechanic" : "Add mechanic"}</button>
        </form>}
      </dialog>
    </Workspace>
  );
}
