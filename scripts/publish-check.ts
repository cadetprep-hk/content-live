/** npm run publish:check -- [file] — schema and release compatibility only. */
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { LiveContent } from '../schema/live.ts'
import { ReleaseGates, gateViolations } from './gates.ts'

const { positionals } = parseArgs({ allowPositionals: true })
const file = positionals[0] ?? 'live.json'
try {
  const live = LiveContent.parse(JSON.parse(readFileSync(file, 'utf8')))
  const gates = ReleaseGates.parse(JSON.parse(readFileSync(new URL('../release-gates.json', import.meta.url), 'utf8')))
  const errors = gateViolations(live, gates)
  if (errors.length > 0) {
    errors.forEach((error) => console.error(`  ✗ ${error}`))
    console.error('Publish check FAILED')
    process.exitCode = 1
  } else {
    console.log(`Publish check passed (${file})`)
  }
} catch (error) {
  console.error('Publish check FAILED:', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
