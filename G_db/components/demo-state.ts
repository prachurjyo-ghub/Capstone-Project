"use client";

import { useMemo, useSyncExternalStore } from "react";

export type JobStatus = "Unassigned" | "Assigned" | "In progress" | "Ready for review" | "Shared" | "Closed";
export type Finding = { component: string; issue: string; nextStep: string };
export type Evidence = { id: string; name: string; kind: "photo" | "clip"; size: number };
export type Report = { summary: string; findings: Finding[]; evidence: Evidence[] };
export type PartsAvailability = "Customer supplies parts" | "Can source on request" | "Availability to be confirmed";
export type Quotation = { labour: number; parts: string[]; availability: PartsAvailability; note: string; status: "Draft" | "Ready to hand over" };
export type FinanceEntry = { id: string; kind: "Revenue" | "Expense"; amount: number; description: string; date: string };
export type Job = {
  id: string;
  vehicle: string;
  registration: string;
  service: string;
  customer: string;
  concern: string;
  mechanicId: string;
  status: JobStatus;
  consent: boolean;
  report?: Report;
  sharedEvidence?: string[];
  quotation?: Quotation;
  evidenceRequested?: boolean;
};
export type Mechanic = { id: string; name: string; username: string; email: string; active: boolean; phone?: string; specialty?: string; photo?: string };
export type GarageProfile = { name: string; area: string; type: string; address: string; phone: string; hours: string; services: string[] };
type GarageDemo = { jobs: Job[]; mechanics: Mechanic[]; profile: GarageProfile; finance: FinanceEntry[] };

export const garageServices = ["Diagnostics", "Brakes", "AC service", "Electrical", "Body repair", "Routine service"];
export const sampleMechanicId = "tanvir";

const initial: GarageDemo = {
  profile: { name: "Mirpur Motor Works", area: "Mirpur", type: "General workshop", address: "Block B, Mirpur 10, Dhaka", phone: "", hours: "Sat–Thu · 9:00 AM–7:00 PM", services: ["Brakes", "Diagnostics", "Routine service"] },
  finance: [
    { id: "finance-4", kind: "Revenue", amount: 760000, description: "Workshop labour", date: "2026-11-24" },
    { id: "finance-3", kind: "Expense", amount: 280000, description: "Workshop supplies", date: "2026-11-22" },
    { id: "finance-2", kind: "Revenue", amount: 520000, description: "Diagnostics and servicing", date: "2026-11-21" },
    { id: "finance-1", kind: "Expense", amount: 160000, description: "Shop utilities", date: "2026-11-20" },
  ],
  mechanics: [
    { id: sampleMechanicId, name: "Tanvir Ahmed", username: "tanvir", email: "tanvir@example.test", active: true },
    { id: "nadia", name: "Nadia Rahman", username: "nadia", email: "nadia@example.test", active: true },
  ],
  jobs: [
    { id: "JOB-104", vehicle: "Toyota Axio", registration: "DHAKA METRO · GA 24-1048", service: "Brakes", customer: "arif@example.test", concern: "Grinding noise from the front left wheel when braking at low speed.", mechanicId: sampleMechanicId, status: "In progress", consent: true },
    { id: "JOB-103", vehicle: "Honda Civic", registration: "DHAKA METRO · GA 28-3701", service: "Diagnostics", customer: "leena@example.test", concern: "Check engine light appeared after a long drive.", mechanicId: "", status: "Unassigned", consent: false },
    { id: "JOB-102", vehicle: "Toyota Prius", registration: "DHAKA METRO · GA 32-0918", service: "AC service", customer: "shuvo@example.test", concern: "Air conditioning is warm when the vehicle is stationary.", mechanicId: "nadia", status: "Ready for review", consent: true, report: { summary: "Cabin filter is clogged. Airflow improved after removing the filter for testing.", findings: [{ component: "Cabin air filter", issue: "Heavy buildup on the filter surface.", nextStep: "Replace the cabin air filter." }], evidence: [{ id: "sample-photo", name: "cabin-filter.jpg", kind: "photo", size: 181000 }] } },
    { id: "JOB-101", vehicle: "Suzuki Swift", registration: "DHAKA METRO · GA 22-7012", service: "Routine service", customer: "sana@example.test", concern: "Regular service and fluid levels check.", mechanicId: sampleMechanicId, status: "Assigned", consent: true },
    { id: "JOB-100", vehicle: "Nissan Note", registration: "DHAKA METRO · GA 27-2154", service: "Electrical", customer: "rafi@example.test", concern: "Left headlight intermittently goes out.", mechanicId: sampleMechanicId, status: "Closed", consent: false },
  ],
};

const initialSnapshot = JSON.stringify(initial);
const storageKey = "partsark:garage-preview:v1";
const eventName = "partsark-garage-preview-change";
let fallbackSnapshot = initialSnapshot;

function getSnapshot() {
  try {
    return localStorage.getItem(storageKey) ?? fallbackSnapshot;
  } catch {
    return fallbackSnapshot;
  }
}

function subscribe(listener: () => void) {
  window.addEventListener(eventName, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(eventName, listener);
    window.removeEventListener("storage", listener);
  };
}

function readDemo(snapshot: string): GarageDemo {
  try {
    const previous = JSON.parse(snapshot) as GarageDemo;
    return { ...previous, finance: previous.finance ?? initial.finance };
  } catch {
    return initial;
  }
}

function changeDemo(update: (current: GarageDemo) => GarageDemo) {
  const next = JSON.stringify(update(readDemo(getSnapshot())));
  fallbackSnapshot = next;
  try {
    localStorage.setItem(storageKey, next);
  } catch {
    // The preview can still run in browsers with storage disabled.
  }
  window.dispatchEvent(new Event(eventName));
}

export function useGarageDemo() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => initialSnapshot);
  return useMemo(() => readDemo(snapshot), [snapshot]);
}

export function saveJob(nextJob: Job) {
  changeDemo((state) => ({
    ...state,
    jobs: state.jobs.some((job) => job.id === nextJob.id)
      ? state.jobs.map((job) => job.id === nextJob.id ? nextJob : job)
      : [nextJob, ...state.jobs],
  }));
}

export function saveMechanic(nextMechanic: Mechanic) {
  changeDemo((state) => ({
    ...state,
    mechanics: state.mechanics.some((mechanic) => mechanic.id === nextMechanic.id)
      ? state.mechanics.map((mechanic) => mechanic.id === nextMechanic.id ? nextMechanic : mechanic)
      : [...state.mechanics, nextMechanic],
  }));
}

export function saveProfile(profile: GarageProfile) {
  changeDemo((state) => ({ ...state, profile }));
}

export function saveFinanceEntry(entry: FinanceEntry) {
  changeDemo((state) => ({
    ...state,
    finance: state.finance.some((item) => item.id === entry.id)
      ? state.finance.map((item) => item.id === entry.id ? entry : item)
      : [entry, ...state.finance],
  }));
}

export function removeFinanceEntry(id: string) {
  changeDemo((state) => ({ ...state, finance: state.finance.filter((entry) => entry.id !== id) }));
}
