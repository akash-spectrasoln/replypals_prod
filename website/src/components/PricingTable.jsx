import { useState } from 'react'

const CHROME_URL = 'https://chrome.google.com/webstore/detail/replypals/jipgphhkpgkjjfpjbjjnbdikjkgmnnkp'
const SIGNUP_URL = 'https://www.replypals.in/signup'
/** Regional PPP checkout lives in the app (same as extension) — avoids static USD Payment Links. */
const DASHBOARD_UPGRADE_URL = 'https://www.replypals.in/dashboard'

export default function PricingTable() {
  const [annual, setAnnual] = useState(false)

  const proHref = DASHBOARD_UPGRADE_URL
  const teamHref = DASHBOARD_UPGRADE_URL

  return (
    <section className="border-b border-slate-200 py-16 md:py-20">
      <div className="mx-auto max-w-6xl px-4">
        <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
          <h2 className="text-3xl font-bold text-slate-900">Pricing</h2>
          <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white p-1 text-sm">
            <button
              type="button"
              className={`rounded-full px-4 py-2 ${!annual ? 'bg-indigo-600 text-white' : 'text-slate-700'}`}
              onClick={() => setAnnual(false)}
            >
              Monthly
            </button>
            <button
              type="button"
              className={`rounded-full px-4 py-2 ${annual ? 'bg-indigo-600 text-white' : 'text-slate-700'}`}
              onClick={() => setAnnual(true)}
            >
              Annual
            </button>
          </div>
        </div>

        <div className="mt-12 grid gap-8 md:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="font-semibold text-slate-900">Anonymous</h3>
            <p className="mt-2 text-2xl font-bold">Free</p>
            <p className="mt-2 text-sm text-slate-600">3 lifetime tries</p>
            <ul className="mt-4 flex-1 space-y-2 text-sm text-slate-600">
              <li>Basic rewrite</li>
              <li>Try before signup</li>
            </ul>
            <a
              href={CHROME_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-6 block rounded-lg border border-slate-300 py-2 text-center font-medium hover:bg-slate-50"
            >
              Try Now
            </a>
          </div>

          <div className="flex flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="font-semibold text-slate-900">Free</h3>
            <p className="mt-2 text-2xl font-bold">Free</p>
            <p className="mt-2 text-sm text-slate-600">10 rewrites/month</p>
            <ul className="mt-4 flex-1 space-y-2 text-sm text-slate-600">
              <li>All rewrite modes</li>
              <li>Grammar fix</li>
              <li>Summarize</li>
            </ul>
            <a
              href={SIGNUP_URL}
              className="mt-6 block rounded-lg border border-slate-300 py-2 text-center font-medium hover:bg-slate-50"
            >
              Sign Up Free
            </a>
          </div>

          <div className="relative flex flex-col rounded-2xl border-2 border-indigo-600 bg-white p-6 shadow-md">
            <span className="absolute -top-3 right-4 rounded-full bg-indigo-600 px-2 py-0.5 text-xs text-white">
              Popular
            </span>
            <h3 className="font-semibold text-slate-900">Pro</h3>
            <p className="mt-2 text-2xl font-bold">{annual ? '$7/mo' : '$9/mo'}</p>
            <p className="text-sm text-slate-500">{annual ? 'billed annually' : 'billed monthly'}</p>
            <p className="mt-2 text-sm text-slate-600">Unlimited rewrites</p>
            <ul className="mt-4 flex-1 space-y-2 text-sm text-slate-600">
              <li>Everything in Free</li>
              <li>Voice input</li>
              <li>Tone memory</li>
              <li>Priority support</li>
              <li>Brand voice</li>
            </ul>
            <a
              href={proHref}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-6 block rounded-lg bg-indigo-600 py-2 text-center font-medium text-white hover:bg-indigo-700"
            >
              Get Pro
            </a>
          </div>

          <div className="flex flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="font-semibold text-slate-900">Team</h3>
            <p className="mt-2 text-2xl font-bold">{annual ? '$24/mo' : '$29/mo'}</p>
            <p className="text-sm text-slate-500">{annual ? 'billed annually' : 'billed monthly'}</p>
            <p className="mt-2 text-sm text-slate-600">Unlimited for 5 seats</p>
            <ul className="mt-4 flex-1 space-y-2 text-sm text-slate-600">
              <li>Everything in Pro</li>
              <li>Team management</li>
              <li>Admin dashboard</li>
            </ul>
            <a
              href={teamHref}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-6 block rounded-lg border border-indigo-600 py-2 text-center font-medium text-indigo-700 hover:bg-indigo-50"
            >
              Get Team
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
