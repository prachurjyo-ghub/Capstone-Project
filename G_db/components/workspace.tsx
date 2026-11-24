"use client";

import Link from "next/link";
import { FiArrowUpRight, FiBriefcase, FiClipboard, FiCreditCard, FiGrid, FiTool, FiUser, FiUsers } from "react-icons/fi";
import type { IconType } from "react-icons";
import type { JobStatus } from "./demo-state";
import { ThemeToggle } from "./theme-toggle";

export type OwnerTab = "Dashboard" | "Jobs" | "Mechanics" | "Finance" | "Garage Profile";
export type MechanicTab = "Dashboard" | "My Jobs" | "Profile";
type NavItem<T> = { label: T; shortLabel?: string; icon: IconType };

export const ownerTabs: readonly NavItem<OwnerTab>[] = [
  { label: "Dashboard", shortLabel: "Home", icon: FiGrid },
  { label: "Jobs", icon: FiBriefcase },
  { label: "Mechanics", icon: FiUsers },
  { label: "Finance", icon: FiCreditCard },
  { label: "Garage Profile", shortLabel: "Profile", icon: FiTool },
];
export const mechanicTabs: readonly NavItem<MechanicTab>[] = [
  { label: "Dashboard", icon: FiGrid },
  { label: "My Jobs", icon: FiClipboard },
  { label: "Profile", icon: FiUser },
];

export function Workspace<T extends string>({ role, name, photo, garage, tab, tabs, onTab, children }: {
  role: "owner" | "mechanic";
  name: string;
  photo?: string;
  garage: string;
  tab: T;
  tabs: readonly NavItem<T>[];
  onTab: (tab: T) => void;
  children: React.ReactNode;
}) {
  const isOwner = role === "owner";
  const initials = name.trim().split(/\s+/).map((word) => word[0]).slice(0, 2).join("");
  const otherRole = isOwner ? { href: "/mechanic", label: "Mechanic preview" } : { href: "/owner", label: "Owner preview" };

  function nav(mobile: boolean) {
    return tabs.map(({ label, shortLabel, icon: Icon }) => (
      <button key={label} type="button" aria-current={tab === label ? "page" : undefined} aria-label={label} onClick={() => {
        if (tab !== label) {
          onTab(label);
          window.scrollTo({ top: 0, behavior: "instant" });
        }
      }}>
        <Icon aria-hidden="true" /><span>{mobile ? shortLabel ?? label : label}</span>
      </button>
    ));
  }

  return (
    <div className="workspace">
      <a className="skip" href="#garage-main">Skip to content</a>
      <aside className="sidebar">
        <div className="workspace-brand">
          <span className="brand-mark"><FiTool aria-hidden="true" /></span>
          <div><strong>Parts Arc</strong><span>Garage Workspace</span></div>
        </div>
        <div className="sidebar-garage"><span className="garage-indicator" />{garage}</div>
        <nav className="workspace-nav" aria-label="Desktop workspace">{nav(false)}</nav>
        <div className="sidebar-footer"><Link className="preview-switch" href={otherRole.href}>{otherRole.label}<FiArrowUpRight aria-hidden="true" /></Link></div>
      </aside>

      <div className="workspace-body">
        <header className="workspace-header">
          <span className="header-context">{isOwner ? "Garage Owner" : "Mechanic Workspace"}</span>
          <div className="mobile-brand"><span className="brand-mark"><FiTool aria-hidden="true" /></span><span><strong>Parts Arc</strong><small>{isOwner ? garage : "Mechanic workspace"}</small></span></div>
          <div className="header-account">
            <span className="preview-tag">Local preview</span>
            <ThemeToggle />
            <details className="account-menu">
              <summary className="account" aria-label={`Account menu for ${name}`}>
                <span className="avatar" aria-hidden="true">{photo ? <img src={photo} alt="" /> : initials}</span><span>{name}</span>
              </summary>
              <div className="account-popover">
                <strong>{name}</strong>
                <p>{isOwner ? "Garage owner" : "Mechanic"}</p>
                <Link href={otherRole.href}>{otherRole.label}<FiArrowUpRight aria-hidden="true" /></Link>
              </div>
            </details>
          </div>
        </header>
        <main className="workspace-content" id="garage-main">{children}</main>
      </div>

      <nav className={`mobile-workspace-nav mobile-workspace-${role}`} aria-label="Mobile workspace">{nav(true)}</nav>
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
