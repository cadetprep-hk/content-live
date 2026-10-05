/**
 * npm run validate -- [file] [--base <path>] [--skip-urls]
 *
 * 1. live.json against the shared zod schema (includes rule 4: changes within 12 months of as_of).
 * 2. Every source_url and cadet_programme.url answers HTTP 200 (HEAD, GET fallback, redirects followed).
 * 3. as_of (file and per item) is not earlier than in the base file (the Action passes main's live.json).
 * 4. changes[].date within the 12 months up to the file's as_of (reported on its own as well).
 */
import { existsSync, readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { LiveContent, changesOutsideWindow, checkAsOfMonotonic } from '../schema/live.ts'
import { checkUrls, collectUrls } from './urls.ts'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    base: { type: 'string' },
    'skip-urls': { type: 'boolean', default: false },
  },
})

const file = positionals[0] ?? 'live.json'
let failed = false
const fail = (msg: string) => {
  failed = true
  console.error(`  ✗ ${msg}`)
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'))
}

console.log(`Validating ${file}`)

// 1. schema
console.log('1. schema')
const parsed = LiveContent.safeParse(readJson(file))
if (!parsed.success) {
  for (const issue of parsed.error.issues) fail(`${issue.path.join('.') || '(root)'}: ${issue.message}`)
  console.error('\nSchema failed; later checks need a valid file.')
  process.exit(1)
}
const live = parsed.data
const airlineCount = Object.keys(live.airlines).length
console.log(`  ✓ schema_version ${live.schema_version}, as_of ${live.as_of}, ${airlineCount} airlines, ${live.digest.length} digest items`)

// 2. URLs
console.log('2. source URLs')
if (values['skip-urls']) {
  console.log('  - skipped (--skip-urls)')
} else {
  const urls = collectUrls(live)
  const failures = await checkUrls(urls)
  for (const f of failures) fail(`${f.url} — ${f.reason} (used at ${f.usedAt.join(', ')})`)
  if (failures.length === 0) console.log(`  ✓ ${urls.size} URLs answered HTTP 200`)
  else console.error(`  ${failures.length} of ${urls.size} URLs failed`)
}

// 3. as_of monotonic vs base
console.log('3. as_of vs base')
if (!values.base) {
  console.log('  - no --base given; skipped')
} else if (!existsSync(values.base) || readFileSync(values.base, 'utf8').trim() === '') {
  console.log(`  - base ${values.base} not found or empty (first version); skipped`)
} else {
  const base = LiveContent.safeParse(readJson(values.base))
  if (!base.success) {
    // An older schema on main must not block a fix; compare the file-level as_of only.
    const raw = readJson(values.base) as { as_of?: unknown }
    console.log('  - base does not match the current schema; comparing the file as_of only')
    if (typeof raw.as_of === 'string' && live.as_of < raw.as_of) fail(`as_of: ${live.as_of} is earlier than base's ${raw.as_of}`)
  } else {
    const errors = checkAsOfMonotonic(base.data, live)
    errors.forEach(fail)
    if (errors.length === 0) console.log(`  ✓ nothing earlier than base (base as_of ${base.data.as_of})`)
  }
}

// 4. changes within 12 months
console.log('4. changes within 12 months')
const stale = changesOutsideWindow(live)
stale.forEach((c) => fail(`airlines.${c.airline}.changes.${c.id}: ${c.date} is outside the 12 months up to ${live.as_of}`))
if (stale.length === 0) console.log('  ✓ all changes dated within the 12 months up to as_of')

if (failed) {
  console.error('\nValidation FAILED')
  process.exit(1)
}
console.log('\nValidation passed')
