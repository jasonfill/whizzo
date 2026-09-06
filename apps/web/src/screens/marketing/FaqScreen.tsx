import { Button } from '../../components/ui'
import type { Navigate, Route } from '../../routes'
import { useAuth } from '../../auth/AuthProvider'
import { FaqList, LinkButton, MarketingPage, PageHero, Section } from './chrome'
import { AUDIENCES, AUDIENCE_ORDER } from './audiences'
import { CORE_FAQ } from './copy'

/**
 * Every question, in one place.
 *
 * The audience pages each carry their own four, and this page gathers all of
 * them rather than writing a fifth set — so an answer given to a tutor is
 * literally the same answer a parent reads, and cannot quietly become a
 * different one.
 */
export default function FaqScreen({ navigate }: { navigate: Navigate }) {
  const { status } = useAuth()
  const here: Route = { name: 'faq' }
  const toAuth = () => navigate({ name: 'auth' })

  return (
    <MarketingPage
      current={here}
      navigate={navigate}
      // Reachable signed in as well as out; the chrome drops the funnel.
      inApp={status === 'signed-in'}
      closing={{
        title: 'Still not sure? It costs nothing to find out.',
        body: 'The free account is the whole curriculum, and one round of spelling will tell you more than this page can.',
      }}
    >
      <PageHero
        eyebrow="Questions"
        title="Everything people ask before they sign up."
        body="Including the awkward ones: whether a child can cheat the report, what happens if you never pay, and what this cannot do."
      >
        <Button onClick={toAuth}>Create a free account</Button>
        <LinkButton to={{ name: 'how' }} navigate={navigate} variant="ghost">
          How the engine works
        </LinkButton>
      </PageHero>

      <Section eyebrow="General" title="About the product">
        <FaqList items={CORE_FAQ} />
      </Section>

      {AUDIENCE_ORDER.map((id) => {
        const audience = AUDIENCES[id]
        return (
          <Section key={id} eyebrow={audience.eyebrow} title={`If you are ${label(id)}`}>
            <FaqList items={audience.faq} />
          </Section>
        )
      })}
    </MarketingPage>
  )
}

function label(id: string): string {
  switch (id) {
    case 'parents':
      return 'a parent'
    case 'teachers':
      return 'a teacher'
    case 'tutors':
      return 'a tutor'
    default:
      return 'homeschooling'
  }
}
