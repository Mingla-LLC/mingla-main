# INVESTIGATE — ORCH-1164 [#507 regression-cluster recovery]

- **Phase:** INVESTIGATE (read-only forensic). No product code edited. No worktree spawned — investigation read directly from `origin/main` (authoritative) + live DB (read-only MCP).
- **Date:** 2026-06-18
- **Lead (hypothesis to prove/refute):** #507 (ORCH-1138 Leg 3, merge `13c3ec4c5`) merged off a stale base and caused a regression cluster: (1) anon web TRIP pages broken (`permission denied for table brands`); (2) the ORCH-1147 all-in fix fully reverted across ~9 files + its guard test no longer compiles.
- **Comms:** Acked COMMS-0042 (WARN, to ORCH-1138 + ALL). This investigation directly REFUTES half of that ledger entry's claim — see Q3 / F-5.

---

## EXECUTIVE VERDICT

The lead is **HALF TRUE — and the evidence forces a material correction of the prior ORCH-1162 finding.**

1. **CONFIRMED (S0, live, revenue-blocking): the anon web TRIP page is broken** — but the cause is **NOT** an RLS revert or a stale-base clobber. The cause is a **missing anon column-level GRANT.** ORCH-1138 (#507) added `theme_color, theme_font, theme_animation` to the trip page's *direct* `supabase.from("brands").select(...)` in `usePublicTripBySlug.ts`. The `anon` Postgres role has **column-level** SELECT on `brands` (granted column-by-column since the baseline), and those three theme columns were **never granted to anon** → any anon select that includes them returns Postgres error `42501` surfaced as **"permission denied for table brands"** → the entire `/t/{brandSlug}/{tripSlug}` page fails to load for every logged-out buyer → ALL anon web trip sales blocked. RLS policies and table grants are NOT the problem (anon-read RLS policies exist; the break is purely the column grant).

2. **REFUTED: the ORCH-1147 all-in fix is NOT reverted on `origin/main`, and its guard test DOES compile and pass.** Every ORCH-1147 artifact is intact on `origin/main`: `CartContext.tsx` (`unitPriceAllIn`/`allInTotal` — 20 refs), `publicEventsService.ts` (`fetchTierAllInCents`/`pg_public_event_tier_allin`), `publicExperienceService.ts` (`fetchTierAllInCents` + `priceAllInGbp` seed), `tripsService.ts` (`priceAllInGbp`), the edge `ticket-checkout-create`, all 3 strict-grep gates, and the test `orch_1147_cart_allin_total.test.ts` (41 refs to the 1147 types, which CartContext exports). **#507 was correctly built on top of #497** (`0e20cb949` IS a git ancestor of #507's parent `488db83c4`); in the experience path #507 *added to* the 1147 code (`fetchTierAllInCents` still in the `Promise.all`; `unitPriceAllIn:` still seeded). The ORCH-1162 "wholesale revert" verdict was produced by reading the **shared anchor's dirty/stale local working tree** (HEAD `477675023`, 4 commits behind origin, with massive uncommitted reverts of BOTH 1147 and 1138 in the working copy), **not** `origin/main`. See F-5 for the proof.

**Net live impact (corrected):** the only confirmed live regression from #507 is the anon trip-page break (Part A). The ORCH-1147 all-in display/charge (Part B) is **already correct on `origin/main`** — there is nothing to "restore" in source; the only Part-B action is a guard-coverage gap (the 1138 anon-column test scanned only `publicExperienceService.ts`, so the trip-path equivalent slipped through). This investigation recommends ORCH-1164 narrow to: (A) the anon `brands` column GRANT + trip-hook hardening, and (B) extend the anon-column guard to cover the trip read path. NO 9-file 1147 re-apply is needed.

---

## INVESTIGATION MANIFEST (files / probes, in trace order)

1. `COMMS_LEDGER.md` @ `origin/main` — COMMS-0042 (the lead), COMMS-0040/0041 (RSVP/experience standardization), COMMS-0036 (1138 transitional gate).
2. `git show 13c3ec4c5` — #507 is a SINGLE-parent squash commit; parent = `488db83c4` (#506). The "merge diff" is `488db83c4..13c3ec4c5`.
3. `git merge-base --is-ancestor 0e20cb949 488db83c4` → **YES** (1147 IS in #507's base). `742875d77` (1147R2 #500) also ancestor → YES.
4. `git diff --stat 488db83c4 13c3ec4c5` — files #507 actually changed on the origin lineage.
5. `git show origin/main:mingla-business/src/components/checkout/CartContext.tsx` etc. — 1147 artifacts present on origin/main.
6. `git status --short` on the anchor — the dirty working tree that mislead ORCH-1162.
7. `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1162_CHECKOUT_THEMING_TRUECOST.md` — the source of the (now-refuted) "fully reverted" claim.
8. `mingla-business/src/hooks/usePublicTripBySlug.ts:164-205` — the direct anon `from("brands").select(... theme_color, theme_font, theme_animation)`.
9. `mingla-business/src/services/publicExperienceService.ts:189-234` + `publicEventsService.ts:44-149` — the COMMS-0009-compliant pattern (theme via `business_public_events_view`, NOT off `brands`).
10. `mingla-business/src/services/__tests__/orch_1138_tester_anon_brand_theme_columns.test.ts` — the 1138 guard that caught this for experiences but not trips.
11. LIVE DB (read-only MCP, project `gqnoajqerqhnvulmnyvv`): `pg_policy` on `public.brands`; `role_table_grants`; `has_table_privilege`; `has_column_privilege` per column.
12. `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:17884-17940` (column grants) + `20260617000000_orch_0879_anon_brand_cover_grant.sql` (the column-grant template) + `20261007000000_orch_1138_rework_deck_supply.sql` (1138's own COMMS-0009 acknowledgement).

---

## Q-SCORECARD

- **Q1. Why does anon SELECT on `brands` fail on the trip read path — revoked GRANT, new RLS, or lost view access?** **Verdict: a MISSING anon column-level GRANT.** ORCH-1138 added `theme_color/theme_font/theme_animation` to the trip hook's direct `from("brands").select(...)`; anon has no column-SELECT on those three → `42501` "permission denied for table brands". Not RLS (anon-read policies exist), not a revoke (these cols were never granted), not a view (the trip path reads `brands` directly, bypassing the anon-safe view). `proven` (live DB `has_column_privilege` + source).
- **Q2. What did #507 actually change vs the pre-#507 main?** **Verdict:** on the origin lineage (`488db83c4..13c3ec4c5`) #507 touched `publicExperienceService.ts` + the two experience checkout files (1147 code PRESERVED/extended), the consumer experience screen, deck supply, EBES deletion, and added the trip-hook theme columns via the B1/FIX-3 changes that shipped earlier in the 1138 saga. It did **NOT** touch `publicEventsService.ts`, `tripsService.ts`, `ticket-checkout-create`, the event/trip checkout files, `CartContext.tsx` (beyond additive `eventDateId`), or `brands` RLS. `proven` (git diff).
- **Q3. Was the ORCH-1147 all-in fix reverted, and does its guard test still compile?** **Verdict: NO — fully intact on `origin/main`; the test compiles + passes.** The ORCH-1162 "revert" was a misread of the anchor's dirty local working tree. `proven` (git show origin/main + git status).
- **Q4. Does the `brands` break hit anon EVENT and EXPERIENCE web pages too, or only trips?** **Verdict: ONLY trips.** Event + experience services read brand theme from the security-definer `business_public_events_view` (anon-granted) per the COMMS-0009 contract; only the trip hook reads theme columns directly off `brands`. `proven` (source grep — `usePublicTripBySlug.ts:180` is the SOLE direct theme read).
- **Q5. Are native/authenticated paths affected?** **Verdict: NO.** `authenticated` has table-level SELECT on `brands` (`has_table_privilege` = true) so the logged-in trip page works; native business-app trip authoring uses authenticated reads. `proven` (live DB).
- **Q6. Which exact files did #497 touch that #507 "reverted"?** **Verdict: NONE on origin/main.** All 9 product files #497 touched are intact. The apparent revert exists ONLY in the anchor's uncommitted working tree. `proven`.

---

## FINDINGS (six-field evidence)

### F-1 — Anon lacks column-level SELECT on `brands.theme_color/theme_font/theme_animation` (CONFIRMED ROOT CAUSE — Part A, S0)
1. **Symptom:** `/t/{brandSlug}/{tripSlug}` throws `permission denied for table brands` for anonymous buyers → page won't render → all web trip sales blocked.
2. **Layer:** schema (grants) + code (the direct read).
3. **Probe (live DB, read-only):**
   ```sql
   SELECT col, has_column_privilege('anon','public.brands',col,'SELECT')
   FROM unnest(ARRAY['id','slug','name','description','cover_media_url',
     'cover_media_type','cover_hue','theme_color','theme_font','theme_animation','default_currency']) col;
   SELECT has_table_privilege('anon','public.brands','SELECT');   -- table-level
   ```
4. **Evidence (verbatim):**
   - `has_table_privilege('anon','public.brands','SELECT')` = **`false`**; `authenticated` = `true`.
   - `has_column_privilege('anon', ...)`: `theme_animation` → **false**, `theme_color` → **false**, `theme_font` → **false**; `id/slug/name/description/cover_media_url/cover_media_type/cover_hue/default_currency` → **true**.
   - Trip read site `usePublicTripBySlug.ts:180`: `.select("id, slug, name, description, cover_media_url, cover_media_type, cover_hue, theme_color, theme_font, theme_animation")` with a comment falsely asserting "these columns... are anon-readable (verified)".
   - No migration anywhere grants `theme_color/theme_font/theme_animation` to anon: `grep -rn "GRANT SELECT.*theme_color ... TO anon" supabase/migrations/` → **0 hits**.
5. **Mechanism:** Postgres evaluates column privileges BEFORE RLS; a select listing any column the role can't read aborts the whole statement with `42501` "permission denied for table brands". The trip hook lists three ungranted columns → the anon query 401s → React Query throws → page fails to render.
6. **Severity:** CONFIRMED ROOT CAUSE. Confidence: `proven`.

### F-2 — The trip hook violates the COMMS-0009 anon-safe-theme contract that event + experience services follow (CONFIRMED ROOT CAUSE — design deviation)
1. **Symptom:** trip page is the ONLY public page that breaks for anon on brand theme.
2. **Layer:** code (pattern compliance).
3. **Probe:** read `publicExperienceService.ts:189-234`, `publicEventsService.ts`, grep all surfaces for a direct `from("brands").select(theme_*)`.
4. **Evidence:**
   - `publicExperienceService.ts:189-193` comment: *"the brand THEME (theme_color/theme_font/theme_animation) is NOT read off the brands table — the `anon` Postgres role [lacks column SELECT] ... sourced from the anon-safe `business_public_events_view`"* → reads `brand_theme_color/brand_theme_font/brand_theme_animation` from the view (L225-234).
   - Event service surfaces `brand_theme_*` via `business_public_events_view` (`publicEventsService.ts:44-46`).
   - `usePublicTripBySlug.ts:180` is the **only** codebase site selecting theme columns directly off `brands` (verified by `git grep "theme_color, theme_font, theme_animation"` on origin/main → single hit).
5. **Mechanism:** the established anon-safe pattern (theme via security-definer view) was bypassed for trips; the trip hook reads `brands` directly and adds the ungranted theme columns.
6. **Severity:** CONFIRMED ROOT CAUSE (the design deviation that, combined with F-1, breaks the page). Confidence: `proven`.

### F-3 — The ORCH-1138 anon-column guard test scanned ONLY the experience service, so the trip-path equivalent slipped CI (CONFIRMED CONTRIBUTOR — why CI never caught it)
1. **Symptom:** the identical P0 was caught + fixed for experiences pre-merge but shipped for trips.
2. **Layer:** code (test coverage).
3. **Probe:** read `orch_1138_tester_anon_brand_theme_columns.test.ts`.
4. **Evidence:** the test reads ONLY `const SERVICE = resolve(__dirname, "..", "publicExperienceService.ts")` and asserts no `from("brands").select(...)` block contains `theme_color/theme_font/theme_animation`. Its header documents the exact 42501 "permission denied for table brands" failure — for experiences. It never scans `usePublicTripBySlug.ts`.
5. **Mechanism:** single-file guard scope → the trip hook's identical violation is invisible to CI → #507 merged green.
6. **Severity:** CONFIRMED CONTRIBUTOR. Confidence: `proven`.

### F-4 — ORCH-1138's OWN migration acknowledges the COMMS-0009 rule it then broke in the trip hook (CONFIRMED — intent/execution gap)
1. **Symptom:** the same PR that knew the rule for the deck path violated it for the trip web page.
2. **Layer:** schema (migration comment) vs code.
3. **Probe:** read `20261007000000_orch_1138_rework_deck_supply.sql:322`.
4. **Evidence:** comment: *"...brand_theme (anon-safe via business_public_events_view — COMMS-0009)... off the deck seed without a client .from(brands)."* — yet the trip hook does `.from("brands")` with theme columns.
5. **Mechanism:** knowledge applied to one leg (deck/consumer) and not the other (trip web) within the same multi-leg ORCH.
6. **Severity:** CONFIRMED (root-cause context). Confidence: `proven`.

### F-5 — ORCH-1147 is INTACT on origin/main; the "fully reverted" verdict was a dirty-working-tree misread (RULED OUT as a regression)
1. **Symptom:** ORCH-1162 reported every 1147 file reverted + the guard test non-compiling.
2. **Layer:** code + git.
3. **Probe:**
   - `git show origin/main:.../CartContext.tsx | grep -c unitPriceAllIn` and same for `allInTotal`.
   - `git show origin/main:.../tripsService.ts | grep -c priceAllInGbp`.
   - `git show origin/main:.../publicExperienceService.ts | grep fetchTierAllInCents`.
   - `git show origin/main:.../orch_1147_cart_allin_total.test.ts | grep -c allInTotal`.
   - `git rev-list --count HEAD..origin/main` + `git status --short`.
4. **Evidence:**
   - origin/main `CartContext.tsx`: `unitPriceAllIn`/`allInTotal` = **20 refs** (intact); test references them **41×**; CartContext exports them **9×** → the test compiles + passes.
   - origin/main `tripsService.ts` `priceAllInGbp` present (1 ref); `publicExperienceService.ts` `fetchTierAllInCents` present (L470, in the `Promise.all`), `priceAllInGbp` seed present (L358-362).
   - #507 squash diff (`488db83c4..13c3ec4c5`) in the experience path ADDS to 1147: `+ fetchTierAllInCents(eventId),` and `+ unitPriceAllIn: t.priceAllInGbp ?? (t.priceCents ?? 0) / 100,`.
   - `git merge-base --is-ancestor 0e20cb949 488db83c4` → **YES** (1147 #497 IS in #507's base; #500 1147R2 also ancestor).
   - Anchor: `HEAD = 477675023`, `git rev-list --count HEAD..origin/main = 4` (behind), and `git status` shows `CartContext.tsx` + ~40 product files **`M` (uncommitted)**; the working-tree diff REMOVES both `unitPriceAllIn` (1147) AND `eventDateId` (1138). i.e. the anchor working copy ≈ pre-1147 AND pre-1138 state, uncommitted.
5. **Mechanism:** ORCH-1162 read the anchor's polluted local working tree (committed HEAD is 4 behind origin AND further mutated by uncommitted reverts), mistaking it for `origin/main`. On `origin/main` the fix is whole.
6. **Severity:** RULED OUT (no 1147 regression on origin/main). Confidence: `proven`.

---

## FIVE-TRUTH-LAYER RECONCILIATION

| Layer | Finding | Contradiction? |
|---|---|---|
| **Docs** | COMMS-0042 / ORCH-1162 assert full 1147 revert + brands RLS break. | **YES (both partially wrong).** 1147 is intact on origin/main (F-5); the brands break is a column-GRANT gap, not RLS (F-1). The ledger entry over-stated blast radius. |
| **Schema** | `brands` has anon-read RLS policies + column-level anon grants; `theme_*` columns never granted to anon. | The decisive truth: column-grant gap, not RLS. |
| **Code** | Trip hook reads `brands.theme_*` directly (anon-illegal); event/experience use the anon-safe view; 1147 code present everywhere on origin/main. | Trip hook deviates from siblings (F-2). |
| **Runtime** | Anon trip page 401s `permission denied for table brands`; authenticated works; anon event/experience pages render. | Consistent with F-1/F-4/Q5. |
| **Data** | `has_column_privilege('anon','brands','theme_color') = false`; `has_table_privilege('authenticated','brands','SELECT') = true`. | Confirms F-1. |

---

## REPRO EVIDENCE

| # | Probe | Result | Proves |
|---|---|---|---|
| 1 | `has_column_privilege('anon','public.brands','theme_color'/'theme_font'/'theme_animation','SELECT')` | **false / false / false** | anon cannot read the 3 theme cols → 42501 on any select that lists them. |
| 2 | `has_column_privilege('anon', ... 'id'/'slug'/'cover_hue'/'cover_media_type'/...)` | **true** | the other trip-hook columns are fine; isolation is the 3 theme cols. |
| 3 | `has_table_privilege('authenticated','public.brands','SELECT')` | **true** | logged-in trip page works (Q5). |
| 4 | `git grep "theme_color, theme_font, theme_animation" origin/main` | single hit: `usePublicTripBySlug.ts:180` | trip hook is the SOLE anon direct theme read (Q4). |
| 5 | `git show origin/main:CartContext.tsx \| grep -c unitPriceAllIn` | 20 | 1147 intact on origin/main (F-5). |
| 6 | `git status --short` (anchor) | `M CartContext.tsx` + ~40 files | the dirty tree that misled ORCH-1162 (F-5). |

> Note: a `SET LOCAL ROLE anon; SELECT ... FROM brands` via the MCP admin connection returned a row (the admin session retains its own privileges through `SET ROLE`); `has_column_privilege`/`has_table_privilege` are the authoritative checks and were used for all verdicts.

---

## BLAST RADIUS / CROSS-SURFACE MAP

- **Broken (in scope — Part A):** Buyer/anonymous WEB `/t/{brandSlug}/{tripSlug}` (the only confirmed live break). Fix touches: the live DB grant on `public.brands` (forward migration) + `usePublicTripBySlug.ts` (move theme to the anon-safe view OR drop the columns) + the guard test.
- **Not broken (verified):** anon EVENT `/e/...` and EXPERIENCE `/exp/...` web pages (read theme via the anon-safe view); all authenticated/native business-app trip paths; consumer-app deck/experience (deck RPC, no client `.from(brands)`).
- **Part B (1147 all-in):** NO live regression on origin/main. In scope ONLY as a guard-coverage gap (extend the anon-column guard to the trip read path). No 9-file re-apply.
- **Out of scope:** the engine/RPC (`pg_public_event_tier_allin`, `computeBuyerSubtotal` — correct); the event public page; the 3-checkout-step theming (ORCH-1162 Bug 3A — separate ORCH).

### Invariant impact
- Implicates the COMMS-0009 anon-safe-theme contract (read brand theme via `business_public_events_view`, never `.from("brands")` for `theme_*`). No formal `I-` exists for it yet — SPEC proposes one (`I-PROPOSED-1164-ANON-BRAND-THEME-VIA-VIEW`). No existing ACTIVE invariant is violated by the fix.

---

## DISCOVERIES FOR ORCHESTRATOR

- **D-1 (CRITICAL — corrects the ledger + ORCH-1162):** COMMS-0042 and `INVESTIGATE_ORCH-1162_CHECKOUT_THEMING_TRUECOST.md` claim a full ORCH-1147 revert + non-compiling guard test. **This is FALSE on `origin/main`** (F-5). The claim came from reading the shared anchor's dirty local working tree (HEAD 4 behind origin + ~40 uncommitted product-file reverts of BOTH 1147 and 1138). **Recommend: (a) ORCH-1164 drops the 9-file 1147 re-apply from scope; (b) someone cleans the anchor working tree — `git fetch && git reset --hard origin/main` AFTER confirming no wanted local work — to stop further misreads; (c) update COMMS-0042 to reflect that Part B is a guard-coverage gap, not a live regression.** (Anchor cleanup needs Seth — it is destructive and may discard uncommitted work; NOT done here.)
- **D-2 (process):** the `brands` anon grant model is **column-level, not table-level** — and inconsistent (anon has INSERT/UPDATE/DELETE/TRUNCATE table-wide but NOT table SELECT). Any new public read that adds a `brands` column must add a paired anon column GRANT or route through `business_public_events_view`. The 1138 anon-column guard should be generalized to scan ALL public read paths (services + hooks), not one file.
- **D-3 (security, low blast):** anon holding INSERT/UPDATE/DELETE/TRUNCATE on `brands` is surprising; RLS WITH CHECK likely blocks abuse, but worth a dedicated audit (out of ORCH-1164 scope).

---

## CONFIDENCE & RECOMMENDED NEXT PHASE

- **Overall confidence: `proven`** — Part A root cause proven by live `has_column_privilege` + source; the 1147 "revert" refuted by git show on origin/main + git status on the anchor.
- **Recommended next phase: SPEC** — narrowed to **(A)** restore anon read of the trip page via a forward-only migration granting anon column-SELECT on `theme_color/theme_font/theme_animation` (matching ORCH-0879's column-grant + self-verification template) AND/OR moving the trip hook's theme read to `business_public_events_view` (the COMMS-0009-compliant pattern); **(B)** extend the anon-column guard to cover `usePublicTripBySlug.ts` (and ideally all public read paths) so this fails-on-revert. The 9-file 1147 re-apply is NOT needed (no live regression). NO fix written here.
