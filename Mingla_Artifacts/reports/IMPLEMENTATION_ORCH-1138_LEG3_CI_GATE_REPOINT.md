# IMPLEMENTATION — ORCH-1138 Leg 3 [experience-page]: re-point 4 RED CI gates after EBES decommission

**New HEAD:** `75ad03083`
**Branch:** `ORCH-1138-experience-page`
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1138-[experience-page]/`
**Rebased onto `origin/main`** before work (7 commits replayed clean).

---

## 1. Summary

The Leg-3 rework DELETED `ExpandedBusinessEventSheet.tsx` (EBES) and `ExperienceItinerary.tsx`,
porting EBES's consumer checkout verbatim into the Leg-2 foundation detail screens. Four CI gates
went red as fallout. Three were stale file references to the deleted EBES; one was a GENUINE
invariant regression. All four are now green; no invariant was weakened — each was re-pointed to
where it now lives, and the one real violation was fixed at the root.

---

## 2. Per-gate root cause + fix

### Gate 1 — ORCH-0846 consumer event venue/address parity
- **Script:** `.github/scripts/strict-grep/orch-0846-consumer-event-address-parity.mjs`
- **Root cause:** `SHEET` const + R-2 pointed at the deleted
  `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx` → `readSource` ENOENT, exit 2.
- **Fix (re-point, verified invariant holds):** `SHEET` retargeted to
  `app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx` (the post-EBES successor consumer of
  the `BusinessEventCard` payload). Verified the invariant: the screen consumes `card.format`
  (line 145) — NO `format: "in-person"` hardcode. Docstring + R-2 label + comment updated.
- **Result:** 6/6 PASS.

### Gate 2 — ORCH-0852 consumer payment flow frozen (no regressions)
- **Script:** `.github/scripts/strict-grep/i-consumer-payment-flow-frozen.mjs`
- **Root cause:** `FROZEN_FILES` listed the deleted EBES path → "Frozen file missing", exit 1.
- **Fix (re-point, verified byte-identical flow):** replaced the EBES frozen entry with TWO entries —
  `ConsumerEventDetailScreen.tsx` (events; keeps `runNativeCheckout` + `"Ticket secured"` +
  `businessEventOrders`) and `ConsumerExperienceDetailScreen.tsx` (experiences; same
  `runNativeCheckout` + `businessEventOrders`, kind-appropriate "Reserved!" copy). Verified BOTH keep
  the fire-and-forget pattern and NEITHER contains the forbidden synchronous-confirm identifiers
  (`confirmTicketCheckout`, `ticket-checkout-confirm`, `useOrderRealtimeSubscription`).
  `nativeCheckoutFlow.ts` unchanged.
- **Result:** PASS.

### Gate 3 — ORCH-1076 paid buyer-supply requires charges enabled (REAL REGRESSION)
- **Script:** `.github/scripts/strict-grep/orch-1076-paid-supply-requires-charges-enabled.mjs`
- **Root cause (NOT a stale ref — a genuine invariant violation):** the rework migration
  `supabase/migrations/20261007000000_orch_1138_rework_deck_supply.sql` re-defined
  `pg_brand_experiences_for_place` by re-emitting the ORCH-1072 body verbatim. ORCH-1072 PREDATES the
  ORCH-1076 readiness gate (added 2026-09-17), so the re-emit silently DROPPED the
  `pg_brand_can_charge(e.brand_id)` paid-supply gate from the venue supply RPC — paid offerings from
  charge-disabled brands would leak back into venue→detail supply (serve-time mirror of the checkout
  409 broken).
- **Fix (restore invariant verbatim):** restored the
  I-PAID-SUPPLY-REQUIRES-CHARGES-ENABLED branch (`NOT EXISTS(paid online ticket) OR
  pg_brand_can_charge(brand_id)`) into the venue RPC WHERE, after `e.deleted_at IS NULL`, before
  `ORDER BY` — byte-identical to the ORCH-1076 source. The deck RPC in the same migration already
  carried the gate.
- **Result:** 5/5 PASS.

### Gate 4 — Test files: append-only
- **Script:** `.github/scripts/test-append-only-check.js` (workflow `tests-append-only.yml`)
- **Root cause (task framing corrected):** NO EBES test files were *deleted* — git diff
  `origin/main...HEAD` shows zero `--diff-filter=D` test files. The gate flagged FOUR existing test
  files MODIFIED with deletions (EBES-path reads re-pointed): `orch_1025_seamless_native_cart.test.tsx`
  (5), `YourCircleSection.adversarial.test.tsx` (3), `BaseBottomSheet.test.mjs` (16),
  `mingla-business/app/exp/__tests__/public-experience-page.test.ts` (2). Each already carried
  `[TEST-MOD-APPROVED ORCH-1138]` INLINE, but the gate reads ONLY the HEAD commit body
  (`git log -1`), and HEAD was the report commit `8845d25e7` which lacked the token.
- **Fix (correct mechanism — the gate has no allowlist; the token IS the approved-deletion
  mechanism):** the fix commit (new HEAD) carries `[TEST-MOD-APPROVED ORCH-1138]` plus a clear EBES
  decommission rationale in its body. Verified all 4 modifications are legitimate re-points (EBES →
  successor screens / route-based checkout), none weakens an assertion — `YourCircleSection` was
  actually strengthened (asserts on BOTH successor screens).
- **Result:** 12 passed, 0 failed.

---

## 3. Files changed
- `.github/scripts/strict-grep/orch-0846-consumer-event-address-parity.mjs` (SHEET + docstring + R-2 re-point)
- `.github/scripts/strict-grep/i-consumer-payment-flow-frozen.mjs` (frozen-file re-point, 1→2 entries)
- `supabase/migrations/20261007000000_orch_1138_rework_deck_supply.sql` (+11 — restore ORCH-1076 venue readiness gate)
- `supabase/migrations/__tests__/orch_1138_rework_deck_supply.test.mjs` (+2 assertions — fails-on-revert readiness coverage)

4 files changed, 85 insertions(+), 12 deletions(-).

---

## 4. Regression test + fails-on-revert
Added 2 assertions to `supabase/migrations/__tests__/orch_1138_rework_deck_supply.test.mjs` that slice
each RPC body and assert the `pg_brand_can_charge(` marker in BOTH deck + venue RPCs.
**fails-on-revert verified at 75ad03083:** deleting the restored venue readiness branch → migration
test FAILS + the ORCH-1076 strict-grep gate FAILS; restored → both PASS (17 assertions).

---

## 5. Full Leg-3 gate suite
- **4 target gates:** all GREEN.
- **Full strict-grep suite diff (origin/main vs HEAD):** ZERO new failures introduced
  (`comm -13` empty). origin/main carries 6 identical pre-existing local failures
  (`i-proposed-a-brands-deleted-filter`, `i-proposed-x-web-deprecation`, `i37-topbar-cluster`,
  `i38-icon-chrome-touch-target`, `i39-pressable-label`, `orch-0808-appsflyer-devices-app-discriminator`)
  — they fail byte-identically on a clean origin/main checkout (local-cwd artifacts; main's CI is
  green), out of ORCH-1138 scope.

---

## 6. Invariants honored
- I-PAID-SUPPLY-REQUIRES-CHARGES-ENABLED — restored on the venue RPC (was the real violation).
- COMMS-0009 (anon-safe theme view, never client `.from('brands')`) — preserved (migration test still asserts).
- EBES decommission — EBES stays deleted; gates re-pointed to successors, not resurrected.
- No assertion weakened in any re-pointed test.

---

## 7. Discoveries for Orchestrator
- **PRE-EXISTING (out of scope):** `app-mobile/src/components/ui/__tests__/BaseBottomSheet.test.mjs`
  T-C **primitive** assertion fails on origin/main AND this branch — `BaseBottomSheet.tsx:717` passes
  `animationConfigs={sheetAnimationConfigs}` while line 102's comment claims it passes NONE. NOT an
  ORCH-1138 regression (file unchanged in this PR); my T-C *reference* re-point (to
  ConsumerEventDetailScreen) is correct and passes. A prior ORCH added the primitive
  `animationConfigs` without updating this test. Recommend registering a follow-up.
- **6 local-cwd gate failures** (listed in §5) are pre-existing on main; flag if CI behavior diverges.

---

## 8. Operator action required
- None for migration apply in this task (migration `20261007000000` was already part of the PR;
  the SQL edit only restores the readiness branch — re-apply only if the migration had been applied
  pre-edit, which per the prior report it had not in a way that needs reconciliation; verify before
  `db push`). No new migration file added.
- Route back to orchestrator for REVIEW → tester. Do NOT merge/deploy/close.
