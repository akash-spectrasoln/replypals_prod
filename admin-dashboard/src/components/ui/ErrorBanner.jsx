import { Button } from './Button'

export function ErrorBanner({ message, onRetry }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-900"
    >
      <span className="text-lg" aria-hidden>
        ⚠
      </span>
      <p className="flex-1 text-sm">{message}</p>
      {onRetry ? (
        <Button variant="secondary" type="button" onClick={onRetry}>
          Try Again
        </Button>
      ) : null}
    </div>
  )
}
