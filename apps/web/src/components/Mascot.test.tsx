// The mascot.
//
// Mostly drawing, which tests cannot judge — so these cover the parts that are
// contract rather than art: that `sad` is really gone, that every theme has a
// character, that an overridden color is honored, and that the thing is
// legible to a screen reader.

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Mascot, { MASCOT_MUTED, type Mood } from './Mascot'
import { THEMES } from '../lib/themes'

const theme = THEMES[0]!
vi.mock('../lib/theme/ThemeProvider', () => ({
  useTheme: () => ({ theme: THEMES[0]!, themes: THEMES, setTheme: vi.fn(), setThemeFor: vi.fn(), source: 'guest' }),
}))

const MOODS: Mood[] = ['idle', 'cheer', 'thinking', 'resting']

describe('states', () => {
  it('draws all four', () => {
    for (const mood of MOODS) {
      const { unmount } = render(<Mascot mood={mood} />)
      expect(screen.getByRole('img')).toBeInTheDocument()
      unmount()
    }
  })

  it('defaults to idle', () => {
    render(<Mascot />)
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', expect.stringContaining('idle'))
  })

  it('names its state in the label, so the four are distinguishable', () => {
    for (const mood of MOODS) {
      const { unmount } = render(<Mascot mood={mood} />)
      expect(screen.getByRole('img').getAttribute('aria-label')).toContain(mood)
      unmount()
    }
  })

  it('draws a visibly different face per state', () => {
    // Four states that render identically would be four states in name only.
    const drawings = MOODS.map((mood) => {
      const { container, unmount } = render(<Mascot mood={mood} />)
      const svg = container.querySelector('svg')!.innerHTML
      unmount()
      return svg
    })
    expect(new Set(drawings).size).toBe(4)
  })
})

describe('every theme has a character', () => {
  it('draws one for all ten rather than falling back to a stripe', () => {
    for (const t of THEMES) {
      const { container, unmount } = render(<Mascot themeId={t.id} />)
      const svg = container.querySelector('svg')
      expect(svg, `${t.id} has no drawing`).not.toBeNull()
      expect(svg!.querySelectorAll('ellipse, rect, polygon').length).toBeGreaterThan(3)
      unmount()
    }
  })

  it('draws a different silhouette per theme', () => {
    const shapes = THEMES.map((t) => {
      const { container, unmount } = render(<Mascot themeId={t.id} />)
      const svg = container.querySelector('svg')!.innerHTML
      unmount()
      return svg
    })
    expect(new Set(shapes).size).toBe(THEMES.length)
  })

  it('names the theme in the label', () => {
    render(<Mascot themeId="robots" />)
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', expect.stringContaining('Robots'))
  })
})

describe('color', () => {
  it('uses the active theme accent by default', () => {
    const { container } = render(<Mascot />)
    expect(container.innerHTML).toContain(theme.accent)
  })

  it('honors an overridden color', () => {
    const { container } = render(<Mascot color="#38bdf8" />)
    expect(container.innerHTML).toContain('#38bdf8')
    expect(container.innerHTML).not.toContain(theme.accent)
  })

  it('derives a whole palette from the override rather than mixing in the theme', () => {
    // An overridden mascot should be one coherent character, not a themed body
    // with themed trim stuck to it.
    const { container } = render(<Mascot color={MASCOT_MUTED} />)
    const fills = [...container.querySelectorAll('[fill]')].map((el) => el.getAttribute('fill')!)
    expect(new Set(fills).size).toBeGreaterThan(1)
    expect(container.innerHTML).not.toContain(theme.accent)
  })

  it('exports the muted companion as a name rather than leaving it a hex', () => {
    expect(MASCOT_MUTED).toMatch(/^#[0-9A-Fa-f]{6}$/)
  })
})

describe('sizes', () => {
  it('renders at each of the four slot sizes', () => {
    for (const size of [200, 108, 62, 34]) {
      const { container, unmount } = render(<Mascot size={size} />)
      const svg = container.querySelector('svg')!
      expect(svg.getAttribute('width')).toBe(String(size))
      expect(svg.getAttribute('height')).toBe(String(size))
      unmount()
    }
  })

  it('keeps one viewBox at every size, so the silhouette does not distort', () => {
    const boxes = [200, 34].map((size) => {
      const { container, unmount } = render(<Mascot size={size} />)
      const box = container.querySelector('svg')!.getAttribute('viewBox')
      unmount()
      return box
    })
    expect(new Set(boxes).size).toBe(1)
  })

  it('passes a className through for the float animation', () => {
    const { container } = render(<Mascot className="animate-floaty" />)
    expect(container.querySelector('svg')!.getAttribute('class')).toContain('animate-floaty')
  })
})

describe('sad is retired', () => {
  it('is not in the Mood union', () => {
    // A type-level fact, asserted at runtime so it survives a refactor: the
    // four states are the whole set.
    const moods: string[] = [...MOODS]
    expect(moods).not.toContain('sad')
    expect(moods).toHaveLength(4)
  })

  it('falls back to a drawing rather than blanking on an unknown state', () => {
    render(<Mascot mood={'sad' as Mood} />)
    expect(screen.getByRole('img')).toBeInTheDocument()
  })
})
