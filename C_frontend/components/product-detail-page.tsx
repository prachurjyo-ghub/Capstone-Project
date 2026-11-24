"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { FiArrowLeft, FiClock, FiPackage, FiShield } from "react-icons/fi";
import {
  catalogueApi,
  errorMessage,
  type CatalogueClassification,
  type CatalogueOffer,
  type CatalogueProduct,
} from "@/lib/api";
import { useSite } from "./site-context";
import { Kicker } from "./ui";
import { PageSkeleton } from "./page-skeleton";

const classificationLabel: Record<CatalogueClassification, string> = {
  NEW_GENUINE: "Genuine",
  NEW_AFTERMARKET: "Aftermarket",
  USED: "Used",
};

function OfferCard({
  offer,
  product,
}: {
  offer: CatalogueOffer;
  product: CatalogueProduct;
}) {
  const {
    customer,
    addresses,
    vehicles,
    openLogin,
    openDashboard,
    submitFixedPurchase,
    submitUsedRfq,
  } = useSite();
  const [quantity, setQuantity] = useState(1);
  const [addressId, setAddressId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState("");
  const used = offer.requestAction === "RFQ";

  useEffect(() => {
    // Account data arriving from the session selects safe form defaults.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAddressId(
      addresses.find((address) => address.isDefault)?.id ??
        addresses[0]?.id ??
        "",
    );
    setVehicleId(vehicles[0]?.id ?? "");
  }, [addresses, vehicles]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback("");
    if (!customer) {
      openLogin("signin", true);
      return;
    }
    if (!addressId) {
      setFeedback("Add a delivery address in your account before continuing.");
      return;
    }
    if (used && !vehicleId) {
      setFeedback(
        "Add a vehicle in your account so the supplier can confirm fitment.",
      );
      return;
    }
    setSubmitting(true);
    const failure = used
      ? await submitUsedRfq(
          product,
          offer,
          quantity,
          vehicleId,
          addressId,
          note,
        )
      : await submitFixedPurchase(offer, quantity, addressId, note);
    setSubmitting(false);
    if (failure) setFeedback(failure);
    else
      setFeedback(
        used
          ? "Quotation request submitted. You can follow it under My Requests."
          : "Purchase request submitted. The supplier will confirm availability.",
      );
  }

  return (
    <article className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="rounded-full bg-[var(--accent-soft)] px-3 py-1 text-[11px] font-extrabold text-[var(--accent)]">
            {classificationLabel[offer.listingClassification]}
          </span>
          <h3 className="mt-3 font-heading text-lg font-extrabold">
            {offer.supplier.displayName}
          </h3>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {offer.condition.replaceAll("_", " ")} · {offer.availableQuantity}{" "}
            available
          </p>
        </div>
        <div className="text-right">
          {used ? (
            <strong className="text-sm text-[var(--heading)]">
              Request a quote
            </strong>
          ) : (
            <>
              <strong className="block font-heading text-2xl font-extrabold">
                ৳{offer.fixedPrice}
              </strong>
              <small className="text-[var(--muted)]">per item</small>
            </>
          )}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-4 border-y border-[var(--line)] py-3 text-xs text-[var(--muted)]">
        <span className="flex items-center gap-1.5">
          <FiPackage /> {offer.availabilityStatus.replaceAll("_", " ")}
        </span>
        {offer.preparationTimeMin != null && (
          <span className="flex items-center gap-1.5">
            <FiClock /> Ready in about {offer.preparationTimeMin} min
          </span>
        )}
      </div>
      {offer.notes && (
        <p className="mt-4 text-sm leading-relaxed text-[var(--muted)]">
          {offer.notes}
        </p>
      )}
      <form className="mt-5 grid gap-3 sm:grid-cols-2" onSubmit={submit}>
        <label className="field-label">
          Quantity
          <input
            className="field-control"
            type="number"
            min={1}
            max={Math.min(offer.availableQuantity, 999)}
            value={quantity}
            onChange={(event) => setQuantity(Number(event.target.value))}
          />
        </label>
        {customer && (
          <label className="field-label">
            Delivery address
            <select
              className="field-control"
              value={addressId}
              onChange={(event) => setAddressId(event.target.value)}
            >
              <option value="">Choose an address</option>
              {addresses.map((address) => (
                <option key={address.id} value={address.id}>
                  {address.label ||
                    `${address.area || address.city}, ${address.city}`}
                </option>
              ))}
            </select>
          </label>
        )}
        {customer && used && (
          <label className="field-label sm:col-span-2">
            Vehicle for fitment
            <select
              className="field-control"
              value={vehicleId}
              onChange={(event) => setVehicleId(event.target.value)}
            >
              <option value="">Choose a saved vehicle</option>
              {vehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.make} {vehicle.model}
                  {vehicle.year ? ` · ${vehicle.year}` : ""}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field-label sm:col-span-2">
          Note <small>Optional</small>
          <textarea
            className="field-control"
            rows={2}
            maxLength={600}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={
              used
                ? "Condition questions, fitment details, or warranty request"
                : "Delivery or compatibility note"
            }
          />
        </label>
        {feedback && (
          <p className="sm:col-span-2 text-sm font-semibold" role="status">
            {feedback}
          </p>
        )}
        <button
          className="min-h-11 rounded-full bg-[#2478f2] px-5 text-sm font-bold text-white disabled:opacity-60 sm:col-span-2"
          disabled={submitting}
        >
          {submitting
            ? "Submitting…"
            : !customer
              ? "Sign in to continue"
              : used
                ? "Request quotation"
                : "Request to purchase"}
        </button>
        {customer && (!addresses.length || (used && !vehicles.length)) && (
          <button
            type="button"
            className="secondary-button sm:col-span-2"
            onClick={() =>
              openDashboard(!addresses.length ? "addresses" : "vehicles")
            }
          >
            Add {!addresses.length ? "a delivery address" : "a vehicle"} in
            Account
          </button>
        )}
      </form>
    </article>
  );
}

export function ProductDetailPage({ id }: { id: string }) {
  const [product, setProduct] = useState<CatalogueProduct | null>(null);
  const [failure, setFailure] = useState("");
  const [classification, setClassification] = useState<
    CatalogueClassification | "ALL"
  >("ALL");

  useEffect(() => {
    let active = true;
    void catalogueApi
      .product(id)
      .then((value) => active && setProduct(value))
      .catch((error) => active && setFailure(errorMessage(error)));
    return () => {
      active = false;
    };
  }, [id]);

  const offers = useMemo(
    () =>
      product?.offers?.filter(
        (offer) =>
          classification === "ALL" ||
          offer.listingClassification === classification,
      ) ?? [],
    [product, classification],
  );

  if (!product && !failure) return <PageSkeleton />;
  if (!product)
    return (
      <main id="main-content" className="shell py-20">
        <h1 className="section-title">Part unavailable.</h1>
        <p className="mt-3 text-[var(--muted)]">{failure}</p>
        <Link className="inline-link mt-5" href="/parts">
          Back to parts
        </Link>
      </main>
    );

  const primaryNumber = product.numbers.find((number) => number.isPrimary);
  return (
    <main id="main-content" className="shell py-16" tabIndex={-1}>
      <Link className="inline-link" href="/parts">
        <FiArrowLeft /> Back to parts
      </Link>
      <div className="mt-8 grid gap-9 lg:grid-cols-[minmax(0,1fr)_minmax(360px,.85fr)]">
        <div>
          <Image
            width={1200}
            height={900}
            sizes="(max-width: 1024px) 100vw, 58vw"
            quality={82}
            priority
            className="aspect-[4/3] w-full rounded-2xl bg-[#102a48] object-cover"
            src={
              product.imagePath ??
              product.category.imagePath ??
              "/assets/workshop-poster.webp"
            }
            alt={`${product.name} catalogue photograph`}
          />
          <div className="mt-6 rounded-xl bg-[var(--surface-soft)] p-5">
            <h2 className="font-heading text-lg font-extrabold">
              Fitment and part information
            </h2>
            <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-[var(--muted)]">Part number</dt>
                <dd className="font-bold">
                  {primaryNumber?.partNumber ?? "Not published"}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Brand</dt>
                <dd className="font-bold">
                  {product.brand?.name ?? "Unbranded"}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-[var(--muted)]">Compatible vehicles</dt>
                <dd className="font-bold">
                  {product.compatibility.length
                    ? product.compatibility
                        .map(
                          (item) =>
                            `${item.make} ${item.model}${item.yearFrom ? ` ${item.yearFrom}${item.yearTo ? `–${item.yearTo}` : ""}` : ""}`,
                        )
                        .join(" · ")
                    : "Confirm with your vehicle details"}
                </dd>
              </div>
            </dl>
          </div>
        </div>
        <div>
          <Kicker>{product.category.name.toUpperCase()}</Kicker>
          <h1 className="section-title mt-3">{product.name}</h1>
          <p className="mt-4 leading-relaxed text-[var(--muted)]">
            {product.description ??
              "Compare current supplier offers and choose the request path that matches the part condition."}
          </p>
          <p className="mt-4 flex items-start gap-2 rounded-lg border border-[var(--line)] p-3 text-xs text-[var(--muted)]">
            <FiShield className="mt-0.5 shrink-0" /> PartsArc shows eligible
            live listings. Fixed-price requests still require supplier
            confirmation; used parts are quoted after fitment and condition
            review.
          </p>
          <div
            className="mt-6 flex flex-wrap gap-2"
            aria-label="Offer classification filter"
          >
            <button
              className={`secondary-button ${classification === "ALL" ? "border-[#2478f2]" : ""}`}
              onClick={() => setClassification("ALL")}
            >
              All offers
            </button>
            {product.listingClassifications.map((item) => (
              <button
                key={item}
                className={`secondary-button ${classification === item ? "border-[#2478f2]" : ""}`}
                onClick={() => setClassification(item)}
              >
                {classificationLabel[item]}
              </button>
            ))}
          </div>
          <div className="mt-5 grid gap-4">
            {offers.map((offer) => (
              <OfferCard key={offer.id} offer={offer} product={product} />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
