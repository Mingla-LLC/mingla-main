# IMPLEMENTATION — ORCH-1138 Leg 3 REWORK (experience page)

**Status:** implemented and verified (P0 anon-load proven live; P1/P2 gates green + fails-on-revert).
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1138-[experience-page]/` · branch `ORCH-1138-experience-page`
**New HEAD:** `21ad9c669` (rebased onto origin/main first — was 1 behind, no conflicts; pre-rebase `1e565cedd` → post-rebase base `386b4d7bd` → rework commit `21ad9c669`).
**Comms:** read `COMMS_LEDGER.md`. No OPEN BLOCK row for implementor/ORCH-1138/ALL. COMMS-0009 (RESOLVED, FYI) is the governing contract for this fix — anon `42501 permission denied for table brands`; theme must come from `business_public_events_view`, never a client `.from("brands")`. No new cross-ORCH discovery requiring a ledger write (the P0 is intra-ORCH).

---

## 1. Summary

The tester's FAIL on Leg-3 was correct: the rework added the three brand theme columns to a raw `.from("brands")` select, and the anon Postgres role cannot read them → every logged-out buyer hitting `/exp/{brandSlug}/{experienceSlug}` got HTTP 401 and a dead "Couldn't load experience" page (web + business iOS/Android, shared service). This rework sources the brand theme from the anon-safe `business_public_events_view` instead (exactly how the trip/event legs do it), removes the theme columns from both `.from("brands")` paths, and proves the anon page loads live. It also fixes the stale `A-EXP-4` test that would have gone red on merge, and tightens the open-daily detection so a fixed-start multi-date experience is no longer offered an arbitrary time grid.

---

## 2. SC / finding coverage

| Item | Verdict | Commit | Evidence |
|------|---------|--------|----------|
| P0-1 anon `/exp/` theme 401 | ✓ FIXED | `21ad9c669` | Brand theme now from `business_public_events_view` (`fetchBrandThemeFromView`); both resolvers; theme cols stripped from every `.from("brands")` select. Live anon: full chain HTTP 200, theme `#7c3aed`/`playfair_display`. Tester gate 4/4. |
| P1-1 stale A-EXP-4 | ✓ FIXED | `21ad9c669` | A-EXP-4 rewritten to assert route-based checkout (`experienceCheckoutPath` + `router.push`, eventDateId+quantity) and that `<ExperienceCheckoutFlow>` stays gone. `[TEST-MOD-APPROVED ORCH-1138]` in commit body + test comment. 8/8. |
| P2-2 open-daily heuristic | ✓ FIXED | `21ad9c669` | Rule extracted to pure `utils/experienceOpenDaily.ts` (single owner) + tightened: dense near-DAILY cadence (median gap ≤ ~1.5d) + ≥7 occ + wide windows. Regression test 6/6, fails-on-revert proven. |
| P2-1 BaseBottomSheet L103 | DEFERRED (P3) | — | Pre-existing on origin/main; not introduced by 1138; not widened. See §10. |
| P2-3 venue-path theme flash | DEFERRED (P3) | — | Cosmetic; `venueExperienceMapping` `events.theme` ≠ `resolveTheme` shape. See §10. |
| P3-1 supply test revert-sensitivity | NOTED | — | Tester could not reproduce minimal-revert on the intents field. See §10. |

---

## 3. Files changed (this rework)

| File | Change | Lines |
|------|--------|-------|
| `mingla-business/src/services/publicExperienceService.ts` | P0: theme via view; `mapBrand(b, theme)`; `fetchBrandThemeFromView`; theme cols removed from both brands selects | ~+45/-12 |
| `mingla-business/app/exp/__tests__/public-experience-page.test.ts` | P1: A-EXP-4 → route-based checkout assertion | +20/-3 |
| `app-mobile/src/screens/Experience/ConsumerExperienceDetailScreen.tsx` | P2: import `isOpenDailyModel` from util; inline heuristic removed | +3/-12 |
| `app-mobile/src/utils/experienceOpenDaily.ts` | P2: NEW pure single-owner heuristic | +77 |
| `app-mobile/src/utils/__tests__/orch_1138_open_daily_detection.test.ts` | P2: NEW regression test (6 cases) | +90 |
| `mingla-business/src/services/__tests__/orch_1138_tester_anon_brand_theme_columns.test.ts` | tester's adversarial test, committed on-branch | +58 |
| `Mingla_Artifacts/reports/TEST_ORCH-1138_LEG3_REWORK.md` | tester report, committed on-branch | +156 |

---

## 4. Data-model changes applied

None. No migration written, applied, or deployed. The fix uses the existing anon-safe `business_public_events_view` (security-definer, already live; verified anon HTTP 200).

---

## 5. Edge functions touched

None this rework. (Branch carries `discover-cards` changes from prior Leg-3 work; live version 345, **`verify_jwt=true`** — the deploy operator must preserve `verify_jwt=true`, not `false` as the original Leg-3 report stated. Flagged to orchestrator.)

---

## 6. Regression tests added

1. `app-mobile/src/utils/__tests__/orch_1138_open_daily_detection.test.ts` — 6 cases (genuine open-daily; the P2-2 fixed-start bug case; short-window; non-daily cadence; single occurrence; median helper). **6/6 pass.**
   - **fails-on-revert verified at `21ad9c669`:** reverting `isOpenDailyModel` to the old permissive body (`>1 occ + every window ≥90 min`, via true line replacement) → **2 failed** (fixed-start multi-date + 3-day-cadence cases flip to open-daily=true). Restored → **6/6 pass.**
2. Tester adversarial `orch_1138_tester_anon_brand_theme_columns.test.ts` — was RED pre-fix (3 failed); now **4/4** after the theme cols left the brands select.

Existing tests still green: supply 2/2, A-EXP 8/8, screen node tests 2/2.

---

## 7. Old → New receipts

### publicExperienceService.ts
- **Before:** both `getPublicExperienceBySlug` (`.from("brands").select(... theme_color, theme_font, theme_animation)`) and `getPublicExperienceById` (embedded `brands(... theme_*)`) requested the three theme columns off `brands`; `mapBrand(b)` read theme off the brands row. Anon → HTTP 401 → dead page.
- **Now:** brands selects carry only anon-readable cols (`id, slug, name, description, cover_media_url, cover_media_type, cover_hue`). New `fetchBrandThemeFromView(brandSlug, experienceSlug)` reads `brand_theme_*` from `business_public_events_view` (anon-safe), keyed to the experience row; `mapBrand(b, theme)` takes the resolved theme. Per-experience `theme_*_override` still read off the `events.*` select (anon-readable).
- **Why:** P0-1 / COMMS-0009 — anon has no column SELECT on `brands.theme_*`.
- **Lines:** ~57.

### public-experience-page.test.ts (A-EXP-4)
- **Before:** `expect(publicRouteSource).toMatch(/<ExperienceCheckoutFlow/)` — asserted a deleted in-page mount; would go red on merge.
- **Now:** asserts `experienceCheckoutPath(`, `router.push`, `eventDateId`, `quantity`, and `.not.toMatch(/<ExperienceCheckoutFlow/)`.
- **Why:** P1-1; route-based checkout replaced the in-page flow.
- **Lines:** 20 (`[TEST-MOD-APPROVED ORCH-1138]`).

### ConsumerExperienceDetailScreen.tsx + experienceOpenDaily.ts
- **Before:** module-private `isOpenDailyModel` = `>1 occ && every window ≥90 min` → false-positived discrete fixed-start multi-date experiences into the date→arbitrary-time picker.
- **Now:** rule lives in pure `utils/experienceOpenDaily.ts`; requires ≥7 occ + every window ≥90 min + near-daily median cadence (≤ ~1.5d). Screen imports the single owner.
- **Why:** P2-2 UX-honesty — never offer a fabricated time grid for a set-time experience.
- **Lines:** screen ~15; util +77.

---

## 8. Cross-surface impact

| Surface | Affected | Parity |
|---------|----------|--------|
| Buyer/anon Web `/exp/` | YES — page now LOADS for anon (was 401) | Shared service (automatic) |
| Business iOS `/exp/` | YES — same shared `publicExperienceService` | automatic |
| Business Android `/exp/` | YES — same | automatic |
| Consumer iOS (app-mobile) | YES — open-daily heuristic (P2-2) | shared RN |
| Consumer Android | YES — same (no platform-specific path) | shared RN |
| Admin Web | NO — no experience buyer page | — |
| Business Web preview (LEGACY Step-5) | NO — byte-stable; not touched | — |

---

## 9. Smoke / live verification

- **Live anon (prod anon key):** brands-without-theme → **HTTP 200**; brands-WITH-theme → **HTTP 401 `42501 permission denied`** (the P0, reproduced); `business_public_events_view` theme → **HTTP 200** `#7c3aed`/`playfair_display`; full bySlug resolver chain (brand + view theme + events + stops) → **all HTTP 200**.
- **Gates at `21ad9c669`:** tester adversarial 4/4 · A-EXP 8/8 · open-daily 6/6 (fails-on-revert proven) · supply 2/2 · screen node 2/2 · all 6 strict-grep PASS (incl. I-MOR-0827 mor-isolation + checkout-byte-identical) · tsc clean on touched files.

---

## 10. Known issues / deferred

- **P2-1 (P3, defer):** `BaseBottomSheet.test.mjs` L103 fails on origin/main (`animationConfigs`) — PRE-EXISTING, a different ORCH's scope. Not touched; not widened.
- **P2-3 (P3, defer):** venue→detail path lacks a synchronous theme fallback (`venueExperienceMapping.ts:170` `brandTheme: null`, documented shape mismatch) — cosmetic palette flash before `useEventTheme` settles. Deferred per dispatch; not trivial without a `events.theme → resolveTheme` mapper.
- **P3-1 (note):** the supply test's intents-field revert-sensitivity could not be independently reproduced by the tester; the test still passes on real fixture input and the renders-all-sections/foundation tests cover the same fields. Left as-is (append-only; strengthening is a separate, optional pass).
- **Edge deploy config (orchestrator):** `discover-cards` live `verify_jwt=true` — preserve at deploy (the original Leg-3 report's "false" is stale).

---

## 11. Operator action required

- **No migration `db push`** from this rework (none written).
- **Post-merge deploy (orchestrator/operator, from MERGED main):** apply `supabase/migrations/20261007000000_orch_1138_rework_deck_supply.sql` (consumer themed/intents-array/city/per-stop start_time) + deploy `discover-cards` with **`verify_jwt=true`** preserved. These were already pending from prior Leg-3 work; this rework did not change them.
- **Re-route to tester (RETEST):** re-render anon `/exp/` (must load + 6 web fixes + theme) and re-run the adversarial gate (green).

---

## 12. Discoveries for Orchestrator

1. The tester's adversarial regex (`/\.from\("brands"\)[\s\S]*?\.select\(/`) matches the literal string `.from("brands")` even inside CODE COMMENTS — my first-draft comment contained that literal and false-positived the gate. Reworded the comment. Worth promoting a hardened version of this gate to a standing strict-grep CI invariant (the tester suggested the same): NO anon/public service may select `brands.theme_*` directly — but the gate should scan only string-literal selects, not comments.
2. `anon` has column-scoped grants on `brands` (most cols readable; `theme_color/theme_font/theme_animation` NOT). Any future anon brand read must respect this; the canonical anon-safe theme source is `business_public_events_view.brand_theme_*`.
3. `discover-cards` live `verify_jwt=true` (not `false` as the original Leg-3 report claimed) — reconcile at deploy.
