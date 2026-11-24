import type { Metadata } from 'next';
import { DashboardPage } from '@/components/dashboard-page';

export const metadata: Metadata = { title: 'Customer Dashboard | PartArc' };
export default function Page() { return <DashboardPage />; }
