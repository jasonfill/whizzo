// One earned collectible.
//
// It replaced a component that fetched real kitten photographs from a
// third-party host, so the two properties worth pinning are that it reaches no
// network at all, and that a slot always names the same item — the one the
// collection screen shows in that position — so a learner is never told they
// earned one thing and then shown another.

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Collectible from './Collectible'
import { slotLabels, THEMES, themeById } from '../lib/themes'

let activeTheme = THEMES[0]!
vi.mock('../lib/theme/ThemeProvider', () => ({
  useTheme: () => ({
    theme: activeTheme,
    themes: THEMES,
    setTheme: vi.fn(),
    setThemeFor: vi.fn(),
    source: 'guest',
  }),
}))

describe('what it draws', () => {
  it('names the slot it was given, in the current theme', () => {
    activeTheme = themeById('cats')
    render(<Collectible slot={2} showLabel />)
    const label = screen.getByRole('img').getAttribute('aria-label')!
    expect(label.startsWith(slotLabels(activeTheme)[2]!)).toBe(true)
  })

  it('describes it as one of the theme’s collectibles, for a screen reader', () => {
    activeTheme = themeById('robots')
    render(<Collectible slot={0} />)
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain(activeTheme.unitOne)
  })

  it('shows the name only when asked', () => {
    activeTheme = themeById('cats')
    const name = slotLabels(activeTheme)[0]!
    const { rerender } = render(<Collectible slot={0} />)
    expect(screen.queryByText(name)).toBeNull()
    rerender(<Collectible slot={0} showLabel />)
    expect(screen.getByText(name)).toBeTruthy()
  })
})

describe('a slot always means the same item', () => {
  it('names the same item the collection screen fills in that position', () => {
    for (const theme of THEMES) {
      activeTheme = theme
      const names = slotLabels(theme)
      for (const slot of [0, 1, names.length - 1]) {
        const { unmount } = render(<Collectible slot={slot} />)
        const label = screen.getByRole('img').getAttribute('aria-label')!
        unmount()
        expect(label.startsWith(names[slot]!), `${theme.id}/${slot}: ${label}`).toBe(true)
      }
    }
  })

  it('never names a slot past the end of the set', () => {
    activeTheme = themeById('cats')
    const names = slotLabels(activeTheme)
    render(<Collectible slot={999} />)
    const label = screen.getByRole('img').getAttribute('aria-label')!
    expect(label.startsWith(names[names.length - 1]!)).toBe(true)
  })

  it('still accepts a legacy seed, and keeps it inside the set', () => {
    activeTheme = themeById('cats')
    const names = new Set(slotLabels(activeTheme))
    const { unmount } = render(<Collectible seed="lesson-1" />)
    const label = screen.getByRole('img').getAttribute('aria-label')!
    unmount()
    expect([...names].some((n) => label.startsWith(n))).toBe(true)
  })
})

describe('it reaches no network', () => {
  it('renders no img element and no remote src', () => {
    // The component it replaced fetched kitten photographs from a third-party
    // image host, which put a network round trip in front of a child's reward.
    activeTheme = themeById('cats')
    const { container } = render(<Collectible slot={0} />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.innerHTML).not.toMatch(/https?:\/\//)
  })
})
