import type { Metadata } from 'next'
import { Suspense } from 'react'
import { ResetPasswordForm } from '@/components/recovery-form'
import { PageSkeleton } from '@/components/page-skeleton'

export const metadata: Metadata = { title: 'Reset Password | PartArc' }
export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ResetPasswordForm />
    </Suspense>
  )
}
