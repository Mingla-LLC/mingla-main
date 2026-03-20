# Behavioral Contract — Place Pool & Curated Card Integrity

> **Purpose:** Durable engineering contract. Prevents future regressions by
> codifying the intended system behavior, the invariants that enforce it, and
> the design rationale behind each decision.
>
> **Scope:** `place_pool`, `card_pool`, `card_pool_stops`, stale-place
> lifecycle, curated card creation/deletion semantics.
>
> **Last updated:** 2026-03-19

---

## A. Curated Cards Are Derived Artifacts

**Source of truth:**

| Layer | Table / Input |
|-------|---------------|
| Source | `place_pool` — canonical place data |
| Source | Curation rules, templates, generation inputs |
| Derived | `card_pool` (where `card_type = 'curated'`) |
| Derived | `card_pool_stops` — ordered stop references |

Curated cards are compiled output. They are **regeneratable** from valid
source data and **must not be preserved in broken form**. If a dependency
is invalidated, the curated card must be deleted — not patched, not
partially served.

---

## B. Curated Stop Storage Is Relational

`card_pool_stops` is the **sole authoritative model** for curated card
stop references.

| Column | Purpose |
|--------|---------|
| `card_pool_id` | FK → `card_pool(id)` ON DELETE CASCADE |
| `place_pool_id` | FK → `place_pool(id)` ON DELETE CASCADE |
| `google_place_id` | Denormalized for query performance |
| `stop_order` | 0-based ordering; UNIQUE per card |

**Legacy columns removed:**

- `card_pool.stop_place_pool_ids` (UUID[]) — **dropped** in migration
  `20260319000001`. Was an unprotected array with no FK enforcement.
- `card_pool.stop_google_place_ids` (TEXT[]) — **dropped** in the same
  migration. Parallel array that drifted from the UUID array.

These columns must not be re-added.

---

## C. Dependency Loss Deletes Curated Cards

| Event | Effect |
|-------|--------|
| Place deleted from `place_pool` | `card_pool_stops` row cascades away → trigger `trg_delete_curated_card_on_stop_loss` deletes parent curated card |
| Place manually deactivated (`is_active → false`) | Trigger `trg_cascade_place_deactivation` deactivates all curated cards referencing it via `card_pool_stops` |

**No partial survival is allowed.** A curated card with even one invalid
stop is broken and must be removed from circulation.

---

## D. Curated Card Creation Must Be Atomic

1. **Pre-insert guard:** `insertCardToPool()` in `cardPoolService.ts`
   rejects curated cards with zero `stopPlacePoolIds` before any DB write.

2. **Post-insert cleanup:** If `card_pool_stops` insertion fails after the
   `card_pool` row is created, the card is immediately deleted.

3. **Batch generation cleanup:** `generate-curated-experiences` verifies
   expected vs actual stop counts after batch insert and deletes any card
   where the counts diverge.

**Rule:** No curated card may exist in the database with zero stops.

---

## E. Stale-Place Policy Is Manual-Only

| Concern | Policy |
|---------|--------|
| Stale detection | **Automatic** — computed on-the-fly by `v_stale_places` view |
| Stale handling | **Manual** — admin-driven only |

**Prohibited:**

- No scheduler or `pg_cron` job may auto-refresh stale places.
- No scheduler or background job may auto-deactivate stale places.
- Staleness alone must **never** mutate `is_active`.

**Removed:** `deactivate_stale_places()` function — dropped in migration
`20260319100000`. This was the "loaded gun" that could auto-deactivate
places based on staleness thresholds.

The `v_stale_places` view is read-only. It computes `staleness_tier`
(fresh / stale / warning / critical) and `stale_reason` but never writes.

---

## F. Admin Workflow Contract

| Action | RPC / Function | Cascades |
|--------|----------------|----------|
| List stale places | `admin_list_stale_places()` | Read-only |
| Deactivate place | `admin_deactivate_place()` | → deactivates single + curated cards via `card_pool_stops` |
| Bulk deactivate | `admin_bulk_deactivate_places()` | Same cascade per place |
| Reactivate place | `admin_reactivate_place()` | → reactivates single cards; curated cards are NOT auto-restored (must be regenerated) |
| Refresh place | `admin-refresh-places` edge function | Updates `place_pool` data from Google API; resets `refresh_failures` |

All actions are audit-logged to `place_admin_actions` with `acted_by`,
`acted_at`, `reason`, and `metadata`.

---

## G. Non-Regression Invariants

These invariants must hold at all times. Any code change that would
violate them is a regression and must be rejected.

1. **No curated card may exist with zero stops.**
2. **No curated card may remain active if any referenced place is deleted.**
3. **No curated card may remain active if any referenced place is manually deactivated.**
4. **Curated card creation must be all-or-nothing.**
5. **Staleness alone must not automatically mutate `is_active` or delete curated cards.**

---

## Implementation Notes

### Authoritative Tables

| Table | Role |
|-------|------|
| `place_pool` | Canonical place data; `is_active` controls serving |
| `card_pool` | All cards (single + curated); `card_type` discriminates |
| `card_pool_stops` | Normalized curated stop references with FK enforcement |
| `place_admin_actions` | Audit log for all admin place operations |
| `v_stale_places` | Read-only computed view; never writes |

### Triggers Enforcing Deletion/Deactivation Semantics

| Trigger | Table | Fires On | Effect |
|---------|-------|----------|--------|
| `trg_delete_curated_card_on_stop_loss` | `card_pool_stops` | AFTER DELETE | Deletes parent curated card |
| `trg_cascade_place_deactivation` | `place_pool` | AFTER UPDATE of `is_active` (true → false) | Deactivates all cards referencing the place |

### Code Paths That Create Curated Cards

| Path | File | Guards |
|------|------|--------|
| Single card insert | `supabase/functions/_shared/cardPoolService.ts` → `insertCardToPool()` | Pre-insert zero-stop rejection; post-insert stop failure cleanup |
| Batch generation | `supabase/functions/generate-curated-experiences/index.ts` | Expected vs actual stop count verification; orphan deletion |

### Legacy Columns / Functions Removed

| Item | Migration | Reason |
|------|-----------|--------|
| `card_pool.stop_place_pool_ids` | `20260319000001` | Replaced by `card_pool_stops` |
| `card_pool.stop_google_place_ids` | `20260319000001` | Replaced by `card_pool_stops` |
| `deactivate_stale_places()` | `20260319100000` | Auto-deactivation prohibited by policy |

### Migration Assumptions

- `20260319000001` backfills existing curated cards into `card_pool_stops`
  and deletes any with orphaned or empty stop arrays before dropping the
  legacy columns. This is a one-way migration.
- `20260319100000` is idempotent (`CREATE OR REPLACE`, `IF NOT EXISTS`).
- `20260319200000` replaces the admin RPCs to cascade through
  `card_pool_stops` instead of the old direct `place_pool_id` path.

---

## Testing / Verification

### Schema Integrity

- `card_pool_stops` FK constraints exist to both `card_pool` and `place_pool`.
- `stop_order` is UNIQUE per card and CHECK >= 0.
- Legacy columns (`stop_place_pool_ids`, `stop_google_place_ids`) do not
  exist on `card_pool`.

### No Orphaned Curated Cards

- No curated card in `card_pool` should reference a `place_pool` row that
  does not exist (verified through FK cascade).
- `cleanup_orphaned_curated_cards()` can be called as a consistency sweep.

### No Zero-Stop Curated Cards

- Query: `SELECT id FROM card_pool WHERE card_type = 'curated' AND NOT EXISTS (SELECT 1 FROM card_pool_stops WHERE card_pool_id = card_pool.id)` must return zero rows.

### Manual Deactivation Cascade

- Deactivating a place via `admin_deactivate_place()` must set
  `is_active = false` on all curated cards referencing it.
- Verify via `card_pool_stops` join after deactivation.

### Stale Logic Does Not Auto-Mutate

- `v_stale_places` is a VIEW (not a function with side effects).
- No `pg_cron` entries reference `deactivate_stale_places` or any
  auto-deactivation function.
- `deactivate_stale_places()` does not exist in the schema.

---

## Design Rationale

**Why delete curated cards instead of patching them?**
Curated cards are compiled output — like a build artifact. When a source
dependency is removed, you rebuild; you don't hand-edit the binary.
Partial curated cards with missing stops would serve broken itineraries.

**Why relational stops instead of arrays?**
Unprotected UUID arrays have no FK enforcement. Deleted places left
orphaned UUIDs that caused broken multi-stop itineraries to be served
silently. The relational model makes the database enforce integrity
that application code alone cannot guarantee.

**Why manual-only stale handling?**
Automated deactivation is a cost and operational risk. A stale place
may still be valid — it just needs a data refresh. Auto-deactivation
removes places from circulation without human judgment about whether
the place is actually gone or just needs updated data. The cost of a
false deactivation (users lose a valid place) exceeds the cost of
serving slightly stale data while an admin reviews.

**Why database-enforced integrity?**
Application-level guards can be bypassed by direct DB updates, bulk
operations, or future code changes that forget to check. Triggers and
FK cascades enforce invariants regardless of the caller.
