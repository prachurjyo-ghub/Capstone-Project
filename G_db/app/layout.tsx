import type { Metadata } from "next";
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-500.css";
import "@fontsource/dm-sans/latin-600.css";
import "@fontsource/manrope/latin-500.css";
import "@fontsource/manrope/latin-600.css";
import "@fontsource/manrope/latin-700.css";
import "@fontsource/manrope/latin-800.css";
import { initializeGarageTheme } from "../components/theme-preference";
import "./garage.css";
import "./garage-dark.css";

export const metadata: Metadata = {
  title: {
    default: "Parts Arc Garage",
    template: "%s | Parts Arc Garage",
  },
  description: "Garage jobs and vehicle inspections.",
};

export default function GarageLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: initializeGarageTheme }} /></head>
      <body>{children}</body>
    </html>
  );
}
