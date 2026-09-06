import { useAuth } from '../../auth/AuthProvider'
import { Button, Card } from '../../components/ui'
import type { Navigate, Route } from '../../routes'
import {
  CheckList,
  FaqList,
  LinkButton,
  MarketingPage,
  PageHero,
  Panel,
  Section,
} from './chrome'

/**
 * What is stored, what is not, and who can see it.
 *
 * A product children use is sold to the adult who worries about it, so this is
 * a page rather than a line in the footer. It is written in plain English on
 * purpose and says so: it describes how the thing is built, which is the part
 * a parent can act on, and it does not pretend to be the legal document.
 *
 * Everything on it is a property of the schema rather than a promise about
 * intentions — a child cannot read another child's rows because the database
 * refuses, not because the app remembers not to ask.
 */
export default function PrivacyScreen({ navigate }: { navigate: Navigate }) {
  const { status } = useAuth()
  const here: Route = { name: 'privacy' }
  const toAuth = () => navigate({ name: 'auth' })

  return (
    <MarketingPage
      current={here}
      navigate={navigate}
      // Reachable signed in as well as out; the chrome drops the funnel.
      inApp={status === 'signed-in'}
      closing={{
        title: 'A record your child can build and nobody can quietly rewrite.',
        body: 'No ads, no trackers, no email address for a child, and an export button for everything in it.',
      }}
    >
      <PageHero
        eyebrow="Privacy and data"
        title="A child here never has an email address, and never sees an advert."
        body="This page is the plain-English version: what is kept, who can read it, and what you can take away or delete. It describes how the product is built rather than standing in for the formal policy."
      >
        <Button onClick={toAuth}>Create a free account</Button>
        <LinkButton to={{ name: 'how' }} navigate={navigate} variant="ghost">
          How the record is kept honest
        </LinkButton>
      </PageHero>

      <Section eyebrow="The commitments" title="Four things that are structural, not promises">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Panel title="No adverts and no third-party trackers" emoji="🚫">
            Not on the child’s screens, not on the grown-up’s, not anywhere. There is no advertising
            business here to be tempted by later, because the product is bought by the person using
            it.
          </Panel>
          <Panel title="A child signs in with a code" emoji="🔑">
            You add them to your account and set a secret number. There is no inbox, no password
            reset email, and no way for anyone to contact them through the app. Anybody who tells
            the sign-up form they are under 13 is sent to fetch a grown-up rather than shown a form.
          </Panel>
          <Panel title="Access is enforced by the database" emoji="🔒">
            Every row carries a rule about who may read it. A learner can read and write their own
            rows and nothing else, and cannot change what has been paid for on their behalf.
          </Panel>
          <Panel title="The history cannot be rewritten" emoji="📜">
            Answers can be added and never revised — by a child, or by anybody. Deleting is the
            record owner’s to do, and it removes rather than edits.
          </Panel>
        </div>
      </Section>

      <Section
        eyebrow="What is kept"
        title="The record, listed"
        lede="It is a learning record, and it is not much more than that."
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card>
            <h3 className="text-xl font-extrabold text-ink">Stored</h3>
            <CheckList
              className="mt-3"
              items={[
                'A grown-up’s email address, for signing in',
                'Each learner’s display name and the grade hint you give them',
                'A birth year, where one was given — it is what decides whether a learner may have a sign-in of their own',
                'Every answer: what was asked, what was given, how long it took, whether a hint was used, whether the app checked it',
                'Sessions, mastery per item, levels, streaks and collectibles',
                'Work set, and which round closed it',
                'Rewards offered, earned and marked as handed over',
                'Documents you upload, and what was built from them',
              ]}
            />
          </Card>
          <Card>
            <h3 className="text-xl font-extrabold text-ink">Not stored, and not wanted</h3>
            <CheckList
              className="mt-3"
              items={[
                'An email address, phone number or postal address for a child',
                'A full date of birth — the year on its own is as precise as it gets',
                'Location, contacts, camera or microphone',
                'Any advertising or analytics profile',
                'Anything sold, shared or brokered to a third party — ever',
              ]}
            />
          </Card>
        </div>
      </Section>

      <Section
        eyebrow="Who can see it"
        title="Access is granted by the person who owns the record"
        lede="Which is a parent for their child, or a learner aged 13 or over acting for themselves."
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Panel title="Consent happens on redemption">
            A tutor or teacher’s code grants nothing when it is made. The grant happens when a
            family accepts it, for the children that family picks — and they are shown who they are
            letting in, and what it would allow, before they accept.
          </Panel>
          <Panel title="Access does not spread">
            A guardian who was let in cannot pass that access to somebody else. Authoring work given
            to several children does not reveal who else has it.
          </Panel>
          <Panel title="It can be taken back">
            A family can disconnect a tutor at any time without asking anyone. Withdrawing a code
            stops new families joining without evicting those already connected.
          </Panel>
        </div>
      </Section>

      <Section eyebrow="Your copy" title="Taking it with you, or taking it away">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Panel title="Export">
            Everything a learner has done comes out as CSV, and weekly progress sheets print. It is
            your record; we are holding it, not keeping it.
          </Panel>
          <Panel title="Erase">
            Erasing a learner’s progress is a single deliberate action by the record’s owner. It
            reopens any work those rounds had closed, rather than leaving tasks claiming to be
            finished with nothing behind them.
          </Panel>
        </div>
      </Section>

      <Section eyebrow="Questions" title="The ones worth asking">
        <FaqList
          items={[
            {
              q: 'Is this a legal privacy policy?',
              a: 'No — it is the plain-English description of how the product handles data, which is the part you can actually check against what the app does. Treat it as a summary rather than as the formal document.',
            },
            {
              q: 'Do you use my child’s work to train anything?',
              a: 'No. The only thing sent to a model is a document a grown-up deliberately uploads to have practice material built from it, and that is done on request, quoted first, and shown to you before anything lands.',
            },
            {
              q: 'Who is behind this?',
              a: 'A small independent team, funded by parents paying for coverage rather than by advertising or by selling data. That is the whole business model, and it is why there is no advertising surface to lose later.',
            },
            {
              q: 'Can my child be contacted by anyone?',
              a: 'There is no messaging, no comments, no profile and no way for one learner to find another. A child’s account has no email address to reach.',
            },
          ]}
        />
      </Section>
    </MarketingPage>
  )
}
