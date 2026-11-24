"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  FiArrowUpRight,
  FiMessageCircle,
  FiPlus,
  FiZap,
} from "react-icons/fi";
import { useSite } from "./site-context";

type PageContext = "home" | "how" | "fleet" | "emergency" | "catalogue";

export function ContextualSourcingAction({ menuOpen }: { menuOpen: boolean }) {
  const pathname = usePathname();
  const { basket, dialog, setDialog } = useSite();
  const [context, setContext] = useState<PageContext>(
    pathname.startsWith("/parts") ? "catalogue" : "home",
  );
  const [heroVisible, setHeroVisible] = useState(pathname === "/");
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    if (pathname !== "/") return;
    const sections = ["home", "how", "fleet", "emergency"]
      .map((id) => document.getElementById(id))
      .filter((section): section is HTMLElement => Boolean(section));
    let frame = 0;
    const updateContext = () => {
      frame = 0;
      const focusLine = window.innerHeight * 0.52;
      const next = sections.find((section) => {
        const bounds = section.getBoundingClientRect();
        return bounds.top <= focusLine && bounds.bottom >= focusLine;
      })?.id;
      setContext(
        next === "how" || next === "fleet" || next === "emergency"
          ? next
          : "home",
      );
    };
    const scheduleUpdate = () => {
      if (!frame) frame = window.requestAnimationFrame(updateContext);
    };
    updateContext();
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    const hero = document.getElementById("home");
    const heroObserver = hero
      ? new IntersectionObserver(
          ([entry]) => setHeroVisible(entry.isIntersecting),
          { threshold: 0.18 },
        )
      : null;
    if (hero && heroObserver) heroObserver.observe(hero);
    return () => {
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      if (frame) window.cancelAnimationFrame(frame);
      heroObserver?.disconnect();
    };
  }, [pathname]);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => setKeyboardOpen(viewport.height < window.innerHeight * 0.72);
    viewport.addEventListener("resize", update);
    return () => viewport.removeEventListener("resize", update);
  }, []);

  if (dialog || menuOpen || keyboardOpen) return null;

  const effectiveContext: PageContext =
    pathname === "/"
      ? context
      : pathname.startsWith("/parts")
        ? "catalogue"
        : "home";
  const effectiveHeroVisible = pathname === "/" && heroVisible;

  const ordinaryBasketAction =
    basket.length > 0 &&
    effectiveContext !== "fleet" &&
    effectiveContext !== "emergency";
  const config = ordinaryBasketAction
    ? {
        label: `Review ${basket.length} ${basket.length === 1 ? "part" : "parts"}`,
        icon: FiArrowUpRight,
        action: () => setDialog({ kind: "basket" }),
      }
    : effectiveContext === "fleet"
      ? {
          label: "Contact Team",
          icon: FiMessageCircle,
          action: () => setDialog({ kind: "request", mode: "fleet" }),
        }
      : effectiveContext === "emergency"
        ? {
            label: "Get Urgent Help",
            icon: FiZap,
            action: () => setDialog({ kind: "request", mode: "urgent" }),
          }
        : {
            label:
              effectiveContext === "how"
                ? "Start a Request"
                : effectiveContext === "catalogue"
                  ? "Request a Part"
                  : "Source a Part",
            icon: FiPlus,
            action: () => setDialog({ kind: "request", mode: "standard" }),
          };
  const Icon = config.icon;

  return (
    <button
      type="button"
      onClick={config.action}
      className={`contextual-sourcing-action fixed right-4 z-30 flex min-h-12 items-center gap-2 rounded-full bg-[#2478f2] px-4 font-heading text-[12px] font-extrabold text-white shadow-[0_14px_36px_rgba(15,82,177,.36)] transition-[transform,opacity] hover:bg-[#1264dc] md:right-6 md:bottom-6 ${
        effectiveHeroVisible
          ? "md:pointer-events-none md:translate-y-3 md:opacity-0"
          : ""
      }`}
      aria-label={config.label}
    >
      <Icon size={17} aria-hidden="true" />
      <span key={config.label}>{config.label}</span>
    </button>
  );
}
