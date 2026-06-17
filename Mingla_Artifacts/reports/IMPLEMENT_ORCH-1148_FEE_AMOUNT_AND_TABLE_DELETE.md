# IMPLEMENT — META-ORCH-1148 e2e gaps: fee-amount input + table delete

**Status:** implemented and verified (source + jest + deno gates green; fails-on-revert proven). Live SQL engine test + Docker full-chain are operator-runnable (Docker daemon down in this session).
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1148-[venue-e2e-validation]/` on branch `ORCH-1148-venue-e2e-validation`.
**Comms ledger:** read on entry. No `BLOCK` rows for this skill / ORCH-1148 / `ALL`. WARN/FYI rows (COMMS-0027 EAS-OTA, COMMS-0035 ExpoImageManipulator native drift) noted — neither touches this UI/migration work (no native module, no OTA in this ORCH; OTA is orchestrator/operator-owned at CLOSE).

---

## 1. Summary (plain English)

Two operator gaps in the Venue Suite are closed:

- **GAP 1 — reservation fee never charged.** Settings had the "Charge a reservation fee" toggle but no place to enter the amount, so `fee_amount_cents` stayed null and the engine treated the fee as free. Added a currency-aware amount field that appears when the toggle is on; the fee is treated as active only once an amount above 0 is set, and a clear amber "Set an amount above 0… until you do this fee stays free" line surfaces the broken in-between state. The existing payout fail-close (ORCH-1073/1075) is preserved — the amount field only shows after the toggle clears that gate.
- **GAP 2 — no way to delete a table.** Added a "Delete table" action in the edit sheet behind a destructive confirm dialog. Delete is **soft** (`deleted_at` column) so reservation history is preserved; the table disappears from the operator list and stops producing availability immediately.

---

## 2. SPEC success-criteria coverage

| SC | Criterion | Verified | Commit |
|----|-----------|----------|--------|
| SC-1 | Fee amount input, currency-aware, stored as integer cents | ✓ `minorFromMajor(currency)` → `fee_amount_cents`; jest `minorFromMajor` cases (USD/GBP/EUR/JPY) | f41b19d6f |
| SC-2 | Paid fee cannot be active with null/0 amount; invalid state surfaced, not leaveable as active | ✓ `paidFeeIsActive`/`feeAmountValidForSave` + amber needs-amount state; toggle-OFF clears amount | f41b19d6f |
| SC-3 | ORCH-1073/1075 payout fail-close preserved (amount only shows/saves once payouts ready) | ✓ `feeBlocked` gate unchanged; amount block renders only when `feeEnabled && !feeBlocked` | f41b19d6f |
| SC-4 | a11y label + testID on the input | ✓ `accessibilityLabel="Reservation fee amount"` + `testID="venue-settings-fee-amount"` | f41b19d6f |
| SC-5 | Delete action in edit sheet with confirm dialog (ConfirmDialog reused) | ✓ destructive `ConfirmDialog`, `testID="venue-table-delete"` / `-confirm` | f41b19d6f |
| SC-6 | Soft-delete: `deleted_at` column, additive monotonic migration | ✓ `20261013000002` (prefix > global max 20261013000001) | f41b19d6f |
| SC-7 | Soft-deleted excluded from list AND availability engine | ✓ `.is("deleted_at", null)` in `fetchVenueTables` + `AND t.deleted_at IS NULL` in engine v3 | f41b19d6f |
| SC-8 | Existing reservations referencing a deleted table not broken (FK stays) | ✓ soft-delete = UPDATE; no FK change, `reservations.table_id` untouched | f41b19d6f |
| SC-9 | Delete RPC SECURITY DEFINER + manager+ gate + REVOKE PUBLIC/anon + audit | ✓ `biz_venue_table_soft_delete` mirrors 2.1b lifecycle RPCs | f41b19d6f |

(`f41b19d6f` = the single squash/close commit on this branch; see §6.)

---

## 3. Files changed

| File | Δ | What |
|------|---|------|
| `mingla-business/src/components/venue/VenueSettingsModule.tsx` | ~+70 | fee-amount Input + draft state + cents conversion + needs-amount state + active gating |
| `mingla-business/src/components/venue/venueFeeGate.ts` | +40 | `paidFeeIsActive` + `feeAmountValidForSave` pure helpers |
| `mingla-business/src/utils/currency.ts` | +11 | `minorFromMajor` (inverse of `majorFromMinor`, currency-aware, integer-safe) |
| `mingla-business/src/components/venue/VenueTableSheet.tsx` | ~+55 | Delete button (edit mode) + ConfirmDialog wiring |
| `mingla-business/src/components/venue/VenueTablesModule.tsx` | ~+25 | `useDeleteVenueTable` wire-up + `handleDelete` + sheet props |
| `mingla-business/src/hooks/useVenueTables.ts` | ~+30 | list `.is("deleted_at", null)` filter + `useDeleteVenueTable` |
| `supabase/migrations/20261013000002_orch_1148_venue_table_soft_delete.sql` | NEW | `deleted_at` column + index + engine v3 re-emit + `biz_venue_table_soft_delete` RPC |
| `mingla-business/src/components/venue/__tests__/venueFeeAmount.test.ts` | NEW | fee-amount validity + cents-conversion happy-path |
| `mingla-business/src/hooks/__tests__/useVenueTables.softDelete.orch1148.test.ts` | NEW | list deleted_at filter + delete RPC call |
| `supabase/migrations/__tests__/orch_1148_table_soft_delete_migration.test.ts` | NEW | source-level migration regression (7 assertions) |
| `supabase/migrations/__tests__/orch_1148_table_soft_delete_engine.test.sql` | NEW | live SQL: soft-deleted table → 0 slots |

---

## 4. Data-model changes

- **`venue_tables.deleted_at timestamptz NULL`** — additive (`ADD COLUMN IF NOT EXISTS`). NULL = live.
- **Index** `venue_tables_brand_active_idx` recreated as `WHERE is_active AND deleted_at IS NULL` (leaner hot path).
- **No FK / constraint change.** `reservations.table_id` FK is untouched — soft-delete keeps the row, so historical reservations stay valid.

## 5. Edge functions / RPCs

No edge functions touched. Two SQL functions in the new migration:
- `pg_venue_available_slots(uuid, date, int)` — engine **v3** re-emit, `STABLE SECURITY DEFINER`, signature + 4-col return FROZEN, only `AND t.deleted_at IS NULL` added. Anon EXECUTE **not** revoked (the 2.2 grant `20261012000000` stands); authenticated re-asserted.
- `biz_venue_table_soft_delete(uuid)` — `SECURITY DEFINER`, manager+ gate via `biz_brand_effective_rank_for_caller(auth.uid())`, idempotent, audit row, `REVOKE ALL FROM PUBLIC` + `REVOKE EXECUTE FROM anon` + `GRANT authenticated`.

---

## 6. Regression tests + fails-on-revert

- `venueFeeAmount.test.ts` (12 cases) — PASS. **Fails-on-revert verified:** reverting `paidFeeIsActive` to `return feeEnabled;` (true-line deletion of the `&& (feeAmountCents ?? 0) > 0` guard) → 3 cases FAIL; restored → PASS.
- `useVenueTables.softDelete.orch1148.test.ts` (2 cases) — PASS. **Fails-on-revert verified:** deleting the `.is("deleted_at", null)` line in `fetchVenueTables` → T-DEL-1 FAILs; restored → PASS.
- `orch_1148_table_soft_delete_migration.test.ts` (7 deno cases) — PASS (T-SD-2 pins the engine `deleted_at` filter; reverting it fails the assertion).
- `orch_1148_table_soft_delete_engine.test.sql` — live SQL, operator-runnable: asserts a live table yields slots, soft-deleting it yields 0.

`fails-on-revert verified at` the close commit (this branch HEAD).

## 7. Old → New receipts

**VenueSettingsModule.tsx** — *before:* fee toggle wrote `fee_enabled` only; `fee_amount_cents` never set → engine read FREE. *now:* amount Input (currency-aware) on toggle-ON; commits integer cents on blur; fee active only when amount > 0; needs-amount warning otherwise; toggle-OFF clears the amount. *why:* GAP 1.

**venueFeeGate.ts** — *before:* only the payout-readiness gate. *now:* + pure `paidFeeIsActive` / `feeAmountValidForSave`. *why:* fails-on-revert anchor for the amount rule.

**currency.ts** — *before:* `majorFromMinor` only. *now:* + `minorFromMajor` (inverse). *why:* major→cents conversion for the input.

**useVenueTables.ts** — *before:* list returned all rows incl. soft-deleted; no delete path. *now:* list filters `deleted_at IS NULL`; `useDeleteVenueTable` calls the guarded RPC. *why:* GAP 2.

**VenueTableSheet.tsx / VenueTablesModule.tsx** — *before:* add/edit/deactivate only. *now:* destructive Delete + confirm dialog, manager+ gated. *why:* GAP 2.

**migration 20261013000002** — *before:* no `deleted_at`; engine v2 saw all active tables. *now:* column + engine v3 excludes soft-deleted + guarded soft-delete RPC. *why:* GAP 2 server side.

## 8. Cross-surface impact

| Surface | Affected | Parity |
|---|---|---|
| Business iOS | YES — Settings amount field + table delete | shared RN code (auto) |
| Business Android | YES — same | shared RN code (auto); glass via GlassCard/Sheet/Modal (opaque fallback automatic) |
| Business Web desktop | YES — same | shared RN-on-web (auto) |
| Business Web phone | YES — same | shared RN-on-web (auto) |
| Buyer/anon Web | NO — operator-only Settings/Tables | n/a |
| Consumer iOS/Android | INDIRECT — a soft-deleted table stops appearing in availability (engine v3); no consumer code touched | engine RPC shared |
| Admin Web | NO | n/a |

## 9. Smoke result

No sim/device run this session (no native change; pure-JS + SQL). Jest + deno gates + strict-grep gates run and pasted (§6, §10). UNVERIFIED-on-device: visual layout of the amount field + delete dialog on a physical phone — tester to confirm.

## 10. Gates run (this session)

- jest (3 suites): 21 passed.
- deno migration test: 7 passed.
- tsc `--noEmit`: 0 errors in touched files (358 pre-existing repo-wide, none in changed files).
- eslint (changed files): 0 errors (2 array-type warnings fixed).
- strict-grep: `orch-1148-no-buyer-tax-form-in-venue-settings`, `orch-1148-booking-core-engine-and-money-seam`, `orch-1148-reserve-sheet-gate-mirrors-button`, `orch-1075-paid-publish-integrity-guards`, `orch-1130-no-buyer-tax-form`, `i-biz-venue-input-uses-mapbox` — all PASS.

## 11. Operator action required

**Apply the migration** (after REVIEW; from the anchor or linked checkout — the worktree is not linked):

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1148-[venue-e2e-validation]" && /Users/sethogieva/bin/supabase db push --linked
```

Migration file: `supabase/migrations/20261013000002_orch_1148_venue_table_soft_delete.sql` (prefix `20261013000002`, strictly > global max `20261013000001`). Additive; no `--include-all` needed.

**No edge-function deploy** (none touched). **Optional live-SQL verification** (after apply, against a populated DB):
```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/__tests__/orch_1148_table_soft_delete_engine.test.sql
```

**Not run this session (Docker daemon down):** the migration Docker full-chain apply. Operator to run the standard local-Postgres apply chain at CLOSE, or rely on the source-level deno test + the live SQL test above.

## 12. Discoveries for orchestrator

- `useVenueReservationFee` already supported `feeAmountCents` in the patch (an earlier sub-ORCH wired the hook but never the UI) — GAP 1 was purely a missing UI control + validity gate; no hook change needed there.
- The engine v2→v3 re-emit is the **second** byte-copy of the ~200-line `pg_venue_available_slots` body in the migration chain. Future engine edits must remember the body lives in the *latest* migration. Consider extracting to a single canonical re-emittable file if it changes again (registerable follow-up; not in scope here).
