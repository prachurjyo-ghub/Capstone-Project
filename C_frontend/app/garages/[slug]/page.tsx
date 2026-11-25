"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import "../garage-finder.css";

type Garage = { name: string; type: string; area: string; phone: string; address: string; hours: string; description: string; services: string[] };
const api = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api/v1";

export default function GarageDetail() {
  const { slug } = useParams<{ slug: string }>();
  const [garage, setGarage] = useState<Garage>();
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    fetch(`${api}/garages/${encodeURIComponent(slug)}`).then(async (response) => {
      if (!response.ok) throw new Error(response.status === 404 ? "This garage is no longer listed." : "Could not load this garage.");
      if (current) setGarage((await response.json()).data);
    }).catch((failure: unknown) => { if (current) setError(failure instanceof Error ? failure.message : "Could not load this garage."); });
    return () => { current = false; };
  }, [slug]);
  return <main className="garage-finder"><div className="gf-wrap pt-8">
    <Link className="gf-link" href="/garages">← Find a garage</Link>
    {error && <p role="alert">{error}</p>}
    {garage ? <article className="gf-card mt-4">
      <p className="gf-meta">{garage.type} · {garage.area}</p>
      <h1 className="text-3xl font-bold">{garage.name}</h1>
      <p>{garage.description}</p><p>{garage.address}</p>{garage.hours && <p>{garage.hours}</p>}
      <ul className="gf-tags">{garage.services.map((service) => <li key={service}>{service}</li>)}</ul>
      <a className="gf-link" href={`tel:${garage.phone.replace(/[ -]/g, "")}`}>Call {garage.phone}</a>
    </article> : !error && <p role="status">Loading garage…</p>}
  </div></main>;
}
