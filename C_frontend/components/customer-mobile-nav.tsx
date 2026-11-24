"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FiClipboard, FiHome, FiSearch } from "react-icons/fi";
import { useSite } from "./site-context";

const itemClass = (active: boolean) =>
  `relative flex min-h-14 flex-1 flex-col items-center justify-center gap-1 rounded-2xl text-[10px] font-extrabold transition-colors ${
    active
      ? "bg-[var(--accent-soft)] text-[var(--accent)]"
      : "text-[var(--muted)] hover:text-[var(--heading)]"
  }`;

export function CustomerMobileNav({ hidden = false }: { hidden?: boolean }) {
  const pathname = usePathname();
  const { customer, dashboardView, dialog, openDashboard } = useSite();
  if (dialog || hidden) return null;

  const requestsActive =
    pathname.startsWith("/dashboard") && dashboardView === "requests";

  return (
    <nav
      className="customer-mobile-nav fixed inset-x-4 z-40 grid grid-cols-3 gap-1 rounded-[22px] border border-[var(--line)] bg-[var(--surface)]/92 p-1.5 shadow-[0_16px_44px_rgba(7,20,38,.22)] backdrop-blur-xl md:hidden"
      aria-label="Customer mobile navigation"
    >
      <Link
        href="/"
        aria-current={pathname === "/" ? "page" : undefined}
        className={itemClass(pathname === "/")}
      >
        <FiHome size={20} aria-hidden="true" />
        Home
      </Link>
      <Link
        href="/parts"
        aria-current={pathname.startsWith("/parts") ? "page" : undefined}
        className={itemClass(pathname.startsWith("/parts"))}
      >
        <FiSearch size={20} aria-hidden="true" />
        Find Parts
      </Link>
      {customer ? (
        <button
          type="button"
          onClick={() => openDashboard("requests")}
          aria-current={requestsActive ? "page" : undefined}
          className={itemClass(requestsActive)}
        >
          <FiClipboard size={20} aria-hidden="true" />
          My Requests
        </button>
      ) : (
        <Link
          href="/track"
          aria-current={pathname.startsWith("/track") ? "page" : undefined}
          className={itemClass(pathname.startsWith("/track"))}
        >
          <FiClipboard size={20} aria-hidden="true" />
          Track Request
        </Link>
      )}
    </nav>
  );
}
