'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { FiEye, FiEyeOff } from 'react-icons/fi'
import { errorMessage, forgotPassword, resetPassword } from '@/lib/api'
import { ActionButton, Kicker } from './ui'

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = await forgotPassword(email.trim())
      setMessage(result.message)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }
  return (
    <AuthCard
      eyebrow="PASSWORD RECOVERY"
      title="Reset your password."
      description="Enter your account email. The response is intentionally the same whether or not an eligible account exists."
    >
      <form onSubmit={submit} className="mt-6 space-y-4">
        <label className="field-label">
          Email address
          <input
            className="field-control"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        {message && (
          <p
            className="rounded-xl bg-[var(--accent-soft)] p-4 text-sm"
            role="status"
          >
            {message}
          </p>
        )}
        {error && (
          <p className="dark-error text-sm" role="alert">
            {error}
          </p>
        )}
        <ActionButton className="w-full" type="submit" disabled={busy}>
          {busy ? 'Sending…' : 'Send reset instructions'}
        </ActionButton>
      </form>
      <Link href="/" className="inline-link mt-5">
        Return to PartArc
      </Link>
    </AuthCard>
  )
}

export function ResetPasswordForm() {
  const token = useSearchParams().get('token') ?? ''
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [complete, setComplete] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    if (!token) return setError('This reset link is missing its token.')
    if (password !== confirm) return setError('The passwords do not match.')
    if (
      password.length < 12 ||
      !/[a-z]/.test(password) ||
      !/[A-Z]/.test(password) ||
      !/\d/.test(password)
    )
      return setError(
        'Use 12 or more characters with uppercase, lowercase, and a number.',
      )
    setBusy(true)
    try {
      await resetPassword(token, password)
      setComplete(true)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }
  return (
    <AuthCard
      eyebrow="PASSWORD RESET"
      title={complete ? 'Password updated.' : 'Choose a new password.'}
      description={
        complete
          ? 'Existing sessions were revoked. Return home and sign in with the new password.'
          : 'Your reset link is time-limited and can be used once.'
      }
    >
      {complete ? (
        <Link href="/" className="inline-link mt-6">
          Return home to sign in
        </Link>
      ) : (
        <form onSubmit={submit} className="mt-6 space-y-4">
          <label className="field-label">
            New password{' '}
            <small>12+ characters, uppercase, lowercase, and a number</small>
            <span className="relative block">
              <input
                className="field-control pr-12"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-md text-[var(--muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--ink)]"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((value) => !value)}
              >
                {showPassword ? (
                  <FiEyeOff aria-hidden="true" />
                ) : (
                  <FiEye aria-hidden="true" />
                )}
              </button>
            </span>
          </label>
          <label className="field-label">
            Confirm new password
            <span className="relative block">
              <input
                className="field-control pr-12"
                type={showConfirm ? 'text' : 'password'}
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                required
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-md text-[var(--muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--ink)]"
                aria-label={
                  showConfirm
                    ? 'Hide confirmed password'
                    : 'Show confirmed password'
                }
                aria-pressed={showConfirm}
                onClick={() => setShowConfirm((value) => !value)}
              >
                {showConfirm ? (
                  <FiEyeOff aria-hidden="true" />
                ) : (
                  <FiEye aria-hidden="true" />
                )}
              </button>
            </span>
          </label>
          {error && (
            <p className="dark-error text-sm" role="alert">
              {error}
            </p>
          )}
          <ActionButton className="w-full" type="submit" disabled={busy}>
            {busy ? 'Updating…' : 'Reset password'}
          </ActionButton>
        </form>
      )}
    </AuthCard>
  )
}

function AuthCard({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <main id="main-content" className="shell min-h-[680px] py-16">
      <section className="dash-card mx-auto max-w-xl p-7 sm:p-10">
        <Kicker>{eyebrow}</Kicker>
        <h1 className="mt-3 font-heading text-[clamp(30px,5vw,42px)] font-extrabold tracking-[-.04em]">
          {title}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">
          {description}
        </p>
        {children}
      </section>
    </main>
  )
}
