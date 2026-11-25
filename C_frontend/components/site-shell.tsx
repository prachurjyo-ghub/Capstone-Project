'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  FiBell,
  FiClipboard,
  FiGrid,
  FiLogIn,
  FiMenu,
  FiMoon,
  FiPlus,
  FiSettings,
  FiSun,
  FiX,
} from 'react-icons/fi'
import { useSite } from './site-context'
import { SiteDialog } from './site-dialog'
import { communicationApi, type InAppNotification } from '@/lib/api'
import { CustomerMobileNav } from './customer-mobile-nav'
import { ContextualSourcingAction } from './contextual-sourcing-action'

function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      href="/"
      aria-label="PartsArc home"
      className="flex shrink-0 items-center gap-2.5 text-white"
    >
      <span className={`grid ${compact ? 'size-8 sm:size-10' : 'size-10'} place-items-center bg-[#2478f2] [clip-path:polygon(24%_0,76%_0,100%_50%,76%_100%,24%_100%,0_50%)]`}>
        <FiSettings size={21} aria-hidden="true" />
      </span>
      <span className={`font-heading ${compact ? 'text-xl sm:text-[22px]' : 'text-[22px]'} font-extrabold leading-none tracking-tight`}>
        Parts<span className="text-[#4a96ff]">Arc</span>
        <small className="mt-1 hidden font-body text-[8px] font-semibold tracking-[.14em] text-[#8fa1b8] lg:block">
          PARTS PROCUREMENT PARTNER
        </small>
      </span>
    </Link>
  )
}

function FooterGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <details className="mobile-footer-group border-t border-white/15 py-1">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between font-heading text-sm font-bold marker:hidden">
          {title}<span aria-hidden="true">+</span>
        </summary>
        <div className="footer-links pb-3">{children}</div>
      </details>
      <div className="footer-links desktop-footer-group"><b>{title}</b>{children}</div>
    </>
  )
}

export function SiteShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const {
    setDialog,
    openDashboard,
    openLogin,
    customer,
    requests,
    dialog,
    toast,
    theme,
    toggleTheme,
  } = useSite()
  const [menuOpen, setMenuOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [notifications, setNotifications] = useState<InAppNotification[]>([])
  const [unread, setUnread] = useState(0)
  const [scrolled, setScrolled] = useState(false)
  const [headerHidden, setHeaderHidden] = useState(false)
  const lastScrollY = useRef(0)
  const notificationButtonRef = useRef<HTMLButtonElement>(null)
  const notificationPanelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!notificationsOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !notificationButtonRef.current?.contains(event.target) && !notificationPanelRef.current?.contains(event.target)) {
        setNotificationsOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setNotificationsOpen(false)
        notificationButtonRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [notificationsOpen])
  useEffect(() => {
    // Route navigation closes the transient mobile menu.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMenuOpen(false)
  }, [pathname])
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => {
    if (!customer) {
      // Logging out clears session-owned notification state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNotifications([])
      setUnread(0)
      return
    }
    let active = true
    let inFlight = false
    let failures = 0
    let retryAfter = 0
    const load = async () => {
      if (document.visibilityState !== 'visible' || inFlight || Date.now() < retryAfter) return
      inFlight = true
      try {
        const page = await communicationApi.notifications()
        failures = 0
        retryAfter = 0
        if (active) {
          setNotifications(page.items)
          setUnread(page.unreadCount)
        }
      } catch {
        failures += 1
        const backoff = Math.min(300000, 30000 * 2 ** Math.min(failures, 4))
        retryAfter = Date.now() + backoff + Math.floor(Math.random() * 5000)
      } finally {
        inFlight = false
      }
    }
    void load()
    const timer = window.setInterval(load, 30000)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      active = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [customer])
  useEffect(() => {
    let frame = 0
    const update = () => {
      frame = 0
      const current = window.scrollY
      const delta = current - lastScrollY.current
      setScrolled(current > 20)
      if (menuOpen || dialog) {
        setHeaderHidden(false)
      } else if (current < 72) {
        setHeaderHidden(false)
      } else if (Math.abs(delta) >= 8) {
        setHeaderHidden(delta > 0)
      }
      lastScrollY.current = current
    }
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [dialog, menuOpen])
  const nav = [
    { label: 'Find Parts', href: '/parts' },
    { label: 'How Sourcing Works', href: '/#how' },
    { label: 'Garages & Fleets', href: '/#fleet' },
    { label: 'Emergency', href: '/#emergency' },
  ]
  const accountAction = () =>
    customer ? openDashboard('overview') : openLogin()
  return (
    <>
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <header
        className={`customer-header sticky top-0 z-50 border-b px-4 text-white transition-[transform,background-color,border-color,box-shadow] duration-200 sm:px-[4vw] ${
          scrolled
            ? 'border-white/12 bg-[#071426]/96 shadow-[0_8px_30px_rgba(3,12,24,.22)] backdrop-blur-xl'
            : 'border-white/8 bg-[#071426]/90 backdrop-blur-md'
        } ${headerHidden ? '-translate-y-full md:translate-y-0' : 'translate-y-0'}`}
        data-hidden={headerHidden ? 'true' : 'false'}
        data-scrolled={scrolled ? 'true' : 'false'}
      >
        <div className="mx-auto flex min-h-16 w-full max-w-[1320px] items-center gap-2 sm:gap-4 md:min-h-[72px]">
          <Logo compact />
          <nav
            id="main-nav"
            aria-label="Main navigation"
            className={`${menuOpen ? 'flex' : 'hidden'} absolute inset-x-0 top-full max-h-[calc(100dvh-64px)] flex-col gap-1 overflow-y-auto border-t border-white/10 bg-[#071426]/98 p-4 shadow-xl backdrop-blur-xl xl:static xl:ml-auto xl:flex xl:max-h-none xl:flex-row xl:items-center xl:gap-6 xl:overflow-visible xl:border-0 xl:bg-transparent xl:p-0 xl:shadow-none`}
          >
            {nav.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                onClick={() => setMenuOpen(false)}
                className="rounded-lg px-3 py-3 text-[12px] font-semibold text-[#c9d4e2] hover:bg-white/5 hover:text-white xl:px-0 xl:py-2"
              >
                {item.label}
              </Link>
            ))}
            <div className="mt-2 flex flex-wrap gap-2 border-t border-white/10 pt-4 xl:hidden">
              {customer ? (
                <button
                  className="nav-pill"
                  onClick={() => {
                    setMenuOpen(false)
                    openDashboard('requests')
                  }}
                >
                  <FiClipboard className="mr-2" /> My Requests ({requests.length})
                </button>
              ) : (
                <Link
                  onClick={() => setMenuOpen(false)}
                  href="/track"
                  className="nav-pill"
                >
                  Track Request
                </Link>
              )}
              <button
                className="nav-pill"
                onClick={() => {
                  setMenuOpen(false)
                  accountAction()
                }}
              >
                {customer ? 'Dashboard' : 'Sign in'}{' '}
                {customer ? (
                  <FiGrid className="ml-2" />
                ) : (
                  <FiLogIn className="ml-2" />
                )}
              </button>
              <button
                className="nav-pill nav-pill-cta"
                onClick={() => {
                  setMenuOpen(false)
                  setDialog({ kind: 'request', mode: 'standard' })
                }}
              >
                Source a Part <FiPlus className="ml-1" aria-hidden="true" />
              </button>
            </div>
          </nav>
          <div className="ml-auto flex items-center gap-1 sm:gap-2 xl:ml-0">
            <button
              onClick={toggleTheme}
              aria-label={
                theme === 'dark'
                  ? 'Switch to light theme'
                  : 'Switch to dark theme'
              }
              aria-pressed={theme === 'dark'}
              title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
              className="grid size-11 shrink-0 place-items-center rounded-full border border-white/20 text-white hover:bg-white/10"
            >
              {theme === 'dark' ? <FiSun size={19} /> : <FiMoon size={19} />}
            </button>
            {customer && (
              <button
                ref={notificationButtonRef}
                onClick={() => { setMenuOpen(false); setNotificationsOpen((value) => !value) }}
                aria-label={`${unread} unread notifications`}
                aria-expanded={notificationsOpen}
                aria-controls="customer-notifications"
                className="relative grid size-11 shrink-0 place-items-center rounded-full border border-white/20 text-white hover:bg-white/10"
              >
                <FiBell size={19} />
                {unread > 0 && (
                  <span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-[#2478f2] px-1 text-[10px] font-bold">
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
              </button>
            )}
            {customer ? (
              <button
                className="hidden min-h-11 items-center text-[12px] font-bold text-[#d7e1ed] hover:text-white xl:inline-flex"
                onClick={() => openDashboard('requests')}
              >
                My Requests
                <span className="ml-2 rounded-full bg-[#2478f2] px-2 py-0.5 text-[10px]">
                  {requests.length}
                </span>
              </button>
            ) : (
              <Link
                href="/track"
                className="hidden min-h-11 items-center text-[12px] font-bold text-[#d7e1ed] hover:text-white xl:inline-flex"
              >
                Track Request
              </Link>
            )}
            <button
              className="nav-pill hidden xl:inline-flex"
              onClick={accountAction}
            >
              {customer ? 'Dashboard' : 'Sign in'}{' '}
              {customer ? (
                <FiGrid className="ml-2" />
              ) : (
                <FiLogIn className="ml-2" />
              )}
            </button>
            <button
              className="nav-pill nav-pill-cta hidden xl:inline-flex"
              onClick={() => setDialog({ kind: 'request', mode: 'standard' })}
            >
              Source a Part <FiPlus className="ml-1" aria-hidden="true" />
            </button>
            <button
              className="grid size-11 shrink-0 place-items-center rounded-lg text-white hover:bg-white/10 xl:hidden"
              aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
              aria-controls="main-nav"
              aria-expanded={menuOpen}
              onClick={() => { setNotificationsOpen(false); setMenuOpen((value) => !value) }}
            >
              {menuOpen ? <FiX size={25} /> : <FiMenu size={25} />}
            </button>
          </div>
        </div>
        {customer && notificationsOpen && (
          <div ref={notificationPanelRef} id="customer-notifications" role="region" aria-label="Notifications" className="absolute right-[4vw] top-full z-50 mt-2 w-[min(370px,92vw)] rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3 text-[var(--ink)] shadow-2xl">
            <div className="flex items-center justify-between border-b border-[var(--line)] px-2 pb-2">
              <b className="text-sm">Notifications</b>
              {unread > 0 && (
                <button
                  className="text-xs font-bold text-[var(--accent)]"
                  onClick={() => {
                    void communicationApi.readAllNotifications()
                    setUnread(0)
                    setNotifications((items) =>
                      items.map((item) => ({ ...item, isRead: true })),
                    )
                  }}
                >
                  Mark all read
                </button>
              )}
            </div>
            <div className="max-h-[360px] overflow-auto">
              {notifications.map((item) => (
                <button
                  key={item.id}
                  className="flex w-full items-start gap-3 border-b border-[var(--line)] px-2 py-3 text-left last:border-0"
                  onClick={() => {
                    if (!item.isRead) {
                      void communicationApi.readNotification(item.id)
                      setUnread((value) => Math.max(0, value - 1))
                      setNotifications((items) =>
                        items.map((value) =>
                          value.id === item.id
                            ? { ...value, isRead: true }
                            : value,
                        ),
                      )
                    }
                    if (item.entityType === 'CONVERSATION')
                      openDashboard('messages')
                    else if (item.entityType === 'ORDER')
                      openDashboard('tracking')
                    setNotificationsOpen(false)
                  }}
                >
                  <span
                    className={`mt-1.5 size-2 shrink-0 rounded-full ${item.isRead ? 'bg-[var(--line)]' : 'bg-[var(--accent)]'}`}
                  />
                  <span>
                    <b className="block text-xs">{item.title}</b>
                    <span className="mt-1 block text-xs leading-relaxed text-[var(--muted)]">
                      {item.body}
                    </span>
                  </span>
                </button>
              ))}
              {!notifications.length && (
                <p className="py-8 text-center text-xs text-[var(--muted)]">
                  No notifications yet.
                </p>
              )}
            </div>
          </div>
        )}
      </header>
      {children}
      <footer className="bg-[#071426] text-white">
        <div className="mx-auto grid w-[92vw] max-w-[1320px] gap-3 py-10 sm:grid-cols-2 sm:gap-10 sm:py-16 lg:grid-cols-[2fr_1fr_1fr_1fr] lg:gap-14">
          <div>
            <Logo />
            <p className="mb-5 mt-4 max-w-[340px] text-[14px] leading-relaxed text-[#a3b3c7] sm:mb-0 sm:mt-6 sm:text-[15px]">
              Automotive parts sourcing, supplier coordination, and delivery for
              drivers, workshops, and fleet operators.
            </p>
          </div>
          <FooterGroup title="Customer">
            <Link href="/parts">Find Parts</Link>
            <button
              onClick={() => setDialog({ kind: 'request', mode: 'standard' })}
            >
              Request a Part
            </button>
            <button onClick={() => openDashboard('overview')}>
              Customer Dashboard
            </button>
            <button onClick={() => openDashboard('requests')}>
              My Requests
            </button>
            <Link href="/track">Track Request</Link>
          </FooterGroup>
          <FooterGroup title="Business">
            <button
              onClick={() => setDialog({ kind: 'request', mode: 'urgent' })}
            >
              Emergency Delivery
            </button>
            <button
              onClick={() =>
                setDialog({ kind: 'request', mode: 'garage', fromBasket: true })
              }
            >
              Garage Procurement
            </button>
            <button
              onClick={() => setDialog({ kind: 'request', mode: 'fleet' })}
            >
              Fleet & Corporate Supply
            </button>
          </FooterGroup>
          <FooterGroup title="Support">
            <button
              onClick={() => setDialog({ kind: 'info', topic: 'contact' })}
            >
              Contact
            </button>
            <button
              onClick={() => setDialog({ kind: 'info', topic: 'coverage' })}
            >
              Service Areas
            </button>
            <Link href="/#faq">FAQs</Link>
            <button onClick={() => setDialog({ kind: 'info', topic: 'terms' })}>
              Terms & Privacy
            </button>
            <button
              onClick={() => setDialog({ kind: 'info', topic: 'credits' })}
            >
              Photography Credits
            </button>
          </FooterGroup>
        </div>
        <div className="mx-auto flex w-[92vw] max-w-[1320px] flex-wrap justify-between gap-3 border-t border-white/20 py-5 text-[11px] text-[#a3b3c7]">
          <span>© 2026 PartsArc</span>
          <b className="text-white">THE RIGHT PART. THE RIGHT TIME.</b>
          <span>Bangladesh</span>
        </div>
      </footer>
      <div className="h-24 md:hidden" aria-hidden="true" />
      <SiteDialog />
      <CustomerMobileNav hidden={menuOpen} />
      <ContextualSourcingAction menuOpen={menuOpen} />
      <div
        role="status"
        aria-live="polite"
        className={`pointer-events-none fixed right-5 z-[70] max-w-xs rounded-xl bg-[#102a48] px-5 py-3 text-sm text-white shadow-xl transition-opacity bottom-24 md:bottom-20 ${toast ? 'opacity-100' : 'opacity-0'}`}
      >
        {toast}
      </div>
    </>
  )
}
