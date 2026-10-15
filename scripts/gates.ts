import { z } from 'zod'
import type { LiveContent } from '../schema/live.ts'

export const GATED_FIELDS = ['maintenance_stations'] as const

const ReleaseGate = z.object({ app_build_live: z.boolean(), requires: z.string() }).strict()
export const ReleaseGates = z.object({ maintenance_stations: ReleaseGate.optional() }).strict()
export type ReleaseGates = z.infer<typeof ReleaseGates>

/** A missing gate fails closed; even an empty list needs a compatible App Store build. */
export function gateViolations(live: LiveContent, gates: ReleaseGates): string[] {
  const errors: string[] = []
  for (const [id, airline] of Object.entries(live.airlines)) {
    if (!airline) continue
    for (const field of GATED_FIELDS) {
      const gate = gates[field]
      if (Object.hasOwn(airline, field) && !gate?.app_build_live) {
        errors.push(`airlines.${id}.${field}: requires ${gate?.requires ?? `an App Store build supporting ${field} (release gate missing)`}`)
      }
    }
  }
  return errors
}
