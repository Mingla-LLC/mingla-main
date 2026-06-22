# IMPLEMENTATION — ORCH-1220 [Form pill multi-select + "All of it" select-all]

**Branch:** `1220-form-pill-multiselect-allpill` (off origin/main)
**Commit:** `3ee41f299fa697d0e13cb5f61dab055d1ade0c0c`
**Date:** 2026-06-22
**Scope:** Marketing-web + backend ONLY. No app changes, no `eas update`, no new npm deps.
**NOT done (per dispatch):** migration NOT applied to live DB, edge fn NOT deployed, PR NOT opened, NOT closed.

Fast-follow to ORCH-1219. Two product changes + the backend/gate work.

---

## 1. Fix 1 — Explorer "All of it" pill = SELECT-ALL

"All of it" was an independent toggle; it is now a **select-all control**.
- Tapping "All of it" when not everything is selected → selects ALL 5 values (`[places,events,trips,experiences,all]`).
- Tapping "All of it" when everything is selected → clears everything (`[]`).
- Individually selecting every specific pill auto-includes `'all'`; deselecting any specific pill removes `'all'`.
- Still multi-select, Next-gated (`interest.length >= 1`), NO auto-advance.

The logic was **extracted into a pure, React-free module** `mingla-marketing/lib/explorer-interest.ts` (exported `nextInterest`, `ALL_VALUE`, `SPECIFIC_INTERESTS`, `ALL_SELECTED`, `allSpecificSelected`) so it is unit-testable without importing framer-motion/React. The modal imports it, delegates its chip handler (`setInterest((prev) => nextInterest(prev, value))`), and derives the "All of it" chip's selected state from `SPECIFIC_INTERESTS.every(...)`. No schema change (`interest` is already `text[]` incl. `'all'` from ORCH-1219).

## 2. Fix 2 — Organiser brand-type = MULTI-SELECT

`beta-access-modal.tsx` brand-type step: single-select → multi-select (mirrors ORCH-1219 explorer treatment).
- `brandType`: `useState('')` → `useState<string[]>([])`; chips are now a toggle group (`role="group"` + `aria-pressed`, NOT radiogroup/radio); `step1Valid = brandType.length >= 1`; no auto-advance (already removed in 1219). Copy updated to "Pick all that fit — you can choose more than one."
- Transport `beta-access-submit.ts`: `BetaAccessLeadInput.brandType` `string` → `string[]`.
- Edge fn `beta-access-lead-submit/index.ts`: `validateLead` now validates `brandType` as a **non-empty array of allowed values** (rejects non-array, empty, non-string element, or any element outside the 7-value allow-set → 400), de-dupes preserving order; `ValidatedLead.brand_type: string[]`; insert sends the array; `buildNotifyEmail` renders all types comma-joined in the subject + body ("Business type(s)").
- Migration `20261126000000_orch_1220_beta_access_brand_type_multi.sql`: `beta_access_leads.brand_type text → text[]`, preserving the 1 real prod lead via `using array[brand_type]`; drops the scalar CHECK by array-operator absence (the proven ORCH-1219 pattern — `brand_type IN (…)` renders as `= ANY(ARRAY…)`, so it filters CHECKs referencing `brand_type` that lack `<@`/`cardinality`/`array_length`); adds array CHECK `cardinality(brand_type) >= 1 AND brand_type <@ array[7 enum values]`; re-creates `admin_beta_leads_list()` to return `brand_type text[]`. Idempotent/guard-safe.

---

## 2. Files changed

| File | Purpose |
|---|---|
| `mingla-marketing/lib/explorer-interest.ts` | **NEW** — pure `nextInterest` select-all reducer + constants (Fix 1, unit-testable). |
| `mingla-marketing/lib/explorer-interest.test.ts` | **NEW** — implementor happy-path regression for the reducer (7 cases). |
| `mingla-marketing/components/marketing/get-the-app-modal.tsx` | Imports the reducer; chip handler delegates to `nextInterest`; "All of it" chip selected-state derived from `SPECIFIC_INTERESTS.every`. |
| `mingla-marketing/components/marketing/beta-access-modal.tsx` | Brand-type → multi-select (array state, role=group/aria-pressed, `.length` gate, copy). |
| `mingla-marketing/lib/beta-access-submit.ts` | `brandType: string → string[]`. |
| `supabase/functions/beta-access-lead-submit/index.ts` | Array validation (de-dupe, reject empty/non-array/bogus); `ValidatedLead.brand_type: string[]`; notify email renders all types. |
| `supabase/migrations/20261126000000_orch_1220_beta_access_brand_type_multi.sql` | **NEW** — `brand_type text → text[]` (preserve prod lead) + array CHECK + `admin_beta_leads_list()` returns `text[]`. |
| `supabase/functions/beta-access-lead-submit/__tests__/submit_happy.test.ts` | Updated fixtures to arrays + added multi-value/de-dupe/trim assertions. `[TEST-MOD-APPROVED ORCH-1220]`. |
| `supabase/functions/beta-access-lead-submit/__tests__/submit_adversarial.test.ts` | T-10 rewritten for array (bogus element / mix / empty / scalar / non-string rejected). `[TEST-MOD-APPROVED ORCH-1220]`. |
| `supabase/functions/beta-access-lead-submit/__tests__/{welcome_email,welcome_email_adversarial.tester,submit_handler_sideeffects.tester}.test.ts` | Fixture `brandType` scalar → array. `[TEST-MOD-APPROVED ORCH-1220]`. |
| `.github/scripts/strict-grep/i-proposed-1219-form-no-autoadvance-multiselect.mjs` | **AMENDED** rule B1 (organiser is now multi-select). |
| `.github/scripts/strict-grep/i-proposed-1220-allpill-selects-all.mjs` | **NEW** DRAFT gate — "All of it" is a select-all control. |
| `.github/workflows/strict-grep-mingla-business.yml` | Wired the new `orch-1220-allpill-selects-all` job; (1219 job unchanged path, gate logic amended). |

(Commit `3ee41f299` — `node_modules` not staged; gitignored.)

---

## 3. Ephemeral PG15 migration proof

Verified on `postgres:15-alpine` (Docker). Created Supabase roles (`anon`/`authenticated`/`service_role`), applied the **real ORCH-1045 baseline** (`20260817000000_orch_1045_beta_access_leads.sql`), seeded **the 1 real scalar prod lead** (`brand_type='restaurant'`), then applied the ORCH-1220 migration. Assertions:

```
STEP 1 baseline apply ............................ CLEAN
STEP 2 pre-migration brand_type type ............. text (scalar)
STEP 3 ORCH-1220 apply ........................... CLEAN (apply #1)

A1  brand_type column type ....................... ARRAY (_text)  ✓ text[]
A2  existing scalar prod row converted ........... {restaurant}  (len 1)  ✓ preserved as 1-element array
A3  empty array '{}' ............................. REJECTED (violates beta_access_leads_brand_type_arr_chk)  ✓
A4  multi-value {restaurant,club_nightlife} ...... ACCEPTED → stored {restaurant,club_nightlife}  ✓
A5  bogus {hacker} .............................. REJECTED (arr_chk)  ✓
A6  mixed valid+bogus {venue_space,evil} ........ REJECTED (arr_chk)  ✓
A7  re-apply migration (idempotency) ............ CLEAN (apply #2); brand_type still ARRAY; prod row still {restaurant}  ✓
A8  admin_beta_leads_list() return type ......... brand_type text[]; RPC returns {restaurant} as text[]  ✓
A9  all 7 enum values (1-element arrays) ........ restaurant/cafe_bar/club_nightlife/event_organiser/experience_tour/venue_space/other ALL accepted  ✓
```

Container torn down after verification. **Not applied to live DB.**

---

## 4. tsc / Deno / gate results

- **Marketing `tsc --noEmit`** (`npm run typecheck` in `mingla-marketing`): **clean, 0 errors.**
- **Edge-fn Deno tests** (`beta-access-lead-submit/__tests__/`): **38 passed | 0 failed.**
- **Reducer regression** (`explorer-interest.test.ts`, transpiled + node): **7/7 passed.**
- **Strict-grep gates (live, all PASS):**
  - `orch-0785-{buyer-string-escape, no-resend-sandbox-fallback, pdf-privacy, resend-attachment-aware, shell-singleton}` — PASS
  - `i-proposed-1216-{testflight-behind-submit, android-no-testflight-link, no-service-key-client, explorer-only-cta, success-mount-gated}` — PASS
  - `i-proposed-1219-always-email-download-link` — PASS
  - `i-proposed-1219-form-no-autoadvance-multiselect` (amended) — PASS (self-test 9/9)
  - `i-proposed-1220-allpill-selects-all` (new) — PASS (self-test 6/6)
- **`test-append-only-check.js`** (`GITHUB_BASE_REF=main`): **6 passed, 0 failed** (all 5 modified edge-fn test files recognized via `[TEST-MOD-APPROVED ORCH-1220]` token; reducer test ADDED).

---

## 5. Fails-on-revert proof (all cite commit `3ee41f299` baseline; tree restored clean after each)

1. **Reducer → dumb independent toggle** (`nextInterest` = plain includes/filter): reducer regression test **FAILED** (`specific pills … preserve enum order` + `length-gated … empty after full clear` assertions broke, 7 failed); `i-proposed-1220` gate **FAILED** (no select-all branch).
2. **Organiser brand-type → single-select** (`useState('')`): amended `i-proposed-1219` gate **FAILED** — `"brandType is not a useState<string[]> — it must be a MULTI-select array (ORCH-1220 Fix 2)"`.
3. **Modal all-chip derivation → bare `includes('all')`**: `i-proposed-1220` gate **FAILED** — C4 `"selected-state is not derived from SPECIFIC_INTERESTS.every("`.
4. **Edge-fn validator → scalar `BRAND_TYPES.has(brandType)`**: Deno **type-check FAILED** (string vs `string[]`); behaviorally (`--no-check`) **7 tests FAILED** (array fixtures rejected as scalar).

After each revert, file restored → all gates green again; `git status` clean (matches `3ee41f299`).

---

## 6. I-PROPOSED-1219 gate AMENDMENT (orchestrator registry action at CLOSE)

`i-proposed-1219-form-no-autoadvance-multiselect.mjs` rule **B1 was AMENDED** by ORCH-1220:
- **Before:** "organiser brand-type STAYS single-select (`useState('')`)."
- **After:** "organiser brand-type is MULTI-select — `useState<string[]>([])`, chip group uses `role="group"`/`aria-pressed` (NOT radiogroup/radio), `step1Valid` checks `brandType.length`."

The **no-auto-advance rules (B2 + A4) and the explorer multi-select rules (A1–A3) are UNCHANGED** — still enforced on both forms. Self-test grew 6→9 cases (added organiser single-select-flagged / radiogroup-flagged / multi-select-compliant). Orchestrator: update **I-PROPOSED-1219** in the invariant registry to reflect the amended B1 (organiser now multi-select), and register the new **I-PROPOSED-1220-ALLPILL-SELECTS-ALL** (DRAFT → ACTIVE) at CLOSE.

---

## 7. Tester / orchestrator must-knows

- **Tester adds the adversarial half** (per the dispatch division): the implementor shipped the happy-path reducer regression (7 cases) + updated existing edge-fn tests to the array shape; the tester should add adversarial coverage (e.g. organiser multi-select round-trip end-to-end on device/web, all-chip clear+reselect UI, array persisted to `brand_type text[]` via the live insert path, notify email multi-type rendering).
- **Migration apply (deploy from merged main):** `supabase/migrations/20261126000000_orch_1220_beta_access_brand_type_multi.sql` is NOT applied. **1 REAL beta lead in prod is preserved** by `using array[brand_type]` (verified). Idempotent — safe to re-run. Run after merge as part of the normal migration push.
- **Edge-fn deploy (from merged main):** `beta-access-lead-submit` is NOT deployed. The new array validator must ship together with the migration (a deployed array-validator inserting into a still-scalar column, or vice-versa, would error) — deploy migration + edge fn in the same release. The marketing-web transport (`string[]`) is pure-JS and ships via the normal Vercel deploy.
- **No new npm deps**; anon key client-side only; service role only in the edge fn; idempotency unchanged (`lower(email)`).
- **CI Deno allowlist:** the `supabase-migrations-and-stripe-deno.yml` job uses an explicit `DENO_TEST_FILES` allowlist; the beta-access + reducer tests are NOT in it (consistent with the existing repo posture). CI-enforced protection for ORCH-1220 is via the **strict-grep gates** (1219 amended + new 1220), which DO run as blocking jobs in `strict-grep-mingla-business.yml`.
