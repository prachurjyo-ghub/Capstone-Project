import type { Metadata } from "next";
import { Suspense } from "react";
import { GarageFinder } from "./garage-finder";
import "./garage-finder.css";

export const metadata: Metadata = {
  title: "Find a Garage | Parts Arc",
  description: "Search for a workshop by area, service and garage type.",
};

export default function GaragesPage() {
  return (
    <Suspense fallback={<main className="gf-loading">Loading Garage Finder…</main>}>
      <GarageFinder />
    </Suspense>
  );
}
