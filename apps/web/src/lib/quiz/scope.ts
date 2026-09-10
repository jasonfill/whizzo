/**
 * Whose deck a deck screen is showing.
 *
 * A learner's deck lives in their progress snapshot and carries their mastery;
 * a library deck belongs to the grown-up and is in nobody's snapshot until it
 * has been set as work. The deck screen and the editor take the same props for
 * both — the scope says where to read and write, and which parts (stats, study
 * modes, the deck limit) mean nothing for a deck that is not a learner's.
 */
export type DeckScope = 'learner' | 'library'
