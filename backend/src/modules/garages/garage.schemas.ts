import { z } from "zod";

export const garageAreas = ["Mirpur", "Dhanmondi", "Uttara"] as const;
export const garageTypes = ["General workshop", "Specialist workshop", "Body shop"] as const;
export const garageServices = ["Diagnostics", "Brakes", "AC service", "Electrical", "Body repair", "Routine service"] as const;

const text = (limit: number) => z.string().trim().max(limit);
const email = text(254).email().transform((value) => value.toLowerCase());
const username = text(64).min(3).regex(/^[a-zA-Z0-9_.-]+$/).transform((value) => value.toLowerCase());
const phone = text(24).regex(/^\+?[0-9][0-9 -]{6,20}$/);
const money = z.number().int().min(0).max(2_000_000_000);
export const id = z.string().uuid();
export const credentials = z.object({ name: text(120).min(2), username, email }).strict();
export const createGarage = credentials.extend({
  garageName: text(160).min(2), contactPhone: phone, months: z.number().int().min(1).max(120),
  amount: money.nullable().optional(),
});
export const signIn = z.object({
  username, password: z.string().min(1).max(128), role: z.enum(["OWNER", "MECHANIC"]),
}).strict();
export const directory = z.object({
  area: z.enum(garageAreas), service: z.enum(garageServices).optional(), type: z.enum(garageTypes).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
}).strict();
export const garageProfile = z.object({
  name: text(160).min(2), area: z.union([z.enum(garageAreas), z.literal("")]),
  type: z.union([z.enum(garageTypes), z.literal("")]),
  address: text(300), phone: z.union([phone, z.literal("")]), hours: text(160),
  description: text(1000).default(""),
  services: z.array(z.enum(garageServices)).max(garageServices.length).transform((value) => [...new Set(value)]),
}).strict();
export const memberEdit = credentials.extend({ active: z.boolean() });
export const mechanicProfile = z.object({
  name: text(120).min(2), email, phone: text(24), specialty: text(120),
  photo: z.string().max(700_000).nullable().optional(),
}).strict();
export const createJob = z.object({
  customer: email, vehicle: text(120).min(2), registration: text(100),
  service: z.enum(garageServices), concern: text(1500), consent: z.boolean(),
  vehicleId: id.optional(),
}).strict();
export const inspectionReport = z.object({
  summary: text(2000),
  findings: z.array(z.object({ component: text(160), issue: text(800), nextStep: text(800), evidenceIds: z.array(id).max(5).optional() }).strict()).max(30),
}).strict();
const quote = z.object({
  labour: money, parts: z.array(text(180).min(1)).max(30),
  availability: z.enum(["Customer supplies parts", "Can source on request", "Availability to be confirmed"]),
  note: text(1600), status: z.enum(["Draft", "Ready to hand over"]),
}).strict();
export const jobAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("assign"), mechanicId: id }),
  z.object({ action: z.literal("draft"), report: inspectionReport }),
  z.object({ action: z.literal("submit"), report: inspectionReport }),
  z.object({ action: z.literal("return") }),
  z.object({ action: z.literal("quote"), quotation: quote }),
  z.object({ action: z.literal("evidence"), evidenceIds: z.array(id).max(6) }),
  z.object({ action: z.literal("revoke") }),
  z.object({ action: z.literal("share") }),
  z.object({ action: z.literal("close") }),
]);
export const ledgerEntry = z.object({
  kind: z.enum(["Revenue", "Expense"]), amount: money.positive(), description: text(200).min(1),
  date: z.iso.date(),
}).strict();
