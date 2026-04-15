import { describe, test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const hero = readFileSync(join(__dirname, '..', 'components', 'Hero.astro'), 'utf8')
const feat = readFileSync(join(__dirname, '..', 'components', 'Features.astro'), 'utf8')
const how = readFileSync(join(__dirname, '..', 'components', 'HowItWorks.astro'), 'utf8')

describe('Landing page', () => {
  test('Hero section renders headline text', () => {
    expect(hero).toContain('Write better. Reply faster. Sound like a native.')
  })

  test('primary CTA button links to Chrome Web Store', () => {
    expect(hero).toContain('chrome.google.com/webstore')
  })

  test('secondary CTA scrolls to HowItWorks section', () => {
    expect(hero).toContain('href="#how-it-works"')
  })

  test('Features section renders 6 feature cards', () => {
    ;[
      'Rewrite in any tone',
      'Summarize selected text',
      'Fix grammar instantly',
      'Reply to messages',
      'Works everywhere',
      'Voice to text rewrite',
    ].forEach((t) => expect(feat).toContain(t))
  })

  test('HowItWorks section renders 3 steps', () => {
    expect(how).toContain('Select any text')
    expect(how).toContain('Choose an action')
    expect(how).toContain('Get better text instantly')
  })
})
