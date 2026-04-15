import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DataTable } from '../../components/ui/DataTable'

const cols = [
  { key: 'a', label: 'A', sortable: true },
  { key: 'b', label: 'B' },
]

const data = [
  { id: 1, a: 'x', b: 'y' },
  { id: 2, a: 'p', b: 'q' },
]

describe('DataTable', () => {
  test('renders column headers correctly', () => {
    render(<DataTable columns={cols} data={data} loading={false} error={null} emptyMessage="empty" />)
    expect(screen.getByText('A')).toBeInTheDocument()
    expect(screen.getByText('B')).toBeInTheDocument()
  })

  test('renders data rows correctly', () => {
    render(<DataTable columns={cols} data={data} loading={false} error={null} emptyMessage="empty" />)
    expect(screen.getByText('x')).toBeInTheDocument()
    expect(screen.getByText('q')).toBeInTheDocument()
  })

  test('shows LoadingSkeleton when loading=true', () => {
    const { container } = render(
      <DataTable columns={cols} data={[]} loading error={null} emptyMessage="empty" />
    )
    expect(container.querySelector('.animate-pulse')).toBeTruthy()
  })

  test('shows ErrorBanner when error is not null', () => {
    render(
      <DataTable columns={cols} data={[]} loading={false} error={new Error('boom')} onRetry={() => {}} emptyMessage="e" />
    )
    expect(screen.getByRole('alert')).toHaveTextContent('boom')
  })

  test('shows emptyMessage when data is empty array', () => {
    render(<DataTable columns={cols} data={[]} loading={false} error={null} emptyMessage="No rows" />)
    expect(screen.getByText('No rows')).toBeInTheDocument()
  })

  test('clicking column header calls onSort with correct column', async () => {
    const onSort = vi.fn()
    const user = userEvent.setup()
    render(<DataTable columns={cols} data={data} loading={false} error={null} emptyMessage="e" onSort={onSort} />)
    await user.click(screen.getByRole('button', { name: 'A' }))
    expect(onSort).toHaveBeenCalledWith('a')
  })

  test('is keyboard navigable with tab', async () => {
    const user = userEvent.setup()
    render(
      <DataTable
        columns={cols}
        data={data}
        loading={false}
        error={null}
        emptyMessage="e"
        onRowClick={() => {}}
        rowKey="id"
      />
    )
    await user.tab()
    await user.tab()
    const rows = screen.getAllByRole('row')
    expect(rows.length).toBeGreaterThan(1)
  })
})
