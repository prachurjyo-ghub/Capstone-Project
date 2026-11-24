"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FiArrowUpRight, FiChevronDown, FiClock, FiMapPin, FiSearch, FiTool, FiTruck, FiX } from "react-icons/fi";

const areas = ["Mirpur", "Dhanmondi", "Uttara"];
const services = ["Diagnostics", "Brakes", "AC service", "Electrical", "Body repair", "Routine service"];
const types = ["General workshop", "Specialist workshop", "Body shop"];

const garages = [
  { name: "Mirpur Motor Works", area: "Mirpur", type: "General workshop", services: ["Brakes", "Diagnostics", "Routine service"], address: "Block B, Mirpur 10, Dhaka", hours: "Sat–Thu · 9:00 AM–7:00 PM", description: "General inspections, brake checks and scheduled servicing for passenger cars." },
  { name: "Northline Auto Care", area: "Mirpur", type: "Specialist workshop", services: ["Electrical", "AC service", "Diagnostics"], address: "Section 11, Mirpur, Dhaka", hours: "Sat–Thu · 10:00 AM–7:00 PM", description: "Vehicle electrical checks, air conditioning diagnostics and fault tracing." },
  { name: "Workshop 11 Body & Paint", area: "Mirpur", type: "Body shop", services: ["Body repair"], address: "Section 12, Mirpur, Dhaka", hours: "Sat–Thu · 9:00 AM–6:00 PM", description: "Body panel inspections and assessment of scratches, dents and paint damage." },
  { name: "Lake Road Auto Centre", area: "Dhanmondi", type: "General workshop", services: ["Diagnostics", "Brakes", "Routine service"], address: "Road 8, Dhanmondi, Dhaka", hours: "Sat–Thu · 9:00 AM–6:00 PM", description: "General vehicle checks and routine maintenance." },
  { name: "Sector Seven Auto", area: "Uttara", type: "Specialist workshop", services: ["Electrical", "AC service"], address: "Sector 7, Uttara, Dhaka", hours: "Sat–Thu · 10:00 AM–7:00 PM", description: "Auto electrical and air conditioning inspections." },
];

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
      <span className="gf-control">
        {icon}
        <select id={`garage-${name}`} name={name} defaultValue={value} required={!empty}>
          {empty && <option value="">{empty}</option>}
          {options.map((option) => <option key={option}>{option}</option>)}
        </select>
        <FiChevronDown aria-hidden="true" />
      </span>
    </div>
  );
}

export function GarageFinder() {
  const router = useRouter();
  const query = useSearchParams();
  const area = areas.find((item) => item === query.get("area")) ?? areas[0];
  const service = services.find((item) => item === query.get("service")) ?? "";
  const type = types.find((item) => item === query.get("type")) ?? "";
  const matches = garages.filter((garage) =>
    garage.area === area && (!service || garage.services.includes(service)) && (!type || garage.type === type),
  );
  const [selected, setSelected] = useState<(typeof garages)[number] | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  function search(nextArea: string, nextService = "", nextType = "") {
    const params = new URLSearchParams({ area: nextArea });
    if (nextService) params.set("service", nextService);
    if (nextType) params.set("type", nextType);
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
          <div className="gf-brand"><span className="gf-brand-icon"><FiTool aria-hidden="true" /></span> Parts Ark</div>
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
                <p aria-live="polite">{matches.length} {matches.length === 1 ? "workshop" : "workshops"} found</p>
              </div>
              <span className="gf-preview">Sample listings</span>
            </div>

            {matches.length ? (
              <ul className="gf-grid">
                {matches.map((garage) => (
                  <li className="gf-card" key={garage.name}>
                    <div className="gf-card-top"><span className="gf-card-icon"><FiTool aria-hidden="true" /></span><span>{garage.type}</span></div>
                    <h3>{garage.name}</h3>
                    <p className="gf-meta"><FiMapPin aria-hidden="true" /> {garage.address}</p>
                    <ul className="gf-tags" aria-label="Offered services">{garage.services.map((item) => <li key={item}>{item}</li>)}</ul>
                    <button className="gf-link" type="button" onClick={() => {
                      setSelected(garage);
                      dialog.current?.showModal();
                    }}>View garage <FiArrowUpRight aria-hidden="true" /></button>
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
          </section>
        </div>

        <dialog className="gf-dialog" ref={dialog} aria-labelledby="garage-detail-title">
          {selected && (
            <>
              <button className="gf-close" type="button" aria-label="Close garage detail" onClick={() => dialog.current?.close()}><FiX /></button>
              <span className="gf-card-icon"><FiTool aria-hidden="true" /></span>
              <p className="gf-meta">{selected.type}</p>
              <h2 id="garage-detail-title">{selected.name}</h2>
              <p>{selected.description}</p>
              <p className="gf-meta"><FiMapPin aria-hidden="true" /> {selected.address}</p>
              <p className="gf-meta"><FiClock aria-hidden="true" /> {selected.hours}</p>
              <ul className="gf-tags" aria-label="Offered services">{selected.services.map((item) => <li key={item}>{item}</li>)}</ul>
            </>
          )}
        </dialog>
      </main>
    </div>
  );
}
