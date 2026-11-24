"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import * as Select from "./ui/select";
import { FiArrowRight, FiCheck, FiChevronDown, FiSearch } from "react-icons/fi";
import {
  catalogueApi,
  errorMessage,
  type CatalogueClassification,
  type CatalogueProduct,
} from "@/lib/api";
import { useSite } from "./site-context";
import { ActionButton, Kicker } from "./ui";
import { PageSkeleton } from "./page-skeleton";

function FilterSelect({
  value,
  onValueChange,
  options,
  label,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: { value: string; label: string }[];
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 text-[12px] font-bold text-[var(--muted)]">
      {label}
      <Select.Root value={value} onValueChange={onValueChange}>
        <Select.Trigger
          className="flex min-h-11 min-w-[140px] items-center justify-between gap-3 rounded-full border border-[var(--line)] bg-[var(--surface)] px-4 text-[12px] text-[var(--ink)]"
          aria-label={label}
        >
          <Select.Value />
          <FiChevronDown aria-hidden="true" />
        </Select.Trigger>
        <Select.Portal>
          <Select.Content
            position="popper"
            className="z-50 overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)] p-1 shadow-xl"
          >
            <Select.Viewport>
              {options.map((option) => (
                <Select.Item
                  value={option.value}
                  key={option.value}
                  className="flex cursor-pointer items-center justify-between gap-4 rounded-md px-3 py-2 text-sm outline-none data-[highlighted]:bg-[var(--accent-soft)]"
                >
                  <Select.ItemText>{option.label}</Select.ItemText>
                  <Select.ItemIndicator>
                    <FiCheck />
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </label>
  );
}

function compatibility(product: CatalogueProduct) {
  if (!product.compatibility.length)
    return "Compatibility is confirmed from your vehicle details";
  return product.compatibility
    .slice(0, 2)
    .map(
      (item) =>
        `${item.make} ${item.model}${item.yearFrom ? ` ${item.yearFrom}${item.yearTo && item.yearTo !== item.yearFrom ? `–${item.yearTo}` : ""}` : ""}`,
    )
    .join(" · ");
}

function ProductCard({ product }: { product: CatalogueProduct }) {
  const { addPart } = useSite();
  return (
    <article className="flex flex-col overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)]">
      <Link
        href={`/parts/${product.id}`}
        className="relative h-[235px] overflow-hidden bg-[#102a48] text-left"
        aria-label={`View supplier offers for ${product.name}`}
      >
        <Image
          fill
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          quality={82}
          src={
            product.imagePath ??
            product.category.imagePath ??
            "/assets/workshop-poster.webp"
          }
          alt={`${product.name} catalogue photograph`}
          className="size-full object-cover transition duration-500 hover:scale-105"
        />
        <span className="absolute left-4 top-4 rounded-full bg-[var(--surface)] px-3 py-1 font-heading text-[11px] font-extrabold text-[var(--accent)]">
          {product.category.name.toUpperCase()}
        </span>
      </Link>
      <div className="flex flex-1 flex-col p-5">
        <Kicker>{product.brand?.name ?? "CATALOGUE PART"}</Kicker>
        <h2 className="mt-2 font-heading text-[18px] font-extrabold">
          {product.name}
        </h2>
        <p className="mt-2 min-h-10 text-[12px] leading-relaxed text-[var(--muted)]">
          {product.description ?? compatibility(product)}
        </p>
        <strong className="mt-3 text-[12px] text-[var(--heading)]">
          {product.priceFrom
            ? `Fixed offers from ৳${product.priceFrom}`
            : "Used-part quotations available"}
        </strong>
        <p className="mt-2 text-[11px] text-[var(--muted)]">
          {product.listingClassifications
            .map((item) =>
              item === "NEW_GENUINE"
                ? "Genuine"
                : item === "NEW_AFTERMARKET"
                  ? "Aftermarket"
                  : "Used",
            )
            .join(" · ")}{" "}
          · {product.offerCount} {product.offerCount === 1 ? "offer" : "offers"}
        </p>
        <div className="mt-auto flex flex-wrap gap-2 pt-5">
          <Link className="secondary-button" href={`/parts/${product.id}`}>
            View offers
          </Link>
          <button
            className="secondary-button"
            onClick={() => addPart(product.id)}
          >
            + Add to Parts Request
          </button>
        </div>
      </div>
    </article>
  );
}

export function PartsBrowser() {
  const searchParams = useSearchParams();
  const {
    setDialog,
    categories,
    catalogueProducts,
    catalogueLoading,
    catalogueError,
    reloadCatalogue,
  } = useSite();
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [vehicle, setVehicle] = useState("all");
  const [classification, setClassification] = useState<
    CatalogueClassification | "all"
  >("all");
  const [sort, setSort] = useState("recommended");
  const [page, setPage] = useState(1);
  const [results, setResults] = useState<CatalogueProduct[]>([]);
  const [resultTotal, setResultTotal] = useState(0);
  const [resultsLoading, setResultsLoading] = useState(true);
  const [resultsError, setResultsError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const pageSize = 12;
  useEffect(() => {
    const requested = searchParams.get("category");
    const match = categories.find(
      (item) => item.name === requested || item.slug === requested,
    );
    // Keep the selected category synchronized with the shareable route query.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCategory(match?.id ?? "all");
  }, [searchParams, categories]);
  const makes = useMemo(
    () =>
      [
        ...new Set(
          catalogueProducts.flatMap((product) =>
            product.compatibility.map((item) => item.make),
          ),
        ),
      ].sort(),
    [catalogueProducts],
  );
  const list = useMemo(
    () =>
      sort === "az"
        ? [...results].sort((a, b) => a.name.localeCompare(b.name))
        : results,
    [results, sort],
  );
  useEffect(() => {
    // Filter changes intentionally reset pagination to the first result page.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
  }, [category, vehicle, classification, query, sort]);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    // These flags describe the request owned and cancelled by this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setResultsLoading(true);
    setResultsError("");
    const timer = window.setTimeout(() => { void catalogueApi
      .products({
        page,
        pageSize,
        search: query || undefined,
        categoryId: category === "all" ? undefined : category,
        make: vehicle === "all" ? undefined : vehicle,
        classification: classification === "all" ? undefined : classification,
        signal: controller.signal,
      })
      .then((response) => {
        if (!active) return;
        setResults(response.items);
        setResultTotal(response.total);
      })
      .catch((error) => active && setResultsError(errorMessage(error)))
      .finally(() => active && setResultsLoading(false)); }, query ? 250 : 0);
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [page, pageSize, query, category, vehicle, classification, reloadKey]);
  const pageCount = Math.max(1, Math.ceil(resultTotal / pageSize));
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setQuery(draft.trim());
  }
  if (catalogueLoading || resultsLoading) return <PageSkeleton />;
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="shell min-h-[720px] py-[90px] max-[700px]:py-14"
    >
      <div className="flex items-end justify-between gap-8 max-[750px]:flex-col max-[750px]:items-start">
        <div>
          <Kicker>PARTS DISCOVERY</Kicker>
          <h1 className="section-title mt-3">
            Browse the vehicle, not a warehouse.
          </h1>
          <p className="mt-3 max-w-[650px] text-[15px] leading-relaxed text-[var(--muted)]">
            Browse active parts offered by eligible suppliers. Compare genuine,
            aftermarket, and quote-based used-part offers before making a
            request.
          </p>
        </div>
        <button
          className="inline-link shrink-0"
          onClick={() => setDialog({ kind: "request", mode: "standard" })}
        >
          Can’t find it? Submit a request <FiArrowRight />
        </button>
      </div>
      {catalogueError || resultsError ? (
        <div className="mt-8 rounded-xl border border-red-300 bg-red-50 p-6 text-sm text-red-900">
          <b>Catalogue is unavailable.</b>
          <p className="mt-1">{catalogueError || resultsError}</p>
          <button
            className="secondary-button mt-4"
            onClick={() => {
              void reloadCatalogue();
              setReloadKey((value) => value + 1);
            }}
          >
            Try again
          </button>
        </div>
      ) : (
        <>
          <form
            onSubmit={submit}
            className="mt-8 flex max-w-[740px] items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-2 pl-4 shadow-sm"
          >
            <FiSearch
              className="shrink-0 text-[var(--muted)]"
              size={21}
              aria-hidden="true"
            />
            <input
              className="min-w-0 flex-1 py-2 text-sm outline-none"
              aria-label="Search parts browser"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Search by part, number, brand, category, or vehicle"
              dir="auto"
            />
            <button className="min-h-11 rounded-full bg-[#2478f2] px-5 text-[12px] font-bold text-white">
              Search
            </button>
          </form>
          <div className="mt-7 flex flex-wrap items-center justify-between gap-5">
            <div
              className="flex flex-wrap gap-2"
              role="group"
              aria-label="Category filter"
            >
              {[{ id: "all", name: "All" }, ...categories].map((item) => (
                <button
                  type="button"
                  key={item.id}
                  aria-pressed={item.id === category}
                  className={`min-h-11 rounded-full border px-4 text-[12px] font-bold ${item.id === category ? "border-[#2478f2] bg-[#2478f2] text-white" : "border-[var(--line)] bg-[var(--surface)] text-[var(--muted-strong)] hover:border-[#2478f2]"}`}
                  onClick={() => setCategory(item.id)}
                >
                  {item.name}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-3">
              <FilterSelect
                label="Vehicle make"
                value={vehicle}
                onValueChange={setVehicle}
                options={[
                  { value: "all", label: "All vehicles" },
                  ...makes.map((name) => ({ value: name, label: name })),
                ]}
              />
              <FilterSelect
                label="Condition"
                value={classification}
                onValueChange={(value) =>
                  setClassification(value as CatalogueClassification | "all")
                }
                options={[
                  { value: "all", label: "All types" },
                  { value: "NEW_GENUINE", label: "Genuine" },
                  { value: "NEW_AFTERMARKET", label: "Aftermarket" },
                  { value: "USED", label: "Used" },
                ]}
              />
              <FilterSelect
                label="Sort"
                value={sort}
                onValueChange={setSort}
                options={[
                  { value: "recommended", label: "Catalogue order" },
                  { value: "az", label: "Name: A–Z" },
                ]}
              />
            </div>
          </div>
          <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] pb-4">
            <b className="text-[12px]">
              {resultTotal} available catalogue parts
            </b>
            <small className="text-[12px] text-[var(--muted)]">
              Prices shown are the lowest current eligible offering and are not
              a quotation.
            </small>
          </div>
          {list.length ? (
            <div className="mt-6 grid grid-cols-3 gap-5 max-[1000px]:grid-cols-2 max-[650px]:grid-cols-1">
              {list.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          ) : (
            <div className="mt-6 rounded-xl bg-[var(--surface-soft)] p-8">
              <h2 className="font-heading text-[25px] font-extrabold">
                No live product matches.
              </h2>
              <p className="mt-2 text-[14px] text-[var(--muted)]">
                Submit a photo, part number, or description and operations can
                source it outside listed stock.
              </p>
              <ActionButton
                className="mt-5"
                onClick={() =>
                  setDialog({ kind: "request", mode: "standard", part: query })
                }
              >
                Submit a Parts Request
              </ActionButton>
            </div>
          )}
          {resultTotal > pageSize && (
            <nav
              className="mt-8 flex items-center justify-center gap-3"
              aria-label="Parts result pages"
            >
              <button
                className="secondary-button"
                disabled={page === 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
              >
                Previous
              </button>
              <span className="text-sm text-[var(--muted)]">
                Page {page} of {pageCount}
              </span>
              <button
                className="secondary-button"
                disabled={page === pageCount}
                onClick={() =>
                  setPage((value) => Math.min(pageCount, value + 1))
                }
              >
                Next
              </button>
            </nav>
          )}
        </>
      )}
    </main>
  );
}
