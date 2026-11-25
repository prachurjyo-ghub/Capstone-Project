"use client";

import { useSyncExternalStore } from "react";

export type JobStatus = "Unassigned" | "Assigned" | "In progress" | "Ready for review" | "Shared" | "Closed";
export type Finding = { component: string; issue: string; nextStep: string; evidenceIds?: string[] };
export type Evidence = { id: string; name: string; kind: "photo" | "clip"; size: number };
export type Report = { summary: string; findings: Finding[]; evidence: Evidence[] };
export type PartsAvailability = "Customer supplies parts" | "Can source on request" | "Availability to be confirmed";
export type Quotation = { labour: number; parts: string[]; availability: PartsAvailability; note: string; status: "Draft" | "Ready to hand over" };
export type FinanceEntry = { id: string; kind: "Revenue" | "Expense"; amount: number; description: string; date: string };
export type Job = {
  id: string;
  version: number;
  vehicle: string;
  registration: string;
  service: string;
  customer?: string;
  concern: string;
  mechanicId: string;
  status: JobStatus;
  consent: boolean;
  report?: Report;
  sharedEvidence?: string[];
  quotation?: Quotation;
  evidenceRequested?: boolean;
  shared?: boolean;
};
export type Mechanic = { id: string; name: string; username: string; email: string; active: boolean; phone?: string; specialty?: string; photo?: string | null };
export type GarageProfile = { name: string; area: string; type: string; address: string; phone: string; hours: string; description: string; services: string[] };
type GarageWorkspace = { jobs: Job[]; mechanics: Mechanic[]; profile: GarageProfile; finance: FinanceEntry[]; identity: GarageIdentity };
export type GarageRole = "OWNER" | "MECHANIC";
export type GarageIdentity = Mechanic & { role: GarageRole; mustChangePassword: boolean };

export const garageServices = ["Diagnostics", "Brakes", "AC service", "Electrical", "Body repair", "Routine service"];

const base = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000/api/v1").replace(/\/$/, "");
let token = "";
let refreshing: Promise<boolean> | undefined;
let state: GarageWorkspace | null = null;
let message = "";
const subscribers = new Set<() => void>();

function subscribe(listener: () => void) {
  subscribers.add(listener);
  return () => { subscribers.delete(listener); };
}
function notify() {
  subscribers.forEach((listener) => listener());
}
export function useWorkspaceError() {
  return useSyncExternalStore(subscribe, () => message, () => "");
}
export function useGarageWorkspace() {
  const workspace = useSyncExternalStore(subscribe, () => state, () => null);
  if (!workspace) throw new Error("Garage workspace must be loaded before rendering");
  return workspace;
}
function csrfCookie() {
  const name = (process.env.NEXT_PUBLIC_CSRF_COOKIE_NAME || "partsarc_csrf") + "_garage=";
  return document.cookie.split("; ").find((entry) => entry.startsWith(name))?.slice(name.length);
}
async function responseData<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message || "The garage request could not be completed.");
  return payload.data as T;
}
function refresh() {
  if (!refreshing) {
    refreshing = (async () => {
      const csrf = csrfCookie();
      if (!csrf) return false;
      const response = await fetch(base + "/auth/refresh", {
        method: "POST", credentials: "include",
        headers: { "x-auth-client": "garage", "x-csrf-token": decodeURIComponent(csrf) },
      });
      if (!response.ok) {
        token = "";
        return false;
      }
      token = (await responseData<{ accessToken: string }>(response)).accessToken;
      return true;
    })().finally(() => { refreshing = undefined; });
  }
  return refreshing;
}
async function request(path: string, init: RequestInit = {}, authenticated = true) {
  if (authenticated && !token && !await refresh()) throw new Error("Sign in to continue.");
  const headers = new Headers(init.headers);
  headers.set("x-auth-client", "garage");
  const send = () => {
    if (authenticated) headers.set("Authorization", "Bearer " + token);
    return fetch(base + path, { ...init, headers, credentials: "include", cache: "no-store" });
  };
  const response = await send();
  if (authenticated && response.status === 401 && await refresh()) return send();
  return response;
}
function json(method: string, value: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) };
}
async function api<T>(path: string, init?: RequestInit, authenticated = true) {
  return responseData<T>(await request(path, init, authenticated));
}
export async function login(username: string, password: string, role: GarageRole) {
  const previous = token;
  try {
    token = (await api<{ accessToken: string }>("/garage/auth/login", json("POST", { username, password, role }), false)).accessToken;
    return await garageIdentity();
  } catch (error) {
    token = previous;
    throw error;
  }
}
export function requestOwnerRecovery(username: string, email: string) {
  return api("/garage/auth/forgot-password", json("POST", { username, email }), false);
}
export const garageIdentity = () => api<GarageIdentity>("/garage/me");
export async function changePassword(currentPassword: string, newPassword: string) {
  await api("/auth/change-password", json("POST", { currentPassword, newPassword }));
  return garageIdentity();
}
export async function logout() {
  await api("/auth/logout", { method: "POST" });
  token = "";
  message = "";
}
export async function loadWorkspace() {
  const workspace = await api<GarageWorkspace>("/garage/workspace");
  state = workspace;
  notify();
}
async function mutate<T>(path: string, init: RequestInit) {
  message = "";
  notify();
  try {
    const result = await api<T>(path, init);
    try {
      await loadWorkspace();
    } catch {
      message = "Your change was saved. Reload to see the latest workspace.";
      notify();
    }
    return { result };
  } catch (error) {
    message = error instanceof Error ? error.message : "Could not save the change.";
    notify();
    return null;
  }
}

const jobPath = (id: string) => "/garage/jobs/" + encodeURIComponent(id);
export function jobAction(id: string, value: Record<string, unknown>) {
  return mutate(jobPath(id) + "/action", json("POST", value));
}
export function saveJob(value: Pick<Job, "vehicle" | "registration" | "service" | "customer" | "concern" | "consent">) {
  return mutate<Job>("/garage/jobs", json("POST", value));
}
export function uploadEvidence(id: string, file: File) {
  return mutate<Evidence>(jobPath(id) + "/evidence", { method: "POST", headers: { "Content-Type": file.type, "x-evidence-name": encodeURIComponent(file.name) }, body: file });
}
export function deleteEvidence(id: string, fileId: string) {
  return mutate(jobPath(id) + "/evidence/" + encodeURIComponent(fileId), { method: "DELETE" });
}
export async function downloadEvidence(id: string, evidence: Evidence) {
  try {
    const response = await request(jobPath(id) + "/evidence/" + encodeURIComponent(evidence.id));
    if (!response.ok) await responseData(response);
    const url = URL.createObjectURL(await response.blob());
    const link = Object.assign(document.createElement("a"), { href: url, download: evidence.name });
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    message = error instanceof Error ? error.message : "Could not download evidence.";
    notify();
  }
}
type MemberInput = Pick<Mechanic, "name" | "email" | "username">;
export function saveMechanic(value: MemberInput, member: Pick<Mechanic, "id" | "active">) {
  const { name, email, username } = value;
  return mutate("/garage/mechanics/" + encodeURIComponent(member.id), json("PUT", { name, email, username, active: member.active }));
}
export function createMechanic(value: MemberInput) {
  return mutate<{ member: Mechanic; temporaryPassword: string }>("/garage/mechanics", json("POST", value));
}
export function resetMechanic(id: string) {
  return mutate<{ temporaryPassword: string }>("/garage/mechanics/" + encodeURIComponent(id) + "/reset", { method: "POST" });
}
export function saveMechanicProfile(profile: Pick<Mechanic, "name" | "email" | "phone" | "specialty" | "photo">) {
  return mutate("/garage/mechanic/profile", json("PUT", profile));
}
export function saveProfile(profile: GarageProfile) {
  return mutate<{ published: boolean }>("/garage/profile", json("PUT", profile));
}
export function saveFinanceEntry(entry: Omit<FinanceEntry, "id">, id?: string) {
  return mutate(id ? "/garage/ledger/" + encodeURIComponent(id) : "/garage/ledger", json(id ? "PUT" : "POST", entry));
}
export function removeFinanceEntry(id: string) {
  return mutate("/garage/ledger/" + encodeURIComponent(id), { method: "DELETE" });
}
