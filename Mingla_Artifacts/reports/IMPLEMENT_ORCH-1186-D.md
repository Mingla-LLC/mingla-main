# IMPLEMENTATION — ORCH-1186-D: Blasts entry point in the venue tab

**META:** META-ORCH-1186 (Venue Unification) · **Leg 4 of 4** (smallest; REUSE ONLY)
**Skill:** mingla-implementor (Claude) · **Date:** 2026-06-21
**Worktree:** `~/Desktop/mingla-orchs/1186-[venue-unify]` · **Branch:** `1186-venue-unify`
**Built on:** HEAD `f5d406268` (Legs 1+2 already committed)
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1186-D_VENUE_BLASTS_ENTRY.md`
**Status:** implemented and verified (unit + render gates green; on-device smoke deferred to tester)

---

## 1. Summary

A venue owner managing their venue in the business app (Hub → Venue tab → Settings module) now
has **one "Message your guests" action row** that deep-links straight into the **existing** marketing
composer with the venue's brand audience pre-selected (`?audience=brand:{brandId}`). Pure navigation
+ audience pre-selection. No new composer, no new send/dispatch code, no new audience kind, no new
tables, no migration — exactly the REUSE-ONLY contract.

The composer URL is now centralized in one tiny pure helper, `buildComposeAudienceHref`, which is
the structural regression anchor: it always round-trips through the existing `parseAudienceParam`.

**OQ-1 (resolved by conductor before implement):** ship NOW against the existing ticket-buyer
audience (`brand_buyers`) with HONEST copy ("Message your ticket buyers" / "…people who've bought
tickets from this venue"). A reservation-guest audience kind is a separate follow-on ORCH — NOT
built here.

---

## 2. SPEC success-criteria coverage

| SC | Criterion | Status | Where / proof | Commit |
|----|-----------|--------|---------------|--------|
| SC-1 | "Message your guests" action row present + tappable in venue Settings | ✓ | `VenueSettingsModule.tsx` "Reach your guests" Section + Button `testID="venue-settings-message-guests"`; render test mounts + finds it | (this commit) |
| SC-2 | Tap calls `router.push("/marketing/campaigns/compose?audience=brand:{brandId}")` with this venue's brand id | ✓ | T-4 asserts exact `router.push` arg | (this commit) |
| SC-3 | On arrival the existing composer pre-selects the brand audience | ✓ (existing contract; NOT re-implemented) | Reuses `?audience=brand:{id}` → `parseAudienceParam` → `ensureBrandBuyersAudience`; no new code | (this commit) |
| SC-4 | `buildComposeAudienceHref("brand", id)` returns exact string AND parses back via `parseAudienceParam` to `{kind:"brand", id}` | ✓ | T-1 + T-2 round-trip unit test | (this commit) |
| SC-5 | Disabled state: `brandId === null` → no navigation, row `accessibilityState.disabled === true` | ✓ | T-5: handler early-returns + Button `disabled={brandId===null}` → `accessibilityState.disabled` | (this commit) |
| SC-6 | No regression to the 3 existing composer entry points (byte-identical URLs) | ✓ | Existing call sites left UNCHANGED (optional refactor skipped to minimize risk); `parseAudienceParam.test.ts` still green | (this commit) |

> Commit hash backfilled at commit time below; all SCs satisfied by a single scoped commit on
> branch `1186-venue-unify`.

---

## 3. Files changed

| File | Type | Δ |
|------|------|---|
| `mingla-business/src/utils/composeAudienceHref.ts` | NEW | +21 |
| `mingla-business/src/utils/__tests__/composeAudienceHref.test.ts` | NEW | +49 |
| `mingla-business/src/components/venue/VenueSettingsModule.tsx` | MODIFY | +40 |
| `mingla-business/src/components/venue/__tests__/venueSettingsModule.orch1186d.blastEntry.render.tsx` | NEW | +112 |
| `mingla-business/jest.orch1186d.render.cjs` | NEW (worktree-local render config, mirrors `jest.orch1184.adversarial.render.cjs`) | +55 |

No DO-NOT-TOUCH file touched: `venueModules.ts`, `compose.tsx`, `src/components/marketing/**`,
`src/services/marketing/**`, `src/hooks/marketing/**` (incl. `parseAudienceParam.ts` — import-only),
`supabase/migrations/**`, `supabase/functions/**`, `VenueSuiteShell.tsx` all untouched.

The optional byte-identical refactor of the 3 existing hand-built call sites
(`brand/[id]/blasts.tsx`, `event/[id]/blasts/index.tsx`, `(tabs)/marketing/audiences/index.tsx`)
was **skipped** — it is explicitly optional in §8 step 5 and skipping keeps the diff minimal/zero-risk.

---

## 4. Data-model changes applied

**NONE.** No tables, columns, constraints, indexes, RLS, or migrations. REUSE-ONLY.

## 5. Edge functions touched

**NONE.** `marketing-send`, `track-click`, `unsubscribe` untouched (no `verify_jwt` changes).

---

## 6. Regression tests added

### Util (default jest config, node env, ts-jest)
- `mingla-business/src/utils/__tests__/composeAudienceHref.test.ts` — T-1 (exact brand href),
  T-3 (exact event href), T-2 + T-2b (round-trip through `parseAudienceParam`). 4 tests, all PASS.
  Run: `npx jest src/utils/__tests__/composeAudienceHref.test.ts`

### Component render (worktree-local config `jest.orch1186d.render.cjs`, RN preset + RTL)
- `mingla-business/src/components/venue/__tests__/venueSettingsModule.orch1186d.blastEntry.render.tsx`
  — T-4 (real mount → press row → `router.push` called once with exact brand href),
  T-5 (null brand id → `accessibilityState.disabled === true`, no navigation). 2 tests, all PASS.
  Run: `npx jest --config jest.orch1186d.render.cjs --runInBand`

> Named `.render.tsx` (NOT `.test.tsx`) so the default node/ts-jest config (which lacks RTL) does
> NOT pick it up; it runs ONLY under its dedicated RN-preset config — same pattern as the existing
> `jest.orch1184.adversarial.render.cjs`. `@testing-library/react-native` + `react-test-renderer`
> resolve from `mingla-business/node_modules` (gitignored — NOT in the diff; provision with
> `npm i react-test-renderer@19.1.0 @testing-library/react-native@^13` if a fresh worktree lacks them).

### fails-on-revert proof (true LINE DELETION, not comment-out)
- **Component (T-4):** deleted the `router.push(buildComposeAudienceHref("brand", brandId) as never);`
  line inside `handleBlast` → T-4 FAILED ("Expected number of calls: 1, Received: 0"); restored → PASS.
- **Util (T-1/T-2/T-3/T-2b):** changed the helper's `{kind}:{id}` separator to `{kind}-{id}` → all 4
  FAILED (exact-string + round-trip); restored → all 4 PASS.
- **`fails-on-revert verified at f5d406268`** (branch `1186-venue-unify` HEAD at implement time).

---

## 7. Old → New receipts

### `mingla-business/src/utils/composeAudienceHref.ts` (NEW)
- **Before:** the composer deep-link URL was hand-built inline at 3 call sites with no single owner.
- **Now:** one pure helper `buildComposeAudienceHref(kind, id)` returns
  `/marketing/campaigns/compose?audience=${kind}:${id}`, reusing `AudienceKind` from
  `parseAudienceParam` so the union never drifts. The regression anchor.
- **Why:** SC-4 + §9 structural safeguard (centralize the URL so the round-trip test guards it).
- **Lines:** +21.

### `mingla-business/src/components/venue/VenueSettingsModule.tsx` (MODIFY)
- **Before:** the venue Settings module had reservations / fee / hours / details / photos / team
  sections but **no way to message guests** from inside the venue suite.
- **Now:** adds a `handleBlast` callback (null-guarded; `router.push(buildComposeAudienceHref("brand",
  brandId))`) and a "Reach your guests" Section with a "Message your guests" primary Button
  (`leadingIcon="send"`, `testID="venue-settings-message-guests"`, manager-plus gated via the same
  `canMutate` convention as the other action rows, disabled when `brandId === null`). Honest copy:
  "Message your ticket buyers" / "…people who've bought tickets from this venue."
- **Why:** SC-1, SC-2, SC-5 — the entry point.
- **Lines:** +40 (import + handler + Section). No existing logic altered; the new Section is a peer
  of the existing action rows, OUTSIDE the reservations branch, so it always renders.

---

## 8. Cross-surface impact table

| # | Surface | Affected | Behavior | Parity |
|---|---------|----------|----------|--------|
| 1 | Consumer iOS (`app-mobile`) | NO | venue management is business-app only | n/a |
| 2 | Consumer Android | NO | n/a | n/a |
| 3 | Buyer/anon Web | NO | public venue page does not host blasts | n/a |
| 4 | Business iOS | YES | new "Message your guests" row → existing composer pre-scoped to venue brand audience | automatic (shared RN component + shared composer route) |
| 5 | Business Android | YES | same | automatic |
| 6 | Admin Web | NO | n/a | n/a |
| 7 | Business Web preview | YES (free) | same action renders on business web; composer already supports wide-desktop | automatic |

Parity is **automatic** (one shared `VenueSettingsModule` + one shared composer route) → SCs not
split per-surface.

---

## 9. Smoke result

- Unit gate (`composeAudienceHref.test.ts` + `parseAudienceParam.test.ts`): **10 passed**.
- Render gate (`jest.orch1186d.render.cjs`): **2 passed** (T-4 nav arg + T-5 disabled).
- Booking-gate invariant (`venueModules.test.ts`, I-PROPOSED-1148-RESERVATION-TOGGLE-GATES-SUITE):
  **PASS** — registry untouched, gate intact.
- `tsc --noEmit`: **zero new errors in the 5 changed files** (pre-existing unrelated errors in
  checkout buyers / ComposerV2 / search adapters remain; none introduced by this leg).
- On-device / simulator smoke: **deferred to tester** (no native module change; pure JS nav).

---

## 10. Known issues / deferred

- **OQ-1 (conductor-resolved → option a):** the reused `brand` audience (`brand_buyers`) is
  orders-derived. A pure-reservations venue that has never sold event tickets resolves to an EMPTY
  audience; reservation guests are NOT reachable through this entry point today. Copy is honest about
  this ("ticket buyers"). The reservation-guest audience kind is a **separate follow-on ORCH** the
  conductor will register — NOT in this leg.
- **OQ-2:** the full buyer-list Blasts screen (`/brand/[id]/blasts`) is NOT linked from the venue tab
  (direct-to-composer only, per conductor decision). One nav line to that existing route if wanted later.
- No `[TRANSITIONAL]` code introduced.

## 11. Operator action required

- **Migration `db push`:** NONE (no migration).
- **Edge-fn deploy:** NONE.
- **Tester provisioning note:** the render test needs `@testing-library/react-native@^13` +
  `react-test-renderer@19.1.0` in `mingla-business/node_modules` (gitignored, already provisioned in
  this worktree). Run: `cd mingla-business && npx jest --config jest.orch1186d.render.cjs --runInBand`.

## 12. Discoveries for Orchestrator

- **Reservation-guest audience is a clean follow-on** (conductor already plans to register it):
  mirror `resolveRsvpGuests` (ORCH-1150) with a `venue_reservation_guests` resolver + a new
  `parseAudienceParam` kind + an `ensure*Audience` seeder. It also benefits the Marketing Hub, not
  just the venue tab.
- **Pre-existing `tsc` errors** across `mingla-business` (checkout buyers implicit-any, ComposerV2
  type mismatches, `@mingla/payments-native` unresolved, several `DraftEvent`-shape test errors) are
  unrelated to this leg but present on the branch — flagged, not touched.
- **Comms ledger:** scanned; no BLOCK targets `mingla-implementor` / ORCH-1186 / ALL. WARN
  COMMS-0040/0041 (public RSVP/experience page-body standardization) do not overlap any file in this
  leg. COMMS-0050 (do-not-delete `origin/ORCH-1158-…`) is RESOLVED. No new entry written (no
  cross-ORCH discovery).
