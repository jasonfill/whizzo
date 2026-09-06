import { useState, type MouseEvent, type ReactNode } from 'react'
import Wordmark from '../../components/Wordmark'
import { Button, Eyebrow, buttonClass } from '../../components/ui'
import { routeToPath } from '../../paths'
import type { Navigate, Route } from '../../routes'

/**
 * The chrome every marketing page wears, and the pieces they are built from.
 *
 * Two rules hold this whole surface together, and the tests pin both.
 *
 * **A link is an anchor; a button is a door.** Anything that moves between
 * marketing pages renders a real `<a href>` — it can be middle-clicked, hovered
 * for its URL, bookmarked and crawled, none of which is true of a `<button>`
 * that calls `navigate`. Anything that is a `<button>` here goes exactly one
 * place: the way in. Nothing on the signed-out site starts an activity, because
 * a visitor has no learner and practice that lands on no record is a lie told
 * to somebody trying the product.
 *
 * **Grown-up surface, so it is theme-free.** Spark and ink, never a learner's
 * accent — the third rule in `lib/themes.ts`. The one exception is the mascot
 * on the front page, which is pinned to the default theme rather than left to
 * whatever the last person to use this browser chose.
 */

/** Where the same route is turned into an address exactly once. */
function href(route: Route): string {
  return routeToPath(route)
}

/**
 * A real link that still navigates in-app.
 *
 * The modifier check is the whole point of not using a bare `onClick`: a parent
 * cmd-clicking "Pricing" to keep their place expects a second tab, and
 * swallowing that is the sort of small rudeness that makes a site feel like an
 * app pretending to be a site.
 */
export function PageLink({
  to,
  navigate,
  children,
  className = '',
  current,
}: {
  to: Route
  navigate: Navigate
  children: ReactNode
  className?: string
  current?: boolean
}) {
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      return
    }
    event.preventDefault()
    navigate(to)
  }
  return (
    <a
      href={href(to)}
      onClick={follow}
      aria-current={current ? 'page' : undefined}
      className={className}
    >
      {children}
    </a>
  )
}

/** A link wearing the button's clothes. Same press, same anchor semantics. */
export function LinkButton({
  to,
  navigate,
  children,
  variant = 'primary',
  className = '',
}: {
  to: Route
  navigate: Navigate
  children: ReactNode
  variant?: 'primary' | 'secondary' | 'ghost'
  className?: string
}) {
  return (
    <PageLink
      to={to}
      navigate={navigate}
      className={`inline-block text-center ${buttonClass(variant, className)}`}
    >
      {children}
    </PageLink>
  )
}

// --- Navigation ------------------------------------------------------------

interface NavItem {
  route: Route
  label: string
}

const PRODUCT_NAV: NavItem[] = [
  { route: { name: 'features' }, label: 'Features' },
  { route: { name: 'how' }, label: 'How it works' },
  { route: { name: 'pricing' }, label: 'Pricing' },
  { route: { name: 'faq' }, label: 'FAQ' },
]

/**
 * The four audiences, in the order they are worth reading.
 *
 * Parents first because they are who pays; teachers second because one of them
 * brings twenty-five families with them.
 */
export const AUDIENCE_NAV: NavItem[] = [
  { route: { name: 'audience', who: 'parents' }, label: 'For parents' },
  { route: { name: 'audience', who: 'teachers' }, label: 'For teachers' },
  { route: { name: 'audience', who: 'tutors' }, label: 'For tutors' },
  { route: { name: 'audience', who: 'homeschool' }, label: 'For homeschool' },
]

/** Whether two routes name the same page, audience included. */
function samePage(a: Route, b: Route): boolean {
  if (a.name !== b.name) return false
  if (a.name === 'audience' && b.name === 'audience') return a.who === b.who
  return true
}

const navLink =
  'rounded-lg px-3 py-2 text-[15px] font-extrabold text-body transition-colors hover:bg-wash hover:text-ink aria-[current=page]:bg-wash aria-[current=page]:text-ink'

/**
 * Which of these links actually go somewhere for the person reading.
 *
 * The sales pages are signed-out-only by design — a signed-in grown-up has
 * `/upgrade`, which answers the price question about *their* children. But
 * `/privacy` and `/faq` are reference, and they are reachable in both states,
 * so a signed-in reader can land on this chrome. Offering them the funnel from
 * there would be offering links that redirect to the app home.
 */
function siteNav(inApp: boolean): { product: NavItem[]; audiences: NavItem[] } {
  return {
    product: inApp ? PRODUCT_NAV.filter((i) => REACHABLE_IN_APP.has(i.route.name)) : PRODUCT_NAV,
    audiences: inApp ? [] : AUDIENCE_NAV,
  }
}

/** Route names registered in the signed-in table too. Keep in step with App. */
const REACHABLE_IN_APP = new Set(['privacy', 'faq'])

function Header({
  current,
  navigate,
  inApp,
}: {
  current: Route
  navigate: Navigate
  inApp: boolean
}) {
  const [open, setOpen] = useState(false)
  const { product, audiences } = siteNav(inApp)
  const toAuth = () => navigate({ name: inApp ? 'home' : 'auth' })

  const items = [...product, ...audiences]

  return (
    <header className="mb-8">
      <div className="flex items-center justify-between gap-3">
        <PageLink to={{ name: 'marketing' }} navigate={navigate} className="shrink-0">
          <Wordmark accent={false} />
        </PageLink>

        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {product.map((item) => (
            <PageLink
              key={item.label}
              to={item.route}
              navigate={navigate}
              current={samePage(item.route, current)}
              className={navLink}
            >
              {item.label}
            </PageLink>
          ))}
          <span className="mx-2 h-6 w-px bg-hair" aria-hidden />
          <Button variant="ghost" className="px-4 py-2 text-[15px]" onClick={toAuth}>
            {inApp ? 'Back to the app' : 'Sign in'}
          </Button>
          <Button className="px-4 py-2 text-[15px]" onClick={toAuth}>
            Start free
          </Button>
        </nav>

        {/* The one button on the site that is not a door: it opens the doors. */}
        <button
          type="button"
          aria-expanded={open}
          aria-controls="marketing-menu"
          onClick={() => setOpen((was) => !was)}
          className="rounded-xl border-2 border-edge bg-chalk px-4 py-2 text-[15px] font-extrabold text-ink md:hidden"
        >
          {open ? 'Close' : 'Menu'}
        </button>
      </div>

      {/* The audience strip. On the front page these four are the most useful
          thing in the header: a visitor knows which of them they are long
          before they know what the product is called. */}
      <nav
        aria-label="Who it is for"
        className="mt-3 hidden flex-wrap items-center gap-1 border-t border-hair pt-3 md:flex"
      >
        <Eyebrow className="mr-2">Built for</Eyebrow>
        {AUDIENCE_NAV.map((item) => (
          <PageLink
            key={item.label}
            to={item.route}
            navigate={navigate}
            current={samePage(item.route, current)}
            className={navLink}
          >
            {item.label.replace('For ', '')}
          </PageLink>
        ))}
      </nav>

      {open && (
        <nav
          id="marketing-menu"
          aria-label="Main"
          className="mt-3 grid gap-1 rounded-[22px] border border-hair bg-chalk p-3 md:hidden"
        >
          {items.map((item) => (
            <PageLink
              key={item.label}
              to={item.route}
              navigate={navigate}
              current={samePage(item.route, current)}
              className={navLink}
            >
              {item.label}
            </PageLink>
          ))}
          <div className="mt-2 grid gap-2 border-t border-hair pt-3">
            <Button onClick={toAuth}>Create a free account</Button>
            <Button variant="ghost" onClick={toAuth}>
              Sign in
            </Button>
          </div>
        </nav>
      )}
    </header>
  )
}

function Footer({ navigate, inApp }: { navigate: Navigate; inApp: boolean }) {
  const { product, audiences } = siteNav(inApp)
  const columns: Array<{ heading: string; items: NavItem[] }> = [
    { heading: 'Product', items: product },
    { heading: 'Who it is for', items: audiences },
    {
      heading: 'Trust',
      items: [
        { route: { name: 'privacy' } as Route, label: 'Privacy and data' },
        // Only offered where it goes anywhere; `how` is signed-out-only.
        ...(inApp ? [] : [{ route: { name: 'how' } as Route, label: 'Why the numbers hold up' }]),
      ],
    },
  ].filter((c) => c.items.length > 0)

  return (
    <footer className="mt-14 border-t border-hair pt-8">
      <div className="grid gap-8 md:grid-cols-[1.2fr_repeat(3,1fr)]">
        <div>
          <Wordmark accent={false} size={28} />
          <p className="mt-3 max-w-xs text-[15px] font-bold text-muted">
            Spelling, typing and study decks that keep a learner at the edge of what they can
            actually do — and give the grown-up the evidence behind every number.
          </p>
        </div>
        {columns.map((column) => (
          <div key={column.heading}>
            <Eyebrow>{column.heading}</Eyebrow>
            <ul className="mt-2 space-y-1">
              {column.items.map((item) => (
                <li key={item.label}>
                  <PageLink
                    to={item.route}
                    navigate={navigate}
                    className="text-[15px] font-bold text-body hover:text-ink hover:underline"
                  >
                    {item.label}
                  </PageLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="mt-8 border-t border-hair pt-5 text-xs font-bold text-stone">
        No ads, ever. No third-party trackers. Children sign in with a code from their grown-up —
        never an email address.
      </p>
    </footer>
  )
}

// --- Page shell ------------------------------------------------------------

/**
 * Header, content, the closing ask, footer.
 *
 * The closing band is part of the shell rather than something each page
 * remembers to add, because the page a visitor happens to have read to the
 * bottom of is the page that has to offer them the way in.
 */
export function MarketingPage({
  current,
  navigate,
  children,
  closing,
  inApp = false,
}: {
  current: Route
  navigate: Navigate
  children: ReactNode
  closing?: { title: string; body: string }
  /**
   * True when a signed-in grown-up is reading this.
   *
   * Only `/privacy` and `/faq` are registered in both route tables, so only
   * they can be true here. It matters because the rest of the site is
   * signed-out-only by design: leaving the funnel links up for a signed-in
   * reader would offer them links that redirect to the app home, and the
   * closing "create a free account" band would be selling an account they
   * already have.
   */
  inApp?: boolean
}) {
  return (
    <div className="mx-auto w-full max-w-5xl py-4">
      <Header current={current} navigate={navigate} inApp={inApp} />
      {children}
      {!inApp && <ClosingBand navigate={navigate} closing={closing} />}
      <Footer navigate={navigate} inApp={inApp} />
    </div>
  )
}

function ClosingBand({
  navigate,
  closing,
}: {
  navigate: Navigate
  closing?: { title: string; body: string }
}) {
  const toAuth = () => navigate({ name: 'auth' })
  const title = closing?.title ?? 'Start with one child and five minutes.'
  const body =
    closing?.body ??
    'The account is free, the whole curriculum is free, and the first round of spelling tells you where they actually are.'

  return (
    <section className="mt-14 rounded-[26px] bg-ink px-6 py-10 text-center">
      <h2 className="font-display text-3xl font-extrabold tracking-[-0.02em] text-white md:text-4xl">
        {title}
      </h2>
      <p className="mx-auto mt-2 max-w-xl font-bold text-onink">{body}</p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Button onClick={toAuth}>Create a free account</Button>
        <Button variant="ghost" onClick={toAuth}>
          Kids: sign in with a code
        </Button>
      </div>
    </section>
  )
}

// --- Section primitives ----------------------------------------------------

/** The page's own opening: eyebrow, headline, one paragraph, and the ask. */
export function PageHero({
  eyebrow,
  title,
  body,
  children,
}: {
  eyebrow: string
  title: string
  body: string
  children?: ReactNode
}) {
  return (
    <section className="rounded-[26px] bg-chalk p-7 ring-1 ring-hair md:p-10">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h1 className="mt-2 max-w-3xl font-display text-[36px] font-extrabold leading-[1.07] tracking-[-0.02em] text-ink md:text-[46px]">
        {title}
      </h1>
      <p className="mt-4 max-w-2xl text-[17px] leading-relaxed text-body">{body}</p>
      {children && <div className="mt-6 flex flex-wrap items-center gap-3">{children}</div>}
    </section>
  )
}

export function Section({
  eyebrow,
  title,
  lede,
  children,
  className = '',
  id,
}: {
  eyebrow?: string
  title: string
  lede?: string
  children: ReactNode
  className?: string
  id?: string
}) {
  return (
    <section id={id} className={`mt-12 scroll-mt-6 ${className}`}>
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <h2 className="mt-1 font-display text-3xl font-extrabold tracking-[-0.02em] text-ink">
        {title}
      </h2>
      {lede && <p className="mt-2 max-w-2xl text-[17px] leading-relaxed text-body">{lede}</p>}
      <div className="mt-5">{children}</div>
    </section>
  )
}

/** A plain bordered panel — the workhorse behind every grid on the site. */
export function Panel({
  title,
  children,
  className = '',
  emoji,
}: {
  title: string
  children: ReactNode
  className?: string
  emoji?: string
}) {
  return (
    <div className={`rounded-[22px] border border-hair bg-chalk p-5 ${className}`}>
      {emoji && (
        <span className="text-3xl" aria-hidden>
          {emoji}
        </span>
      )}
      <h3 className={`text-xl font-extrabold text-ink ${emoji ? 'mt-2' : ''}`}>{title}</h3>
      <div className="mt-1.5 text-[15px] leading-relaxed text-body">{children}</div>
    </div>
  )
}

export function CheckList({ items, className = '' }: { items: string[]; className?: string }) {
  return (
    <ul className={`space-y-1.5 ${className}`}>
      {items.map((item) => (
        <li key={item} className="flex gap-2 text-[15px] font-bold text-body">
          <span className="text-pine" aria-hidden>
            ✓
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

/** Numbered steps. The number is decoration; the order is the argument. */
export function Steps({ steps }: { steps: Array<{ title: string; body: string }> }) {
  return (
    <ol className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {steps.map((step, index) => (
        <li key={step.title} className="rounded-[22px] border border-hair bg-chalk p-5">
          <div className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-spark">
            {String(index + 1).padStart(2, '0')}
          </div>
          <h3 className="mt-2 text-xl font-extrabold text-ink">{step.title}</h3>
          <p className="mt-2 text-[15px] leading-relaxed text-body">{step.body}</p>
        </li>
      ))}
    </ol>
  )
}

export function FaqList({ items }: { items: Array<{ q: string; a: string }> }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {items.map((item) => (
        <div key={item.q} className="rounded-[22px] bg-quiet p-5">
          <h3 className="text-lg font-extrabold text-ink">{item.q}</h3>
          <p className="mt-1.5 text-[15px] leading-relaxed text-body">{item.a}</p>
        </div>
      ))}
    </div>
  )
}

/**
 * The row of "you are here, the others are there" links.
 *
 * Every audience page carries it, because a tutor who landed on the parents
 * page from a search result should not have to go back to the top to find
 * theirs.
 */
export function OtherAudiences({
  current,
  navigate,
}: {
  current: Route
  navigate: Navigate
}) {
  const others = AUDIENCE_NAV.filter((item) => !samePage(item.route, current))
  return (
    <nav
      aria-label="Other audiences"
      className="mt-10 flex flex-wrap items-center gap-2 rounded-[22px] bg-wash p-5"
    >
      <span className="text-[15px] font-extrabold text-ink">Not quite you?</span>
      {others.map((item) => (
        <PageLink
          key={item.label}
          to={item.route}
          navigate={navigate}
          className="rounded-lg bg-chalk px-3 py-2 text-[15px] font-extrabold text-body ring-1 ring-hair hover:text-ink"
        >
          {item.label}
        </PageLink>
      ))}
    </nav>
  )
}
