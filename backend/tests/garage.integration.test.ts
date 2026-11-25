import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AccountStatus, UserRole } from "@prisma/client";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";
import { createLogger } from "../src/config/logger.js";
import { prisma } from "../src/config/prisma.js";
import { hashPassword } from "../src/modules/auth/password.js";

const fixture = randomUUID().slice(0, 8);
const email = (prefix: string) => `${prefix}-${fixture}@garage.test`;
const username = (prefix: string) => `${prefix}-${fixture}`;
const password = "AcceptancePassword123";
const storage = mkdtempSync(join(tmpdir(), "garage-test-"));
const env = { ...loadEnv(), REQUEST_ATTACHMENT_DIR: join(storage, ".local", "attachments") };
const app = createApp(env, createLogger());
const api = (path: string) => env.API_PREFIX + path;
const garageIds: string[] = [];
const bearer = (token: string) => `Bearer ${token}`;
const login = (account: string) => request(app).post(api("/auth/login")).send({ email: account, password }).expect(200);
const garageLogin = (name: string, value: string, role: string) => request(app).post(api("/garage/auth/login"))
  .set("x-auth-client", "garage").send({ username: name, password: value, role });
const get = (path: string, token: string) => request(app).get(api(path)).set("Authorization", bearer(token));
const post = (path: string, token: string) => request(app).post(api(path)).set("Authorization", bearer(token));
const put = (path: string, token: string) => request(app).put(api(path)).set("Authorization", bearer(token));

async function customer(name: string) {
  const response = await request(app).post(api("/auth/register")).send({ email: email(name), password, fullName: "Garage Customer" }).expect(201);
  return response.body.data.accessToken as string;
}

async function createGarage(admin: string, name: string) {
  const { body } = await post("/admin/garages", admin).send({
    garageName: "Acceptance Garage " + name, name: "Garage Owner", username: username(name),
    email: email(name), contactPhone: "+8801700000011", months: 3, amount: 120000,
  }).expect(201);
  garageIds.push(body.data.garageId);
  return body.data as { garageId: string; temporaryPassword: string };
}

async function activate(name: string, temporary: string, role: string) {
  const result = await garageLogin(username(name), temporary, role).expect(200);
  const token: string = result.body.data.accessToken;
  await get("/garage/workspace", token).expect(403);
  await post("/auth/change-password", token).send({ currentPassword: temporary, newPassword: password }).expect(200);
  return token;
}

afterAll(async () => {
  const where = { garageId: { in: garageIds } };
  await prisma.garageShare.deleteMany({ where: { job: where } });
  await prisma.garageEvidence.deleteMany({ where: { job: where } });
  await prisma.garageJob.deleteMany({ where });
  await prisma.garageLedgerEntry.deleteMany({ where });
  await prisma.garageMembership.deleteMany({ where });
  await prisma.garage.deleteMany({ where: { id: { in: garageIds } } });
  const users = { email: { endsWith: `-${fixture}@garage.test` } };
  await prisma.auditLog.deleteMany({ where: { actorUser: users } });
  await prisma.customerProfile.deleteMany({ where: { user: users } });
  await prisma.user.deleteMany({ where: users });
  await rm(storage, { recursive: true, force: true });
  await prisma.$disconnect();
});

describe("Garage inspection", () => {
  it("scopes provisioning, inspection, ledger and customer evidence end to end", async () => {
    await prisma.user.create({ data: {
      email: email("admin"), fullName: "Admin", passwordHash: await hashPassword(password),
      role: UserRole.ADMIN, accountStatus: AccountStatus.ACTIVE,
    } });
    const admin: string = (await login(email("admin"))).body.data.accessToken;
    const client = await customer("client");
    const outsider = await customer("outsider");
    await get("/admin/garages", client).expect(403);
    const garage = await createGarage(admin, "owner");
    const another = await createGarage(admin, "other");
    await garageLogin(username("owner"), garage.temporaryPassword, "MECHANIC").expect(401);
    await request(app).post(api("/auth/login")).send({ email: email("owner"), password: garage.temporaryPassword }).expect(401);
    const owner = await activate("owner", garage.temporaryPassword, "OWNER");
    const otherOwner = await activate("other", another.temporaryPassword, "OWNER");

    await request(app).get(api("/garages?area=Mirpur")).expect(200).expect(({ body }) => expect(body.data.items).toEqual([]));
    await put("/garage/profile", owner).send({
      name: "Acceptance Garage", area: "Mirpur", type: "General workshop", address: "Mirpur 10", phone: "+8801700000012",
      hours: "9 AM to 7 PM", description: "Inspection and brakes", services: ["Brakes"],
    }).expect(200);
    const directory = await request(app).get(api("/garages?area=Mirpur&service=Brakes")).expect(200);
    const slug: string = directory.body.data.items[0].slug;
    await request(app).get(api(`/garages/${slug}`)).expect(200).expect(({ body }) => {
      expect(body.data.name).toBe("Acceptance Garage");
      expect(body.data).not.toHaveProperty("contactPhone");
    });

    const created = await post("/garage/mechanics", owner).send({
      email: email("mechanic"), username: username("mechanic"), name: "Garage Mechanic",
    }).expect(201);
    const mechanicId: string = created.body.data.member.id;
    const mechanic = await activate("mechanic", created.body.data.temporaryPassword, "MECHANIC");
    const newJob = await post("/garage/jobs", owner).send({
      customer: email("client"), vehicle: "Toyota Axio", registration: "DHAKA-10", service: "Brakes", concern: "Grinding", consent: true,
    }).expect(201);
    const job = `/garage/jobs/${newJob.body.data.id}`;
    const evidence = job + "/evidence";
    const customerReport = `/customers/me/garage-reports/${newJob.body.data.id}`;
    await post(job + "/action", otherOwner).send({ action: "assign", mechanicId }).expect(404);
    await get("/garage/workspace", mechanic).expect(200).expect(({ body }) => expect(body.data.jobs).toEqual([]));
    await post(job + "/action", owner).send({ action: "assign", mechanicId }).expect(200);
    await get("/garage/workspace", mechanic).expect(200).expect(({ body }) => {
      expect(body.data.jobs[0].id).toBe(newJob.body.data.id);
      expect(body.data.jobs[0]).not.toHaveProperty("customer");
    });

    const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jgk8AAAAASUVORK5CYII=", "base64");
    const photo = await post(evidence, mechanic).set("Content-Type", "image/png").send(image).expect(201);
    const fileId: string = photo.body.data.id;
    const report = { summary: "Front brake pad worn", findings: [{ component: "Brake pad", issue: "Worn", nextStep: "Replace" }] };
    await post(job + "/action", mechanic).send({ action: "submit", report }).expect(200);
    await post(job + "/action", mechanic).send({ action: "draft", report }).expect(403);
    await post(job + "/action", owner).send({ action: "return" }).expect(200);
    await post(job + "/action", mechanic).send({ action: "submit", report }).expect(200);
    await post(job + "/action", owner).send({
      action: "quote", quotation: { labour: 180000, parts: ["Brake pad"], availability: "Can source on request", note: "", status: "Ready to hand over" },
    }).expect(200);
    await post(job + "/action", owner).send({ action: "evidence", evidenceIds: [fileId] }).expect(403);
    await get(customerReport + "/evidence/" + fileId, client).expect(404);
    await post(customerReport + "/request-evidence", outsider).expect(404);
    await post(customerReport + "/request-evidence", client).expect(200);
    await post(job + "/action", owner).send({ action: "evidence", evidenceIds: [fileId] }).expect(200);
    await get(customerReport + "/evidence/" + fileId, outsider).expect(404);
    await get(customerReport + "/evidence/" + fileId, client).expect("Content-Type", /image\/png/).expect(200);
    await get("/customers/me/garage-reports", client).expect(200).expect(({ body }) => {
      expect(body.data[0].report.summary).toBe(report.summary);
      expect(body.data[0].quotation.labour).toBe(180000);
      expect(body.data[0].files[0].id).toBe(fileId);
    });
    await post("/garage/ledger", mechanic).send({ kind: "Revenue", amount: 100, description: "Labour", date: "2026-11-25" }).expect(403);
    await post("/garage/ledger", owner).send({ kind: "Revenue", amount: 100, description: "Labour", date: "2026-11-25" }).expect(201);
    await get("/garage/workspace", otherOwner).expect(200).expect(({ body }) => expect(body.data.finance).toEqual([]));

    await post(job + "/action", owner).send({ action: "revoke" }).expect(200);
    await get(customerReport + "/evidence/" + fileId, client).expect(404);
    await post(job + "/action", owner).send({ action: "share" }).expect(200);
    await post(job + "/action", owner).send({ action: "evidence", evidenceIds: [fileId] }).expect(200);
    await post(job + "/action", owner).send({ action: "close" }).expect(200);
    await post(`/admin/garages/${garage.garageId}/reset-owner`, admin).expect(200);
    await get("/garage/workspace", owner).expect(401);
    await post(`/admin/garages/${garage.garageId}/terminate`, admin).expect(200);
    await get("/garage/workspace", mechanic).expect(401);
    await request(app).get(api(`/garages/${slug}`)).expect(404);
    await get(customerReport + "/evidence/" + fileId, client).expect(200);

    await prisma.garage.update({ where: { id: another.garageId }, data: { endsAt: new Date(0) } });
    await get("/garage/workspace", otherOwner).expect(403);
    await garageLogin(username("other"), password, "OWNER").expect(401);
  }, 30_000);
});
