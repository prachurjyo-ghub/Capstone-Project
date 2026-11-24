import type { Metadata } from 'next'
import { ForgotPasswordForm } from '@/components/recovery-form'

export const metadata: Metadata = { title: 'Forgot Password | PartArc' }
export default function Page() {
  return <ForgotPasswordForm />
}
