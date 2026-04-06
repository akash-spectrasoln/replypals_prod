import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ErrorBanner } from '../../components/ui/ErrorBanner'

describe('ErrorBanner', () => {
  test('renders error message', () => {
    render(<ErrorBanner message="Bad" />)
    expect(screen.getByText('Bad')).toBeInTheDocument()
  })

  test('renders Try Again button', () => {
    render(<ErrorBanner message="e" onRetry={() => {}} />)
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument()
  })

  test('clicking Try Again calls onRetry', async () => {
    const onRetry = vi.fn()
    const user = userEvent.setup()
    render(<ErrorBanner message="e" onRetry={onRetry} />)
    await user.click(screen.getByRole('button', { name: 'Try Again' }))
    expect(onRetry).toHaveBeenCalled()
  })
})
