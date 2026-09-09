// The same product, addressed four ways.
//
// The temptation with audience pages is to invent four products. There is one:
// a parent, a tutor and a teacher use the same screens, the same library, the
// same assignments and the same permission checks — that is a deliberate
// decision recorded in the README, and building four pages that imply otherwise
// would be writing cheques the app has to bounce.
//
// So what varies here is the *question each page answers first*, and the one
// genuinely different fact underneath: **who pays.** A parent pays for their
// child. A teacher and a tutor never pay for anybody, because coverage belongs
// to the learner and follows them to whoever is trusted with them.

import type { AudienceId } from '../../routes'

export interface Audience {
  id: AudienceId
  /** The word for them in a nav item. */
  nav: string
  eyebrow: string
  title: string
  lede: string
  /** The situation, said back to them before anything is offered. */
  situation: Array<{ title: string; body: string }>
  /** How the product meets it, in order. */
  steps: Array<{ title: string; body: string }>
  /** What they get, once it is set up. */
  gets: string[]
  /** The money answer, which is different for each of them. */
  money: { title: string; body: string }
  faq: Array<{ q: string; a: string }>
  closing: { title: string; body: string }
}

const PARENTS: Audience = {
  id: 'parents',
  nav: 'Parents',
  eyebrow: 'For parents',
  title: 'Find out what your child can actually spell — in about five minutes.',
  lede: 'Not what the worksheet says, not what last term’s report said. Whizzo works the level out from the words your child attempts, keeps them at the edge of it, and shows you every answer behind the number.',
  situation: [
    {
      title: 'The practice you can see is the practice you cannot check',
      body: 'A finished worksheet tells you it was finished. It does not tell you which words were guessed, which were copied off the line above, or which ones will be gone by Thursday.',
    },
    {
      title: 'Nobody has actually measured the level',
      body: 'A child is given third-grade words because they are in third grade. Whizzo starts from what they get right and wrong, and the level moves on evidence — up or down — instead of on the calendar.',
    },
    {
      title: 'Getting them to do it is the hard part',
      body: 'Rounds are short, the app picks the work, and there is a world to collect in. You set the task; you are not also the one deciding what today’s twenty words should be.',
    },
  ],
  steps: [
    {
      title: 'Add each child to your account',
      body: 'One account holds all of them. Each child gets their own record, their own level and their own theme — and never needs an email address.',
    },
    {
      title: 'They sign in with a code and a secret number',
      body: 'On their own tablet, laptop or the family computer. You set the number; there is no inbox, no password reset, no way for them to be contacted.',
    },
    {
      title: 'You set the work and read what came back',
      body: 'Give them a list, a deck or a typing lesson. Tasks close on a graded round, so "done" comes with the answers attached — and Family shows all your children on one screen.',
    },
  ],
  gets: [
    'Every child on one account, with one bill and one dashboard',
    'The real spelling level, and the words behind it',
    'Tasks that cannot be ticked off without doing them',
    'Rewards you promise, the app verifies, and you mark as paid',
    'A tutor or teacher connected to just the children you choose',
    'The whole curriculum free, whether or not you ever pay',
  ],
  money: {
    title: 'You are the one who pays — and only for your own children',
    body: 'Coverage belongs to the child. Cover yours, and every grown-up you have trusted with them — a tutor, a teacher, the other parent — gets the full picture for that child without being asked for a card.',
  },
  faq: [
    {
      q: 'What if my child is behind, or well ahead?',
      a: 'That is the case this is built for. The level is found from what they do, not from their year group, and the words they are given sit just past it in either direction. Nothing is locked by grade.',
    },
    {
      q: 'Can they cheat their way to a good report?',
      a: 'Not into mastery. Hints stop a word counting, self-graded rounds are recorded as unchecked and cannot clear a score bar, and the answer history cannot be edited after the fact. You can open any round and read every answer in the order it was given.',
    },
    {
      q: 'How long should a session be?',
      a: 'Five to ten minutes. Round length follows the learner’s age band, and the spacing does the rest — a word seen today is due again tomorrow, then in two days, then four.',
    },
    {
      q: 'Do you show my child ads?',
      a: 'No. There are no ads and no third-party trackers anywhere in the product, and there is no plan for either.',
    },
  ],
  closing: {
    title: 'One child, one round, and you will know where they are.',
    body: 'The account is free, the curriculum is free, and the first round of spelling is the placement test — without anybody having to sit a placement test.',
  },
}

const TEACHERS: Audience = {
  id: 'teachers',
  nav: 'Teachers',
  eyebrow: 'For teachers',
  title: 'Set one piece of work for twenty-five children. Read one screen.',
  lede: 'One code, handed to your families. They connect their own child, you assign to the whole class in a single action, and every task closes on a round the app graded rather than on a signature in a planner.',
  situation: [
    {
      title: 'Class tools that need a purchase order',
      body: 'You do not need one. There is nothing for a school to buy and nothing for you to expense — teachers are never billed for anything in this product, by design and permanently.',
    },
    {
      title: 'Setup that happens twenty-five times',
      body: 'The older way round has each parent mint a code for their child and send it to you. Here you mint one code that stands for you, and each family redeems it. Your side of the work is done once.',
    },
    {
      title: 'Homework you cannot verify',
      body: 'A task here is closed by a finished session with the answers attached, in the same transaction that records the round. A score bar is measured against answers the app checked, so a self-graded round cannot clear one.',
    },
  ],
  steps: [
    {
      title: 'Mint your connection code',
      body: 'One code, for you rather than for a learner. Minting it grants nothing — it is a business card, not a key.',
    },
    {
      title: 'Families redeem it and choose their child',
      body: 'They see your name and exactly what the link would allow before they accept, and they pick which of their children it covers. Consent sits with the family, which is the only place it can honestly sit.',
    },
    {
      title: 'Assign once, to everybody',
      body: 'One definition of the work, one row per learner. The same task goes to the whole class in one action, is edited in one place, and answers "who has done this?" in one query — while each child finishes their own copy.',
    },
  ],
  gets: [
    'A class library of decks and lists that is yours, not filed under a student',
    'Assignment to many learners at once, with per-learner progress',
    'Tasks that close on graded evidence, with the answers readable',
    'The full curriculum, every activity, and spaced review — free',
    'A document turned into practice sets, if you want to hand one over',
    'No license, no seats, no invoice, no procurement',
  ],
  money: {
    title: 'You never pay. Not for a class, not for a seat, not ever',
    body: 'Setting work is free and always will be — a teacher who assigns to twenty-five children causes twenty-five families to open the app, and charging for that would be charging for the best thing that happens here. If a family chooses to cover their child, you get the full reporting for that child at no cost to you.',
  },
  faq: [
    {
      q: 'Do I see other people’s children?',
      a: 'Only the ones a family connected to you, and only what that family allowed. Authoring a piece of work does not let you see who else it was given to, and a parent looking at a shared task never learns which other children have it.',
    },
    {
      q: 'What if a family does not pay?',
      a: 'Nothing you rely on stops. Every activity, the whole curriculum, spaced review and the work you set are free for that child. What coverage adds is the deeper reporting for the grown-ups.',
    },
    {
      q: 'Can a family remove me?',
      a: 'Whenever they like, and without asking us. You can also withdraw your code, which stops new families joining without evicting the ones already connected.',
    },
    {
      q: 'Is there a teacher mode to learn?',
      a: 'No — and that is on purpose. You use the same screens a parent uses, with the same permission rules. There is one product to learn and one product for us to get right.',
    },
  ],
  closing: {
    title: 'Make one code. Hand it out on Monday.',
    body: 'Nothing to buy, nothing to install, and the families do their own half of the setup.',
  },
}

const TUTORS: Audience = {
  id: 'tutors',
  nav: 'Tutors',
  eyebrow: 'For tutors',
  title: 'Your material travels with you. So does the evidence.',
  lede: 'Build a deck once and use it with every student you ever have. Connect a family with one code. Then show the person paying you exactly what happened between sessions — answer by answer.',
  situation: [
    {
      title: 'Material filed under whichever student was on screen',
      body: 'Decks and lists can belong to you rather than to a learner. Your library is reusable across every student you work with, and assigning it is what lets a student see it — nothing else in your library comes with it.',
    },
    {
      title: 'Proving the hour was worth it',
      body: 'Open any round and every answer is there in the order it was given: what was asked, what they wrote, how long it took, whether a hint was used, whether the app checked it. That is a session summary you can send.',
    },
    {
      title: 'Practice that evaporates between sessions',
      body: 'Set the work; the spacing schedules itself. A word missed on Tuesday is due Wednesday, then Friday — so the week between you does the work instead of undoing it.',
    },
  ],
  steps: [
    {
      title: 'Build your library once',
      body: 'Decks, word lists, and material built from a document you already use. It belongs to you, it is reusable, and a family can never rewrite it out from under your other students.',
    },
    {
      title: 'Hand each family your code',
      body: 'One code stands for you. The family redeems it, sees who you are and what the link allows, and chooses which of their children it covers. You never chase twenty parents for twenty codes.',
    },
    {
      title: 'Set work, then read what came back',
      body: 'The same assignment goes to one student or to all of them. Tasks close on graded rounds, and each student’s row tells you what is outstanding, what is overdue, and when they last practiced.',
    },
  ],
  gets: [
    'A library that belongs to you and outlives any one student',
    'One connection code for every family you work with',
    'Work set across students, with per-student state',
    'Session-by-session answers you can walk a parent through',
    'Retention: what is sticking and what is about to slip',
    'The same screens and the same power a parent has',
  ],
  money: {
    title: 'You never pay. The family covers their own child',
    body: 'Coverage follows the learner, so a student whose parent has covered them gives you their full history, their word-by-word report and their retention picture — and you have bought nothing. Nothing about your library, your codes or your assignments depends on a payment from you.',
  },
  faq: [
    {
      q: 'Can I work with children in different families?',
      a: 'That is the normal case. Tutor is a property of the link rather than of your account — the same person is a parent to their own children and a tutor to somebody else’s — so one account covers all of it.',
    },
    {
      q: 'What can the parent see?',
      a: 'Their own child, in full, always. They cannot see your other students, and they cannot see who else a piece of shared work was given to.',
    },
    {
      q: 'What happens when a student leaves?',
      a: 'The family disconnects, or you do. Their record stays theirs; your library stays yours. Nothing you built goes with them.',
    },
    {
      q: 'Can a parent give my access to somebody else?',
      a: 'No. A guardian who was let in cannot pass that access on — only the person who owns the child’s record can grant it.',
    },
  ],
  closing: {
    title: 'Bring your first family across this week.',
    body: 'Make a code, build one deck, and set it. Nothing to buy, and nothing about it costs you anything later.',
  },
}

const HOMESCHOOL: Audience = {
  id: 'homeschool',
  nav: 'Homeschool',
  eyebrow: 'For homeschool',
  title: 'A whole curriculum — and a way to turn your own materials into practice.',
  lede: 'Seven grades of spelling, a full typing course and unlimited study decks, all free. Hand over a document you already teach from and get practice sets back. Keep every answer, and export the lot whenever you want it.',
  situation: [
    {
      title: 'Several children, several levels, one afternoon',
      body: 'Each learner has their own record, their own level and their own review schedule, and Family shows all of them on one screen: outstanding work, what is overdue, minutes and questions this week, accuracy over checked answers.',
    },
    {
      title: 'Your material is in a PDF, not in an app',
      body: 'Give the app a document and it reads it, builds practice sets from it, and shows you what it made before anything lands in your library. The cost is quoted before a single credit is spent.',
    },
    {
      title: 'Records that have to hold up',
      body: 'Every answer is kept, append-only, with the date, the activity and whether the app checked it. Progress sheets print, and everything exports as CSV — for a portfolio, an evaluator or your own peace of mind.',
    },
  ],
  steps: [
    {
      title: 'Add every learner to one account',
      body: 'No email addresses, no per-child subscriptions to manage. They sign in with a code and a secret number on whatever device is free.',
    },
    {
      title: 'Use the curriculum, or bring your own',
      body: '420 words across 42 rule-based lists, or paste your own list — one word per line, with a sentence after a tab or a dash. Decks handle everything that is not spelling, math notation included.',
    },
    {
      title: 'Set the week and read the evidence',
      body: 'Assign to one child or all of them at once. Tasks close on graded rounds, so a week’s record is what was actually done rather than what was planned.',
    },
  ],
  gets: [
    'Every grade level, every activity, unlocked from day one',
    'All your learners on one account and one screen',
    'Your own word lists and unlimited study decks',
    'Documents turned into practice sets, quoted before they run',
    'Printable weekly progress sheets and full CSV export',
    'A record that is append-only, and yours to delete',
  ],
  money: {
    title: 'Free for the learning. Per child for the records',
    body: 'Nothing a learner needs is ever behind the card. What covering a child adds is the paperwork half — full history instead of the last 30 days, the word-by-word report, retention, printables, export and unlimited content.',
  },
  faq: [
    {
      q: 'Can I use our own spelling words?',
      a: 'Yes. Paste a list, one word per line, with an optional example sentence after a tab, a pipe or a dash. It gets the same activities and the same spaced review as the built-in curriculum.',
    },
    {
      q: 'How do the document credits work?',
      a: 'Credits are metered by page rather than by document, because a page is what actually costs something. You are shown the estimate before the run starts, and there is a half-price option for work that can wait. Nothing is ever spent without being quoted first.',
    },
    {
      q: 'Can I get the records out?',
      a: 'Yes — CSV export of everything, and printable weekly progress sheets. It is your record; we are just holding it.',
    },
    {
      q: 'Will an older student find it babyish?',
      a: 'No. The app changes register with the learner’s grade: an older student gets shorter praise, no confetti and longer rounds. Age changes the tone and the pacing, never the curriculum or what counts as evidence.',
    },
  ],
  closing: {
    title: 'Start the year with one account and every level unlocked.',
    body: 'Add your learners, run one round each, and you will have a real starting level for all of them before lunch.',
  },
}

export const AUDIENCES: Record<AudienceId, Audience> = {
  parents: PARENTS,
  teachers: TEACHERS,
  tutors: TUTORS,
  homeschool: HOMESCHOOL,
}

export const AUDIENCE_ORDER: AudienceId[] = ['parents', 'teachers', 'tutors', 'homeschool']

/** The one-line pitch each audience gets on the front page. */
export const AUDIENCE_TEASER: Record<AudienceId, { emoji: string; line: string }> = {
  parents: { emoji: '👪', line: 'Every child on one account, and a level somebody actually measured.' },
  teachers: { emoji: '🍎', line: 'One code for your families. Assign to the whole class at once. Never billed.' },
  tutors: { emoji: '🎓', line: 'A library that travels with you, and evidence to show the parent paying you.' },
  homeschool: { emoji: '🏡', line: 'Every level unlocked, your own materials in, and records that export.' },
}
