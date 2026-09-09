import { Button, Card, Eyebrow } from '../../components/ui'
import type { Navigate, Route } from '../../routes'
import {
  CheckList,
  LinkButton,
  MarketingPage,
  PageHero,
  PageLink,
  Panel,
  Section,
  Steps,
} from './chrome'
import { ENGINE_STEPS, EVIDENCE } from './copy'

/**
 * The credibility page.
 *
 * Every practice app says "adaptive" and "personalised", so those words are
 * worth nothing and the only way to be believed is to publish the mechanism.
 * This page is deliberately the least sales-shaped thing on the site: a
 * formula, a table of session proportions, the promotion rule, and a plain
 * statement of what the model cannot do.
 *
 * It is also the page to send a sceptical teacher or a tutor to, which is why
 * the honest limit at the bottom is on it rather than tucked into an FAQ.
 */
export default function HowItWorksScreen({ navigate }: { navigate: Navigate }) {
  const here: Route = { name: 'how' }
  const toAuth = () => navigate({ name: 'auth' })

  return (
    <MarketingPage
      current={here}
      navigate={navigate}
      closing={{
        title: 'The first round is the placement test.',
        body: 'Nobody has to sit one. Create an account, run one round, and the level you get back came out of words your child actually attempted.',
      }}
    >
      <PageHero
        eyebrow="How it works"
        title="“Adaptive” is a cheap claim. Here is the entire mechanism."
        body="Nothing in this engine is configured by hand. Every number below comes out of work the learner attempted, and the rules that decide which work counts are stricter than the ones that decide what to show next."
      >
        <Button onClick={toAuth}>Try it on one child</Button>
        <LinkButton to={{ name: 'features' }} navigate={navigate} variant="ghost">
          See the whole product
        </LinkButton>
      </PageHero>

      <Section eyebrow="The three rules" title="What the engine is actually doing">
        <Steps steps={ENGINE_STEPS} />
      </Section>

      <Section
        eyebrow="One"
        title="Ability and difficulty share a scale"
        lede="Both sit on the same axis — roughly school grade — which is what lets the model say something useful about a word the learner has never seen."
      >
        <Card>
          <p className="text-[15px] leading-relaxed text-body">
            A word’s difficulty starts at the grade band it is taught in, then moves inside that
            band for length, syllable count and the patterns that reliably catch people out:{' '}
            <code className="font-mono text-[13px] font-bold text-ink">ough</code>, silent openers,
            doubled consonants, <code className="font-mono text-[13px] font-bold text-ink">-ance</code>{' '}
            against <code className="font-mono text-[13px] font-bold text-ink">-ence</code>, French
            borrowings. So <em>cat</em> and <em>grass</em> are not treated as equally hard just
            because both are second grade.
          </p>
          <pre className="mt-4 overflow-x-auto rounded-xl bg-ink p-4 font-mono text-[13px] font-bold text-onink">
            P(correct) = 1 / (1 + e^((difficulty − ability) × 1.15))
          </pre>
          <p className="mt-3 text-[15px] leading-relaxed text-body">
            After each graded attempt the estimate shifts by the gap between what happened and what
            the model expected — the same update an Elo rating uses, and the discrete-response
            cousin of the item response theory behind standardized reading assessments. The learning
            rate starts high, so placement converges in a handful of words, then decays, so one bad
            round cannot undo a month.
          </p>
        </Card>
      </Section>

      <Section
        eyebrow="Two"
        title="Only unaided, checked work moves the level"
        lede="This is the rule everything else rests on. Break it and the number becomes a participation score."
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Panel title="What counts">
            <CheckList
              items={[
                'Spelling from dictation, with no letters shown',
                'A spelling test: no hints, no second chances',
                'Written recall on a deck, checked against the answer',
                'Free recall of a whole set, matched against the key',
              ]}
            />
          </Panel>
          <Panel title="What deliberately does not">
            <CheckList
              items={[
                'Unscrambling letters, or filling in missing ones',
                'Picking the right spelling out of four',
                'Studying the list with the word in front of you',
                'Flashcards, which are self-graded by construction',
                'Any word where a hint was taken',
              ]}
            />
          </Panel>
        </div>
      </Section>

      <Section
        eyebrow="Three"
        title="Every item carries its own review date"
        lede="Right, and the interval climbs. Wrong, and it is due again immediately — in the same sitting, while the moment to fix it is still there."
      >
        <Card>
          <Eyebrow>The interval, in days</Eyebrow>
          <p className="mt-2 font-mono text-2xl font-bold text-ink">1 → 2 → 4 → 8 → 16 → 32 → 60</p>
          <p className="mt-3 text-[15px] leading-relaxed text-body">
            Stretched a little for items below the learner’s level, compressed for items above it.
            Waiting a day to revisit a word somebody got wrong five minutes ago wastes the moment
            they are most primed to fix it — so a missed word comes back in the next round of the
            same sitting. Mastery per item is a recency-weighted share of graded attempts, and an
            item needs two correct in a row before it is called mastered.
          </p>
        </Card>
      </Section>

      <Section
        eyebrow="Four"
        title="A round is built, not shuffled"
        lede="Smart Practice is assembled from the learner’s own history, with review capped on purpose."
      >
        <div className="overflow-x-auto rounded-[22px] border border-hair bg-chalk">
          <table className="w-full min-w-[560px] border-collapse text-left">
            <thead>
              <tr className="border-b border-hair">
                <th className="p-4">
                  <Eyebrow>Share</Eyebrow>
                </th>
                <th className="p-4">
                  <Eyebrow>What</Eyebrow>
                </th>
                <th className="p-4">
                  <Eyebrow>Why</Eyebrow>
                </th>
              </tr>
            </thead>
            <tbody className="text-[15px] text-body">
              {[
                ['up to 40%', 'items they have missed and that are due', 'the whole point of review'],
                ['up to 20%', 'mastered items due for maintenance', 'stop them decaying'],
                [
                  'the rest',
                  'unfinished items from the current level, most winnable first',
                  'forward progress',
                ],
                [
                  'a few',
                  'items from the level above, when ability is running high',
                  'a stretch worth attempting',
                ],
              ].map(([share, what, why]) => (
                <tr key={share} className="border-b border-hair last:border-0">
                  <td className="p-4 align-top font-extrabold text-ink">{share}</td>
                  <td className="p-4 align-top">{what}</td>
                  <td className="p-4 align-top">{why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[15px] font-bold text-muted">
          A round made mostly of words you already got wrong is accurate and demoralising, which is
          why review has a ceiling rather than a floor.
        </p>
      </Section>

      <Section
        eyebrow="Five"
        title="Moving up takes three signals that agree"
        lede="Promotion is not a score. It needs the ability estimate to clear the level, most of that level’s items to be genuinely mastered, and recent graded accuracy to be high."
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Panel title="A second route up">
            A learner who arrives already spelling well above their band tests out on evidence
            alone, rather than grinding through sixty words they can already spell.
          </Panel>
          <Panel title="And an easier route down">
            Demotion triggers more readily than promotion, because being stuck one band too high is
            far more damaging to a child than being one band too low.
          </Panel>
        </div>
      </Section>

      <Section
        eyebrow="Six"
        title="Stars are graded on a curve"
        lede="A learner practicing at their frontier is meant to miss things."
      >
        <Card>
          <p className="text-[15px] leading-relaxed text-body">
            Scoring against a flat 90% would hand out one star forever and teach a child that
            working at their own level is failing. So each round is also scored against what the
            model predicted for that exact set of items: beat your own prediction and the third star
            is yours, whatever level you are on. The results screen shows both numbers, because the
            raw one still matters to the grown-up reading it.
          </p>
        </Card>
      </Section>

      <Section
        eyebrow="The other half"
        title="Knowing something is not one state"
        lede="The mastery ladder is what stops “learned it” meaning four different things on four different days."
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          {[
            { rung: '0', name: 'Encounter', body: 'They have met it.' },
            { rung: '1', name: 'Recognize', body: 'They can pick it out from among others.' },
            { rung: '2', name: 'Recall, cued', body: 'They can produce it with a scaffold.' },
            { rung: '3', name: 'Recall, free', body: 'They can produce it from nothing.' },
          ].map((step) => (
            <div key={step.rung} className="rounded-[22px] border border-hair bg-chalk p-5">
              <div className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-spark">
                Rung {step.rung}
              </div>
              <h3 className="mt-2 text-lg font-extrabold text-ink">{step.name}</h3>
              <p className="mt-1.5 text-[15px] text-body">{step.body}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[15px] font-bold text-muted">
          A rung is recomputed from the answer history rather than stored, so it is never a number
          somebody saved once and got wrong. Ask for mastery of a set by Friday and the batching,
          the rungs each item is asked at, and when a check is worth offering are all derived from
          it.
        </p>
      </Section>

      <Section
        eyebrow="Evidence"
        title="Why the record can be believed"
        lede="These four properties are structural. None of them is a setting, and none of them can be turned off by the person being measured."
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {EVIDENCE.map((item) => (
            <Panel key={item.title} title={item.title}>
              {item.body}
            </Panel>
          ))}
        </div>
      </Section>

      <Section
        eyebrow="Checked, not asserted"
        title="Does it actually work?"
        lede="The engine is run against simulated learners with a hidden true level on every build, and the run is part of the test suite rather than a report somebody wrote once."
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Panel title="Measurement">
            Learners whose ability never changes should be placed on their true level and stay
            there. They converge to within about a tenth of a grade — and, crucially, do not drift
            upward over time.
          </Panel>
          <Panel title="Progression">
            Learners who genuinely improve should be noticed and moved up. Their error rate on an
            item’s third look drops by 20–45% against its first.
          </Panel>
        </div>
      </Section>

      <Section eyebrow="The honest limit" title="What this cannot do">
        <Card>
          <p className="text-[15px] leading-relaxed text-body">
            The server checks <em>how</em> an answer was given, not whether the answer was right —
            re-grading everything would mean holding every deck’s contents server side, and the
            starter decks ship in the app. So a determined child with developer tools can still post
            a wrong answer marked correct. What they cannot do is grade themselves into mastery,
            edit the record afterwards, or make a summary disagree with the answers behind it: the
            counts are recomputed from the answers on arrival, self-graded work is labeled as such,
            and the history is append-only.
          </p>
          <p className="mt-3 text-[15px] leading-relaxed text-body">
            We would rather say that plainly than claim a guarantee we cannot keep.{' '}
            <PageLink to={{ name: 'privacy' }} navigate={navigate} className="underline">
              What we store, and what we do not
            </PageLink>
            .
          </p>
        </Card>
      </Section>
    </MarketingPage>
  )
}
