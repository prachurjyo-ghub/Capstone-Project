"use client";

import { useEffect, useState, type FormEvent } from "react";
import { FiLock } from "react-icons/fi";
import { useSite } from "./site-context";
import { Kicker } from "./ui";

export function TrackingPage() {
  const { customer, requests, requestTracking, trackingReference, openLogin } =
    useSite();
  const [reference, setReference] = useState(trackingReference || "");
  const [searched, setSearched] = useState(trackingReference);
  useEffect(() => {
    if (trackingReference) {
      // A request selected elsewhere in the app becomes the tracked route state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setReference(trackingReference);
      setSearched(trackingReference);
    }
  }, [trackingReference]);
  const saved = requests.find(
    (request) => request.reference.toUpperCase() === searched,
  );
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = reference.trim().toUpperCase();
    if (!customer) {
      requestTracking(next);
      return;
    }
    setSearched(next);
  }
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="mx-auto min-h-[720px] w-[92vw] max-w-[1050px] py-[90px] max-[700px]:py-14"
    >
      <Kicker>REQUEST TRACKING</Kicker>
      <h1 className="section-title mt-3">Follow your real sourcing request.</h1>
      <p className="mt-3 max-w-[670px] text-[15px] text-[var(--muted)]">
        Sign in and enter one of your PartsArc request references. Other
        customers’ references are never disclosed.
      </p>
      <form
        onSubmit={submit}
        className="mt-8 flex max-w-[660px] flex-col gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-2 sm:flex-row sm:items-center sm:pl-4"
      >
        <input
          required
          value={reference}
          onChange={(event) => setReference(event.target.value)}
          aria-label="Tracking reference"
          placeholder="Enter your request reference"
          className="field-control min-w-0 flex-1 border-0 bg-transparent py-2 text-sm outline-none"
        />
        <button className="min-h-11 shrink-0 rounded-full bg-[#2478f2] px-5 text-[12px] font-bold text-white">
          Track Request
        </button>
      </form>
      {!customer && (
        <div className="mt-7 rounded-xl border border-[var(--line)] bg-[var(--surface-raised)] p-6">
          <FiLock className="text-[var(--accent)]" size={24} />
          <h2 className="mt-3 font-heading text-xl font-extrabold">
            Sign in to view tracking.
          </h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Tracking data is private and comes only from your account.
          </p>
          <button
            className="secondary-button mt-4"
            onClick={() => openLogin("signin")}
          >
            Sign in
          </button>
        </div>
      )}
      {customer && searched && (
        <div className="mt-7 rounded-xl border border-[var(--line)] bg-[var(--surface-raised)] p-6 sm:p-8">
          {saved ? (
            <>
              <Kicker>{saved.reference}</Kicker>
              <h2 className="mt-3 font-heading text-[26px] font-extrabold">
                {saved.part}
              </h2>
              <p className="mt-3 text-sm text-[var(--muted)]">
                Current sourcing status
              </p>
              <span className="status-pill mt-4 inline-flex">
                {saved.status}
              </span>
              <p className="mt-5 text-xs text-[var(--muted)]">
                For order delivery events and courier references, open Tracking
                in your authenticated dashboard after an order has been created.
              </p>
            </>
          ) : (
            <>
              <Kicker>NO RESULT</Kicker>
              <h2 className="mt-3 font-heading text-[26px] font-extrabold">
                Request not found.
              </h2>
              <p className="mt-3 text-sm text-[var(--muted)]">
                No request with that reference belongs to your account.
              </p>
            </>
          )}
        </div>
      )}
    </main>
  );
}
