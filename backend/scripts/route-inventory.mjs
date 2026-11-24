import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(backendRoot, "src");
const outputPath = path.resolve(backendRoot, "../docs/optimization/route-inventory.json");

function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory()
      ? files(target)
      : entry.name.endsWith(".routes.ts")
        ? [target]
        : [];
  });
}

function audience(routerName, sourceFile) {
  const value = `${routerName} ${sourceFile}`.toLowerCase();
  if (value.includes("admin")) return "admin";
  if (value.includes("supplier")) return "supplier";
  if (value.includes("customer")) return "customer";
  if (value.includes("internal")) return "internal";
  return "public-or-mixed";
}

const openapi = yaml.load(
  fs.readFileSync(path.join(backendRoot, "openapi.yaml"), "utf8"),
);
const openapiOperations = Object.entries(openapi.paths ?? {}).flatMap(
  ([routePath, item]) =>
    Object.keys(item ?? {})
      .filter((method) => ["get", "post", "put", "patch", "delete"].includes(method))
      .map((method) => ({ method: method.toUpperCase(), path: routePath })),
);

const routes = files(sourceRoot).flatMap((absolute) => {
  const text = fs.readFileSync(absolute, "utf8");
  const relative = path.relative(backendRoot, absolute);
  const functionMatches = [...text.matchAll(/export function\s+(\w+Router)\s*\(/g)];
  const routePattern =
    /\b(?:router|r)\.(get|post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)["'`]/gs;
  return [...text.matchAll(routePattern)].map((match) => {
    const index = match.index ?? 0;
    const router =
      functionMatches.filter((item) => (item.index ?? 0) < index).at(-1)?.[1] ??
      "unknown";
    const routeAudience = audience(router, relative);
    const method = match[1].toUpperCase();
    const routePath = match[2];
    const normalized = routePath.replace(/:([^/]+)/g, "{$1}");
    const documented = openapiOperations.some(
      (operation) =>
        operation.method === method &&
        normalized !== "/" &&
        operation.path.endsWith(normalized),
    );
    const functionEnd =
      functionMatches.find((item) => (item.index ?? Infinity) > index)?.index ??
      text.length;
    const functionStart =
      functionMatches.filter((item) => (item.index ?? 0) <= index).at(-1)?.index ?? 0;
    const routerBody = text.slice(functionStart, functionEnd);
    return {
      method,
      path: routePath,
      sourceFile: relative,
      line: text.slice(0, index).split("\n").length,
      router,
      audience: routeAudience,
      authenticated: /createAuthenticateMiddleware/.test(routerBody),
      roleGuarded: /requireRoles|requireActiveSupplierAccess|requireSupplier/.test(
        routerBody,
      ),
      objectOwnershipRequired:
        ["customer", "supplier"].includes(routeAudience) &&
        /:\w*(?:id|Id)/.test(routePath),
      documentedBySuffixHeuristic: documented,
    };
  });
});

routes.sort((a, b) =>
  `${a.sourceFile}:${String(a.line).padStart(5, "0")}`.localeCompare(
    `${b.sourceFile}:${String(b.line).padStart(5, "0")}`,
  ),
);
const inventory = {
  generatedFrom: "backend/src/**/*.routes.ts and backend/openapi.yaml",
  comparisonLimit:
    "OpenAPI matching is a conservative method/path suffix heuristic; mounted prefixes remain reviewable in source.",
  summary: {
    routeDeclarations: routes.length,
    openapiOperations: openapiOperations.length,
    heuristicDocumented: routes.filter((route) => route.documentedBySuffixHeuristic)
      .length,
    authenticatedDeclarations: routes.filter((route) => route.authenticated).length,
    ownershipReviewDeclarations: routes.filter((route) => route.objectOwnershipRequired)
      .length,
  },
  routes,
};
const serialized = `${JSON.stringify(inventory, null, 2)}\n`;

if (process.argv.includes("--write")) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, serialized);
  process.stdout.write(`Wrote ${routes.length} route declarations to ${outputPath}\n`);
} else {
  if (!fs.existsSync(outputPath) || fs.readFileSync(outputPath, "utf8") !== serialized) {
    process.stderr.write(
      "Route inventory drift detected. Run npm run routes:inventory:write and review the diff.\n",
    );
    process.exit(1);
  }
  process.stdout.write(`Route inventory is current (${routes.length} declarations).\n`);
}
