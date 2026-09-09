// The theme provider.
//
// Two people can write here — a student picking their own world and a grown-up
// setting one for a child — and the value lives in two different places
// depending on whether anyone is signed in. That combination is where the bugs
// are, so these tests drive it through the real component rather than calling
// the reducer.

import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider, useTheme } from './ThemeProvider'
import type { Learner } from '../learners'

const updateLearner = vi.fn(async (_id: string, _patch: object) => ({}) as Learner)
vi.mock('../learners/api', () => ({
  updateLearner: (...args: unknown[]) => updateLearner(...(args as [string, object])),
}))

let learnerState: { active: Learner | null; refresh: () => Promise<void> }
vi.mock('../learners/LearnerProvider', () => ({
  useLearners: () => learnerState,
}))

let authState: { status: string }
vi.mock('../../auth/AuthProvider', () => ({
  useAuth: () => authState,
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
    theme: null,
    ...over,
  } as Learner
}

function Probe() {
  const { theme, setTheme, source } = useTheme()
  return (
    <div>
      <span data-testid="name">{theme.name}</span>
      <span data-testid="verb">{theme.verb}</span>
      <span data-testid="source">{source}</span>
      <button onClick={() => setTheme('ocean')}>ocean</button>
      <button onClick={() => setTheme('robots')}>robots</button>
    </div>
  )
}

function renderProvider() {
  return render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  )
}

const accent = () => document.documentElement.style.getPropertyValue('--wz-accent')

beforeEach(() => {
  updateLearner.mockReset().mockResolvedValue({} as Learner)
  learnerState = { active: null, refresh: vi.fn(async () => {}) }
  authState = { status: 'signed-out' }
  document.documentElement.style.cssText = ''
})

describe('as a guest', () => {
  it('starts on the default world', () => {
    renderProvider()
    expect(screen.getByTestId('name')).toHaveTextContent('Cats')
    expect(screen.getByTestId('source')).toHaveTextContent('guest')
  })

  it('reads a world chosen on a previous visit', () => {
    localStorage.setItem('whizzo:theme:guest', 'music')
    renderProvider()
    expect(screen.getByTestId('name')).toHaveTextContent('Music')
  })

  it('ignores a stored value that is not a real world', () => {
    localStorage.setItem('whizzo:theme:guest', 'unicorns')
    renderProvider()
    expect(screen.getByTestId('name')).toHaveTextContent('Cats')
  })

  it('changes world on a click and remembers it', async () => {
    const user = userEvent.setup()
    renderProvider()
    await user.click(screen.getByText('ocean'))
    expect(screen.getByTestId('name')).toHaveTextContent('Ocean')
    expect(localStorage.getItem('whizzo:theme:guest')).toBe('ocean')
  })

  it('does not try to write to a learner row that does not exist', async () => {
    const user = userEvent.setup()
    renderProvider()
    await user.click(screen.getByText('ocean'))
    expect(updateLearner).not.toHaveBeenCalled()
  })

  it('survives storage being unavailable', () => {
    // A private window throws on getItem. Losing a color must not lose the app.
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(() => renderProvider()).not.toThrow()
    expect(screen.getByTestId('name')).toHaveTextContent('Cats')
    spy.mockRestore()
  })
})

describe('signed in', () => {
  beforeEach(() => {
    authState = { status: 'signed-in' }
    learnerState = { active: learner({ theme: 'horses' }), refresh: vi.fn(async () => {}) }
  })

  it('takes the world from the learner row, not from local storage', () => {
    // The row is the truth: it is what a parent set and what follows the
    // learner to another device.
    localStorage.setItem('whizzo:theme:guest', 'music')
    renderProvider()
    expect(screen.getByTestId('name')).toHaveTextContent('Horses')
    expect(screen.getByTestId('source')).toHaveTextContent('learner')
  })

  it('falls back to the default when the row has no world yet', () => {
    learnerState = { active: learner({ theme: null }), refresh: vi.fn(async () => {}) }
    renderProvider()
    expect(screen.getByTestId('name')).toHaveTextContent('Cats')
  })

  it('falls back rather than blanking on an unrecognized stored world', () => {
    learnerState = { active: learner({ theme: 'unicorns' }), refresh: vi.fn(async () => {}) }
    renderProvider()
    expect(screen.getByTestId('name')).toHaveTextContent('Cats')
  })

  it('saves a change to the learner row and refreshes', async () => {
    const user = userEvent.setup()
    renderProvider()
    await user.click(screen.getByText('ocean'))
    expect(updateLearner).toHaveBeenCalledWith('l1', { theme: 'ocean' })
    await waitFor(() => expect(learnerState.refresh).toHaveBeenCalled())
  })

  it('repaints immediately rather than waiting for the round trip', async () => {
    // Optimistic: a child clicking a world should see it change now, not after
    // the network.
    let settle: () => void = () => {}
    updateLearner.mockImplementation(
      () => new Promise((resolve) => (settle = () => resolve({} as Learner))),
    )
    const user = userEvent.setup()
    renderProvider()
    await user.click(screen.getByText('ocean'))
    expect(screen.getByTestId('name')).toHaveTextContent('Ocean')
    await act(async () => settle())
  })

  it('rolls back to the stored world when the save fails', async () => {
    // The app must not go on claiming something was saved when it was not.
    updateLearner.mockRejectedValue(new Error('offline'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const user = userEvent.setup()
    renderProvider()
    await user.click(screen.getByText('ocean'))
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('Horses'))
  })

  it('does not interrupt the learner when the save fails', async () => {
    updateLearner.mockRejectedValue(new Error('offline'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const user = userEvent.setup()
    renderProvider()
    await expect(user.click(screen.getByText('ocean'))).resolves.not.toThrow()
  })

  it('swaps the paint when the active child changes', () => {
    const { rerender } = renderProvider()
    expect(screen.getByTestId('name')).toHaveTextContent('Horses')
    learnerState = {
      active: learner({ id: 'l2', theme: 'robots' }),
      refresh: vi.fn(async () => {}),
    }
    rerender(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )
    expect(screen.getByTestId('name')).toHaveTextContent('Robots')
  })
})

describe('the CSS variables it publishes', () => {
  it('writes all four so a play surface never needs an inline style', () => {
    renderProvider()
    const style = document.documentElement.style
    expect(style.getPropertyValue('--wz-accent')).toBe('124 92 255')
    expect(style.getPropertyValue('--wz-accent-deep')).toBeTruthy()
    expect(style.getPropertyValue('--wz-tint-a')).toBeTruthy()
    expect(style.getPropertyValue('--wz-tint-b')).toBeTruthy()
  })

  it('rewrites them when the world changes', async () => {
    const user = userEvent.setup()
    renderProvider()
    const before = accent()
    await user.click(screen.getByText('robots'))
    expect(accent()).not.toBe(before)
    expect(accent()).toBe('71 85 105')
  })

  it('publishes a space-separated triple, which is what the tokens expect', () => {
    // `rgb(var(--wz-accent) / <alpha-value>)` needs exactly this shape. A comma
    // here would silently stop every accent utility being generated.
    renderProvider()
    expect(accent()).toMatch(/^\d{1,3} \d{1,3} \d{1,3}$/)
  })
})

describe('the copy it exposes', () => {
  it('hands every screen the same verb the picker showed', async () => {
    const user = userEvent.setup()
    renderProvider()
    expect(screen.getByTestId('verb')).toHaveTextContent('Pounce in')
    await user.click(screen.getByText('ocean'))
    expect(screen.getByTestId('verb')).toHaveTextContent('Dive in')
  })
})

describe('useTheme outside a provider', () => {
  it('fails loudly rather than rendering an unthemed screen', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Probe />)).toThrow(/ThemeProvider/)
  })
})
