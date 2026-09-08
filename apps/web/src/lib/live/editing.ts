// "Do not overwrite what somebody is typing."
//
// Card titles, the week's reflection and its priorities are last-write-wins at
// the database, which is the honest model for them. What is not acceptable is
// losing a half-typed sentence to somebody else's save arriving mid-word — so a
// remote change to a field that currently has focus is *deferred*, not dropped,
// and lands the moment focus leaves.
//
// The anchor is a `data-live-key` attribute on whatever wraps the editable
// region, holding the id of the thing being edited.

/** The id of the record being edited right now, if any. */
export function editingKey(): string | null {
  if (typeof document === 'undefined') return null
  const el = document.activeElement as HTMLElement | null
  if (!el) return null
  const tag = el.tagName
  if (tag !== 'INPUT' && tag !== 'TEXTAREA' && !el.isContentEditable) return null
  return el.closest('[data-live-key]')?.getAttribute('data-live-key') ?? null
}

/**
 * Hold changes for records being edited and run them when focus leaves.
 *
 * Only the newest change per record is kept: an intermediate state nobody saw
 * is not worth replaying.
 */
export class DeferredEdits {
  private readonly waiting = new Map<string, () => void>()
  private listening = false

  /**
   * Run `apply` now, or hold it until `key` stops being edited.
   * Returns true when it ran immediately.
   */
  applyOrDefer(key: string, apply: () => void): boolean {
    if (editingKey() !== key) {
      apply()
      return true
    }
    this.waiting.set(key, apply)
    this.listen()
    return false
  }

  /**
   * Forget any held change for `key`.
   *
   * The case this exists for: a card is edited and then deleted. The edit is
   * waiting on a focused field, the delete applies at once, and without this
   * the edit would run on blur and put the deleted card back on the grid.
   */
  cancel(key: string): void {
    this.waiting.delete(key)
  }

  private listen(): void {
    if (this.listening || typeof document === 'undefined') return
    this.listening = true
    document.addEventListener('focusout', this.flush, true)
  }

  /** Public so a caller can also flush on unmount or a week change. */
  readonly flush = (): void => {
    if (!this.waiting.size) return
    // Focus moves in two steps — out of the old element, then into the new one
    // — and during the gap `activeElement` is the body, which would look like
    // "nobody is editing" and flush a field the user is still in. A turn of the
    // event loop lets focus settle first.
    setTimeout(() => {
      const busy = editingKey()
      for (const [key, apply] of [...this.waiting]) {
        if (key === busy) continue
        this.waiting.delete(key)
        apply()
      }
    }, 0)
  }

  dispose(): void {
    this.waiting.clear()
    if (this.listening && typeof document !== 'undefined') {
      document.removeEventListener('focusout', this.flush, true)
      this.listening = false
    }
  }
}
