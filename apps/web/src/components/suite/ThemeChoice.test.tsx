// The control a grown-up uses to set a child's world.
//
// Two rules it has to keep, both easy to break by accident:
//
//   1. It stays theme-free while choosing a theme. It is a grown-up surface,
//      and a progress report must never carry a child's accent.
//   2. Grade bands order it and nothing else. Every world stays clickable
//      whatever grade the child is in.

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ThemeChoice from './ThemeChoice'
import { THEMES } from '../../lib/themes'
import type { Learner } from '../../lib/learners'

const setTheme = vi.fn()
const setThemeFor = vi.fn(async () => {})
let source: 'learner' | 'guest' = 'learner'

vi.mock('../../lib/theme/ThemeProvider', () => ({
  useTheme: () => ({
    theme: THEMES[0]!,
    themes: THEMES,
    setTheme,
    setThemeFor,
    source,
  }),
}))

function learner(over: Partial<Learner> = {}): Learner {
  return {
    id: 'l1',
    ownerId: 'u1',
    displayName: 'Ada',
    avatarEmoji: '🦊',
    gradeHint: 4,
    birthYear: 2016,
    authKind: 'none',
    authUserId: null,
    createdAt: 0,
    theme: 'cats',
    ...over,
  } as Learner
}

beforeEach(() => {
  setTheme.mockReset()
  setThemeFor.mockReset().mockResolvedValue(undefined)
  source = 'learner'
})

describe('what it offers', () => {
  it('offers all ten worlds', () => {
    render(<ThemeChoice learner={learner()} />)
    expect(screen.getAllByRole('button')).toHaveLength(10)
  })

  it('never disables a world, whatever grade the child is in', () => {
    for (const gradeHint of [0, 2, 5, 8, 12, null]) {
      const { unmount } = render(<ThemeChoice learner={learner({ gradeHint })} />)
      for (const button of screen.getAllByRole('button')) {
        expect(button).not.toBeDisabled()
      }
      unmount()
    }
  })

  it('shows each world’s band as advice rather than a requirement', () => {
    render(<ThemeChoice learner={learner()} />)
    // Dinosaurs is K-4; a grade 4 child sees the band, and can still pick any.
    expect(screen.getByRole('button', { name: /Dinosaurs/ })).toHaveTextContent('K–4')
  })

  it('orders by fit for the child’s grade', () => {
    const { unmount } = render(<ThemeChoice learner={learner({ gradeHint: 2 })} />)
    const young = screen.getAllByRole('button').map((b) => b.textContent!)
    unmount()
    render(<ThemeChoice learner={learner({ gradeHint: 11 })} />)
    const old = screen.getAllByRole('button').map((b) => b.textContent!)
    expect(young[0]).not.toBe(old[0])
  })

  it('marks the child’s current world as chosen', () => {
    render(<ThemeChoice learner={learner({ theme: 'ocean' })} />)
    expect(screen.getByRole('button', { name: /Ocean/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Cats/ })).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('setting a world', () => {
  it('writes to the named learner, not to whoever is active', async () => {
    // A parent with three children sets a world for one of them without
    // switching the whole app over to that child first.
    const user = userEvent.setup()
    render(<ThemeChoice learner={learner({ id: 'other-child' })} />)
    await user.click(screen.getByRole('button', { name: /Robots/ }))
    expect(setThemeFor).toHaveBeenCalledWith('other-child', 'robots')
    expect(setTheme).not.toHaveBeenCalled()
  })

  it('tells the panel to refresh once the write lands', async () => {
    const onChanged = vi.fn()
    const user = userEvent.setup()
    render(<ThemeChoice learner={learner()} onChanged={onChanged} />)
    await user.click(screen.getByRole('button', { name: /Ocean/ }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('uses the guest path when there is no learner row to write to', async () => {
    const user = userEvent.setup()
    render(<ThemeChoice />)
    await user.click(screen.getByRole('button', { name: /Ocean/ }))
    expect(setTheme).toHaveBeenCalledWith('ocean')
    expect(setThemeFor).not.toHaveBeenCalled()
  })

  it('says so when the save fails instead of pretending it worked', async () => {
    setThemeFor.mockRejectedValue(new Error('offline'))
    const user = userEvent.setup()
    render(<ThemeChoice learner={learner()} />)
    await user.click(screen.getByRole('button', { name: /Ocean/ }))
    expect(await screen.findByText(/did not save/i)).toBeInTheDocument()
  })

  it('does not leave the buttons stuck disabled after a failure', async () => {
    setThemeFor.mockRejectedValue(new Error('offline'))
    const user = userEvent.setup()
    render(<ThemeChoice learner={learner()} />)
    await user.click(screen.getByRole('button', { name: /Ocean/ }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Ocean/ })).not.toBeDisabled()
    })
  })

  it('warns a guest that the choice lives only on this device', () => {
    source = 'guest'
    render(<ThemeChoice />)
    expect(screen.getByText(/this device only/i)).toBeInTheDocument()
  })

  it('does not show that warning for a signed-in learner', () => {
    render(<ThemeChoice learner={learner()} />)
    expect(screen.queryByText(/this device only/i)).not.toBeInTheDocument()
  })
})

describe('it stays a grown-up surface', () => {
  it('uses no theme accent class anywhere, even while choosing one', () => {
    // The rule this exists to defend: a parent screen carries no child's
    // color. Asserting on the classes is what catches a well-meaning
    // `bg-accent` being added later.
    const { container } = render(<ThemeChoice learner={learner()} />)
    const classes = [...container.querySelectorAll('*')]
      .flatMap((el) => [...el.classList])
      .join(' ')
    for (const themed of ['accent', 'tintA', 'tintB', 'accentDeep']) {
      expect(classes).not.toContain(themed)
    }
  })

  it('uses no inline theme color either', () => {
    const { container } = render(<ThemeChoice learner={learner()} />)
    for (const el of container.querySelectorAll<HTMLElement>('*')) {
      expect(el.getAttribute('style') ?? '').not.toMatch(/#/)
    }
  })

  it('marks the chosen world with ink rather than with its own color', () => {
    render(<ThemeChoice learner={learner({ theme: 'cats' })} />)
    const chosen = screen.getByRole('button', { name: /Cats/ })
    expect(chosen.className).toContain('bg-ink')
  })
})

describe('accessibility', () => {
  it('exposes the choice as pressed state rather than color alone', () => {
    render(<ThemeChoice learner={learner({ theme: 'music' })} />)
    const pressed = screen
      .getAllByRole('button')
      .filter((b) => b.getAttribute('aria-pressed') === 'true')
    expect(pressed).toHaveLength(1)
    expect(within(pressed[0]!).getByText('Music')).toBeInTheDocument()
  })
})
