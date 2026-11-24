import { UserRole, type PrismaClient } from "@prisma/client";
import { Router } from "express";
import type { Env } from "../../config/env.js";
import {
  createAuthenticateMiddleware,
  requireActiveSupplierAccess,
  requireRoles,
} from "../../middleware/authenticate.js";
import { validateRequest } from "../../middleware/validate-request.js";
import { createFinanceController } from "./finance.controller.js";
import {
  auditQuery,
  caseList,
  configInput,
  createCase,
  dashboardQuery,
  financeList,
  idParams,
  invoiceList,
  issueInvoice,
  orderParams,
  pagination,
  paymentInput,
  queueQuery,
  refundApproval,
  refundCompletion,
  reversalInput,
  settlementInput,
  statementQuery,
  supplierOverviewQuery,
  updateCase,
  voidInvoice,
} from "./finance.schemas.js";
import type { FinanceService } from "./finance.service.js";

export function createAdminFinanceRouter(
  database: PrismaClient,
  env: Env,
  service: FinanceService,
) {
  const router = Router();
  const c = createFinanceController(service);
  router.use(createAuthenticateMiddleware(database, env));
  router.use(requireRoles(database, UserRole.ADMIN, UserRole.SUPER_ADMIN));
  router.post(
    "/orders/:orderId/invoices",
    validateRequest({ params: orderParams, body: issueInvoice }),
    c.issueInvoice,
  );
  router.post(
    "/orders/:orderId/payments",
    validateRequest({ params: orderParams, body: paymentInput }),
    c.recordPayment,
  );
  router.post(
    "/orders/:orderId/refunds",
    validateRequest({ params: orderParams, body: refundApproval }),
    c.approveRefund,
  );
  router.post(
    "/orders/:orderId/payables",
    validateRequest({ params: orderParams }),
    c.createPayable,
  );
  router.post(
    "/refunds/:id/complete",
    validateRequest({ params: idParams, body: refundCompletion }),
    c.completeRefund,
  );
  router.post("/settlements", validateRequest({ body: settlementInput }), c.settlement);
  router.post(
    "/transactions/:id/reversals",
    validateRequest({ params: idParams, body: reversalInput }),
    c.reverse,
  );
  router.post(
    "/invoices/:id/void",
    validateRequest({ params: idParams, body: voidInvoice }),
    c.voidInvoice,
  );
  router.get("/invoices", validateRequest({ query: invoiceList }), c.listAdminInvoices);
  router.get("/invoices/:id", validateRequest({ params: idParams }), c.getAdminInvoice);
  router.get(
    "/invoices/:id/pdf",
    validateRequest({ params: idParams }),
    c.adminInvoicePdf,
  );
  router.get(
    "/transactions",
    validateRequest({ query: financeList }),
    c.listAdminTransactions,
  );
  router.get("/refunds", validateRequest({ query: pagination }), c.listRefunds);
  router.get("/settlements", validateRequest({ query: pagination }), c.listSettlements);
  router.get(
    "/supplier-overview",
    validateRequest({ query: supplierOverviewQuery }),
    c.supplierOverview,
  );
  return router;
}

export function createCustomerFinanceRouter(
  database: PrismaClient,
  env: Env,
  service: FinanceService,
) {
  const router = Router();
  const c = createFinanceController(service);
  router.use(createAuthenticateMiddleware(database, env));
  router.use(requireRoles(database, UserRole.CUSTOMER));
  router.get("/invoices", validateRequest({ query: invoiceList }), c.customerInvoices);
  router.get("/invoices/:id", validateRequest({ params: idParams }), c.customerInvoice);
  router.get(
    "/invoices/:id/pdf",
    validateRequest({ params: idParams }),
    c.customerInvoicePdf,
  );
  router.get("/history", validateRequest({ query: financeList }), c.customerHistory);
  return router;
}

export function createSupplierFinanceRouter(
  database: PrismaClient,
  env: Env,
  service: FinanceService,
) {
  const router = Router();
  const c = createFinanceController(service);
  router.use(createAuthenticateMiddleware(database, env));
  router.use(requireRoles(database, UserRole.SUPPLIER_OWNER, UserRole.SUPPLIER_STAFF));
  router.use(requireActiveSupplierAccess(database));
  router.get("/summary", validateRequest({ query: statementQuery }), c.supplierStatement);
  router.get(
    "/transactions",
    validateRequest({ query: financeList }),
    c.supplierTransactions,
  );
  router.get(
    "/statements/download",
    validateRequest({ query: statementQuery }),
    c.supplierStatementPdf,
  );
  return router;
}

export function createAdminOperationsRouter(
  database: PrismaClient,
  env: Env,
  service: FinanceService,
) {
  const router = Router();
  const c = createFinanceController(service);
  router.use(createAuthenticateMiddleware(database, env));
  router.use(requireRoles(database, UserRole.ADMIN, UserRole.SUPER_ADMIN));
  router.get("/dashboard", validateRequest({ query: dashboardQuery }), c.dashboard);
  router.get("/queues", validateRequest({ query: queueQuery }), c.queue);
  router.get("/audit-logs", validateRequest({ query: auditQuery }), c.audits);
  router.get("/configuration", c.getConfig);
  router.put("/configuration", validateRequest({ body: configInput }), c.updateConfig);
  router.get("/cases", validateRequest({ query: caseList }), c.listCases);
  router.get("/cases/:id", validateRequest({ params: idParams }), c.getCase);
  router.post("/cases", validateRequest({ body: createCase }), c.createCase);
  router.patch(
    "/cases/:id",
    validateRequest({ params: idParams, body: updateCase }),
    c.updateCase,
  );
  return router;
}
