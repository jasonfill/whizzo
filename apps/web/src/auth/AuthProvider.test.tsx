// Signing in.
//
// Three routes in: an email and password, Google, and — the one this product
// exists to make possible — a code and a PIN, so a child under 13 never needs
// an email address of their own.
//
// What the tests hold onto is that a failure is always reported in words a
// person could act on, and that a build with no Supabase credentials still
// runs as a guest rather than showing a broken sign-in screen.

import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const authApi = vi.hoisted(() => ({
  getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
  onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
  signInWithPassword: vi.fn(async () => ({ error: null })),
  signUp: vi.fn(async () => ({ data: { session: null }, error: null })),
  signInWithOAuth: vi.fn(async () => ({ error: null })),
  setSession: vi.fn(async () => ({ error: null })),
  resetPasswordForEmail: vi.fn(async () => ({ error: null })),
  signOut: vi.fn(async () => ({ error: null })),
}))

const supabaseMock = vi.hoisted(() => ({
  configured: true,
  from: vi.fn(() => ({
    select: () => ({
      eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
    }),
    update: () => ({ eq: async () => ({ error: null }) }),
  })),
}))

vi.mock('../lib/supabase', () => ({
  get supabase() {
    return supabaseMock.configured ? { auth: authApi, from: supabaseMock.from } : null
  },
  get isSupabaseConfigured() {
    return supabaseMock.configured
  },
  authRedirectUrl: () => 'https://whizzo.test/auth/callback',
}))

const apiRequest = vi.hoisted(() => vi.fn())
vi.mock('../lib/api/client', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  apiRequest: (...a: unknown[]) => apiRequest(...a),
}))

import { AuthProvider, useAuth } from './AuthProvider'

function Probe() {
  const auth = useAuth()
  return (
    <div>
      <span data-testid="status">{auth.status}</span>
      <span data-testid="configured">{String(auth.configured)}</span>
      <span data-testid="error">{auth.error ?? ''}</span>
      <button onClick={() => void auth.signIn('a@b.test', 'pw').catch(() => {})}>sign-in</button>
      <button onClick={() => void auth.signInWithGoogle().catch(() => {})}>google</button>
      <button onClick={() => void auth.signInWithCode('abc123', '1234').catch(() => {})}>code</button>
      <button onClick={() => void auth.signOut()}>sign-out</button>
      <button onClick={() => auth.clearError()}>clear</button>
      <span data-testid="profile">{auth.profile?.displayName ?? ''}</span>
      <span data-testid="plan">{auth.profile?.plan ?? ''}</span>
      <button onClick={() => void auth.signUp('a@b.test', 'pw', 'Sam').catch(() => {})}>
        sign-up
      </button>
      <button onClick={() => void auth.sendPasswordReset('a@b.test').catch(() => {})}>
        reset
      </button>
      <button onClick={() => void auth.updateProfile({ displayName: 'Renamed' })}>rename</button>
    </div>
  )
}

/** A signed-in session, with `profiles` answering with `row`. */
function signedInWith(row: Record<string, unknown> | null) {
  authApi.getSession.mockResolvedValue({
    data: { session: { user: { id: 'u1' } } },
    error: null,
  } as never)
  supabaseMock.from.mockReturnValue({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }),
    insert: () => ({ select: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }),
    update: () => ({ eq: async () => ({ error: null }) }),
  } as never)
}

function renderAuth() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  )
}

const click = async (label: string) => {
  await act(async () => {
    screen.getByText(label).click()
  })
}

beforeEach(() => {
  supabaseMock.configured = true
  for (const fn of Object.values(authApi)) fn.mockClear()
  authApi.getSession.mockResolvedValue({ data: { session: null }, error: null })
  authApi.onAuthStateChange.mockReturnValue({
    data: { subscription: { unsubscribe: vi.fn() } },
  })
  authApi.signUp.mockResolvedValue({ data: { session: null }, error: null } as never)
  authApi.resetPasswordForEmail.mockResolvedValue({ error: null } as never)
  supabaseMock.from.mockReturnValue({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    insert: () => ({ select: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    update: () => ({ eq: async () => ({ error: null }) }),
  } as never)
  apiRequest.mockReset()
})

describe('starting up', () => {
  it('settles as a guest when there is no session', async () => {
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('guest'))
  })

  it('subscribes to session changes so a sign-in elsewhere is noticed', async () => {
    renderAuth()
    await waitFor(() => expect(authApi.onAuthStateChange).toHaveBeenCalled())
  })

  it('runs as a guest-only build when there are no credentials', async () => {
    // A build without Supabase should still let a child practise, rather than
    // showing a sign-in screen that cannot work.
    supabaseMock.configured = false
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('guest'))
    expect(screen.getByTestId('configured')).toHaveTextContent('false')
  })
})

describe('email and password', () => {
  it('signs in', async () => {
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('guest'))
    await click('sign-in')
    expect(authApi.signInWithPassword).toHaveBeenCalledWith({
      email: 'a@b.test',
      password: 'pw',
    })
  })

  it('reports a refusal in words rather than swallowing it', async () => {
    authApi.signInWithPassword.mockResolvedValue({
      error: { message: 'Invalid login credentials' },
    } as never)
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('guest'))
    await click('sign-in')
    await waitFor(() => expect(screen.getByTestId('error')).not.toHaveTextContent(''))
  })

  it('lets the screen clear a stale error', async () => {
    authApi.signInWithPassword.mockResolvedValue({ error: { message: 'nope' } } as never)
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('guest'))
    await click('sign-in')
    await waitFor(() => expect(screen.getByTestId('error')).not.toHaveTextContent(''))
    await click('clear')
    expect(screen.getByTestId('error')).toHaveTextContent('')
  })
})

describe('Google', () => {
  it('starts the OAuth dance', async () => {
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('guest'))
    await click('google')
    expect(authApi.signInWithOAuth).toHaveBeenCalled()
  })
})

describe('code and PIN — the child’s way in', () => {
  it('exchanges the code through the API, not through Supabase directly', async () => {
    // The exchange needs a service role, so it happens server side; the browser
    // only ever receives the resulting session.
    apiRequest.mockResolvedValue({
      session: { accessToken: 'a', refreshToken: 'r' },
    })
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('guest'))
    await click('code')
    expect(apiRequest).toHaveBeenCalledWith('/child-login', expect.objectContaining({
      method: 'POST',
      anonymous: true,
    }))
  })

  it('normalises the code, so case and stray spaces do not fail a child', async () => {
    apiRequest.mockResolvedValue({ session: { accessToken: 'a', refreshToken: 'r' } })
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('guest'))
    await click('code')
    const body = apiRequest.mock.calls[0]![1] as { body: { loginCode: string } }
    expect(body.body.loginCode).toBe('ABC123')
  })

  it('installs the session it was handed', async () => {
    apiRequest.mockResolvedValue({ session: { accessToken: 'a', refreshToken: 'r' } })
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('guest'))
    await click('code')
    expect(authApi.setSession).toHaveBeenCalledWith({
      access_token: 'a',
      refresh_token: 'r',
    })
  })

  it('says the code or PIN is wrong rather than showing a raw failure', async () => {
    apiRequest.mockRejectedValue(new Error('Request failed (401)'))
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('guest'))
    await click('code')
    await waitFor(() => expect(screen.getByTestId('error')).not.toHaveTextContent(''))
  })
})

describe('signing out', () => {
  it('ends the session', async () => {
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('guest'))
    await click('sign-out')
    expect(authApi.signOut).toHaveBeenCalled()
  })
})

describe('creating an account', () => {
  it('passes the display name through, and falls back to the address', async () => {
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('guest'))
    await click('sign-up')
    expect(authApi.signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'a@b.test',
        options: expect.objectContaining({ data: { display_name: 'Sam' } }),
      }),
    )
  })

  it('softens a blunt refusal into something a person can act on', async () => {
    authApi.signUp.mockResolvedValue({
      data: { session: null },
      error: new Error('User already registered'),
    } as never)
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('guest'))
    await click('sign-up')
    await waitFor(() =>
      expect(screen.getByTestId('error')).toHaveTextContent(
        'There is already an account with that email.',
      ),
    )
  })

  it('softens the short-password and rate-limit refusals too', async () => {
    for (const [raw, friendly] of [
      ['Password should be at least 6 characters', 'Passwords need at least 6 characters.'],
      ['Email rate limit exceeded', 'Too many attempts just now — try again in a minute.'],
    ] as const) {
      authApi.signUp.mockResolvedValue({
        data: { session: null },
        error: new Error(raw),
      } as never)
      const view = renderAuth()
      await waitFor(() => expect(view.getAllByTestId('status')[0]).toBeTruthy())
      await act(async () => {
        view.getAllByText('sign-up').slice(-1)[0]!.click()
      })
      await waitFor(() =>
        expect(view.getAllByTestId('error').slice(-1)[0]!).toHaveTextContent(friendly),
      )
      view.unmount()
    }
  })

  it('passes an unrecognised message through as it came', async () => {
    authApi.signUp.mockResolvedValue({
      data: { session: null },
      error: new Error('Something odd happened'),
    } as never)
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('guest'))
    await click('sign-up')
    await waitFor(() =>
      expect(screen.getByTestId('error')).toHaveTextContent('Something odd happened'),
    )
  })
})

describe('a password reset', () => {
  it('is sent to the address given', async () => {
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('guest'))
    await click('reset')
    expect(authApi.resetPasswordForEmail).toHaveBeenCalledWith(
      'a@b.test',
      expect.objectContaining({ redirectTo: 'https://whizzo.test/auth/callback' }),
    )
  })

  it('reports a refusal', async () => {
    authApi.resetPasswordForEmail.mockResolvedValue({
      error: new Error('Email rate limit exceeded'),
    } as never)
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('guest'))
    await click('reset')
    await waitFor(() => expect(screen.getByTestId('error')).not.toHaveTextContent(''))
  })
})

describe('the profile behind a session', () => {
  it('is loaded, with sensible stand-ins for anything missing', async () => {
    signedInWith({ id: 'u1', display_name: null, avatar_emoji: null, plan: null })
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-in'))
    expect(screen.getByTestId('profile')).toHaveTextContent('Friend')
    expect(screen.getByTestId('plan')).toHaveTextContent('free')
  })

  it('is created when the sign-up trigger never made one', async () => {
    // An account made before the migration ran would otherwise leave the app
    // sitting in a half-signed-in state forever.
    authApi.getSession.mockResolvedValue({
      data: { session: { user: { id: 'u1' } } },
      error: null,
    } as never)
    const insert = vi.fn(() => ({
      select: () => ({
        maybeSingle: async () => ({ data: { id: 'u1', display_name: 'Made' }, error: null }),
      }),
    }))
    supabaseMock.from.mockReturnValue({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
      insert,
      update: () => ({ eq: async () => ({ error: null }) }),
    } as never)
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('profile')).toHaveTextContent('Made'))
    expect(insert).toHaveBeenCalledWith({ id: 'u1' })
  })

  it('signs in anyway when the profile cannot be read', async () => {
    authApi.getSession.mockResolvedValue({
      data: { session: { user: { id: 'u1' } } },
      error: null,
    } as never)
    supabaseMock.from.mockReturnValue({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'rls' } }) }),
      }),
      update: () => ({ eq: async () => ({ error: null }) }),
    } as never)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-in'))
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('shows a rename straight away rather than waiting for the round trip', async () => {
    signedInWith({ id: 'u1', display_name: 'Sam' })
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('profile')).toHaveTextContent('Sam'))
    await click('rename')
    expect(screen.getByTestId('profile')).toHaveTextContent('Renamed')
  })

  it('does nothing when there is no profile to edit', async () => {
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('guest'))
    await click('rename')
    expect(screen.getByTestId('profile')).toHaveTextContent('')
  })
})

describe('when the auth service cannot be reached', () => {
  it('opens as a guest rather than spinning forever', async () => {
    // A child on a flaky connection gets to practise, not a spinner.
    vi.useFakeTimers()
    let settle: (v: unknown) => void = () => {}
    authApi.getSession.mockReturnValue(new Promise((r) => { settle = r }) as never)
    renderAuth()
    expect(screen.getByTestId('status')).toHaveTextContent('loading')
    await act(async () => {
      vi.advanceTimersByTime(6001)
    })
    expect(screen.getByTestId('status')).toHaveTextContent('guest')
    settle({ data: { session: null }, error: null })
    vi.useRealTimers()
  })

  it('carries on as a guest when the session lookup throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    authApi.getSession.mockRejectedValue(new Error('network'))
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('guest'))
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('a session that changes underneath the app', () => {
  it('notices a sign-in that happened elsewhere', async () => {
    let handler: ((e: string, s: unknown) => Promise<void>) | null = null
    ;(authApi.onAuthStateChange as unknown as { mockImplementation: (f: unknown) => void })
      .mockImplementation((fn: unknown) => {
        handler = fn as never
        return { data: { subscription: { unsubscribe: vi.fn() } } }
      })
    supabaseMock.from.mockReturnValue({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { id: 'u1', display_name: 'Sam' }, error: null }) }),
      }),
      update: () => ({ eq: async () => ({ error: null }) }),
    } as never)
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('guest'))
    await act(async () => {
      await handler!('SIGNED_IN', { user: { id: 'u1' } })
    })
    expect(screen.getByTestId('status')).toHaveTextContent('signed-in')
    expect(screen.getByTestId('profile')).toHaveTextContent('Sam')
  })

  // Supabase re-announces the session whenever the tab regains focus. That is
  // not a sign-in, and treating it as one reloads everything downstream and
  // throws a learner out of the round they were in.
  it('holds still when the tab comes back and the session is unchanged', async () => {
    let handler: ((e: string, s: unknown) => Promise<void>) | null = null
    ;(authApi.onAuthStateChange as unknown as { mockImplementation: (f: unknown) => void })
      .mockImplementation((fn: unknown) => {
        handler = fn as never
        return { data: { subscription: { unsubscribe: vi.fn() } } }
      })
    signedInWith({ id: 'u1', display_name: 'Sam' })
    authApi.getSession.mockResolvedValue({
      data: { session: { user: { id: 'u1' }, access_token: 't1' } },
      error: null,
    } as never)
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('profile')).toHaveTextContent('Sam'))
    const profileReads = supabaseMock.from.mock.calls.length

    await act(async () => {
      await handler!('SIGNED_IN', { user: { id: 'u1' }, access_token: 't1' })
    })
    expect(supabaseMock.from.mock.calls.length).toBe(profileReads)
    expect(screen.getByTestId('status')).toHaveTextContent('signed-in')
    expect(screen.getByTestId('profile')).toHaveTextContent('Sam')
  })

  it('takes a rotated token without reloading the account', async () => {
    let handler: ((e: string, s: unknown) => Promise<void>) | null = null
    ;(authApi.onAuthStateChange as unknown as { mockImplementation: (f: unknown) => void })
      .mockImplementation((fn: unknown) => {
        handler = fn as never
        return { data: { subscription: { unsubscribe: vi.fn() } } }
      })
    signedInWith({ id: 'u1', display_name: 'Sam' })
    authApi.getSession.mockResolvedValue({
      data: { session: { user: { id: 'u1' }, access_token: 't1' } },
      error: null,
    } as never)
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('profile')).toHaveTextContent('Sam'))
    const profileReads = supabaseMock.from.mock.calls.length

    await act(async () => {
      await handler!('TOKEN_REFRESHED', { user: { id: 'u1' }, access_token: 't2' })
    })
    expect(supabaseMock.from.mock.calls.length).toBe(profileReads)
    expect(screen.getByTestId('profile')).toHaveTextContent('Sam')
  })

  it('drops the profile when the session ends elsewhere', async () => {
    let handler: ((e: string, s: unknown) => Promise<void>) | null = null
    ;(authApi.onAuthStateChange as unknown as { mockImplementation: (f: unknown) => void })
      .mockImplementation((fn: unknown) => {
        handler = fn as never
        return { data: { subscription: { unsubscribe: vi.fn() } } }
      })
    signedInWith({ id: 'u1', display_name: 'Sam' })
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('profile')).toHaveTextContent('Sam'))
    await act(async () => {
      await handler!('SIGNED_OUT', null)
    })
    expect(screen.getByTestId('status')).toHaveTextContent('guest')
    expect(screen.getByTestId('profile')).toHaveTextContent('')
  })

  it('unsubscribes when it goes away', async () => {
    const unsubscribe = vi.fn()
    authApi.onAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe } },
    } as never)
    const view = renderAuth()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('guest'))
    view.unmount()
    expect(unsubscribe).toHaveBeenCalled()
  })
})

describe('a build with no credentials at all', () => {
  it('refuses each action with something a developer can read', async () => {
    supabaseMock.configured = false
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('guest'))
    for (const label of ['sign-in', 'sign-up', 'google', 'code', 'reset']) {
      await click(label)
    }
    // Nothing reached Supabase, and nothing crashed the screen.
    expect(authApi.signInWithPassword).not.toHaveBeenCalled()
    expect(screen.getByTestId('status')).toHaveTextContent('guest')
  })

  it('signing out is a no-op rather than a crash', async () => {
    supabaseMock.configured = false
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('guest'))
    await click('sign-out')
    expect(authApi.signOut).not.toHaveBeenCalled()
  })
})

describe('useAuth outside a provider', () => {
  it('fails loudly', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Probe />)).toThrow(/AuthProvider/)
  })
})
