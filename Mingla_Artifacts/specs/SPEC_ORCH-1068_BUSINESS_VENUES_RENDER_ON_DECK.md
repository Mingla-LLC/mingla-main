# SPEC — ORCH-1068 [business-authored venues render on the consumer deck]

**Skill:** mingla-forensics (SPEC)
**Date:** 2026-06-03
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1068-[business-venues-render-on-deck]/` on branch `ORCH-1068-business-venues-render-on-deck`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1068_BUSINESS_VENUES_RENDER_ON_DECK.md`
**Type:** backend ORCH (no `mingla-designer` pass — deck-card chrome is unchanged; only the data shape + hero-source change). Pipeline: SPEC → IMPLEMENT (Claude `mingla-implementor`) → TEST (deno + iOS/Android sim acceptance + fails-on-revert) → orchestrator CLOSE (migration `db push` by Seth; edge-fn deploy by orchestrator from main).
**Builds on:** ORCH-1067 (B7 photo gate, CLOSED), META-ORCH-1062 (scorer signal_id fix), META-ORCH-1009 Sub-E/F (authoring pipeline).
**Comms:** Acked COMMS-0002 (ORCH-0863 C7 backend allowlist — new migration + any new backend file MUST be added to `orch-0863-marketing-hub-phase-b.mjs` in the SAME commit). Acked COMMS-0003 (cite provider docs URLs inline — done in §3). Acked COMMS-0018 (do not diverge the reconciled `run-business-place-authoring-pipeline` source; build additively on the canonical version on main).

---

## 1. Problem (one paragraph)

A business-authored venue (Lantern & Vine, `place_pool 8b720912-a0bf-405a-88f8-773eca6f3f33`, drinks=200, `is_servable=true`) does NOT render on the consumer Drinks deck. The raw RPC `query_servable_places_by_signal` returns it, but `discover-cards`' open-hours filter (`hasOpeningData`/`isOpenAtHour`) reads only the Google object shape `{periods:[…]}`, while business venues store hours as a top-level ARRAY `[{weekday,isClosed,openTime,closeTime}]` written verbatim by the authoring pipeline. Array → no `.periods` → treated as "no hours" → a `restaurant` (not ALWAYS_OPEN) → EXCLUDED. The array also uses `weekday 0=Monday` (vs Google `day 0=Sunday`), `utc_offset_minutes` is null, and `stored_photo_urls[0]` is a Cloudinary `.mp4` that the deck hero cannot decode. Root cause proven live (INVESTIGATION F-1..F-5).

---

## 2. Scope / Non-Goals / Assumptions

### In scope
1. **Normalize-at-write:** business hours array → canonical Google v1 `{periods,…}` object (with weekday translation + tz population) in `run-business-place-authoring-pipeline` at BOTH `place_pool` write sites (Tier-1 create `:592` and Tier-1 link/confirm `:533`).
2. **Backfill migration** (`20260905000000`) rewriting the existing array-shaped business rows into the Google object shape, idempotent.
3. **Defensive reader safety net:** `discover-cards` (`hasOpeningData`, `isOpenAtHour`, `isOpenAnyTimeOnDay`) AND `_shared/curatedStopHours.ts` (`isStopOpenAtHour`) gain an array-shape branch so a future un-normalized array still serves correctly (regression guard).
4. **Hero picker (F-5):** `discover-cards transformServablePlaceToCard` sets `image` to the first NON-video url in `stored_photo_urls`; full list stays in `images`.
5. **Shared converter** `supabase/functions/_shared/businessHoursToGoogle.ts` (NEW backend file → ORCH-1068 C7 allowlist) used by both the pipeline normalize and a Deno-importable form for the migration's reference shape.

### Non-goals
- No change to `query_servable_places_by_signal` (hours stay a client-time concern — INVESTIGATION F-7).
- No deck cover-VIDEO player (still hero — registered as D-3 follow-up).
- No change to the deck card chrome / layout / tokens (no visual redesign).
- No change to Google-seeded rows (80k+) — backfill is scoped to `business_author_brand_id IS NOT NULL`.
- No `utc_offset_minutes` change for Google rows.

### Assumptions (proven, not guessed)
- Business array weekday convention is **0=Monday…6=Sunday** (`BrandHourEntry`, `mingla-business/src/types/brand.ts:336`; `venueBrandHours.ts:2`). LOCKED.
- Google `periods[].open.day` convention is **0=Sunday** (Google Places v1 docs, §3). LOCKED.
- Exactly 3 business-authored rows exist; 2 servable, all array-shaped hours (live probe 2026-06-03).
- Remote migration max = `20260904000000`; no higher pending across any sibling worktree → `20260905000000` is free + strictly greater.

---

## 3. External Docs (COMMS-0003 — cited inline)

- **Google Places v1 `OpeningHours` / `periods` / `Point.day` (0=Sunday…6=Saturday):** https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places#openinghours and https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places#point — `day`: "A number from 0–6, corresponding to the days of the week, starting on Sunday. 0 is Sunday." `hour` 0–23, `minute` 0–59. This is the shape `discover-cards` already reads and the target of the normalize.
- **Supabase / PostgREST jsonb + `jsonb_typeof`:** https://www.postgresql.org/docs/current/functions-json.html (`jsonb_typeof` returns `'array'` / `'object'`) — used as the idempotency guard in the backfill.
- **Supabase migrations (timestamped, forward-only):** https://supabase.com/docs/guides/deployment/database-migrations — new migration `20260905000000` strictly greater than remote max; applied via `supabase db push` by Seth (orchestrator CLOSE step), NOT via MCP `apply_migration` (avoids remote-only timestamp drift).
- **Supabase Edge Functions deploy:** https://supabase.com/docs/guides/functions/deploy — redeploy `discover-cards`, `run-business-place-authoring-pipeline`, `generate-curated-experiences` from main after merge (orchestrator-owned).

---

## 4. Layer-by-Layer Contract

### 4.1 Shared converter — `supabase/functions/_shared/businessHoursToGoogle.ts` (NEW) 🔒 LOCKED

```ts
// Input: the business wizard array shape (BrandHourEntry-like).
export interface BusinessHourRow {
  weekday: number;            // 0 = Monday … 6 = Sunday (Mingla business convention)
  isClosed?: boolean;
  openTime?: string | null;   // "HH:MM" or "HH:MM:SS"
  closeTime?: string | null;
}
// Output: canonical Google Places v1 regularOpeningHours object subset the deck reads.
export interface GoogleOpeningHours {
  openNow: boolean | null;            // null — computed downstream per user tz
  periods: Array<{
    open:  { day: number; hour: number; minute: number };
    close: { day: number; hour: number; minute: number };
  }>;
  weekdayDescriptions: string[];      // human strings, Mon→Sun order (display nicety)
}

/** 0=Mon..6=Sun (business) → 0=Sun..6=Sat (Google). day = (weekday + 1) % 7. */
export function businessWeekdayToGoogleDay(weekday: number): number;

/** "HH:MM[:SS]" → {hour, minute}; returns null on unparseable/empty. */
export function parseHm(t: string | null | undefined): { hour: number; minute: number } | null;

/** Returns true iff value is the business array shape (Array of objects with `weekday`). */
export function isBusinessHoursArray(value: unknown): value is BusinessHourRow[];

/** The conversion. Skips isClosed rows. Overnight (close <= open) → close.day = next google day,
 *  close.hour may exceed 24-representation by setting close.day to (googleDay+1)%7 with the literal
 *  closing hour (Google represents overnight as a period whose close.day is the next day). For
 *  same-day ranges close.day === open.day. Rows with unparseable times are skipped.
 *  Returns a GoogleOpeningHours; periods=[] when every row is closed/unparseable. */
export function businessHoursToGoogleOpeningHours(rows: BusinessHourRow[]): GoogleOpeningHours;
```

LOCKED rules:
- `day = (weekday + 1) % 7` (F-2 — non-negotiable).
- An `isClosed:true` row contributes NO period (absence = closed, matching Google).
- `openNow` is always written `null` (the deck computes open-now per the user's tz/time; never bake a stale boolean — Constitution #12 validate-at-right-time).
- Overnight ranges (`closeTime <= openTime`, e.g. 18:00→02:00): emit a single period with `open.day = googleDay`, `close.day = (googleDay + 1) % 7`, `close.hour`/`minute` from `closeTime`. The deck's `evalPeriods` already handles `closeH += 24` when `closeH <= openH`, and treats a period as belonging to `open.day`, so this is compatible.
- `weekdayDescriptions`: array of 7 human strings in Mon→Sun order ("Monday: 7:00 AM – 8:00 PM" / "Sunday: Closed"); display-only, never parsed by the gate.

### 4.2 Authoring pipeline normalize — `run-business-place-authoring-pipeline/index.ts` 🔒 LOCKED

At BOTH `place_pool` write sites (`handleTier1` create insert `:571-599` and the link/confirm update `:526-536`), replace:
```ts
opening_hours: draft.hours ?? draft.openingHours ?? null,
```
with a normalized form:
```ts
opening_hours: normalizeBusinessHoursForPool(draft.hours ?? draft.openingHours),
```
where `normalizeBusinessHoursForPool(input)`:
- `null/undefined` → `null` (unchanged).
- `isBusinessHoursArray(input)` → `businessHoursToGoogleOpeningHours(input)` (the Google object).
- already an object with `periods` → pass through unchanged (claim-existing rows already Google-shaped).
- any other shape → `null` (defensive; logged `console.warn`).

ALSO set `utc_offset_minutes` on the same write when derivable: if the row has `lat/lng` and the pipeline already computes a tz (check existing helpers; if none, leave null — F-4 is accuracy-only, not a blocker, and may be deferred to the safety-net + longitude fallback). 🎨 OPEN: the implementor MAY populate `utc_offset_minutes` via an existing tz helper if one exists in the pipeline; if not, leaving it null is acceptable (the deck's longitude fallback covers it). Do NOT add a new external tz API for this ORCH.

COMMS-0018 guard: build on the reconciled `run-business-place-authoring-pipeline` (the WS7+scorer-fix version now on main, base `235593199`/PR #336). Read the worktree copy before editing; the change is additive (wrap the value), it does NOT touch the WS7/scorer paths.

### 4.3 Backfill migration — `supabase/migrations/20260905000000_orch_1068_normalize_business_hours.sql` (NEW) 🔒 LOCKED

Pure-SQL, idempotent, scoped. No function dependency on the Deno converter — re-implement the same conversion in SQL (single source of TRUTH is the contract in §4.1; the SQL must produce byte-equivalent output for the test rows).

Contract:
- Affects ONLY `WHERE business_author_brand_id IS NOT NULL AND jsonb_typeof(opening_hours) = 'array'`.
- For each affected row, build `opening_hours` = `{ "openNow": null, "periods": [...], "weekdayDescriptions": [...] }` where each non-`isClosed` array element with parseable `openTime`/`closeTime` becomes a period with `open.day = ((weekday + 1) % 7)`, `open.hour`/`open.minute` from `openTime`, `close.day = open.day` for same-day or `((weekday + 2) % 7)` for overnight, `close.hour`/`close.minute` from `closeTime`.
- Idempotent: re-running is a no-op because after the first run `jsonb_typeof(opening_hours)='object'` so the `WHERE` excludes them.
- Wrap in a transaction; `RAISE NOTICE` the affected row count.
- Header comment cites the Google `day` 0=Sunday doc URL (§3) and the COMMS-0002 allowlist note.

C7 allowlist (COMMS-0002): add `supabase/migrations/20260905000000_orch_1068_normalize_business_hours.sql` AND `supabase/functions/_shared/businessHoursToGoogle.ts` (+ its `__tests__` file) to a new `ORCH_1068_BACKEND_ALLOWLIST` block in `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` in the SAME commit as the migration.

### 4.4 Defensive reader — `discover-cards/index.ts` 🔒 LOCKED

In `hasOpeningData`, `isOpenAtHour` (Path B), and `isOpenAnyTimeOnDay` (Path B), BEFORE the existing `.periods` checks, add a branch:
```ts
// ORCH-1068: business-authored venues may store hours as a top-level array
// [{weekday(0=Mon),isClosed,openTime,closeTime}]. Normalize-at-write fixes new rows,
// but read defensively so a stray array never silently excludes a servable venue.
if (Array.isArray(oh)) {
  const google = businessHoursToGoogleOpeningHours(oh as any);
  // evaluate against google.periods using the SAME evalPeriods logic
}
```
- Import the converter from `_shared/businessHoursToGoogle.ts`.
- `hasOpeningData(array with ≥1 open row)` → true.
- `isOpenAtHour(array, day, hourFrac)` → evaluate `google.periods` via the existing `evalPeriods` (NOTE: `day` here is the JS/Google 0=Sunday index, and the converter already produced Google-day periods, so the comparison is correct).
- `isOpenAnyTimeOnDay(array, day)` → any period with `open.day === day`.
- An all-`isClosed` array → `hasOpeningData` false on those days, like Google "Closed".

### 4.5 Defensive reader — `_shared/curatedStopHours.ts` `isStopOpenAtHour` 🔒 LOCKED

Mirror §4.4: add the `Array.isArray(oh)` branch (after the `typeof oh !== 'object'` honest-unknown check, before the `.periods` branch) that converts via `businessHoursToGoogleOpeningHours` and evaluates with the module's `evalPeriods`. Preserves the honest-unknown→OPEN rule for genuinely empty data; an array with explicit closed days correctly returns false on those days.

### 4.6 Hero picker — `discover-cards/index.ts transformServablePlaceToCard` 🔒 LOCKED

Replace `image: storedPhotos[0] ?? null` with the first non-video url:
```ts
const VIDEO_EXT = /\.(mp4|mov|webm|m4v)(\?|$)/i;
const isVideoUrl = (u: string) => VIDEO_EXT.test(u) || /\/video\/upload\//.test(u);
const heroImage = storedPhotos.find((u: string) => typeof u === 'string' && !isVideoUrl(u)) ?? null;
// ...
image: heroImage,
images: storedPhotos,   // full list unchanged (video stays available for future player)
```
🎨 OPEN: the implementor MAY also expose a `coverVideo` field (first video url) for a future deck cover-video player, but MUST NOT wire any player this ORCH. `images` keeps the full ordered list.

### 4.7 Cross-Surface Impact (Phase 2.5 — MANDATORY)

| Surface | Covered? | Behaviour demanded | Files | Parity |
|---|---|---|---|---|
| **Consumer iOS** (`app-mobile/`) | YES | Lantern & Vine renders on the Drinks deck during 07:00–20:00 local with its real photo hero (not stock fallback). | none in app-mobile (server-side fix; `SwipeableCards.tsx` unchanged — it already renders whatever `image` it's given) | automatic (shared deck response) |
| **Consumer Android** (`app-mobile/`) | YES | Same as iOS. | none | automatic — single SC covers both (shared RN code + shared edge response) |
| **Buyer/anon Web** | NO | "buyer-web has no vibe deck" | — | — |
| **Business iOS/Android** (`mingla-business/`) | NO | "authoring UI unchanged; the wizard still writes the array — the pipeline normalizes on write" | — | — |
| **Admin Web** | NO | "admin doesn't render the consumer deck; ORCH-1066 preview reads scores, not hours" | — | — |
| **Business Web preview** | NO | "no consumer deck on business web" | — | — |

Parity is automatic across iOS/Android because the fix is entirely in the edge response + DB shape; the RN card consumes the same `image`/`openingHours` payload identically. No manual per-platform success criteria needed — but TEST MUST still verify on BOTH sims (SC-ACCEPT).

---

## 5. Success Criteria (observable, testable, unambiguous)

- **SC-1 (converter):** `businessHoursToGoogleOpeningHours([{weekday:0,isClosed:false,openTime:"07:00",closeTime:"20:00"}])` returns `{openNow:null, periods:[{open:{day:1,hour:7,minute:0},close:{day:1,hour:20,minute:0}}], weekdayDescriptions:[…7…]}` — note `day:1` (Monday in Google) from `weekday:0` (Monday in business).
- **SC-2 (weekday translation):** a row `{weekday:6,…}` (Sunday business) maps to Google `day:0` (Sunday). Proven by unit test over all 7 weekdays.
- **SC-3 (overnight):** `{weekday:4,openTime:"18:00",closeTime:"02:00"}` (Friday business → Google day 5) → one period `open:{day:5,hour:18}`, `close:{day:6,hour:2}`.
- **SC-4 (normalize-at-write):** after authoring a new business venue with array hours, the persisted `place_pool.opening_hours` has `jsonb_typeof = 'object'` with a `periods` array (verified by DB probe).
- **SC-5 (backfill):** after the migration, all `business_author_brand_id IS NOT NULL` rows have `jsonb_typeof(opening_hours) IN ('object','null')` — zero array-shaped business rows remain. Re-running the migration changes 0 rows (idempotent).
- **SC-6 (discover-cards include):** `hasOpeningData` returns true and `filterByDateTime([Lantern], undefined, 'today')` (probed at a local hour within 07:00–20:00) KEEPS Lantern; the deck response for the Drinks chip in Raleigh CONTAINS `place_id = 8b720912-…`.
- **SC-7 (closed-correctly, adversarial):** a business venue closed RIGHT NOW (probe at a local hour outside its hours, e.g. 23:00 for a 07:00–20:00 venue) is correctly EXCLUDED by `filterByDateTime`. The filter still works — it doesn't blanket-pass business rows.
- **SC-8 (Google unaffected, adversarial):** a Google-seeded venue with the `{periods}` object shape behaves identically before and after this change (no regression in include/exclude for any Google row). Proven by a fails-on-revert test over a Google-shape fixture.
- **SC-9 (hero):** the deck card for Lantern has `image` = the first `.jpg` (`…/gallery/mpvfz1bobnl59k.jpg`), NOT the leading `.mp4`; `images` still contains all 7 urls in order.
- **SC-10 (defensive reader):** with the migration NOT yet applied (simulated by feeding an array directly), `discover-cards hasOpeningData(array)` returns true — the safety net works even on un-normalized data.
- **SC-ACCEPT (sim, MANDATORY at TEST):** on the iPhone 17 Pro sim (and Android emulator) with the deployed edge fns + applied migration, selecting the **Drinks & Music** chip in Raleigh during Lantern's open hours, Lantern & Vine appears as a swipe card with its real photo hero. Captured via screenshot/recording. This is the close gate.

---

## 6. Invariants

| ID | Statement | Preserved by | Verified by |
|---|---|---|---|
| **I-1068-BUSINESS-HOURS-CANONICAL-GOOGLE-SHAPE** (NEW, propose ACTIVE on close) | `place_pool.opening_hours` for business-authored rows is stored in the canonical Google v1 `{periods,…}` object shape (never a raw business array). | normalize-at-write (§4.2) + backfill (§4.3) | SC-4, SC-5 |
| **I-1068-DECK-HERO-IS-IMAGE** (NEW) | The deck card `image` (still hero) is always an image url, never a video; videos live only in `images`/future cover-video. | §4.6 | SC-9 |
| **Constitution #13 (exclusion consistency)** | generation and serving apply the SAME open-hours rule; both now read one canonical shape (+ the defensive array branch is identical in both readers). | §4.4 + §4.5 share `businessHoursToGoogleOpeningHours` | SC-6, SC-7, T-defensive |
| **Constitution #9 (no fabrication)** | a venue we DO have a photo for shows that photo, not a misleading stock fallback. | §4.6 | SC-9 |
| **Constitution #12 (validate at right time)** | `openNow` is never baked into stored data; computed per user tz at serve. | §4.1 `openNow:null` | SC-1 |
| **I-DECK-CARD-CONTRACT-DISTANCE-AND-TIME** (existing) | unchanged — fix does not touch distance/travel. | no edit to those fields | regression (existing tests) |

---

## 7. Test Cases

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-01 | converter Monday | `[{weekday:0,isClosed:false,openTime:"07:00",closeTime:"20:00"}]` | period `open.day=1` | unit (Deno) |
| T-02 | converter Sunday | `{weekday:6,…}` | `open.day=0` | unit |
| T-03 | converter overnight | `{weekday:4,open:"18:00",close:"02:00"}` | `open.day=5,close.day=6,close.hour=2` | unit |
| T-04 | converter closed row | `{weekday:2,isClosed:true}` | no period for that day | unit |
| T-05 | isBusinessHoursArray guard | `{periods:[…]}` (object) | false (pass-through, not converted) | unit |
| T-06 (happy) | discover-cards include open business venue | Lantern array (post-convert) @ local 14:00 | `hasOpeningData=true`, kept by `filterByDateTime('today')` | edge logic |
| T-07 (adversarial-closed) | discover-cards exclude closed business venue | Lantern @ local 23:00 | dropped by `filterByDateTime('today')` | edge logic |
| T-08 (adversarial-google) | Google-shape row unaffected | `{periods:[{open:{day:1,hour:9},close:{day:1,hour:17}}]}` @ Mon 10:00 vs 20:00 | kept / dropped exactly as before | edge logic, fails-on-revert |
| T-09 | defensive reader on raw array | array fed directly (un-normalized) | `hasOpeningData=true` | edge logic |
| T-10 | curated reader array branch | curated stop with array hours, open | `isStopOpenAtHour=true`; closed-day → false | `_shared/curatedStopHours` |
| T-11 | hero picker skips video | `["…/video/upload/x.mp4","…/gallery/y.jpg"]` | `image="…/y.jpg"`, `images=[both]` | transformer |
| T-12 (backfill) | migration idempotent + scoped | run twice on a copy | 1st run converts 2 servable rows (+1 processing); 2nd run 0 rows; Google rows untouched | migration (read-only verify on remote; apply by Seth) |
| T-13 (regression) | fails-on-revert | revert §4.4 array branch | T-06 fails (proves the branch is load-bearing) | edge logic |
| T-ACCEPT | sim | iPhone 17 Pro + Android emu, Drinks chip Raleigh, open hours | Lantern renders w/ real hero | live-fire |

Step 0.5 satisfied: happy = T-06 (open business venue passes the filter + renders); adversarial = T-07 (closed business venue still excluded) + T-08 (Google venue unregressed).

---

## 8. Implementation Order

1. `supabase/functions/_shared/businessHoursToGoogle.ts` (converter) + `__tests__` (T-01..T-05, T-11 helper).
2. `discover-cards/index.ts` — defensive array branch in `hasOpeningData`/`isOpenAtHour`/`isOpenAnyTimeOnDay` (§4.4) + hero picker (§4.6) + import the converter.
3. `_shared/curatedStopHours.ts` — array branch in `isStopOpenAtHour` (§4.5).
4. `run-business-place-authoring-pipeline/index.ts` — `normalizeBusinessHoursForPool` wrap at both write sites (§4.2).
5. `supabase/migrations/20260905000000_orch_1068_normalize_business_hours.sql` (backfill, §4.3).
6. `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` — `ORCH_1068_BACKEND_ALLOWLIST` (migration + converter + its test) in the SAME commit as step 5.
7. Deno tests (T-01..T-11, T-13) + run full strict-grep gate locally (exit 0, C7 OK).

**Edge functions to redeploy from main at CLOSE (orchestrator-owned):** `discover-cards`, `run-business-place-authoring-pipeline`, `generate-curated-experiences` (the last imports `_shared/curatedStopHours.ts`). Migration applied by Seth via `supabase db push` BEFORE the edge deploy + sim acceptance.

---

## 9. Regression Prevention

- **Structural:** `I-1068-BUSINESS-HOURS-CANONICAL-GOOGLE-SHAPE` invariant + the converter as the single conversion authority. The defensive reader branch means even if a future write path forgets to normalize, the deck still serves the venue (no silent exclusion).
- **Test:** T-13 fails-on-revert proves the array branch is load-bearing; T-08 fails-on-revert proves Google rows are untouched; T-12 proves the backfill is idempotent + scoped.
- **Comment:** each touched reader carries an `ORCH-1068` comment explaining the two-shape reality and pointing at the converter, so the next editor doesn't re-introduce a Google-only assumption.

---

## 10. Open Questions (need operator steering)

- **OQ-1 (utc_offset_minutes, F-4):** populate `utc_offset_minutes` at authoring from a tz lookup, or accept the longitude fallback for now? **Recommend:** accept the longitude fallback this ORCH (the blocker is hours-shape, not tz; adding a tz API is scope creep). Leave `utc_offset_minutes` null; revisit if DST-edge mis-renders surface. — No blocker either way.
- **OQ-2 (deck cover-video, F-5 / D-3):** ship just the image-hero now (recommended), with a future ORCH for an autoplaying deck cover-video gated per the unified cover-picker memory note? **Recommend:** yes — image-hero now, video-player later. Already reflected in §4.6 (image only).

Neither OQ blocks IMPLEMENT; both have a recommended default the implementor can take if Seth doesn't redirect.
