import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { AccountStatus, Prisma, UserRole, type GarageJobStatus, type PrismaClient } from "@prisma/client";
import express, { Router, type NextFunction, type Request, type Response } from "express";
import type { Env } from "../../config/env.js";
import { createAuthenticateMiddleware, requireRoles } from "../../middleware/authenticate.js";
import { AppError } from "../../shared/errors/app-error.js";
import { sendSuccess } from "../../shared/utils/response.js";
import { recordAudit } from "../auth/audit.service.js";
import { createAuthRateLimits } from "../auth/auth.rate-limit.js";
import { publicSession, requestMetadata } from "../auth/auth.controller.js";
import { setAuthCookies } from "../auth/auth.cookies.js";
import type { AuthService } from "../auth/auth.service.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { validateRequestImage } from "../requests/image-validation.js";
import { addCalendarMonths } from "../subscriptions/subscription.service.js";
import * as schema from "./garage.schemas.js";

const working = ["ASSIGNED", "DRAFT"];
const reviewable = ["SUBMITTED", "SHARED"];
const status: Record<GarageJobStatus, string> = {
  UNASSIGNED: "Unassigned", ASSIGNED: "Assigned", DRAFT: "In progress",
  SUBMITTED: "Ready for review", SHARED: "Shared", CLOSED: "Closed",
};
const publicFields = {
  slug: true, name: true, area: true, type: true, address: true, phone: true,
  hours: true, description: true, services: true,
} as const;
const evidenceFields = { id: true, name: true, mimeType: true, size: true } as const;
const jobRelations = {
  evidence: { select: evidenceFields, orderBy: { createdAt: "asc" } },
  customer: { select: { user: { select: { email: true } } } },
  share: { select: { evidenceIds: true, revokedAt: true } },
} satisfies Prisma.GarageJobInclude;
const identityFields = { user: { select: { email: true, fullName: true } } } as const;

type ScopedJob = Prisma.GarageJobGetPayload<{ include: typeof jobRelations }>;
type Member = Prisma.GarageMembershipGetPayload<{ include: typeof identityFields }>;

function fail(message: string, code = "GARAGE_INVALID", statusCode = 400): never {
  throw new AppError(message, { code, statusCode });
}
const denied = () => fail("Garage access is required", "GARAGE_ACCESS_REQUIRED", 403);
const missing = () => fail("Garage record was not found", "GARAGE_NOT_FOUND", 404);
const stale = () => fail("This job changed. Reload it before continuing.", "GARAGE_JOB_CHANGED", 409);
const active = () => ({ terminatedAt: null, endsAt: { gt: new Date() } });
const temporaryPassword = () => `Garage1-${randomBytes(18).toString("base64url")}`;
const evidenceView = (file: { id: string; name: string; mimeType: string; size: number }) =>
  ({ id: file.id, name: file.name, kind: file.mimeType === "video/mp4" ? "clip" : "photo", size: file.size });

function mechanicView(member: Member) {
  return {
    id: member.id, name: member.user.fullName, email: member.user.email, username: member.username,
    role: member.role, active: member.active, phone: member.phone, specialty: member.specialty, photo: member.photo,
  };
}

function jsonObject(value: Prisma.JsonValue) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function jobView(job: ScopedJob, owner: boolean) {
  return {
    id: job.id, version: job.version, vehicle: job.vehicle, registration: job.registration,
    service: job.service, concern: job.concern, consent: !!job.consentAt, mechanicId: job.mechanicId ?? "",
    status: status[job.status], report: job.report || job.evidence.length
      ? { summary: "", findings: [], ...jsonObject(job.report), evidence: job.evidence.map(evidenceView) }
      : undefined,
    ...(owner ? {
      customer: job.customer.user.email, quotation: job.quotation ?? undefined, evidenceRequested: job.evidenceRequested,
      sharedEvidence: job.share && !job.share.revokedAt ? job.share.evidenceIds : [], shared: !!job.share && !job.share.revokedAt,
    } : {}),
  };
}

function successful(res: Response, req: Request, value: unknown, code = 200) {
  sendSuccess(res, value, code, req.requestId);
}

function validatePhoto(value: string | null | undefined) {
  if (!value) return value;
  const parsed = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/]+=*)$/.exec(value);
  if (!parsed?.[2]) fail("Choose a valid JPEG or PNG photo");
  const photo = validateRequestImage(Buffer.from(parsed[2], "base64"));
  if (photo.mimeType !== parsed[1]) fail("Photo content does not match its type");
  return value;
}

async function createMember(
  tx: Prisma.TransactionClient, garageId: string, input: { name: string; email: string; username: string },
  role: "OWNER" | "MECHANIC", passwordHash: string,
) {
  return tx.garageMembership.create({
    data: { garage: { connect: { id: garageId } }, role, username: input.username, user: { create: {
      fullName: input.name, email: input.email, passwordHash, role: UserRole.GARAGE_USER,
      accountStatus: AccountStatus.ACTIVE, mustChangePassword: true,
    } } },
    include: identityFields,
  });
}

async function checkUnique<T>(operation: Promise<T>) {
  try {
    return await operation;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
      fail("This email or username is already registered", "GARAGE_IDENTITY_EXISTS", 409);
    throw error;
  }
}

export function createGarageRoutes(database: PrismaClient, env: Env, auth: AuthService) {
  const router = Router();
  const authenticate = createAuthenticateMiddleware(database, env);
  const manager = requireRoles(database, UserRole.ADMIN, UserRole.SUPER_ADMIN);
  const customer = requireRoles(database, UserRole.CUSTOMER);
  const garageOnly = requireRoles(database, UserRole.GARAGE_USER);
  const limits = createAuthRateLimits(env);
  const files = resolve(env.REQUEST_ATTACHMENT_DIR + "-garage-evidence");

  async function access(req: Request, owner = false, allowTemporary = false) {
    if (!req.auth || req.auth.role !== UserRole.GARAGE_USER) return denied();
    const member = await database.garageMembership.findFirst({
      where: { userId: req.auth.id, active: true, garage: active() },
      include: identityFields,
    });
    if (!member || (owner && member.role !== "OWNER")) return denied();
    if (req.auth.mustChangePassword && !allowTemporary)
      fail("Change your temporary password before opening the workspace", "PASSWORD_CHANGE_REQUIRED", 403);
    return member;
  }

  async function findJob(req: Request, member: Member) {
    const job = await database.garageJob.findFirst({
      where: { id: schema.id.parse(req.params.jobId), garageId: member.garageId,
        ...(member.role === "MECHANIC" ? { mechanicId: member.id } : {}) },
      include: jobRelations,
    });
    return job ?? missing();
  }

  async function changeJob(tx: Prisma.TransactionClient, job: ScopedJob, changes: Prisma.GarageJobUncheckedUpdateManyInput) {
    if ((await tx.garageJob.updateMany({ where: { id: job.id, version: job.version },
      data: { ...changes, version: { increment: 1 } } })).count !== 1) stale();
  }

  async function resetMember(memberId: string, req: Request, where: Prisma.GarageMembershipWhereInput, requested = false) {
    const pw = temporaryPassword();
    const passwordHash = await hashPassword(pw);
    await database.$transaction(async (tx) => {
      const member = await tx.garageMembership.findFirst({ where: { id: memberId, ...where } }) ?? missing();
      if (member.role === "OWNER") {
        const handled = await tx.garageOwnerRecovery.deleteMany({ where: { memberId: member.id } });
        if (requested && handled.count === 0)
          fail("This request has already been handled", "GARAGE_RECOVERY_HANDLED", 409);
      }
      await tx.user.update({ where: { id: member.userId }, data: { passwordHash, mustChangePassword: true } });
      await tx.refreshSession.updateMany({ where: { userId: member.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await recordAudit(tx, { actorUserId: req.auth!.id, requestId: req.requestId, entityType: "GARAGE_MEMBERSHIP", entityId: member.id, action: "GARAGE_CREDENTIAL_RESET" });
    });
    return { temporaryPassword: pw };
  }

  function fileResponse(res: Response, next: NextFunction, file: { id: string; mimeType: string; name: string }) {
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.contentType(file.mimeType);
    res.download(file.id, file.name, { root: files, dotfiles: "allow" }, (error) => {
      if (!error) return;
      if (!res.headersSent) {
        res.removeHeader("Content-Type");
        next("status" in error && error.status === 404
          ? new AppError("Garage evidence file was not found", { code: "GARAGE_EVIDENCE_UNAVAILABLE", statusCode: 404 })
          : error);
        return;
      }
      next(error);
    });
  }

  router.get("/garages", async (req, res) => {
    const { area, type, service, page } = schema.directory.parse(req.query);
    const where = { ...active(), area, type, published: true, ...(service ? { services: { has: service } } : {}) };
    const [items, total] = await database.$transaction([
      database.garage.findMany({ where, select: publicFields, orderBy: [{ name: "asc" }, { slug: "asc" }], skip: (page - 1) * 24, take: 24 }),
      database.garage.count({ where }),
    ]);
    successful(res, req, { items, total, page });
  });
  router.get("/garages/:slug", async (req, res) => {
    const item = await database.garage.findFirst({ where: { ...active(), slug: req.params.slug, published: true }, select: publicFields });
    successful(res, req, item ?? missing());
  });

  router.get("/admin/garages", authenticate, manager, async (req, res) => {
    const garages = await database.garage.findMany({
      orderBy: { createdAt: "desc" }, take: 100,
      include: { members: { where: { role: "OWNER" }, select: { id: true, username: true, user: { select: { email: true, fullName: true } } } } },
    });
    successful(res, req, garages.map(({ id, name, contactPhone, endsAt, terminatedAt, amount, published, members }) => ({
      id, name, contactPhone, endsAt, amount, published, owner: members[0],
      status: terminatedAt ? "Terminated" : endsAt <= new Date() ? "Expired" : "Active",
    })));
  });
  router.post("/admin/garages", authenticate, manager, async (req, res) => {
    const input = schema.createGarage.parse(req.body);
    const pw = temporaryPassword();
    const passwordHash = await hashPassword(pw);
    const garageId = await checkUnique(database.$transaction(async (tx) => {
      const slug = input.garageName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 65);
      const garage = await tx.garage.create({ data: { name: input.garageName, contactPhone: input.contactPhone,
        slug: `${slug || "garage"}-${randomBytes(5).toString("hex")}`, endsAt: addCalendarMonths(new Date(), input.months), amount: input.amount } });
      await createMember(tx, garage.id, input, "OWNER", passwordHash);
      await recordAudit(tx, { actorUserId: req.auth!.id, requestId: req.requestId, entityType: "GARAGE", entityId: garage.id, action: "GARAGE_CREATED" });
      return garage.id;
    }));
    res.setHeader("Cache-Control", "no-store");
    successful(res, req, { garageId, temporaryPassword: pw }, 201);
  });
  router.post("/admin/garages/:garageId/terminate", authenticate, manager, async (req, res) => {
    const garageId = schema.id.parse(req.params.garageId);
    await database.$transaction(async (tx) => {
      const garage = await tx.garage.findUnique({ where: { id: garageId } }) ?? missing();
      if (garage.terminatedAt) return;
      const now = new Date();
      await tx.garage.update({ where: { id: garageId }, data: { terminatedAt: now } });
      await tx.refreshSession.updateMany({ where: { user: { garageMembership: { garageId } }, revokedAt: null }, data: { revokedAt: now } });
      await recordAudit(tx, { actorUserId: req.auth!.id, requestId: req.requestId, entityType: "GARAGE", entityId: garageId, action: "GARAGE_TERMINATED" });
    });
    successful(res, req, { terminated: true });
  });
  router.post("/admin/garages/:garageId/reset-owner", authenticate, manager, async (req, res) => {
    const garageId = schema.id.parse(req.params.garageId);
    const owner = await database.garageMembership.findFirst({ where: { garageId, role: "OWNER" } }) ?? missing();
    res.setHeader("Cache-Control", "no-store");
    successful(res, req, await resetMember(owner.id, req, { garageId, role: "OWNER" }));
  });

  router.get("/admin/garage-owner-recovery", authenticate, manager, async (req, res) => {
    const entries = await database.garageOwnerRecovery.findMany({
      where: { member: { active: true, garage: active(), user: { accountStatus: AccountStatus.ACTIVE } } },
      orderBy: { requestedAt: "asc" }, take: 100,
      include: { member: { select: { username: true, garage: { select: { name: true } }, user: { select: { fullName: true, email: true } } } } },
    });
    res.setHeader("Cache-Control", "no-store");
    successful(res, req, entries.map(({ memberId, requestedAt, member }) => ({
      memberId, requestedAt, username: member.username, garageName: member.garage.name,
      ownerName: member.user.fullName, email: member.user.email,
    })));
  });

  router.post("/admin/garage-owner-recovery/:memberId/reset", authenticate, manager, async (req, res) => {
    const memberId = schema.id.parse(req.params.memberId);
    const member = await database.garageMembership.findFirst({
      where: { id: memberId, role: "OWNER", active: true, garage: active(), user: { accountStatus: AccountStatus.ACTIVE } },
      select: { user: { select: { email: true } } },
    }) ?? missing();
    const credentials = await resetMember(memberId, req, {
      role: "OWNER", active: true, garage: active(), user: { accountStatus: AccountStatus.ACTIVE, email: member.user.email },
    }, true);
    res.setHeader("Cache-Control", "no-store");
    successful(res, req, { ...credentials, email: member.user.email });
  });

  router.post("/garage/auth/forgot-password", limits.recovery, async (req, res) => {
    const input = schema.ownerRecovery.parse(req.body);
    const member = await database.garageMembership.findFirst({
      where: { username: input.username, role: "OWNER", active: true, garage: active(),
        user: { email: input.email, accountStatus: AccountStatus.ACTIVE } },
      select: { id: true },
    });
    if (member) await database.garageOwnerRecovery.createMany({ data: { memberId: member.id }, skipDuplicates: true });
    res.setHeader("Cache-Control", "no-store");
    successful(res, req, { accepted: true }, 202);
  });

  router.post("/garage/auth/login", limits.login, async (req, res) => {
    const input = schema.signIn.parse(req.body);
    const member = await database.garageMembership.findUnique({
      where: { username: input.username }, include: { garage: true, user: { select: { email: true } } },
    });
    if (!member || member.role !== input.role || !member.active || member.garage.terminatedAt || member.garage.endsAt <= new Date()) {
      await verifyPassword(undefined, input.password);
      fail("Invalid credentials or inactive garage access", "INVALID_CREDENTIALS", 401);
    }
    const session = await auth.login({ email: member.user.email, password: input.password }, requestMetadata(req), true);
    setAuthCookies(res, session.refreshToken, session.csrfToken, env, "garage");
    res.setHeader("Cache-Control", "no-store");
    successful(res, req, publicSession(session));
  });
  router.get("/garage/me", authenticate, garageOnly, async (req, res) => {
    const member = await access(req, false, true);
    successful(res, req, { ...mechanicView(member), mustChangePassword: req.auth!.mustChangePassword });
  });
  router.get("/garage/workspace", authenticate, garageOnly, async (req, res) => {
    const member = await access(req);
    const owner = member.role === "OWNER";
    const [profile, jobs, mechanics, finance] = await Promise.all([
      database.garage.findUniqueOrThrow({ where: { id: member.garageId }, select: publicFields }),
      database.garageJob.findMany({
        where: { garageId: member.garageId, ...(owner ? {} : { mechanicId: member.id }) },
        include: jobRelations, orderBy: { createdAt: "desc" },
      }),
      owner ? database.garageMembership.findMany({ where: { garageId: member.garageId, role: "MECHANIC" }, include: identityFields }) : Promise.resolve([member]),
      owner ? database.garageLedgerEntry.findMany({ where: { garageId: member.garageId }, orderBy: { date: "desc" } }) : Promise.resolve([]),
    ]);
    res.setHeader("Cache-Control", "private, no-store");
    successful(res, req, { profile, jobs: jobs.map((job) => jobView(job, owner)), mechanics: mechanics.map(mechanicView), finance, identity: mechanicView(member) });
  });
  router.put("/garage/profile", authenticate, garageOnly, async (req, res) => {
    const member = await access(req, true);
    const profile = schema.garageProfile.parse(req.body);
    const published = !!(profile.area && profile.type && profile.address && profile.phone && profile.services.length);
    await database.garage.update({ where: { id: member.garageId }, data: { ...profile, published } });
    successful(res, req, { published });
  });
  router.post("/garage/mechanics", authenticate, garageOnly, async (req, res) => {
    const owner = await access(req, true);
    const input = schema.credentials.parse(req.body);
    const pw = temporaryPassword();
    const hashed = await hashPassword(pw);
    const member = await checkUnique(database.$transaction((tx) => createMember(tx, owner.garageId, input, "MECHANIC", hashed)));
    res.setHeader("Cache-Control", "no-store");
    successful(res, req, { member: mechanicView(member), temporaryPassword: pw }, 201);
  });
  router.put("/garage/mechanics/:memberId", authenticate, garageOnly, async (req, res) => {
    const owner = await access(req, true);
    const id = schema.id.parse(req.params.memberId);
    const input = schema.memberEdit.parse(req.body);
    await checkUnique(database.$transaction(async (tx) => {
      const member = await tx.garageMembership.findFirst({ where: { id, garageId: owner.garageId, role: "MECHANIC" } }) ?? missing();
      await tx.garageMembership.update({ where: { id }, data: { username: input.username, active: input.active,
        user: { update: { email: input.email, fullName: input.name } } } });
      if (!input.active) await tx.refreshSession.updateMany({ where: { userId: member.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    }));
    successful(res, req, { updated: true });
  });
  router.post("/garage/mechanics/:memberId/reset", authenticate, garageOnly, async (req, res) => {
    const owner = await access(req, true);
    res.setHeader("Cache-Control", "no-store");
    successful(res, req, await resetMember(schema.id.parse(req.params.memberId), req, { garageId: owner.garageId, role: "MECHANIC" }));
  });
  router.put("/garage/mechanic/profile", authenticate, garageOnly, async (req, res) => {
    const member = await access(req);
    if (member.role !== "MECHANIC") return denied();
    const value = schema.mechanicProfile.parse(req.body);
    await checkUnique(database.garageMembership.update({ where: { id: member.id }, data: {
      specialty: value.specialty, phone: value.phone, photo: validatePhoto(value.photo),
      user: { update: { fullName: value.name, email: value.email } },
    } }));
    successful(res, req, { updated: true });
  });

  router.post("/garage/jobs", authenticate, garageOnly, async (req, res) => {
    const member = await access(req, true);
    const input = schema.createJob.parse(req.body);
    const linked = await database.customerProfile.findFirst({ where: {
      user: { email: input.customer, role: UserRole.CUSTOMER,
        accountStatus: { in: [AccountStatus.ACTIVE, AccountStatus.PENDING_VERIFICATION] } },
    }, select: { id: true } });
    if (!linked) fail("Enter the email of an eligible customer account", "GARAGE_CUSTOMER_NOT_FOUND", 404);
    const vehicle = input.vehicleId ? await database.vehicle.findFirst({ where: { id: input.vehicleId, customerId: linked.id } }) : null;
    if (input.vehicleId && !vehicle) return missing();
    const job = await database.garageJob.create({ data: {
      garageId: member.garageId, customerId: linked.id, vehicle: vehicle ? `${vehicle.make} ${vehicle.model}` : input.vehicle,
      registration: vehicle?.registrationNumber ?? input.registration, service: input.service,
      concern: input.concern, consentAt: input.consent ? new Date() : null,
    }, include: jobRelations });
    successful(res, req, jobView(job, true), 201);
  });

  router.post("/garage/jobs/:jobId/action", authenticate, garageOnly, async (req, res) => {
    const member = await access(req);
    const job = await findJob(req, member);
    const input = schema.jobAction.parse(req.body);
    const owner = member.role === "OWNER";
    await database.$transaction(async (tx) => {
      if (input.action === "submit" || input.action === "draft") {
        if (owner || !working.includes(job.status)) return denied();
        if (input.action === "submit" && !input.report.summary) fail("Add an inspection summary first");
        const photoIds = new Set(job.evidence.filter((file) => file.mimeType !== "video/mp4").map((file) => file.id));
        if (input.report.findings.some((finding) => finding.evidenceIds?.some((fileId) => !photoIds.has(fileId))))
          return missing();
        await changeJob(tx, job, { report: input.report, status: input.action === "submit" ? "SUBMITTED" : "DRAFT" });
        return;
      }
      if (!owner) return denied();
      if (input.action === "assign") {
        if (!["UNASSIGNED", "ASSIGNED"].includes(job.status)) stale();
        if (!await tx.garageMembership.findFirst({ where: { id: input.mechanicId, garageId: member.garageId, role: "MECHANIC", active: true } })) return missing();
        await changeJob(tx, job, { mechanicId: input.mechanicId, status: "ASSIGNED" });
        return;
      }

      if (input.action === "revoke" || input.action === "return") {
        if (input.action === "return" && job.status !== "SUBMITTED") stale();
        await changeJob(tx, job, {
          status: input.action === "return" ? "DRAFT" : job.status === "SHARED" ? "SUBMITTED" : job.status,
        });
        await tx.garageShare.updateMany({ where: { jobId: job.id }, data: { revokedAt: new Date() } });
        return;
      }
      if (input.action === "evidence") {
        if (!job.share || job.share.revokedAt || !job.evidenceRequested) return denied();
        const evidenceIds = [...new Set(input.evidenceIds)];
        if (evidenceIds.some((id) => !job.evidence.some((file) => file.id === id))) return missing();
        await changeJob(tx, job, {});
        await tx.garageShare.update({ where: { jobId: job.id }, data: { evidenceIds } });
        return;
      }
      if (!reviewable.includes(job.status)) stale();
      if (input.action === "close") {
        await changeJob(tx, job, { status: "CLOSED" });
        return;
      }

      const quotation = input.action === "quote" ? input.quotation : job.quotation;
      if (input.action === "quote" && input.quotation.status === "Draft") {
        if (job.status === "SHARED") fail("Revoke the shared report before editing its quotation", "GARAGE_SHARE_ACTIVE", 409);
        await changeJob(tx, job, { quotation: input.quotation });
        return;
      }
      if (!job.report) stale();
      if (input.action === "share" && job.status === "SHARED") stale();
      const evidenceIds = job.share?.revokedAt ? [] : job.share?.evidenceIds ?? [];
      const report = jsonObject(job.report);
      const findings = Array.isArray(report.findings) ? report.findings.map((finding) => {
        const { component, issue, nextStep } = jsonObject(finding);
        return { component, issue, nextStep };
      }) : [];
      const share = {
        report: { summary: report.summary, findings } as Prisma.InputJsonObject,
        quotation: jsonObject(quotation).status === "Ready to hand over" ? jsonObject(quotation) as Prisma.InputJsonObject : Prisma.DbNull,
        evidenceIds, revokedAt: null, sharedAt: new Date(),
      };
      await changeJob(tx, job, { status: "SHARED", ...(input.action === "quote" ? { quotation: input.quotation } : {}) });
      await tx.garageShare.upsert({ where: { jobId: job.id }, create: { ...share, jobId: job.id }, update: share });
    });
    successful(res, req, { updated: true });
  });

  router.post("/garage/jobs/:jobId/evidence", authenticate, garageOnly,
    express.raw({ type: ["image/jpeg", "image/png", "video/mp4"], limit: "30mb" }), async (req, res) => {
      const member = await access(req);
      const job = await findJob(req, member);
      if (member.role !== "MECHANIC" || !job.consentAt || !working.includes(job.status)) return denied();
      if (!Buffer.isBuffer(req.body)) fail("Choose an image or MP4 clip");
      const isVideo = req.is("video/mp4");
      if (isVideo && (req.body.length < 12 || req.body.toString("ascii", 4, 8) !== "ftyp")) fail("Choose a valid MP4 video");
      const originalName = req.header("x-evidence-name");
      let name: string | undefined;
      try { name = originalName && decodeURIComponent(originalName); } catch { fail("Invalid file name"); }
      const image = isVideo ? null : validateRequestImage(req.body, name);
      const mimeType = image?.mimeType ?? "video/mp4";
      if (job.evidence.filter((entry) => (entry.mimeType === "video/mp4") === !!isVideo).length >= (isVideo ? 1 : 5))
        fail("This job has reached its evidence limit", "GARAGE_EVIDENCE_LIMIT", 409);
      const fileId = randomUUID(), target = resolve(files, fileId);
      await mkdir(files, { recursive: true, mode: 0o700 });
      await writeFile(target, req.body, { flag: "wx", mode: 0o600 });
      try {
        const file = await database.$transaction(async (tx) => {
          await changeJob(tx, job, { status: "DRAFT" });
          return tx.garageEvidence.create({ data: { id: fileId, jobId: job.id, mimeType,
            name: isVideo ? "inspection-clip.mp4" : image!.fileName, size: req.body.length } });
        });
        successful(res, req, evidenceView(file), 201);
      } catch (error) {
        await unlink(target).catch(() => undefined);
        throw error;
      }
    });
  router.delete("/garage/jobs/:jobId/evidence/:fileId", authenticate, garageOnly, async (req, res) => {
    const member = await access(req);
    const job = await findJob(req, member);
    if (member.role !== "MECHANIC" || !working.includes(job.status)) return denied();
    const file = job.evidence.find((item) => item.id === schema.id.parse(req.params.fileId)) ?? missing();
    await database.$transaction(async (tx) => {
      const report = schema.inspectionReport.safeParse(job.report);
      if (report.success) {
        const findings = report.data.findings.map((finding) => ({
          ...finding, ...(finding.evidenceIds && { evidenceIds: finding.evidenceIds.filter((id) => id !== file.id) }),
        }));
        await changeJob(tx, job, { report: { ...report.data, findings } });
      } else {
        await changeJob(tx, job, {});
      }
      await tx.garageEvidence.delete({ where: { id: file.id } });
    });
    await unlink(resolve(files, file.id)).catch(() => undefined);
    res.sendStatus(204);
  });
  router.get("/garage/jobs/:jobId/evidence/:fileId", authenticate, garageOnly, async (req, res, next) => {
    const member = await access(req);
    const job = await findJob(req, member);
    fileResponse(res, next, job.evidence.find((item) => item.id === schema.id.parse(req.params.fileId)) ?? missing());
  });

  router.post("/garage/ledger", authenticate, garageOnly, async (req, res) => {
    const member = await access(req, true);
    const data = schema.ledgerEntry.parse(req.body);
    successful(res, req, await database.garageLedgerEntry.create({ data: { ...data, garageId: member.garageId } }), 201);
  });
  router.put("/garage/ledger/:entryId", authenticate, garageOnly, async (req, res) => {
    const member = await access(req, true);
    if (!(await database.garageLedgerEntry.updateMany({ where: { garageId: member.garageId, id: schema.id.parse(req.params.entryId) },
      data: schema.ledgerEntry.parse(req.body) })).count) return missing();
    successful(res, req, { updated: true });
  });
  router.delete("/garage/ledger/:entryId", authenticate, garageOnly, async (req, res) => {
    const member = await access(req, true);
    if (!(await database.garageLedgerEntry.deleteMany({ where: { garageId: member.garageId, id: schema.id.parse(req.params.entryId) } })).count) return missing();
    res.sendStatus(204);
  });

  router.get("/customers/me/garage-reports", authenticate, customer, async (req, res) => {
    const shares = await database.garageShare.findMany({ where: { revokedAt: null, job: { customer: { userId: req.auth!.id } } },
      orderBy: { sharedAt: "desc" }, include: { job: { select: { vehicle: true, service: true, evidenceRequested: true,
        garage: { select: { name: true } }, evidence: { select: evidenceFields } } } } });
    res.setHeader("Cache-Control", "private, no-store");
    successful(res, req, shares.map(({ jobId, report, quotation, evidenceIds, sharedAt, job }) => ({
      jobId, report, quotation, sharedAt, vehicle: job.vehicle, service: job.service, garage: job.garage.name,
      evidenceRequested: job.evidenceRequested, files: job.evidence.filter((file) => evidenceIds.includes(file.id)).map(evidenceView),
    })));
  });
  router.post("/customers/me/garage-reports/:jobId/request-evidence", authenticate, customer, async (req, res) => {
    if (!(await database.garageJob.updateMany({ where: { id: schema.id.parse(req.params.jobId), customer: { userId: req.auth!.id },
      share: { is: { revokedAt: null } } }, data: { evidenceRequested: true, version: { increment: 1 } } })).count) return missing();
    successful(res, req, { requested: true });
  });
  router.get("/customers/me/garage-reports/:jobId/evidence/:fileId", authenticate, customer, async (req, res, next) => {
    const fileId = schema.id.parse(req.params.fileId);
    const file = await database.garageEvidence.findFirst({ where: { id: fileId, jobId: schema.id.parse(req.params.jobId),
      job: { customer: { userId: req.auth!.id }, share: { is: { revokedAt: null, evidenceIds: { has: fileId } } } } } });
    fileResponse(res, next, file ?? missing());
  });

  return router;
}
