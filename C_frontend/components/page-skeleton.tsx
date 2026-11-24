import { Skeleton } from './ui/skeleton';

export function PageSkeleton() {
  return <main id="main-content" className="shell min-h-[720px] py-[90px]" aria-label="Loading content"><Skeleton className="h-4 w-36" /><Skeleton className="mt-6 h-12 w-full max-w-[530px]" /><Skeleton className="mt-4 h-5 w-full max-w-[680px]" /><Skeleton className="mt-10 h-14 w-full max-w-[740px]" /><div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">{[1, 2, 3].map(item => <div key={item} className="overflow-hidden rounded-xl border border-[#e9eff5]"><Skeleton className="h-56 rounded-none" /><div className="space-y-3 p-5"><Skeleton className="h-5 w-3/4" /><Skeleton className="h-4" /><Skeleton className="h-4 w-2/3" /></div></div>)}</div><span className="sr-only">Loading…</span></main>;
}
