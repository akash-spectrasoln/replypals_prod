import { useEffect } from 'react'

export function Toast({ message, onClose, duration = 4000 }) {
  useEffect(() => {
    if (!message) return undefined
    const t = setTimeout(() => onClose?.(), duration)
    return () => clearTimeout(t)
  }, [message, duration, onClose])

  if (!message) return null
  return (
    <div
      role="status"
      className="fixed bottom-6 right-6 z-50 rounded-lg bg-slate-900 px-4 py-3 text-sm text-white shadow-lg"
    >
      {message}
    </div>
  )
}
