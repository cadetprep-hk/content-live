import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LiveContent } from '../schema/live.ts'
import { ReleaseGates, gateViolations } from '../scripts/gates.ts'

const root = fileURLToPath(new URL('../', import.meta.url))
const read = (path: string) => readFileSync(join(root, path), 'utf8')
const live = LiveContent.parse(JSON.parse(read('live.json')))
// Read from the official S2026 capability matrix on 2026-10-16.
const pdfCodes = 'ANC BLR BOM BNE CEB DEL DWC DXB FUK HND HYD ICN KHH KIX LAX LHR MAA MAN MEL MNL NGO NRT PER SFO SYD TPE YVR YYZ'.split(' ').sort()
const pdfUrl = 'https://www.cathaypacific.com/content/dam/focal-point/cx/engineering/cx_lm_service_capability_list_w26.pdf'
const haecoUrl = 'https://www.haeco.com/en/media-centre/press-releases/haeco-commences-line-maintenance-support-for-cathay-pacifics-a-321-neo-in-hong-kong'
const airlineIds = ['cathay', 'hk-express', 'greater-bay', 'hk-airlines'] as const

describe('Task 21 maintenance station data', () => {
  it('has 34 stations: the 28 PDF line stations, HKG and five HAECO line stations', () => {
    const stations = live.airlines.cathay!.maintenance_stations
    expect(stations).toHaveLength(34)
    const line = stations!.filter((station) => station.type === 'line' && station.provider === 'Cathay Pacific')
    expect(line.map((station) => station.iata).sort()).toEqual(pdfCodes)
    for (const station of line) {
      expect(station.provider).toBe('Cathay Pacific')
      expect(station.source_url).toBe(pdfUrl)
      expect(station.source_title).toBe('Line Maintenance Services Capability List S2026')
    }
    const haecoLine = stations!.filter((station) => station.provider === 'HAECO' && station.type === 'line')
    expect(haecoLine.map((station) => station.iata).sort()).toEqual(['CGO', 'CKG', 'NKG', 'WUH', 'XMN'])
    for (const station of haecoLine) {
      expect(station).toMatchObject({
        country: { en: 'China', 'zh-Hant': '中國' },
        region: 'east-asia',
        source_url: haecoUrl,
        source_title: "HAECO commences line maintenance support for Cathay Pacific's A321neo in Hong Kong",
      })
      const destinations = live.airlines.cathay!.destinations.filter((item) =>
        item.city.en === station.city.en,
      )
      expect(destinations).toHaveLength(1)
      expect(destinations[0]!.iata).toBe(station.iata)
    }
    expect(stations!.filter((station) => station.type !== 'line')).toEqual([
      expect.objectContaining({ iata: 'HKG', type: 'both', provider: 'HAECO', source_url: haecoUrl }),
    ])
  })

  it.each(['hk-express', 'greater-bay', 'hk-airlines'] as const)('%s has an explicit empty list without official station evidence', (id) => {
    expect(live.airlines[id]!.maintenance_stations).toEqual([])
  })

  it('dates the file and all 34 stations to the source read day and uses only allowed sources', () => {
    expect(live.as_of).toBe('2026-10-16')
    const stations = Object.values(live.airlines).flatMap((airline) => airline?.maintenance_stations ?? [])
    expect(stations).toHaveLength(34)
    for (const station of stations) {
      expect(station.as_of).toBe('2026-10-16')
      expect([pdfUrl, haecoUrl]).toContain(station.source_url)
    }
  })

  it('matches existing destination city and region conventions by IATA', () => {
    const stations = live.airlines.cathay!.maintenance_stations
    expect(stations).toHaveLength(34)
    for (const station of stations!) {
      const destination = live.airlines.cathay!.destinations.find((item) => item.iata === station.iata)
      if (destination) {
        expect(station.city).toEqual(destination.city)
        expect(station.region).toBe(destination.region)
      }
    }
  })

  it('retains the Hefei month estimate with no exact-day claim in live content or change texts', () => {
    expect(live.airlines['hk-express']!.destinations.find((item) => item.id === 'hefei')).toMatchObject({
      start_date: '2026-12', status: 'upcoming',
    })
    expect(read('live.json')).not.toMatch(/2026-12-03|3 December 2026|December 3,? 2026|2026年12月3日/)
  })

  it('blocks one field per airline while closed, including empty arrays, and allows an open gate', () => {
    const gates = ReleaseGates.parse(JSON.parse(read('release-gates.json')))
    const errors = gateViolations(live, gates)
    expect(errors).toHaveLength(4)
    for (const id of airlineIds) {
      expect(errors.filter((error) => error.startsWith(`airlines.${id}.maintenance_stations:`))).toEqual([
        `airlines.${id}.maintenance_stations: requires ${gates.maintenance_stations!.requires}`,
      ])
    }
    const open = ReleaseGates.parse(JSON.parse(JSON.stringify(gates)))
    open.maintenance_stations!.app_build_live = true
    expect(gateViolations(live, open)).toEqual([])
  })

  it('publish:check exits 1 with four violations and 0 with a temporary open gate', () => {
    const dir = mkdtempSync(join(tmpdir(), 'content-live-data-gates-'))
    const original = read('release-gates.json')
    try {
      mkdirSync(join(dir, 'scripts'))
      mkdirSync(join(dir, 'schema'))
      for (const path of ['package.json', 'scripts/publish-check.ts', 'scripts/gates.ts', 'schema/live.ts', 'release-gates.json']) {
        copyFileSync(join(root, path), join(dir, path))
      }
      symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), 'dir')
      const run = () => spawnSync('npm', ['run', 'publish:check', '--', join(root, 'live.json')], {
        cwd: dir, encoding: 'utf8', timeout: 20_000,
      })
      const closed = run()
      expect(closed.error).toBeUndefined()
      expect(closed.status).toBe(1)
      expect(closed.stderr).toContain('Publish check FAILED')
      expect(closed.stderr.match(/✗ airlines\./g)).toHaveLength(4)
      for (const id of airlineIds) expect(closed.stderr).toContain(`airlines.${id}.maintenance_stations:`)

      const gates = ReleaseGates.parse(JSON.parse(original))
      gates.maintenance_stations!.app_build_live = true
      writeFileSync(join(dir, 'release-gates.json'), JSON.stringify(gates))
      const open = run()
      expect(open.error).toBeUndefined()
      expect(open.status).toBe(0)
      expect(open.stdout).toContain('Publish check passed')
    } finally {
      rmSync(dir, { recursive: true, force: true })
      expect(read('release-gates.json')).toBe(original)
    }
  }, 45_000)
})
