/**
 * The app's ground.
 *
 * Was a purple sky with floating paw prints, which was the cat era's backdrop
 * and would have fought nine of the ten themes. Whizzo's ground is flat warm
 * paper — the accent belongs on the play surfaces sitting on top of it, not
 * behind everything at once.
 *
 * `data-print-hide` because it is a fixed layer: on paper a fixed element is
 * painted onto every page, and this one is a full-bleed block of colour.
 */
export default function Background() {
  return <div data-print-hide className="pointer-events-none fixed inset-0 -z-10 bg-paper" />
}
