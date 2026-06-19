# SPEC — ORCH-1164 [#507 regression-cluster recovery]

- **Source investigation:** `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1164_507_BLAST_RADIUS.md` (confidence `proven`).
- **Phase:** SPEC (contract only — no code). Implementation happens later in a worktree.
- **Comms:** acked COMMS-0042; this SPEC NARROWS the dispatch scope per the investigation (the 9-file 1147 re-apply is dropped — 1147 is intact on origin/main; only a guard-coverage gap remains).

---

## 1. Executive summary

#507 (ORCH-1138 Leg 3) shipped a single live regression: the **anonymous web TRIP page** (`/t/{brandSlug}/{tripSlug}`) throws `permission denied for table brands` and won't render → ALL anon web trip sales blocked. Root cause: ORCH-1138 added `theme_color, theme_font, theme_animation` to a **direct anon `supabase.from("brands").select(...)`** in `usePublicTripBySlug.ts`, but the `anon` Postgres role has only **column-level** SELECT on `brands` and was never granted those three theme columns → Postgres aborts the whole statement (error `42501`). The event + experience public pages don't break because they read brand theme via the anon-safe security-definer view `business_public_events_view` (the COMMS-0009 contract). The trip hook is the sole violator.

Part B of the dispatch (restore ORCH-1147 all-in across ~9 files + green the dead test) is **NOT NEEDED**: the investigation proved ORCH-1147 is fully intact on `origin/main` and its guard test compiles + passes. The prior "revert" was a misread of the shared anchor's dirty local working tree. The only Part-B action is closing the **guard-coverage gap** that let this slip CI: the ORCH-1138 anon-column guard scanned only `publicExperienceService.ts`, never the trip read path.

This SPEC delivers: **(A)** restore anon trip-page rendering, and **(B)** a generalized fails-on-revert guard. WYSIWYP/all-in is already correct — re-verification only, no source change.

---

## 2. Scope & non-goals

**In scope:**
- A1. Forward-only migration granting `anon` column-SELECT on `brands.theme_color, theme_font, theme_animation` (the minimal, immediate restore — matches the ORCH-0879 column-grant template).
- A2. Harden `usePublicTripBySlug.ts` to the COMMS-0009 pattern: source brand theme from `business_public_events_view` (which already exposes `brand_theme_color/brand_theme_font/brand_theme_animation`, anon-granted), so the trip page no longer depends on a brands-table column grant for theme. (Defense-in-depth + pattern parity; the grant in A1 is the belt, this is the suspenders. See Open Question OQ-1 for whether to ship both or A1-only.)
- B1. Generalize the anon-brand-theme guard so it scans the trip read path (and ideally ALL public read paths), making the regression fails-on-revert.
- C. A regression test proving an ANONYMOUS client can load a published trip public page.

**Non-goals (explicit, with reasons):**
- The 9-file ORCH-1147 all-in re-apply — **1147 is intact on origin/main** (investigation F-5); nothing to restore. Re-applying would be a no-op or a conflict-risk re-clobber.
- The 3-checkout-step CTA theming (ORCH-1162 Bug 3A) — separate ORCH, not a #507 regression.
- The engine/RPC (`pg_public_event_tier_allin`, `computeBuyerSubtotal`) — correct.
- Cleaning the anchor's dirty working tree — destructive, needs Seth (Open Question OQ-3 / investigation D-1).
- The broader anon-grant-model audit on `brands` (D-2/D-3) — register as a follow-on.

**Assumptions:** anon already has column-SELECT on all OTHER trip-hook columns (`id, slug, name, description, cover_media_url, cover_media_type, cover_hue, default_currency` — verified true live). `business_public_events_view` has a row for `event_type='trip'` published events (verify in implementation; if a trip is filtered out of the view, A2 alone is insufficient and A1 is mandatory — see OQ-2).

---

## 3. Cross-Surface Impact Declaration

| # | Surface | Covered | User-visible behavior demanded | Files touched here | Parity |
|---|---------|---------|--------------------------------|--------------------|--------|
| 1 | Consumer iOS | No | n/a — consumer trip detail reads off deck RPC, no client `.from(brands)` | — | n/a |
| 2 | Consumer Android | No | same as iOS | — | n/a |
| 3 | Buyer/anon Web | **YES** | published `/t/{brandSlug}/{tripSlug}` renders for logged-out buyers (no `permission denied`) | migration; `usePublicTripBySlug.ts`; guard + test | the fix |
| 4 | Business iOS | No (verify) | authenticated trip view already works (authenticated has table SELECT) | — | automatic (auth grant) |
| 5 | Business Android | No (verify) | same | — | automatic |
| 6 | Admin Web | No | does not read public trip via this hook | — | n/a |
| 7 | Business Web preview | Incidental | host preview of a trip benefits from the same hook fix if it uses it | (same hook) | automatic (shared hook) |

The migration is a **shared backend change** → all surfaces that read `brands.theme_*` as anon benefit at once. Only Surface 3 has a behavior change to verify.

---

## 4. Layered specification

### Database (A1)
- **Migration file:** `supabase/migrations/20261014000000_orch_1164_anon_brand_theme_grant.sql` (next free version — highest on origin/main is `20261013000002`; scanned all active worktrees, none use `20261014*`).
- **Forward-only, additive, non-destructive.** No DROP, no REVOKE, no policy change.
- **Body (illustrative ≤3 lines, not implementation):**
  ```sql
  GRANT SELECT (theme_color, theme_font, theme_animation) ON public.brands TO anon;
  ```
- **Self-verification probe (mandatory, mirrors ORCH-0879):** a `DO $$ ... $$` block that asserts `has_column_privilege('anon','public.brands','theme_color','SELECT')` (and font/animation) is `true`, raising if not. This makes the migration self-auditing.
- **Preserve other policies/grants:** touch ONLY these 3 column grants. Do not alter RLS, table grants, or other column grants.
- **Safety rationale (in a comment):** these columns are already exposed to anon via `business_public_events_view.brand_theme_*`; granting the column directly introduces no new data exposure — it only aligns the brands-table grant with the already-public view fields. RLS still gates WHICH rows anon sees (the existing "Public can read brands with public events" + "Public can read non-deleted brands" policies).

### Service / Hook (A2 — COMMS-0009 pattern alignment)
- **File:** `mingla-business/src/hooks/usePublicTripBySlug.ts` (the `.from("brands").select(...)` at ~L170-185).
- **Change:** REMOVE `theme_color, theme_font, theme_animation` from the direct `brands` select; keep `id, slug, name, description, cover_media_url, cover_media_type, cover_hue, default_currency` (all anon-granted). Source the three theme values from `business_public_events_view` (columns `brand_theme_color/brand_theme_font/brand_theme_animation`) on the trip event row the hook already resolves at step 2 — mirroring `publicExperienceService.ts:189-234` and `publicEventsService.ts`.
- **Error contract:** unchanged — the hook still `throw`s on a real error and returns `null` on not-found. The fix removes the column-privilege failure mode.
- **Fix-the-comment:** delete the false "these columns... are anon-readable (verified)" comment block; replace with the COMMS-0009 note (theme sourced from the anon-safe view).
- **Note:** `cover_hue` stays sourced from `brands` (anon-granted; the view does not expose `brand_cover_hue`).

### Test layer (B1 + C)
- **B1 guard generalization:** extend `mingla-business/src/services/__tests__/orch_1138_tester_anon_brand_theme_columns.test.ts` (or add a sibling `orch_1164_*` test) so it ALSO scans `mingla-business/src/hooks/usePublicTripBySlug.ts` — and, preferably, GLOBS all public read paths (`src/services/public*Service.ts` + `src/hooks/usePublic*.ts`) — asserting NO `.from("brands").select(...)` block contains `theme_color/theme_font/theme_animation`. If A2 is shipped, this test passes; if a future change re-adds a direct theme read, it flips RED.
- **C anon-load regression test:** a test proving an ANONYMOUS Supabase client can resolve a published trip's brand-by-slug select WITHOUT `permission denied`. Two acceptable mechanisms (pick per OQ-1):
  - **Live anon probe (preferred, runtime-grade):** with the anon publishable key, run the exact trip-hook `from("brands").select(<final column list>).eq("slug", <known published-trip brand slug>)` and assert no error + a row. This directly proves the grant+hook fix end-to-end.
  - **Static guard (CI-grade, no network):** assert the trip hook's brands-select column list is a subset of the anon-granted columns (or contains no `theme_*`). Pairs with B1.

---

## 5. Success criteria (per-surface where parity is manual)

- **SC-1-Web (Part A — primary):** Loading a published `/t/{brandSlug}/{tripSlug}` as an anonymous (logged-out) buyer renders the trip page (no `permission denied for table brands`, no error screen). VERIFY against a real published trip.
- **SC-2-DB:** `has_column_privilege('anon','public.brands','theme_color','SELECT')` = `true` (and `theme_font`, `theme_animation`) after the migration applies.
- **SC-3 (pattern):** `usePublicTripBySlug.ts` contains NO `theme_color/theme_font/theme_animation` inside any `.from("brands").select(...)`; brand theme on the trip page is sourced from `business_public_events_view`. The page still renders the brand theme correctly (themed CTA / accent) for a themed brand.
- **SC-4 (guard fails-on-revert):** the B1 guard FAILS if `theme_*` is re-added to any scanned public read path, PASSES on the fixed tree.
- **SC-5-Auth (no regression):** an authenticated user still loads the same trip page (unchanged).
- **SC-6 (WYSIWYP re-prove, NOT a code change):** on the `orch-1153-pass-fee` fixture (base $50 / server all-in $55 via `pg_public_event_tier_allin`), the cart/checkout DISPLAYED total equals the server fee-grossed all-in and the web charge `unit_amount` equals the fee-grossed pre-tax subtotal — confirming ORCH-1147 is still correct (no source change; this is a regression re-proof, not a restore). A 0-fee brand proves nothing (all 8 charges-enabled brands absorb) — the pass-fee fixture is mandatory.

---

## 6. Invariants

**Preserve:**
- COMMS-0009 anon-safe-theme contract (read brand theme via `business_public_events_view`, never a raw `.from("brands")` for `theme_*`) — A2 + B1 enforce it for the trip path.
- ORCH-1147 single-owner all-in contract: `fetchTierAllInCents` → `pg_public_event_tier_allin` is the SOLE owner of the all-in/fee math; cart seeds `unitPriceAllIn`/`priceAllInGbp`, `useCartTotals` sums the all-in, and the edge `ticket-checkout-create` web `unit_amount` = the fee-grossed pre-tax subtotal (D-1). This SPEC must NOT touch any 1147 file (it is intact); SC-6 only re-proves it.
- Existing `brands` RLS policies ("Public can read brands with public events", "Public can read non-deleted brands") — untouched.

**Propose (DRAFT — orchestrator flips ACTIVE on CLOSE):**
- `I-PROPOSED-1164-ANON-BRAND-THEME-VIA-VIEW` (DRAFT): no public, anon-reachable read path may select `theme_color/theme_font/theme_animation` directly from `brands`; brand theme on public pages is sourced from `business_public_events_view`. Verified by the B1 guard (globs all public services + hooks).

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T1 (happy) | anon loads published trip page | anon key + published trip slug | brands+event resolve, no `42501`, page renders | runtime/web |
| T2 (DB) | grant applied | run migration | `has_column_privilege('anon','brands','theme_color')` = true (+font/animation) | schema |
| T3 (error→fixed) | anon select with theme cols pre-fix | the old column list as anon | 42501 BEFORE migration; 200 AFTER | schema/runtime |
| T4 (guard) | re-add theme_* to trip hook | mutate `usePublicTripBySlug.ts` | B1 guard FAILS (red) | test/static |
| T5 (auth no-regression) | authenticated loads trip page | authed session | renders (unchanged) | runtime |
| T6 (theme correctness) | themed brand trip page | brand with theme_color set | themed accent renders from the view source | runtime/web |
| T7 (WYSIWYP re-prove) | pass-fee fixture checkout | `orch-1153-pass-fee` (base $50 / all-in $55) | displayed total == server all-in; web `unit_amount` == fee-grossed pre-tax subtotal | edge/runtime |
| T8 (parity) | anon event + experience pages | anon key | still render (no regression from the migration) | runtime/web |

---

## 8. Implementation order

1. **DB:** create `20261014000000_orch_1164_anon_brand_theme_grant.sql` (grant + self-verification probe). Apply via the Supabase Management API per the migration-apply hazard runbook (CLI is drift-wedged; MCP is read-only). After apply, run T2/T3 to confirm. — files: the new migration.
2. **Hook (A2):** edit `mingla-business/src/hooks/usePublicTripBySlug.ts` — drop theme cols from the brands select, source theme from `business_public_events_view`, fix the comment. — files: `usePublicTripBySlug.ts`.
3. **Guard (B1):** extend/add the anon-brand-theme guard to scan the trip hook (and glob public read paths). Wire it into the strict-grep workflow if it's a `.mjs` gate, or jest if a test. — files: `orch_1138_tester_anon_brand_theme_columns.test.ts` (extend) or new `orch_1164_*` test/gate + workflow entry.
4. **Regression test (C):** add the anon-load test (live anon probe or static subset assertion per OQ-1). — files: new `orch_1164_anon_trip_page_loads.test.*`.
5. **Re-prove WYSIWYP (SC-6/T7):** no code change — tester runs the pass-fee fixture to confirm 1147 still holds.

> If `business_public_events_view` turns out NOT to surface trip rows (OQ-2), SKIP step 2's "source from view" and rely on the A1 grant alone (the page renders once anon can read the columns); B1/C still apply.

---

## 9. Regression prevention (fails-on-revert contract)

- **Structural safeguard:** the migration's self-verification `DO $$` block (fails the migration if the grant didn't take) + the B1 guard (fails CI if any public read path re-adds `theme_*` to a `.from("brands")` select).
- **Fails-on-revert test:** B1 — re-adding `theme_color`/`theme_font`/`theme_animation` to `usePublicTripBySlug.ts`'s brands select flips the guard RED; removing them passes (T4). This is the exact mechanism the ORCH-1138 experience guard used — generalized to the trip path so the gap that let #507 through is closed.
- **Protective comment (in the guard + migration):** explain WHY — "anon has only column-level SELECT on brands; theme_* were never granted; reading them directly off brands 401s the whole anon query (`42501 permission denied for table brands`) and blanks the public page. Source theme from `business_public_events_view` (COMMS-0009). ORCH-1164 / #507."

---

## 10. Open questions

- **OQ-1:** Ship BOTH A1 (grant) and A2 (view-sourced hook), or A1 only? Recommendation: **both** — A1 restores the page immediately and is the minimal hotfix; A2 aligns to the COMMS-0009 pattern and makes the page robust to future grant drift. If speed-to-restore is paramount, A1 alone unblocks; A2 + B1 can follow. Seth/orchestrator to confirm.
- **OQ-2:** Does `business_public_events_view` include `event_type='trip'` rows? If a trip is filtered out (e.g. the view is events-only by some predicate), A2's view-sourced theme is empty for trips → A1 grant becomes mandatory and A2 should keep `cover_hue`-style direct reads. Verify in implementation before choosing A2.
- **OQ-3 (process):** the shared anchor `~/Desktop/mingla-main` working tree is dirty (HEAD 4 behind origin + ~40 uncommitted product-file reverts of 1147 AND 1138) — this is what misled ORCH-1162/COMMS-0042. Should the orchestrator reset it (`git fetch && git reset --hard origin/main`)? Destructive — needs Seth's confirmation that no wanted local work is uncommitted. NOT in ORCH-1164's code scope.
- **OQ-4:** Update COMMS-0042 to reflect that Part B (1147 revert) was a false alarm (dirty-tree misread) and the only live regression is Part A? Recommend yes, as a one-file ledger commit at CLOSE.

---

## 11. Downstream routing

- **Next = mingla-implementor** in a fresh per-ORCH worktree `~/Desktop/mingla-orchs/ORCH-1164-[507-regression-recovery]/` on branch `ORCH-1164-507-regression-recovery`, branched off CURRENT `origin/main` (NOT the stale anchor — `git fetch origin && git rebase origin/main` first). Build A1 + A2 + B1 + C per the allowlist below. Apply the migration via the Management API (read the edge-deploy/migration-apply hazard memory). Do NOT touch any ORCH-1147 file.
- **Then = mingla-tester:** prove SC-1-Web (anon trip page renders) on buyer-web + SC-6/T7 WYSIWYP on the `orch-1153-pass-fee` fixture + SC-5 auth no-regression + SC-8/T8 event/experience parity.
- **Then = mingla-orchestrator CLOSE:** flip `I-PROPOSED-1164-ANON-BRAND-THEME-VIA-VIEW` ACTIVE; update COMMS-0042 (OQ-4); World Map; decide OQ-3 (anchor reset).

### Scoped allowlist (implementor MAY change ONLY these)
- `supabase/migrations/20261014000000_orch_1164_anon_brand_theme_grant.sql` (new)
- `mingla-business/src/hooks/usePublicTripBySlug.ts`
- `mingla-business/src/services/__tests__/orch_1138_tester_anon_brand_theme_columns.test.ts` (extend) OR a new `mingla-business/.../__tests__/orch_1164_*.test.*` + `.github/workflows/strict-grep-mingla-business.yml` (if adding a `.mjs` gate) + the new gate file under `.github/scripts/strict-grep/`
- `Mingla_Artifacts/` ORCH-1164 artifacts (report/spec/impl report)

### DO-NOT-TOUCH (stop-and-amend before changing)
- ANY ORCH-1147 file: `CartContext.tsx`, `publicEventsService.ts`, `publicExperienceService.ts`, `tripsService.ts`, `ticket-checkout-create/index.ts`, the `checkout*/[*]/index.tsx` + `payment.tsx` files, the `orch_1147*`/`orch-1147*` tests + gates (all intact — re-touching risks a re-clobber and conflicts with the in-flight ORCH-1138 session per COMMS-0042).
- `brands` RLS policies / table grants / other column grants (touch ONLY the 3 theme column grants).
- `business_public_events_view` definition (read-only consumer; do not alter the view).
- The shared anchor working tree (never reset/checkout there).
- Files owned by in-flight ORCH-1138 (per COMMS-0042): `publicExperienceService` read shape, the `checkout/[eventId]` files, `ticket-checkout-create`. Coordinate via COMMS-0042 before touching.
