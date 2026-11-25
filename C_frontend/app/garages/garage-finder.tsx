"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FiArrowUpRight, FiCheck, FiChevronDown, FiMapPin, FiSearch, FiTool, FiTruck } from "react-icons/fi";

import * as Select from "@/components/ui/select";

const areas = ["Mirpur", "Dhanmondi", "Uttara"];
const services = ["Diagnostics", "Brakes", "AC service", "Electrical", "Body repair", "Routine service"];
const types = ["General workshop", "Specialist workshop", "Body shop"];

type Garage = { slug: string; name: string; area: string; type: string; services: string[]; address: string; phone: string; hours: string; description: string };
const api = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api/v1";

function SearchField({ label, name, icon, value, options, empty }: {
  label: string;
  name: string;
  icon: React.ReactNode;
  value: string;
  options: string[];
  empty?: string;
}) {
  return (
    <div className="gf-field">
      <label htmlFor={`garage-${name}`}>{label}</label>
      <Select.Root name={name} defaultValue={value || "any"} required={!empty}>
        <Select.Trigger id={`garage-${name}`} className="gf-control">
          {icon}
          <Select.Value />
          <Select.Icon asChild><FiChevronDown aria-hidden="true" /></Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content className="gf-options" position="popper" sideOffset={5} collisionPadding={12}>
            <Select.Viewport>
              {(empty ? ["any", ...options] : options).map((option) => (
                <Select.Item className="gf-option" value={option} key={option}>
                  <Select.ItemText>{option === "any" ? empty : option}</Select.ItemText>
                  <Select.ItemIndicator><FiCheck aria-hidden="true" /></Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </div>
  );
}

export function GarageFinder() {
  const router = useRouter();
  const query = useSearchParams();
  const area = areas.find((item) => item === query.get("area")) ?? areas[0];
  const service = services.find((item) => item === query.get("service")) ?? "";
  const type = types.find((item) => item === query.get("type")) ?? "";
  const page = Math.max(1, Math.min(1000, Math.trunc(Number(query.get("page"))) || 1));
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ items: Garage[]; total: number; key: string; error?: string }>();
  const searchKey = new URLSearchParams({ area, page: String(page), ...(service && { service }), ...(type && { type }) }).toString();
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${api}/garages?${searchKey}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load garages. Try the search again.");
        const payload = await response.json();
        setResult({ ...payload.data, key: searchKey });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ items: [], total: 0, key: searchKey, error: "Could not load garages. Try again." });
      });
    return () => controller.abort();
  }, [searchKey, retry]);
  const current = result?.key === searchKey ? result : undefined;
  const matches = current?.items ?? [];

  function search(nextArea: string, nextService = "", nextType = "", nextPage = 1) {
    const params = new URLSearchParams({ area: nextArea });
    if (nextService && nextService !== "any") params.set("service", nextService);
    if (nextType && nextType !== "any") params.set("type", nextType);
    if (nextPage > 1) params.set("page", String(nextPage));
    router.push(`/garages?${params}`, { scroll: false });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    search(String(form.get("area")), String(form.get("service")), String(form.get("type")));
  }

  return (
    <div className="garage-finder">
      <header className="gf-top">
        <div className="gf-wrap gf-top-inner">
          <div className="gf-brand"><span className="gf-brand-icon"><FiTool aria-hidden="true" /></span> Parts Arc</div>
          <span className="gf-top-label">Garage Finder</span>
        </div>
      </header>

      <main>
        <section className="gf-hero" aria-labelledby="finder-title">
          <div className="gf-wrap gf-hero-inner">
            <p className="gf-location"><FiMapPin aria-hidden="true" /> Dhaka workshop directory</p>
            <h1 id="finder-title">Find a garage<span>.</span></h1>
            <p>Find a workshop in your area that offers the service your car needs.</p>
          </div>
        </section>

        <div className="gf-wrap gf-content">
          <form className="gf-search" onSubmit={submit} key={query.toString()} aria-label="Search garages">
            <SearchField label="Area" name="area" icon={<FiMapPin aria-hidden="true" />} value={area} options={areas} />
            <SearchField label="Service" name="service" icon={<FiTool aria-hidden="true" />} value={service} options={services} empty="Any service" />
            <SearchField label="Garage type" name="type" icon={<FiTruck aria-hidden="true" />} value={type} options={types} empty="Any type" />
            <button type="submit" className="gf-primary"><FiSearch aria-hidden="true" /> Search garages</button>
          </form>

          <section className="gf-results" aria-labelledby="garage-results">
            <div className="gf-results-heading">
              <div>
                <h2 id="garage-results">Garages in {area}</h2>
                <p aria-live="polite">{current && !current.error ? `${current.total} ${current.total === 1 ? "workshop" : "workshops"} found` : ""}</p>
              </div>
            </div>

            {!current ? <p role="status">Loading garages…</p> : current.error ? <div className="gf-empty"><p role="alert">{current.error}</p><button type="button" className="gf-link" onClick={() => setRetry((value) => value + 1)}>Retry</button></div> : matches.length ? (
              <ul className="gf-grid">
                {matches.map((garage) => (
                  <li className="gf-card" key={garage.slug}>
                    <div className="gf-card-top"><span className="gf-card-icon"><FiTool aria-hidden="true" /></span><span>{garage.type}</span></div>
                    <h3>{garage.name}</h3>
                    <p className="gf-meta"><FiMapPin aria-hidden="true" /> {garage.address}</p>
                    <ul className="gf-tags" aria-label="Offered services">{garage.services.map((item) => <li key={item}>{item}</li>)}</ul>
                    <Link className="gf-link" href={`/garages/${garage.slug}`}>View garage <FiArrowUpRight aria-hidden="true" /></Link>
                    <a className="gf-link" href={`tel:${garage.phone.replace(/[ -]/g, "")}`}>Call workshop</a>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="gf-empty">
                <FiSearch aria-hidden="true" />
                <h3>No matching garages</h3>
                <p>Try a different service or garage type in {area}.</p>
                <button className="gf-link" type="button" onClick={() => search(area)}>Clear service and type</button>
              </div>
            )}
            {current && !current.error && current.total > 24 && (
              <div className="flex gap-4">
                {page > 1 && <button className="gf-link" type="button" onClick={() => search(area, service, type, page - 1)}>Previous</button>}
                {page * 24 < current.total && <button className="gf-link" type="button" onClick={() => search(area, service, type, page + 1)}>Next</button>}
              </div>
            )}
          </section>
        </div>

      </main>
    </div>
  );
}
