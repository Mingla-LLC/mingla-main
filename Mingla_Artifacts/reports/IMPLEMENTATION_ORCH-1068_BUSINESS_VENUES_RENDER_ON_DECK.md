# IMPLEMENTATION — ORCH-1068 [business-authored venues render on the consumer deck]

**Skill:** mingla-implementor (Claude) · **Date:** 2026-06-03
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1068-[business-venues-render-on-deck]/` on branch `ORCH-1068-business-venues-render-on-deck`
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1068_BUSINESS_VENUES_RENDER_ON_DECK.md`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1068_BUSINESS_VENUES_RENDER_ON_DECK.md`
**Status:** implemented and verified (Deno tests + live-data backfill probe; sim acceptance SC-ACCEPT deferred to TEST per SPEC).
**Comms acked:** COMMS-0002 (C7 backend allowlist in same commit), COMMS-0003 (provider docs cited inline), COMMS-0018 (built additively on the reconciled `run-business-place-authoring-pipeline`; WS7/scorer paths untouched).

---

## 1. What changed (per-file Old → New receipts)

### `supabase/functions/_shared/businessHoursToGoogle.ts` (NEW) — commit `431f35ccc`
- **Before:** did not exist.
- **Now:** pure converter. `businessHoursToGoogleOpeningHours(rows)` maps the business array `[{weekday(0=Mon),isClosed,openTime,closeTime}]` → Google v1 `{openNow:null, periods:[{open:{day,hour,minute},close:{…}}], weekdayDescriptions[7]}`. Exports `businessWeekdayToGoogleDay` (`day=(weekday+1)%7`), `parseHm` ("HH:MM[:SS]"→{hour,minute}|null), `isBusinessHoursArray` (type guard; Google object → false), and `normalizeBusinessHoursForPool` (null→null, array→convert, Google-object→pass-through, other→null).
- **Why:** SC-1/2/3, F-1/F-2 — single conversion authority used by the pipeline normalize and the defensive readers.
- **Lines:** ~210 new.

### `supabase/functions/discover-cards/index.ts` — commit `cf2449a98`
- **Before:** `isOpenAtHour`/`hasOpeningData`/`isOpenAnyTimeOnDay` read only `oh.periods`/`oh._periods`/lowercase-day text → a top-level array satisfied none → business venue treated as "no hours" → EXCLUDED. `transformServablePlaceToCard` set `image: storedPhotos[0]` (a Cloudinary `.mp4` for business venues → broken/stock hero).
- **Now:** all three readers gain an `isBusinessHoursArray(oh)` branch (before the `.periods` checks) that converts to Google-day periods and evaluates via the existing `evalPeriods`. Hero picker sets `image` to the first NON-video url (`VIDEO_EXT` = `.mp4|.mov|.webm|.m4v` or `/video/upload/`), keeping the full ordered list in `images`. Imports `businessHoursToGoogleOpeningHours`, `isBusinessHoursArray`.
- **Why:** SC-6/7/9/10, F-1/F-5. Defensive net so a stray array is never silently excluded.
- **Lines:** ~30 changed.

### `supabase/functions/_shared/curatedStopHours.ts` — commit `e415a087b`
- **Before:** `isStopOpenAtHour` read `.periods`/`_periods`/text; an array fell through to honest-unknown → OPEN on every day (wrong for explicit closed days).
- **Now:** array branch added after the honest-unknown `typeof` guard, before `.periods`: converts via `businessHoursToGoogleOpeningHours` then `evalPeriods`. Explicit closed day → false; genuinely-empty hours unchanged (still honest-unknown for non-array shapes).
- **Why:** SC-ACCEPT parity / Constitution #13 (generation + serving read one shape), T-10/T-13.
- **Lines:** ~12 changed.

### `supabase/functions/run-business-place-authoring-pipeline/index.ts` — commit `8a884cf92`
- **Before:** both `place_pool` write sites stored `opening_hours: draft.hours ?? draft.openingHours ?? null` verbatim (the raw array, no weekday translation).
- **Now:** both sites wrap with `normalizeBusinessHoursForPool(draft.hours ?? draft.openingHours)` → authored/edited business venues persist the Google `{periods}` object. `utc_offset_minutes` left null per OQ-1 recommended default (longitude fallback covers it; no new tz API added). Additive on the reconciled WS7/scorer source (COMMS-0018) — WS7/scorer paths untouched.
- **Why:** SC-4, F-1. Normalize-at-write fixes the class for all consumer readers.
- **Lines:** ~6 changed (+ import).

### `supabase/migrations/20260905000000_orch_1068_normalize_business_hours.sql` (NEW) — commit `0f37ae88c`
- **Before:** did not exist.
- **Now:** idempotent, scoped backfill. A `pg_temp` SQL converter mirrors the TS converter (`(weekday+1)%7`, overnight `close.day` roll, `isClosed`/unparseable skip, `openNow:null`). Updates only `WHERE business_author_brand_id IS NOT NULL AND jsonb_typeof(opening_hours)='array'`. Re-run is a no-op (post-conversion rows are `jsonb_typeof='object'`). `RAISE NOTICE` of affected count. Version `20260905000000` strictly > remote max `20260904000000` and free across sibling worktrees.
- **Why:** SC-5, F-1. Converts the 3 existing array rows.

### `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` — commit `0f37ae88c` (same as migration, COMMS-0002)
- **Before:** no ORCH-1068 entry; C7 `no-new-backend-files` would flag all 6 new/modified backend files.
- **Now:** `ORCH_1068_BACKEND_ALLOWLIST` (migration + converter + converter test + the 3 modified edge fns) added and spread into `ALLOWLIST`. Full gate run exits 0, C7 OK.
- **Lines:** ~20 added.

---

## 2. EXACT migration SQL for the orchestrator (apply via Management API)

> CLI `db push` is drift-blocked, so the orchestrator applies this via the Supabase Management API. Version is `20260905000000`. The file is `supabase/migrations/20260905000000_orch_1068_normalize_business_hours.sql`. Full verbatim SQL:

```sql
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.orch_1068_business_hours_to_google(p_arr jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
DECLARE
  v_row          jsonb;
  v_weekday      int;
  v_google_day   int;
  v_close_day    int;
  v_open_txt     text;
  v_close_txt    text;
  v_open_h       int;
  v_open_m       int;
  v_close_h      int;
  v_close_m      int;
  v_periods      jsonb := '[]'::jsonb;
  v_labels       text[] := ARRAY['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  v_descs        text[] := ARRAY['Monday: Closed','Tuesday: Closed','Wednesday: Closed','Thursday: Closed','Friday: Closed','Saturday: Closed','Sunday: Closed'];
  v_open_label   text;
  v_close_label  text;
  v_overnight    boolean;
BEGIN
  IF p_arr IS NULL OR jsonb_typeof(p_arr) <> 'array' THEN
    RETURN NULL;
  END IF;

  FOR v_row IN SELECT jsonb_array_elements(p_arr)
  LOOP
    IF jsonb_typeof(v_row) <> 'object' OR (v_row->>'weekday') IS NULL THEN
      CONTINUE;
    END IF;

    v_weekday := ((floor((v_row->>'weekday')::numeric)::int % 7) + 7) % 7;

    IF COALESCE((v_row->>'isClosed')::boolean, false) THEN
      CONTINUE;
    END IF;

    v_open_txt  := v_row->>'openTime';
    v_close_txt := v_row->>'closeTime';

    IF v_open_txt  !~ '^[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?$' THEN CONTINUE; END IF;
    IF v_close_txt !~ '^[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?$' THEN CONTINUE; END IF;

    v_open_h  := split_part(v_open_txt,  ':', 1)::int;
    v_open_m  := split_part(v_open_txt,  ':', 2)::int;
    v_close_h := split_part(v_close_txt, ':', 1)::int;
    v_close_m := split_part(v_close_txt, ':', 2)::int;

    IF v_open_h  < 0 OR v_open_h  > 23 OR v_open_m  < 0 OR v_open_m  > 59 THEN CONTINUE; END IF;
    IF v_close_h < 0 OR v_close_h > 23 OR v_close_m < 0 OR v_close_m > 59 THEN CONTINUE; END IF;

    v_google_day := (v_weekday + 1) % 7;
    v_overnight  := (v_close_h * 60 + v_close_m) <= (v_open_h * 60 + v_open_m);
    v_close_day  := CASE WHEN v_overnight THEN (v_google_day + 1) % 7 ELSE v_google_day END;

    v_periods := v_periods || jsonb_build_object(
      'open',  jsonb_build_object('day', v_google_day, 'hour', v_open_h,  'minute', v_open_m),
      'close', jsonb_build_object('day', v_close_day,  'hour', v_close_h, 'minute', v_close_m)
    );

    v_open_label := to_char(make_time(v_open_h, v_open_m, 0), 'FMHH12') || ':'
      || to_char(v_open_m, 'FM00') || (CASE WHEN v_open_h < 12 THEN ' AM' ELSE ' PM' END);
    v_close_label := to_char(make_time(v_close_h, v_close_m, 0), 'FMHH12') || ':'
      || to_char(v_close_m, 'FM00') || (CASE WHEN v_close_h < 12 THEN ' AM' ELSE ' PM' END);
    v_descs[v_weekday + 1] := v_labels[v_weekday + 1] || ': ' || v_open_label || ' – ' || v_close_label;
  END LOOP;

  RETURN jsonb_build_object(
    'openNow', NULL,
    'periods', v_periods,
    'weekdayDescriptions', to_jsonb(v_descs)
  );
END;
$fn$;

DO $do$
DECLARE
  v_count int;
BEGIN
  WITH updated AS (
    UPDATE place_pool
    SET opening_hours = pg_temp.orch_1068_business_hours_to_google(opening_hours)
    WHERE business_author_brand_id IS NOT NULL
      AND jsonb_typeof(opening_hours) = 'array'
    RETURNING id
  )
  SELECT count(*) INTO v_count FROM updated;

  RAISE NOTICE 'ORCH-1068 backfill: normalized % business-authored opening_hours array row(s) to Google {periods} shape.', v_count;
END;
$do$;

COMMIT;
```

> The full file header (cited docs URLs, COMMS notes, version rationale) is in the migration file; the executable body above is byte-equivalent to it.

**Live-data probe (read-only, pre-apply) confirms correctness for all 3 existing rows:**
- Lantern & Vine: 7 array rows → 7 periods, every day 07:00–20:00, Google days 1–6,0. ✅
- Lumen Wine Bar: 7 array rows (Sun isClosed) → 6 periods, Mon–Sat days 1–6 09:00–17:00 (Sunday correctly skipped). ✅
- The Tuscanny Place: 7 array rows (Sun isClosed) → 6 periods, Mon(day1) 02:00–21:00, Tue 09:00–21:00, Wed–Sat 09:00–17:00 (Sunday skipped). ✅
- Scope probe: `business_array_rows_to_convert=3`, `business_rows_total=3`, `google_rows_with_array=0` → **all 3 existing business rows are covered; zero Google rows touched.**

---

## 3. Edge functions to REDEPLOY from main (orchestrator-owned, after merge + db push)

```bash
supabase functions deploy discover-cards --project-ref gqnoajqerqhnvulmnyvv
supabase functions deploy run-business-place-authoring-pipeline --project-ref gqnoajqerqhnvulmnyvv
supabase functions deploy generate-curated-experiences --project-ref gqnoajqerqhnvulmnyvv
```

- `discover-cards` — defensive reader + hero picker (direct change).
- `run-business-place-authoring-pipeline` — normalize-at-write (direct change).
- `generate-curated-experiences` — imports `_shared/curatedStopHours.ts` (transitive change; redeploy to pick up the array branch).

`verify_jwt` is unchanged on all touched functions (no edit to their auth config). Sequencing: db push (migration) BEFORE the edge redeploy + SC-ACCEPT sim test.

---

## 4. Image-hero picker logic

```ts
const VIDEO_EXT = /\.(mp4|mov|webm|m4v)(\?|$)/i;
const isVideoUrl = (u: string): boolean => VIDEO_EXT.test(u) || /\/video\/upload\//.test(u);
const heroImage: string | null =
  storedPhotos.find((u: unknown) => typeof u === 'string' && !isVideoUrl(u)) ?? null;
// card.image = heroImage   (first non-video url; null → deck stock fallback, honestly)
// card.images = storedPhotos  (full ordered list unchanged; cover-video stays available)
```
Skips both extension-based (`.mp4` etc.) and Cloudinary path-based (`/video/upload/`) video URLs. For Lantern, `storedPhotos[0]` is a `/video/upload/…mp4` so the hero becomes the first `.jpg` (SC-9).

---

## 5. Tests + fails-on-revert

**Test file:** `supabase/functions/_shared/__tests__/businessHoursToGoogle.test.ts` (13 tests: T-01…T-11, T-13 + a parseHm helper test).
**Run:** `cd supabase && deno test --allow-read functions/_shared/__tests__/businessHoursToGoogle.test.ts` → **13 passed | 0 failed**.
**Lint:** `deno lint` clean on the converter and the test. `deno check` clean on the converter, curatedStopHours, discover-cards, and the pipeline.

**Fails-on-revert (captured):** removing the ORCH-1068 `isBusinessHoursArray` branch from the real `_shared/curatedStopHours.ts isStopOpenAtHour` makes a closed-Sunday business array fall through to honest-unknown→OPEN, so **T-10 and T-13 FAIL** (`11 passed | 2 failed`). Restoring the branch returns **13 passed | 0 failed**. Fix-present commit hash: `9e3aebcce` (test) on top of `e415a087b` (L3 array branch). The revert proof targets the L3 production change; the branch is load-bearing.

| Test | SC | Result |
|---|---|---|
| T-01 Monday weekday0→day1 | SC-1 | PASS |
| T-02 all 7 weekday→day | SC-2 | PASS |
| T-03 overnight close.day roll | SC-3 | PASS |
| T-04 closed row → no period | SC-1 | PASS |
| T-05 isBusinessHoursArray guard | §4.1 | PASS |
| T-06 open venue kept @14:00 | SC-6 | PASS |
| T-07 closed venue excluded @23:00 + closed-day | SC-7 | PASS |
| T-08 Google {periods} unaffected | SC-8 | PASS |
| T-09 defensive reader on raw array | SC-10 | PASS |
| T-10 curated array branch (real module) | §4.5 | PASS (fails-on-revert) |
| T-11 hero picker skips video | SC-9 | PASS |
| T-13 fails-on-revert closed-Sunday curated | §9 | PASS (fails-on-revert) |
| T-12 backfill scoped+idempotent | SC-5 | VERIFIED via live read-only probe (3 rows convert; 0 Google touched; re-run no-op by jsonb_typeof guard) |
| T-ACCEPT sim | SC-ACCEPT | DEFERRED to TEST (per SPEC §5) |

---

## 6. Spec traceability / success criteria

| SC | Status | Evidence |
|---|---|---|
| SC-1 converter Monday | PASS | T-01 |
| SC-2 weekday translation | PASS | T-02 + live probe (Sun→day0) |
| SC-3 overnight | PASS | T-03 |
| SC-4 normalize-at-write | IMPLEMENTED | both write sites wrapped; runtime-verifiable at TEST by authoring a venue + DB probe (`jsonb_typeof='object'`) |
| SC-5 backfill scoped+idempotent | VERIFIED | live probe: 3 rows convert, 0 Google touched, `jsonb_typeof='array'` guard makes re-run a no-op |
| SC-6 discover-cards include | PASS | T-06 (logic) — sim include at SC-ACCEPT |
| SC-7 closed correctly excluded | PASS | T-07 |
| SC-8 Google unaffected | PASS | T-08 |
| SC-9 hero is image | PASS | T-11 |
| SC-10 defensive reader | PASS | T-09 |
| SC-ACCEPT sim | DEFERRED | TEST owns (iPhone 17 Pro + Android emu) |

---

## 7. Invariants

- **I-1068-BUSINESS-HOURS-CANONICAL-GOOGLE-SHAPE** (NEW) — preserved: normalize-at-write + backfill ensure business `opening_hours` is the Google object. Y.
- **I-1068-DECK-HERO-IS-IMAGE** (NEW) — preserved: hero picker skips video. Y.
- **Constitution #13** (exclusion consistency) — preserved: both readers share the one converter. Y.
- **Constitution #9** (no fabrication) — preserved: real photo shown, not stock. Y.
- **Constitution #12** (validate at right time) — preserved: `openNow:null`, computed downstream. Y.
- **I-DECK-CARD-CONTRACT-DISTANCE-AND-TIME** — untouched. Y.

## 8. Cross-surface impact
Consumer iOS + Android (automatic parity, shared edge response + RN card). Not buyer-web, not business-app UI, not admin (SPEC §4.7 table).

## 9. Parity / cache
Solo + collab deck both call `filterByDateTime` (covered). Curated solo + collab via `isStopOpenAtHour` (covered). No React Query key changes; server-side only.

## 10. Constitutional compliance
Quick-scan: #9 ✅ (real photo), #12 ✅ (openNow null), #13 ✅ (one shape). No silent catches. No `any` in production code (converter is fully typed; discover-cards retains its pre-existing `any[]` signatures untouched).

## 11. Discoveries for orchestrator
- D-2 (from investigation) reaffirmed: ORCH-1067 fixed the photo gate but the deck-surface outcome is delivered only by ORCH-1068.
- D-3: deck cover-VIDEO player still not built (image-hero only) — future ORCH candidate.
- `utc_offset_minutes` left null on business rows (OQ-1 recommended default); longitude fallback covers Raleigh. Revisit only if a DST-edge mis-render surfaces.

## 12. Commits (branch `ORCH-1068-business-venues-render-on-deck`)
- `431f35ccc` L1 converter + tests
- `cf2449a98` L2 discover-cards reader + hero
- `e415a087b` L3 curatedStopHours array branch
- `8a884cf92` L4 pipeline normalize
- `0f37ae88c` L5 migration + ORCH_1068 allowlist (COMMS-0002, same commit)
- `9e3aebcce` L1b lint-clean test

Full strict-grep gate: **All checks PASS** (C7 OK, 10 files changed). Not pushed, no PR, no deploy, no db push — per dispatch.
