import { Suspense } from 'react';
import { PartsBrowser } from '@/components/parts-browser';
import { PageSkeleton } from '@/components/page-skeleton';

export default function Page() { return <Suspense fallback={<PageSkeleton />}><PartsBrowser /></Suspense>; }
