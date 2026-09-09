// The mastery bar.
//
// It appears on both a student screen and a parent report, which is exactly
// why it is the component most likely to drift into a theme color. The rule:
// progress is pine in every world, always.

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import MasteryBar from './MasteryBar'

function widths(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLElement>('[style*="width"]')].map(
    (el) => el.style.width,
  )
}

describe('proportions', () => {
  it('sizes each band as its share of the total', () => {
    const { container } = render(
      <MasteryBar mastered={25} practiced={25} learning={25} total={100} />,
    )
    expect(widths(container)).toEqual(['25%', '25%', '25%'])
  })

  it('shows nothing rather than dividing by zero on an untouched list', () => {
    const { container } = render(<MasteryBar mastered={0} practiced={0} learning={0} total={0} />)
    expect(widths(container)).toEqual(['0%', '0%', '0%'])
  })

  it('reports what is left as not yet seen', () => {
    render(<MasteryBar mastered={10} practiced={5} learning={5} total={60} />)
    expect(screen.getByText(/Not yet seen 40/)).toBeInTheDocument()
  })

  it('labels every band with its count', () => {
    render(<MasteryBar mastered={3} practiced={2} learning={1} total={10} />)
    expect(screen.getByText(/Mastered 3/)).toBeInTheDocument()
    expect(screen.getByText(/Practiced 2/)).toBeInTheDocument()
    expect(screen.getByText(/Learning 1/)).toBeInTheDocument()
  })
})

describe('a progress bar is pine in every world', () => {
  it('fills with pine and pineSoft, never with the accent', () => {
    const { container } = render(
      <MasteryBar mastered={5} practiced={5} learning={5} total={20} />,
    )
    const classes = [...container.querySelectorAll('*')]
      .flatMap((el) => [...el.classList])
      .join(' ')
    expect(classes).toContain('bg-pine')
    expect(classes).toContain('bg-pineSoft')
    expect(classes).not.toContain('accent')
    expect(classes).not.toContain('tintA')
    expect(classes).not.toContain('tintB')
  })

  it('runs the track on the inert tray color', () => {
    const { container } = render(<MasteryBar mastered={1} practiced={1} learning={1} total={9} />)
    expect(container.querySelector('.bg-tray')).not.toBeNull()
  })

  it('gives the legend the same colors as the bar', () => {
    // A legend that disagrees with the bar it explains is worse than none.
    const { container } = render(<MasteryBar mastered={1} practiced={1} learning={1} total={9} />)
    for (const color of ['bg-pine', 'bg-pineSoft', 'bg-sun', 'bg-tray']) {
      expect(container.querySelectorAll(`.${color.replace('.', '\\.')}`).length).toBeGreaterThan(0)
    }
  })
})
