/**
 * Release gates (Task 21): a live.json field that older app builds do not know must not be published
 * (merged to main → Cloudflare Pages) until an App Store build that reads it is live. Older builds parse
 * live.json with strict objects, so an unknown key makes them reject the whole file.
 *
 * release-gates.json records, per gated field, whether that build is live. The owner flips
 * app_build_live to true only after the build containing the named app change is on the App Store.
 */
import { z } from 'zod'
import type { LiveContent } from '../schema/live.ts'

export const GATED_FIELDS = ['maintenance_stations'] as const
export type GatedField = (typeof GATED_FIELDS)[number]

export const Gate = z
  .object({
    app_build_live: z.boolean(),
    /** The app change (PR / build) that must be live on the App Store first. */
    requires: z.string().min(1),
  })
  .strict()

export const ReleaseGates = z.object({ maintenance_stations: Gate.optional() }).strict()
export type ReleaseGates = z.infer<typeof ReleaseGates>

/** One message per airline that uses a gated field whose gate is closed (empty = OK to publish). */
export function gateViolations(live: Pick<LiveContent, 'airlines'>, gates: ReleaseGates): string[] {
  const out: string[] = []
  for (const field of GATED_FIELDS) {
    const gate = gates[field]
    if (gate?.app_build_live) continue
    for (const [aid, a] of Object.entries(live.airlines)) {
      if (a && field in a) {
        out.push(
          `airlines.${aid}.${field}: release-gates.json ${field}.app_build_live is false — do not publish until ${gate?.requires ?? 'the app build that reads this field'} is live on the App Store`,
        )
      }
    }
  }
  return out
}
