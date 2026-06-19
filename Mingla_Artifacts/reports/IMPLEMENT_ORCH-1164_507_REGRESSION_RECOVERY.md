# IMPLEMENTATION — ORCH-1164 [#507 regression recovery — restore the anon web TRIP page]

- **Phase:** IMPLEMENT (single pass). Worktree `~/Desktop/mingla-orchs/ORCH-1164-[507-regression-recovery]/` on branch `ORCH-1164-507-regression-recovery`, rebased onto current `origin/main`.
- **Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-1164_507_REGRESSION_RECOVERY.md` (read from anchor; only artifact inputs read there — no anchor product code touched).
- **Investigation:** `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1164_507_BLAST_RADIUS.md`.
- **Comms:** Acked COMMS-0042 (WARN, CORRECTED) — narrow scope confirmed: ONLY the anon web trip page broke; NO 1147 re-apply, NO pricing bug. No ORCH-1147 or ORCH-1138-owned file touched.
- **Status:** implemented and verified (static/CI-grade + live DB probes). On-device anon trip-page render + WYSIWYP re-prove are the tester's runtime steps.

---

## 1. Summary

#507 (ORCH-1138 Leg 3) added `theme_color/theme_font/theme_animation` to the DIRECT anon `supabase.from("brands").select(...)` in the trip read hook. The `anon` Postgres role has only column-level SELECT on `public.brands` and was never granted those three columns → Postgres aborts the whole statement with `42501 permission denied for table brands` → the anon `/t/{brandSlug}/{tripSlug}` page blanked for every logged-out buyer (all anon web trip sales blocked). Event + experience pages were fine (they read theme via the anon-safe `business_public_events_view`).

This change restores anon trip-page rendering by (A1) granting anon column-SELECT on the 3 theme columns (forward-only migration, self-verifying), (A2) moving the trip hook's brand-theme read onto `business_public_events_view` (COMMS-0009 pattern, mirroring the experience leg) and dropping the 3 theme columns from the direct brands select, (B1) extending the ORCH-1138 anon-column guard to scan the trip hook (the gap that let #507 through), and (C) adding an anon-load regression test.

**OQ-2 RESOLVED — HELD:** live read-only probe confirmed `business_public_events_view` exposes `brand_theme_color/brand_theme_font/brand_theme_animation` AND contains 3 `event_type='trip'` rows resolvable by `(brand_slug, slug)`. A2 (view-sourced theme) is therefore viable; both A1 and A2 ship (OQ-1 = both).

---

## 2. SPEC success-criteria coverage

| SC | Criterion | Status | Evidence / commit |
|----|-----------|--------|-------------------|
| SC-1-Web | Anon loads published `/t/.../...` (no `permission denied`) | ✓ implemented; runtime UNVERIFIED (tester) | A1 grant + A2 view-sourced theme; brands select now anon-clean (`5d9acc15d`) |
| SC-2-DB | `has_column_privilege('anon','brands','theme_*')` = true after migration | ✓ migration authored + self-verifying probe | `20261014000000_orch_1164_anon_brand_theme_grant.sql` (orchestrator applies) |
| SC-3 | trip hook has NO `theme_*` in any `.from("brands").select(...)`; theme via view | ✓ verified | `usePublicTripBySlug.ts` (`5d9acc15d`); test `orch_1164_anon_trip_page_loads.test.ts` |
| SC-4 | B1 guard FAILS on revert, PASSES on fix | ✓ proven | fails-on-revert below (`5d9acc15d`) |
| SC-5-Auth | authenticated still loads trip page | ✓ no-regression (auth has table SELECT; hook unchanged for authed) | unchanged read path |
| SC-6 | WYSIWYP re-prove (1147 intact) | n/a here — re-prove only, NO code change | tester runs `orch-1153-pass-fee` fixture |

---

## 3. Files changed (4, all in scope)

| File | Δ | Kind |
|------|---|------|
| `supabase/migrations/20261014000000_orch_1164_anon_brand_theme_grant.sql` | +72 (new) | A1 migration |
| `mingla-business/src/hooks/usePublicTripBySlug.ts` | ~ +35 / -12 | A2 hook fix |
| `mingla-business/src/services/__tests__/orch_1138_tester_anon_brand_theme_columns.test.ts` | +47 (append-only) | B1 guard |
| `mingla-business/src/hooks/__tests__/orch_1164_anon_trip_page_loads.test.ts` | +110 (new) | C regression test |

Closing diff (`git diff origin/main...HEAD --name-only`) = exactly these 4. Working tree clean.

---

## 4. Data-model changes

- **Forward-only, additive GRANT** (no DDL beyond the grant): `GRANT SELECT (theme_color, theme_font, theme_animation) ON public.brands TO anon;`
- Self-verifying `DO $$ ... RAISE EXCEPTION` probe asserting 3 anon column grants (mirrors ORCH-0879).
- NO RLS change, NO REVOKE, NO other column grant, NO view change.
- **Live pre-apply probe (read-only):** `has_table_privilege('anon','brands','SELECT')=false`; `theme_color/font/animation` anon SELECT = false/false/false; `cover_hue`=true (kept as a direct read). Confirms the root cause and that the grant is the correct minimal restore.

---

## 5. Edge functions touched

None. No `verify_jwt` impact.

---

## 6. Regression tests added

- **Happy-path (implementor, C):** `mingla-business/src/hooks/__tests__/orch_1164_anon_trip_page_loads.test.ts` — asserts every column the trip hook selects off `brands` is in the anon-readable set, and that brand theme is sourced from `business_public_events_view` (`event_type='trip'`). 3 tests, PASS.
- **Guard generalization (B1):** extended `orch_1138_tester_anon_brand_theme_columns.test.ts` with an ORCH-1164 describe block scanning the trip hook for forbidden `theme_*` in any brands select. Append-only (zero deletions to existing assertions, verified via diff). PASS.

**fails-on-revert verified at `5d9acc15d`:** re-adding `theme_color, theme_font, theme_animation` to the trip hook's `.from("brands").select(...)` (the exact #507 break) → **2 suites / 4 tests FAIL** (the new `orch_1164` anon-readable-column subset check + the B1 guard's 3 forbidden-column assertions). Restoring the fix → 11/11 PASS. Reverted via true edit of the select string (not a comment-out).

Test run (fixed tree): `Test Suites: 2 passed, 2 total / Tests: 11 passed, 11 total`.

---

## 7. Old → New receipts

### usePublicTripBySlug.ts
- **Before:** the direct anon `brands` select listed `... cover_hue, theme_color, theme_font, theme_animation`; `brandTheme` was built from `brand.theme_color/font/animation`. A false comment claimed the theme columns "are anon-readable (verified)".
- **Now:** the brands select lists only anon-granted columns (`id, slug, name, description, cover_media_url, cover_media_type, cover_hue`). A new `fetchBrandThemeFromView(brandSlug, tripSlug)` reads `brand_theme_*` from `business_public_events_view` filtered to `event_type='trip'` (mirrors `publicExperienceService.fetchBrandThemeFromView`), and `brandTheme = await fetchBrandThemeFromView(...)`. Per-trip overrides still come off the `events` row (anon-readable). A non-null narrowing guard at the top of `queryFn` (mirrors `enabled`) narrows the slugs to `string` for the view lookup with no unsafe `!`/`as`.
- **Why:** SC-1/SC-3 — the column-privilege failure mode is removed and the page is robust to grant drift (COMMS-0009).
- **Lines:** ~+35 / -12.

### Migration (new)
- **Before:** anon had no SELECT on the 3 theme columns.
- **Now:** anon has column-SELECT on them (the belt; A2 is the suspenders).
- **Why:** SC-2; minimal immediate restore matching the ORCH-0879 template.

### Guard test (B1, append) + regression test (C, new)
- Close the CI coverage gap (1138 guard scanned only the experience service) + prove anon-load. Why: SC-4.

---

## 8. Cross-surface impact

| # | Surface | Affected | Note |
|---|---------|----------|------|
| 1 | Consumer iOS | No | reads off deck RPC, no client `.from(brands)` |
| 2 | Consumer Android | No | same |
| 3 | Buyer/anon Web | **YES** | the fix — published trip page renders for logged-out buyers |
| 4 | Business iOS | No | authed has table SELECT; unchanged |
| 5 | Business Android | No | same |
| 6 | Admin Web | No | does not use this hook |
| 7 | Business Web preview | Incidental | shares the hook → benefits automatically |

Parity: the backend grant is shared (all anon `brands.theme_*` readers benefit at once); the hook fix is the shared business/web RN codebase → automatic across surfaces 3 + 7.

---

## 9. Smoke / verification result

- Live read-only DB probes (MCP, project `gqnoajqerqhnvulmnyvv`): root-cause grant gap reconfirmed; OQ-2 view-trip-rows confirmed (3 trip rows with theme columns). No mutations.
- `npx tsc --noEmit` on the hook: no type errors in `usePublicTripBySlug.ts`.
- Jest: ORCH-1164 + extended 1138 suites = 11/11 PASS; fails-on-revert proven.
- Strict-grep gates run (all PASS): `orch-0792-no-published-event-theme-reads`, `orch-0964-checkout-no-brand-theme`, `orch-0964-theme-resolver-canonical`, `orch-0964-theme-typed-columns`, `orch-0963-public-trip-rpc-and-route-segregation`, `i-proposed-trip-canonical-columns`, `orch-1138-trip-reserve-straight-to-cart`.
- **Pre-existing failures (NOT caused by ORCH-1164):** a broad `src/services/__tests__` run shows ~25 suites failing on a `publicEventsService.ts:18` import-resolution issue; **confirmed identical on a pristine `origin/main` worktree** (verified `tripsService.test.ts` + `publicEventsService.tripFetch.test.ts` fail the same way without any ORCH-1164 change). Out of scope — flagged below.

---

## 10. Known issues / deferred

- No `[TRANSITIONAL]` code introduced.
- A1 + A2 both shipped (OQ-1 = both, per spec recommendation). A2 makes the page robust even if the grant is later dropped; A1 is the immediate restore.

---

## 11. Operator action required

- **Apply the migration (NOT applied by implementor — orchestrator/Management API per the migration-apply hazard runbook, gated behind Seth's QA):**
  ```bash
  cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1164-[507-regression-recovery]" && /Users/sethogieva/bin/supabase db push --linked
  ```
  (or apply `20261014000000_orch_1164_anon_brand_theme_grant.sql` via the Management API). Migration is monotonic — highest on origin/main + this branch is `20261013000002`; no sibling worktree uses `20261014*`. After apply, the self-verifying `DO $$` block raises if any grant didn't take; confirm `has_column_privilege('anon','brands','theme_color'/'theme_font'/'theme_animation','SELECT')` = true (SC-2).
- **Edge functions:** none to deploy.
- **Tester:** SC-1-Web anon trip-page render on buyer-web (against a real published trip, e.g. `travelbrand/the-dc-adventure`); SC-5 authed no-regression; SC-6/T7 WYSIWYP re-prove on the `orch-1153-pass-fee` fixture; SC-8 event/experience anon-page parity (no regression from the migration).

---

## 12. Discoveries for Orchestrator

- **D-1 (pre-existing, broad):** ~25 `mingla-business/src/services/__tests__` suites fail on a `publicEventsService.ts:18` import resolution — confirmed present on pristine `origin/main`, unrelated to ORCH-1164. Likely a jest-config/module-resolution drift on this machine; worth a dedicated investigation so the business-app jest suite is green again (it currently masks real regressions for any nearby ORCH).
- **D-2 (process, from spec OQ-4):** COMMS-0042 is already CORRECTED on origin; at CLOSE the orchestrator should mark Part B (1147 revert) as a false alarm and flip `I-PROPOSED-1164-ANON-BRAND-THEME-VIA-VIEW` ACTIVE.
- **D-3 (process, OQ-3):** the shared anchor `~/Desktop/mingla-main` working tree is polluted (~40 uncommitted reverts) — needs Seth's confirmation before any `git reset --hard origin/main`. Not in ORCH-1164 code scope; not touched.
- **D-4 (generalization, from investigation D-2):** the anon-brand-theme guard now covers the experience service + the trip hook. Consider globbing ALL public read paths (`src/services/public*Service.ts` + `src/hooks/usePublic*.ts`) under the proposed `I-PROPOSED-1164-ANON-BRAND-THEME-VIA-VIEW` so any future direct `brands.theme_*` read fails CI everywhere.
