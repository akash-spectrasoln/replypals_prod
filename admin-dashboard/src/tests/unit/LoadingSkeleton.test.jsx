import { describe, test, expect } from 'vitest'
import { render } from '@testing-library/react'
import { LoadingSkeleton } from '../../components/ui/LoadingSkeleton'

describe('LoadingSkeleton', () => {
  test('renders correct number of rows from props', () => {
    const { container } = render(<LoadingSkeleton rows={3} cols={2} />)
    const rows = container.querySelectorAll('.animate-pulse > div')
    expect(rows.length).toBe(3)
  })

  test('renders correct number of cols from props', () => {
    const { container } = render(<LoadingSkeleton rows={2} cols={5} />)
    const firstRow = container.querySelector('.animate-pulse > div')
    expect(firstRow?.querySelectorAll('.h-8').length).toBe(5)
  })

  test('defaults to 5 rows and 4 cols', () => {
    const { container } = render(<LoadingSkeleton />)
    const rows = container.querySelectorAll('.animate-pulse > div')
    expect(rows.length).toBe(5)
    const firstRow = container.querySelector('.animate-pulse > div')
    expect(firstRow?.querySelectorAll('.h-8').length).toBe(4)
  })
})
