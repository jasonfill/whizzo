// Dragging a card, with the pointer or a finger, without a library.
//
// Native HTML drag-and-drop does not fire on touch, and the libraries that
// paper over that bring a dependency and their own opinions about the DOM.
// What the planner needs is small: press, move, find what is under the
// pointer, drop. Pointer events give all of that on every input.
//
// Two gestures, one rule set:
//   * mouse or pen: press and move past a small threshold lifts the card, so
//     a click stays a click;
//   * touch: press and hold lifts it, so a scroll stays a scroll.
//
// Drop targets are elements carrying `data-drop`, which names a day (or
// "shelf"); an optional `data-drop-index` on a card inside one says where in
// the day the pointer is. The hook never moves DOM; it reports the drop and
// the screen decides.

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

export interface DragState {
  itemId: string
  x: number
  y: number
  /** Offset of the pointer inside the card, so the ghost stays under the finger. */
  dx: number
  dy: number
  width: number
  /** Where it would land: the day, and the card it would sit before (null: the end). */
  over: { day: string | null; beforeId: string | null } | null
  copy: boolean
}

export interface DropTarget {
  day: string | null
  beforeId: string | null
  copy: boolean
}

const MOVE_THRESHOLD = 6
const HOLD_MS = 220

export function useCardDrag(onDrop: (itemId: string, target: DropTarget) => void) {
  const [drag, setDrag] = useState<DragState | null>(null)
  // Read at drop time, so the listeners below are registered once rather
  // than on every render of the screen that owns them.
  const onDropRef = useRef(onDrop)
  onDropRef.current = onDrop
  const pending = useRef<{
    itemId: string
    startX: number
    startY: number
    dx: number
    dy: number
    width: number
    pointerType: string
    timer: number | null
    copy: boolean
  } | null>(null)
  const dragRef = useRef<DragState | null>(null)

  const lift = useCallback((x: number, y: number) => {
    const p = pending.current
    if (!p) return
    if (p.timer) window.clearTimeout(p.timer)
    p.timer = null
    const next: DragState = { itemId: p.itemId, x, y, dx: p.dx, dy: p.dy, width: p.width, over: null, copy: p.copy }
    dragRef.current = next
    setDrag(next)
  }, [])

  const onPointerDown = useCallback(
    (itemId: string) => (e: ReactPointerEvent<HTMLElement>) => {
      // Buttons, inputs and links inside a card are theirs, not the drag's.
      // The title is a button too — it opens the sheet on a plain click — but
      // it is most of the card, so a press on it must be allowed to become a
      // drag. It says so with data-drag-ok.
      const target = e.target as HTMLElement
      const control = target.closest('button, input, a, textarea, select, [data-no-drag]')
      if (control && !control.hasAttribute('data-drag-ok')) return
      if (e.button !== 0 && e.pointerType === 'mouse') return
      const rect = e.currentTarget.getBoundingClientRect()
      const p = {
        itemId,
        startX: e.clientX,
        startY: e.clientY,
        dx: e.clientX - rect.left,
        dy: e.clientY - rect.top,
        width: rect.width,
        pointerType: e.pointerType,
        timer: null as number | null,
        copy: e.altKey || e.metaKey,
      }
      pending.current = p
      if (e.pointerType === 'touch') {
        p.timer = window.setTimeout(() => lift(p.startX, p.startY), HOLD_MS)
      }
    },
    [lift],
  )

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const p = pending.current
      if (!p) return
      const d = dragRef.current
      if (!d) {
        const moved = Math.hypot(e.clientX - p.startX, e.clientY - p.startY)
        if (p.pointerType === 'touch') {
          // Moving before the hold is a scroll. Let it be one.
          if (moved > MOVE_THRESHOLD && p.timer) {
            window.clearTimeout(p.timer)
            pending.current = null
          }
          return
        }
        if (moved > MOVE_THRESHOLD) lift(e.clientX, e.clientY)
        return
      }
      e.preventDefault()
      const over = findTarget(e.clientX, e.clientY, d.itemId)
      const next: DragState = { ...d, x: e.clientX, y: e.clientY, over, copy: e.altKey || e.metaKey || d.copy }
      dragRef.current = next
      setDrag(next)
      autoScroll(e.clientX, e.clientY)
    }
    const onUp = () => {
      const p = pending.current
      const d = dragRef.current
      if (p?.timer) window.clearTimeout(p.timer)
      pending.current = null
      dragRef.current = null
      if (d) {
        setDrag(null)
        if (d.over) onDropRef.current(d.itemId, { day: d.over.day, beforeId: d.over.beforeId, copy: d.copy })
      }
    }
    const onCancel = () => {
      const p = pending.current
      if (p?.timer) window.clearTimeout(p.timer)
      pending.current = null
      dragRef.current = null
      setDrag(null)
    }
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
    }
  }, [lift])

  // A lifted card must not also scroll the page under a finger.
  useEffect(() => {
    if (!drag) return
    const prev = document.body.style.touchAction
    const prevSelect = document.body.style.userSelect
    document.body.style.touchAction = 'none'
    document.body.style.userSelect = 'none'
    return () => {
      document.body.style.touchAction = prev
      document.body.style.userSelect = prevSelect
    }
  }, [drag])

  return { drag, onPointerDown }
}

function findTarget(x: number, y: number, dragging: string): DragState['over'] {
  const el = document.elementFromPoint(x, y) as HTMLElement | null
  if (!el) return null
  const zone = el.closest<HTMLElement>('[data-drop]')
  if (!zone) return null
  const day = zone.dataset.drop === 'shelf' ? null : (zone.dataset.drop ?? null)
  // Position within the day: the first card (other than the one being
  // dragged) whose midpoint the pointer is above. Reported by id rather than
  // position, so the screen and the DOM cannot disagree about counting.
  const cards = Array.from(zone.querySelectorAll<HTMLElement>('[data-card-id]'))
  for (const card of cards) {
    const id = card.dataset.cardId
    if (!id || id === dragging || id.startsWith('assignment:')) continue
    const r = card.getBoundingClientRect()
    if (y < r.top + r.height / 2) return { day, beforeId: id }
  }
  return { day, beforeId: null }
}

/** Drag near an edge of the grid and it scrolls, so next week is one gesture away. */
function autoScroll(x: number, y: number) {
  const grid = document.querySelector<HTMLElement>('[data-planner-grid]')
  if (grid) {
    const r = grid.getBoundingClientRect()
    if (x > r.right - 40) grid.scrollLeft += 12
    else if (x < r.left + 40) grid.scrollLeft -= 12
  }
  const vh = window.innerHeight
  if (y > vh - 40) window.scrollBy(0, 10)
  else if (y < 60) window.scrollBy(0, -10)
}
