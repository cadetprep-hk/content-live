import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { LiveContent } from '../schema/live.ts'
import { checkUrls, collectUrls } from '../scripts/urls.ts'

const live = LiveContent.parse(JSON.parse(readFileSync(new URL('./fixtures/valid.json', import.meta.url), 'utf8')))

const reply = (status: number) => new Response(null, { status })

describe('collectUrls', () => {
  it('collects every source_url and the cadet programme url, de-duplicated', () => {
    const urls = collectUrls(live)
    expect([...urls.keys()].sort()).toEqual(['https://example.com/cadet', 'https://example.com/src'])
    expect(urls.get('https://example.com/cadet')).toEqual(['airlines.cathay.profile.cadet_programme.url'])
    expect(urls.get('https://example.com/src')).toContain('digest.d1')
    expect(urls.get('https://example.com/src')).toContain('airlines.cathay.changes.almaty')
  })
})

describe('checkUrls (mocked fetch)', () => {
  const urls = new Map([
    ['https://ok.test/a', ['x']],
    ['https://nohead.test/b', ['y']],
    ['https://gone.test/c', ['z']],
    ['https://down.test/d', ['w']],
  ])

  it('passes 200 on HEAD, falls back to GET, and reports every failure', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url)
      if (u.startsWith('https://ok.test')) return reply(200)
      if (u.startsWith('https://nohead.test')) return reply(init?.method === 'HEAD' ? 405 : 200)
      if (u.startsWith('https://gone.test')) return reply(404)
      throw new TypeError('fetch failed')
    })
    const failures = await checkUrls(urls, { fetch: fetchMock as typeof fetch })
    expect(failures).toEqual([
      { url: 'https://down.test/d', usedAt: ['w'], reason: 'HEAD: fetch failed; GET: fetch failed' },
      { url: 'https://gone.test/c', usedAt: ['z'], reason: 'HEAD: HTTP 404; GET: HTTP 404' },
    ])
    // HEAD only for the OK URL; HEAD then GET for the others.
    expect(fetchMock).toHaveBeenCalledTimes(7)
    for (const [, init] of fetchMock.mock.calls) expect(init?.redirect).toBe('follow')
  })

  it('never runs more than the concurrency limit at once', async () => {
    let active = 0
    let peak = 0
    const many = new Map(Array.from({ length: 12 }, (_, i) => [`https://ok.test/${i}`, ['x']]))
    const fetchMock = vi.fn(async () => {
      active++
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 5))
      active--
      return reply(200)
    })
    expect(await checkUrls(many, { fetch: fetchMock as unknown as typeof fetch, concurrency: 4 })).toEqual([])
    expect(peak).toBe(4)
  })

  it('reports a timeout', async () => {
    const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))
      }),
    )
    const failures = await checkUrls(new Map([['https://slow.test/', ['x']]]), {
      fetch: fetchMock as typeof fetch,
      timeoutMs: 20,
    })
    expect(failures[0]?.reason).toBe('HEAD: timed out after 0.02 s; GET: timed out after 0.02 s')
  })
})
