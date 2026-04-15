import { describe, test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pages = join(__dirname, '..', 'pages')
const layouts = join(__dirname, '..', 'layouts')

function readPages(name) {
  return readFileSync(join(pages, name), 'utf8')
}

const baseLayout = readFileSync(join(layouts, 'BaseLayout.astro'), 'utf8')

describe('SEO meta', () => {
  test('index.astro has unique title tag', () => {
    const html = readPages('index.astro')
    expect(html).toContain("const title = 'ReplyPals")
  })

  test('index.astro has meta description', () => {
    expect(readPages('index.astro')).toMatch(/const description =/)
  })

  test('index.astro has og:title tag', () => {
    expect(baseLayout).toMatch(/property="og:title"/)
  })

  test('index.astro has og:description tag', () => {
    expect(baseLayout).toMatch(/property="og:description"/)
  })

  test('index.astro has og:image tag', () => {
    expect(baseLayout).toMatch(/property="og:image"/)
  })

  test('index.astro has canonical URL', () => {
    expect(readPages('index.astro')).toMatch(/canonicalUrl = 'https:\/\/replypals\.in\/'/)
  })

  test('pricing.astro has unique title tag different from index', () => {
    const idx = readPages('index.astro')
    const pr = readPages('pricing.astro')
    const t1 = idx.match(/const title = '([^']+)'/)?.[1]
    const t2 = pr.match(/const title = '([^']+)'/)?.[1]
    expect(t1).toBeTruthy()
    expect(t2).toBeTruthy()
    expect(t1).not.toBe(t2)
  })

  test('privacy.astro has unique title tag', () => {
    expect(readPages('privacy.astro')).toMatch(/Privacy Policy/)
  })

  test('terms.astro has unique title tag', () => {
    expect(readPages('terms.astro')).toMatch(/Terms of Service/)
  })
})
