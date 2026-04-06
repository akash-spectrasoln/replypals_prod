import { useState } from 'react'

const ITEMS = [
  {
    q: 'Is ReplyPals free?',
    a: 'Yes — anonymous users get a small number of lifetime tries, and signed-in free accounts get monthly rewrites at no cost.',
  },
  {
    q: 'Does ReplyPals store what I write?',
    a: 'We process text to generate suggestions and do not keep your message content for training. See our Privacy Policy for details.',
  },
  {
    q: 'Where does it work?',
    a: 'It runs in Chrome on supported sites: Gmail, LinkedIn, X (Twitter), WhatsApp Web, and many other text fields.',
  },
]

export default function FAQ() {
  const [open, setOpen] = useState(0)

  return (
    <section className="border-b border-slate-200 bg-white py-16 md:py-20">
      <div className="mx-auto max-w-3xl px-4">
        <h2 className="text-center text-3xl font-bold text-slate-900">FAQ</h2>
        <div className="mt-8 space-y-2">
          {ITEMS.map((item, i) => (
            <div key={item.q} className="rounded-xl border border-slate-200 bg-slate-50">
              <button
                type="button"
                className="flex w-full items-center justify-between px-4 py-3 text-left font-medium text-slate-900"
                onClick={() => setOpen(open === i ? -1 : i)}
                aria-expanded={open === i}
              >
                {item.q}
                <span aria-hidden>{open === i ? '−' : '+'}</span>
              </button>
              {open === i ? <p className="border-t border-slate-200 px-4 py-3 text-sm text-slate-600">{item.a}</p> : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
