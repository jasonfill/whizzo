import Mascot from '../../components/Mascot'
import { Button, Card, Eyebrow } from '../../components/ui'
import { money } from '../../lib/plans'
import { PRICE_EXTRA_LEARNER_CENTS, PRICE_FIRST_LEARNER_CENTS, monthlyPriceCents } from '@whizzo/shared'
import { DEFAULT_THEME_ID } from '../../lib/themes'
import type { Navigate, Route } from '../../routes'
import { AUDIENCE_ORDER, AUDIENCE_TEASER, AUDIENCES } from './audiences'
import {
  CheckList,
  FaqList,
  LinkButton,
  MarketingPage,
  Panel,
  PageLink,
  Section,
  Steps,
} from './chrome'
import { CORE_FAQ, ENGINE_STEPS, EVIDENCE, GROWNUP, PROMISE, SUBJECTS, TAGLINE } from './copy'

/**
 * The front page.
 *
 * It used to be the whole site: one scroll carrying the pitch, the engine, the
 * grown-up half, the price and the questions. That was right while there was
 * one thing to say to one kind of visitor, and wrong the moment there were
 * four kinds — a teacher does not need to read a paragraph about siblings
 * before finding out they are never billed.
 *
 * So this page now does one job: say what the thing is, say who it is for, and
 * send each of those people to the page written for them. Every section here
 * is a summary with a way deeper, and nothing on it is the only place a fact
 * appears.
 *
 * A grown-up surface, so it is theme-free: spark and ink, never a learner's
 * accent. See the third rule in `lib/themes.ts`.
 */
export default function MarketingScreen({ navigate }: { navigate: Navigate }) {
  const here: Route = { name: 'marketing' }
  const toAuth = () => navigate({ name: 'auth' })

  return (
    <MarketingPage current={here} navigate={navigate}>
      <Hero onStart={toAuth} />

      <ThePromise navigate={navigate} />

      <Section
        eyebrow="Three subjects, one record"
        title="What is inside"
        lede="One account, one progress record, and a level that means the same thing in every subject it touches."
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {SUBJECTS.map((subject) => (
            <Card key={subject.title}>
              <span className="text-4xl" aria-hidden>
                {subject.emoji}
              </span>
              <h3 className="mt-2 text-2xl font-extrabold text-ink">{subject.title}</h3>
              <p className="mt-1 font-bold text-muted">{subject.body}</p>
              <CheckList className="mt-3" items={subject.points} />
            </Card>
          ))}
        </div>
        <p className="mt-4 text-sm font-bold text-stone">
          <PageLink to={{ name: 'features' }} navigate={navigate} className="underline">
            Everything in the product, in one place →
          </PageLink>
        </p>
      </Section>

      <Audiences navigate={navigate} />

      <Section
        eyebrow="How the adaptive part works"
        title="“Adaptive” is a cheap claim, so here is the whole of it"
        lede="Three rules do all of it, and the second one is the reason the first is worth anything."
      >
        <Steps steps={ENGINE_STEPS} />
        <p className="mt-4 text-sm font-bold text-stone">
          <PageLink to={{ name: 'how' }} navigate={navigate} className="underline">
            The engine in full — ability, the mastery ladder, spacing, and what counts →
          </PageLink>
        </p>
      </Section>

      <Section
        eyebrow="The grown-up half"
        title="Set the work. Read what came back."
        className="rounded-[26px] bg-wash p-7 md:p-10"
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {GROWNUP.map((item) => (
            <Panel key={item.title} title={item.title} className="ring-1 ring-hair">
              {item.body}
            </Panel>
          ))}
        </div>
      </Section>

      <Section
        eyebrow="Why the numbers can be believed"
        title="Most practice apps take the child’s word for it"
        lede="This one does not, and the difference is structural rather than a setting somebody can turn off."
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {EVIDENCE.map((item) => (
            <Panel key={item.title} title={item.title}>
              {item.body}
            </Panel>
          ))}
        </div>
      </Section>

      <Pricing navigate={navigate} />

      <Section eyebrow="Questions" title="Before you sign up">
        <FaqList items={CORE_FAQ.slice(0, 4)} />
        <p className="mt-4 text-sm font-bold text-stone">
          <PageLink to={{ name: 'faq' }} navigate={navigate} className="underline">
            All the questions, including the awkward ones →
          </PageLink>
        </p>
      </Section>
    </MarketingPage>
  )
}

function Hero({ onStart }: { onStart: () => void }) {
  return (
    <section className="grid grid-cols-1 items-center gap-6 rounded-[26px] bg-chalk p-7 ring-1 ring-hair md:grid-cols-[1fr_280px] md:p-10">
      <div>
        <Eyebrow>Spelling · Typing · Study decks</Eyebrow>
        <h1 className="mt-2 font-display text-[44px] font-extrabold leading-[1.05] tracking-[-0.02em] text-ink md:text-[58px]">
          {/* Each beat is unbreakable, so a narrow column wraps between "Prove it."
              and "Keep it." rather than stranding "it." on a line of its own. */}
          {TAGLINE.split(/(?<=\.)\s+/).map((beat, index, all) => (
            <span key={beat}>
              <span className="inline-block">{beat}</span>
              {index < all.length - 1 ? ' ' : ''}
            </span>
          ))}
        </h1>
        <p className="mt-4 max-w-xl text-[19px] font-bold leading-snug text-ink">
          Practice that knows what your child can actually do.
        </p>
        <p className="mt-3 max-w-xl text-[17px] leading-relaxed text-body">
          Whizzo works out a learner’s real level from the work they attempt, then keeps them at the
          edge of it. Set the work, and every task closes on a round the app graded — never on a
          child saying it is done.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button onClick={onStart}>Create a free account</Button>
          <Button variant="ghost" onClick={onStart}>
            I already have an account
          </Button>
        </div>
        <p className="mt-4 text-sm font-bold text-stone">
          The whole curriculum is free · no ads · a child never needs an email address
        </p>
      </div>
      <div className="flex items-end justify-center">
        {/* Pinned rather than themed: the front door is brand chrome, and a
            theme left in this browser by whoever used the app here last is not
            a reason for a visitor to be met by a different character. */}
        <Mascot
          mood="cheer"
          themeId={DEFAULT_THEME_ID}
          color="#FF6A2B"
          size={220}
          className="animate-floaty"
        />
      </div>
    </section>
  )
}

/**
 * The tagline, unpacked.
 *
 * Three words is a promise only if each one can be pointed at. This section
 * does the pointing: one card per word, each naming the rule in the app that
 * makes it true, and a way through to the page where that rule is shown in
 * full. The copy lives in `copy.ts` next to the tagline it explains.
 */
function ThePromise({ navigate }: { navigate: Navigate }) {
  return (
    <Section
      eyebrow="The promise"
      title="Three words, and what each one is held to"
      lede="A tagline is cheap. These are the three rules the product is built around, and none of them is a setting somebody can switch off."
    >
      <ol className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {PROMISE.map((beat, index) => (
          <li key={beat.word} className="rounded-[22px] border border-hair bg-chalk p-5">
            <div className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-spark">
              {String(index + 1).padStart(2, '0')}
            </div>
            <h3 className="mt-1 font-display text-3xl font-extrabold tracking-[-0.02em] text-ink">
              {beat.word}.
            </h3>
            <p className="mt-2 text-lg font-extrabold text-ink">{beat.title}</p>
            <p className="mt-2 text-[15px] leading-relaxed text-body">{beat.body}</p>
            <CheckList className="mt-3" items={beat.points} />
          </li>
        ))}
      </ol>
      <p className="mt-4 text-sm font-bold text-stone">
        <PageLink to={{ name: 'how' }} navigate={navigate} className="underline">
          How each of these is enforced, rule by rule →
        </PageLink>
      </p>
    </Section>
  )
}

/**
 * The four doors.
 *
 * High on the page on purpose: a visitor knows which of these they are before
 * they know what the product is called, and the fastest way to sell one thing
 * to four people is to let each of them pick their own page.
 */
function Audiences({ navigate }: { navigate: Navigate }) {
  return (
    <Section
      eyebrow="For parents, teachers and tutors"
      title="Which of these are you?"
      lede="The same product, the same screens and the same permissions for all four — what changes is who pays, and it is never the teacher or the tutor."
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {AUDIENCE_ORDER.map((id) => {
          const audience = AUDIENCES[id]
          const teaser = AUDIENCE_TEASER[id]
          return (
            <PageLink
              key={id}
              to={{ name: 'audience', who: id }}
              navigate={navigate}
              className="group rounded-[22px] border border-hair bg-chalk p-5 transition-colors hover:border-edge hover:bg-wash"
            >
              <span className="text-3xl" aria-hidden>
                {teaser.emoji}
              </span>
              <h3 className="mt-2 text-xl font-extrabold text-ink">{audience.eyebrow}</h3>
              <p className="mt-1.5 text-[15px] leading-relaxed text-body">{teaser.line}</p>
              <p className="mt-3 text-[15px] font-extrabold text-spark group-hover:underline">
                Read the {audience.nav.toLowerCase()} page →
              </p>
            </PageLink>
          )
        })}
      </div>
    </Section>
  )
}

function Pricing({ navigate }: { navigate: Navigate }) {
  return (
    <Section
      eyebrow="What it costs"
      title="The learning is free. You pay for a child, not for an account."
      lede={`${money(PRICE_FIRST_LEARNER_CENTS)} a month for one child, ${money(
        monthlyPriceCents(3),
      )} for three. Coverage belongs to the child, so a tutor or a teacher working with them sees everything and is never asked for money.`}
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Panel title="Free, permanently" emoji="🎈">
          Every grade level, every activity, the mastery ladder, spaced review, and work set by a
          parent, a tutor or a teacher. Nothing a learner needs is ever behind the card.
        </Panel>
        <Panel title="Covered, per child" emoji="🔎" className="ring-2 ring-sun">
          {money(PRICE_FIRST_LEARNER_CENTS)} a month for the first child and{' '}
          {money(PRICE_EXTRA_LEARNER_CENTS)} for each one after. It buys the receipts: full history,
          the word-by-word report, retention, rewards, printables and export.
        </Panel>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <LinkButton to={{ name: 'pricing' }} navigate={navigate} variant="ghost">
          See what coverage includes
        </LinkButton>
        <p className="text-sm font-bold text-stone">
          Payments are not switched on yet — every account is free today.
        </p>
      </div>
    </Section>
  )
}
