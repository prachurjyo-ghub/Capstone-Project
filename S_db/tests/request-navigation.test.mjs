import assert from "node:assert/strict";
import { test } from "node:test";
import { matchesRequestSearch, resolveRequestView } from "../lib/request-navigation.ts";

test("header searches and request deep links open the sourcing inbox", () => {
  assert.equal(resolveRequestView(new URLSearchParams("q=RFQ-2026-001000")), "rfqs");
  assert.equal(resolveRequestView(new URLSearchParams("open=assignment-id")), "rfqs");
  assert.equal(resolveRequestView(new URLSearchParams()), "purchases");
});

test("explicit tabs survive navigation and unknown tabs fall back safely", () => {
  assert.equal(resolveRequestView(new URLSearchParams("view=purchases&q=brake")), "purchases");
  assert.equal(resolveRequestView(new URLSearchParams("view=quotations")), "quotations");
  assert.equal(resolveRequestView(new URLSearchParams("view=unknown")), "purchases");
});

test("search accepts the displayed RFQ reference as well as part and assignment details", () => {
  const request = { id: "assignment-uuid", requestNumber: "RFQ-2026-001000", part: "Brake pad", vehicle: "Toyota Axio" };
  for (const query of [" rfq-2026-001000 ", "ASSIGNMENT-UUID", "brake", "axio", "  "]) assert.equal(matchesRequestSearch(request, query), true);
  assert.equal(matchesRequestSearch(request, "unrelated-part"), false);
});

test("requests without an optional reference can still be searched", () => {
  assert.equal(matchesRequestSearch({ id: "older-assignment", part: "Filter", vehicle: "Toyota" }, "older-assignment"), true);
});
