// Handing over a document.
//
// The property every test here defends: **nothing is spent without being shown
// first.** Registering a link asks what it would cost; only an explicit tap
// starts the run. A screen that quietly began the job on submit would be the
// same feature and a much worse product.

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const contentApi = vi.hoisted(() => ({
  contentStatus: vi.fn(),
  addLink: vi.fn(),
  estimateFor: vi.fn(),
  startBuild: vi.fn(),
  uploadFiles: vi.fn(),
  jobStatus: vi.fn(),
  acceptDeck: vi.fn(),
}))

vi.mock('../../lib/content/api', async () => {
  const real = await vi.importActual<typeof import('../../lib/content/api')>(
    '../../lib/content/api',
  )
  return { ...real, ...contentApi }
})

import ContentScreen from './ContentScreen'

const navigate = vi.fn()

const job = (over: Record<string, unknown> = {}) => ({
  id: 'j1',
  status: 'queued',
  stage: 'Waiting to start',
  error: null,
  result: null,
  ...over,
})

beforeEach(() => {
  navigate.mockClear()
  for (const fn of Object.values(contentApi)) fn.mockReset()
  contentApi.contentStatus.mockResolvedValue({
    enabled: true,
    balance: { included: 30, purchased: 0, total: 30 },
  })
  contentApi.addLink.mockResolvedValue({ sourceId: 's1', job: job() })
  contentApi.estimateFor.mockResolvedValue({
    estimate: { pages: 24, credits: 24, noRush: false },
    balance: { included: 30, purchased: 0, total: 30 },
    allowed: true,
    reason: null,
  })
  contentApi.startBuild.mockResolvedValue({ job: job({ status: 'reading', stage: 'Reading the document' }) })
  contentApi.jobStatus.mockResolvedValue({
    job: job({ status: 'done', stage: 'Ready to look over', result: { setsLanded: 3 } }),
  })
})

describe('when the feature is not switched on', () => {
  it('says so instead of offering something that cannot work', async () => {
    contentApi.contentStatus.mockResolvedValue({ enabled: false, balance: null })
    render(<ContentScreen navigate={navigate} />)
    expect(await screen.findByText(/not switched on here/i)).toBeTruthy()
  })
})

describe('asking what it would cost', () => {
  it('shows the balance before anything is typed', async () => {
    render(<ContentScreen navigate={navigate} />)
    expect(await screen.findByText(/30 credits left/i)).toBeTruthy()
  })

  it('will not submit an empty link', async () => {
    render(<ContentScreen navigate={navigate} />)
    await screen.findByLabelText(/Paste a link/i)
    expect(screen.getByText(/See what it would cost/i).closest('button')!.disabled).toBe(true)
  })

  it('quotes the cost without starting anything', async () => {
    // The whole reason the estimate is its own call.
    render(<ContentScreen navigate={navigate} />)
    fireEvent.change(await screen.findByLabelText(/Paste a link/i), {
      target: { value: 'https://docs.google.com/document/d/abc/edit' },
    })
    fireEvent.click(screen.getByText(/See what it would cost/i))

    expect(await screen.findByText(/24 pages, about 24 credits/i)).toBeTruthy()
    expect(contentApi.startBuild).not.toHaveBeenCalled()
  })

  it('says why not when it cannot be afforded, and offers no way to start', async () => {
    contentApi.estimateFor.mockResolvedValue({
      estimate: { pages: 60, credits: 60, noRush: false },
      balance: { included: 5, purchased: 0, total: 5 },
      allowed: false,
      reason: 'This needs 60 credits and there are 5 left.',
    })
    render(<ContentScreen navigate={navigate} />)
    fireEvent.change(await screen.findByLabelText(/Paste a link/i), {
      target: { value: 'https://example.com/a.pdf' },
    })
    fireEvent.click(screen.getByText(/See what it would cost/i))

    expect(await screen.findByText(/60 credits and there are 5 left/)).toBeTruthy()
    expect(screen.queryByText(/Make the cards/i)).toBeNull()
  })

  it('surfaces a refused link rather than failing silently', async () => {
    contentApi.addLink.mockRejectedValue(new Error('Links have to start with https://'))
    render(<ContentScreen navigate={navigate} />)
    fireEvent.change(await screen.findByLabelText(/Paste a link/i), {
      target: { value: 'http://example.com' },
    })
    fireEvent.click(screen.getByText(/See what it would cost/i))
    expect(await screen.findByText(/have to start with https/i)).toBeTruthy()
  })

  it('asks for the half-price quote when no rush is chosen', async () => {
    render(<ContentScreen navigate={navigate} />)
    fireEvent.click(await screen.findByLabelText(/No rush/i))
    fireEvent.change(screen.getByLabelText(/Paste a link/i), {
      target: { value: 'https://example.com/a.pdf' },
    })
    fireEvent.click(screen.getByText(/See what it would cost/i))
    await waitFor(() => expect(contentApi.estimateFor).toHaveBeenCalledWith('s1', true))
  })
})

describe('running it', () => {
  async function quoteThenRun() {
    render(<ContentScreen navigate={navigate} />)
    fireEvent.change(await screen.findByLabelText(/Paste a link/i), {
      target: { value: 'https://example.com/a.pdf' },
    })
    fireEvent.click(screen.getByText(/See what it would cost/i))
    fireEvent.click(await screen.findByText(/Make the cards/i))
  }

  it('starts only when told to', async () => {
    await quoteThenRun()
    await waitFor(() => expect(contentApi.startBuild).toHaveBeenCalledOnce())
  })

  it('says what it is doing, in words', async () => {
    await quoteThenRun()
    expect(await screen.findByText('Reading the document')).toBeTruthy()
  })

  it('says the run survives leaving the page', async () => {
    await quoteThenRun()
    expect(await screen.findByText(/keeps going/i)).toBeTruthy()
  })

  it('reports what landed, and that it is a draft', async () => {
    await quoteThenRun()
    // The first poll lands at pollDelay(0), which is exactly the default
    // findBy timeout — so the default window is a coin flip on what is not
    // being tested here. What is being tested is that the result is reported.
    expect(await screen.findByText(/3 sets ready/i, {}, { timeout: 3000 })).toBeTruthy()
    // A parent must not set a draft as work believing somebody checked it.
    expect(screen.getByText(/drafts until you do/i)).toBeTruthy()
  })

  it('shows a failure in words rather than leaving a spinner', async () => {
    contentApi.jobStatus.mockResolvedValue({
      job: job({
        status: 'failed',
        stage: 'Could not finish',
        error: 'We could not read that document.',
      }),
    })
    await quoteThenRun()
    expect(
      await screen.findByText(/could not read that document/i, {}, { timeout: 3000 }),
    ).toBeTruthy()
  })

  it('keeps the quote on screen when starting fails', async () => {
    contentApi.startBuild.mockRejectedValue(new Error('Out of credits'))
    await quoteThenRun()
    expect(await screen.findByText(/Out of credits/)).toBeTruthy()
    expect(screen.getByText(/Make the cards/i)).toBeTruthy()
  })
})

describe('handing over files', () => {
  const pdf = (name: string) => new File(['%PDF-1.4'], name, { type: 'application/pdf' })

  /** What the API returns for one file: its own source, quoted on its own. */
  const quote = (pages: number, allowed = true, total = 30) => ({
    estimate: { pages, credits: pages, noRush: false },
    balance: { included: total, purchased: 0, total },
    allowed,
    reason: allowed ? null : `This needs ${pages} credits and there are ${total} left.`,
  })

  async function choose(...names: string[]) {
    render(<ContentScreen navigate={navigate} />)
    const input = await screen.findByLabelText(/Choose files/i)
    fireEvent.change(input, { target: { files: names.map(pdf) } })
    fireEvent.click(screen.getByText(/See what it would cost/i))
  }

  it('quotes every file, and says what the whole lot comes to', async () => {
    contentApi.uploadFiles.mockResolvedValue({
      sources: [
        { sourceId: 's1', filename: 'ch1.pdf', pages: 4 },
        { sourceId: 's2', filename: 'ch2.pdf', pages: 6 },
      ],
      rejected: [],
    })
    contentApi.estimateFor.mockImplementation(async (id: string) => quote(id === 's1' ? 4 : 6))

    await choose('ch1.pdf', 'ch2.pdf')

    expect(await screen.findByText(/2 documents, 10 pages, about 10 credits/i)).toBeTruthy()
    expect(screen.getByText(/ch1\.pdf — 4 pages, 4 credits/i)).toBeTruthy()
    expect(screen.getByText(/ch2\.pdf — 6 pages, 6 credits/i)).toBeTruthy()
    expect(contentApi.startBuild).not.toHaveBeenCalled()
  })

  it('will not start a set of files that are only affordable one at a time', async () => {
    // The property this whole block exists for. Each estimate is answered
    // against the *full* balance, so three documents can each come back
    // "allowed" and still be unaffordable together. Nothing but the screen is
    // in a position to notice.
    contentApi.uploadFiles.mockResolvedValue({
      sources: [
        { sourceId: 's1', filename: 'a.pdf', pages: 20 },
        { sourceId: 's2', filename: 'b.pdf', pages: 20 },
      ],
      rejected: [],
    })
    contentApi.estimateFor.mockResolvedValue(quote(20, true, 30))

    await choose('a.pdf', 'b.pdf')

    expect(await screen.findByText(/Together these need 40 credits and there are 30 left/i))
      .toBeTruthy()
    expect(screen.queryByText(/Make the cards/i)).toBeNull()
  })

  it('names the files it would not take, and quotes the ones it would', async () => {
    contentApi.uploadFiles.mockResolvedValue({
      sources: [{ sourceId: 's1', filename: 'ch1.pdf', pages: 4 }],
      rejected: [{ filename: 'notes.docx', reason: 'Word files cannot be read directly.' }],
    })
    contentApi.estimateFor.mockResolvedValue(quote(4))

    await choose('ch1.pdf', 'notes.docx')

    expect(await screen.findByText(/notes\.docx — Word files cannot be read/i)).toBeTruthy()
    expect(screen.getByText(/4 pages, about 4 credits/i)).toBeTruthy()
  })

  it('starts a run for each document rather than one for the batch', async () => {
    contentApi.uploadFiles.mockResolvedValue({
      sources: [
        { sourceId: 's1', filename: 'ch1.pdf', pages: 4 },
        { sourceId: 's2', filename: 'ch2.pdf', pages: 6 },
      ],
      rejected: [],
    })
    contentApi.estimateFor.mockImplementation(async (id: string) => quote(id === 's1' ? 4 : 6))

    await choose('ch1.pdf', 'ch2.pdf')
    fireEvent.click(await screen.findByText(/Make the cards/i))

    await waitFor(() => expect(contentApi.startBuild).toHaveBeenCalledTimes(2))
    expect(contentApi.startBuild.mock.calls.map((c: unknown[]) => c[0]).sort()).toEqual(['s1', 's2'])
  })

  it('says nothing was taken when every file was refused', async () => {
    contentApi.uploadFiles.mockResolvedValue({
      sources: [],
      rejected: [{ filename: 'a.zip', reason: 'That kind of file cannot be read.' }],
    })

    await choose('a.zip')

    expect(await screen.findByText(/a\.zip — That kind of file cannot be read/i)).toBeTruthy()
    expect(contentApi.estimateFor).not.toHaveBeenCalled()
    // Still offering the picker, rather than a dead end.
    expect(screen.getByLabelText(/Choose files/i)).toBeTruthy()
  })
})
