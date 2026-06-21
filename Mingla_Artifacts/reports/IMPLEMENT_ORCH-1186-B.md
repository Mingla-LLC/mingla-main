# IMPLEMENT — ORCH-1186-B: Venue Overview → Intelligence Dashboard

**META:** META-ORCH-1186 Venue Unification · **Leg:** 2
**Worktree:** `~/Desktop/mingla-orchs/1186-[venue-unify]` · **Branch:** `1186-venue-unify`
**Base:** Leg 1 (ORCH-1186-A) at `46595f2c8` (local-only on this branch).
**Commits:** `f1ca1072f` (data layer + module) · `f5d406268` (shell repoint — LAST, OQ-1).
**Date:** 2026-06-21 · **Status:** implemented and verified (RPC live-probed; UI unverified on device — see §9).

---

## 1. Summary

The venue suite's **Overview** module is now a read-only **intelligence dashboard** instead of the listing recap (relocated to Settings by Leg 1). It surfaces, from REAL data only: lifetime/7-day revenue + a 30-day trend sparkline, slow-hours (24-bar), slow-days (7-bar), and "which moments you win" (AI signal scores) — plus three honest **"Coming soon"** roadmap tiles (busy-hours, page-views, signal→bookings) that carry NO data. All time bucketing happens server-side in the **venue's local timezone**; all revenue is **per-currency** (never cross-summed); every insufficient-data tile shows an honest empty state with NO numbers/$/bars (Constitution #9). A new owner-only RPC `venue_intelligence_overview` does the rollup (orders link to a venue only via their events; there is no `biz_event_orders` table).

---

## 2. SPEC success-criteria coverage

| SC | Criterion | Verified how | Status | Commit |
|----|-----------|--------------|--------|--------|
| SC-1 | RPC slow-hours tz-local (UTC 01:30Z → EDT hour 21, not 1) | live DB probe T-1 | ✓ PASS | `f1ca1072f` |
| SC-2 | RPC slow-days, Mon=0 (Tue→1, Sun→6) | live DB probe T-2 | ✓ PASS | `f1ca1072f` |
| SC-3 | RPC currency safety (USD+GBP separate; trend=default; no cross-sum) | live DB probe T-4 | ✓ PASS | `f1ca1072f` |
| SC-4 | RPC authz (non-owner → 42501) | live DB probe T-5 | ✓ PASS | `f1ca1072f` |
| SC-5-iOS/Android | Empty (no orders): E-A + E-B/E-C, no $/bars | component branch + no-fab grep | ✓ PASS (source) / UNVERIFIED (device) | `f1ca1072f` |
| SC-6-iOS/Android | Populated (≥14): sparkline + 24/7 bars + score bars | component code + helpers test | ✓ PASS (source) / UNVERIFIED (device) | `f1ca1072f` |
| SC-7 | tz footnote when confidence≠iana; "times in {zone}" chip when iana | component code | ✓ PASS (source) / UNVERIFIED (device) | `f1ca1072f` |
| SC-8 | Coming-soon honesty (title+pill+desc, no $/number/bar) | no-fab grep test (fails-on-revert proven) | ✓ PASS | `f1ca1072f` |
| SC-9 | No listing recap at Overview; invitation card kept | shell-grep test (fails-on-revert proven) | ✓ PASS | `f5d406268` |
| SC-10 | Currency-aware headline via formatCurrencyRound | no-fab grep + code | ✓ PASS | `f1ca1072f` |

---

## 3. Files changed (vs Leg 1 `46595f2c8`)

| File | Δ | Kind |
|------|---|------|
| `supabase/migrations/20261117000000_orch_1186b_venue_intelligence_overview.sql` | +298 | new (RPC) |
| `supabase/migrations/__tests__/orch_1186b_venue_intelligence_overview.test.sql` | +126 | new (SQL probe T-1..T-7) |
| `mingla-business/src/services/venueIntelligenceService.ts` | +129 | new |
| `mingla-business/src/hooks/useVenueIntelligence.ts` | +44 | new |
| `mingla-business/src/components/venue/venueIntelligence.ts` | +89 | new (pure helpers + threshold) |
| `mingla-business/src/components/venue/VenueIntelligenceModule.tsx` | +747 | new (dashboard) |
| `mingla-business/src/components/venue/VenueSuiteShell.tsx` | +19/−18 | edit (Overview-slot repoint) |
| `mingla-business/src/components/venue/__tests__/venueIntelligence.helpers.test.ts` | +62 | new test |
| `mingla-business/src/components/venue/__tests__/venueIntelligence.noFabrication.test.ts` | +104 | new test (Safeguard 2) |
| `mingla-business/src/components/venue/__tests__/venueSuiteShell.overviewIntelligence.test.ts` | +38 | new test (Safeguard 3) |

Total: 10 files, +1656 / −18.

---

## 4. Data-model changes applied

- **No new table, no new column, no RLS change.** One new function:
  `public.venue_intelligence_overview(p_brand_id uuid) RETURNS jsonb`,
  `SECURITY DEFINER`, `SET search_path = public`, `LANGUAGE plpgsql`.
  - Owner-only: `auth.uid() = brands.account_id` (verified the column is
    `account_id`, FK → `creator_accounts(id)` → `auth.users`) → `RAISE … 42501`.
  - `REVOKE ALL … FROM PUBLIC/anon; GRANT EXECUTE … TO authenticated`.
  - **Applied via the Supabase Management API / MCP** (SPEC §8 sanctioned path; NOT `db push`). **Verified post-apply** by `pg_proc` introspection: `prosecdef=true`, `proconfig=[search_path=public]`, EXECUTE grantees `{authenticated, service_role, postgres}` (anon NOT present).
- **Source set:** `orders o JOIN events e ON e.id=o.event_id AND e.brand_id=p_brand_id AND e.deleted_at IS NULL WHERE o.payment_status NOT IN ('failed','cancelled','refunded')`. Order timestamp = `COALESCE(confirmed_at, created_at)`; net = `total_cents − COALESCE(refunded_amount_cents,0)`.
- **TZ ladder:** `venue_availability_config.iana_timezone` → most-common non-UTC `events.timezone` → `place_pool.utc_offset_minutes` (fixed-offset, `tz_confidence='offset'`) → `'UTC'`.
- **Key finding (verified, deviation from SPEC's stated shape):** `place_pool.ai_signal_scores` is a JSONB **object** keyed by signal id (`{score_0_to_100, inappropriate_for, …}`), NOT an array. The RPC transforms it via `jsonb_each` → `[{id, score}]` desc, dropping `inappropriate_for=true` — matching `VenueListingContent.scoreRows`. The returned `signal_scores` array contract is unchanged.

---

## 5. Edge functions touched

None. No edge-function deploy required for this leg.

---

## 6. Regression tests added

- **Safeguard 1 — aggregation correctness (SQL):** `supabase/migrations/__tests__/orch_1186b_venue_intelligence_overview.test.sql` — seeds a throwaway NY venue + orders in a transaction, calls the RPC, asserts T-1..T-7, ALWAYS rolls back. **Live-DB probe-verified PASS** (each assertion ran green before the rollback sentinel).
  - **fails-on-revert (DB, proven by reasoning + the live probe design):** reverting `AT TIME ZONE v_tz` to raw UTC flips T-1 (hour 21→1); reverting `((dow+6)%7)` flips T-2/T-3 (Sunday→0 not 6); reverting per-currency buckets to a cross-currency SUM flips T-4. The probe asserts the exact post-remap values (h21=1, h1=0, Sun=6, USD=11000, GBP=2000) so any of those reverts makes the probe RAISE.
- **Safeguard 2 — no-fabrication grep (jest):** `…/__tests__/venueIntelligence.noFabrication.test.ts` (4 tests). **fails-on-revert verified at `f5d406268`:** injecting a fake `$1,240` into a coming-soon tile flipped the "contains NO $" assertion to FAIL; lowering `INTELLIGENCE_MIN_ORDERS_FOR_TIME_BUCKETS` to 0 flipped the threshold-anchor assertion to FAIL (both restored → PASS).
- **Safeguard 3 — overview-no-listing-recap (jest):** `…/__tests__/venueSuiteShell.overviewIntelligence.test.ts` (3 tests). **fails-on-revert verified at `f5d406268`:** re-mounting `<VenueListingContent>` in the Overview branch (true line replacement) flipped the "does NOT render the listing recap" assertion to FAIL (restored → PASS).
- **Happy-path helpers (jest):** `…/__tests__/venueIntelligence.helpers.test.ts` (8 tests) — bar normalization, tie detection, 12-hour labels, 0=Mon weekday convention, threshold = 14. The weekday/threshold assertions are themselves fails-on-revert anchors.

All jest: **19 passed / 19** (venueIntelligence + shell + the existing `venueModules.test.ts` adjacent regression). TypeScript: **0 errors** in all five new/edited source files (`tsc --noEmit`; pre-existing repo-wide errors in unrelated files are untouched).

---

## 7. Old → New receipts

### VenueSuiteShell.tsx
- **Before:** Overview slot rendered `<VenueListingContent brandId focus chromeMode="tab">` (the ORCH-1145 listing recap) under the reservations-activation invitation card.
- **Now:** Overview slot renders `<VenueIntelligenceModule brandId>` under the (kept) invitation card. `VenueListingContent` import dropped from the shell; the `focus` deep-link is no longer threaded at the Overview slot (it followed the recap into Settings, Leg-1 domain). `moduleSelfScrolls("overview")` unchanged.
- **Why:** SC-9 / §4.7 — Overview becomes the intelligence dashboard; the recap lives in Settings.
- **Lines:** ~19 changed (import swap + JSX mount + comments).

### New: VenueIntelligenceModule.tsx, venueIntelligence.ts, useVenueIntelligence.ts, venueIntelligenceService.ts, the RPC migration
- **Before:** did not exist.
- **Now:** the full read path + dashboard per §4.2–§4.6 + the embedded DESIGN D-1..D-11.
- **Why:** the core deliverable.

---

## 8. Cross-surface impact

| # | Surface | Affected | Parity | Note |
|---|---------|----------|--------|------|
| 1 | Consumer iOS | No | n/a | owner-only intelligence |
| 2 | Consumer Android | No | n/a | same |
| 3 | Buyer/anon Web | No | n/a | private to owner |
| 4 | Business iOS | **Yes** | automatic (shared RN) | Overview = dashboard |
| 5 | Business Android | **Yes** | automatic (GlassCard opaque fallback via GlassChrome) | verify opaque fill on device |
| 6 | Admin Web | No | n/a | doesn't render the suite |
| 7 | Business Web desktop | **Yes** | automatic (one component, both shell branches) | renders in the desktop workspace column |

No manual parity gap — one shared RN component drives iOS/Android/web-desktop.

---

## 9. Smoke result

- **Backend:** live-DB transactional probes run against project `gqnoajqerqhnvulmnyvv` — T-1..T-7 all PASS (tz-local hour 21, weekday Sun=6/Thu=3, USD 11000 + GBP 2000 separate, trend currency USD, refunded excluded, partial-refund netted, hours[24]/days[7] full), plus a separate non-owner authz probe returning 42501. All rolled back; no test data persisted.
- **UI:** NOT device/sim-verified. The component compiles clean (tsc) and its honesty/threshold/parity contracts are grep-test-proven, but the rendered tiles (bar layout, glass on Android, pull-to-refresh, empty/loading/error states on a real device) are **UNVERIFIED** — that is the tester's runtime job (§11 routing).

---

## 10. Known issues / deferred

- **OQ-1 honored:** the shell repoint is the LAST commit (`f5d406268`), after the data layer (`f1ca1072f`), so no recap gap.
- **OQ-2 (tz quality):** for a venue with NO reservations config AND no non-UTC events, slow-hours falls back to a static offset (footnoted "approximate") or UTC. A real `place_pool.iana_timezone` column + backfill is recommended for a future leg (out of scope NG-3). Flagged.
- **Icon:** the SPEC/DESIGN named `"alert-circle"` for the error card; that icon name does not exist in `Icon.tsx`. Used `"flag"` (semantic.error color) — the nearest honest-issue glyph. Cosmetic; flag for designer if a different glyph is preferred.
- **Migration prefix bumped:** SPEC suggested `20261021000000`, which is NOT monotonic (it predates Leg-1's `20261116000000`). Re-ran the collision check and used `20261117000000` (strictly-greater than the max local + remote head; no sibling-worktree collision). The SPEC explicitly instructed the implementor to re-check and bump.
- **`focus` shell prop:** retained in `VenueSuiteShellProps` (passed by `app/(tabs)/hub/listing.tsx`, outside the allowlist) but no longer consumed in the shell. No tsc error (`noUnusedParameters` not enabled). Its destination is Settings (Leg-1 domain) — not re-wired here per NG-1.

---

## 11. Operator action required

- **Migration `db push` (file is already applied to the live project via Management API; this re-stamps the local history for the pipeline):**
  ```bash
  cd "/Users/sethogieva/Desktop/mingla-orchs/1186-[venue-unify]" && /Users/sethogieva/bin/supabase db push --linked
  ```
  The function already exists on remote (verified). If `db push` reports the migration as already applied / a remote-only version, source-reconcile rather than re-running DDL.
- **Edge-fn deploy:** none.
- **COMMS acks (orchestrator to record at CLOSE — implementor must not edit the commit-guarded anchor):** COMMS-0048 (WARN/ALL anchor-reset+hard-guard) — honored: all work done in the `1186-venue-unify` worktree, never the anchor, commits on the ORCH branch. COMMS-0047 (WARN/ALL consumer-OTA freeze) — N/A: this leg is business-app only, zero `app-mobile` changes. COMMS-0050 RESOLVED (no action).
- **Tester:** runtime QA per §11 (RPC authz live, tz correctness on a seeded fixture, no-fabrication on device, currency edge, Android opaque-glass parity, business iOS + Android).

---

## 12. Discoveries for Orchestrator

- **`ai_signal_scores` is an OBJECT, not an array** (verified on live data). The SPEC's contract assumed an array shape upstream; the RPC bridges it correctly, but any future reader/spec should treat the column as an object keyed by signal id. Worth noting in the INVARIANT_REGISTRY entry for the column.
- **`orders` has a hard CHECK** `orders_online_checkout_phone_e164_check` (source `online_checkout` requires a valid `buyer_phone_e164`). Not a blocker for this read-only leg, but relevant to anyone seeding orders fixtures (the SQL test seeds a valid e164).
- **Establishes (DRAFT → orchestrator flips ACTIVE at CLOSE):** `I-PROPOSED-1186-INTELLIGENCE-NO-FABRICATION`, `I-PROPOSED-1186-INTELLIGENCE-TZ-LOCAL`, `I-PROPOSED-1186-INTELLIGENCE-CURRENCY-BUCKETED` — all backed by the §9 tests.
