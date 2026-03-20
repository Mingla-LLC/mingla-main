# Test Report: Curated Card Stops Normalization
**Date:** 2026-03-19
**Implementation:** IMPLEMENTATION_CURATED_CARD_STOPS_NORMALIZATION_REPORT.md
**Tester:** Brutal Tester Skill
**Verdict:** 🔴 FAIL — 3 critical findings must be fixed before merge

---

## Executive Summary

Tested the curated card stops normalization against 5 invariants. The schema normalization (card_pool_stops table, FKs, trigger, backfill, column drop) is structurally sound. Three critical gaps remain: (1) the batch insert path in generate-curated-experiences is not atomic — stop insertion failure leaves orphaned zero-stop cards, (2) the old `deactivate_stale_places()` function still auto-mutates card is_active based on staleness alone, violating invariant 5, and (3) manual place deactivation (is_active=false) does not cascade to curated cards, violating invariant 3.

---

## Invariant Test Matrix

| # | Invariant | Verdict | Evidence |
|---|-----------|---------|----------|
| 1 | No curated card may exist with zero stops | 🔴 FAIL | CRIT-001: batch path doesn't clean up |
| 2 | No curated card may remain active if any referenced place is deleted | ✅ PASS | Trigger + CASCADE handles this |
| 3 | No curated card may remain active if any referenced place is manually deactivated | 🔴 FAIL | CRIT-003: no trigger on is_active UPDATE |
| 4 | Curated card creation must be all-or-nothing | 🟡 PARTIAL | insertCardToPool is atomic; batch path is not |
| 5 | Staleness alone must not automatically mutate is_active or delete curated cards | 🔴 FAIL | CRIT-002: deactivate_stale_places unchanged |

---

## 🔴 Critical Findings

### CRIT-001: Batch insert in generate-curated-experiences is not atomic

**File:** `supabase/functions/generate-curated-experiences/index.ts` (lines 3107-3139)

**What's Wrong:** Cards are batch-upserted first (line 3108-3111), then stops are inserted separately (line 3132-3138). If the stops insert fails, the cards survive with zero stops. Unlike `insertCardToPool()` which deletes the card on stop failure, this batch path only logs a warning and continues.

**Evidence:**
```typescript
// Line 3136-3138: failure is swallowed
if (stopsError) {
  console.warn('[curated-v2] Batch stops insert error:', stopsError.message);
}
// Cards with zero stops now exist in card_pool — violates invariant 1 & 4
```

**Required Fix:** If stop insertion fails for any card, delete those cards that received zero stops. After the stops upsert block, add:
```typescript
// Clean up curated cards that ended up with zero stops (atomicity guarantee)
if (stopsError) {
  const insertedIds = insertedCards.map((c: any) => c.id);
  const { data: orphanedCards } = await poolAdmin
    .from('card_pool')
    .select('id')
    .in('id', insertedIds)
    .eq('card_type', 'curated')
    .not('id', 'in', `(SELECT DISTINCT card_pool_id FROM card_pool_stops)`);
  // ... delete orphans
}
```
Or better: wrap card + stop insertion in an RPC that does both in one transaction.

---

### CRIT-002: deactivate_stale_places() auto-mutates card is_active — violates invariant 5

**File:** `supabase/migrations/20260301000002_card_pool_pipeline.sql` (lines 227-242)

**What's Wrong:** `deactivate_stale_places()` automatically sets `is_active = false` on both places AND their cards when staleness thresholds are hit. This was not updated by the new migration. Violates invariant 5: "Staleness alone must not automatically mutate is_active or delete curated cards."

**Evidence:**
```sql
-- Lines 227-242: automatic mutation based on staleness
UPDATE public.place_pool SET is_active = false WHERE ...stale conditions...;
UPDATE public.card_pool SET is_active = false WHERE place_pool_id IN (SELECT id FROM place_pool WHERE is_active = false);
```

**Required Fix:** The new migration must `CREATE OR REPLACE` this function to:
- Remove BOTH automatic UPDATE statements (places AND cards)
- Replace with detection-only logic, or drop the function entirely
- Admin controls all deactivation manually

---

### CRIT-003: Manual place deactivation doesn't cascade to curated cards

**File:** `supabase/migrations/20260319000001_normalize_curated_card_stops.sql`

**What's Wrong:** The trigger `trg_delete_curated_card_on_stop_loss` only fires on DELETE from `card_pool_stops`. When an admin sets `place_pool.is_active = false` (confirmed in `PlacePoolBuilderPage.jsx` line 609), no trigger fires. Curated cards referencing that place remain active and servable.

`query_pool_cards` only checks `card_pool.is_active` — it does NOT check whether all referenced places in `card_pool_stops` are still active.

**Required Fix:** Add a trigger on `place_pool` AFTER UPDATE of `is_active` that deletes curated cards referencing the deactivated place:
```sql
CREATE OR REPLACE FUNCTION public.delete_curated_cards_on_place_deactivation()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.is_active = true AND NEW.is_active = false THEN
    DELETE FROM public.card_pool
    WHERE card_type = 'curated'
      AND id IN (SELECT card_pool_id FROM public.card_pool_stops WHERE place_pool_id = NEW.id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_delete_curated_cards_on_place_deactivation
  AFTER UPDATE OF is_active ON public.place_pool
  FOR EACH ROW
  WHEN (OLD.is_active = true AND NEW.is_active = false)
  EXECUTE FUNCTION public.delete_curated_cards_on_place_deactivation();
```

---

## ✅ What Passed

### Things Done Right
1. **Schema design is correct.** card_pool_stops with real FKs, UNIQUE constraints, ON DELETE CASCADE.
2. **Trigger on stop deletion works for invariant 2.** Hard-delete cascade chain works correctly.
3. **insertCardToPool() atomicity is correct.** Single-card path deletes the card on stop failure.
4. **Backfill is solid.** Orphaned cards deleted first, valid stops migrated, columns dropped. Correct order.
5. **RLS on card_pool_stops matches existing policies.** Consistent with card_pool.
6. **query_pool_cards updated correctly.** Dropped column references removed.

### Passing Checks

| Check | Result |
|-------|--------|
| card_pool_stops has RLS enabled | ✅ |
| FKs use ON DELETE CASCADE | ✅ |
| Indexes on lookup columns | ✅ |
| Backfill handles NULL/empty arrays | ✅ |
| Column drop uses IF EXISTS | ✅ |
| UNIQUE constraints prevent duplicate stops | ✅ |
| Trigger is FOR EACH ROW | ✅ |
| insertCardToPool cleans up on stop failure | ✅ |
| query_pool_cards security (REVOKE/GRANT) | ✅ |

---

## Recommendations

### Mandatory (block merge)
1. **CRIT-001:** Add cleanup in batch path — delete curated cards with zero stops after stop insertion failure
2. **CRIT-002:** Replace `deactivate_stale_places()` — remove all automatic is_active mutations
3. **CRIT-003:** Add trigger on place_pool UPDATE of is_active → delete curated cards referencing deactivated place

### Re-test needed
All 3 fixes go into the same migration file. One re-test pass to confirm all 5 invariants hold.
