"use client";

import { usePathname } from "next/navigation";
import { SiteProvider } from "@/components/site-context";
import { SiteShell } from "@/components/site-shell";

export function StorefrontLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (pathname === "/garages") return children;

  return <SiteProvider><SiteShell>{children}</SiteShell></SiteProvider>;
}
