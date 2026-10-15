/**
 * npm run publish:check -- [file]
 *
 * Runs before publishing live.json (push to main → Cloudflare Pages). Fails when live.json uses a field
 * whose release gate (release-gates.json) is still closed, i.e. older App Store builds would reject the file.
 * Not part of `npm run validate`.
 */
import { readFileSync } from 'node:fs'
import { LiveContent } from '../schema/live.ts'
import { ReleaseGates, gateViolations } from './gates.ts'

const file = process.argv[2] ?? 'live.json'
const live = LiveContent.parse(JSON.parse(readFileSync(file, 'utf8')))
const gates = ReleaseGates.parse(JSON.parse(readFileSync(new URL('../release-gates.json', import.meta.url), 'utf8')))
const blocked = gateViolations(live, gates)
console.log(`Publish check: ${file}`)
for (const b of blocked) console.error(`  ✗ ${b}`)
if (blocked.length > 0) {
  console.error('\nPublish check FAILED: do not publish this live.json yet')
  process.exit(1)
}
console.log('  ✓ no gated field is used before its app build is live\n\nPublish check passed')
