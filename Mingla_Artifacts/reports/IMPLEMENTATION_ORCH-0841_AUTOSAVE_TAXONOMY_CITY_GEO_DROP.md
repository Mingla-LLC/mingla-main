# IMPLEMENTATION — ORCH-0841 [event creator autosave drops taxonomy + city + geo]

**Status:** completed
**Verification:** passed (unit-level; integration smoke deferred to tester)
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Base SHA at start of work:** `d3d67dd449a2e323ab5f2e7ebeb30cfd3683697d`
**Dispatch:** `Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0841_AUTOSAVE_TAXONOMY_CITY_GEO_DROP.md`

---

## 1 — Plain-English summary

In the mingla-business event creator, tapping a Party Type / Vibe Tag / Music Genre pill caused the pill to deselect about 700 ms later. Same bug class quietly cleared the `city` and `location_geo` (Google Places autocomplete) fields. The fix updates the autosave write payload to actually write these five fields to the top-level `events` row columns (post-ORCH-0824 the read mapper already expected them there), and extends the SELECT projection so autosave responses round-trip them back. The `theme.business_draft` JSONB mirror is preserved for the publish RPC.

## 2 — Files changed (Old → New receipts)

### `mingla-business/src/utils/serverDraftEventMapper.ts`
**What it did before:** `ServerDraftEventUpdate` interface omitted `party_types`, `vibe_tags`, `music_genres`, `city`, `location_geo`. `draftToServerUpdate` wrote the five taxonomy/location fields ONLY into the JSONB `theme.business_draft` mirror.
**What it does now:** Interface extended with the five columns (arrays NOT NULL per schema → typed as `string[]`; city + location_geo nullable). `draftToServerUpdate` writes each field to the corresponding top-level column on every autosave UPDATE. `location_geo` is serialized as the Postgres point literal `(lng,lat)` to match what the read mapper at lines 470–481 already parses. JSONB mirror left untouched (publish RPC still needs it).
**Why:** ORCH-0841 spec §4 changes 1+2+3. Eliminates the deselect-after-700ms bug while preserving publish-RPC contract.
**Lines changed:** ~25 added across the interface (lines 85–117) and `draftToServerUpdate` (lines 402–425).

### `mingla-business/src/services/eventDrafts.ts`
**What it did before:** `EVENT_DRAFT_SELECT` projection omitted the five new top-level columns. Every `fetchDraftById`, `fetchDraftsForBrand`, `createServerDraft`, and `autosaveServerDraft` response was missing `party_types`, `vibe_tags`, `music_genres`, `city`, `location_geo` — and the post-ORCH-0824 read mapper falls back to `[]` / `null` when they are missing.
**What it does now:** Five columns appended to the SELECT string with a comment explaining the post-ORCH-0824 read-side contract.
**Why:** ORCH-0841 spec §4 change 1. Necessary read-side half of the round-trip; without it, even with the write fix, the autosave response would still strip them in transit.
**Lines changed:** ~4 (string literal + comment).

### `mingla-business/src/services/__tests__/eventDraftsTaxonomyAutosave.test.ts` (NEW)
**What it does:** Regression test, 3 cases:
1. UPDATE payload includes `party_types`, `vibe_tags`, `music_genres`, `city`, `location_geo` with the correct values when a draft has selections.
2. `EVENT_DRAFT_SELECT` source string contains all five column names (asserts via filesystem read + regex — guards the read-side half).
3. Empty taxonomy + null geo write as `[]` and `null` (not `undefined`), respecting the NOT NULL ARRAY schema.
**Why:** Step 0.5 CLOSE gate (per ORCH-0840). Test 2 needed strengthening from a naive round-trip assertion (which passed regardless of fix) to a source-text assertion that genuinely fails on revert.

## 3 — Spec traceability

| Spec criterion | Status | Verification |
|---|---|---|
| `draftToServerUpdate` writes 5 top-level columns | PASS | Test case 1 + 3, source diff |
| `EVENT_DRAFT_SELECT` fetches 5 top-level columns | PASS | Test case 2 |
| `ServerDraftEventUpdate` type extended | PASS | Source diff + typecheck (no new errors) |
| `theme.business_draft` mirror preserved | PASS | `mergeBusinessDraftTheme` untouched; publish RPC contract intact |
| `location_geo` written as Postgres point literal `(lng,lat)` | PASS | Test case 1 asserts `"(-0.1278,51.5074)"` exactly |
| Empty arrays written as `[]` (NOT NULL constraint) | PASS | Test case 3 |
| Non-scope NOT touched (toggle handlers, store, publish RPC, RLS) | PASS | Diff scoped to 2 source files + 1 test |

## 4 — Regression test (Step 0.5 mandatory)

**Test path:** `mingla-business/src/services/__tests__/eventDraftsTaxonomyAutosave.test.ts`

**Passing run (with fix applied, current HEAD diff):**
```
PASS src/services/__tests__/eventDraftsTaxonomyAutosave.test.ts (5.954 s)
  ORCH-0841 — event draft autosave persists taxonomy + city + geo
    ✓ UPDATE payload includes top-level party_types/vibe_tags/music_genres/city/location_geo (8 ms)
    ✓ autosave SELECT string fetches the five top-level columns (2 ms)
    ✓ empty taxonomy + null geo write as [] and null, not as undefined (1 ms)
Tests:       3 passed, 3 total
```

**Fails-on-revert verified at base SHA `d3d67dd449a2e323ab5f2e7ebeb30cfd3683697d`** (commit before this ORCH). Procedure: `git stash push -- mingla-business/src/utils/serverDraftEventMapper.ts mingla-business/src/services/eventDrafts.ts` reverts both source files to the base SHA's contents (test file remains current). Re-running the suite:

```
FAIL src/services/__tests__/eventDraftsTaxonomyAutosave.test.ts
Tests:       3 failed, 3 total
```

All 3 tests fail — test 1 + 3 because `draftToServerUpdate` doesn't emit the new fields; test 2 because the SELECT projection lacks them. Stash restored via `git stash pop`; suite returns to 3/3 PASS. This proves the test actually exercises the bug rather than passing on both sides.

## 5 — Verification matrix

| Check | Status |
|---|---|
| New regression test passes on fix | PASS (3/3) |
| Same test fails on revert at base SHA | PASS (3/3 fail) |
| TypeScript: no NEW errors introduced by this fix | PASS (only pre-existing `category` literal errors in unrelated test files) |
| Adjacent currency / mapper test suites: no new regressions | PARTIAL — 3 adjacent suites fail due to pre-existing baseline errors (see Discoveries §11); none caused by this ORCH |
| Manual iOS simulator smoke (tap pill → autosave → pill stays) | UNVERIFIED — handed to tester (see §10) |
| Manual web smoke (Expo Web) | UNVERIFIED — handed to tester |

## 6 — Invariant preservation

| Invariant | Preserved? |
|---|---|
| I-CATEGORY-DERIVED-ON-DROP (place_pool) | Y — N/A; this ORCH touches events not place_pool |
| Zustand-no-server-snapshots (I-PROPOSED-J) | Y — store unchanged; payload+SELECT only |
| One owner per truth | Y — top-level columns are canonical post-ORCH-0824; JSONB mirror remains the publish RPC's input |
| No silent failures | Y — error paths in `autosaveServerDraft` unchanged |
| RN inline-style color rule | Y — no UI touched |

## 7 — Constitutional compliance

No principles touched. Pure data-mapping fix; no UI, no error handling, no auth, no currency, no analytics changes.

## 8 — Parity check

- **Solo / collab parity:** N/A. Event creator is single-user (mingla-business operator).
- **iOS / Android / Web parity:** Fix is in shared TS service code; all three platforms benefit from the same code path. Tester must smoke each platform.
- **mingla-business / app-mobile parity:** Bug is mingla-business-only. `app-mobile` does not have an event draft wizard.

## 9 — Cache safety

- React Query keys unchanged (`eventDraftKeys.detail`, `eventDraftKeys.list`).
- Cache invalidation paths in `useServerDraftAutosave.onSuccess` unchanged — the server-echoed row now carries the five fields, and `upsertServerDraft` writes the full draft into the cache as before. No stale-shape risk.
- Persisted Zustand draft shape unchanged (already had `partyTypes` / `vibeTags` / `musicGenres` / `city` / `locationGeo`).

## 10 — Regression surface (for tester)

Smoke these adjacent features:
1. **Step 1 Basics — Party Type / Vibe Tag / Music Genre pills** — tap, wait 2s, confirm stays selected; close + reopen draft, confirm persists.
2. **Step 1 Basics — City autocomplete** — pick a Google Places city, wait 2s for autosave, refresh, confirm city persists.
3. **Cover image / hue / format / name / description** — confirm none of these regressed (they share the same autosave round-trip).
4. **Publish flow** — publish a draft with selected taxonomy, confirm `events` row top-level columns match what was selected (publish RPC still reads JSONB mirror, but the autosave already wrote top-level — both paths must agree).
5. **Multi-date / recurring drafts** — confirm `multiDates` and `recurrence_rules` round-trip remains intact (they were never broken; this is a parity check).

## 11 — Discoveries for orchestrator

1. **Pre-existing baseline typecheck error in 6 test files** referencing the dropped `category` field on `DraftEvent` (post-ORCH-0824). Files: `eventDraftsCurrency.test.ts`, `businessEvents_master_date.test.ts`, `businessEventsPublish.test.ts`, `brandEventSummary.test.ts`, `draftEventPristine.test.ts`, `serverDraftEventMapper.test.ts`. Net effect: those suites fail to compile under Jest's ts-jest transform, masking any genuine regression those tests would catch. Recommend a small follow-up ORCH to mass-strip `category: null` from the fixtures.
2. **Pre-existing baseline failure in `serverDraftLifecycleGuards.test.ts`** — it source-matches a string `disableLocalSaveReason !== undefined && !isCoverMediaOnlyPatch(patch)` that no longer appears verbatim in current code. Unrelated to ORCH-0841. Recommend folding into the same follow-up.
3. **`createServerDraft` insert path NOT updated** — `ServerDraftEventInsert` + `draftToServerInsert` still omit the five top-level columns. This is in-scope-omitted per the dispatch (scope was Update + SELECT only). Safe today because new drafts are created with empty `partyTypes` / `vibeTags` / `musicGenres` / null city / null geo, and DB defaults handle the NOT NULL arrays (verified empirically — `events` table allows insert without the array columns). However, if any future codepath ever calls `createServerDraft` with a non-empty source draft (e.g., a "duplicate event" flow), it would lose taxonomy on the duplicate's first save. Recommend a follow-up ORCH if/when duplicate-event flows ship.
4. **`location_geo` Postgres point literal format** — confirmed via the existing `serverRowToDraft` parser at lines 470–481, which accepts both string `(lng,lat)` and object `{x,y}`. I emit the string form because that's how Postgres returns `point` columns in the standard text protocol Supabase uses. If a future Supabase JS client upgrade switches to a different serialization (e.g., GeoJSON), this string would need updating; the read parser would still work for both forms.

## 12 — Transition items

None. Fix is permanent.

## 13 — Gates run

| Gate | Status | Notes |
|---|---|---|
| Jest (new regression suite) | PASS | 3/3 |
| Jest (fails-on-revert proof) | PASS | 3/3 fail at base SHA |
| Jest (adjacent suites) | DIRTY BASELINE | Pre-existing failures, not caused by ORCH-0841 (see §11) |
| TypeScript `tsc --noEmit` (touched files) | PASS | No new errors introduced |
| Deno gate | N/A | No edge function touched |
| Strict-grep registry | N/A | No invariant pattern added/violated |
| ESLint | NOT RUN | No lint script invoked; touched code follows existing patterns verbatim |

## 14 — Deploy notes

- **No migration.** All five columns already exist on `events` per ORCH-0824 (verified via Supabase MCP `execute_sql` against `information_schema.columns`).
- **No edge function deploy.** No edge function touched.
- **No EAS Update needed at implementor stage.** Operator decides on OTA push after orchestrator CLOSE.

## 15 — Suggested commit message

```
ORCH-0841: persist event taxonomy + city + geo on autosave

draftToServerUpdate now writes party_types, vibe_tags, music_genres,
city, location_geo to the top-level events columns (canonical post
ORCH-0824). EVENT_DRAFT_SELECT fetches the same columns so the read
mapper sees them on every autosave round-trip. Adds regression test
suite with fails-on-revert proof at base SHA d3d67dd4. Fixes
deselect-after-700ms bug on Step 1 Basics pills and the silent loss
of city + Google Places geo selection.

Files:
- mingla-business/src/utils/serverDraftEventMapper.ts
- mingla-business/src/services/eventDrafts.ts
- mingla-business/src/services/__tests__/eventDraftsTaxonomyAutosave.test.ts (new)
```
