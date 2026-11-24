import { readFile } from "node:fs/promises";
import process from "node:process";
import { URL } from "node:url";
import { load } from "js-yaml";

const document = load(
  await readFile(new URL("../openapi.yaml", import.meta.url), "utf8"),
);
if (!document || document.openapi !== "3.1.0" || !document.info || !document.paths) {
  throw new Error("openapi.yaml must contain an OpenAPI 3.1 info object and paths");
}

const operations = new Set();
for (const [path, item] of Object.entries(document.paths)) {
  if (!path.startsWith("/") || !item || typeof item !== "object") {
    throw new Error(`Invalid OpenAPI path: ${path}`);
  }
  for (const method of ["get", "post", "put", "patch", "delete"]) {
    const operation = item[method];
    if (!operation) continue;
    if (!operation.operationId)
      throw new Error(`${method.toUpperCase()} ${path} has no operationId`);
    if (operations.has(operation.operationId)) {
      throw new Error(`Duplicate operationId: ${operation.operationId}`);
    }
    operations.add(operation.operationId);
    if (!operation.responses || Object.keys(operation.responses).length === 0) {
      throw new Error(`${method.toUpperCase()} ${path} has no responses`);
    }
  }
}

const operation = (path, method) => {
  const value = document.paths[path]?.[method];
  if (!value)
    throw new Error(`Missing critical contract: ${method.toUpperCase()} ${path}`);
  return value;
};
const requireResponses = (value, statuses) => {
  for (const status of statuses) {
    if (!value.responses?.[status])
      throw new Error(`${value.operationId} is missing response ${status}`);
  }
};
const requireBearer = (value) => {
  if (!value.security?.some((item) => Object.hasOwn(item, "bearerAuth")))
    throw new Error(`${value.operationId} must require bearer authentication`);
};

for (const [path, method, successStatus] of [
  ["/supplier/inventory/{inventoryId}/images", "post", "201"],
  ["/supplier/inventory/{inventoryId}/images/{imageId}", "put", "200"],
]) {
  const value = operation(path, method);
  requireBearer(value);
  requireResponses(value, [successStatus, "404", "413", "415"]);
  const media = Object.keys(value.requestBody?.content ?? {});
  if (media.length !== 1 || media[0] !== "image/webp")
    throw new Error(`${value.operationId} must accept normalized image/webp only`);
}

const walletReconciliation = operation("/admin/credits/reconciliation", "get");
requireBearer(walletReconciliation);
requireResponses(walletReconciliation, ["200", "403"]);

const imageReconciliation = operation("/admin/jobs/listing-images/reconcile", "post");
requireBearer(imageReconciliation);
requireResponses(imageReconciliation, ["200", "400", "403"]);
const reconciliationSchema =
  imageReconciliation.requestBody?.content?.["application/json"]?.schema;
if (
  reconciliationSchema?.properties?.dryRun?.default !== true ||
  reconciliationSchema?.properties?.limit?.maximum !== 1000
)
  throw new Error("Listing-image reconciliation must stay bounded and dry-run-first");

process.stdout.write(`OpenAPI document is valid (${operations.size} operations).\n`);
