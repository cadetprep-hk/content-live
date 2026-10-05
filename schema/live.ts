/**
 * Shared schema for live.json (served at https://content.cadetdream.com/live.json).
 *
 * This file is imported by the Cadet Dream app through a git submodule
 * (vendor/content-live/schema/live.ts), so it depends on zod only and uses
 * no path aliases.
 *
 * Rules enforced here:
 * - every object is strict (unknown keys are errors);
 * - every data item carries source_url (https) and, except changes, as_of (YYYY-MM-DD, the day the source was read);
 * - ids are unique within each list (hubs: unique iata);
 * - the file's as_of is not earlier than any item's as_of;
 * - changes[].date lies within the 12 months up to the file's as_of.
 * The "as_of never goes backwards vs main" rule needs two files; see checkAsOfMonotonic below.
 */
import { z } from 'zod'

/* ---------------------------------------------------------------- primitives */

function isRealDate(s: string): boolean {
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

export const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
  .refine(isRealDate, 'not a real calendar date')

export const HttpsUrl = z
  .string()
  .url()
  .refine((s) => s.startsWith('https://'), 'must be an https URL')

export const Slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'expected a lower-case slug (a-z, 0-9, -)')

export const Iata = z.string().regex(/^[A-Z]{3}$/, 'expected a 3-letter IATA code')

/** Number of characters as a reader counts them (code points, not UTF-16 units). */
export function charCount(s: string): number {
  return Array.from(s).length
}

/** Bilingual text: written Chinese and British English. */
export const BilingualText = z
  .object({
    en: z.string().trim().min(1),
    'zh-Hant': z.string().trim().min(1),
  })
  .strict()
export type BilingualText = z.infer<typeof BilingualText>

function bilingualMaxZh(max: number) {
  return BilingualText.refine((t) => charCount(t['zh-Hant']) <= max, {
    message: `zh-Hant must be at most ${max} characters`,
    path: ['zh-Hant'],
  })
}

/* ---------------------------------------------------------------- enums */

export const AIRLINE_IDS = ['cathay', 'hk-express', 'greater-bay', 'hk-airlines'] as const
export const AirlineId = z.enum(AIRLINE_IDS)
export type AirlineId = z.infer<typeof AirlineId>

export const REGIONS = [
  'east-asia',
  'southeast-asia',
  'south-asia',
  'middle-east',
  'europe',
  'north-america',
  'oceania',
  'africa',
] as const
export const Region = z.enum(REGIONS)
export type Region = z.infer<typeof Region>

export const DESTINATION_STATUSES = ['current', 'new', 'suspended', 'resumed'] as const
export const DestinationStatus = z.enum(DESTINATION_STATUSES)
export type DestinationStatus = z.infer<typeof DestinationStatus>

export const CHANGE_KINDS = [
  'new-route',
  'cancelled',
  'resumed',
  'extra-frequency',
  'fleet-delivery',
  'order',
] as const
export const ChangeKind = z.enum(CHANGE_KINDS)
export type ChangeKind = z.infer<typeof ChangeKind>

export const DIGEST_CATEGORIES = ['fleet', 'route', 'recruitment', 'industry'] as const
export const DigestCategory = z.enum(DIGEST_CATEGORIES)
export type DigestCategory = z.infer<typeof DigestCategory>

/** UI labels (zh-Hant) for the enums above. */
export const REGION_LABELS_ZH: Record<Region, string> = {
  'east-asia': '東亞',
  'southeast-asia': '東南亞',
  'south-asia': '南亞',
  'middle-east': '中東',
  europe: '歐洲',
  'north-america': '北美',
  oceania: '大洋洲',
  africa: '非洲',
}
export const CHANGE_KIND_LABELS_ZH: Record<ChangeKind, string> = {
  'new-route': '新增',
  cancelled: '取消',
  resumed: '復航',
  'extra-frequency': '加班',
  'fleet-delivery': '機隊交付',
  order: '訂單',
}

/* ---------------------------------------------------------------- helpers */

/** Adds an issue for every id (by `key`) that occurs more than once in `items`. */
function uniqueBy<T>(items: T[], key: (item: T) => string, ctx: z.RefinementCtx, label: string): void {
  const seen = new Set<string>()
  items.forEach((item, i) => {
    const k = key(item)
    if (seen.has(k)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate ${label} "${k}"`, path: [i] })
    }
    seen.add(k)
  })
}

const sourced = { source_url: HttpsUrl, as_of: IsoDate }

/* ---------------------------------------------------------------- airline */

export const GroupProfile = z
  .object({ text: bilingualMaxZh(80), ...sourced })
  .strict()

export const Hub = z.object({ iata: Iata, ...sourced }).strict()

export const Founded = z
  .object({ year: z.number().int().min(1900).max(2100), ...sourced })
  .strict()

export const CadetProgramme = z.object({ url: HttpsUrl, ...sourced }).strict()

export const Milestone = z
  .object({
    id: Slug,
    year: z.number().int().min(1900).max(2100),
    text: bilingualMaxZh(40),
    ...sourced,
  })
  .strict()
export type Milestone = z.infer<typeof Milestone>

export const Profile = z
  .object({
    group: GroupProfile,
    hubs: z.array(Hub).min(1).superRefine((xs, ctx) => uniqueBy(xs, (x) => x.iata, ctx, 'hub')),
    founded: Founded,
    cadet_programme: CadetProgramme.nullable(),
    milestones: z
      .array(Milestone)
      .min(5)
      .max(8)
      .superRefine((xs, ctx) => uniqueBy(xs, (x) => x.id, ctx, 'milestone id')),
  })
  .strict()
export type Profile = z.infer<typeof Profile>

export const FleetEntry = z
  .object({
    id: Slug,
    type: z.string().min(1),
    variant: z.string().min(1),
    in_service: z.number().int().min(0),
    on_order: z.number().int().min(0),
    first_delivery_year: z.number().int().min(1900).max(2100).nullable(),
    ...sourced,
  })
  .strict()
export type FleetEntry = z.infer<typeof FleetEntry>

export const Destination = z
  .object({
    id: Slug,
    iata: Iata,
    city: BilingualText,
    region: Region,
    since_year: z.number().int().min(1900).max(2100).nullable(),
    status: DestinationStatus,
    ...sourced,
  })
  .strict()
export type Destination = z.infer<typeof Destination>

export const Change = z
  .object({
    id: Slug,
    date: IsoDate,
    kind: ChangeKind,
    text: bilingualMaxZh(60),
    source_url: HttpsUrl,
  })
  .strict()
export type Change = z.infer<typeof Change>

export const Airline = z
  .object({
    id: AirlineId,
    name: BilingualText,
    profile: Profile,
    fleet: z.array(FleetEntry).superRefine((xs, ctx) => uniqueBy(xs, (x) => x.id, ctx, 'fleet id')),
    destinations: z
      .array(Destination)
      .superRefine((xs, ctx) => uniqueBy(xs, (x) => x.id, ctx, 'destination id')),
    changes: z.array(Change).superRefine((xs, ctx) => uniqueBy(xs, (x) => x.id, ctx, 'change id')),
  })
  .strict()
export type Airline = z.infer<typeof Airline>

/* ---------------------------------------------------------------- digest */

/**
 * One Prep 「最新動態」 item. Same fields as the app's bundled DigestEntry
 * (category / date / headline / body / source_url) plus id and as_of.
 */
export const DigestItem = z
  .object({
    id: Slug,
    category: DigestCategory,
    date: IsoDate,
    headline: BilingualText,
    body: BilingualText,
    ...sourced,
  })
  .strict()
export type DigestItem = z.infer<typeof DigestItem>

/* ---------------------------------------------------------------- dated items */

/** One item that carries an as_of, addressed by a stable key (used for the as_of rules). */
export interface DatedItem {
  key: string
  as_of: string
}

/** Every item in the file that carries an as_of, keyed by airline / list / id. */
export function datedItems(live: Pick<LiveContent, 'airlines' | 'digest'>): DatedItem[] {
  const out: DatedItem[] = []
  for (const [aid, a] of Object.entries(live.airlines)) {
    if (!a) continue
    const p = a.profile
    out.push({ key: `airlines.${aid}.profile.group`, as_of: p.group.as_of })
    for (const h of p.hubs) out.push({ key: `airlines.${aid}.profile.hubs.${h.iata}`, as_of: h.as_of })
    out.push({ key: `airlines.${aid}.profile.founded`, as_of: p.founded.as_of })
    if (p.cadet_programme) out.push({ key: `airlines.${aid}.profile.cadet_programme`, as_of: p.cadet_programme.as_of })
    for (const m of p.milestones) out.push({ key: `airlines.${aid}.profile.milestones.${m.id}`, as_of: m.as_of })
    for (const f of a.fleet) out.push({ key: `airlines.${aid}.fleet.${f.id}`, as_of: f.as_of })
    for (const d of a.destinations) out.push({ key: `airlines.${aid}.destinations.${d.id}`, as_of: d.as_of })
  }
  for (const d of live.digest) out.push({ key: `digest.${d.id}`, as_of: d.as_of })
  return out
}

/** The earliest date that still counts as "within the last 12 months" of `asOf` (same day, one year back). */
export function twelveMonthsBefore(asOf: string): string {
  const [y, m, d] = asOf.split('-').map(Number) as [number, number, number]
  const back = new Date(Date.UTC(y - 1, m - 1, d))
  // 29 Feb → 28 Feb when the earlier year is not a leap year.
  if (back.getUTCMonth() !== m - 1) back.setUTCDate(0)
  return back.toISOString().slice(0, 10)
}

/** Changes whose date is not within the 12 months up to (and including) `asOf`. */
export function changesOutsideWindow(
  live: Pick<LiveContent, 'as_of' | 'airlines'>,
): { airline: string; index: number; id: string; date: string }[] {
  const from = twelveMonthsBefore(live.as_of)
  const out: { airline: string; index: number; id: string; date: string }[] = []
  for (const [aid, a] of Object.entries(live.airlines)) {
    if (!a) continue
    a.changes.forEach((c, index) => {
      if (c.date < from || c.date > live.as_of) out.push({ airline: aid, index, id: c.id, date: c.date })
    })
  }
  return out
}

/**
 * The "as_of never goes backwards" rule between the version on main (`base`) and a new version (`next`):
 * the file's as_of, and the as_of of every item present in both, must not be earlier in `next`.
 * Returns one message per violation (empty = OK).
 */
export function checkAsOfMonotonic(
  base: Pick<LiveContent, 'as_of' | 'airlines' | 'digest'>,
  next: Pick<LiveContent, 'as_of' | 'airlines' | 'digest'>,
): string[] {
  const errors: string[] = []
  if (next.as_of < base.as_of) errors.push(`as_of: ${next.as_of} is earlier than main's ${base.as_of}`)
  const before = new Map(datedItems(base).map((i) => [i.key, i.as_of]))
  for (const item of datedItems(next)) {
    const prev = before.get(item.key)
    if (prev !== undefined && item.as_of < prev) {
      errors.push(`${item.key}.as_of: ${item.as_of} is earlier than main's ${prev}`)
    }
  }
  return errors
}

/* ---------------------------------------------------------------- file */

export const LiveContent = z
  .object({
    schema_version: z.literal(1),
    as_of: IsoDate,
    airlines: z.record(AirlineId, Airline),
    digest: z.array(DigestItem).superRefine((xs, ctx) => uniqueBy(xs, (x) => x.id, ctx, 'digest id')),
  })
  .strict()
  .superRefine((live, ctx) => {
    for (const [key, a] of Object.entries(live.airlines)) {
      if (a && a.id !== key) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `airline key "${key}" does not match its id "${a.id}"`,
          path: ['airlines', key, 'id'],
        })
      }
    }
    for (const item of datedItems(live)) {
      if (item.as_of > live.as_of) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${item.key}.as_of ${item.as_of} is later than the file's as_of ${live.as_of}`,
          path: ['as_of'],
        })
      }
    }
    for (const c of changesOutsideWindow(live)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `change "${c.id}" dated ${c.date} is outside the 12 months up to ${live.as_of}`,
        path: ['airlines', c.airline, 'changes', c.index, 'date'],
      })
    }
  })
export type LiveContent = z.infer<typeof LiveContent>
