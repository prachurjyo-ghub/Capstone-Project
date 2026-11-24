import type { PrismaClient } from "@prisma/client";
import { Router } from "express";
import { getHealth, getReadiness } from "./health.controller.js";

export function createHealthRouter(database: PrismaClient) {
  const router = Router();
  router.get("/", getHealth);
  router.get("/readiness", (req, res) => void getReadiness(database, req, res));
  return router;
}
