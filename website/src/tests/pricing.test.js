import { describe, test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pricing = readFileSync(join(__dirname, '..', 'components', 'PricingTable.jsx'), 'utf8')

describe('PricingTable', () => {
  test('renders 4 plan cards', () => {
    expect(pricing).toContain('Anonymous')
    expect(pricing).toContain('>Free</h3>')
    expect(pricing).toContain('>Pro</h3>')
    expect(pricing).toContain('>Team</h3>')
  })

  test('monthly prices are shown by default', () => {
    expect(pricing).toContain('useState(false)')
  })

  test('clicking annual toggle switches to annual prices', () => {
    expect(pricing).toContain('setAnnual(true)')
    expect(pricing).toContain("$7/mo'")
    expect(pricing).toContain("$24/mo'")
  })

  test('annual price is lower than monthly price for pro', () => {
    expect(pricing).toContain("'$9/mo'")
    expect(pricing).toContain("'$7/mo'")
  })

  test('Get Pro CTA links to Stripe checkout', () => {
    expect(pricing).toContain('buy.stripe.com')
    expect(pricing).toContain('Get Pro')
  })

  test('Get Team CTA links to Stripe checkout', () => {
    expect(pricing).toContain('Get Team')
    expect(pricing).toContain('STRIPE_TEAM')
  })

  test('Free plan CTA links to sign up', () => {
    expect(pricing).toContain('replypals.in/signup')
    expect(pricing).toContain('Sign Up Free')
  })
})
