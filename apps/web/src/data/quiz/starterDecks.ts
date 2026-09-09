// Decks that ship with the app.
//
// Card ids are derived from the deck id and the row's position rather than
// generated, because a learner's mastery is stored against `deckId:cardId`.
// Random ids would hand everyone a blank slate on every page load.

import { estimateDifficulty } from '../../lib/quiz/decks'
import { generatedDecks } from '@whizzo/shared'
import type { QuizCard, QuizDeck } from '../../lib/progress/types'

interface StarterSpec {
  id: string
  title: string
  description: string
  tags: string[]
  termLabel: string
  definitionLabel: string
  pairs: Array<[string, string]>
}

function toDeck(spec: StarterSpec): QuizDeck {
  const cards: QuizCard[] = spec.pairs.map(([term, definition], i) => ({
    id: `${spec.id}-${i}`,
    term,
    definition,
    hint: null,
    difficulty: estimateDifficulty(term, definition),
  }))
  return {
    id: spec.id,
    title: spec.title,
    description: spec.description,
    tags: spec.tags,
    cards,
    source: 'starter',
    termLabel: spec.termLabel,
    definitionLabel: spec.definitionLabel,
    createdAt: 0,
    updatedAt: 0,
  }
}

const SPECS: StarterSpec[] = [
  {
    id: 'starter-capitals',
    title: 'US State Capitals',
    description: 'All fifty states and the city that runs them.',
    tags: ['geography', 'social studies'],
    termLabel: 'State',
    definitionLabel: 'Capital',
    pairs: [
      ['Alabama', 'Montgomery'], ['Alaska', 'Juneau'], ['Arizona', 'Phoenix'],
      ['Arkansas', 'Little Rock'], ['California', 'Sacramento'], ['Colorado', 'Denver'],
      ['Connecticut', 'Hartford'], ['Delaware', 'Dover'], ['Florida', 'Tallahassee'],
      ['Georgia', 'Atlanta'], ['Hawaii', 'Honolulu'], ['Idaho', 'Boise'],
      ['Illinois', 'Springfield'], ['Indiana', 'Indianapolis'], ['Iowa', 'Des Moines'],
      ['Kansas', 'Topeka'], ['Kentucky', 'Frankfort'], ['Louisiana', 'Baton Rouge'],
      ['Maine', 'Augusta'], ['Maryland', 'Annapolis'], ['Massachusetts', 'Boston'],
      ['Michigan', 'Lansing'], ['Minnesota', 'Saint Paul'], ['Mississippi', 'Jackson'],
      ['Missouri', 'Jefferson City'], ['Montana', 'Helena'], ['Nebraska', 'Lincoln'],
      ['Nevada', 'Carson City'], ['New Hampshire', 'Concord'], ['New Jersey', 'Trenton'],
      ['New Mexico', 'Santa Fe'], ['New York', 'Albany'], ['North Carolina', 'Raleigh'],
      ['North Dakota', 'Bismarck'], ['Ohio', 'Columbus'], ['Oklahoma', 'Oklahoma City'],
      ['Oregon', 'Salem'], ['Pennsylvania', 'Harrisburg'], ['Rhode Island', 'Providence'],
      ['South Carolina', 'Columbia'], ['South Dakota', 'Pierre'], ['Tennessee', 'Nashville'],
      ['Texas', 'Austin'], ['Utah', 'Salt Lake City'], ['Vermont', 'Montpelier'],
      ['Virginia', 'Richmond'], ['Washington', 'Olympia'], ['West Virginia', 'Charleston'],
      ['Wisconsin', 'Madison'], ['Wyoming', 'Cheyenne'],
    ],
  },
  {
    id: 'starter-times-tables',
    title: 'Times Tables 6 to 9',
    description: 'The facts that actually need memorizing.',
    tags: ['math'],
    termLabel: 'Problem',
    definitionLabel: 'Answer',
    pairs: [
      ['6 × 6', '36'], ['6 × 7', '42'], ['6 × 8', '48'], ['6 × 9', '54'], ['6 × 12', '72'],
      ['7 × 6', '42'], ['7 × 7', '49'], ['7 × 8', '56'], ['7 × 9', '63'], ['7 × 12', '84'],
      ['8 × 6', '48'], ['8 × 7', '56'], ['8 × 8', '64'], ['8 × 9', '72'], ['8 × 12', '96'],
      ['9 × 6', '54'], ['9 × 7', '63'], ['9 × 8', '72'], ['9 × 9', '81'], ['9 × 12', '108'],
      ['11 × 11', '121'], ['12 × 12', '144'],
    ],
  },
  {
    id: 'starter-spanish',
    title: 'Spanish — First 40 Words',
    description: 'Everyday nouns and verbs to get started.',
    tags: ['language', 'spanish'],
    termLabel: 'Spanish',
    definitionLabel: 'English',
    pairs: [
      ['el perro', 'the dog'], ['el gato', 'the cat'], ['la casa', 'the house'],
      ['el libro', 'the book'], ['la escuela', 'the school'], ['el agua', 'the water'],
      ['la comida', 'the food'], ['el amigo', 'the friend'], ['la familia', 'the family'],
      ['el día', 'the day'], ['la noche', 'the night'], ['el sol', 'the sun'],
      ['la luna', 'the moon'], ['el árbol', 'the tree'], ['la ciudad', 'the city'],
      ['el coche', 'the car'], ['la mano', 'the hand'], ['el ojo', 'the eye'],
      ['la puerta', 'the door'], ['la ventana', 'the window'], ['hablar', 'to speak'],
      ['comer', 'to eat'], ['beber', 'to drink'], ['vivir', 'to live'], ['tener', 'to have'],
      ['hacer', 'to do / to make'], ['ir', 'to go'], ['ver', 'to see'], ['saber', 'to know'],
      ['querer', 'to want'], ['grande', 'big'], ['pequeño', 'small'], ['bueno', 'good'],
      ['malo', 'bad'], ['rojo', 'red'], ['azul', 'blue'], ['verde', 'green'],
      ['hoy', 'today'], ['mañana', 'tomorrow'], ['siempre', 'always'],
    ],
  },
  {
    id: 'starter-body',
    title: 'Human Body Systems',
    description: 'What each system does, in one line.',
    tags: ['science', 'biology'],
    termLabel: 'System',
    definitionLabel: 'What it does',
    pairs: [
      ['Circulatory system', 'Moves blood, oxygen and nutrients around the body'],
      ['Respiratory system', 'Takes in oxygen and gets rid of carbon dioxide'],
      ['Digestive system', 'Breaks food down into nutrients the body can use'],
      ['Nervous system', 'Carries signals between the brain and the rest of the body'],
      ['Skeletal system', 'Supports the body and protects the organs'],
      ['Muscular system', 'Moves the body and keeps the heart beating'],
      ['Immune system', 'Finds and fights germs that get into the body'],
      ['Endocrine system', 'Sends hormones that control growth and mood'],
      ['Excretory system', 'Removes waste and extra water from the blood'],
      ['Integumentary system', 'Skin, hair and nails — the outer barrier'],
      ['Heart', 'The muscle that pumps blood through the whole body'],
      ['Lungs', 'Where oxygen enters the blood and carbon dioxide leaves it'],
      ['Kidneys', 'Filter waste out of the blood to make urine'],
      ['Liver', 'Cleans the blood and helps break down fats'],
      ['Brain', 'Controls thought, memory, movement and the senses'],
    ],
  },
  {
    id: 'starter-space',
    title: 'Planets and Space',
    description: 'The solar system, plus a few things worth knowing.',
    tags: ['science', 'space'],
    termLabel: 'Question',
    definitionLabel: 'Answer',
    pairs: [
      ['Closest planet to the Sun', 'Mercury'],
      ['Hottest planet in the solar system', 'Venus'],
      ['The only planet known to have life', 'Earth'],
      ['The red planet', 'Mars'],
      ['Largest planet in the solar system', 'Jupiter'],
      ['Planet famous for its rings', 'Saturn'],
      ['Planet that spins on its side', 'Uranus'],
      ['Farthest planet from the Sun', 'Neptune'],
      ['What a light year measures', 'Distance, not time'],
      ['The star at the center of our solar system', 'The Sun'],
      ['What causes the phases of the Moon', 'The changing angle of sunlight hitting it'],
      ['How many planets are in our solar system', 'Eight'],
      ['The galaxy we live in', 'The Milky Way'],
      ['What a comet is mostly made of', 'Ice and dust'],
    ],
  },
]

export const STARTER_DECKS: QuizDeck[] = SPECS.map(toDeck)

export function isStarterDeck(id: string): boolean {
  return STARTER_DECKS.some((d) => d.id === id)
}

/**
 * Everything that ships with the app.
 *
 * The generated banks are folded in here rather than seeded, for the same
 * reason the hand-written starters are: they are constants, so they stay
 * updatable without a migration, and their card ids are derived rather than
 * random so a learner's mastery survives every reload.
 *
 * These are the content nobody should ever have to type. Four hundred
 * multiplication facts is not a thing to ask a parent for.
 */
export const SHIPPED_DECKS: QuizDeck[] = [...generatedDecks(), ...STARTER_DECKS]
