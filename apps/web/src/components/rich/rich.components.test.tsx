// Rendering the rich half of a card.
//
// The one thing worth asserting hard on here is that math comes out as real
// MathML elements. If React ever stopped putting them in the MathML namespace
// the equations would silently degrade into a run-on line of characters —
// which still *reads* almost right, and so would never be noticed by eye.

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FIGURE_TEMPLATES } from '../../lib/rich/templates'
import FigureView from './FigureView'
import RichField from './RichField'
import RichText from './RichText'

describe('RichText', () => {
  it('renders math as MathML in the MathML namespace', () => {
    const { container } = render(<RichText source="Simplify $\frac{6}{8}$" />)
    const math = container.querySelector('math')
    expect(math).not.toBeNull()
    expect(math!.namespaceURI).toBe('http://www.w3.org/1998/Math/MathML')
    expect(container.querySelector('mfrac')).not.toBeNull()
    expect(container.textContent).toContain('Simplify')
  })

  it('renders MathML pasted in from somewhere else', () => {
    const { container } = render(<RichText source="<math><msup><mi>x</mi><mn>2</mn></msup></math>" />)
    expect(container.querySelector('msup')).not.toBeNull()
  })

  it('leaves plain text as plain text', () => {
    const { container } = render(<RichText source="the powerhouse of the cell" />)
    expect(container.querySelector('math')).toBeNull()
    expect(container.textContent).toBe('the powerhouse of the cell')
  })

  it('draws a figure, and describes it where there is no room to draw', () => {
    const source = '[[figure {"kind":"bar","data":[{"label":"Mon","value":4}]}]]'
    const drawn = render(<RichText source={source} />)
    expect(drawn.container.querySelector('svg')).not.toBeNull()
    drawn.unmount()

    const described = render(<RichText source={source} figures="describe" />)
    expect(described.container.querySelector('svg')).toBeNull()
    expect(described.container.textContent).toContain('Mon: 4')
  })

  it('shows a broken figure as a warning rather than swallowing the card', () => {
    render(<RichText source={'Look: [[figure {"kind":"bar"}]]'} />)
    expect(screen.getByText(/data/)).toBeTruthy()
  })
})

describe('FigureView', () => {
  it('draws every template the editor can insert', () => {
    for (const template of FIGURE_TEMPLATES) {
      const { container, unmount } = render(<FigureView spec={template.spec} />)
      const svg = container.querySelector('svg')
      expect(svg, template.kind).not.toBeNull()
      // Nothing may be drawn at a coordinate that is not a number: one NaN in a
      // path silently drops the whole shape.
      expect(container.innerHTML.includes('NaN'), template.kind).toBe(false)
      unmount()
    }
  })

  it('writes the values on the chart, so they can be read off it', () => {
    render(
      <FigureView
        spec={{
          kind: 'bar',
          data: [
            { label: 'Mon', value: 4 },
            { label: 'Tue', value: 7 },
          ],
        }}
      />,
    )
    expect(screen.getAllByText('7').length).toBeGreaterThan(0)
    expect(screen.getByText('Tue')).toBeTruthy()
  })

  it('draws a bar chart lying down when the categories have long names', () => {
    render(
      <FigureView
        spec={{
          kind: 'bar',
          horizontal: true,
          data: [
            { label: 'Chocolate chip', value: 12 },
            { label: 'Oatmeal raisin', value: 5 },
          ],
        }}
      />,
    )
    expect(screen.getByText('12')).toBeTruthy()
    expect(screen.getByText(/Chocolate/)).toBeTruthy()
  })

  it('covers the whole axis when the step asked for is finer than the range', () => {
    // Not a cosmetic point: a grid that stops two thirds of the way across is
    // a grid a learner reads the wrong coordinates off.
    const { container } = render(
      <FigureView spec={{ kind: 'plot', xRange: [-50, 50], yRange: [-50, 50], step: 1 }} />,
    )
    const labels = [...container.querySelectorAll('text')]
      .map((t) => Number(t.textContent))
      .filter((n) => Number.isFinite(n))
    expect(Math.min(...labels)).toBe(-50)
    expect(Math.max(...labels)).toBe(50)
  })

  it('marks the whole of a long number line', () => {
    const { container } = render(
      <FigureView spec={{ kind: 'numberline', min: 0, max: 1000, step: 1 }} />,
    )
    const labels = [...container.querySelectorAll('text')]
      .map((t) => Number(t.textContent))
      .filter((n) => Number.isFinite(n))
    expect(Math.max(...labels)).toBe(1000)
    expect(labels.length).toBeLessThan(45)
  })

  it('carries a description for a screen reader', () => {
    const { container } = render(
      <FigureView spec={{ kind: 'angle', degrees: 55, vertexLabel: 'B' }} />,
    )
    expect(container.querySelector('[role="img"]')!.getAttribute('aria-label')).toContain('55')
  })
})

describe('RichField', () => {
  it('inserts a figure you can edit, and previews it', () => {
    const onChange = vi.fn()
    const { rerender } = render(<RichField value="" onChange={onChange} ariaLabel="Term" />)

    fireEvent.click(screen.getByLabelText('Add a picture: a shape, a graph or a chart'))
    fireEvent.click(screen.getByLabelText('Bar chart'))

    const inserted = onChange.mock.calls[0][0] as string
    expect(inserted).toContain('[[figure')

    rerender(<RichField value={inserted} onChange={onChange} ariaLabel="Term" />)
    expect(screen.getByText('How it will look')).toBeTruthy()
    expect(document.querySelector('svg')).not.toBeNull()
  })

  it('inserts a math snippet at the cursor', () => {
    const onChange = vi.fn()
    render(<RichField value="" onChange={onChange} ariaLabel="Term" />)
    fireEvent.click(screen.getByLabelText('Fraction'))
    expect(onChange).toHaveBeenCalledWith('$\\frac{}{}$')
  })

  it('adds a figure at the end of a card it was never clicked into', () => {
    // A textarea nobody has focused reports a caret at 0, so the naive reading
    // of selectionStart puts the drawing in front of the question.
    const onChange = vi.fn()
    render(
      <RichField value="Find the area of this shape." onChange={onChange} ariaLabel="Term" />,
    )
    fireEvent.click(screen.getByLabelText('Add a picture: a shape, a graph or a chart'))
    fireEvent.click(screen.getByLabelText('Triangle'))
    expect(onChange.mock.calls[0][0] as string).toMatch(/^Find the area of this shape\.\n\[\[figure/)
  })

  it('inserts at the cursor once the author has been in the box', () => {
    const onChange = vi.fn()
    render(<RichField value="ab" onChange={onChange} ariaLabel="Term" />)
    const field = document.querySelector('textarea')!
    fireEvent.focus(field)
    field.setSelectionRange(1, 1)
    fireEvent.click(screen.getByLabelText('Fraction'))
    expect(onChange).toHaveBeenCalledWith('a$\\frac{}{}$b')
  })

  it('stays out of the way until there is something to preview', () => {
    render(<RichField value="photosynthesis" onChange={() => {}} ariaLabel="Term" />)
    expect(screen.queryByText('How it will look')).toBeNull()
  })
})
