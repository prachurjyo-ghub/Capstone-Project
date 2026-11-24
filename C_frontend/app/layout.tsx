import type { Metadata } from 'next';
import '@fontsource/manrope/latin-500.css';
import '@fontsource/manrope/latin-600.css';
import '@fontsource/manrope/latin-700.css';
import '@fontsource/manrope/latin-800.css';
import '@fontsource/dm-sans/latin-400.css';
import '@fontsource/dm-sans/latin-500.css';
import '@fontsource/dm-sans/latin-600.css';
import '@fontsource/dm-sans/latin-700.css';
import './globals.css';
import { SiteProvider } from '@/components/site-context';
import { SiteShell } from '@/components/site-shell';

export const metadata: Metadata = {
  title: 'PartArc — Automotive parts sourcing, organized',
  description: 'Automotive parts sourcing, supplier quotation coordination, and delivery for drivers, garages, and fleets in Bangladesh.'
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: "try{document.documentElement.dataset.theme=['dark','\"dark\"'].includes(localStorage.getItem('partarc-theme'))?'dark':'light'}catch{document.documentElement.dataset.theme='light'}" }} /></head><body><SiteProvider><SiteShell>{children}</SiteShell></SiteProvider></body></html>;
}
