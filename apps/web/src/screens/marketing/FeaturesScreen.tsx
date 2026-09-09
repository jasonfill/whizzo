import { Button, Card, Eyebrow, Pill } from '../../components/ui'
import { COVERED_PERKS, FREE_PERKS } from '../../lib/plans'
import type { Navigate, Route } from '../../routes'
import {
  CheckList,
  LinkButton,
  MarketingPage,
  PageHero,
  PageLink,
  Panel,
  Section,
} from './chrome'
import { ACTIVITY_TABLE } from './copy'

/**
 * Everything the product does, in one place.
 *
 * The front page is an argument; this is a catalog, and it is written for the
 * visitor who has already decided they are interested and now wants to know
 * whether the specific thing they need is here. That reader is best served by
 * being able to scan, so every block is the same shape: what it is, then the
 * bullets, and no paragraph doing work a bullet could do.
 *
 * The activity table is generated from the app's own registries rather than
 * typed out. A marketing page that lists activities by hand is a page that will
 * one day claim an activity counts toward the level when it does not.
 */

interface Block {
  id: string
  /** The label in the jump nav — the heading is a sentence and makes a poor one. */
  nav: string
  eyebrow: string
  title: string
  lede: string
  points: string[]
}

const BLOCKS: Block[] = [
  {
    id: 'spelling',
    nav: 'Spelling',
    eyebrow: 'Subject',
    title: 'Adaptive spelling, 2nd through 8th grade',
    lede: '420 words across 42 lists, each organized by the rule it teaches rather than by the week it falls in — short vowels, magic e, bossy R, -tion, homophones, Greek and Latin roots, silent letters, -able and -ible, and the rule breakers.',
    points: [
      'The level is found from the first handful of words, with no placement test to sit',
      'Every word has an example sentence, read aloud for context',
      'Dictation uses the browser’s own voice — no audio files, and a spoken-word fallback where there is no voice',
      'Proofreading distractors are built from real error patterns, not random typos',
      'Moving up a grade takes three separate signals, so one lucky round does not do it',
      'Your own lists paste straight in: one word per line, sentence after a tab, a pipe or a dash',
    ],
  },
  {
    id: 'typing',
    nav: 'Typing',
    eyebrow: 'Subject',
    title: 'The full touch-typing course',
    lede: 'Home row to numbers, with hands and a keyboard on screen while the learner works, then arcade rounds for the part that only speed fixes.',
    points: [
      'Guided lessons with finger placement shown as it is needed',
      'Speed and accuracy tracked key by key, so the weak keys are known',
      'Stars graded on a curve rather than on one fixed threshold',
      'An arcade round and a collection to build, for the days practice needs a reason',
    ],
  },
  {
    id: 'decks',
    nav: 'Study decks',
    eyebrow: 'Subject',
    title: 'Study decks for everything else',
    lede: 'Two-sided cards — vocabulary, capitals, dates, formulas, conjugations — running on the same engine as spelling instead of on a shuffle.',
    points: [
      'Five modes, including free recall of an entire set',
      'Math, fractions and figures render properly on a card, and typed answers are graded against the equation',
      'Direction can be flipped: term first, definition first, or mixed',
      'Starter decks ship with the app and never count against your own',
    ],
  },
  {
    id: 'ladder',
    nav: 'The mastery ladder',
    eyebrow: 'The engine',
    title: 'The mastery ladder, and the path through it',
    lede: 'Knowing something is not one state. An item moves from having been met, to being recognized among others, to being produced with a scaffold, to being produced from nothing — and the app asks at the rung the learner is actually on.',
    points: [
      'Every rung is recomputed from the answer history, never stored and trusted',
      'Assign a goal on a set — "master this by Friday" — and the batching, the rungs and the checks are derived',
      'New items arrive in small batches rather than forty at once',
      'A mastery check is offered when a batch is ready for one, never sprung on a learner set up to fail',
      'Response times are recorded and read: knowing it and being able to use it are different things',
    ],
  },
  {
    id: 'work',
    nav: 'Setting work',
    eyebrow: 'For grown-ups',
    title: 'Setting work that closes itself',
    lede: 'A task is a piece of work with a target, not a note in a planner. It appears on the child’s home screen with a Start button that opens exactly that activity.',
    points: [
      'One definition, many learners: the same task goes to two siblings or a whole class in one action',
      'Each learner finishes their own copy, and a parent never learns who else was given it',
      'Tasks close on a graded round, in the same transaction that records it',
      'A score bar can be required, and is measured against answers the app checked',
      'Erasing progress reopens the tasks those rounds had closed',
      'Due dates, overdue flags and per-learner state on one screen',
    ],
  },
  {
    id: 'library',
    nav: 'Your library',
    eyebrow: 'For grown-ups',
    title: 'A library that belongs to you',
    lede: 'Decks and lists can belong to a grown-up rather than to a learner, which is the difference between material you reuse and material filed under whichever student was on screen when you made it.',
    points: [
      'Reusable across every learner you work with, in any family',
      'Assigning is what makes a learner able to open it — nothing else in your library comes with it',
      'Library content is readable by the people it was set for and writable only by you',
      'Withdrawing the work closes the deck again',
      'Material built from one document stays grouped as one document',
    ],
  },
  {
    id: 'documents',
    nav: 'Documents',
    eyebrow: 'For grown-ups',
    title: 'Turn a document into practice',
    lede: 'Hand over a worksheet, a chapter or a study guide and get practice sets back, reviewed by you before anything lands.',
    points: [
      'The cost is quoted before the run starts — nothing is spent without being shown first',
      'Metered by page rather than by document, because a page is what actually costs something',
      'A half-price option for work that can wait until tonight',
      'A hard stop rather than an overage: no surprise bills on a product bought for children',
      'What it built is shown for review before it joins your library',
    ],
  },
  {
    id: 'rewards',
    nav: 'Rewards',
    eyebrow: 'For grown-ups',
    title: 'Rewards that cannot be talked into existence',
    lede: 'Promise something real — an ice cream, an hour of something — attached to a condition the app can check.',
    points: [
      'Earning is derived from checked answers, in the same transaction as the round',
      'There is no "mark as earned" button anywhere, for anyone',
      'Whether you handed it over is your claim, recorded and attributed as one',
      'Conditions can hang off a task, a mastered set, a count of mastered items, or a checkpoint',
      'Offers can expire, cap their number of awards, or be canceled',
    ],
  },
  {
    id: 'reporting',
    nav: 'Reporting',
    eyebrow: 'For grown-ups',
    title: 'Reporting with the working shown',
    lede: 'Open any round and read every answer in the order it was given: what was asked, what was written, how long it took, whether a hint was used, and whether the app checked it or the learner graded themselves.',
    points: [
      'Level by grade, and accuracy measured over checked answers only',
      'Word-by-word and card-by-card mastery, including every miss',
      'Retention: what is sticking, and what is about to slip',
      'Family shows every child at once — outstanding work, overdue, last practiced, minutes and questions this week, streak',
      'Printable weekly progress sheets, and CSV export of the lot',
    ],
  },
  {
    id: 'learners',
    nav: 'Accounts and access',
    eyebrow: 'Accounts',
    title: 'Children, tutors, teachers and who lets them in',
    lede: 'A child gets a full record without an email address. A grown-up gets access only when the person who owns that record grants it.',
    points: [
      'Children sign in with a code and a secret number their grown-up sets',
      'A tutor or teacher mints one code that stands for them, and families redeem it',
      'Minting grants nothing — the grant happens when a family accepts, for the children they choose',
      'A family can see who they are letting in, and what it allows, before accepting',
      'A guardian who was let in cannot pass that access on',
      'Disconnect at any time; withdrawing a code never evicts the families already connected',
    ],
  },
  {
    id: 'register',
    nav: 'Themes and register',
    eyebrow: 'Presentation',
    title: 'Ten worlds, and a register that suits the learner',
    lede: 'A theme is paint. So is age. Neither one is allowed anywhere near what is being taught or what counts as evidence.',
    points: [
      'Ten themes, each with its own character, palette and collection',
      'Praise, celebration, timers and round length follow the learner’s age band',
      'An older student gets shorter praise, no confetti and longer rounds',
      'A theme never changes the curriculum, the difficulty, or the rate a reward is earned at',
    ],
  },
]

export default function FeaturesScreen({ navigate }: { navigate: Navigate }) {
  const here: Route = { name: 'features' }
  const toAuth = () => navigate({ name: 'auth' })

  return (
    <MarketingPage
      current={here}
      navigate={navigate}
      closing={{
        title: 'All of it is in the free account.',
        body: 'Everything a learner needs is free permanently. Paying covers a child’s reporting, and there is nothing to pay today.',
      }}
    >
      <PageHero
        eyebrow="Features"
        title="Three subjects, one engine, and a record that can be checked."
        body="Whizzo is a practice suite for 2nd grade upwards with a grown-up half bolted on properly: work you set, evidence you can read, and a library that belongs to you rather than to whichever child you made it for."
      >
        <Button onClick={toAuth}>Create a free account</Button>
        <LinkButton to={{ name: 'how' }} navigate={navigate} variant="ghost">
          How the engine works
        </LinkButton>
      </PageHero>

      <nav aria-label="On this page" className="mt-6 flex flex-wrap gap-2">
        {BLOCKS.map((block) => (
          <a
            key={block.id}
            href={`#${block.id}`}
            className="rounded-lg bg-quiet px-3 py-1.5 text-[13px] font-extrabold text-body hover:bg-wash hover:text-ink"
          >
            {block.nav}
          </a>
        ))}
      </nav>

      {BLOCKS.map((block) => (
        <Section
          key={block.id}
          id={block.id}
          eyebrow={block.eyebrow}
          title={block.title}
          lede={block.lede}
        >
          <div className="rounded-[22px] border border-hair bg-chalk p-6">
            <CheckList items={block.points} />
          </div>
        </Section>
      ))}

      <Activities />

      <Section
        eyebrow="Free and covered"
        title="What costs nothing, and what a payment adds"
        lede="The split is the same everywhere in the product: never gate learning, gate leverage."
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card>
            <Pill className="bg-quiet text-ink">Free, for everyone</Pill>
            <CheckList className="mt-3" items={FREE_PERKS} />
          </Card>
          <Card className="ring-2 ring-sun">
            <Pill className="bg-sun/30 text-ink">Covering a child adds</Pill>
            <CheckList className="mt-3" items={COVERED_PERKS} />
          </Card>
        </div>
        <p className="mt-4 text-sm font-bold text-stone">
          <PageLink to={{ name: 'pricing' }} navigate={navigate} className="underline">
            What it costs, and why it is priced per child →
          </PageLink>
        </p>
      </Section>
    </MarketingPage>
  )
}

/**
 * Every activity, and whether it moves the level.
 *
 * Worth a table rather than a list because the interesting column is the last
 * one: most of these are practice, and saying so plainly is what makes the two
 * that count worth trusting.
 */
function Activities() {
  return (
    <Section
      eyebrow="The catalog"
      title="Every activity, and whether it counts"
      lede="Practice activities are good for learning and are deliberately kept out of the ability estimate. Only unaided, checked work moves a level."
    >
      <div className="overflow-x-auto rounded-[22px] border border-hair bg-chalk">
        <table className="w-full min-w-[640px] border-collapse text-left">
          <thead>
            <tr className="border-b border-hair">
              <th className="p-4">
                <Eyebrow>Activity</Eyebrow>
              </th>
              <th className="p-4">
                <Eyebrow>What it does</Eyebrow>
              </th>
              <th className="p-4">
                <Eyebrow>Counts toward the level</Eyebrow>
              </th>
            </tr>
          </thead>
          <tbody>
            {ACTIVITY_TABLE.map((row) => (
              <tr key={`${row.subject}-${row.name}`} className="border-b border-hair last:border-0">
                <td className="p-4 align-top">
                  <div className="font-extrabold text-ink">
                    <span aria-hidden>{row.emoji}</span> {row.name}
                  </div>
                  <div className="text-[13px] font-bold text-stone">{row.subject}</div>
                </td>
                <td className="p-4 align-top text-[15px] text-body">{row.blurb}</td>
                <td className="p-4 align-top">
                  <span
                    className={`font-extrabold ${row.counts ? 'text-pine' : 'text-stone'}`}
                  >
                    {row.counts ? 'Yes' : 'No'}
                  </span>
                  {row.note && (
                    <div className="text-[13px] font-bold text-stone">{row.note}</div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <Panel title="Typing is counted separately">
          A typing lesson records keystrokes rather than answers, so its rounds are labeled as
          having no per-question record instead of being quietly treated like graded work.
        </Panel>
        <Panel title="A hint ends the evidence, not the round">
          Ask for help on a word and that word stops counting toward the level. The practice is
          still worth doing; it is just no longer a measurement.
        </Panel>
      </div>
    </Section>
  )
}
