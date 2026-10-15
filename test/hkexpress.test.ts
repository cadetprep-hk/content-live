import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { LiveContent } from '../schema/live.ts'

const live = LiveContent.parse(JSON.parse(readFileSync(new URL('../live.json', import.meta.url), 'utf8')))
const airline = live.airlines['hk-express']!
const destinationsUrl = 'https://www.hkexpress.com/en/destinations'

it('cites the current destinations page for all 32 former route-map cities', () => {
  const cities = airline.destinations.filter((d) => !['hefei', 'wuxi', 'kota-kinabalu'].includes(d.id))
  expect(cities).toHaveLength(32)
  expect(cities.filter((d) => d.source_url !== destinationsUrl).map((d) => d.id)).toEqual([])
})

it('removes the unavailable 2013 milestone and retains six milestones', () => {
  expect(airline.profile.milestones.map((m) => m.id)).not.toContain('2013-low-cost-carrier')
  expect(airline.profile.milestones).toHaveLength(6)
})

it('removes the unavailable Hefei announcement', () => {
  expect(airline.changes.map((c) => c.id)).not.toContain('2026-09-30-hefei')
})

it('keeps Hefei upcoming with the owner-approved month estimate and current source', () => {
  expect(airline.destinations.find((d) => d.id === 'hefei')).toMatchObject({
    source_url: destinationsUrl,
    start_date: '2026-12',
    status: 'upcoming',
  })
})
