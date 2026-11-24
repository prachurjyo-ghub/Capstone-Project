'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { FiArrowUpRight } from 'react-icons/fi';

export function ActionButton({ children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return <button {...props} className={`inline-flex min-h-12 items-center justify-between gap-6 rounded-full bg-[#2478f2] px-5 py-2 font-heading text-[13px] font-extrabold text-white transition hover:bg-[#1264dc] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#80b4ff] ${className}`}>{children}<span className="grid size-8 shrink-0 place-items-center rounded-full bg-white/15"><FiArrowUpRight size={17} aria-hidden="true" /></span></button>;
}

export function Kicker({ children, light = false }: { children: ReactNode; light?: boolean }) {
  return <span className={`block font-heading text-[11px] font-extrabold tracking-[.11em] ${light ? 'text-[#83b8ff]' : 'text-[var(--accent)]'}`}>{children}</span>;
}
