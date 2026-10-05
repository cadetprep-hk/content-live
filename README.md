# content-live

Live content for the **Cadet Dream** app: airline profiles, fleets, destinations, recent changes, and the Prep
「最新動態」 digest. The app fetches one file:

```
https://content.cadetdream.com/live.json
```

## What is here

| Path | What |
|---|---|
| `live.json` | The content. Every item carries `source_url` (https) and `as_of` (the day its source was read). |
| `schema/live.ts` | The zod schema for `live.json` (zod only, no path aliases). The app vendors this repo as a git submodule at `vendor/content-live` and imports `vendor/content-live/schema/live.ts`. |
| `scripts/validate.ts` | `npm run validate` — the checks below. |
| `_headers` | Cloudflare Pages headers for `/live.json` (JSON content type, 1 h cache, CORS `*`). |
| `.github/workflows/validate.yml` | Runs tests and validation on every pull request and push to `main`. |

## Hosting

A Cloudflare Pages project builds from this repo's `main` branch with **no build command** and **build output directory
= repo root** (`/`). The owner adds the custom domain **content.cadetdream.com** to that project. Every merge to `main`
redeploys; `live.json` is cached for up to an hour.

## How it is updated

Monthly, on the 1st, by a scheduled task that opens a pull request (template in `.github/pull_request_template.md`).
Sources, classification rules and the review checklist live in the app repo at `design/ops/monthly-update.md`.
Only these sources are allowed: each airline's own newsroom / press releases, its annual or interim report, its
official fleet page, Airport Authority Hong Kong press releases, and the Civil Aviation Department aircraft register.

## Validate

```sh
npm ci
npm test                                   # schema and as_of rules (URL checks mocked)
npm run validate                           # live.json: schema, URLs, changes window
npm run validate -- live.json --base <main's live.json>   # also: as_of never earlier than main
npm run validate -- --skip-urls            # offline
```

The checks:

1. `live.json` matches `schema/live.ts` (strict objects, bilingual text, enums, unique ids per list, item `as_of` not
   after the file `as_of`).
2. Every `source_url` and `cadet_programme.url` answers HTTP 200 — HEAD first, GET when HEAD is refused, redirects
   followed, 15 s timeout, 4 at a time; every failure is listed.
3. The file `as_of`, and the `as_of` of every item already on `main`, is not earlier than on `main`.
4. `changes[].date` is within the 12 months up to the file `as_of`.
