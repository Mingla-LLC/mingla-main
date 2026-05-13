# QA — ORCH-0816 — Brand KPI tile: real 7-day window + freshness signals

**Verdict:** CONDITIONAL PASS.
**Date:** 2026-05-12.
**Owner:** Claude `mingla-forensics` (TEST mode, TARGETED + SPEC-COMPLIANCE).
**Working tree:** /Users/sethogieva/Desktop/mingla-main on branch Seth.
**Spec:** [Mingla_Artifacts/specs/SPEC_ORCH-0816_BRAND_KPI_TILE_LABEL_AND_FRESHNESS.md](Mingla_Artifacts/specs/SPEC_ORCH-0816_BRAND_KPI_TILE_LABEL_AND_FRESHNESS.md)
**Investigation:** [Mingla_Artifacts/reports/INVESTIGATION_ORCH-0816_BRAND_KPI_TILE_LABEL_AND_FRESHNESS.md](Mingla_Artifacts/reports/INVESTIGATION_ORCH-0816_BRAND_KPI_TILE_LABEL_AND_FRESHNESS.md)
**Implementation:** [Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0816_BRAND_KPI_TILE_LABEL_AND_FRESHNESS.md](Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0816_BRAND_KPI_TILE_LABEL_AND_FRESHNESS.md)

---

## 1. Severity counts

| Severity | Count |
|---|---|
| P0 — CRITICAL | 0 |
| P1 — HIGH | 0 |
| P2 — MEDIUM | 0 |
| P3 — LOW | 0 |
| P4 — NOTE | 1 |

**The CONDITIONAL stamp is procedural, not defect-driven.** All code-side success criteria PASS. The two CONDITIONAL items (SC-3, SC-7) require operator-driven deploy steps that are not in this skill's scope (migration push + live-fire on a TestFlight build).

---

## 2. Spec success criteria — verification matrix

| SC | Criterion | Verification | Result |
|---|---|---|---|
| SC-1 | "Last 7 days" tile shows 7-day GMV | Jest 4/4 in `aggregateBrandStatsByBrandIds — ORCH-0816 7-day window` block: splits lifetime/7-day buckets, nets partial refunds, excludes null `created_at` from 7-day, isolates currency. Re-ran independently: PASS. | ✅ PASS |
| SC-2 | BrandProfileView GMV unchanged | Read [BrandProfileView.tsx:539](mingla-business/src/components/brand/BrandProfileView.tsx#L539) — still binds `brand.stats.rev` (lifetime), `sub="all time"`. Service `pickRevForCurrency` unchanged from baseline. | ✅ PASS |
| SC-3 | New order reflected ≤5s without backgrounding | Realtime subscription wired in `useBrands` + `useBrand`; pattern matches `useBrandStripeBankVerification:97-122` verbatim (channel-name randomization, `postgres_changes` event=*, RLS-gated, cleanup via `removeChannel`). **Cannot fire until migration 20260602000004 is pushed.** | ⚠ CONDITIONAL (deploy gate) |
| SC-4 | Pull-to-refresh on home invalidates `brandKeys.all` + `eventOrdersKeys.all` | Read [home.tsx:152-167](mingla-business/app/%28tabs%29/home.tsx#L152-L167) — `handleRefresh` runs `Promise.all([invalidate(brandKeys.all), invalidate(eventOrdersKeys.all)])`. `RefreshControl` wired on ScrollView line 319-322. | ✅ PASS |
| SC-5 | Pull-to-refresh on brand-profile invalidates per-brand detail + order keys | Read [BrandProfileView.tsx:200-217](mingla-business/src/components/brand/BrandProfileView.tsx#L200-L217) — `handleRefresh` invalidates `brandKeys.detail(brand.id)` (or `brandKeys.all` when brand is null) + `eventOrdersKeys.all`. RefreshControl wired on populated-state ScrollView. | ✅ PASS |
| SC-6 | `staleTime = 30000 ms` | Read [useBrands.ts:46-50](mingla-business/src/hooks/useBrands.ts#L46-L50) — `STALE_TIME_MS = 30 * 1000` with ORCH-0816 rationale comment. Both `useBrands` and `useBrand` consume it. | ✅ PASS |
| SC-7 | Migration adds `orders` to `supabase_realtime` publication | File `supabase/migrations/20260602000004_orch_0816_orders_realtime_publication.sql` exists with verbatim `ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;`. Live MCP probe `SELECT pubname, schemaname, tablename FROM pg_publication_tables WHERE tablename = 'orders';` returns `[]` — **migration not yet pushed.** `mcp__supabase__list_migrations` confirms head is `20260602000003`. | ⚠ CONDITIONAL (operator must run `supabase db push --linked`) |
| SC-8 | No channel when disabled | Read [useBrands.ts:120](mingla-business/src/hooks/useBrands.ts#L120) — `if (!enabled \|\| accountId === null) return;` early-return before any channel creation. Same guard in `useBrand` at [useBrands.ts:168](mingla-business/src/hooks/useBrands.ts#L168). | ✅ PASS |
| SC-9 | Channel cleanup on unmount | useEffect returns `(): void => { void supabase.removeChannel(channel); }` in both hooks. | ✅ PASS |
| SC-10 | TypeScript strict build | `npx tsc --noEmit` in mingla-business: exit 0, zero errors. | ✅ PASS |

**Code-side outcome:** 8/8 verifiable-without-deploy criteria PASS. 2/2 deploy-dependent criteria architecturally correct, awaiting operator gate.

---

## 3. Test cases — verification matrix

| ID | Test | Result |
|---|---|---|
| T-01 | Lifetime sum vs 7-day window split | ✅ Jest: "splits lifetime and 7-day buckets by created_at" PASS |
| T-02 | Partial refund netting in both windows | ✅ Jest: "nets refunded_amount_cents in both windows" PASS |
| T-03 | Full refund excluded | ✅ Inherited from existing `getBrands` test (payment_status filter `(failed,cancelled,refunded)` unchanged) |
| T-04 | Failed excluded | ✅ Same exclusion list |
| T-05 | Wrong currency excluded from headline | ✅ Jest: "keeps currency buckets isolated across windows" + `pickRev7dForCurrency` checks `defaultCurrency` upper-cased |
| T-06 | Multiple brands isolated | ✅ Inherited test "buckets attendees per brand across multiple brands" |
| T-07 | Home tile renders 7-day value | ✅ Code review: binding is `currentBrand.stats.rev7d` |
| T-08 | BrandProfileView GMV tile renders lifetime | ✅ Code review: binding still `brand.stats.rev` |
| T-09 | Pull-to-refresh invalidates correct keys | ✅ Code review: handleRefresh runs both invalidations |
| T-10 | Realtime subscription mounts and cleans up | ✅ Code review: useEffect with subscribe + removeChannel |
| T-11 | No subscription when disabled | ✅ Code review: early return on `!enabled` |
| T-12 | Publication membership | ⚠ CONDITIONAL — `pg_publication_tables` returned `[]` for `orders` (pre-deploy) |
| T-13 | TypeScript build | ✅ `tsc --noEmit` clean |
| T-14 | Strict-grep gate | ✅ Gate PASS on current code. Negative test: temporarily reverting binding to `stats.rev` triggers FAIL with exit 1; restoring re-passes. Gate functions correctly in both directions. |
| T-15 | Live-fire (real ticket order, ≤5s tile update) | ⚠ CONDITIONAL — requires operator deploy + TestFlight build + second-device checkout |
| T-16 | Sign-out cleans up channel | ✅ useEffect dependency includes `enabled` (derived from `accountId !== null`); auth context clearing `accountId` triggers cleanup |

---

## 4. Constitution check (14 rules — automatic P0 on violation)

| # | Rule | Result | Evidence |
|---|---|---|---|
| 1 | No dead taps | PASS | RefreshControl is a real gesture target; tile is presentational only |
| 2 | One owner per truth | PASS | `brand.stats.rev7d` lives only in React Query; no Zustand mirror introduced |
| 3 | No silent failures | PASS | Service still throws on Postgrest error; subscription does not swallow events; migration paired with client subscription (no silent no-op path once pushed) |
| 4 | One key per entity | PASS | `brandKeys` + `eventOrdersKeys` factories used; zero hardcoded strings |
| 5 | Server state in React Query | PASS | All windowed totals computed in service layer, surfaced via React Query |
| 6 | Logout clears everything | N/A | No new persisted state |
| 7 | Label temporary | N/A | No transitional items introduced |
| 8 | Subtract before adding | PASS | Tile binding replaced (not layered on); `pickRev7dForCurrency` is parallel, not a wrapper |
| 9 | No fabricated data | **PASS — this fix resolves a pre-existing #9 violation** (label/data disagreement) |
| 10 | Currency-aware | PASS | `pickRev7dForCurrency` mirrors `pickRevForCurrency` currency-canonicalization rules |
| 11 | One auth instance | N/A | No auth code touched |
| 12 | Validate at right time | N/A | No datetime validation surfaces |
| 13 | Exclusion consistency | PASS | Same `payment_status` exclusion and `refunded_amount_cents` netting applied in both windows in a single pass |
| 14 | Persisted-state startup | PASS | `Brand.stats.rev7d` defaults to `0` in optimistic temp brand + every literal initializer; persisted v12 caches missing the field hydrate from server inside 30s anyway |

**Zero constitutional violations.**

---

## 5. Independent verification commands run

```bash
# TypeScript
cd mingla-business && npx tsc --noEmit
# Exit 0, no errors.

# Unit tests (touched suite)
npx jest mingla-business/src/services/__tests__/brandsService.test.ts
# 10/10 PASS — including all 4 new ORCH-0816 windowed tests.

# Strict-grep gate — positive
node .github/scripts/strict-grep/orch-0816-last-7-days-binds-rev7d.mjs
# "ORCH-0816 strict-grep PASS — Last-7-days tile binds rev7d."

# Strict-grep gate — negative (revert binding to lifetime, re-run, restore)
# (transient edit, restored immediately after)
# Result: FAIL with Check 2 + Check 3 both firing; exit 1. Restoring re-passes.

# Live DB probe (read-only via MCP)
SELECT pubname, schemaname, tablename FROM pg_publication_tables WHERE tablename = 'orders';
# []  → confirms migration 20260602000004 not yet pushed (expected).

# Live migration head probe (read-only via MCP)
mcp__supabase__list_migrations
# Latest remote: 20260602000003 orch_0815_marketing_hub_phase_a.
# Local file 20260602000004 ready, monotonic, awaits push.
```

---

## 6. Forensic re-reads (TARGETED Step 3)

### `aggregateBrandStatsByBrandIds` ([brandsService.ts:213-273](mingla-business/src/services/brandsService.ts#L213-L273))

**Windowed branch (line ~267-272):**
```ts
if (row.created_at !== null && row.created_at >= sinceIso) {
  bucket.rev7dByCurrencyCents.set(
    currency,
    (bucket.rev7dByCurrencyCents.get(currency) ?? 0) + net,
  );
}
```

Hunt list:
- Double-counting partial refunds? **No** — the `net` value is computed once before either branch; both lifetime and 7-day map operations use the same `net`. Partial refunds increase the lifetime map by `(total - refunded)` and the 7-day map by the same `(total - refunded)`. Not by `total` and again by `(total - refunded)`. ✅
- Null `created_at` mishandled? **No** — explicit `!== null` guard. Lifetime branch runs above this guard regardless. ✅
- ISO string comparison correctness? **Yes** — `toISOString()` produces lexicographically sortable strings; `>=` comparison on ISO strings is monotonic. ✅
- Currency missing for 7-day row? **No** — the windowed branch runs *after* the `if (currency.length === 0) continue;` check, so currency is guaranteed non-empty in this scope. ✅

### Realtime pattern parity

Side-by-side check against `useBrandStripeBankVerification:97-122`:

| Element | useBrandStripeBankVerification | useBrandsORCH-0816 |
|---|---|---|
| Channel name suffix | `Date.now() + Math.random().toString(36).slice(2, 8)` | Identical |
| Event filter | `event: "*", schema: "public", table: <name>` | Identical (table: `"orders"`) |
| Subscribe call | `.subscribe()` | Identical |
| Cleanup | `void supabase.removeChannel(channel)` | Identical |
| Guard | early-return on disabled | Identical |
| useEffect deps | `[enabled, brandId, queryClient]` | `[enabled, accountId, rqClient]` (parameter-name parity) |

**Pattern parity: verbatim. No deviation.** P4 praise issued below.

### useBrand variant filter scope

`useBrand(brandId)` subscribes to ALL `public.orders` changes, then invalidates only `brandKeys.detail(brandId)`. Concern: does the subscription fire too often (events on other brands' orders)?

**Answer:** RLS gates delivery at the publication layer. `biz_can_read_order_for_caller(id)` ensures the brand-team member only receives events for orders on events.brand_id IN (their accessible brands). For the typical case (one user = one brand), this is fine. For a power user with N brands open across N tabs, each brand's `useBrand` subscriber receives events for all their brands and invalidates only its own detail key — slightly wasteful subscription bandwidth but invalidations are scoped. Acceptable. ✅

---

## 7. Cross-domain impact

| Surface | Impact | Status |
|---|---|---|
| `mingla-business` mobile (iOS + Android) | Primary scope — all changes here | ✅ Verified |
| `mingla-business` web (Expo web) | RefreshControl is RN core; web shim handles gracefully (no-op on web is acceptable since pull-to-refresh is a touch gesture). Realtime subscription works identically on web Supabase client. | ✅ No issue |
| `app-mobile` | Untouched. `Brand` type from this domain is not shared (mingla-business has its own type tree). | ✅ N/A |
| `mingla-admin` | Untouched. Admin reads brand stats via direct Supabase queries with different shape. | ✅ N/A |
| Edge functions | Untouched. SPEC §1 excludes. | ✅ N/A |
| Checkout / refund / webhook | Untouched. The orders table is read-only from this client. | ✅ N/A |

No downstream breakage detected.

---

## 8. Pattern compliance + good work credit

### 🟢 P4 — Pattern reuse credit

Implementor's Realtime subscription is a verbatim mirror of `useBrandStripeBankVerification:97-122`. Channel-name randomization, useEffect dependency list, cleanup, and guard idioms are identical. This is exactly the discipline I-PROPOSED-AC (canonical pattern reuse) is designed to encourage. No "improvements" attempted, no shortcuts taken. Worth replicating in any future Realtime hook in mingla-business.

### Strict-grep gate quality

The gate at `.github/scripts/strict-grep/orch-0816-last-7-days-binds-rev7d.mjs` uses a tight regex with explicit lookahead to allow `stats.rev7d` while forbidding bare `stats.rev`. Three checks: file exists, every "Last 7 days" tile binds `rev7d`, no "Last 7 days" tile binds bare `rev`. Negative-tested in this session — works in both directions.

---

## 9. Operator unblock list (deploy gate)

For full PASS, operator must:

1. **`supabase db push --linked`** — applies `20260602000004_orch_0816_orders_realtime_publication.sql`. Adds `public.orders` to `supabase_realtime` publication. Verify with:
   ```sql
   SELECT pubname, schemaname, tablename FROM pg_publication_tables WHERE tablename = 'orders';
   -- Expect: supabase_realtime / public / orders
   ```
2. **EAS OTA** to TestFlight:
   ```bash
   cd mingla-business
   eas update --branch production --platform ios --message "ORCH-0816: real 7-day GMV + brand-stats freshness"
   eas update --branch production --platform android --message "ORCH-0816: real 7-day GMV + brand-stats freshness"
   ```
3. **Live-fire T-15:** On the TestFlight build, sign in as a brand owner on device A; from device B, complete a real ticket checkout for one of their events. Within ~5 seconds, the home "Last 7 days" tile should rise by the checkout amount **without** backgrounding, foregrounding, or remounting. Both `rev7d` and `rev` (on brand profile) should reflect the new sale.

If T-15 fails (no update within 30s even with the migration in place), reopen as FAIL and investigate the subscribe path — but every code-side gate is currently clean.

---

## 10. Discoveries for orchestrator

- **Pre-existing failing tests** in `mingla-business/src/services/__tests__/publicEventsService.test.ts` (2 assertions on `brandEvent.date == "2026-05-08"` and `brandEvent.doorsOpen == "21:00"`). Verified by `git stash && jest …` earlier this session — failures exist on baseline `Seth` before ORCH-0816 touched anything. **Not in scope for this dispatch.** Worth a small follow-up ORCH to investigate whether this is recent-date-string drift or test-fixture rot.
- **Cycle-B5 marketing hub merge note:** ORCH-0815 Phase A `onBlasts` prop addition to `BrandProfileView.tsx` is visible in the git diff alongside ORCH-0816 changes — both ORCHs were modifying the same file in the same working tree at the same time. The two edits are in disjoint regions (Phase A added a prop + Operations row; 0816 added imports + RefreshControl + handleRefresh + ScrollView prop). No conflict, but the orchestrator should be aware the commit will bundle both ORCHs if not split carefully.
- **Header doc comment at `home.tsx:6`** — currently reads `7-day aggregate hero + KPI grid + Upcoming list` — was a long-standing intent statement that didn't match code. Now finally true.

---

## 11. Verdict and routing

**CONDITIONAL PASS.**

- Zero P0, zero P1, zero P2, zero P3, one P4 (pattern reuse credit).
- All 8 code-verifiable success criteria PASS. SC-3 and SC-7 are CONDITIONAL on operator deploy + live-fire T-15.
- Constitutional check: zero violations.
- Strict-grep gate verified in both directions.
- Cross-domain check: no downstream breakage.

**CLOSE may proceed once the operator runs `supabase db push --linked` and confirms the publication probe.** The live-fire T-15 is a post-deploy smoke; if the operator wants to merge code first and smoke later, that is also acceptable — the code-side correctness is independently established.

If T-15 reveals a runtime defect post-deploy, reopen as RETEST FAIL with explicit findings.

---

## 12. Rework instructions (if FAIL)

N/A — no FAIL findings.
