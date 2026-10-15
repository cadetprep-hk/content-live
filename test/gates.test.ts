import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LiveContent } from '../schema/live.ts'
import { GATED_FIELDS, ReleaseGates, gateViolations } from '../scripts/gates.ts'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const fixture = () => JSON.parse(read('test/fixtures/valid.json'))
const closed = { maintenance_stations: { app_build_live: false, requires: 'Task 21 build live on the App Store' } }

describe('release gates', () => {
  it('registers maintenance_stations', () => {
    expect(GATED_FIELDS).toContain('maintenance_stations')
  })
  it('passes old content with closed gates', () => {
    expect(gateViolations(LiveContent.parse(fixture()), closed)).toEqual([])
  })
  it('blocks even an empty list with the field path and requirement', () => {
    const f = fixture()
    f.airlines.cathay.maintenance_stations = []
    const errors = gateViolations(f, closed)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('airlines.cathay.maintenance_stations')
    expect(errors[0]).toContain(closed.maintenance_stations.requires)
    expect(gateViolations(f, { maintenance_stations: { ...closed.maintenance_stations, app_build_live: true } })).toEqual([])
    expect(gateViolations(f, {})).toHaveLength(1)
  })
  it('validates strict gate configuration while allowing missing gates', () => {
    expect(ReleaseGates.safeParse({}).success).toBe(true)
    expect(ReleaseGates.safeParse(closed).success).toBe(true)
    for (const value of [
      { other: closed.maintenance_stations },
      { maintenance_stations: { ...closed.maintenance_stations, extra: true } },
      { maintenance_stations: { requires: 'build' } },
      { maintenance_stations: { app_build_live: false } },
      { maintenance_stations: { app_build_live: 'false', requires: 'build' } },
    ]) expect(ReleaseGates.safeParse(value).success).toBe(false)
  })
  it('ships a valid closed configuration for every gated field', () => {
    const gates = ReleaseGates.parse(JSON.parse(read('release-gates.json')))
    for (const field of GATED_FIELDS) {
      expect(gates[field]?.app_build_live).toBe(false)
      expect(gates[field]?.requires).toContain('App Store')
    }
  })
  it('keeps gates out of validate and provides a publish command and main workflow', () => {
    expect(read('scripts/validate.ts')).not.toMatch(/import.*gates/)
    expect(JSON.parse(read('package.json')).scripts['publish:check']).toBe('tsx scripts/publish-check.ts')
    const workflow = read('.github/workflows/publish-check.yml')
    expect(workflow).toMatch(/push:\s*\n\s*branches: \[main\]/)
    expect(workflow).toContain('workflow_dispatch:')
    expect(workflow).toContain('npm ci')
    expect(workflow).toContain('npm run publish:check')
  })
})
