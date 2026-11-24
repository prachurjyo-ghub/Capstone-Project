'use client'

import Link from 'next/link'
import { useState, type FormEvent } from 'react'
import { FiEye, FiEyeOff, FiLock, FiMail, FiShield } from 'react-icons/fi'
import * as Dialog from './ui/dialog'
import { useSite } from './site-context'
import { ActionButton, Kicker } from './ui'

export function AuthForm({
  initialMode,
}: {
  initialMode: 'signin' | 'create'
}) {
  const { authenticate, sessionNotice, setDialog } = useSite()
  const [mode, setMode] = useState(initialMode)
  const [name, setName] = useState('')
  const [preferredName, setPreferredName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function switchMode(next: 'signin' | 'create') {
    setMode(next)
    setError('')
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    if (mode === 'create' && name.trim().length < 2) {
      setError('Enter your full name.')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter a valid email address.')
      return
    }
    if (
      mode === 'create' &&
      (password.length < 12 ||
        !/[a-z]/.test(password) ||
        !/[A-Z]/.test(password) ||
        !/\d/.test(password))
    ) {
      setError(
        'Use 12 or more characters with uppercase, lowercase, and a number.',
      )
      return
    }
    if (mode === 'create' && phone && !/^\+[1-9]\d{7,14}$/.test(phone.trim())) {
      setError('Use international phone format, for example +8801700000000.')
      return
    }
    if (mode === 'create' && password !== confirm) {
      setError('The passwords do not match.')
      return
    }
    setBusy(true)
    const result = await authenticate({
      mode,
      email: email.trim(),
      password,
      name: name.trim(),
      preferredName: preferredName.trim(),
      phone: phone.trim(),
    })
    if (result) setError(result)
    setBusy(false)
  }

  return (
    <div className="auth-panel">
      <Kicker>PARTARC CUSTOMER ACCESS</Kicker>
      <Dialog.Title className="dialog-title">
        {mode === 'signin' ? 'Welcome back.' : 'Create your customer account.'}
      </Dialog.Title>
      <Dialog.Description className="dialog-description">
        {mode === 'signin'
          ? 'Sign in to manage your profile, delivery addresses, and saved vehicles.'
          : 'Registration always creates a customer account. Supplier access is invitation-only.'}
      </Dialog.Description>
      <div
        className="mt-6 grid grid-cols-2 gap-2 rounded-full bg-[var(--surface-soft)] p-1"
        role="group"
        aria-label="Account mode"
      >
        <button
          type="button"
          onClick={() => switchMode('signin')}
          aria-pressed={mode === 'signin'}
          className={`min-h-11 rounded-full px-4 text-sm font-bold ${mode === 'signin' ? 'bg-[var(--surface)] text-[var(--ink)] shadow-sm' : 'text-[var(--muted)]'}`}
        >
          Sign in
        </button>
        <button
          type="button"
          onClick={() => switchMode('create')}
          aria-pressed={mode === 'create'}
          className={`min-h-11 rounded-full px-4 text-sm font-bold ${mode === 'create' ? 'bg-[var(--surface)] text-[var(--ink)] shadow-sm' : 'text-[var(--muted)]'}`}
        >
          Create account
        </button>
      </div>
      <form onSubmit={submit} className="mt-5 space-y-4">
        {mode === 'create' && (
          <>
            <label className="field-label">
              Full name
              <input
                className="field-control"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="name"
                maxLength={120}
                required
              />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="field-label">
                Preferred name <small>Optional</small>
                <input
                  className="field-control"
                  value={preferredName}
                  onChange={(event) => setPreferredName(event.target.value)}
                  maxLength={80}
                />
              </label>
              <label className="field-label">
                Mobile <small>Optional · international format</small>
                <input
                  className="field-control"
                  type="tel"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="+8801700000000"
                  autoComplete="tel"
                />
              </label>
            </div>
          </>
        )}
        <label className="field-label">
          Email address
          <span className="relative block">
            <FiMail
              aria-hidden="true"
              className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--muted)]"
            />
            <input
              className="field-control auth-input"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </span>
        </label>
        <label className="field-label">
          Password{' '}
          {mode === 'create' && (
            <small>12+ characters, uppercase, lowercase, and a number</small>
          )}
          <span className="relative block">
            <FiLock
              aria-hidden="true"
              className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--muted)]"
            />
            <input
              className="field-control auth-input pr-12"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={
                mode === 'create' ? 'new-password' : 'current-password'
              }
              minLength={mode === 'create' ? 12 : 1}
              maxLength={128}
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
        {mode === 'create' && (
          <label className="field-label">
            Confirm password
            <span className="relative block">
              <input
                className="field-control pr-12"
                type={showConfirm ? 'text' : 'password'}
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
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
        )}
        {(error || sessionNotice) && (
          <div
            className="rounded-lg border border-[#d98585] bg-[#fff1f1] p-3 text-sm text-[#a32a2a] dark-error"
            role="alert"
          >
            {error || sessionNotice}
          </div>
        )}
        <ActionButton
          type="submit"
          disabled={busy}
          className="w-full disabled:cursor-wait disabled:opacity-65"
        >
          {busy
            ? 'Please wait…'
            : mode === 'signin'
              ? 'Sign in'
              : 'Create customer account'}
        </ActionButton>
      </form>
      {mode === 'signin' && (
        <Link
          href="/forgot-password"
          onClick={() => setDialog(null)}
          className="mt-4 flex min-h-11 items-center justify-center text-sm font-bold text-[var(--accent)] hover:underline"
        >
          Forgot your password?
        </Link>
      )}
      <div className="mt-5 flex gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface-soft)] p-4 text-[12px] leading-relaxed text-[var(--muted)]">
        <FiShield
          size={20}
          className="mt-0.5 shrink-0 text-[var(--accent)]"
          aria-hidden="true"
        />
        <p>
          <b className="text-[var(--ink)]">Secure session.</b> Access tokens
          stay in memory. The server stores the rotating refresh token in an
          HttpOnly cookie.
        </p>
      </div>
    </div>
  )
}
