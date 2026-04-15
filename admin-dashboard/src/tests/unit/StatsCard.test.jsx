import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatsCard } from '../../components/ui/StatsCard'

describe('StatsCard', () => {
  test('renders title and value correctly', () => {
    render(<StatsCard title="Users" value="42" loading={false} />)
    expect(screen.getByText('Users')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
  })

  test('shows LoadingSkeleton when loading=true', () => {
    const { container } = render(<StatsCard title="X" value="" loading />)
    expect(container.querySelector('.animate-pulse')).toBeTruthy()
  })

  test('shows positive delta in green', () => {
    render(<StatsCard title="T" value="1" delta={5} deltaLabel="vs last week" loading={false} />)
    const el = screen.getByText(/vs last week/).closest('p')
    expect(el).toHaveClass('text-emerald-600')
  })

  test('shows negative delta in red', () => {
    render(<StatsCard title="T" value="1" delta={-3} deltaLabel="day" loading={false} />)
    const el = screen.getByText(/day/).closest('p')
    expect(el).toHaveClass('text-red-600')
  })

  test('has correct aria-label for accessibility', () => {
    render(<StatsCard title="Rewrites" value="9" loading={false} />)
    expect(screen.getByRole('region', { name: 'Rewrites' })).toBeInTheDocument()
  })
})
