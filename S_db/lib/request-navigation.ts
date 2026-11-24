export function resolveRequestView(params: URLSearchParams) {
  const requested = params.get("view");
  if (requested === "purchases" || requested === "rfqs" || requested === "quotations") return requested;
  return params.has("q") || params.has("open") ? "rfqs" : "purchases";
}

export function matchesRequestSearch(
  request: { id: string; requestNumber?: string; part: string; vehicle: string },
  search: string,
) {
  const query = search.trim().toLowerCase();
  return !query || `${request.requestNumber ?? ""} ${request.id} ${request.part} ${request.vehicle}`.toLowerCase().includes(query);
}
