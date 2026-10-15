import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LiveContent, changesOutsideWindow, checkAsOfMonotonic, twelveMonthsBefore } from '../schema/live.ts'

const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/valid.json', import.meta.url), 'utf8'))
const issues = (data: unknown) => {
  const r = LiveContent.safeParse(data)
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
}

describe('LiveContent schema', () => {
  it('accepts the valid fixture', () => {
    expect(issues(fixture())).toEqual([])
  })

  it('accepts the repo live.json', () => {
    const live = JSON.parse(readFileSync(new URL('../live.json', import.meta.url), 'utf8'))
    expect(issues(live)).toEqual([])
  })

  it('rejects unknown keys (strict objects)', () => {
    const f = fixture()
    f.airlines.cathay.fleet[0].extra = 1
    expect(issues(f).join()).toMatch(/Unrecognized key/)
    const g = fixture()
    g.digest[0].headline.ja = 'x'
    expect(issues(g).join()).toMatch(/Unrecognized key/)
  })

  it('requires both languages', () => {
    const f = fixture()
    delete f.airlines.cathay.name['zh-Hant']
    expect(issues(f).join()).toMatch(/airlines\.cathay\.name\.zh-Hant/)
  })

  it('rejects unknown region, status and change kind', () => {
    const f = fixture()
    f.airlines.cathay.destinations[0].region = 'antarctica'
    f.airlines.cathay.destinations[0].status = 'closed'
    f.airlines.cathay.changes[0].kind = 'rumour'
    const out = issues(f).join('\n')
    expect(out).toMatch(/destinations\.0\.region/)
    expect(out).toMatch(/destinations\.0\.status/)
    expect(out).toMatch(/changes\.0\.kind/)
  })

  it('rejects an unknown airline id and a key that does not match the id', () => {
    const f = fixture()
    f.airlines['air-hk'] = f.airlines.cathay
    expect(issues(f).length).toBeGreaterThan(0)
    const g = fixture()
    g.airlines.cathay.id = 'hk-express'
    expect(issues(g).join()).toMatch(/does not match its id/)
  })

  it('rejects duplicate ids within a list', () => {
    const f = fixture()
    f.airlines.cathay.fleet.push({ ...f.airlines.cathay.fleet[0] })
    f.digest.push({ ...f.digest[0] })
    f.airlines.cathay.profile.hubs.push({ ...f.airlines.cathay.profile.hubs[0] })
    const out = issues(f).join('\n')
    expect(out).toMatch(/fleet\.1: duplicate fleet id "a350-900"/)
    expect(out).toMatch(/digest\.1: duplicate digest id "d1"/)
    expect(out).toMatch(/hubs\.1: duplicate hub "HKG"/)
  })

  it('allows the same id in different lists', () => {
    const f = fixture()
    f.airlines.cathay.destinations[0].id = 'a350-900'
    expect(issues(f)).toEqual([])
  })

  it('enforces https, real dates, and slugs', () => {
    const f = fixture()
    f.airlines.cathay.fleet[0].source_url = 'http://example.com/x'
    f.digest[0].date = '2026-02-30'
    f.airlines.cathay.destinations[0].id = 'LHR'
    const out = issues(f).join('\n')
    expect(out).toMatch(/fleet\.0\.source_url: must be an https URL/)
    expect(out).toMatch(/digest\.0\.date: not a real calendar date/)
    expect(out).toMatch(/destinations\.0\.id/)
  })

  it('enforces zh-Hant length limits', () => {
    const f = fixture()
    f.airlines.cathay.profile.milestones[0].text['zh-Hant'] = '字'.repeat(41)
    f.airlines.cathay.changes[0].text['zh-Hant'] = '字'.repeat(61)
    f.airlines.cathay.profile.group.text['zh-Hant'] = '字'.repeat(81)
    const out = issues(f).join('\n')
    expect(out).toMatch(/milestones\.0\.text\.zh-Hant: zh-Hant must be at most 40/)
    expect(out).toMatch(/changes\.0\.text\.zh-Hant: zh-Hant must be at most 60/)
    expect(out).toMatch(/group\.text\.zh-Hant: zh-Hant must be at most 80/)
    const ok = fixture()
    ok.airlines.cathay.profile.milestones[0].text['zh-Hant'] = '字'.repeat(40)
    expect(issues(ok)).toEqual([])
  })

  it('requires 5–8 milestones and allows a null cadet programme', () => {
    const f = fixture()
    f.airlines.cathay.profile.milestones.pop()
    expect(issues(f).join()).toMatch(/milestones/)
    const g = fixture()
    g.airlines.cathay.profile.cadet_programme = null
    expect(issues(g)).toEqual([])
  })

  it('rejects an item as_of later than the file as_of', () => {
    const f = fixture()
    f.airlines.cathay.fleet[0].as_of = '2026-10-06'
    expect(issues(f).join()).toMatch(/airlines\.cathay\.fleet\.a350-900\.as_of 2026-10-06 is later than the file's as_of 2026-10-05/)
    const g = fixture()
    g.digest[0].as_of = '2026-10-05'
    expect(issues(g)).toEqual([])
  })
})

describe('changes within 12 months of as_of', () => {
  it('computes the window start', () => {
    expect(twelveMonthsBefore('2026-10-05')).toBe('2025-10-05')
    expect(twelveMonthsBefore('2028-02-29')).toBe('2027-02-28')
  })

  it('accepts the first day of the window and as_of itself', () => {
    const f = fixture()
    f.airlines.cathay.changes[0].date = '2025-10-05'
    expect(issues(f)).toEqual([])
    f.airlines.cathay.changes[0].date = '2026-10-05'
    expect(issues(f)).toEqual([])
  })

  it('rejects a change older than 12 months or after as_of', () => {
    const f = fixture()
    f.airlines.cathay.changes[0].date = '2025-10-04'
    expect(issues(f).join()).toMatch(/changes\.0\.date: change "almaty" dated 2025-10-04 is outside/)
    expect(changesOutsideWindow(f)).toHaveLength(1)
    f.airlines.cathay.changes[0].date = '2026-10-06'
    expect(issues(f).join()).toMatch(/outside the 12 months/)
  })
})

describe('as_of never earlier than main', () => {
  const parse = (d: unknown) => LiveContent.parse(d)

  it('passes when nothing moved backwards', () => {
    const base = parse(fixture())
    const next = fixture()
    next.as_of = '2026-11-01'
    next.airlines.cathay.fleet[0].as_of = '2026-11-01'
    expect(checkAsOfMonotonic(base, parse(next))).toEqual([])
    expect(checkAsOfMonotonic(base, base)).toEqual([])
  })

  it('fails when the file as_of goes backwards', () => {
    const baseRaw = fixture()
    baseRaw.as_of = '2026-11-01'
    expect(checkAsOfMonotonic(parse(baseRaw), parse(fixture()))).toEqual([
      "as_of: 2026-10-05 is earlier than main's 2026-11-01",
    ])
  })

  it('fails when an item present on main goes backwards', () => {
    const base = parse(fixture())
    const next = fixture()
    next.airlines.cathay.destinations[0].as_of = '2026-09-01'
    next.digest[0].as_of = '2026-09-30'
    next.airlines.cathay.profile.hubs[0].as_of = '2026-09-02'
    expect(checkAsOfMonotonic(base, parse(next))).toEqual([
      "airlines.cathay.profile.hubs.HKG.as_of: 2026-09-02 is earlier than main's 2026-10-01",
      "airlines.cathay.destinations.lhr.as_of: 2026-09-01 is earlier than main's 2026-10-01",
      "digest.d1.as_of: 2026-09-30 is earlier than main's 2026-10-01",
    ])
  })

  it('ignores items that are new or removed', () => {
    const base = parse(fixture())
    const next = fixture()
    next.digest = [{ ...next.digest[0], id: 'd2', as_of: '2026-01-01' }]
    expect(checkAsOfMonotonic(base, parse(next))).toEqual([])
  })
})

describe('owner rulings 2026-10-11', () => {
  it('allows a null founded year and null fleet counts', () => {
    const f = fixture()
    f.airlines.cathay.profile.founded = null
    f.airlines.cathay.fleet[0].in_service = null
    f.airlines.cathay.fleet[0].on_order = null
    expect(issues(f)).toEqual([])
  })

  it('accepts central-asia and an optional shared_with airline', () => {
    const f = fixture()
    f.airlines.cathay.destinations[0].region = 'central-asia'
    f.airlines.cathay.destinations[0].shared_with = 'hk-express'
    expect(issues(f)).toEqual([])
    f.airlines.cathay.destinations[0].shared_with = 'hkexpress'
    expect(issues(f).join()).toMatch(/destinations\.0\.shared_with/)
  })

  it('rejects shared_with naming the airline itself', () => {
    const f = fixture()
    f.airlines.cathay.destinations[0].shared_with = 'cathay'
    expect(issues(f).join()).toMatch(/shared_with.*itself/)
  })

  it('requires as_of on changes and counts it in the as_of rules', () => {
    const f = fixture()
    delete f.airlines.cathay.changes[0].as_of
    expect(issues(f).join()).toMatch(/changes\.0\.as_of: Required/)
    const g = fixture()
    g.airlines.cathay.changes[0].as_of = '2099-01-01'
    expect(issues(g).join()).toMatch(/changes\.almaty\.as_of 2099-01-01 is later/)
    const base = fixture()
    const next = fixture()
    next.airlines.cathay.changes[0].as_of = '2026-01-01'
    expect(checkAsOfMonotonic(base, next).join()).toMatch(/changes\.almaty\.as_of/)
  })
})

describe('owner rulings 2026-10-12', () => {
  it('upcoming needs a start_date (day, month or quarter); start_date only on upcoming', () => {
    const f = fixture()
    const d = f.airlines.cathay.destinations[0]
    d.status = 'upcoming'
    expect(issues(f).join()).toMatch(/start_date: start_date is required/)
    for (const s of ['2026-12-03', '2027-01', '2027-Q1']) {
      d.start_date = s
      expect(issues(f)).toEqual([])
    }
    d.start_date = '2027-Q5'
    expect(issues(f).join()).toMatch(/start_date/)
    d.start_date = '2027-Q1'
    d.status = 'new'
    expect(issues(f).join()).toMatch(/start_date is only for status "upcoming"/)
  })

  it('iata may be null (then no code_source); a code needs code_source', () => {
    const f = fixture()
    const d = f.airlines.cathay.destinations[0]
    d.iata = null
    expect(issues(f).join()).toMatch(/code_source must be absent/)
    delete d.code_source
    expect(issues(f)).toEqual([])
    const g = fixture()
    delete g.airlines.cathay.destinations[0].code_source
    expect(issues(g).join()).toMatch(/code_source is required/)
    g.airlines.cathay.destinations[0].code_source = 'guess'
    expect(issues(g).join()).toMatch(/code_source/)
  })

  it('destinations_partial is an optional flag', () => {
    const f = fixture()
    f.airlines.cathay.destinations_partial = true
    expect(issues(f)).toEqual([])
    f.airlines.cathay.destinations_partial = 'yes'
    expect(issues(f).join()).toMatch(/destinations_partial/)
  })
})

describe('maintenance_stations (Task 21)', () => {
  const station = () => ({
    country: { en: 'Japan', 'zh-Hant': '日本' },
    city: { en: 'Tokyo', 'zh-Hant': '東京' },
    iata: 'NRT',
    region: 'east-asia',
    type: 'line',
    provider: 'Cathay Pacific',
    source_url: 'https://example.com/lm.pdf',
    source_title: 'Line Maintenance Services Capability List S2026',
    as_of: '2026-10-01',
  })
  const withStations = (xs: unknown[]) => {
    const f = fixture()
    f.airlines.cathay.maintenance_stations = xs
    return f
  }

  it('accepts a valid station (line, base, both; any region incl. south-asia / middle-east)', () => {
    expect(issues(withStations([station()]))).toEqual([])
    expect(issues(withStations([{ ...station(), type: 'base' }]))).toEqual([])
    expect(issues(withStations([{ ...station(), type: 'both', iata: 'DXB', region: 'middle-east' }]))).toEqual([])
    expect(issues(withStations([{ ...station(), iata: 'BOM', region: 'south-asia' }]))).toEqual([])
  })

  it('rejects a missing required field', () => {
    for (const k of ['country', 'city', 'iata', 'region', 'type', 'provider', 'source_url', 'source_title', 'as_of']) {
      const s: Record<string, unknown> = station()
      delete s[k]
      expect(issues(withStations([s])).join('\n')).toMatch(new RegExp(`maintenance_stations\\.0\\.${k}`))
    }
  })

  it('rejects a wrong type', () => {
    const out = issues(withStations([{ ...station(), provider: 42, city: 'Tokyo' }])).join('\n')
    expect(out).toMatch(/maintenance_stations\.0\.provider/)
    expect(out).toMatch(/maintenance_stations\.0\.city/)
  })

  it('rejects a bad IATA code', () => {
    for (const iata of ['nrt', 'NR', 'NRTX', '123']) {
      expect(issues(withStations([{ ...station(), iata }])).join()).toMatch(/maintenance_stations\.0\.iata: expected a 3-letter IATA code/)
    }
  })

  it('rejects a type outside line|base|both and an unknown region', () => {
    const out = issues(withStations([{ ...station(), type: 'heavy', region: 'antarctica' }])).join('\n')
    expect(out).toMatch(/maintenance_stations\.0\.type/)
    expect(out).toMatch(/maintenance_stations\.0\.region/)
  })

  it('rejects a non-https source_url and a bad as_of', () => {
    const out = issues(withStations([{ ...station(), source_url: 'http://example.com/x', as_of: '2026-02-30' }])).join('\n')
    expect(out).toMatch(/maintenance_stations\.0\.source_url: must be an https URL/)
    expect(out).toMatch(/maintenance_stations\.0\.as_of: not a real calendar date/)
    expect(issues(withStations([{ ...station(), source_url: 'not a url' }])).join()).toMatch(/maintenance_stations\.0\.source_url/)
  })

  it('rejects unknown keys and duplicate iata within an airline', () => {
    expect(issues(withStations([{ ...station(), retrieved_at: '2026-10-01' }])).join()).toMatch(/Unrecognized key/)
    expect(issues(withStations([station(), station()])).join()).toMatch(/maintenance_stations\.1: duplicate maintenance station "NRT"/)
  })

  it('allows an empty array', () => {
    expect(issues(withStations([]))).toEqual([])
  })

  it('is optional: an airline without the field is still valid', () => {
    const f = fixture()
    expect('maintenance_stations' in f.airlines.cathay).toBe(false)
    expect(issues(f)).toEqual([])
  })

  it('counts station as_of in the as_of rules', () => {
    const f = withStations([{ ...station(), as_of: '2026-12-01' }])
    expect(issues(f).join()).toMatch(/airlines\.cathay\.maintenance_stations\.NRT\.as_of 2026-12-01 is later than the file's as_of/)
  })
})
