# TEST — ORCH-1164 [#507 anon trip-page recovery]

- **Phase:** TEST (canonical tester). Mode: TARGETED + SPEC-COMPLIANCE + regression-guard.
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1164-[507-regression-recovery]/` on branch `ORCH-1164-507-regression-recovery`. HEAD `175ccc95f` (impl `0834d8ed9` / fix `5d9acc15d` + tester adversarial commit `175ccc95f`).
- **Inputs:** SPEC `SPEC_ORCH-1164_507_REGRESSION_RECOVERY.md` (read from anchor — uncommitted there), impl report `IMPLEMENT_ORCH-1164_507_REGRESSION_RECOVERY.md` (in-diff), real trip `travelbrand/the-dc-adventure` (`/t/travelbrand/the-dc-adventure`).
- **Comms:** Read COMMS_LEDGER on entry. No BLOCK directed to tester/ORCH-1164. Factored WARN **COMMS-0042** (CORRECTED truth: #507 broke ONLY the anon web trip page; ORCH-1147 NOT reverted — the "1147 revert" was a polluted-anchor misread), **COMMS-0040/0041** (RSVP/experience public-page standardization — not touched here), **COMMS-0038** (shared event page — not touched). No new cross-ORCH discovery to write.

---

## 1. VERDICT — **PASS**

**P0: 0 · P1: 0 · P2: 0 · P3: 0 · P4: 2**

All success criteria met with runtime evidence. The core fix (SC-1-Web) is proven at the database/anon-role layer to hold **on the A2 code fix alone, WITHOUT the migration** (the hard-guard requirement). ORCH-1147 WYSIWYP is intact (re-proven against the live pricing engine, zero pricing-source touched). Both implementor tests verified fails-on-revert; a tester adversarial test (broader different angle) added, on-branch, in-diff. Regression gate satisfied. → routes to CLOSE.

**Evidence basis / confidence:** the change is backend-grant + a data-fetch hook (no new UI rendered surface) — per the Phase 0.A exemption, runtime SQL execution as the `anon` Postgres role is the correct grade of live-fire proof, and is `proven` for the query paths. The literal rendered page pixels were not driven (web export not run — see P4-1); this does NOT cap the verdict because the failure mode is a Postgres column-privilege abort that is fully and deterministically reproducible at the query layer, and was reproduced both broken (old path) and fixed (new path) live.

---

## 2. SC-by-SC matrix

| SC | Criterion | Verdict | Evidence (runtime, project `gqnoajqerqhnvulmnyvv`) |
|----|-----------|---------|----------|
| **SC-1-Web** | Anon loads `/t/travelbrand/the-dc-adventure` — no `permission denied for table brands`, no blank page | **PASS** | Ran the A2-fixed hook's EXACT `brands` select (`id, slug, name, description, cover_media_url, cover_media_type, cover_hue`) **as `SET ROLE anon`** → returned the Travel Brand row, no error. **HARD-GUARD PROOF (A2 without migration):** inside a temp `pg_temp` function I REVOKED the 3 theme grants from anon (the pre-migration / #507 state), then checked privileges — OLD #507 path = `BLOCKED — anon has NO SELECT on brands.theme_color (the #507 401 state)`; NEW A2 path = `ALL A2 columns anon-readable WITHOUT the theme grant — page renders`; grant restored in the same call (verified `theme_*` = true/true/true afterward, no prod mutation). The A2 hook is therefore grant-independent. |
| **SC-2-DB** | `has_column_privilege('anon','brands','theme_*','SELECT')` = true after migration | **PASS** | Migration `20261014000000_orch_1164_anon_brand_theme_grant` IS in `list_migrations` (applied). Live: `theme_color/theme_font/theme_animation` anon SELECT = `true/true/true`. (A1 the belt; A2 the suspenders.) |
| **SC-3** | Trip hook has NO `theme_*` in any `.from("brands").select()`; theme sourced from `business_public_events_view`; themed page still renders | **PASS (mechanism)** | `usePublicTripBySlug.ts` brands select = anon-clean column list (grep + the new tests). `fetchBrandThemeFromView(brandSlug, tripSlug)` reads `brand_theme_*` from the view filtered `event_type='trip'`. As anon the view returns the travelbrand trip row (theme null → default palette, no 401). View exposes real theme values for other types (rsvp `leggothis/test-rsvp` → `#000000`). NO themed *trip* exists in prod today, so themed-trip pixel render is mechanism-proven not data-proven — zero live blast radius. |
| **SC-4** | B1 guard FAILS on revert, PASSES on fix | **PASS** | See §4 (Step 0.5). |
| **SC-5-Auth** | Authenticated still loads the trip page | **PASS** | `authenticated` has table-level SELECT on `brands` = true AND `theme_color` column priv = true → authed read path unaffected; A2 hook also works for authed (uses the anon-safe view). No regression. |
| **SC-6 / WYSIWYP** | ORCH-1147 all-in intact; charged==displayed all-in on `orch-1153-pass-fee`; base ≠ all-in; no pricing source touched | **PASS** | (a) `git diff origin/main...HEAD` product files = ONLY `usePublicTripBySlug.ts` + the migration; grep of the diff for any pricing keyword (`CartContext`/`useCartTotals`/`fetchTierAllIn`/`allIn`/`unit_amount`/`priceGbp`/`pg_public_event_tier`) = EMPTY → zero pricing/cart/checkout touch. (b) Live RPC `pg_public_event_tier_allin('229ff02a…')` on the persisted fixture brand `orch-1153-pass-fee-qa-50e0fd65` (`default_pass_mingla_fee=true`): base **5000c ($50.00)** → all-in **5500c ($55.00)**, +10.00% gross-up, `base_differs_from_allin=true`. (c) ORCH-1147 jest suites `orch_1147_cart_allin_total.test.ts` + `orch_1147_cart_charge_parity.tester-adversarial.test.ts` = **23/23 PASS** unchanged on this branch (display==charge==all-in contract). |
| **SC-8 / T8** | Anon EVENT + EXPERIENCE pages still load (no collateral) | **PASS** | As anon: `business_public_events_view` returns EVENT (`leggothis/test-rsvp`, theme `#000000`) and EXPERIENCE (`orch-1153-pass-fee-qa…/…-tasting-crawl`) rows. The additive grant introduced no regression (forward-only, no REVOKE/RLS change). |

---

## 3. Findings

**No P0/P1/P2/P3.**

- **P4-1 (NOTE):** SC-1-Web is proven at the anon-role query layer, not by a rendered web export. The buyer-web full `expo export` was not run (heavyweight; the failure mode is a deterministic Postgres `42501` abort fully reproducible at the query layer, and was reproduced both broken and fixed live as the anon role). Seth's optional eyeball: open `https://<buyer-web-host>/t/travelbrand/the-dc-adventure` logged-out and confirm it renders. Not verdict-capping.
- **P4-2 (PRAISE):** The A2 fix is exemplary defense-in-depth — it removes the failure mode at the source (no theme cols in the anon brands select) AND the migration grants them anyway, so the page survives future grant drift. The slug-narrowing guard at the top of `queryFn` avoids an unsafe `!`/`as`. Comments explain WHY (the `42501` mechanism + COMMS-0009), not just what.

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

Checked out the fix tree (HEAD `175ccc95f`, fix commit `5d9acc15d`). Backed up `usePublicTripBySlug.ts`, then performed a TRUE line edit re-adding the exact #507 columns to the brands select (`…cover_hue, theme_color, theme_font, theme_animation`).

- **Reverted tree:** `Test Suites: 2 failed, 2 total / Tests: 4 failed, 7 passed`. Exact failing assertions:
  - `orch_1138_tester_anon_brand_theme_columns.test.ts` — "ORCH-1164 — no trip-hook brands.select requests the non-anon-readable column theme_color / theme_font / theme_animation" (3 fails); offender array = `["id, slug, …, theme_color, theme_font, theme_animation"]`.
  - `orch_1164_anon_trip_page_loads.test.ts` — "every column the trip hook selects off brands is anon-readable" (1 fail).
- **Restored tree:** `cp` back → `git diff` clean (zero diff) → `Test Suites: 2 passed / Tests: 11 passed`.

Matches the implementor's claim (2 suites / 4 tests) exactly. **fails-on-revert independently verified at `5d9acc15d` / HEAD `175ccc95f`.** No test file was modified (only product code, then restored).

---

## 5. Adversarial test added (tester-authored, different angle)

- **Path:** `mingla-business/src/services/__tests__/orch_1164_tester_anon_brand_theme_all_public_readers.test.ts` (NEW, append-only).
- **Commit:** `175ccc95f` (on-branch). In closing diff — `git diff origin/main...HEAD --name-only` lists all three test files (implementor happy-path `orch_1164_anon_trip_page_loads.test.ts`, extended `orch_1138_tester_anon_brand_theme_columns.test.ts`, and this one).
- **Different angle:** the implementor's two tests each scan a SINGLE file (the trip hook / the experience service). Mine **globs EVERY anon-reachable public reader** (`src/hooks/usePublic*.ts` + `src/services/public*Service.ts` — 6 files) and asserts NO `.from("brands").select()` in ANY of them requests `theme_*` (the spec's preferred broader B1 coverage / D-4). Word-boundary matching so `brand_theme_color` / `theme_color_override` do not false-positive.
- **Proof it's a genuinely broader net (not a renamed copy):** I injected the #507 regression into `publicEventsService.ts` (a file NEITHER implementor test scans). My test **FAILED** (caught it); both implementor tests **STILL PASSED** (blind spot). Restored the file (git diff clean).
- **fails-on-revert verified:** `175ccc95f` — passes on the fixed tree (3/3); fails when any scanned reader re-adds a theme column.

---

## 6. Constitution 14-rule matrix (against the diff)

| # | Rule | Verdict | Evidence |
|---|------|---------|----------|
| 1 | No dead taps | N/A | no UI control added |
| 2 | One owner per truth | **PASS** | brand theme now single-sourced from `business_public_events_view` (COMMS-0009); removes the second/conflicting direct-`brands` theme reader |
| 3 | No silent failures | **PASS** | `fetchBrandThemeFromView` returns null on view error/miss → default palette (intentional, documented "Non-fatal"); the hook still `throw`s on a real brand/event fetch error (unchanged error contract) |
| 4 | One query key per entity | **PASS** | trip query key unchanged; the view read is a sub-fetch inside the same `queryFn` |
| 5 | Server state server-side | **PASS** | React Query; no Zustand server state introduced |
| 6 | Logout clears everything | N/A | no auth/session state touched |
| 7 | Label `[TRANSITIONAL]` | N/A | no transitional code |
| 8 | Subtract before adding | **PASS** | A2 subtracts the failing theme columns from the brands select; the false "anon-readable (verified)" comment removed |
| 9 | No fabricated data | **PASS** | null theme → default palette, never a fake theme value |
| 10 | Currency-aware | N/A | no money change (SC-6 confirms pricing untouched) |
| 11 | One auth instance | N/A | not touched |
| 12 | Validate at right time | N/A | n/a |
| 13 | Exclusion consistency | **PASS** | `event_type='trip'` filter on the view matches the trip read path |
| 14 | Persisted-state startup | N/A | n/a |

No violations.

---

## 7. Device / parity matrix

| Surface | Verdict | Note |
|---------|---------|------|
| Consumer iOS | N/A (skip) | trip detail reads off deck RPC, no client `.from(brands)` — does not ship this hook |
| Consumer Android | N/A (skip) | same |
| Buyer/anon Web | **PASS** | the fix — anon trip query path proven as the `anon` role (SC-1-Web), grant-independent (A2) |
| Business iOS | **PASS (no-regression)** | authed has table SELECT; hook works via the view too |
| Business Android | **PASS (no-regression)** | same |
| Admin Web | N/A (skip) | does not use this hook |
| Business Web preview | **PASS (incidental)** | shares the hook → benefits automatically |

Physical iPhone HITL: not required — the regression is a server-side anon column-privilege abort, proven at the DB layer; no on-device-only behavior. Edge-fn live deploy state: N/A (no edge function touched). Migration live state: `20261014000000` confirmed applied via `list_migrations` (SC-2).

---

## 8. D-1 — pre-existing business-app jest failures (confirmed NOT caused by ORCH-1164)

- **On the ORCH-1164 branch:** `src/services/__tests__` → `23 failed, 70 passed (93 suites)` / `34 failed, 448 passed tests`.
- **On clean `origin/main` (fresh detached worktree, same node_modules):** `23 failed, 69 passed (92 suites)` / `34 failed, 441 passed tests`. (Branch has +1 suite = my new passing adversarial test; the 23 failed / 34 failed-tests count is IDENTICAL.)
- **NET NEW failures from ORCH-1164: ZERO.** My adversarial suite and the 1164/1138 guard suites are NOT in the failure list; the touched hooks-dir 1164 suite passes (the 2 hooks-dir failures — `orch1004AllowlistIntegrity`, `brandListState` — reference none of the ORCH-1164 files and are the same pre-existing class).
- **Correction to the impl report's D-1 root-cause guess:** the failures are NOT a `publicEventsService.ts:18` import-resolution error — they are an incomplete jest **supabase mock chain** (e.g. `tripsService.test.ts`: `TypeError: supabase.from(...).select(...).eq(...).eq(...).maybeSingle is not a function`). The conclusion is unchanged (pre-existing, unrelated, masks real regressions in the business-app service suite).

---

## 9. Discoveries for Orchestrator

- **D-A (re-flag D-1):** ~23 `mingla-business/src/services/__tests__` suites (34 tests) fail on clean `origin/main` due to an incomplete supabase mock chain (`.maybeSingle`/`.single` not stubbed on some mock builders). Pre-existing, broad, machine-independent (reproduced on a fresh origin/main worktree). It masks real regressions for any business-app ORCH — worth a dedicated investigation to green the suite. (Refines the impl report's `publicEventsService.ts:18` guess.)
- **D-B (process, OQ-4):** COMMS-0042 is already CORRECTED. At CLOSE the orchestrator should flip `I-PROPOSED-1164-ANON-BRAND-THEME-VIA-VIEW` ACTIVE and confirm Part B (1147 revert) was a false alarm.
- **D-C (coverage, D-4):** consider promoting my all-public-readers glob test into the strict-grep CI gate set so the theme-leak guard runs on the full surface (not just the two single-file jest scans), backing the proposed invariant.
- **D-D (OQ-3):** the shared anchor `~/Desktop/mingla-main` working tree is polluted (~40 uncommitted reverts) — Seth must confirm before any reset. Not touched here.

---

## 10. Regression-gate statement

Implementor happy-path `orch_1164_anon_trip_page_loads.test.ts` (fails-on-revert @ `5d9acc15d`) + extended guard `orch_1138_tester_anon_brand_theme_columns.test.ts` + tester adversarial `orch_1164_tester_anon_brand_theme_all_public_readers.test.ts` (different angle, on-branch @ `175ccc95f`, in-diff). Gate **satisfied** — verdict not capped.
