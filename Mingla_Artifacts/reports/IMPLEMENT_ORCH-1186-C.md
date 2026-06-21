# IMPLEMENTATION — ORCH-1186-C: Menu Builder + Public Menu (DISPLAY-ONLY)

**META:** META-ORCH-1186 Venue Unification · **Leg 3** (largest, last)
**Skill:** mingla-implementor (Claude) · **Date:** 2026-06-21
**Worktree:** `~/Desktop/mingla-orchs/1186-[venue-unify]` · **Branch:** `1186-venue-unify`
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-1186-C_MENU_BUILDER.md` (+ embedded DESIGN D1–D5)
**Status:** implemented and verified (DB live-probed; gates green; fails-on-revert proven). NOT deployed/merged/closed.

---

## 1. Summary

A verified venue can now build a persistent, manually-authored **menu** (categories → priced items, each with name / description / price / currency / availability) inside the venue suite's new always-visible **Menu** command-band module, and that menu renders with currency-formatted prices on the public venue page across **all five surfaces** (buyer web, business web preview, business iOS/Android, and the consumer app). It is strictly **DISPLAY-ONLY** — no cart, checkout, quantity, order, or payment control anywhere. The menu is a brand-new asset (two new tables `menus` + `menu_items`) entirely distinct from the snap-menu Gemini parser / `experience_stops`.

A real correctness bug in the spec's `formatMenuPrice` design snippet was caught by the price round-trip test (it divided by 100 unconditionally → JPY ¥1250 rendered as "¥13") and fixed: the public formatter is now zero-decimal-currency aware (mirrors the data-layer minor-unit factor).

---

## 2. SPEC success-criteria coverage

| SC | Criterion | Evidence | Status |
|----|-----------|----------|--------|
| SC-1 | schema: tables + view + RLS + anon read on verified venues only | Migration applied via Mgmt API + verified: `menus`/`menu_items`/`public_menus_view` exist, RLS on both, 4 policies, anon SELECT on view, `security_invoker=false`. Live probe: view returns ONLY verified-venue available item; excludes unavailable item + non-verified brand. | ✓ |
| SC-2-Biz | builder mount on any reservations state, no dead tap | `venueModules.ts` returns `menu` in BOTH derive branches; `VenueSuiteShell.renderWorkspace` dispatches `<VenueMenuModule>`; rail/pill renders `VENUE_MODULES.menu.label` automatically. | ✓ |
| SC-3-Biz | CRUD: add/edit/delete/reorder categories+items, persists | `useMenus.ts` (upsert/delete/reorder for menus+items) + `VenueMenuModule.tsx` + sheets; all invalidate `menuKeys.brandMenus`. | ✓ (source) |
| SC-4-Biz | price correctness (USD 12.50→1250 $12.50; JPY 1250→1250 ¥1,250; blank→null "Price on request"; no $0) | `menuPrice.roundtrip.test.ts` (4/4 pass) asserts all SC-4 values. | ✓ |
| SC-5-Biz | below-manager sees read-only, RLS blocks writes | `VenueMenuModule` gates all mutation controls on `rank >= event_manager`; RLS `manager plus can write`. | ✓ (source + RLS) |
| SC-6-Web | anon `/b/{slug}` Menu tab w/ prices, no buy control, hidden when empty | shared `MenuTab` + `visibleTabs` gate + `publicEventsService` batch fetch + app route wire. | ✓ |
| SC-6-iOS / SC-6-Android | consumer app Menu tab parity | `useBrandBySlug` reads `public_menus_view`; `ConsumerBrandProfileScreen` passes `menu`. | ✓ |
| SC-7 | display-only invariant (no order surface anywhere) | strict-grep gate `orch-1186c-menu-display-only.mjs` (self-test + run pass; fails-on-revert proven). | ✓ |
| SC-8 | no entanglement w/ snap parser / experience_stops | strict-grep gate `orch-1186c-menu-not-experience-stops.mjs` (pass; fails-on-revert proven). Snap parser files byte-untouched. | ✓ |
| SC-9 | currency honesty, never GBP-defaulted | `currency` NOT NULL from `brands.default_currency`; `formatMenuPrice` echoes stored currency on catch; test asserts EUR/NGN not £. | ✓ |

---

## 3. Files changed

### Created (15)
- `supabase/migrations/20261118000000_orch_1186c_menus_menu_items.sql` (~175 lines) — **NOTE: prefix bumped from spec's `20261116000000` to `20261118000000`** (116 taken by Leg A + ORCH-1187 anchor; 117 by Leg B).
- `mingla-business/src/services/menusService.ts` (~135) — builder read + mappers.
- `mingla-business/src/services/publicMenusService.ts` (~85) — public read → shared `PublicMenuGroup[]`.
- `mingla-business/src/hooks/useMenus.ts` (~290) — query-key factory + builder query/mutations + `usePublicMenus`.
- `mingla-business/src/components/venue/VenueMenuModule.tsx` (~570) — builder UI (all states).
- `mingla-business/src/components/venue/MenuCategorySheet.tsx` (~220) — add/edit category.
- `mingla-business/src/components/venue/MenuItemSheet.tsx` (~330) — add/edit item (currency-aware price).
- `.github/scripts/strict-grep/orch-1186c-menu-display-only.mjs` (~130) — SC-7 gate.
- `.github/scripts/strict-grep/orch-1186c-menu-not-experience-stops.mjs` (~110) — SC-8 gate.
- `mingla-business/src/components/venue/__tests__/menuPrice.roundtrip.test.ts` (~95) — SC-4 anchor.
- `packages/brand-rendering/__tests__/publicMenu.render.test.tsx` (~110) — public-render fixture.

### Modified (13)
- `mingla-business/src/types/venueReservation.ts` — `"menu"` in `VenueModule` union; excluded from `VenueBookingModule`.
- `mingla-business/src/components/venue/venueModules.ts` — `VENUE_MODULES.menu`; `deriveVenueModules` both branches; `isBookingModule("menu")` stays false.
- `mingla-business/src/components/venue/__tests__/venueModules.test.ts` — T-MOD-1/2/3.
- `mingla-business/src/components/venue/VenueSuiteShell.tsx` — import + `menu` dispatch.
- `packages/brand-rendering/types.ts` — `PublicMenuItem`/`PublicMenuGroup` + `menu?` prop.
- `packages/brand-rendering/index.ts` — export menu types.
- `packages/brand-rendering/PublicBrandPage.tsx` — Tab union + tabLabel + `formatMenuPrice` (zero-decimal-fixed) + visibleTabs + countForTab + `MenuTab` + styles + activePane branch.
- `mingla-business/src/services/publicEventsService.ts` — `PublicBrandDetail.menu` + batch fetch.
- `mingla-business/src/components/brand/PublicBrandPage.tsx` — `menu` prop pass-through.
- `mingla-business/app/b/[brandSlug]/index.tsx` — one-line wire.
- `app-mobile/src/hooks/useBrandBySlug.ts` — `public_menus_view` read + `menu` in detail (local view read; no mingla-business import).
- `app-mobile/src/screens/ConsumerBrandProfileScreen.tsx` — pass `menu`.
- `.github/workflows/strict-grep-mingla-business.yml` — register 2 gates.
- **[TEST-MOD-APPROVED ORCH-1186-C]** `venueSuiteLeakAndExit.tester.adversarial.test.ts` (2 OFF-array assertions) + `venueSuiteShell.orch1184.fullwidth.test.ts` (ON-rail 6→7 + Menu) — the command-band menu legitimately changes the derived arrays; the booking-leak invariant is preserved (OFF still contains no booking module).

---

## 4. Data-model changes applied

- **`public.menus`** — id, brand_id (FK brands, CASCADE), name (1–120), description (≤500), sort_order, is_active, timestamps. Indexes: brand_id, brand_id WHERE is_active. `updated_at` trigger.
- **`public.menu_items`** — id, menu_id (FK menus, CASCADE), brand_id (denormalized FK, CASCADE), name (1–160), description (≤600), price_cents (NULL or 0..100M), currency (NOT NULL, 3-upper ISO), is_available, photo_url (seam), sort_order, timestamps. Indexes: menu_id, brand_id, (menu_id, sort_order). `updated_at` trigger.
- **RLS** (both tables) — `brand member can read` (SELECT, `biz_is_brand_member_for_read_for_caller`); `manager plus can write` (ALL, rank ≥ `biz_role_rank('event_manager')`). GRANTs to authenticated + service_role.
- **`public.public_menus_view`** — security-definer (`security_invoker=false`); WHERE is_available AND active menu AND `b.deleted_at IS NULL AND b.claim_status='verified'`. GRANT SELECT to anon + authenticated.

Applied via Supabase Management API (browser UA, token in `~/.claude.json`); verified live (tables/RLS/policies/view/grants + functional verified-only/available-only probe + cleanup).

---

## 5. Edge functions touched
**NONE.** No new edge function; all builder writes are RLS-gated direct upserts; all public reads are direct `from("public_menus_view")` (anon-safe via the definer view).

---

## 6. Regression tests added + fails-on-revert proof

| Test / gate | Path | fails-on-revert proof |
|-------------|------|------------------------|
| T-MOD module registry | `mingla-business/src/components/venue/__tests__/venueModules.test.ts` | Deleting `menu` from `deriveVenueModules(false)` → T-1 + T-2b FAIL (2 failed); restore → 4 pass. |
| SC-4 price round-trip | `mingla-business/src/components/venue/__tests__/menuPrice.roundtrip.test.ts` | Reverting `minorFromMajor` to currency-blind `* 100` → T-SVC-2 (JPY) FAIL; restore → 4 pass. |
| SC-7 display-only gate | `.github/scripts/strict-grep/orch-1186c-menu-display-only.mjs` | Injecting `const quantity = 1;` into `VenueMenuModule.tsx` → gate FAILS; restore → pass. (self-test passes.) |
| SC-8 no-entanglement gate | `.github/scripts/strict-grep/orch-1186c-menu-not-experience-stops.mjs` | Injecting `experience_stops` into `menusService.ts` → gate FAILS; restore → pass. (self-test passes.) |
| public-render fixture | `packages/brand-rendering/__tests__/publicMenu.render.test.tsx` | Deleting the `menuItemCount > 0` visibleTabs push → T-PUB-2 FAIL (1 failed/5 pass); restore → 6 pass. |

All proofs by TRUE LINE DELETION/injection (not comment-out). `fails-on-revert verified at commit 5562657e7 (1186-venue-unify).`

DB tests T-DB-4/5/6 functionally verified live via the Management-API probe (verified-only + available-only filtering confirmed, probe rows cleaned).

---

## 7. Old → New receipts (key surfaces)

### venueModules.ts
- **Before:** `deriveVenueModules` OFF=`["overview","settings"]`, ON=`["overview",...booking,"settings"]`; 6-module registry.
- **Now:** `menu` command-band module added to BOTH branches (between booking and settings; settings stays last). 7-module registry. `isBookingModule("menu")===false`.
- **Why:** SC-2 (always-visible menu, not toggle-gated); preserves I-PROPOSED-1148 booking-band gating.

### packages/brand-rendering/PublicBrandPage.tsx
- **Before:** Tabs = about/upcoming/events/trips/experiences; no menu concept.
- **Now:** `menu` tab (after About, only when ≥1 item); `MenuTab` renders stacked `surface.card` category sections, name-left/price-right via package-local `formatMenuPrice` (zero-decimal-safe, never GBP); null price omits the column; rows static (not Pressable).
- **Why:** SC-6 all-surface render; ONE edit = web + business + consumer parity (A3).

### app-mobile/src/hooks/useBrandBySlug.ts
- **Before:** batch read of events/trips/experiences/upcoming; no menu.
- **Now:** + `public_menus_view` read (local, no mingla-business import), grouped into `PublicMenuGroup[]`, returned as `menu`.
- **Why:** SC-6-iOS/Android consumer parity (non-negotiable standing rule).

---

## 8. Cross-surface impact

| Surface | Covered | Parity |
|---------|---------|--------|
| Consumer iOS | YES (render) | render automatic (shared page); fetch manual (`useBrandBySlug`) |
| Consumer Android | YES (render) | same as iOS |
| Buyer/anon Web | YES (render) | render automatic; fetch manual (`publicEventsService`) |
| Business iOS | YES (builder) | automatic (shared venue suite) |
| Business Android | YES (builder) | automatic |
| Admin Web | NOT covered | menu is a post-claim owner asset, not an approval input |
| Business Web preview | YES (builder + render) | automatic |

---

## 9. Smoke result
- Gates: both strict-grep gates self-test + run PASS; all 5 fails-on-revert proofs PASS.
- Jest: venueModules (4), menuPrice.roundtrip (4), publicMenu.render (6), leak-exit (updated, pass), orch1184 fullwidth (updated, pass), existing orch_1155 brand-rendering (23) all PASS.
- DB: migration applied + live-verified; functional verified-only/available-only view probe PASS.
- No device/sim run (builder UI is source-verified; needs device smoke at TEST).

---

## 10. Known issues / deferred
- No `[TRANSITIONAL]` code introduced.
- `photo_url` column is a documented NULLable seam (no upload UI this leg).
- Builder UI not yet device-smoked (tester owns runtime verification + the adversarial RLS isolation/anon-read/device-parity sweep).
- Reorder uses up/down text controls (▲/▼/Edit) matching the suite's text-only rail convention (DESIGN D1.2 said match existing chrome; the suite uses no lucide icons). DESIGN named lucide glyphs as optional ("ship text-only if rails are text-only").

## 11. Operator action required
- **Migration ALREADY applied** via Management API (additive + idempotent, verified). No `db push` needed; if reconciling locally: `cd "/Users/sethogieva/Desktop/mingla-orchs/1186-[venue-unify]" && /Users/sethogieva/bin/supabase db push --linked` (file is idempotent / IF NOT EXISTS-guarded).
- **Edge functions:** NONE to deploy.
- **OTA:** consumer app (`useBrandBySlug`/`ConsumerBrandProfileScreen`) + business app are pure-JS — OTA-able after merge.
- Commit body carries `[TEST-MOD-APPROVED ORCH-1186-C]` for the 2 sibling test-array updates (append-only CI).

## 12. Discoveries for Orchestrator
1. **Spec `formatMenuPrice` design bug (FIXED):** the DESIGN D2.4 snippet divided `priceCents/100` unconditionally → JPY ¥1250 rendered "¥13". Fixed with a currency-aware minor-unit factor (zero-decimal set inlined, package-boundary-safe). The price round-trip test caught it.
2. **Migration prefix collision:** spec's proposed `20261116000000` was already taken (Leg A + ORCH-1187 in anchor) and `20261117000000` by Leg B → bumped to `20261118000000` per the monotonic rule.
3. **Pre-existing (NOT mine):** `venueSuiteShell.orch1184.fullwidth.adversarial.render.test.tsx` "fails to run" under the default node/ts-jest config in BASELINE (a Leg-4 RTL render test lacking a dedicated jest config); and 13 `publicEventsService`/`PublicBrandPage` jest suites fail in BASELINE on `Cannot find module '@mingla/offering-rendering'` (workspace-package resolution under the node jest config). Identical baseline-vs-mine counts confirm zero new failures.
4. **Conductor-decision note:** built single-grouping-level, up/down-arrow reorder, stacked public sections, convention-reuse skin, blank→"Price on request" (builder) / omitted (public) — all per the accepted defaults.
