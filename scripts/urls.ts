import type { LiveContent } from '../schema/live.ts'

export interface UrlFailure {
  url: string
  /** Where the URL is used in live.json (first few places). */
  usedAt: string[]
  reason: string
}

export interface CheckUrlsOptions {
  fetch?: typeof fetch
  timeoutMs?: number
  concurrency?: number
}

const USER_AGENT = 'content-live-validator/1 (+https://github.com/cadetprep-hk/content-live)'

/** Every source_url and cadet_programme.url in the file, with where each one is used. */
export function collectUrls(live: LiveContent): Map<string, string[]> {
  const urls = new Map<string, string[]>()
  const add = (url: string, at: string) => {
    const list = urls.get(url) ?? []
    list.push(at)
    urls.set(url, list)
  }
  for (const [aid, a] of Object.entries(live.airlines)) {
    if (!a) continue
    const p = a.profile
    add(p.group.source_url, `airlines.${aid}.profile.group`)
    p.hubs.forEach((h) => add(h.source_url, `airlines.${aid}.profile.hubs.${h.iata}`))
    add(p.founded.source_url, `airlines.${aid}.profile.founded`)
    if (p.cadet_programme) {
      add(p.cadet_programme.source_url, `airlines.${aid}.profile.cadet_programme`)
      add(p.cadet_programme.url, `airlines.${aid}.profile.cadet_programme.url`)
    }
    p.milestones.forEach((m) => add(m.source_url, `airlines.${aid}.profile.milestones.${m.id}`))
    a.fleet.forEach((f) => add(f.source_url, `airlines.${aid}.fleet.${f.id}`))
    a.destinations.forEach((d) => add(d.source_url, `airlines.${aid}.destinations.${d.id}`))
    a.changes.forEach((c) => add(c.source_url, `airlines.${aid}.changes.${c.id}`))
  }
  live.digest.forEach((d) => add(d.source_url, `digest.${d.id}`))
  return urls
}

async function request(
  doFetch: typeof fetch,
  url: string,
  method: 'HEAD' | 'GET',
  timeoutMs: number,
): Promise<{ status: number } | { error: string }> {
  try {
    const res = await doFetch(url, {
      method,
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml,application/pdf,*/*' },
    })
    // Don't download GET bodies; the status line is all we need.
    await res.body?.cancel().catch(() => {})
    return { status: res.status }
  } catch (e) {
    const err = e as Error
    return { error: err.name === 'TimeoutError' ? `timed out after ${timeoutMs / 1000} s` : err.message }
  }
}

/**
 * HEAD each URL (following redirects); when HEAD does not answer 200 — some servers refuse
 * or mishandle HEAD — try GET. A URL passes only on HTTP 200. Returns every failure.
 */
export async function checkUrls(urls: Map<string, string[]>, opts: CheckUrlsOptions = {}): Promise<UrlFailure[]> {
  const doFetch = opts.fetch ?? fetch
  const timeoutMs = opts.timeoutMs ?? 15_000
  const concurrency = opts.concurrency ?? 4
  const queue = [...urls.keys()]
  const failures: UrlFailure[] = []

  async function worker() {
    for (let url = queue.shift(); url !== undefined; url = queue.shift()) {
      const head = await request(doFetch, url, 'HEAD', timeoutMs)
      if ('status' in head && head.status === 200) continue
      const get = await request(doFetch, url, 'GET', timeoutMs)
      if ('status' in get && get.status === 200) continue
      const describe = (r: typeof head) => ('status' in r ? `HTTP ${r.status}` : r.error)
      failures.push({
        url,
        usedAt: urls.get(url) ?? [],
        reason: `HEAD: ${describe(head)}; GET: ${describe(get)}`,
      })
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker))
  return failures.sort((a, b) => a.url.localeCompare(b.url))
}
