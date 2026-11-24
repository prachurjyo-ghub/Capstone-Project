"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  customerApi,
  catalogueApi,
  errorMessage,
  login,
  logout as apiLogout,
  register,
  rejectCurrentSession,
  restoreSession,
  subscribeToSession,
  type CustomerAddress,
  type CustomerOrder,
  type CustomerProfileResponse,
  type CustomerVehicle,
  type CustomerSourcingOption,
  type SourcingRequest,
  type CatalogueCategory,
  type CatalogueProduct,
  type CatalogueOffer,
} from "@/lib/api";
import { type RequestMode, type SavedRequest } from "@/lib/data";
import type {
  AuthInput,
  CustomerProfile,
  DashboardView,
  SavedVehicle,
  Theme,
} from "@/lib/customer";

export type DialogState =
  | {
      kind: "request";
      mode: RequestMode;
      part?: string;
      area?: string;
      fromBasket?: boolean;
    }
  | { kind: "detail"; productId: string }
  | { kind: "basket" }
  | { kind: "requests" }
  | { kind: "auth"; mode: "signin" | "create" }
  | { kind: "info"; topic: "contact" | "coverage" | "terms" | "credits" }
  | { kind: "success"; request: SavedRequest };

export type RequestPartDraft = {
  description: string;
  quantity: number;
  photos: File[];
};

export type RequestPayload = {
  parts: RequestPartDraft[];
  vehicle: string;
  vehicleId?: string;
  year: string;
  chassis: string;
  area: string;
  deliveryAddressId?: string;
  phone: string;
  urgency: string;
  notes: string;
  business?: string;
  mode: RequestMode;
};
export type VehiclePayload = Omit<
  CustomerVehicle,
  "id" | "createdAt" | "updatedAt"
>;
export type AddressPayload = Omit<
  CustomerAddress,
  "id" | "createdAt" | "updatedAt"
>;
type PendingAction =
  | {
      kind: "save";
      request: RequestPayload;
      clearBasket: boolean;
    }
  | { kind: "track"; reference: string }
  | { kind: "dashboard"; view: DashboardView }
  | { kind: "catalogue" };

type SiteContextValue = {
  ready: boolean;
  sessionNotice: string;
  dialog: DialogState | null;
  setDialog: (value: DialogState | null) => void;
  theme: Theme;
  toggleTheme: () => void;
  customer: CustomerProfile | null;
  authenticate: (input: AuthInput) => Promise<string | null>;
  openLogin: (mode?: "signin" | "create", stayOnPage?: boolean) => void;
  logout: () => Promise<void>;
  updateProfile: (input: {
    fullName: string;
    preferredName: string | null;
    companyName: string | null;
  }) => Promise<string | null>;
  addresses: CustomerAddress[];
  saveAddress: (input: AddressPayload, id?: string) => Promise<string | null>;
  removeAddress: (id: string) => Promise<string | null>;
  setDefaultAddress: (id: string) => Promise<string | null>;
  openDashboard: (view?: DashboardView) => void;
  dashboardView: DashboardView;
  setDashboardView: (view: DashboardView) => void;
  categories: CatalogueCategory[];
  catalogueProducts: CatalogueProduct[];
  catalogueLoading: boolean;
  catalogueError: string;
  reloadCatalogue: () => Promise<void>;
  basket: string[];
  addPart: (id: string) => void;
  removePart: (id: string) => void;
  requests: SavedRequest[];
  saveRequest: (
    request: RequestPayload,
    clearBasket: boolean,
  ) => Promise<string | null>;
  submitFixedPurchase: (
    offer: CatalogueOffer,
    quantity: number,
    deliveryAddressId: string,
    note?: string,
  ) => Promise<string | null>;
  submitUsedRfq: (
    product: CatalogueProduct,
    offer: CatalogueOffer,
    quantity: number,
    vehicleId: string,
    deliveryAddressId: string,
    note?: string,
  ) => Promise<string | null>;
  cancelSourcingRequest: (
    requestId: string,
    reason?: string,
  ) => Promise<string | null>;
  sourcingOptions: CustomerSourcingOption[];
  acceptSourcingOption: (
    option: CustomerSourcingOption,
  ) => Promise<string | null>;
  orders: CustomerOrder[];
  requestOrderCancellation: (
    orderId: string,
    reason: string,
  ) => Promise<string | null>;
  requestOrderReturn: (
    orderId: string,
    reason: string,
  ) => Promise<string | null>;
  vehicles: SavedVehicle[];
  saveVehicle: (vehicle: VehiclePayload, id?: string) => Promise<string | null>;
  removeVehicle: (id: string) => Promise<string | null>;
  requestTracking: (reference: string) => void;
  trackingReference: string;
  toast: string;
  showToast: (message: string) => void;
};

const SiteContext = createContext<SiteContextValue | null>(null);

function readArray<T>(key: string): T[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(value) ? (value as T[]) : [];
  } catch {
    return [];
  }
}

function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // The current visit remains usable when storage is blocked.
  }
}

function toCustomer(profile: CustomerProfileResponse): CustomerProfile {
  return {
    id: profile.id,
    email: profile.email,
    name: profile.profile.fullName,
    phone: profile.phone,
    preferredName: profile.profile.preferredName,
    companyName: profile.profile.companyName,
    accountStatus: profile.accountStatus as CustomerProfile["accountStatus"],
    emailVerified: profile.emailVerified,
  };
}

function mapRequest(request: SourcingRequest): SavedRequest {
  return {
    id: request.id,
    reference: request.requestNumber,
    requestType: request.requestType,
    creditStatus: request.creditStatus,
    supplierName: request.targetBusiness?.displayName,
    listingClassification: request.listing?.listingClassification,
    part: request.items.map((item) => item.description).join("\n"),
    vehicle: request.vehicleSnapshot
      ? `${request.vehicleSnapshot.make} ${request.vehicleSnapshot.model}`.trim()
      : "Not recorded",
    year: request.vehicleSnapshot?.year
      ? String(request.vehicleSnapshot.year)
      : (request.vehicleSnapshot?.variant ?? ""),
    chassis: "",
    area: request.deliverySnapshot
      ? [request.deliverySnapshot.area, request.deliverySnapshot.city]
          .filter(Boolean)
          .join(", ")
      : "Not recorded",
    phone: "",
    urgency:
      request.urgency === "URGENT" ? "Urgent sourcing" : "Standard sourcing",
    quantity: request.items.reduce((sum, item) => sum + item.quantity, 0),
    notes: request.customerNotes ?? "",
    mode: request.urgency === "URGENT" ? "urgent" : "standard",
    ownerEmail: "",
    createdAt: request.createdAt,
    status: request.status,
  };
}

function requestFingerprint(request: RequestPayload) {
  return JSON.stringify({
    ...request,
    parts: request.parts.map((part) => ({
      description: part.description,
      quantity: part.quantity,
      photos: part.photos.map((photo) => ({
        name: photo.name,
        size: photo.size,
        type: photo.type,
        lastModified: photo.lastModified,
      })),
    })),
  });
}

export function SiteProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [dialog, setInternalDialog] = useState<DialogState | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [theme, setTheme] = useState<Theme>("light");
  const [customer, setCustomer] = useState<CustomerProfile | null>(null);
  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const [vehicles, setVehicles] = useState<SavedVehicle[]>([]);
  const [categories, setCategories] = useState<CatalogueCategory[]>([]);
  const [catalogueProducts, setCatalogueProducts] = useState<
    CatalogueProduct[]
  >([]);
  const [catalogueLoading, setCatalogueLoading] = useState(true);
  const [catalogueError, setCatalogueError] = useState("");
  const [basket, setBasket] = useState<string[]>([]);
  const [allRequests, setAllRequests] = useState<SavedRequest[]>([]);
  const [sourcingOptions, setSourcingOptions] = useState<
    CustomerSourcingOption[]
  >([]);
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [trackingReference, setTrackingReference] = useState("");
  const [dashboardView, setDashboardView] = useState<DashboardView>("overview");
  const [toast, setToast] = useState("");
  const [ready, setReady] = useState(false);
  const [sessionNotice, setSessionNotice] = useState("");
  const retryDraftRef = useRef<{
    fingerprint: string;
    request: SourcingRequest;
    uploadedPhotos: Set<string>;
    submitKey: string;
  } | null>(null);

  async function reloadCatalogue() {
    setCatalogueLoading(true);
    setCatalogueError("");
    try {
      const [categoryPage, productPage] = await Promise.all([
        catalogueApi.categories(),
        catalogueApi.products(),
      ]);
      setCategories(categoryPage.items);
      setCatalogueProducts(productPage.items);
      setBasket((current) =>
        current.filter((id) =>
          productPage.items.some((product) => product.id === id),
        ),
      );
    } catch (error) {
      setCategories([]);
      setCatalogueProducts([]);
      setCatalogueError(errorMessage(error));
    } finally {
      setCatalogueLoading(false);
    }
  }

  async function loadPrivateData() {
    const [profile, nextAddresses, nextVehicles, requestPage, orderPage] =
      await Promise.all([
        customerApi.profile(),
        customerApi.addresses(),
        customerApi.vehicles(),
        customerApi.requests(),
        customerApi.orders(),
      ]);
    setCustomer(toCustomer(profile));
    setAddresses(nextAddresses);
    setVehicles(nextVehicles);
    const requestDetails = requestPage.items;
    const mapped = requestDetails.map(mapRequest);
    setAllRequests(mapped);
    const optionPage = requestDetails.length
      ? await customerApi.optionsBatch(requestDetails.map((item) => item.id))
      : { items: [] };
    setSourcingOptions(optionPage.items);
    setOrders(orderPage.items);
    return {
      customer: toCustomer(profile),
      addresses: nextAddresses,
      vehicles: nextVehicles,
    };
  }

  function clearPrivateData() {
    setCustomer(null);
    setAddresses([]);
    setVehicles([]);
    setAllRequests([]);
    setSourcingOptions([]);
    setOrders([]);
    setPending(null);
    retryDraftRef.current = null;
  }

  useEffect(() => {
    let cancelled = false;
    let savedTheme: string | null = null;
    try {
      savedTheme = localStorage.getItem("partarc-theme");
      localStorage.removeItem("partarc-vehicles");
    } catch {
      // Session restoration does not depend on local storage.
    }
    // Hydrate browser-only preferences after the client has mounted.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(
      savedTheme === "dark" || savedTheme === '"dark"' ? "dark" : "light",
    );
    setBasket(readArray<string>("partarc-parts-basket"));
    setAllRequests([]);
    void reloadCatalogue();

    const unsubscribe = subscribeToSession((value) => {
      if (!value) {
        clearPrivateData();
        return;
      }
      if (value.account.role === "CUSTOMER") {
        void loadPrivateData().catch(() => clearPrivateData());
      }
    });

    void (async () => {
      try {
        const restored = await restoreSession();
        if (!restored) return;
        if (restored.account.role !== "CUSTOMER") {
          await rejectCurrentSession();
          if (!cancelled)
            setSessionNotice("Please use a customer account for this portal.");
          return;
        }
        await loadPrivateData();
      } catch (error) {
        if (!cancelled) setSessionNotice(errorMessage(error));
      } finally {
        if (!cancelled) setReady(true);
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("partarc-theme", theme);
    } catch {
      // Theme still works for this visit.
    }
  }, [theme, ready]);
  useEffect(() => {
    if (ready) store("partarc-parts-basket", basket);
  }, [basket, ready]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const requests = customer ? allRequests : [];

  function setDialog(value: DialogState | null) {
    if (value === null && dialog?.kind === "auth") setPending(null);
    setInternalDialog(value);
  }
  function toggleTheme() {
    setTheme((value) => (value === "light" ? "dark" : "light"));
  }
  function showToast(message: string) {
    setToast(message);
  }
  function openLogin(mode: "signin" | "create" = "signin", stayOnPage = false) {
    setPending(stayOnPage ? { kind: "catalogue" } : null);
    setSessionNotice("");
    setInternalDialog({ kind: "auth", mode });
  }
  function addPart(id: string) {
    setBasket((current) => (current.includes(id) ? current : [...current, id]));
    showToast("Added to your multi-part sourcing request.");
  }
  function removePart(id: string) {
    setBasket((current) => current.filter((item) => item !== id));
  }

  async function persistRequest(
    request: RequestPayload,
    clearBasket: boolean,
    owner: CustomerProfile,
    availableAddresses: CustomerAddress[],
    availableVehicles: SavedVehicle[],
  ) {
    try {
      const fingerprint = requestFingerprint(request);
      const selectedVehicle = availableVehicles.find(
        (item) =>
          item.id === request.vehicleId ||
          `${item.make} ${item.model}` === request.vehicle,
      );
      const selectedAddress = availableAddresses.find(
        (item) => item.id === request.deliveryAddressId,
      );
      const vehicleParts = request.vehicle.trim().split(/\s+/);
      const deliveryParts = request.area
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      const parsedYear = request.year.match(/\b(19|20)\d{2}\b/)?.[0];
      let retry = retryDraftRef.current;
      if (!retry || retry.fingerprint !== fingerprint) {
        const created = await customerApi.createRequest({
          title:
            request.parts.find((part) => part.description.trim())?.description ??
            "Photo identification request",
          customerNotes:
            [request.business ? `Business / fleet: ${request.business}` : "", request.notes]
              .filter(Boolean)
              .join("\n") || null,
          urgency: request.urgency.toLowerCase().includes("urgent")
            ? "URGENT"
            : "STANDARD",
          ...(selectedVehicle
            ? { vehicleId: selectedVehicle.id }
            : {
                manualVehicle: {
                  make: vehicleParts[0] ?? "",
                  model: vehicleParts.slice(1).join(" ") || request.vehicle,
                  year: parsedYear ? Number(parsedYear) : null,
                  variant: request.year || null,
                  chassisVin: request.chassis || null,
                },
              }),
          ...(selectedAddress
            ? { deliveryAddressId: selectedAddress.id }
            : {
                manualDelivery: {
                  recipientName: owner.name,
                  phone: request.phone,
                  addressLine: request.area,
                  area: deliveryParts[0] ?? request.area,
                  city: deliveryParts.at(-1) ?? request.area,
                },
              }),
          items: request.parts.map((part) => ({
            description: part.description.trim(),
            quantity: part.quantity,
            customerNotes: request.notes || null,
          })),
        });
        retry = {
          fingerprint,
          request: created,
          uploadedPhotos: new Set(),
          submitKey: crypto.randomUUID(),
        };
        retryDraftRef.current = retry;
      }
      const created = retry.request;
      for (const [partIndex, part] of request.parts.entries()) {
        const item = created.items[partIndex];
        if (!item) throw new Error("The request item could not be created");
        for (const [photoIndex, photo] of part.photos.entries()) {
          const uploadKey = `${partIndex}:${photoIndex}`;
          if (retry.uploadedPhotos.has(uploadKey)) continue;
          await customerApi.uploadRequestPhoto(created.id, item.id, photo);
          retry.uploadedPhotos.add(uploadKey);
        }
      }
      const submitted = await customerApi.submitRequest(
        created.id,
        retry.submitKey,
      );
      retryDraftRef.current = null;
      setAllRequests((current) => [mapRequest(submitted), ...current]);
      if (clearBasket) setBasket([]);
      setInternalDialog({ kind: "success", request: mapRequest(submitted) });
      showToast("Request submitted to PartsArc operations.");
      return null;
    } catch (error) {
      return errorMessage(error);
    }
  }

  async function saveRequest(
    request: RequestPayload,
    clearBasket: boolean,
  ) {
    if (!customer) {
      setPending({ kind: "save", request, clearBasket });
      setInternalDialog({ kind: "auth", mode: "signin" });
      return null;
    }
    return persistRequest(
      request,
      clearBasket,
      customer,
      addresses,
      vehicles,
    );
  }

  async function submitFixedPurchase(
    offer: CatalogueOffer,
    quantity: number,
    deliveryAddressId: string,
    note?: string,
  ) {
    if (!customer) {
      openLogin("signin", true);
      return "Sign in to submit this purchase request.";
    }
    try {
      const created = await customerApi.createPurchaseRequest({
        listingId: offer.id,
        quantity,
        deliveryAddressId,
        customerNote: note?.trim() || undefined,
        idempotencyKey: crypto.randomUUID(),
      });
      await loadPrivateData();
      showToast(`Purchase request ${created.requestNumber} submitted.`);
      return null;
    } catch (error) {
      return errorMessage(error);
    }
  }

  async function submitUsedRfq(
    product: CatalogueProduct,
    offer: CatalogueOffer,
    quantity: number,
    vehicleId: string,
    deliveryAddressId: string,
    note?: string,
  ) {
    if (!customer) {
      openLogin("signin", true);
      return "Sign in to request a used-part quotation.";
    }
    try {
      const created = await customerApi.createRequest({
        requestType: "USED_PART_RFQ",
        listingId: offer.id,
        title: `Used-part quote: ${product.name}`,
        customerNotes: note?.trim() || null,
        urgency: "STANDARD",
        vehicleId,
        deliveryAddressId,
        items: [
          {
            description: product.name,
            partNumber:
              product.numbers.find((item) => item.isPrimary)?.partNumber ??
              null,
            productId: product.id,
            categoryId: product.category.id,
            quantity,
            customerNotes: note?.trim() || null,
          },
        ],
      });
      const submitted = await customerApi.submitRequest(
        created.id,
        crypto.randomUUID(),
      );
      await loadPrivateData();
      showToast(`Quote request ${submitted.requestNumber} submitted.`);
      return null;
    } catch (error) {
      return errorMessage(error);
    }
  }

  async function cancelSourcingRequest(requestId: string, reason?: string) {
    try {
      await customerApi.cancelRequest(requestId, reason);
      await loadPrivateData();
      showToast("Request cancelled.");
      return null;
    } catch (error) {
      return errorMessage(error);
    }
  }

  async function acceptSourcingOption(option: CustomerSourcingOption) {
    const address = addresses.find((item) => item.isDefault) ?? addresses[0];
    if (!address) return "Add a delivery address before accepting an option.";
    try {
      await customerApi.acceptOption(option.id, {
        idempotencyKey: crypto.randomUUID(),
        expectedVersion: option.version,
        deliveryAddressId: address.id,
      });
      await loadPrivateData();
      showToast("Option accepted. Stock and dispatch are not yet confirmed.");
      return null;
    } catch (error) {
      return errorMessage(error);
    }
  }

  async function requestOrderCancellation(orderId: string, reason: string) {
    try {
      await customerApi.requestOrderCancellation(orderId, reason);
      const updated = await customerApi.order(orderId);
      setOrders((current) =>
        current.map((item) => (item.id === orderId ? updated : item)),
      );
      showToast("Cancellation request sent to PartsArc operations.");
      return null;
    } catch (error) {
      return errorMessage(error);
    }
  }

  async function requestOrderReturn(orderId: string, reason: string) {
    try {
      await customerApi.requestOrderReturn(orderId, reason);
      const updated = await customerApi.order(orderId);
      setOrders((current) =>
        current.map((item) => (item.id === orderId ? updated : item)),
      );
      showToast("Return request sent to PartsArc operations.");
      return null;
    } catch (error) {
      return errorMessage(error);
    }
  }

  function openDashboard(view: DashboardView = "overview") {
    setDashboardView(view);
    if (!customer) {
      setPending({ kind: "dashboard", view });
      setInternalDialog({ kind: "auth", mode: "signin" });
      return;
    }
    setInternalDialog(null);
    router.push("/dashboard");
  }

  function requestTracking(reference: string) {
    const cleaned = reference.trim().toUpperCase();
    if (!customer) {
      setPending({ kind: "track", reference: cleaned });
      setInternalDialog({ kind: "auth", mode: "signin" });
      return;
    }
    setTrackingReference(cleaned);
    router.push("/track");
  }

  async function authenticate(input: AuthInput): Promise<string | null> {
    try {
      const authenticated =
        input.mode === "signin"
          ? await login({ email: input.email, password: input.password })
          : await register({
              email: input.email,
              password: input.password,
              fullName: input.name ?? "",
              preferredName: input.preferredName || undefined,
              phone: input.phone || undefined,
            });
      if (authenticated.account.role !== "CUSTOMER") {
        await rejectCurrentSession();
        return "This account belongs in another PartsArc portal.";
      }
      const privateData = await loadPrivateData();
      const action = pending;
      setPending(null);
      setSessionNotice("");
      if (action?.kind === "save") {
        const requestError = await persistRequest(
          action.request,
          action.clearBasket,
          privateData.customer,
          privateData.addresses,
          privateData.vehicles,
        );
        if (requestError) return requestError;
      } else if (action?.kind === "track") {
        setTrackingReference(action.reference);
        setInternalDialog(null);
        router.push("/track");
      } else if (action?.kind === "catalogue") {
        setInternalDialog(null);
      } else {
        if (action?.kind === "dashboard") setDashboardView(action.view);
        setInternalDialog(null);
        router.push("/dashboard");
      }
      showToast(
        input.mode === "create" ? "Account created." : "Signed in securely.",
      );
      return null;
    } catch (error) {
      return errorMessage(error);
    }
  }

  async function logout() {
    try {
      await apiLogout();
    } finally {
      clearPrivateData();
      setInternalDialog(null);
      router.push("/");
      showToast("Signed out.");
    }
  }

  async function updateProfile(input: {
    fullName: string;
    preferredName: string | null;
    companyName: string | null;
  }) {
    try {
      const updated = await customerApi.updateProfile(input);
      setCustomer(toCustomer(updated));
      showToast("Profile saved.");
      return null;
    } catch (error) {
      return errorMessage(error);
    }
  }

  async function saveAddress(input: AddressPayload, id?: string) {
    try {
      if (id) {
        const editable = Object.fromEntries(
          Object.entries(input).filter(([key]) => key !== "isDefault"),
        ) as Omit<AddressPayload, "isDefault">;
        await customerApi.updateAddress(id, editable);
      } else {
        await customerApi.createAddress(input);
      }
      setAddresses(await customerApi.addresses());
      showToast(id ? "Address updated." : "Address added.");
      return null;
    } catch (error) {
      return errorMessage(error);
    }
  }

  async function removeAddress(id: string) {
    try {
      await customerApi.deleteAddress(id);
      setAddresses(await customerApi.addresses());
      showToast("Address removed.");
      return null;
    } catch (error) {
      return errorMessage(error);
    }
  }

  async function setDefaultAddress(id: string) {
    try {
      await customerApi.setDefaultAddress(id);
      setAddresses(await customerApi.addresses());
      showToast("Default delivery address updated.");
      return null;
    } catch (error) {
      return errorMessage(error);
    }
  }

  async function saveVehicle(vehicle: VehiclePayload, id?: string) {
    try {
      await (id
        ? customerApi.updateVehicle(id, vehicle)
        : customerApi.createVehicle(vehicle));
      setVehicles(await customerApi.vehicles());
      showToast(id ? "Vehicle updated." : "Vehicle added.");
      return null;
    } catch (error) {
      return errorMessage(error);
    }
  }

  async function removeVehicle(id: string) {
    try {
      await customerApi.deleteVehicle(id);
      setVehicles(await customerApi.vehicles());
      showToast("Vehicle removed.");
      return null;
    } catch (error) {
      return errorMessage(error);
    }
  }

  return (
    <SiteContext.Provider
      value={{
        ready,
        sessionNotice,
        dialog,
        setDialog,
        theme,
        toggleTheme,
        customer,
        authenticate,
        openLogin,
        logout,
        updateProfile,
        addresses,
        saveAddress,
        removeAddress,
        setDefaultAddress,
        categories,
        catalogueProducts,
        catalogueLoading,
        catalogueError,
        reloadCatalogue,
        openDashboard,
        dashboardView,
        setDashboardView,
        basket,
        addPart,
        removePart,
        requests,
        saveRequest,
        submitFixedPurchase,
        submitUsedRfq,
        cancelSourcingRequest,
        sourcingOptions,
        acceptSourcingOption,
        orders,
        requestOrderCancellation,
        requestOrderReturn,
        vehicles,
        saveVehicle,
        removeVehicle,
        requestTracking,
        trackingReference,
        toast,
        showToast,
      }}
    >
      {children}
    </SiteContext.Provider>
  );
}

export function useSite() {
  const value = useContext(SiteContext);
  if (!value) throw new Error("useSite requires SiteProvider");
  return value;
}
