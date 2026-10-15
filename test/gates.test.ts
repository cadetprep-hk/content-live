import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { GATED_FIELDS, ReleaseGates, gateViolations } from '../scripts/gates.ts'

const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/valid.json', import.meta.url), 'utf8'))
const closed = { maintenance_stations: { app_build_live: false, requires: 'cadetprep-app #5' } }
const open = { maintenance_stations: { app_build_live: true, requires: 'cadetprep-app #5' } }

describe('release gates (Task 21: new live.json fields wait for an App Store build that reads them)', () => {
  it('knows maintenance_stations is gated', () => {
    expect(GATED_FIELDS).toContain('maintenance_stations')
  })

  it('a file without gated fields passes with the gate closed', () => {
    expect(gateViolations(fixture(), ReleaseGates.parse(closed))).toEqual([])
  })

  it('maintenance_stations (even an empty array) fails while the gate is closed', () => {
    const f = fixture()
    f.airlines.cathay.maintenance_stations = []
    const out = gateViolations(f, ReleaseGates.parse(closed))
    expect(out).toHaveLength(1)
    expect(out[0]).toMatch(/airlines\.cathay\.maintenance_stations.*app_build_live is false.*cadetprep-app #5/)
  })

  it('passes once the gate is opened', () => {
    const f = fixture()
    f.airlines.cathay.maintenance_stations = []
    expect(gateViolations(f, ReleaseGates.parse(open))).toEqual([])
  })

  it('a missing gate entry counts as closed', () => {
    const f = fixture()
    f.airlines.cathay.maintenance_stations = []
    expect(gateViolations(f, ReleaseGates.parse({}))).toHaveLength(1)
  })

  it('the repo release-gates.json is valid and covers every gated field', () => {
    const g = ReleaseGates.parse(JSON.parse(readFileSync(new URL('../release-gates.json', import.meta.url), 'utf8')))
    for (const f of GATED_FIELDS) expect(g[f]).toBeDefined()
  })
})
