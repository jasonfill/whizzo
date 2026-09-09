// The shared primitives.
//
// Small, but they set the rule the whole color sweep rests on: `primary` is
// brand chrome and stays spark on every surface, `play` is the themed CTA and
// belongs only on a student play surface. Keeping them as separate variants is
// what stops a progress report picking up a child's accent by reaching for the
// default.

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Button, Card, Eyebrow, Pill, StarRow } from './ui'

describe('Button', () => {
  it('renders its label and responds to a click', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Start</Button>)
    await userEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('defaults to brand chrome, not to the theme accent', () => {
    // The important default: a screen that does not think about it gets spark.
    render(<Button>Go</Button>)
    expect(screen.getByRole('button').className).toContain('bg-spark')
    expect(screen.getByRole('button').className).not.toContain('bg-accent')
  })

  it('takes the theme accent only when asked for the play variant', () => {
    render(<Button variant="play">Go</Button>)
    expect(screen.getByRole('button').className).toContain('bg-accent')
  })

  it('keeps every other variant free of the accent', () => {
    for (const variant of ['primary', 'secondary', 'ghost', 'danger', 'success'] as const) {
      const { unmount } = render(<Button variant={variant}>Go</Button>)
      expect(screen.getByRole('button').className, variant).not.toContain('accent')
      unmount()
    }
  })

  it('does not fire when disabled', async () => {
    const onClick = vi.fn()
    render(
      <Button disabled onClick={onClick}>
        Go
      </Button>,
    )
    await userEvent.click(screen.getByRole('button'))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('drops its shadow when disabled, so it does not look pressable', () => {
    render(<Button disabled>Go</Button>)
    expect(screen.getByRole('button').className).toContain('disabled:shadow-none')
  })

  it('passes through button attributes like type', () => {
    render(<Button type="submit">Go</Button>)
    expect(screen.getByRole('button')).toHaveAttribute('type', 'submit')
  })

  it('appends a caller’s className rather than replacing its own', () => {
    render(<Button className="mt-4">Go</Button>)
    const cls = screen.getByRole('button').className
    expect(cls).toContain('mt-4')
    expect(cls).toContain('bg-spark')
  })
})

describe('StarRow', () => {
  it('says how many stars out of three, for a screen reader', () => {
    render(<StarRow stars={2} />)
    expect(screen.getByLabelText('2 of 3 stars')).toBeInTheDocument()
  })

  it('always draws three, dimming the ones not earned', () => {
    const { container } = render(<StarRow stars={1} />)
    const spans = container.querySelectorAll('span')
    expect(spans).toHaveLength(3)
    expect(spans[0]!.className).not.toContain('grayscale')
    expect(spans[1]!.className).toContain('grayscale')
  })

  it('copes with none earned and with all three', () => {
    for (const stars of [0, 3]) {
      const { unmount } = render(<StarRow stars={stars} />)
      expect(screen.getByLabelText(`${stars} of 3 stars`)).toBeInTheDocument()
      unmount()
    }
  })
})

describe('Card', () => {
  it('is drawn with a hair border rather than a shadow', () => {
    // The system has two shadows and a card is neither of them.
    const { container } = render(<Card>content</Card>)
    const card = container.firstElementChild!
    expect(card.className).toContain('border-hair')
    expect(card.className).not.toMatch(/shadow-(xl|lg|md)/)
  })

  it('renders its children', () => {
    render(<Card>inside</Card>)
    expect(screen.getByText('inside')).toBeInTheDocument()
  })
})

describe('Pill', () => {
  it('renders its content and an optional title', () => {
    render(<Pill title="why">6 words</Pill>)
    expect(screen.getByText('6 words')).toHaveAttribute('title', 'why')
  })
})

describe('Eyebrow', () => {
  it('is uppercase micro-type in the mono face', () => {
    const { container } = render(<Eyebrow>counts</Eyebrow>)
    const cls = container.firstElementChild!.className
    expect(cls).toContain('font-mono')
    expect(cls).toContain('uppercase')
  })
})
