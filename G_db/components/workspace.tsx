"use client";

import Link from "next/link";
import { FiArrowUpRight, FiBriefcase, FiClipboard, FiTool, FiUsers } from "react-icons/fi";
import type { JobStatus } from "./demo-state";

export type OwnerTab = "Jobs" | "Mechanics" | "Garage Profile";

const ownerTabs = [
  { label: "Jobs", icon: FiBriefcase },
  { label: "Mechanics", icon: FiUsers },
  { label: "Garage Profile", icon: FiTool },
] as const;

export function Workspace({ role, name, garage, tab = "Jobs", onTab, children }: {
  role: "owner" | "mechanic";
  name: string;
  garage: string;
  tab?: OwnerTab;
  onTab?: (tab: OwnerTab) => void;
  children: React.ReactNode;
}) {
  const isOwner = role === "owner";
  return (
    <div className="workspace">
      <a className="skip" href="#garage-main">Skip to content</a>
      <aside className="sidebar">
        <div className="workspace-brand">
          <span className="brand-mark"><FiTool aria-hidden="true" /></span>
          <div><strong>Parts Ark</strong><span>Garage Workspace</span></div>
        </div>

        <div className="sidebar-garage"><span className="garage-indicator" />{garage}</div>

        <nav className="workspace-nav" aria-label="Workspace">
          {isOwner ? ownerTabs.map(({ label, icon: Icon }) => (
            <button key={label} type="button" aria-current={tab === label ? "page" : undefined} onClick={() => onTab?.(label)}>
              <Icon aria-hidden="true" /><span>{label}</span>
            </button>
          )) : (
            <Link href="/mechanic" aria-current="page"><FiClipboard aria-hidden="true" /><span>My Jobs</span></Link>
          )}
        </nav>

        <div className="sidebar-footer">
          <Link className="preview-switch" href={isOwner ? "/mechanic" : "/owner"}>
            {isOwner ? "Mechanic preview" : "Owner preview"} <FiArrowUpRight aria-hidden="true" />
          </Link>
        </div>
      </aside>

      <div className="workspace-body">
        <header className="workspace-header">
          <span className="header-context">{isOwner ? "Garage Owner" : "Mechanic Workspace"}</span>
          <div className="header-account">
            <span className="preview-tag">Local preview</span>
            <Link className="mobile-switch" href={isOwner ? "/mechanic" : "/owner"}>{isOwner ? "Mechanic" : "Owner"} <FiArrowUpRight aria-hidden="true" /></Link>
            <div className="account"><span className="avatar" aria-hidden="true">{name.split(" ").map((word) => word[0]).slice(0, 2).join("")}</span><span>{name}</span></div>
          </div>
        </header>
        <main className="workspace-content" id="garage-main">{children}</main>
      </div>
    </div>
  );
}

export function Status({ status }: { status: JobStatus }) {
  const tones: Record<JobStatus, string> = {
    Unassigned: "amber",
    Assigned: "gray",
    "In progress": "blue",
    "Ready for review": "purple",
    Shared: "green",
    Closed: "gray",
  };
  return <span className={`status status-${tones[status]}`}><span />{status}</span>;
}
