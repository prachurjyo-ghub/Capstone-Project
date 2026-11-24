"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  FiArrowRight,
  FiClipboard,
  FiCreditCard,
  FiDownload,
  FiFileText,
  FiGrid,
  FiLayers,
  FiMapPin,
  FiMessageCircle,
  FiPaperclip,
  FiSend,
  FiShield,
  FiTool,
  FiTruck,
  FiUser,
} from "react-icons/fi";
import {
  type CustomerProfile,
  type DashboardView,
  type SavedVehicle,
} from "@/lib/customer";
import { useSite } from "./site-context";
import { ActionButton, Kicker } from "./ui";
import { PageSkeleton } from "./page-skeleton";
import {
  communicationApi,
  customerApi,
  errorMessage,
  type CommunicationConversation,
  type CommunicationMessage,
  type CustomerFinancialEntry,
  type CustomerInvoice,
} from "@/lib/api";

const nav: { id: DashboardView; label: string; icon: typeof FiGrid }[] = [
  { id: "overview", label: "Overview", icon: FiGrid },
  { id: "requests", label: "My Requests", icon: FiClipboard },
  { id: "quotes", label: "Quotations", icon: FiFileText },
  { id: "tracking", label: "My Orders", icon: FiTruck },
  { id: "messages", label: "Messages", icon: FiMessageCircle },
  { id: "finance", label: "Invoices & payments", icon: FiCreditCard },
  { id: "addresses", label: "Addresses", icon: FiMapPin },
  { id: "vehicles", label: "My Vehicles", icon: FiTool },
  { id: "profile", label: "Profile", icon: FiUser },
  { id: "garage", label: "Garage list", icon: FiLayers },
];

function PanelHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="mb-6">
      <Kicker>{eyebrow}</Kicker>
      <h2 className="mt-2 font-heading text-[clamp(26px,3vw,36px)] font-extrabold leading-tight tracking-[-.04em]">
        {title}
      </h2>
      <p className="mt-2 max-w-[700px] text-sm leading-relaxed text-[var(--muted)]">
        {description}
      </p>
    </div>
  );
}

function EmptyCard({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: typeof FiGrid;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="dash-card flex flex-col items-start p-7">
      <span className="grid size-11 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
        <Icon size={21} aria-hidden="true" />
      </span>
      <h3 className="mt-5 font-heading text-lg font-extrabold">{title}</h3>
      <p className="mt-2 max-w-lg text-sm leading-relaxed text-[var(--muted)]">
        {description}
      </p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

function Overview() {
  const { requests, sourcingOptions, setDialog, setDashboardView, customer } =
    useSite();
  const count = requests.length;
  const recent = requests.slice(0, 3);
  return (
    <section aria-labelledby="dashboard-overview">
      <PanelHeader
        eyebrow="YOUR WORKSPACE"
        title="The whole request journey, in view."
        description="Your profile, vehicles, sourcing requests, and published options are connected to PartsArc."
      />
      <div className="grid gap-4 md:grid-cols-3">
        {[
          {
            label: "Active requests",
            value: count,
            note: "Persisted securely",
            icon: FiClipboard,
          },
          {
            label: "Quotations to review",
            value: sourcingOptions.length,
            note: "Published by operations",
            icon: FiFileText,
          },
          {
            label: "Current deliveries",
            value: 0,
            note: "No live fulfillment data yet",
            icon: FiTruck,
          },
        ].map((item) => (
          <div key={item.label} className="dash-card p-5">
            <div className="flex items-start justify-between">
              <span className="text-sm font-bold text-[var(--muted)]">
                {item.label}
              </span>
              <item.icon
                size={20}
                className="text-[var(--accent)]"
                aria-hidden="true"
              />
            </div>
            <strong className="mt-5 block font-heading text-[36px] font-extrabold leading-none">
              {item.value}
            </strong>
            <small className="mt-2 block text-xs text-[var(--muted)]">
              {item.note}
            </small>
          </div>
        ))}
      </div>
      <div className="mt-6 grid gap-5 lg:grid-cols-[1.25fr_.75fr]">
        <div className="dash-card p-6">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-heading text-lg font-extrabold">
              Recent requests
            </h3>
            <button
              className="inline-link text-xs"
              onClick={() => setDashboardView("requests")}
            >
              View all <FiArrowRight />
            </button>
          </div>
          {recent.length ? (
            <div className="mt-4 divide-y divide-[var(--line)]">
              {recent.map((item) => (
                <div
                  className="flex flex-wrap items-center justify-between gap-3 py-4"
                  key={item.reference}
                >
                  <div>
                    <b className="block text-sm">{item.part}</b>
                    <small className="mt-1 block text-xs text-[var(--muted)]">
                      {item.reference} · {item.vehicle}
                    </small>
                  </div>
                  <span className="status-pill">{item.status}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-5 rounded-xl bg-[var(--surface-soft)] p-5">
              <b className="text-sm">No requests saved yet.</b>
              <p className="mt-2 text-sm text-[var(--muted)]">
                Start with a part name, a photo, or the problem your mechanic
                described.
              </p>
              <ActionButton
                className="mt-4"
                onClick={() => setDialog({ kind: "request", mode: "standard" })}
              >
                Start your first request
              </ActionButton>
            </div>
          )}
        </div>
        <div className="dash-card overflow-hidden">
          <div
            className="h-28 bg-[#0b1b2f] bg-[url('/assets/workshop-poster.webp')] bg-cover bg-center"
            role="img"
            aria-label="Mechanic working on a vehicle"
          />
          <div className="p-6">
            <Kicker>HOW IT WORKS</Kicker>
            <h3 className="mt-2 font-heading text-lg font-extrabold">
              Send once. Compare clearly.
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
              PartArc coordinates suppliers and presents compatible options with
              price and delivery together after operations review.
            </p>
            <button
              className="inline-link mt-3 text-xs"
              onClick={() => setDashboardView("quotes")}
            >
              Review sourcing options <FiArrowRight />
            </button>
          </div>
        </div>
      </div>
      <p className="mt-5 flex items-start gap-2 text-xs text-[var(--muted)]">
        <FiShield className="mt-0.5 shrink-0 text-[var(--accent)]" />
        Authenticated as {customer?.email}. Supplier cost and identity remain
        private.
      </p>
    </section>
  );
}

function RequestsView() {
  const {
    requests,
    setDialog,
    setDashboardView,
    cancelSourcingRequest,
    showToast,
  } = useSite();
  const [cancelling, setCancelling] = useState<string | null>(null);
  return (
    <section>
      <PanelHeader
        eyebrow="MY REQUESTS"
        title="Every requirement in one place."
        description="Submitted sourcing requests persist securely and update as operations reviews them."
      />
      <div className="mb-5 flex flex-wrap gap-3">
        <ActionButton
          onClick={() => setDialog({ kind: "request", mode: "standard" })}
        >
          Start a new request
        </ActionButton>
        <button
          className="secondary-button"
          onClick={() => setDashboardView("garage")}
        >
          Create a garage list
        </button>
      </div>
      {requests.length ? (
        <div className="space-y-3">
          {requests.map((item) => (
            <details
              key={item.reference}
              className="dash-card group overflow-hidden"
            >
              <summary className="flex min-h-20 list-none flex-wrap items-center justify-between gap-3 p-5 marker:hidden">
                <div className="min-w-0">
                  <b className="block truncate font-heading text-base">
                    {item.part.split("\n")[0]}
                  </b>
                  <small className="mt-1 block text-xs text-[var(--muted)]">
                    {item.reference} ·{" "}
                    {item.requestType === "FIXED_PRICE_PURCHASE"
                      ? "Fixed-price purchase"
                      : item.requestType === "USED_PART_RFQ"
                        ? "Used-part quotation"
                        : "Custom sourcing"}
                    {item.supplierName ? ` · ${item.supplierName}` : ""}
                  </small>
                </div>
                <span className="status-pill">{item.status}</span>
              </summary>
              <div className="grid gap-4 border-t border-[var(--line)] px-5 py-5 text-sm sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <small className="block text-[var(--muted)]">
                    Requested part{item.part.includes("\n") ? "s" : ""}
                  </small>
                  <p className="whitespace-pre-line font-semibold">
                    {item.part}
                  </p>
                </div>
                <div>
                  <small className="block text-[var(--muted)]">Vehicle</small>
                  <b>
                    {item.vehicle}
                    {item.year ? ` · ${item.year}` : ""}
                  </b>
                </div>
                {item.listingClassification && (
                  <div>
                    <small className="block text-[var(--muted)]">
                      Offer type
                    </small>
                    <b>{item.listingClassification.replaceAll("_", " ")}</b>
                  </div>
                )}
                <div>
                  <small className="block text-[var(--muted)]">
                    Delivery area
                  </small>
                  <b>{item.area}</b>
                </div>
                <div>
                  <small className="block text-[var(--muted)]">
                    Quantity and urgency
                  </small>
                  <b>
                    {item.quantity} · {item.urgency}
                  </b>
                </div>
                <div>
                  <small className="block text-[var(--muted)]">Created</small>
                  <b>
                    {item.createdAt
                      ? new Date(item.createdAt).toLocaleDateString("en-BD")
                      : "Unavailable"}
                  </b>
                </div>
                {item.notes && (
                  <div className="sm:col-span-2">
                    <small className="block text-[var(--muted)]">Notes</small>
                    <p className="whitespace-pre-wrap">{item.notes}</p>
                  </div>
                )}
                <div className="sm:col-span-2">
                  <div className="flex flex-wrap gap-3">
                    <button
                      className="inline-link text-xs"
                      onClick={() =>
                        setDashboardView(
                          ["AWAITING_CUSTOMER", "QUOTING"].includes(item.status)
                            ? "quotes"
                            : "tracking",
                        )
                      }
                    >
                      {item.status === "ORDERED"
                        ? "View order"
                        : "View current progress"}{" "}
                      <FiArrowRight />
                    </button>
                    {[
                      "DRAFT",
                      "SUBMITTED",
                      "MATCHING",
                      "QUOTING",
                      "AWAITING_CUSTOMER",
                    ].includes(item.status) && (
                      <button
                        className="text-xs font-bold text-red-700 underline"
                        disabled={cancelling === item.id}
                        onClick={async () => {
                          setCancelling(item.id);
                          const failure = await cancelSourcingRequest(
                            item.id,
                            "Cancelled by customer",
                          );
                          setCancelling(null);
                          if (failure) showToast(failure);
                        }}
                      >
                        {cancelling === item.id
                          ? "Cancelling…"
                          : "Cancel request"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </details>
          ))}
        </div>
      ) : (
        <EmptyCard
          icon={FiClipboard}
          title="No saved requests yet."
          description="Your request list will appear here after you complete a form and sign in."
          action={
            <ActionButton
              onClick={() => setDialog({ kind: "request", mode: "standard" })}
            >
              Tell us what you need
            </ActionButton>
          }
        />
      )}
    </section>
  );
}

function QuotesView() {
  const { sourcingOptions, acceptSourcingOption, addresses, showToast } =
    useSite();
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <section>
      <PanelHeader
        eyebrow="QUOTATIONS"
        title="Price and delivery, side by side."
        description="Compare published supplier options by price, condition, fitment notes, and delivery estimate. Internal supplier pricing remains private."
      />
      <div className="grid gap-5 lg:grid-cols-2">
        {sourcingOptions.map((option) => (
          <article key={option.id} className="dash-card flex flex-col p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <Kicker>{option.optionNumber}</Kicker>
                <p className="mt-2 text-xs font-bold text-[var(--accent)]">
                  {option.supplier.displayName}
                </p>
                <h3 className="mt-2 font-heading text-xl font-extrabold">
                  {option.lines
                    .map((line) => line.brand || line.description)
                    .join(" + ")}
                </h3>
              </div>
              <span className="status-pill">{option.status}</span>
            </div>
            <p className="mt-3 text-sm text-[var(--muted)]">
              {option.lines
                .map((line) => `${line.quantity}× ${line.description}`)
                .join(", ")}
            </p>
            <div className="mt-5 rounded-xl bg-[var(--surface-soft)] p-4">
              <span className="text-xs font-bold text-[var(--muted)]">
                COMPATIBILITY REVIEW
              </span>
              <p className="mt-1 text-sm">
                {option.compatibilityNotes ||
                  "Compatibility requires confirmation before installation."}
              </p>
            </div>
            <dl className="mt-5 divide-y divide-[var(--line)] border-y border-[var(--line)] text-sm">
              <div className="flex justify-between gap-3 py-3">
                <dt className="text-[var(--muted)]">Parts</dt>
                <dd className="font-bold">৳{option.customerItemsTotal}</dd>
              </div>
              <div className="flex justify-between gap-3 py-3">
                <dt className="text-[var(--muted)]">Delivery charge</dt>
                <dd className="font-bold">৳{option.deliveryCharge}</dd>
              </div>
              <div className="flex justify-between gap-3 py-3">
                <dt className="font-bold">Customer total</dt>
                <dd className="font-heading text-lg font-extrabold">
                  ৳{option.customerTotal}
                </dd>
              </div>
            </dl>
            <p className="mt-4 flex items-center gap-2 text-sm font-bold">
              <FiTruck className="text-[var(--accent)]" />
              {option.deliveryEstimateText ||
                "Delivery estimate pending operations review"}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">
              Valid until {new Date(option.validUntil).toLocaleString("en-BD")}.
              Acceptance does not reserve stock or confirm dispatch.
            </p>
            <button
              className="secondary-button mt-auto w-full pt-3"
              disabled={busy === option.id || option.status !== "PUBLISHED"}
              onClick={async () => {
                setBusy(option.id);
                const error = await acceptSourcingOption(option);
                setBusy(null);
                if (error) showToast(error);
              }}
            >
              {option.status === "ACCEPTED"
                ? "Accepted"
                : busy === option.id
                  ? "Accepting…"
                  : addresses.length
                    ? "Accept option"
                    : "Add a delivery address first"}
            </button>
          </article>
        ))}
      </div>
      <p className="mt-5 text-xs leading-relaxed text-[var(--muted)]">
        Acceptance records your selection. Operations creates the order
        separately; payment is not collected here and dispatch is not guaranteed
        until fulfillment is confirmed.
      </p>
    </section>
  );
}

function TrackingView() {
  const {
    orders,
    setDialog,
    requestOrderCancellation,
    requestOrderReturn,
    showToast,
  } = useSite();
  const [selected, setSelected] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const current = orders.find((item) => item.id === selected) ?? orders[0];
  const canCancel =
    current &&
    [
      "PENDING_SUPPLIER_CONFIRMATION",
      "CONFIRMED",
      "SUPPLIER_PREPARING",
      "READY_FOR_PICKUP",
    ].includes(current.status);
  const canReturn =
    current && ["DELIVERED", "COMPLETED"].includes(current.status);

  async function submitRequest(kind: "cancel" | "return") {
    if (!current || reason.trim().length < 3) {
      showToast("Add a brief reason first.");
      return;
    }
    setBusy(true);
    const error =
      kind === "cancel"
        ? await requestOrderCancellation(current.id, reason.trim())
        : await requestOrderReturn(current.id, reason.trim());
    setBusy(false);
    if (error) showToast(error);
    else setReason("");
  }
  return (
    <section>
      <PanelHeader
        eyebrow="ORDERS & TRACKING"
        title="Follow confirmed fulfillment."
        description="Accepted sourcing options appear here after operations creates an order. Estimates are conditional and no live GPS is implied."
      />
      {current ? (
        <div className="dash-card mt-5 p-6">
          <label className="field-label">
            Choose an order
            <select
              className="field-control max-w-lg"
              value={selected || current.id}
              onChange={(event) => setSelected(event.target.value)}
            >
              {orders.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.orderNumber} · {item.items[0]?.description}
                </option>
              ))}
            </select>
          </label>
          <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
            <div>
              <span className="status-pill">
                {current.status.replaceAll("_", " ")}
              </span>
              <h3 className="mt-3 font-heading text-xl font-extrabold">
                {current.orderNumber}
              </h3>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {current.items
                  .map((item) => `${item.quantity}× ${item.description}`)
                  .join(" · ")}
              </p>
            </div>
            <strong className="text-xl">৳{current.customerTotal}</strong>
          </div>
          {current.status === "PENDING_SUPPLIER_CONFIRMATION" && (
            <p className="mt-5 rounded-xl bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              External-source availability is still being confirmed. The order
              is not yet confirmed.
            </p>
          )}
          {current.failure && (
            <p className="dark-error mt-5 rounded-xl p-4 text-sm" role="alert">
              Fulfillment exception: {current.failure.reason}
            </p>
          )}
          {current.cancellationRequests[0] && (
            <p className="mt-5 rounded-xl bg-[var(--surface-soft)] p-4 text-sm">
              Cancellation request:{" "}
              <b>{current.cancellationRequests[0].status}</b>
              {current.cancellationRequests[0].decisionReason
                ? ` · ${current.cancellationRequests[0].decisionReason}`
                : " · awaiting operations review"}
            </p>
          )}
          <ol className="mt-6 border-l-2 border-[var(--line)] pl-6">
            {current.history.map((entry) => (
              <li
                key={entry.id}
                className="relative border-b border-[var(--line)] py-4 last:border-0"
              >
                <span className="absolute -left-[33px] top-5 size-4 rounded-full bg-[#2478f2]" />
                <div className="flex flex-wrap justify-between gap-2">
                  <b className="text-sm">
                    {entry.toStatus.replaceAll("_", " ")}
                  </b>
                  <time className="text-xs text-[var(--muted)]">
                    {new Date(entry.at).toLocaleString()}
                  </time>
                </div>
                {entry.note && (
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {entry.note}
                  </p>
                )}
              </li>
            ))}
          </ol>
          <div className="mt-5 grid gap-3 rounded-xl bg-[var(--surface-soft)] p-4 text-sm sm:grid-cols-2">
            <span>
              Urgent eligibility:{" "}
              <b>{current.urgent.eligibility.replaceAll("_", " ")}</b>
            </span>
            <span>
              Target:{" "}
              <b>
                {current.urgent.targetDeadlineAt
                  ? new Date(current.urgent.targetDeadlineAt).toLocaleString()
                  : "Pending"}
              </b>
            </span>
            {current.urgent.breached && (
              <b className="text-red-600">Target deadline passed</b>
            )}
            <span>
              Courier reference:{" "}
              <b>{current.delivery.trackingReference ?? "Not assigned"}</b>
            </span>
          </div>
          {(canCancel || canReturn) && (
            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <input
                className="field-control flex-1"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder={
                  canCancel
                    ? "Reason for cancellation request"
                    : "Reason for return request"
                }
              />
              <button
                disabled={busy}
                className="secondary-button disabled:opacity-60"
                onClick={() =>
                  void submitRequest(canCancel ? "cancel" : "return")
                }
              >
                {busy
                  ? "Sending…"
                  : canCancel
                    ? "Request cancellation"
                    : "Request return"}
              </button>
            </div>
          )}
          <p className="mt-5 text-xs text-[var(--muted)]">
            No payment gateway or live GPS tracking is connected. Refund
            processing is handled in a later phase.
          </p>
        </div>
      ) : (
        <EmptyCard
          icon={FiTruck}
          title="No confirmed orders yet."
          description="Accepting an option records your selection. Operations must still create an order and secure inventory or supplier availability."
          action={
            <ActionButton
              onClick={() => setDialog({ kind: "request", mode: "standard" })}
            >
              Start a request
            </ActionButton>
          }
        />
      )}
    </section>
  );
}

function AddressesView() {
  const { addresses, saveAddress, removeAddress, setDefaultAddress } =
    useSite();
  const [editing, setEditing] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [phone, setPhone] = useState("");
  const [addressLine, setAddressLine] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [area, setArea] = useState("");
  const [city, setCity] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [landmark, setLandmark] = useState("");
  const [deliveryInstructions, setDeliveryInstructions] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function reset() {
    setEditing(null);
    setLabel("");
    setRecipientName("");
    setPhone("");
    setAddressLine("");
    setAddressLine2("");
    setArea("");
    setCity("");
    setPostalCode("");
    setLandmark("");
    setDeliveryInstructions("");
    setIsDefault(false);
    setError("");
  }
  function edit(address: (typeof addresses)[number]) {
    setEditing(address.id);
    setLabel(address.label ?? "");
    setRecipientName(address.recipientName ?? "");
    setPhone(address.phone ?? "");
    setAddressLine(address.addressLine);
    setAddressLine2(address.addressLine2 ?? "");
    setArea(address.area ?? "");
    setCity(address.city);
    setPostalCode(address.postalCode ?? "");
    setLandmark(address.landmark ?? "");
    setDeliveryInstructions(address.deliveryInstructions ?? "");
    setIsDefault(address.isDefault);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const result = await saveAddress(
      {
        label: label.trim() || null,
        recipientName: recipientName.trim(),
        phone: phone.trim(),
        addressLine: addressLine.trim(),
        addressLine2: addressLine2.trim() || null,
        area: area.trim(),
        city: city.trim(),
        postalCode: postalCode.trim() || null,
        landmark: landmark.trim() || null,
        deliveryInstructions: deliveryInstructions.trim() || null,
        isDefault,
      },
      editing ?? undefined,
    );
    setBusy(false);
    if (result) setError(result);
    else reset();
  }
  async function remove(id: string) {
    setBusy(true);
    const result = await removeAddress(id);
    setBusy(false);
    if (result) setError(result);
  }
  async function makeDefault(id: string) {
    setBusy(true);
    const result = await setDefaultAddress(id);
    setBusy(false);
    if (result) setError(result);
  }
  return (
    <section>
      <PanelHeader
        eyebrow="DELIVERY ADDRESSES"
        title="Saved delivery details."
        description="PartsArc scopes every address to your authenticated customer account. One address can be selected as the default."
      />
      <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <form onSubmit={submit} className="dash-card h-fit space-y-4 p-6">
          <h3 className="font-heading text-lg font-extrabold">
            {editing ? "Edit address" : "Add an address"}
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="field-label">
              Label <small>Optional</small>
              <input
                className="field-control"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                maxLength={80}
                placeholder="Home or Office"
              />
            </label>
            <label className="field-label">
              Recipient name
              <input
                required
                className="field-control"
                value={recipientName}
                onChange={(event) => setRecipientName(event.target.value)}
                minLength={2}
                maxLength={120}
              />
            </label>
          </div>
          <label className="field-label">
            Phone
            <input
              required
              className="field-control"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              pattern="\+[1-9][0-9]{7,14}"
              placeholder="+8801700000000"
            />
          </label>
          <label className="field-label">
            Address line
            <input
              required
              className="field-control"
              value={addressLine}
              onChange={(event) => setAddressLine(event.target.value)}
              minLength={5}
              maxLength={250}
            />
          </label>
          <label className="field-label">
            Address line 2 <small>Optional</small>
            <input
              className="field-control"
              value={addressLine2}
              onChange={(event) => setAddressLine2(event.target.value)}
              maxLength={250}
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="field-label">
              Area
              <input
                required
                className="field-control"
                value={area}
                onChange={(event) => setArea(event.target.value)}
                minLength={2}
                maxLength={100}
              />
            </label>
            <label className="field-label">
              City
              <input
                required
                className="field-control"
                value={city}
                onChange={(event) => setCity(event.target.value)}
                minLength={2}
                maxLength={100}
              />
            </label>
            <label className="field-label">
              Postal code <small>Optional</small>
              <input
                className="field-control"
                value={postalCode}
                onChange={(event) => setPostalCode(event.target.value)}
                maxLength={20}
              />
            </label>
            <label className="field-label">
              Landmark <small>Optional</small>
              <input
                className="field-control"
                value={landmark}
                onChange={(event) => setLandmark(event.target.value)}
                maxLength={180}
              />
            </label>
          </div>
          <label className="field-label">
            Delivery instructions <small>Optional</small>
            <textarea
              className="field-control"
              rows={3}
              value={deliveryInstructions}
              onChange={(event) => setDeliveryInstructions(event.target.value)}
              maxLength={500}
            />
          </label>
          {!editing && (
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <input
                type="checkbox"
                className="size-5 accent-[#2478f2]"
                checked={isDefault}
                onChange={(event) => setIsDefault(event.target.checked)}
              />
              Use as my default delivery address
            </label>
          )}
          {error && (
            <p className="dark-error text-sm" role="alert">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <ActionButton type="submit" disabled={busy}>
              {busy ? "Saving…" : editing ? "Save address" : "Add address"}
            </ActionButton>
            {editing && (
              <button
                type="button"
                className="secondary-button"
                onClick={reset}
              >
                Cancel
              </button>
            )}
          </div>
        </form>
        <div className="space-y-3">
          {addresses.length ? (
            addresses.map((address) => (
              <article className="dash-card p-5" key={address.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-heading text-lg font-extrabold">
                        {address.label || address.recipientName}
                      </h3>
                      {address.isDefault && (
                        <span className="status-pill">Default</span>
                      )}
                    </div>
                    <p className="mt-2 text-sm">
                      {address.recipientName} · {address.phone}
                    </p>
                    <p className="mt-1 text-sm text-[var(--muted)]">
                      {address.addressLine}
                      {address.addressLine2 ? `, ${address.addressLine2}` : ""}
                      <br />
                      {address.area}, {address.city}
                      {address.postalCode ? ` ${address.postalCode}` : ""}
                    </p>
                    {address.deliveryInstructions && (
                      <p className="mt-2 text-xs text-[var(--muted)]">
                        {address.deliveryInstructions}
                      </p>
                    )}
                  </div>
                  <FiMapPin className="text-[var(--accent)]" size={22} />
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {!address.isDefault && (
                    <button
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => void makeDefault(address.id)}
                    >
                      Make default
                    </button>
                  )}
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => edit(address)}
                  >
                    Edit
                  </button>
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => void remove(address.id)}
                  >
                    Remove
                  </button>
                </div>
              </article>
            ))
          ) : (
            <EmptyCard
              icon={FiMapPin}
              title="No saved addresses yet."
              description="Add delivery details now so they are ready for a future order or sourcing request."
            />
          )}
        </div>
      </div>
    </section>
  );
}

function VehiclesView() {
  const { vehicles, saveVehicle, removeVehicle } = useSite();
  const [editing, setEditing] = useState<string | null>(null);
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [variant, setVariant] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [chassisVin, setChassisVin] = useState("");
  const [engineInfo, setEngineInfo] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function reset() {
    setEditing(null);
    setMake("");
    setModel("");
    setYear("");
    setVariant("");
    setRegistrationNumber("");
    setChassisVin("");
    setEngineInfo("");
    setNotes("");
    setError("");
  }
  function edit(vehicle: SavedVehicle) {
    setEditing(vehicle.id);
    setMake(vehicle.make);
    setModel(vehicle.model);
    setYear(vehicle.year?.toString() ?? "");
    setVariant(vehicle.variant ?? "");
    setRegistrationNumber(vehicle.registrationNumber ?? "");
    setChassisVin(vehicle.chassisVin ?? "");
    setEngineInfo(vehicle.engineInfo ?? "");
    setNotes(vehicle.notes ?? "");
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const result = await saveVehicle(
      {
        make: make.trim(),
        model: model.trim(),
        year: year ? Number(year) : null,
        variant: variant.trim() || null,
        registrationNumber: registrationNumber.trim() || null,
        chassisVin: chassisVin.trim() || null,
        engineInfo: engineInfo.trim() || null,
        notes: notes.trim() || null,
      },
      editing ?? undefined,
    );
    setBusy(false);
    if (result) setError(result);
    else reset();
  }
  async function remove(id: string) {
    setBusy(true);
    const result = await removeVehicle(id);
    setBusy(false);
    if (result) setError(result);
  }
  return (
    <section>
      <PanelHeader
        eyebrow="MY VEHICLES"
        title="Keep the details you know."
        description="Saved vehicles are stored securely with your customer account and can prefill future sourcing requests."
      />
      <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <form onSubmit={submit} className="dash-card h-fit space-y-4 p-6">
          <h3 className="font-heading text-lg font-extrabold">
            {editing ? "Edit vehicle" : "Add a vehicle"}
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="field-label">
              Make
              <input
                required
                className="field-control"
                value={make}
                onChange={(event) => setMake(event.target.value)}
                maxLength={80}
                placeholder="Toyota"
              />
            </label>
            <label className="field-label">
              Model
              <input
                required
                className="field-control"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                maxLength={100}
                placeholder="Axio"
              />
            </label>
            <label className="field-label">
              Year <small>Optional</small>
              <input
                className="field-control"
                type="number"
                min="1900"
                max={new Date().getFullYear() + 1}
                value={year}
                onChange={(event) => setYear(event.target.value)}
              />
            </label>
            <label className="field-label">
              Variant <small>Optional</small>
              <input
                className="field-control"
                value={variant}
                onChange={(event) => setVariant(event.target.value)}
                maxLength={120}
              />
            </label>
          </div>
          <label className="field-label">
            Registration number <small>Optional</small>
            <input
              className="field-control"
              value={registrationNumber}
              onChange={(event) => setRegistrationNumber(event.target.value)}
              maxLength={80}
            />
          </label>
          <label className="field-label">
            Chassis / VIN{" "}
            <small>Optional; imported chassis formats are accepted</small>
            <input
              className="field-control"
              value={chassisVin}
              onChange={(event) => setChassisVin(event.target.value)}
              maxLength={100}
            />
          </label>
          <label className="field-label">
            Engine information <small>Optional</small>
            <input
              className="field-control"
              value={engineInfo}
              onChange={(event) => setEngineInfo(event.target.value)}
              maxLength={160}
            />
          </label>
          <label className="field-label">
            Notes <small>Optional</small>
            <textarea
              className="field-control"
              rows={3}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              maxLength={500}
            />
          </label>
          {error && (
            <p className="dark-error text-sm" role="alert">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <ActionButton type="submit" disabled={busy}>
              {busy ? "Saving…" : editing ? "Save vehicle" : "Add vehicle"}
            </ActionButton>
            {editing && (
              <button
                type="button"
                className="secondary-button"
                onClick={reset}
              >
                Cancel
              </button>
            )}
          </div>
        </form>
        <div className="space-y-3">
          {vehicles.length ? (
            vehicles.map((vehicle) => (
              <article
                className="dash-card flex flex-wrap items-start justify-between gap-4 p-5"
                key={vehicle.id}
              >
                <div>
                  <span className="grid size-10 place-items-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
                    <FiTool aria-hidden="true" />
                  </span>
                  <h3 className="mt-3 font-heading text-lg font-extrabold">
                    {vehicle.make} {vehicle.model}
                  </h3>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    {[vehicle.year, vehicle.variant]
                      .filter(Boolean)
                      .join(" · ") || "Core identification saved"}
                  </p>
                  {vehicle.chassisVin && (
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      Chassis / VIN: {vehicle.chassisVin}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => edit(vehicle)}
                  >
                    Edit
                  </button>
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => void remove(vehicle.id)}
                    aria-label={`Remove ${vehicle.make} ${vehicle.model}`}
                  >
                    Remove
                  </button>
                </div>
              </article>
            ))
          ) : (
            <EmptyCard
              icon={FiTool}
              title="No vehicles saved yet."
              description="Add a vehicle once and select it when you make your next parts request."
            />
          )}
        </div>
      </div>
    </section>
  );
}

function ProfileView({ customer }: { customer: CustomerProfile }) {
  const { updateProfile, logout } = useSite();
  const [name, setName] = useState(customer.name);
  const [preferredName, setPreferredName] = useState(
    customer.preferredName ?? "",
  );
  const [companyName, setCompanyName] = useState(customer.companyName ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const result = await updateProfile({
      fullName: name.trim(),
      preferredName: preferredName.trim() || null,
      companyName: companyName.trim() || null,
    });
    setBusy(false);
    if (result) setError(result);
  }
  return (
    <section>
      <PanelHeader
        eyebrow="PROFILE"
        title="Your account details."
        description="Update the customer fields supported by PartsArc. Email and phone changes require a separate verification flow and are read-only here."
      />
      <form onSubmit={submit} className="dash-card max-w-2xl space-y-5 p-6">
        <label className="field-label">
          Full name
          <input
            required
            className="field-control"
            value={name}
            onChange={(event) => setName(event.target.value)}
            minLength={2}
            maxLength={120}
            autoComplete="name"
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="field-label">
            Preferred name <small>Optional</small>
            <input
              className="field-control"
              value={preferredName}
              onChange={(event) => setPreferredName(event.target.value)}
              maxLength={80}
            />
          </label>
          <label className="field-label">
            Company name <small>Optional</small>
            <input
              className="field-control"
              value={companyName}
              onChange={(event) => setCompanyName(event.target.value)}
              maxLength={160}
            />
          </label>
        </div>
        <label className="field-label">
          Email address
          <input
            className="field-control opacity-75"
            value={customer.email}
            readOnly
          />
          <small>Email changes are not available in this checkpoint.</small>
        </label>
        <label className="field-label">
          Mobile number
          <input
            className="field-control opacity-75"
            value={customer.phone ?? "Not provided"}
            readOnly
          />
          <small>
            Phone changes require verification and are not available here.
          </small>
        </label>
        <div className="rounded-xl bg-[var(--surface-soft)] p-4 text-sm text-[var(--muted)]">
          Account status:{" "}
          <b className="text-[var(--ink)]">
            {customer.accountStatus === "PENDING_VERIFICATION"
              ? "Pending verification"
              : "Active"}
          </b>{" "}
          · Email {customer.emailVerified ? "verified" : "not yet verified"}
        </div>
        {error && (
          <p className="dark-error text-sm" role="alert">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <ActionButton type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save profile"}
          </ActionButton>
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => void logout()}
          >
            Sign out
          </button>
        </div>
      </form>
    </section>
  );
}

function MessagesView() {
  const { orders, showToast } = useSite();
  const [conversations, setConversations] = useState<
    CommunicationConversation[]
  >([]);
  const [messages, setMessages] = useState<CommunicationMessage[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [requestChoices, setRequestChoices] = useState<
    Array<{ id: string; requestNumber: string }>
  >([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const pollState = useRef({ failures: 0, retryAfter: 0, inFlight: false });

  const loadConversations = async (initial = false) => {
    if (initial) setLoading(true);
    try {
      const [page, requests] = await Promise.all([
        communicationApi.conversations(),
        customerApi.requests(),
      ]);
      setConversations(page.items);
      setRequestChoices(requests.items);
      setError("");
      return true;
    } catch (cause) {
      if (initial) setError(errorMessage(cause));
      return false;
    } finally {
      if (initial) setLoading(false);
    }
  };

  const loadMessages = async (id: string) => {
    try {
      const page = await communicationApi.messages(id);
      setMessages(page.items.reverse());
      await communicationApi.read(id, page.items[0]?.id);
      setConversations((items) =>
        items.map((item) =>
          item.id === id ? { ...item, unreadCount: 0 } : item,
        ),
      );
      return true;
    } catch (cause) {
      setError(errorMessage(cause));
      return false;
    }
  };

  useEffect(() => {
    const poll = async (initial = false) => {
      const state = pollState.current;
      if (
        state.inFlight ||
        document.visibilityState !== "visible" ||
        (!initial && Date.now() < state.retryAfter)
      )
        return;
      state.inFlight = true;
      try {
        const outcomes = await Promise.all([
          loadConversations(initial),
          ...(activeId ? [loadMessages(activeId)] : []),
        ]);
        if (outcomes.every(Boolean)) {
          state.failures = 0;
          state.retryAfter = 0;
        } else {
          state.failures += 1;
          const backoff = Math.min(
            300_000,
            20_000 * 2 ** Math.min(state.failures, 4),
          );
          state.retryAfter =
            Date.now() + backoff + Math.floor(Math.random() * 5_000);
        }
      } finally {
        state.inFlight = false;
      }
    };
    void poll(true);
    const timer = window.setInterval(() => void poll(), 20_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [activeId]);

  const active = conversations.find((item) => item.id === activeId);

  async function select(id: string) {
    setActiveId(id);
    await loadMessages(id);
  }

  async function startRequest(requestId: string) {
    try {
      const conversation = await communicationApi.ensureRequest(requestId);
      await loadConversations();
      await select(conversation.id);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function startOrder(orderId: string) {
    try {
      const conversation = await communicationApi.ensureOrder(orderId);
      await loadConversations();
      await select(conversation.id);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!activeId || !draft.trim() || sending) return;
    setSending(true);
    try {
      const message = await communicationApi.send(
        activeId,
        draft.trim(),
        crypto.randomUUID(),
      );
      if (file) await communicationApi.upload(activeId, message.id, file);
      setDraft("");
      setFile(null);
      await Promise.all([loadMessages(activeId), loadConversations()]);
      showToast("Message sent to operations.");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSending(false);
    }
  }

  async function openAttachment(messageId: string, attachmentId: string) {
    if (!activeId) return;
    try {
      const response = await communicationApi.attachment(
        activeId,
        messageId,
        attachmentId,
      );
      const url = URL.createObjectURL(await response.blob());
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  return (
    <section>
      <PanelHeader
        eyebrow="OPERATIONS SUPPORT"
        title="Messages tied to the work."
        description="Keep request and order questions in separate private conversations with PartsArc operations. Suppliers cannot contact you directly."
      />
      {error && (
        <p className="dark-error mb-4 text-sm" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <PageSkeleton />
      ) : (
        <div className="dash-card grid min-h-[560px] overflow-hidden lg:grid-cols-[280px_1fr]">
          <aside className="border-b border-[var(--line)] lg:border-b-0 lg:border-r">
            <div className="max-h-[430px] overflow-auto">
              {conversations.map((item) => (
                <button
                  key={item.id}
                  className={`w-full border-b border-[var(--line)] p-4 text-left ${activeId === item.id ? "bg-[var(--accent-soft)]" : ""}`}
                  onClick={() => void select(item.id)}
                >
                  <span className="flex items-center justify-between gap-2">
                    <b className="truncate text-sm">
                      {item.subject ?? "Operations support"}
                    </b>
                    {item.unreadCount > 0 && (
                      <small className="rounded-full bg-[var(--accent)] px-2 py-0.5 text-white">
                        {item.unreadCount}
                      </small>
                    )}
                  </span>
                  <small className="mt-1 block text-[var(--accent)]">
                    {item.reference}
                  </small>
                  <span className="mt-2 block truncate text-xs text-[var(--muted)]">
                    {item.preview ?? "No messages yet"}
                  </span>
                </button>
              ))}
            </div>
            <div className="space-y-2 border-t border-[var(--line)] p-3">
              <small className="font-bold text-[var(--muted)]">
                START A CONVERSATION
              </small>
              {requestChoices.slice(0, 3).map((item) => (
                <button
                  key={item.id}
                  className="secondary-button w-full text-xs"
                  onClick={() => void startRequest(item.id)}
                >
                  {item.requestNumber}
                </button>
              ))}
              {orders.slice(0, 2).map((item) => (
                <button
                  key={item.id}
                  className="secondary-button w-full text-xs"
                  onClick={() => void startOrder(item.id)}
                >
                  {item.orderNumber}
                </button>
              ))}
            </div>
          </aside>
          <div className="flex min-h-[500px] flex-col">
            {active ? (
              <>
                <div className="border-b border-[var(--line)] p-4">
                  <b>{active.subject ?? "Operations support"}</b>
                  <small className="ml-2 text-[var(--accent)]">
                    {active.reference}
                  </small>
                </div>
                <div className="flex-1 space-y-3 overflow-auto bg-[var(--surface-soft)] p-4">
                  {messages.map((message) => (
                    <div
                      key={message.id}
                      className={`max-w-[85%] rounded-xl border border-[var(--line)] p-3 text-sm ${message.mine ? "ml-auto bg-[#2478f2] text-white" : "bg-[var(--surface)]"}`}
                    >
                      <p className="whitespace-pre-wrap leading-relaxed">
                        {message.body}
                      </p>
                      {message.attachments.map((attachment) => (
                        <button
                          key={attachment.id}
                          className="mt-2 block rounded-lg bg-black/10 px-2 py-1 text-xs font-bold"
                          onClick={() =>
                            void openAttachment(message.id, attachment.id)
                          }
                        >
                          {attachment.fileName}
                        </button>
                      ))}
                      <small className="mt-2 block opacity-70">
                        {new Date(message.sentAt).toLocaleString()}
                      </small>
                    </div>
                  ))}
                  {!messages.length && (
                    <p className="py-16 text-center text-sm text-[var(--muted)]">
                      No messages yet. Ask operations a question below.
                    </p>
                  )}
                </div>
                <form
                  onSubmit={send}
                  className="flex items-center gap-2 border-t border-[var(--line)] p-3"
                >
                  <button
                    type="button"
                    className="secondary-button px-3"
                    aria-label="Attach image"
                    onClick={() => fileInput.current?.click()}
                  >
                    <FiPaperclip />
                  </button>
                  <input
                    ref={fileInput}
                    type="file"
                    accept="image/jpeg,image/png"
                    className="hidden"
                    onChange={(event) => {
                      const selected = event.target.files?.[0] ?? null;
                      if (selected && selected.size > 5 * 1024 * 1024) {
                        setError("Images must be 5 MiB or smaller.");
                        return;
                      }
                      setFile(selected);
                    }}
                  />
                  <input
                    className="field-control min-w-0 flex-1"
                    value={draft}
                    maxLength={4000}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder={
                      file
                        ? `Message with ${file.name}`
                        : "Write to operations…"
                    }
                  />
                  <button className="secondary-button px-4" disabled={sending}>
                    <FiSend />{" "}
                    <span className="hidden sm:inline">
                      {sending ? "Sending…" : "Send"}
                    </span>
                  </button>
                </form>
              </>
            ) : (
              <div className="grid flex-1 place-items-center p-8 text-center">
                <div>
                  <FiMessageCircle
                    className="mx-auto text-[var(--accent)]"
                    size={34}
                  />
                  <b className="mt-4 block">Select or start a conversation</b>
                  <p className="mt-2 text-sm text-[var(--muted)]">
                    Messages stay separated by request or order.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function GarageView() {
  const { basket, removePart, setDialog, catalogueProducts } = useSite();
  const [manual, setManual] = useState("");
  const items = basket
    .map((id) => catalogueProducts.find((item) => item.id === id))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  function continueRequest() {
    const text = [
      ...items.map((item) => item.name),
      ...manual
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    ].join("\n");
    setDialog({
      kind: "request",
      mode: "garage",
      part: text,
      fromBasket: items.length > 0,
    });
  }
  return (
    <section>
      <PanelHeader
        eyebrow="GARAGE REQUESTS"
        title="Several parts. One requirement."
        description="Build a practical list for one garage request. Add common parts from the browser or type each part on a new line. Vehicle details and notes go into the full form."
      />
      <div className="grid gap-5 lg:grid-cols-[1fr_.85fr]">
        <div className="dash-card p-6">
          <h3 className="font-heading text-lg font-extrabold">
            Combined parts list
          </h3>
          {items.length ? (
            <div className="mt-4 divide-y divide-[var(--line)] border-y border-[var(--line)]">
              {items.map((item) => (
                <div
                  className="flex items-center justify-between gap-3 py-3"
                  key={item.id}
                >
                  <div>
                    <b className="text-sm">{item.name}</b>
                    <small className="block text-xs text-[var(--muted)]">
                      {item.category.name}
                    </small>
                  </div>
                  <button
                    className="min-h-11 text-xs font-bold text-[var(--accent)] underline"
                    onClick={() => removePart(item.id)}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm text-[var(--muted)]">
              No common parts added yet. You can still enter a custom list
              below.
            </p>
          )}
          <label className="field-label mt-5">
            Other parts or problems{" "}
            <small>One item per line · English or বাংলা</small>
            <textarea
              className="field-control"
              rows={5}
              value={manual}
              onChange={(event) => setManual(event.target.value)}
              maxLength={600}
              dir="auto"
              placeholder={"Front brake pads\nEngine mount\nOil filter"}
            />
          </label>
          <ActionButton className="mt-5 w-full" onClick={continueRequest}>
            Continue garage request
          </ActionButton>
        </div>
        <div className="dash-card h-fit p-6">
          <Kicker>ADD COMMON PARTS</Kicker>
          <h3 className="mt-2 font-heading text-xl font-extrabold">
            Browse before you send.
          </h3>
          <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">
            The parts browser shows catalogue products with current eligible
            supplier availability. Add several to your basket, then come back
            here.
          </p>
          <Link href="/parts" className="inline-link mt-4">
            Open Parts Browser <FiArrowRight />
          </Link>
          <div className="mt-7 rounded-xl bg-[var(--surface-soft)] p-4 text-xs leading-relaxed text-[var(--muted)]">
            Your basket stays on this device until you submit it as an
            authenticated sourcing request.
          </div>
        </div>
      </div>
    </section>
  );
}

function FinanceView() {
  const [invoices, setInvoices] = useState<CustomerInvoice[]>([]);
  const [history, setHistory] = useState<CustomerFinancialEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    // This state belongs to the request started and cancelled by this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    Promise.all([customerApi.invoices(), customerApi.financialHistory()])
      .then(([invoicePage, historyPage]) => {
        if (!active) return;
        setInvoices(invoicePage.items);
        setHistory(historyPage.items);
        setError("");
      })
      .catch((cause) => active && setError(errorMessage(cause)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const download = async (invoice: CustomerInvoice) => {
    setDownloading(invoice.id);
    setError("");
    try {
      const response = await customerApi.invoicePdf(invoice.id);
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${invoice.invoiceNumber}.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setDownloading(null);
    }
  };

  if (loading) return <PageSkeleton />;
  return (
    <section aria-labelledby="finance-heading">
      <PanelHeader
        eyebrow="FINANCIAL RECORDS"
        title="Invoices, payments and refunds."
        description="These records reflect money handled outside PartsArc. They do not initiate a payment or refund."
      />
      {error && (
        <p className="dark-error mb-4 rounded-xl p-3 text-sm" role="alert">
          {error}
        </p>
      )}
      {invoices.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {invoices.map((invoice) => (
            <article className="dash-card p-5" key={invoice.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <Kicker>{invoice.status}</Kicker>
                  <h3 className="mt-2 font-heading text-xl font-extrabold">
                    {invoice.invoiceNumber}
                  </h3>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {invoice.orderNumber ?? "Order"} ·{" "}
                    {invoice.issuedAt
                      ? new Date(invoice.issuedAt).toLocaleDateString()
                      : "Not issued"}
                  </p>
                </div>
                <strong className="font-heading text-xl">
                  ৳{Number(invoice.total).toLocaleString("en-BD")}
                </strong>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-[var(--surface-soft)] p-3 text-xs">
                <span>
                  Received
                  <br />
                  <b>৳{invoice.received}</b>
                </span>
                <span>
                  Refunded
                  <br />
                  <b>৳{invoice.refunded}</b>
                </span>
                <span>
                  Outstanding
                  <br />
                  <b>৳{invoice.outstanding}</b>
                </span>
              </div>
              <ActionButton
                className="mt-4"
                disabled={downloading === invoice.id}
                onClick={() => void download(invoice)}
              >
                <FiDownload />{" "}
                {downloading === invoice.id ? "Preparing…" : "Download PDF"}
              </ActionButton>
            </article>
          ))}
        </div>
      ) : (
        <EmptyCard
          icon={FiCreditCard}
          title="No invoices yet"
          description="Issued invoices will appear after operations converts an accepted option into an order and prepares its financial record."
        />
      )}
      <div className="dash-card mt-6 overflow-hidden">
        <div className="border-b border-[var(--line)] p-5">
          <h3 className="font-heading text-lg font-extrabold">
            Payment and refund history
          </h3>
        </div>
        {history.length ? (
          <div className="divide-y divide-[var(--line)]">
            {history.map((entry) => (
              <div
                className="flex flex-wrap items-center justify-between gap-3 p-4"
                key={entry.id}
              >
                <div>
                  <b className="text-sm">{entry.type.replaceAll("_", " ")}</b>
                  <small className="block text-xs text-[var(--muted)]">
                    {entry.reference} ·{" "}
                    {entry.occurredAt
                      ? new Date(entry.occurredAt).toLocaleString()
                      : "Pending"}
                  </small>
                </div>
                <strong>৳{entry.amount}</strong>
              </div>
            ))}
          </div>
        ) : (
          <p className="p-6 text-sm text-[var(--muted)]">
            No externally recorded payments or refunds.
          </p>
        )}
      </div>
    </section>
  );
}

export function DashboardPage() {
  const {
    ready,
    customer,
    sessionNotice,
    openLogin,
    dashboardView,
    setDashboardView,
    setDialog,
    requests,
  } = useSite();
  if (!ready) return <PageSkeleton />;
  if (!customer)
    return (
      <main id="main-content" className="shell min-h-[650px] py-20">
        <div className="dash-card mx-auto max-w-xl p-8 text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
            <FiUser size={26} />
          </span>
          <Kicker>CUSTOMER WORKSPACE</Kicker>
          <h1 className="mt-3 font-heading text-[clamp(30px,5vw,44px)] font-extrabold">
            Sign in to your dashboard.
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">
            Manage your PartsArc profile, delivery addresses, and vehicles.
          </p>
          {sessionNotice && (
            <p className="dark-error mt-4 text-sm" role="alert">
              {sessionNotice}
            </p>
          )}
          <ActionButton className="mt-6" onClick={() => openLogin()}>
            Sign in
          </ActionButton>
        </div>
      </main>
    );
  return (
    <main id="main-content" className="min-h-[720px] bg-[var(--page)] pb-20">
      <div className="relative isolate overflow-hidden bg-[#0a1b30] text-white">
        <div className="absolute inset-y-0 right-0 -z-10 w-[48%] bg-[url('/assets/workshop-poster.webp')] bg-cover bg-center opacity-40 max-[800px]:w-full" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-[#0a1b30] via-[#0a1b30e8] to-[#0a1b3099]" />
        <div className="shell flex flex-wrap items-end justify-between gap-8 py-14">
          <div>
            <Kicker light>PARTARC CUSTOMER WORKSPACE</Kicker>
            <h1 className="mt-4 max-w-2xl font-heading text-[clamp(34px,4vw,54px)] font-extrabold leading-tight tracking-[-.05em]">
              Good to have you here, {customer.name.split(" ")[0]}.
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-[#bdcde0]">
              Sourcing, order tracking, cancellation requests and conditional
              fulfillment updates are connected. Payments remain offline.
            </p>
          </div>
          <ActionButton
            onClick={() => setDialog({ kind: "request", mode: "standard" })}
          >
            New parts request
          </ActionButton>
        </div>
      </div>
      <div className="shell mt-8 grid gap-8 lg:grid-cols-[210px_minmax(0,1fr)]">
        <nav
          aria-label="Dashboard sections"
          className="dashboard-nav h-fit lg:sticky lg:top-6"
        >
          {nav.map((item) => (
            <button
              key={item.id}
              aria-current={dashboardView === item.id ? "page" : undefined}
              className={`dashboard-nav-item ${dashboardView === item.id ? "active" : ""}`}
              onClick={() => setDashboardView(item.id)}
            >
              <item.icon size={18} aria-hidden="true" />
              <span>{item.label}</span>
              {item.id === "requests" && requests.length > 0 && (
                <small className="ml-auto rounded-full bg-[var(--accent-soft)] px-2 text-[var(--accent)]">
                  {requests.length}
                </small>
              )}
            </button>
          ))}
        </nav>
        <div className="min-w-0">
          {dashboardView === "overview" && <Overview />}
          {dashboardView === "requests" && <RequestsView />}
          {dashboardView === "quotes" && <QuotesView />}
          {dashboardView === "tracking" && <TrackingView />}
          {dashboardView === "messages" && <MessagesView />}
          {dashboardView === "finance" && <FinanceView />}
          {dashboardView === "addresses" && <AddressesView />}
          {dashboardView === "vehicles" && <VehiclesView />}
          {dashboardView === "profile" && (
            <ProfileView key={customer.email} customer={customer} />
          )}
          {dashboardView === "garage" && <GarageView />}
        </div>
      </div>
    </main>
  );
}
