"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState, type FormEvent } from "react";
import * as Tabs from "./ui/tabs";
import {
  FiArrowRight,
  FiArrowUpRight,
  FiCamera,
  FiCheck,
  FiZap,
} from "react-icons/fi";
import { businessModes } from "@/lib/data";
import type { CatalogueProduct } from "@/lib/api";
import { useSite } from "./site-context";
import { ActionButton, Kicker } from "./ui";

function HeroVideo() {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const media = window.matchMedia(
      "(min-width: 961px) and (prefers-reduced-motion: no-preference)",
    );
    const connection = (
      navigator as Navigator & { connection?: { saveData?: boolean } }
    ).connection;
    function sync() {
      if (!video) return;
      if (
        !media.matches ||
        connection?.saveData ||
        document.visibilityState !== "visible"
      ) {
        video.pause();
        return;
      }
      if (!video.src) {
        video.src = "/assets/workshop-loop.mp4";
        video.load();
      }
      void video.play().catch(() => undefined);
    }
    media.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => {
      media.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
      video.pause();
    };
  }, []);
  return (
    <div className="hero-visual" aria-hidden="true">
      <video
        ref={ref}
        poster="/assets/workshop-poster.webp"
        muted
        loop
        playsInline
        preload="none"
      />
      <div className="absolute bottom-[95px] right-[5vw] z-10 max-w-[300px] border-l-[3px] border-[#4e9cff] pl-5 text-white [text-shadow:0_2px_12px_#0009]">
        <span className="mb-2 block font-heading text-[10px] font-extrabold tracking-[.12em] text-[#a8caff]">
          THE WORK STARTS HERE
        </span>
        <strong className="font-heading text-[19px] leading-snug">
          A real part. A real vehicle.
          <br />
          One place to begin.
        </strong>
      </div>
    </div>
  );
}

function Hero() {
  const { setDialog } = useSite();
  const [query, setQuery] = useState("");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDialog({ kind: "request", mode: "standard", part: query.trim() });
  }
  return (
    <section
      className="hero relative isolate overflow-hidden bg-[#041021] text-white"
      id="home"
    >
      <HeroVideo />
      <div className="absolute inset-0 z-0 bg-[linear-gradient(90deg,#041021_0%,#041021_43%,#04102144_62%,transparent_100%)] max-[960px]:bg-[linear-gradient(90deg,#041021f9,#041021d1)]" />
      <div className="shell relative z-10 flex min-h-[620px] items-center py-[68px] max-[700px]:min-h-0 max-[700px]:py-9">
        <div className="w-[58%] max-w-[685px] max-[960px]:w-full">
          <div className="eyebrow text-[#77acfa]">
            <span />
            THE PART YOU NEED, WITHOUT THE SHOP-TO-SHOP SEARCH
          </div>
          <h1 className="mt-4 font-heading text-[clamp(52px,5.25vw,76px)] font-extrabold leading-[1.02] tracking-[-.055em] max-[700px]:text-[clamp(36px,10.5vw,44px)] max-[700px]:leading-[1.04]">
            Find any part.
            <br />
            <em className="not-italic text-[#3488ff]">Source it fast.</em>
            <span className="max-[700px]:hidden">
              <br />
              Keep moving.
            </span>
          </h1>
          <span className="mt-2 hidden font-heading text-sm font-bold tracking-wide text-[#d6e4f5] max-[700px]:block">
            Keep moving.
          </span>
          <p className="mt-4 max-w-[590px] text-[16px] leading-[1.6] text-[#bdc9d7] max-[700px]:line-clamp-3 max-[700px]:text-[14px]">
            Tell us what part you need. We connect you with suitable suppliers,
            review the options, and help coordinate delivery.
          </p>
          <div className="mt-5">
            <label
              htmlFor="hero-part"
              className="mb-2 block font-heading text-[13px] font-bold"
            >
              What part do you need?
            </label>
            <form
              onSubmit={submit}
              className="flex min-h-[66px] w-full max-w-[650px] items-center gap-2 rounded-[18px] bg-[var(--surface)] p-1.5 pl-5 shadow-[0_18px_50px_#0006] max-[550px]:flex-col max-[550px]:items-stretch max-[550px]:p-2 max-[550px]:pl-3"
            >
              <input
                id="hero-part"
                className="min-w-0 flex-1 bg-transparent py-3 text-[14px] text-[var(--ink)] outline-none"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                dir="auto"
                placeholder="e.g. Brake pads for a 2015 Axio"
              />
              <ActionButton className="min-h-[54px] shrink-0 max-[550px]:w-full">
                Start My Request
              </ActionButton>
            </form>
            <span className="mt-2 block text-[12px] text-[#9aacc2]">
              A name, number, or simple description is enough to begin.
            </span>
          </div>
          <div className="mt-4 flex max-w-[650px] divide-x divide-white/15 rounded-xl border border-white/20 bg-[#061326a6] max-[430px]:divide-x-0">
            <button
              className="flex min-h-[62px] flex-1 items-center gap-3 px-3 text-left hover:bg-white/5"
              onClick={() => setDialog({ kind: "request", mode: "photo" })}
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#176fe6]">
                <FiCamera aria-hidden="true" />
              </span>
              <span>
                <b className="block text-[13px]">Upload Photo</b>
                <small className="text-[12px] text-[#90a3ba]">
                  Different angles help
                </small>
              </span>
            </button>
            <button
              className="flex min-h-[62px] flex-1 items-center gap-3 px-3 text-left hover:bg-white/5"
              onClick={() => setDialog({ kind: "request", mode: "urgent" })}
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#176fe6]">
                <FiZap aria-hidden="true" />
              </span>
              <span>
                <b className="block text-[13px]">Urgent Help</b>
                <small className="text-[12px] text-[#90a3ba]">
                  Priority sourcing*
                </small>
              </span>
            </button>
          </div>
          <p className="mt-3 text-[12px] text-[#9aacc2]">
            *Urgent delivery depends on supplier availability and service area.
          </p>
        </div>
      </div>
      <div className="shell relative z-10 grid min-h-[62px] grid-cols-4 items-center gap-4 border-t border-white/20 bg-[#041021b3] text-[12px] text-[#c7d4e2] max-[700px]:grid-cols-3 max-[700px]:gap-2 max-[700px]:py-3 max-[430px]:text-[10px]">
        <strong className="font-heading text-[10px] tracking-[.12em] text-[#70adff] max-[700px]:hidden">
          ONE REQUEST
        </strong>
        {[
          "Multiple supplier options",
          "Compatibility information reviewed",
          "Delivery coordinated",
        ].map((text) => (
          <span key={text} className="flex items-center gap-2">
            <FiCheck className="shrink-0 text-[#68b1ff]" aria-hidden="true" />
            {text}
          </span>
        ))}
      </div>
    </section>
  );
}

function Recognition() {
  const { setDialog } = useSite();
  return (
    <section className="bg-[var(--surface-blue)] py-[104px] max-[700px]:py-12">
      <div className="shell grid grid-cols-[.84fr_1fr] items-center gap-[9vw] max-[960px]:grid-cols-1 max-[960px]:gap-12">
        <div>
          <Kicker>YOU DON’T NEED THE PERFECT PART NAME</Kicker>
          <h2 className="section-title mt-5">
            “I have a photo.
            <br />
            Is that enough?”
          </h2>
          <p className="mt-5 max-w-[535px] text-[16px] leading-[1.7] text-[var(--muted-strong)] max-[700px]:text-[14px]">
            Yes. A photo, a mechanic’s note, a part number, or a plain
            description can start the request. Add the vehicle details you know;
            we’ll help turn it into something suppliers can quote.
          </p>
          <ActionButton
            className="mt-7"
            onClick={() => setDialog({ kind: "request", mode: "photo" })}
          >
            Send a part photo
          </ActionButton>
        </div>
        <div className="border border-[var(--line)] bg-[var(--surface)] shadow-[0_24px_60px_#19365014]">
          <div className="flex min-h-[52px] items-center justify-between gap-3 border-b border-[var(--line)] px-5">
            <b className="font-heading text-[10px] tracking-wide text-[var(--accent)]">
              WHAT TO INCLUDE
            </b>
          </div>
          <div className="grid grid-cols-[180px_1fr] gap-6 p-5 max-[500px]:grid-cols-1">
            <Image
              src="/assets/brake.jpg"
              alt="Close-up photograph of a brake assembly that could be attached to a parts request"
              width={360}
              height={372}
              className="h-[186px] w-full object-cover max-[500px]:h-[190px]"
            />
            <div className="self-center">
              <span className="font-heading text-[10px] font-extrabold tracking-wide text-[var(--accent)]">
                A CLEAR PART PHOTO
              </span>
              <p className="my-3 font-heading text-[18px] font-bold leading-[1.55] text-[var(--heading)] max-[700px]:text-[15px]">
                Photograph the complete part and any visible number or label.
              </p>
              <p className="text-[12px] text-[var(--muted)]">
                Add the vehicle details and delivery area you actually know.
              </p>
            </div>
          </div>
          <div className="flex gap-3 border-t border-[var(--line)] bg-[var(--surface-raised)] p-5">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[#d9f3e7] text-[#148252]">
              <FiCheck />
            </span>
            <p className="text-[12px] leading-relaxed text-[var(--muted-strong)]">
              <b className="text-[var(--heading)]">That’s enough to begin.</b>{" "}
              We review the details and coordinate sourcing options.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function LiveCataloguePanel() {
  const { catalogueProducts, catalogueLoading, setDialog } = useSite();
  const available = catalogueProducts.slice(0, 2);
  return (
    <aside
      className="w-full max-w-[530px] overflow-hidden rounded-lg border border-[#22344c] bg-[var(--surface)] text-[var(--ink)] shadow-[0_30px_65px_#0209156b]"
      aria-label="Currently available catalogue products"
    >
      <div className="flex min-h-[49px] items-center justify-between gap-2 bg-[#0a1b30] px-4 text-[10px] tracking-wide text-[#b9c8da]">
        <span>
          <i className="mr-2 inline-block size-2 rounded-full bg-[#19a66a]" />
          LIVE CATALOGUE AVAILABILITY
        </span>
        <small>{available.length} SHOWN</small>
      </div>
      <div className="border-b border-[var(--line)] px-5 py-4">
        <span className="block font-bold text-[10px] tracking-wide text-[var(--accent)]">
          SUPPLIER-BACKED PRODUCTS
        </span>
        <strong className="mt-1 block font-heading text-[23px]">Available now</strong>
        <small className="text-[11px] text-[var(--muted)]">
          Supplier identity remains private until operations completes the workflow.
        </small>
      </div>
      {catalogueLoading && (
        <div className="space-y-3 p-5" aria-label="Loading available products">
          <div className="h-20 animate-pulse rounded-lg bg-[var(--surface-raised)]" />
          <div className="h-20 animate-pulse rounded-lg bg-[var(--surface-raised)]" />
        </div>
      )}
      {!catalogueLoading && available.map((product) => (
        <button
          key={product.id}
          type="button"
          onClick={() => setDialog({ kind: "detail", productId: product.id })}
          className="mx-5 my-2 flex min-h-[85px] w-[calc(100%-40px)] items-center justify-between gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 text-left hover:border-[#2478f2] hover:bg-[var(--surface-raised)]"
        >
          <span>
            <small className="block text-[10px] tracking-wide text-[var(--muted)]">
              {product.category.name.toUpperCase()}
            </small>
            <b className="my-1 block text-[13px]">{product.name}</b>
            <em className="rounded-full bg-[var(--surface-blue)] px-2 py-1 text-[10px] not-italic text-[var(--muted)]">
              {product.availability}
            </em>
          </span>
          <strong className="text-right font-heading text-[18px]">
            From ৳{product.priceFrom}
            <small className="mt-1 block font-body text-[11px] font-normal text-[var(--muted)]">
              {product.preparationTimeFromMin == null
                ? "Preparation time confirmed by quotation"
                : `${product.preparationTimeFromMin} min preparation`}
            </small>
          </strong>
        </button>
      ))}
      {!catalogueLoading && !available.length && (
        <p className="p-5 text-sm text-[var(--muted)]">
          No eligible supplier offerings are currently available.
        </p>
      )}
      <Link href="/parts" className="mx-5 mb-5 mt-3 inline-flex items-center gap-2 text-sm font-bold text-[var(--accent)]">
        Browse live catalogue <FiArrowRight aria-hidden="true" />
      </Link>
    </aside>
  );
}

function Sourcing() {
  const { setDialog } = useSite();
  const steps = [
    ["01", "You send what you know", "Part name, vehicle details, or a photo."],
    [
      "02",
      "We source and review",
      "PartArc coordinates suppliers and reviews part information.",
    ],
    [
      "03",
      "You compare, then approve",
      "Choose an option; we coordinate delivery after confirmation.",
    ],
  ];
  return (
    <section
      id="how"
      className="bg-[#0b1b2f] pb-8 pt-[103px] text-white max-[700px]:pt-12"
    >
      <div className="shell grid grid-cols-[.94fr_1fr] items-center gap-[8vw] max-[960px]:grid-cols-1 max-[960px]:gap-12">
        <div>
          <Kicker light>WHAT PARTARC DOES FOR YOU</Kicker>
          <h2 className="section-title mt-5">
            We do the shop-to-shop work.{" "}
            <em className="not-italic text-[#69a8ff]">
              You choose what works.
            </em>
          </h2>
          <p className="mt-5 max-w-[550px] text-[15px] leading-[1.7] text-[#b6c6d8]">
            One request gives us the details to source suitable options. You see
            the quoted price and delivery estimate together before deciding.
          </p>
          <ol className="mt-7 border-t border-white/20">
            {steps.map(([number, title, description]) => (
              <li
                key={number}
                className="grid grid-cols-[42px_1fr] gap-3 border-b border-white/20 py-4"
              >
                <span className="font-heading text-[13px] font-extrabold text-[#66a3fa]">
                  {number}
                </span>
                <div>
                  <b className="block font-heading text-[14px]">{title}</b>
                  <small className="mt-1 block text-[12px] text-[#94a9bf]">
                    {description}
                  </small>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <LiveCataloguePanel />
      </div>
      <div className="shell mt-[86px] flex flex-wrap items-center gap-5 border-t border-white/20 pt-6 max-[700px]:mt-10">
        <b className="font-heading text-[10px] tracking-wide text-[#6fa9fa]">
          RUNNING A GARAGE OR FLEET?
        </b>
        <p className="text-[12px] text-[#b4c6d8]">
          Send multiple parts in one request instead of repeating the sourcing
          work.
        </p>
        <button
          className="ml-auto min-h-11 rounded-full border border-[#6ca8f1] px-5 font-heading text-[12px] font-extrabold hover:bg-[#1d6cda] max-[700px]:ml-0"
          onClick={() =>
            setDialog({ kind: "request", mode: "garage", fromBasket: true })
          }
        >
          Start a multi-part request <FiArrowUpRight className="ml-2 inline" />
        </button>
      </div>
    </section>
  );
}

function Categories() {
  const { categories, catalogueLoading, catalogueError } = useSite();
  return (
    <section className="bg-[var(--surface-soft)] py-[110px] max-[700px]:py-12">
      <div className="shell">
        <div className="mb-10 grid grid-cols-[1.25fr_.75fr] items-end gap-16 max-[700px]:grid-cols-1 max-[700px]:gap-4">
          <div>
            <Kicker>PARTS DISCOVERY</Kicker>
            <h2 className="section-title mt-3">
              Browse the vehicle,
              <br />
              not a warehouse.
            </h2>
          </div>
          <div>
            <p className="text-[15px] leading-[1.7] text-[var(--muted)]">
              Explore admin-managed component groups, then provide the vehicle
              information needed for accurate sourcing.
            </p>
            <Link href="/parts" className="inline-link mt-4">
              Open Parts Browser <FiArrowRight aria-hidden="true" />
            </Link>
          </div>
        </div>
        {catalogueLoading ? (
          <div className="grid grid-cols-3 gap-4 max-[850px]:grid-cols-2 max-[500px]:grid-cols-1">
            {Array.from({ length: 6 }, (_, index) => (
              <div
                key={index}
                className="min-h-[300px] animate-pulse rounded-xl bg-[var(--line)] max-[500px]:min-h-[210px]"
              />
            ))}
          </div>
        ) : catalogueError ? (
          <p className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-6 text-sm text-[var(--muted)]">
            Categories are temporarily unavailable. Open the parts browser to
            retry.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-4 max-[850px]:grid-cols-2 max-[500px]:grid-cols-1">
            {categories.map((category) => (
              <Link
                href={`/parts?category=${encodeURIComponent(category.slug)}`}
                key={category.id}
                className="group relative min-h-[300px] overflow-hidden rounded-xl bg-[#102a48] text-white max-[500px]:min-h-[210px]"
              >
                <Image
                  src={category.imagePath ?? "/assets/workshop-poster.webp"}
                  alt={`${category.name} automotive component category`}
                  fill
                  sizes="(max-width: 500px) 100vw, (max-width: 850px) 50vw, 33vw"
                  unoptimized
                  className="absolute inset-0 size-full object-cover transition duration-500 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#03101fe8] via-[#03101f4d] to-transparent" />
                <div className="absolute inset-x-0 bottom-0 p-6">
                  <b className="font-heading text-[24px]">{category.name}</b>
                  <small className="mt-1 block max-w-[250px] text-[11px] text-[#cfdae7]">
                    {category.description}
                  </small>
                  <FiArrowRight
                    className="absolute bottom-7 right-6"
                    size={20}
                    aria-hidden="true"
                  />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function PhotoStory() {
  const { setDialog } = useSite();
  return (
    <section
      id="source"
      className="grid min-h-[680px] grid-cols-[1.08fr_.92fr] bg-[#071426] text-white max-[960px]:min-h-0 max-[960px]:grid-cols-1"
    >
      <div className="relative min-h-[680px] max-[960px]:min-h-[380px] max-[600px]:min-h-[230px]">
        <Image
          width={100}
          height={92}
          sizes="(max-width: 700px) 82px, 100px"
          quality={70}
          src="/assets/brake.jpg"
          alt="Close view of an automotive brake and wheel assembly"
          className="absolute inset-0 size-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#071426d9] via-transparent to-transparent" />
        <div className="absolute bottom-8 left-[7vw] border-l-[3px] border-[#4e9cff] pl-5">
          <span className="block text-[11px] tracking-wide text-[#a9c8ee]">
            PHOTO RECEIVED
          </span>
          <b className="mt-1 block font-heading text-[23px]">
            We can start from what you can see.
          </b>
        </div>
      </div>
      <div className="flex flex-col justify-center px-[7vw] py-20 max-[700px]:px-4 max-[700px]:py-12">
        <Kicker light>PHOTO-BASED REQUEST</Kicker>
        <h2 className="section-title mt-5">
          Send a photo.
          <br />
          We’ll take it from there.
        </h2>
        <p className="mt-5 max-w-[530px] text-[15px] leading-[1.7] text-[#b8c9dc]">
          You do not need the technical name. Add a clear photo, your vehicle
          details, and a short description of the issue.
        </p>
        <div className="mt-7 max-w-[520px] rounded-xl border border-white/20 bg-white/5 p-5">
          {[
            "Attach a clear raster photo of the part or assembly",
            "Choose a saved vehicle or enter the details manually",
            "Add the delivery area and a short description",
          ].map((instruction) => (
            <div key={instruction} className="flex items-start gap-3 border-b border-white/10 py-3 last:border-0">
              <FiCheck className="mt-0.5 shrink-0 text-[#7ec9a2]" />
              <span className="text-[12px] text-[#c2d1e1]">{instruction}</span>
            </div>
          ))}
        </div>
        <ActionButton
          className="mt-6 w-fit"
          onClick={() => setDialog({ kind: "request", mode: "photo" })}
        >
          Upload a Part Photo
        </ActionButton>
      </div>
    </section>
  );
}

function FeaturedRow({ product }: { product: CatalogueProduct }) {
  const { setDialog, addPart } = useSite();
  return (
    <article className="grid grid-cols-[100px_1fr_auto] items-center gap-4 border-b border-[var(--line)] py-5 max-[700px]:grid-cols-[82px_1fr] max-[700px]:gap-3">
      <button
        className="overflow-hidden rounded-lg"
        onClick={() => setDialog({ kind: "detail", productId: product.id })}
        aria-label={`View sourcing details for ${product.name}`}
      >
        <Image
          src={product.imagePath ?? "/assets/workshop-poster.webp"}
          alt={`${product.name} catalogue photograph`}
          width={200}
          height={184}
          unoptimized
          className="h-[92px] w-[100px] object-cover max-[700px]:w-[82px]"
        />
      </button>
      <div>
        <span className="font-heading text-[11px] font-extrabold tracking-wide text-[var(--accent)]">
          {product.category.name.toUpperCase()}
        </span>
        <b className="mt-1 block font-heading text-[16px]">{product.name}</b>
        <small className="mt-1 block text-[12px] leading-relaxed text-[var(--muted)]">
          {product.description} · From ৳{product.priceFrom}
        </small>
      </div>
      <div className="flex flex-col gap-2 max-[700px]:col-span-2 max-[700px]:flex-row max-[700px]:flex-wrap">
        <button
          className="secondary-button"
          onClick={() =>
            setDialog({ kind: "request", mode: "standard", part: product.name })
          }
        >
          Request quote
        </button>
        <button
          className="secondary-button"
          onClick={() => addPart(product.id)}
        >
          Add to multi-part request
        </button>
      </div>
    </article>
  );
}

function FeaturedParts() {
  const { catalogueProducts } = useSite();
  return (
    <section className="shell grid grid-cols-[.37fr_.63fr] gap-[7vw] py-[110px] max-[900px]:grid-cols-1 max-[700px]:py-[72px]">
      <div>
        <Kicker>AVAILABLE PARTS</Kicker>
        <h2 className="section-title mt-5">
          A real starting point.
          <br />
          Not a fitment promise.
        </h2>
        <p className="mt-5 text-[15px] leading-[1.7] text-[var(--muted)]">
          These catalogue products currently have an eligible supplier offering.
          Final compatibility and pricing are confirmed by quotation.
        </p>
        <Link href="/parts" className="inline-link mt-5">
          Browse all available parts <FiArrowRight aria-hidden="true" />
        </Link>
      </div>
      <div className="border-t border-[var(--line)]">
        {catalogueProducts.slice(0, 3).map((product) => (
          <FeaturedRow product={product} key={product.id} />
        ))}
        {!catalogueProducts.length && (
          <p className="py-8 text-sm text-[var(--muted)]">
            No supplier offerings are currently available.
          </p>
        )}
      </div>
    </section>
  );
}

function Emergency() {
  const { setDialog } = useSite();
  const [part, setPart] = useState("");
  const [area, setArea] = useState("");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDialog({
      kind: "request",
      mode: "urgent",
      part: part.trim(),
      area: area.trim(),
    });
  }
  return (
    <section
      id="emergency"
      className="relative isolate min-h-[650px] overflow-hidden bg-[#071426] text-white max-[960px]:min-h-0"
    >
      <Image
        src="/assets/emergency-courier.webp"
        alt="Courier on a motorcycle carrying a delivery package"
        width={1200}
        height={900}
        className="absolute inset-y-0 right-0 -z-10 h-full w-[53%] object-cover object-[60%_center] max-[960px]:w-full max-[960px]:opacity-35"
      />
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,#071426_0%,#071426_42%,#071426aa_68%,#07142688_100%)]" />
      <div className="shell grid min-h-[650px] grid-cols-[1fr_.73fr] items-center gap-[6vw] py-[75px] max-[960px]:min-h-0 max-[960px]:grid-cols-1 max-[960px]:gap-8 max-[700px]:py-12">
        <div>
          <Kicker light>PRIORITY PARTS SOURCING</Kicker>
          <h2 className="section-title mt-6">
            The car is waiting.
            <br />
            <em className="not-italic text-[#7ab3ff]">
              Which part is holding it up?
            </em>
          </h2>
          <p className="mt-5 max-w-[590px] text-[17px] leading-[1.65] text-[#d0dbe7] max-[700px]:text-[15px]">
            Tell us what the mechanic needs and where the vehicle is. PartArc
            checks suitable suppliers and coordinates the quickest available
            delivery option.
          </p>
          <div className="mt-10 flex max-w-[570px] items-center gap-5 border-t border-white/30 pt-5 max-[600px]:items-start max-[600px]:flex-col max-[600px]:gap-1">
            <b className="shrink-0 font-heading text-[23px]">30–60 min</b>
            <span className="text-[12px] leading-relaxed text-[#aec0d4]">
              Target in eligible areas when the part is available. Final timing
              and any priority charge are confirmed before approval.
            </span>
          </div>
        </div>
        <form
          onSubmit={submit}
          className="rounded-[18px] border border-[var(--line)] bg-[var(--surface-raised)] p-8 text-[var(--heading)] shadow-[0_24px_55px_#0004] max-[960px]:max-w-[560px] max-[600px]:p-6"
        >
          <Kicker>START AN URGENT REQUEST</Kicker>
          <h3 className="mt-3 font-heading text-[25px] font-extrabold">
            What do you need right now?
          </h3>
          <label className="field-label mt-6">
            Part or problem
            <input
              required
              maxLength={160}
              value={part}
              onChange={(event) => setPart(event.target.value)}
              placeholder="e.g. Axio front brake pads"
              className="field-control"
              dir="auto"
            />
          </label>
          <label className="field-label mt-4">
            Where is the vehicle?
            <input
              required
              maxLength={100}
              value={area}
              onChange={(event) => setArea(event.target.value)}
              placeholder="e.g. Tejgaon, Dhaka"
              className="field-control"
              dir="auto"
            />
          </label>
          <ActionButton className="mt-6 w-full">
            Continue urgent request
          </ActionButton>
          <small className="mt-3 block text-[11px] leading-relaxed text-[var(--muted)]">
            This opens the full request form with your details. Area eligibility
            and availability have not been checked.
          </small>
        </form>
      </div>
    </section>
  );
}

function Business() {
  const { setDialog } = useSite();
  return (
    <section
      id="fleet"
      className="grid min-h-[620px] grid-cols-[.9fr_1.1fr] bg-[var(--surface-soft)] max-[960px]:min-h-0 max-[960px]:grid-cols-1"
    >
      <div className="relative min-h-[620px] max-[960px]:min-h-[320px] max-[600px]:min-h-[230px]">
        <Image
          src="/assets/garage-team.webp"
          alt="Professional mechanics maintaining a commercial vehicle in a workshop"
          fill
          sizes="(max-width: 960px) 100vw, 45vw"
          className="absolute inset-0 size-full object-cover object-[53%_center]"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#041021b3] via-transparent to-transparent" />
        <span className="absolute bottom-8 left-[5vw] font-heading text-[11px] font-extrabold tracking-wide text-white">
          WORKSHOP & FLEET PROCUREMENT
        </span>
      </div>
      <div className="px-[7vw] py-[70px] max-[700px]:px-4 max-[700px]:py-12">
        <Kicker>BUILT FOR REPEAT REQUIREMENTS</Kicker>
        <h2 className="section-title mt-4">
          Parts for the work
          <br />
          already in motion.
        </h2>
        <Tabs.Root defaultValue="garage" className="mt-6">
          <Tabs.List
            aria-label="Business customer type"
            className="flex gap-5 border-b border-[var(--line)]"
          >
            <Tabs.Trigger
              value="garage"
              className="min-h-[50px] border-b-[3px] border-transparent font-heading text-[13px] font-bold text-[var(--muted)] data-[state=active]:border-[#2478f2] data-[state=active]:text-[var(--heading)]"
            >
              Independent garages
            </Tabs.Trigger>
            <Tabs.Trigger
              value="fleet"
              className="min-h-[50px] border-b-[3px] border-transparent font-heading text-[13px] font-bold text-[var(--muted)] data-[state=active]:border-[#2478f2] data-[state=active]:text-[var(--heading)]"
            >
              Fleets & businesses
            </Tabs.Trigger>
          </Tabs.List>
          {(["garage", "fleet"] as const).map((mode) => (
            <Tabs.Content value={mode} key={mode} className="pt-6">
              <Kicker>{businessModes[mode].kicker}</Kicker>
              <h3 className="mt-2 max-w-[560px] font-heading text-[24px] font-extrabold leading-snug">
                {businessModes[mode].title}
              </h3>
              <p className="mt-3 max-w-[570px] text-[15px] leading-[1.65] text-[var(--muted-strong)]">
                {businessModes[mode].text}
              </p>
              <div className="my-6 max-w-[610px] border-t border-[#8ca0b6]">
                <span className="block py-3 font-heading text-[10px] font-extrabold tracking-wide text-[var(--accent)]">
                  {businessModes[mode].featureLabel}
                </span>
                {businessModes[mode].features.map((feature) => (
                  <div
                    className="flex items-center gap-3 border-t border-[var(--line)] py-2.5 text-[13px]"
                    key={feature}
                  >
                    <FiCheck className="shrink-0 text-[#16885c]" />
                    <span className="text-[var(--muted-strong)]">{feature}</span>
                  </div>
                ))}
              </div>
              <ActionButton
                onClick={() =>
                  setDialog({
                    kind: "request",
                    mode,
                    fromBasket: mode === "garage",
                  })
                }
              >
                {businessModes[mode].action}
              </ActionButton>
            </Tabs.Content>
          ))}
        </Tabs.Root>
      </div>
    </section>
  );
}

function WhyAndFaq() {
  const { setDialog } = useSite();
  const benefits = [
    [
      "One request, multiple options",
      "Submit the requirement once. Suitable supplier offers can be organized for comparison.",
    ],
    [
      "Compatibility information review",
      "Vehicle, part number, chassis, and photo details are reviewed where applicable.",
    ],
    [
      "Quotations you can compare",
      "Review brand, price, compatibility status, and estimated delivery before approval.",
    ],
    [
      "Coordinated fulfillment",
      "PartArc manages supplier communication and delivery coordination after confirmation.",
    ],
  ];
  const faqs = [
    [
      "Do I need to know the exact part name?",
      "No. A photograph, vehicle information, symptoms, or an old part number can be enough to start reviewing the requirement.",
    ],
    [
      "What will a supplier quotation show?",
      "Where available, the organized quotation can include brand, price, compatibility status, supplier information, and estimated delivery time.",
    ],
    [
      "How is part compatibility checked?",
      "Vehicle model, year, variant, chassis information, part number, and submitted photographs may be reviewed before confirmation.",
    ],
    [
      "When do I pay?",
      "Payment instructions and any advance requirement are confirmed with the approved quotation. This preview does not collect payment.",
    ],
    [
      "Is urgent delivery always available?",
      "No. The 30–60-minute target applies only to eligible areas and available parts. Final timing and priority charges are confirmed before approval.",
    ],
  ];
  return (
    <>
      <section
        id="why"
        className="shell grid grid-cols-[.39fr_.61fr] gap-[7vw] py-[110px] max-[850px]:grid-cols-1 max-[700px]:py-12"
      >
        <div>
          <Kicker>WHY PARTARC</Kicker>
          <h2 className="section-title mt-4">
            You focus on the repair.
            <br />
            <em className="not-italic text-[var(--accent)]">
              We handle the sourcing.
            </em>
          </h2>
          <p className="mt-5 max-w-[450px] text-[15px] leading-[1.65] text-[var(--muted)]">
            One point of contact can take a requirement from the first question
            through supplier options and delivery coordination.
          </p>
        </div>
        <div className="border-t border-[var(--line)]">
          {benefits.map(([title, description], index) => (
            <div
              key={title}
              className="grid grid-cols-[42px_1fr_1.2fr] gap-4 border-b border-[var(--line)] py-6 max-[600px]:grid-cols-[32px_1fr]"
            >
              <span className="font-heading text-[12px] font-extrabold text-[var(--accent)]">
                0{index + 1}
              </span>
              <h3 className="font-heading text-[16px] font-extrabold">
                {title}
              </h3>
              <p className="text-[14px] leading-[1.65] text-[var(--muted)] max-[600px]:col-start-2">
                {description}
              </p>
            </div>
          ))}
        </div>
      </section>
      <section
        id="faq"
        className="bg-[var(--surface-soft)] py-[110px] max-[700px]:py-12"
      >
        <div className="shell grid grid-cols-[.4fr_.6fr] gap-[7vw] max-[850px]:grid-cols-1">
          <div>
            <Kicker>BEFORE YOU REQUEST</Kicker>
            <h2 className="section-title mt-4">
              Clear answers.
              <br />
              No parts jargon required.
            </h2>
            <p className="mt-5 max-w-[430px] text-[15px] leading-[1.65] text-[var(--muted)]">
              The sourcing process is designed for customers who know the exact
              part and customers who only know the problem.
            </p>
            <button
              className="inline-link mt-4"
              onClick={() => setDialog({ kind: "info", topic: "coverage" })}
            >
              Service area information <FiArrowRight />
            </button>
          </div>
          <div className="border-t border-[var(--line)]">
            {faqs.map(([question, answer]) => (
              <details
                key={question}
                className="group border-b border-[var(--line)]"
              >
                <summary className="flex min-h-[72px] cursor-pointer list-none items-center justify-between gap-4 py-3 font-heading text-[16px] font-bold marker:hidden">
                  {question}
                  <span className="shrink-0 text-[24px] font-normal text-[var(--accent)] group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="pb-6 text-[14px] leading-[1.65] text-[var(--muted)]">
                  {answer}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

function FinalCta() {
  const { setDialog } = useSite();
  return (
    <section className="bg-[#0b1b2f] py-[100px] text-white max-[700px]:py-12">
      <div className="shell flex items-end justify-between gap-8 max-[800px]:flex-col max-[800px]:items-start">
        <div>
          <Kicker light>START WITH WHAT YOU KNOW</Kicker>
          <h2 className="section-title mt-4">
            That repair needs a part.
            <br />
            <em className="not-italic text-[#7eb4ff]">
              We can help you find it.
            </em>
          </h2>
          <p className="mt-5 text-[15px] text-[#b6c6d8]">
            Send a name, a photo, or a description. We’ll take the sourcing from
            there.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-start gap-4">
          <ActionButton
            onClick={() => setDialog({ kind: "request", mode: "standard" })}
          >
            Tell us what you need
          </ActionButton>
          <Link
            href="/track"
            className="min-h-11 text-[13px] underline underline-offset-4"
          >
            Track an existing request
          </Link>
        </div>
      </div>
    </section>
  );
}

export function HomePage() {
  return (
    <main id="main-content" tabIndex={-1}>
      <Hero />
      <Recognition />
      <Sourcing />
      <Categories />
      <PhotoStory />
      <FeaturedParts />
      <Emergency />
      <Business />
      <WhyAndFaq />
      <FinalCta />
    </main>
  );
}
