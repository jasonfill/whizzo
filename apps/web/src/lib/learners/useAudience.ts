import { useMemo } from 'react'
import { readSignupIntent } from '../../auth/signupIntent'
import { useLearners } from './LearnerProvider'

/**
 * Who a grown-up is to the learners they can see, in one word.
 *
 * A parent's screen is "Family"; a tutor's or a teacher's is "Learners". The
 * capability is identical — there is deliberately no tutor mode — so this
 * only decides what the screen is called. It is read off the links the
 * account actually has: owning a learner, or being let in by a code as a
 * parent, makes it a family; being let in only as a teacher makes it a
 * roster. An account with nobody yet falls back to what the person said at
 * sign-up, and after that to Family, which is who signs up most.
 */
export type AudienceKind = 'family' | 'learners'

export interface Audience {
  kind: AudienceKind
  /** "Family" or "Learners" — the screen title and the nav label. */
  label: string
  /** "your family" or "your learners" — for a sentence. */
  phrase: string
  /** "Manage family →" or "Manage learners →". */
  manage: string
}

const FAMILY: Audience = { kind: 'family', label: 'Family', phrase: 'your family', manage: 'Manage family →' }
const LEARNERS: Audience = {
  kind: 'learners',
  label: 'Learners',
  phrase: 'your learners',
  manage: 'Manage learners →',
}

export function useAudience(): Audience {
  const { learners, isLearnerSession } = useLearners()
  return useMemo(() => {
    // A child never sees these screens, but if a label is asked for anyway
    // their world is a family.
    if (isLearnerSession) return FAMILY
    const roles = learners.map((l) => l.viewerRole).filter(Boolean)
    if (roles.some((r) => r === 'owner' || r === 'parent')) return FAMILY
    if (roles.length > 0) return LEARNERS
    // Nobody linked yet: the sign-up intent is the only thing we know.
    return readSignupIntent()?.role === 'tutor' ? LEARNERS : FAMILY
  }, [learners, isLearnerSession])
}
