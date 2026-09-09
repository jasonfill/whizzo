// Ordering a track, and what has to come before what.
//
// Spelling's curriculum is a ladder: grade 2, then 3, then 4. A content track
// is not. "What is interest" comes before "compound interest" comes before
// "credit card debt", but Investing and Insurance are independent branches
// nobody has to do in a particular order — so units form a directed graph, not
// a list.
//
// The graph is the part that can be wrong in ways nobody notices until a
// learner is stuck, which is why `validateCatalog` exists and why it belongs in
// `npm test` next to `validate:words`. An invariant nobody checks is an
// invariant that is already broken.

export interface Unit {
  id: string
  trackId: string
  title: string
  /** Units that must be mastered first. Empty means it can be started today. */
  requires: string[]
  /** What this teaches, as objective ids. The join key for shared content. */
  objectives?: string[]
}

export interface CatalogProblem {
  unitId: string
  problem: string
}

/**
 * Everything wrong with a set of units, in one pass.
 *
 * All of it, not the first thing: somebody fixing a catalog wants the list,
 * not one error at a time.
 */
export function validateCatalog(units: readonly Unit[]): CatalogProblem[] {
  const problems: CatalogProblem[] = []
  const byId = new Map(units.map((u) => [u.id, u]))

  if (byId.size !== units.length) {
    const seen = new Set<string>()
    for (const unit of units) {
      if (seen.has(unit.id)) problems.push({ unitId: unit.id, problem: 'Two units share this id.' })
      seen.add(unit.id)
    }
  }

  for (const unit of units) {
    if (!unit.title.trim()) {
      problems.push({ unitId: unit.id, problem: 'A unit with no title cannot be offered.' })
    }
    for (const need of unit.requires) {
      const required = byId.get(need)
      if (!required) {
        problems.push({ unitId: unit.id, problem: `Requires "${need}", which does not exist.` })
        continue
      }
      // A prerequisite in another track is a prerequisite nobody working
      // through this track will ever meet.
      if (required.trackId !== unit.trackId) {
        problems.push({
          unitId: unit.id,
          problem: `Requires "${need}", which is in a different track.`,
        })
      }
    }
    if (unit.requires.includes(unit.id)) {
      problems.push({ unitId: unit.id, problem: 'A unit cannot require itself.' })
    }
  }

  for (const unit of findCycles(units)) {
    problems.push({
      unitId: unit,
      problem: 'This is part of a loop of prerequisites, so nothing in it can ever start.',
    })
  }

  // A track whose every unit needs another one is a track nobody can begin.
  const byTrack = new Map<string, Unit[]>()
  for (const unit of units) {
    byTrack.set(unit.trackId, [...(byTrack.get(unit.trackId) ?? []), unit])
  }
  for (const [trackId, group] of byTrack) {
    if (group.length && !group.some((u) => u.requires.length === 0)) {
      problems.push({
        unitId: group[0]!.id,
        problem: `Nothing in ${trackId} can be started — every unit requires another.`,
      })
    }
  }

  return problems
}

/** Unit ids caught in a prerequisite loop. */
function findCycles(units: readonly Unit[]): string[] {
  const byId = new Map(units.map((u) => [u.id, u]))
  const state = new Map<string, 'visiting' | 'done'>()
  const looped = new Set<string>()

  const walk = (id: string, trail: string[]): void => {
    const seen = state.get(id)
    if (seen === 'done') return
    if (seen === 'visiting') {
      // Everything from where this id first appeared is in the loop.
      const from = trail.indexOf(id)
      for (const inLoop of trail.slice(from === -1 ? 0 : from)) looped.add(inLoop)
      return
    }
    state.set(id, 'visiting')
    for (const need of byId.get(id)?.requires ?? []) walk(need, [...trail, id])
    state.set(id, 'done')
  }

  for (const unit of units) walk(unit.id, [])
  return [...looped]
}

/**
 * Which units a learner may start.
 *
 * Everything whose prerequisites are all mastered. A unit is never *hidden* by
 * this — a learner who wants to look ahead should be able to — but it is what
 * the path offers next.
 */
export function availableUnits(
  units: readonly Unit[],
  mastered: ReadonlySet<string>,
): Unit[] {
  return units.filter(
    (unit) => !mastered.has(unit.id) && unit.requires.every((need) => mastered.has(need)),
  )
}

/**
 * A sensible order to work through a track.
 *
 * Prerequisites first, and ties broken by the order they were written, so a
 * catalog author's sequencing survives rather than being reshuffled by a sort.
 */
export function suggestedOrder(units: readonly Unit[]): Unit[] {
  const byId = new Map(units.map((u) => [u.id, u]))
  const placed = new Set<string>()
  const out: Unit[] = []

  const place = (unit: Unit, guard: Set<string>): void => {
    if (placed.has(unit.id) || guard.has(unit.id)) return
    guard.add(unit.id)
    for (const need of unit.requires) {
      const required = byId.get(need)
      if (required) place(required, guard)
    }
    if (!placed.has(unit.id)) {
      placed.add(unit.id)
      out.push(unit)
    }
  }

  for (const unit of units) place(unit, new Set())
  return out
}
