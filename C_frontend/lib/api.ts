export type UserRole =
  "CUSTOMER" | "SUPPLIER_OWNER" | "SUPPLIER_STAFF" | "ADMIN" | "SUPER_ADMIN";

export type AccountStatus =
  "PENDING_VERIFICATION" | "ACTIVE" | "SUSPENDED" | "DISABLED";

export type SafeAccount = {
  id: string;
  email: string;
  fullName: string | null;
  phone: string | null;
  role: UserRole;
  accountStatus: AccountStatus;
  emailVerified: boolean;
  phoneVerified: boolean;
  createdAt: string;
  customerProfile: {
    fullName: string;
    preferredName: string | null;
    companyName: string | null;
  } | null;
  supplierMemberships: Array<{
    id: string;
    title: string | null;
    isPrimary: boolean;
    isActive: boolean;
    business: {
      id: string;
      businessCode: string | null;
      displayName: string;
      status: string;
    };
  }>;
};

export type AuthSession = {
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  csrfToken: string;
  account: SafeAccount;
};

export type CustomerProfileResponse = {
  id: string;
  email: string;
  phone: string | null;
  role: "CUSTOMER";
  accountStatus: AccountStatus;
  emailVerified: boolean;
  phoneVerified: boolean;
  suspendedAt: string | null;
  createdAt: string;
  updatedAt: string;
  profile: {
    fullName: string;
    preferredName: string | null;
    companyName: string | null;
    createdAt: string;
    updatedAt: string;
  };
};

export type CustomerAddress = {
  id: string;
  label: string | null;
  recipientName: string | null;
  phone: string | null;
  addressLine: string;
  addressLine2: string | null;
  area: string | null;
  city: string;
  postalCode: string | null;
  landmark: string | null;
  deliveryInstructions: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CustomerVehicle = {
  id: string;
  make: string;
  model: string;
  year: number | null;
  variant: string | null;
  registrationNumber: string | null;
  chassisVin: string | null;
  engineInfo: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SourcingRequest = {
  id: string;
  requestNumber: string;
  status: string;
  urgency: "STANDARD" | "URGENT";
  requestType: "CUSTOM_SOURCING" | "FIXED_PRICE_PURCHASE" | "USED_PART_RFQ";
  creditStatus: "NOT_APPLICABLE" | "ELIGIBLE" | "AWAITING_CREDITS" | "RESERVED";
  title: string | null;
  customerNotes: string | null;
  submittedAt: string | null;
  createdAt: string;
  cancelledAt: string | null;
  vehicleSnapshot: {
    make: string;
    model: string;
    year: number | null;
    variant: string | null;
  } | null;
  deliverySnapshot: {
    area: string;
    city: string;
  } | null;
  listing: {
    id: string;
    listingClassification: CatalogueClassification;
    fixedPrice: string | null;
    product: { id: string; name: string; catalogueCode: string | null };
  } | null;
  targetBusiness: { displayName: string } | null;
  items: Array<{
    id: string;
    description: string;
    quantity: number;
    partNumber: string | null;
  }>;
  attachments: Array<{ id: string; requestItemId: string | null }>;
  statusHistory: Array<{
    id: string;
    fromStatus: string | null;
    toStatus: string;
    createdAt: string;
  }>;
};

export type CustomerSourcingOption = {
  id: string;
  optionNumber: string;
  requestId: string;
  supplier: { displayName: string };
  revisionNumber: number;
  status: string;
  currency: "BDT";
  customerItemsTotal: string;
  deliveryCharge: string;
  priorityCharge: string;
  customerTotal: string;
  preparationTimeMin: number | null;
  deliveryEstimateText: string | null;
  compatibilityNotes: string | null;
  customerNotes: string | null;
  validUntil: string;
  version: number;
  lines: Array<{
    id: string;
    requestItemId: string;
    description: string;
    brand: string | null;
    partNumber: string | null;
    condition: string;
    quantity: number;
    customerUnitPrice: string;
    customerLineTotal: string;
    compatibilityNotes: string | null;
    alternativePartInfo: string | null;
    selectedAlternative: boolean;
  }>;
};

export type CustomerOrder = {
  id: string;
  orderNumber: string;
  requestNumber: string | null;
  status: string;
  currency: "BDT";
  customerTotal: string;
  deliveryCharge: string;
  priorityCharge: string;
  externalSourcingRequired: boolean;
  supplierAvailabilityConfirmedAt: string | null;
  urgent: {
    eligibility: string;
    basis: string | null;
    estimatedWindowStart: string | null;
    estimatedWindowEnd: string | null;
    targetDeadlineAt: string | null;
    breached: boolean;
  };
  items: Array<{
    id: string;
    description: string;
    brand: string | null;
    partNumber: string | null;
    condition: string | null;
    quantity: number;
    customerUnitPrice: string;
    customerLineTotal: string;
    fulfillmentSource: "INVENTORY" | "EXTERNAL";
  }>;
  history: Array<{
    id: string;
    fromStatus: string | null;
    toStatus: string;
    note: string | null;
    at: string;
  }>;
  cancellationRequests: Array<{
    id: string;
    status: string;
    reason: string;
    requestedAt: string;
    decisionReason: string | null;
    decidedAt: string | null;
  }>;
  failure: { code: string; reason: string; reportedAt: string } | null;
  return: {
    id: string;
    status: string;
    reason: string;
    refundRequired: boolean;
  } | null;
  delivery: {
    recipient: string | null;
    area: string | null;
    city: string | null;
    status: string | null;
    courierName: string | null;
    trackingReference: string | null;
    pickedUpAt: string | null;
    deliveredAt: string | null;
  };
  createdAt: string;
};

export type CustomerInvoice = {
  id: string;
  invoiceNumber: string;
  orderId: string | null;
  orderNumber: string | null;
  status: "DRAFT" | "ISSUED" | "PAID" | "VOID" | "REFUNDED";
  currency: "BDT";
  subtotal: string;
  deliveryCharge: string;
  priorityCharge: string;
  total: string;
  received: string;
  refunded: string;
  outstanding: string;
  issuedAt: string | null;
  dueAt: string | null;
  paidAt: string | null;
  voidedAt: string | null;
  items: Array<{
    id: string;
    description: string;
    quantity: number;
    unitPrice: string;
    lineTotal: string;
  }>;
};

export type CustomerFinancialEntry = {
  id: string;
  reference: string;
  type: "CUSTOMER_PAYMENT" | "REFUND" | "REVERSAL";
  status: string;
  amount: string;
  currency: "BDT";
  method: string | null;
  occurredAt: string | null;
  orderId: string | null;
  invoiceId: string | null;
  refundId: string | null;
  reversalOfId: string | null;
  createdAt: string;
};

export type CatalogueCategory = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  imagePath: string | null;
};

export type CatalogueClassification =
  "NEW_GENUINE" | "NEW_AFTERMARKET" | "USED";

export type CatalogueImage = { id: string; url: string; width: number; height: number; isPrimary: boolean; version: number };

export type CatalogueOffer = {
  id: string;
  supplier: { displayName: string };
  listingClassification: CatalogueClassification;
  condition: "NEW" | "RECONDITIONED" | "USED";
  fixedPrice: string | null;
  availableQuantity: number;
  availabilityStatus: "IN_STOCK" | "LOW_STOCK";
  preparationTimeMin: number | null;
  notes: string | null;
  images: CatalogueImage[];
  requestAction: "PURCHASE_REQUEST" | "RFQ";
};

export type CatalogueProduct = {
  id: string;
  catalogueCode: string | null;
  name: string;
  description: string | null;
  imagePath: string | null;
  image?: CatalogueImage | null;
  images?: CatalogueImage[];
  priceFrom: string | null;
  quoteBasedAvailable: boolean;
  listingClassifications: CatalogueClassification[];
  offerCount: number;
  offers?: CatalogueOffer[];
  preparationTimeFromMin: number | null;
  availability: "AVAILABLE";
  category: CatalogueCategory;
  brand: { id: string; name: string; slug: string } | null;
  numbers: Array<{
    partNumber: string;
    isPrimary: boolean;
    manufacturer: string | null;
  }>;
  compatibility: Array<{
    make: string;
    model: string;
    yearFrom: number | null;
    yearTo: number | null;
    variant: string | null;
    notes: string | null;
  }>;
};

type ApiSuccess<T> = { success: true; data: T; requestId: string };
type ApiFailure = {
  success: false;
  error: {
    code: string;
    message: string;
    details: Array<{ path?: string; message?: string }>;
  };
  requestId: string;
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly details: ApiFailure["error"]["details"] = [],
    readonly requestId?: string,
    readonly kind:
      | "network"
      | "authentication"
      | "permission"
      | "validation"
      | "api" = "api",
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const API_BASE = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api/v1"
).replace(/\/$/, "");
const AUTH_CLIENT = "customer";
const CSRF_COOKIE = `${process.env.NEXT_PUBLIC_CSRF_COOKIE_NAME ?? "partsarc_csrf"}_${AUTH_CLIENT}`;
const CHANNEL_NAME = "partsarc-customer-session";
const LOCK_NAME = "partsarc-customer-refresh";

let session: AuthSession | null = null;
let refreshPromise: Promise<AuthSession | null> | null = null;
const listeners = new Set<(value: AuthSession | null) => void>();
let channel: BroadcastChannel | null = null;

function broadcast(value: AuthSession | null) {
  if (typeof window === "undefined" || !("BroadcastChannel" in window)) return;
  channel ??= new BroadcastChannel(CHANNEL_NAME);
  channel.postMessage({ type: value ? "session" : "logout", session: value });
}

function publish(value: AuthSession | null, notifyOtherTabs = true) {
  session = value;
  listeners.forEach((listener) => listener(value));
  if (notifyOtherTabs) broadcast(value);
}

function ensureChannel() {
  if (
    typeof window === "undefined" ||
    !("BroadcastChannel" in window) ||
    channel
  )
    return;
  channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = (event) => {
    const message = event.data as { type?: string; session?: AuthSession };
    if (message.type === "session" && message.session)
      publish(message.session, false);
    if (message.type === "logout") publish(null, false);
  };
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${encodeURIComponent(name)}=`;
  const item = document.cookie
    .split("; ")
    .find((value) => value.startsWith(prefix));
  return item ? decodeURIComponent(item.slice(prefix.length)) : null;
}

async function parseResponse<T>(response: Response): Promise<T> {
  let payload: ApiSuccess<T> | ApiFailure | undefined;
  try {
    payload = (await response.json()) as ApiSuccess<T> | ApiFailure;
  } catch {
    if ([429, 502, 503, 504].includes(response.status)) {
      throw new ApiError(
        "PartsArc is waking up after being idle. Please wait a moment and try again.",
        "SERVICE_WAKING",
        response.status,
        [],
        undefined,
        "network",
      );
    }
    throw new ApiError(
      "The server returned an unreadable response.",
      "INVALID_API_RESPONSE",
      response.status,
    );
  }
  if (!response.ok || !payload.success) {
    const failure = payload as ApiFailure;
    const kind =
      response.status === 401
        ? "authentication"
        : response.status === 403
          ? "permission"
          : response.status === 400 || response.status === 409
            ? "validation"
            : "api";
    throw new ApiError(
      failure.error?.message ?? "The request could not be completed.",
      failure.error?.code ?? "API_ERROR",
      response.status,
      failure.error?.details ?? [],
      failure.requestId,
      kind,
    );
  }
  return payload.data;
}

async function fetchWithRecovery(url: string, init: RequestInit) {
  const response = await fetch(url, init);
  if (
    ![429, 502, 503, 504].includes(response.status) ||
    !response.headers.has("x-render-routing")
  )
    return response;
  for (const delay of [1500, 3000, 5000, 8000, 8000]) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    const health = await fetch(`${API_BASE}/health`, {
      headers: { accept: "application/json", "x-auth-client": AUTH_CLIENT },
      credentials: "include",
    }).catch(() => null);
    if (health?.ok) return fetch(url, init);
  }
  return response;
}

async function rawRequest<T>(
  path: string,
  init: RequestInit = {},
  token?: string,
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  headers.set("x-auth-client", AUTH_CLIENT);
  if (init.body && !headers.has("content-type"))
    headers.set("content-type", "application/json");
  if (token) headers.set("authorization", `Bearer ${token}`);
  let response: Response;
  try {
    response = await fetchWithRecovery(`${API_BASE}${path}`, {
      ...init,
      headers,
      credentials: "include",
    });
  } catch {
    throw new ApiError(
      "Unable to reach PartsArc. Check your connection and try again.",
      "NETWORK_ERROR",
      0,
      [],
      undefined,
      "network",
    );
  }
  return parseResponse<T>(response);
}

async function withFallbackLock<T>(operation: () => Promise<T>): Promise<T> {
  const key = `${LOCK_NAME}-lease`;
  const owner = crypto.randomUUID();
  for (;;) {
    type Lease = { owner: string; expiresAt: number };
    let current: Lease | null = null;
    try {
      current = JSON.parse(localStorage.getItem(key) ?? "null") as Lease | null;
    } catch {
      return operation();
    }
    if (!current || current.expiresAt < Date.now()) {
      let claimed: Lease | null;
      try {
        localStorage.setItem(
          key,
          JSON.stringify({ owner, expiresAt: Date.now() + 5000 }),
        );
        claimed = JSON.parse(
          localStorage.getItem(key) ?? "null",
        ) as Lease | null;
      } catch {
        return operation();
      }
      if (claimed?.owner === owner) {
        try {
          return await operation();
        } finally {
          const latest = JSON.parse(
            localStorage.getItem(key) ?? "null",
          ) as Lease | null;
          if (latest?.owner === owner) localStorage.removeItem(key);
        }
      }
    }
    await new Promise((resolve) => window.setTimeout(resolve, 75));
  }
}

async function withRefreshLock<T>(operation: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request(LOCK_NAME, operation);
  }
  return withFallbackLock(operation);
}

export function subscribeToSession(
  listener: (value: AuthSession | null) => void,
) {
  ensureChannel();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSession() {
  return session;
}

export async function refreshSession(): Promise<AuthSession | null> {
  ensureChannel();
  if (refreshPromise) return refreshPromise;
  const previousToken = session?.accessToken;
  refreshPromise = withRefreshLock(async () => {
    if (session?.accessToken && session.accessToken !== previousToken)
      return session;
    const csrfToken = readCookie(CSRF_COOKIE);
    if (!csrfToken) {
      publish(null);
      return null;
    }
    try {
      const next = await rawRequest<AuthSession>("/auth/refresh", {
        method: "POST",
        headers: { "x-csrf-token": csrfToken },
      });
      publish(next);
      return next;
    } catch (error) {
      publish(null);
      if (
        error instanceof ApiError &&
        (error.status === 401 || error.status === 403)
      ) {
        return null;
      }
      throw error;
    }
  }).finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

export async function restoreSession() {
  return refreshSession();
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
  retry = true,
): Promise<T> {
  const active = session ?? (await refreshSession());
  if (!active) {
    throw new ApiError(
      "Your session has ended. Please sign in again.",
      "AUTHENTICATION_REQUIRED",
      401,
      [],
      undefined,
      "authentication",
    );
  }
  try {
    return await rawRequest<T>(path, init, active.accessToken);
  } catch (error) {
    if (retry && error instanceof ApiError && error.status === 401) {
      const refreshed = await refreshSession();
      if (refreshed) return rawRequest<T>(path, init, refreshed.accessToken);
      publish(null);
    }
    throw error;
  }
}

export async function apiFileRequest(path: string, init: RequestInit = {}) {
  const active = session ?? (await refreshSession());
  if (!active)
    throw new ApiError(
      "Your session has ended. Please sign in again.",
      "AUTHENTICATION_REQUIRED",
      401,
    );
  const request = async (token: string) => {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${token}`);
    headers.set("x-auth-client", AUTH_CLIENT);
    return fetch(`${API_BASE}${path}`, {
      ...init,
      headers,
      credentials: "include",
    });
  };
  let response = await request(active.accessToken);
  if (response.status === 401) {
    const refreshed = await refreshSession();
    if (refreshed) response = await request(refreshed.accessToken);
  }
  if (!response.ok)
    throw new ApiError(
      "The attachment could not be loaded.",
      "ATTACHMENT_ERROR",
      response.status,
    );
  return response;
}

export async function login(input: { email: string; password: string }) {
  const next = await rawRequest<AuthSession>("/auth/login", {
    method: "POST",
    body: JSON.stringify(input),
  });
  publish(next);
  return next;
}

export async function register(input: {
  email: string;
  password: string;
  fullName: string;
  preferredName?: string;
  phone?: string;
}) {
  const next = await rawRequest<AuthSession>("/auth/register", {
    method: "POST",
    body: JSON.stringify(input),
  });
  publish(next);
  return next;
}

export async function logout() {
  const active = session;
  try {
    if (active) {
      await rawRequest<{ message: string }>(
        "/auth/logout",
        { method: "POST" },
        active.accessToken,
      );
    }
  } finally {
    publish(null);
  }
}

export async function rejectCurrentSession() {
  await logout();
}

export function forgotPassword(email: string) {
  return rawRequest<{ message: string }>("/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export function resetPassword(token: string, newPassword: string) {
  return rawRequest<{ message: string }>("/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ token, newPassword }),
  }).finally(() => publish(null));
}

export const catalogueApi = {
  categories: () =>
    rawRequest<{ items: CatalogueCategory[]; total: number }>(
      "/catalogue/categories?pageSize=100",
    ),
  products: (parameters?: {
    page?: number;
    pageSize?: number;
    search?: string;
    categoryId?: string;
    classification?: CatalogueClassification;
    make?: string;
    model?: string;
    year?: number;
    signal?: AbortSignal;
  }) => {
    const query = new URLSearchParams({
      page: String(parameters?.page ?? 1),
      pageSize: String(parameters?.pageSize ?? 100),
    });
    if (parameters?.search) query.set("search", parameters.search);
    if (parameters?.categoryId) query.set("categoryId", parameters.categoryId);
    if (parameters?.classification)
      query.set("classification", parameters.classification);
    if (parameters?.make) query.set("make", parameters.make);
    if (parameters?.model) query.set("model", parameters.model);
    if (parameters?.year) query.set("year", String(parameters.year));
    return rawRequest<{
      items: CatalogueProduct[];
      page: number;
      pageSize: number;
      total: number;
    }>(`/catalogue/products?${query}`, { signal: parameters?.signal });
  },
  product: (id: string) =>
    rawRequest<CatalogueProduct>(`/catalogue/products/${id}`),
};

export const customerApi = {
  profile: () => apiRequest<CustomerProfileResponse>("/customers/me"),
  updateProfile: (input: {
    fullName?: string;
    preferredName?: string | null;
    companyName?: string | null;
  }) =>
    apiRequest<CustomerProfileResponse>("/customers/me", {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  addresses: () => apiRequest<CustomerAddress[]>("/customers/me/addresses"),
  createAddress: (
    input: Omit<CustomerAddress, "id" | "createdAt" | "updatedAt">,
  ) =>
    apiRequest<CustomerAddress>("/customers/me/addresses", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateAddress: (
    id: string,
    input: Partial<
      Omit<CustomerAddress, "id" | "isDefault" | "createdAt" | "updatedAt">
    >,
  ) =>
    apiRequest<CustomerAddress>(`/customers/me/addresses/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  setDefaultAddress: (id: string) =>
    apiRequest<CustomerAddress>(`/customers/me/addresses/${id}/default`, {
      method: "POST",
    }),
  deleteAddress: (id: string) =>
    apiRequest<{
      id: string;
      deleted: true;
      promotedDefaultAddressId: string | null;
    }>(`/customers/me/addresses/${id}`, { method: "DELETE" }),
  vehicles: () => apiRequest<CustomerVehicle[]>("/customers/me/vehicles"),
  createVehicle: (
    input: Omit<CustomerVehicle, "id" | "createdAt" | "updatedAt">,
  ) =>
    apiRequest<CustomerVehicle>("/customers/me/vehicles", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateVehicle: (
    id: string,
    input: Partial<Omit<CustomerVehicle, "id" | "createdAt" | "updatedAt">>,
  ) =>
    apiRequest<CustomerVehicle>(`/customers/me/vehicles/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  deleteVehicle: (id: string) =>
    apiRequest<{ id: string; deleted: true }>(`/customers/me/vehicles/${id}`, {
      method: "DELETE",
    }),
  requests: () =>
    apiRequest<{
      items: SourcingRequest[];
    }>("/customers/me/requests?pageSize=100"),
  request: (id: string) =>
    apiRequest<SourcingRequest>(`/customers/me/requests/${id}`),
  createRequest: (input: object) =>
    apiRequest<SourcingRequest>("/customers/me/requests", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  createPurchaseRequest: (input: {
    listingId: string;
    quantity: number;
    deliveryAddressId: string;
    customerNote?: string;
    idempotencyKey: string;
  }) =>
    apiRequest<SourcingRequest>("/customers/me/purchase-requests", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  uploadRequestPhoto: (requestId: string, requestItemId: string, file: File) =>
    apiRequest(
      `/customers/me/requests/${requestId}/attachments?requestItemId=${requestItemId}`,
      {
        method: "POST",
        headers: { "content-type": file.type, "x-file-name": file.name },
        body: file,
      },
    ),
  submitRequest: (requestId: string, idempotencyKey: string) =>
    apiRequest<SourcingRequest>(`/customers/me/requests/${requestId}/submit`, {
      method: "POST",
      body: JSON.stringify({ idempotencyKey }),
    }),
  cancelRequest: (requestId: string, reason?: string) =>
    apiRequest<SourcingRequest>(`/customers/me/requests/${requestId}/cancel`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),
  options: (requestId: string) =>
    apiRequest<{ items: CustomerSourcingOption[] }>(
      `/customers/me/requests/${requestId}/options?pageSize=100`,
    ),
  optionsBatch: (requestIds: string[]) =>
    apiRequest<{ items: CustomerSourcingOption[] }>(
      `/customers/me/options?requestIds=${encodeURIComponent(requestIds.join(","))}&pageSize=100`,
    ),
  acceptOption: (
    id: string,
    input: {
      idempotencyKey: string;
      expectedVersion: number;
      deliveryAddressId?: string;
      manualDelivery?: object;
    },
  ) =>
    apiRequest(`/customers/me/options/${id}/accept`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  rejectOption: (id: string, reason: string) =>
    apiRequest<CustomerSourcingOption>(`/customers/me/options/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),
  orders: () =>
    apiRequest<{ items: CustomerOrder[]; total: number }>(
      "/customers/me/orders?pageSize=100",
    ),
  order: (id: string) =>
    apiRequest<CustomerOrder>(`/customers/me/orders/${id}`),
  requestOrderCancellation: (id: string, reason: string) =>
    apiRequest(`/customers/me/orders/${id}/cancellations`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),
  requestOrderReturn: (id: string, reason: string) =>
    apiRequest(`/customers/me/orders/${id}/returns`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),
  invoices: () =>
    apiRequest<{ items: CustomerInvoice[]; total: number }>(
      "/customers/me/finance/invoices?pageSize=100",
    ),
  financialHistory: () =>
    apiRequest<{ items: CustomerFinancialEntry[]; total: number }>(
      "/customers/me/finance/history?pageSize=100",
    ),
  invoicePdf: (id: string) =>
    apiFileRequest(`/customers/me/finance/invoices/${id}/pdf`),
};

export type CommunicationConversation = {
  id: string;
  type: "REQUEST" | "QUOTATION" | "ORDER" | "SUPPORT" | "GENERAL";
  subject: string | null;
  reference: string | null;
  preview: string | null;
  unreadCount: number;
  lastMessageAt: string | null;
  createdAt: string;
};

export type CommunicationMessage = {
  id: string;
  senderType: "CUSTOMER" | "SUPPLIER" | "ADMIN" | "SYSTEM";
  mine: boolean;
  body: string;
  sentAt: string;
  attachments: Array<{
    id: string;
    fileName: string;
    mimeType: string;
    byteSize: number | null;
  }>;
};

export type InAppNotification = {
  id: string;
  title: string;
  body: string;
  entityType: string | null;
  entityId: string | null;
  isRead: boolean;
  createdAt: string;
};

export const communicationApi = {
  conversations: () =>
    apiRequest<{ items: CommunicationConversation[]; total: number }>(
      "/communications/conversations?pageSize=50",
    ),
  messages: (id: string, cursor?: string) =>
    apiRequest<{ items: CommunicationMessage[]; nextCursor: string | null }>(
      `/communications/conversations/${id}/messages?pageSize=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    ),
  ensureRequest: (requestId: string) =>
    apiRequest<CommunicationConversation>("/communications/conversations", {
      method: "POST",
      body: JSON.stringify({ requestId }),
    }),
  ensureOrder: (orderId: string) =>
    apiRequest<CommunicationConversation>("/communications/conversations", {
      method: "POST",
      body: JSON.stringify({ orderId }),
    }),
  send: (id: string, body: string, idempotencyKey: string) =>
    apiRequest<{ id: string }>(`/communications/conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ body, idempotencyKey }),
    }),
  read: (id: string, messageId?: string) =>
    apiRequest(`/communications/conversations/${id}/read`, {
      method: "POST",
      body: JSON.stringify({ messageId }),
    }),
  upload: (conversationId: string, messageId: string, file: File) =>
    apiFileRequest(
      `/communications/conversations/${conversationId}/messages/${messageId}/attachments`,
      {
        method: "POST",
        headers: {
          "content-type": file.type || "application/octet-stream",
          "x-file-name": file.name,
        },
        body: file,
      },
    ),
  attachment: (
    conversationId: string,
    messageId: string,
    attachmentId: string,
  ) =>
    apiFileRequest(
      `/communications/conversations/${conversationId}/messages/${messageId}/attachments/${attachmentId}`,
    ),
  notifications: () =>
    apiRequest<{
      items: InAppNotification[];
      unreadCount: number;
      total: number;
    }>("/communications/notifications?pageSize=10"),
  readNotification: (id: string) =>
    apiRequest(`/communications/notifications/${id}/read`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  readAllNotifications: () =>
    apiRequest("/communications/notifications/read-all", {
      method: "POST",
      body: JSON.stringify({}),
    }),
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "ACCOUNT_RESTRICTED")
      return "This account is suspended or disabled.";
    if (error.code === "FORBIDDEN")
      return "This account cannot access the customer portal.";
    return error.message;
  }
  return "Something went wrong. Please try again.";
}
