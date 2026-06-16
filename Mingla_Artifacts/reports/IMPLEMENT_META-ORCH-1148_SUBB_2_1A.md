# IMPLEMENT — META-ORCH-1148 sub-ORCH 2.1a (Venue Booking Core: Tables + Capacity Rules MVP + Availability + the Engine)

- **Skill:** mingla-implementor
- **Sub-ORCH:** META-ORCH-1148 / **2.1a** (the engine-boundary first slice of the booking core).
- **Branch / worktree:** `ORCH-1148-venue-booking-core` @ `~/Desktop/mingla-orchs/ORCH-1148-[venue-booking-core]/`
- **HEAD after rebase onto origin/main:** **`57a6714e9`** (pre-rebase commit `176eec8de`).
- **Binding SPEC:** `Mingla_Artifacts/specs/SPEC_META-ORCH-1148_SUBB_BOOKING_CORE.md` — built ONLY the **2.1a** scope per §13 (Tables + Availability + the engine + §4.2 indexes + the engine probe). NOT built (deferred to 2.1b): lifecycle RPCs, `reservation_status_history`, Reservations module, Waitlist module, `send-venue-sms`/Twilio, SMS consent/log, Overview tiles.
- **COMMS ledger:** read on entry (`/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md`). The rows relevant to 1148 (COMMS-0003/0015/0027/0035) are SMS/Twilio + native-dep + close-time-deploy concerns already acked in SPEC §0; **none apply to 2.1a** (zero edge fns, zero native deps, migrations applied by the orchestrator at merge). No new COMMS entry warranted.
- **NOT done (per directive):** no deploy, no migration applied to prod, no merge.

---

## 1. Changed files (all committed, scoped allowlist only)

### Migrations (additive-only; base `20261006*`, re-scanned monotonic above 2.0/1150/1138)
| File | Purpose |
|------|---------|
| `supabase/migrations/20261006000000_orch_1148_availability_indexes.sql` | §4.2 engine query indexes — partial index on LIVE reservations `(brand_id, table_id, reserved_for) WHERE status IN ('requested','confirmed','seated')` + `venue_capacity_rules (brand_id, kind) WHERE is_active`. |
| `supabase/migrations/20261006000001_orch_1148_available_slots_rpc.sql` | **THE ENGINE** — `pg_venue_available_slots`. |
| `supabase/migrations/20261006000002_orch_1148_booking_core_probes.sql` | Read-only invariant probe (engine contract + grant boundary + party_fit + indexes). |
| `supabase/migrations/__tests__/orch_1148_venue_suite_migration.test.ts` | **Extended** (not forked) with `T-MIG-10..15` (2.1a engine/index/grant/party-fit assertions). |
| `supabase/migrations/__tests__/orch_1148_available_slots_engine.test.sql` | NEW live-psql engine behavioral test (A-1..A-9). |

### Business app
| File | Purpose |
|------|---------|
| `mingla-business/src/types/venueReservation.ts` | **Modified (add-only)** — `VenueTable(/Upsert)`, `VenueCapacityRule`, `VenueAvailabilityConfig(/Patch)`, `ServicePeriod`, `VenueBlackout(/Upsert)`, `AvailableSlot` + enums. Existing 2.0 shapes untouched. |
| `mingla-business/src/components/venue/capacityRules.ts` | NEW pure catalog — the 3 MVP rule kinds (fails-on-revert anchor). |
| `mingla-business/src/components/venue/VenueTablesModule.tsx` | NEW — table list + add/edit + deactivate + rules panel. |
| `mingla-business/src/components/venue/VenueTableSheet.tsx` | NEW — grouped add/edit table form. |
| `mingla-business/src/components/venue/VenueCapacityRulesPanel.tsx` | NEW — collapsible 3-rule MVP panel. |
| `mingla-business/src/components/venue/VenueAvailabilityModule.tsx` | NEW — config editor (periods, turn times, controls, blackouts). |
| `mingla-business/src/components/venue/VenueServicePeriodSheet.tsx` | NEW — add/edit service period. |
| `mingla-business/src/components/venue/VenueBlackoutSheet.tsx` | NEW — add/edit/delete blackout (all/zone/table scope). |
| `mingla-business/src/components/venue/VenueSuiteShell.tsx` | **Modified (surgical)** — dispatch swap ONLY (tables→`VenueTablesModule`, availability→`VenueAvailabilityModule`; reservations/waitlist stay ComingSoon). `activeModule` machine, layouts, store bridge, Overview self-scroll preserved. |
| `mingla-business/src/hooks/useVenueTables.ts` | NEW — list/upsert/setActive. |
| `mingla-business/src/hooks/useVenueCapacityRules.ts` | NEW — list/upsert (MVP kinds only at the type level). |
| `mingla-business/src/hooks/useVenueAvailability.ts` | NEW — config + blackouts CRUD + `useAvailableSlots` (the SOLE engine caller). |
| `mingla-business/src/components/venue/__tests__/capacityRules.test.ts` | NEW unit test (T-2 family). |

### Gates
| File | Purpose |
|------|---------|
| `.github/scripts/strict-grep/orch-1148-booking-core-engine-and-money-seam.mjs` | NEW gate — (A) engine sole-slot-source, (B) no checkout/pricing-engine in the booking core. Has `--self-test`. |
| `.github/workflows/strict-grep-mingla-business.yml` | **Modified** — registered the new gate (self-test + run). |

---

## 2. The engine — frozen contract signature (the reuse boundary 2.2 calls verbatim)

```
pg_venue_available_slots(
  p_brand_id   uuid,
  p_date       date,
  p_party_size int
) RETURNS TABLE (
  slot_start_utc   timestamptz,
  slot_local_label text,
  remaining        int,
  is_full          boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
```

Algorithm matches SPEC §5.0 exactly: (1) gate on `reservations_enabled` + config exists; (2) resolve the venue day from `service_periods` whose `days[]` includes `EXTRACT(dow)`; generate candidate starts by `slot_granularity_minutes`, excluding any start whose seating `(turn+buffer)` runs past the period end; (3) turn-time bucket = largest `pN` key ≤ party (default 90); (4) drop slots earlier than `now()+min_notice` / beyond the venue-local advance window; (5) whole-day `applies_to='all'` blackout → zero rows; (6) eligible tables = active + `reservation_policy='reservable'` + **party_fit** (`p_party_size BETWEEN COALESCE(min_party,1) AND COALESCE(max_party,capacity)`) − zone/table-scoped blackout; (7) `remaining = LEAST(max_per_slot ?? eligible_cnt, eligible_cnt) − overlapping LIVE reservations` (overlap = `(requested|confirmed|seated)` rows whose `[reserved_for, +turn)` window intersects the candidate `[slot, +turn+buffer)` and whose table is eligible OR NULL); (8) deposit/fee left to the caller (engine stays purely time/seat); (9) full slots RETURNED with `is_full=true`, ordered by `slot_start_utc`.

**Grant boundary:** `REVOKE ALL FROM PUBLIC; REVOKE EXECUTE FROM anon; GRANT EXECUTE TO authenticated`. The `anon` revoke is required because Supabase's `public`-schema `ALTER DEFAULT PRIVILEGES` auto-grants EXECUTE to anon/authenticated/service_role on every new function — **proven necessary live** (the probe RAISEd until anon was explicitly revoked). The anon GRANT is the only documented 2.2 widening (named seam in the migration comment).

**Timezone correctness:** the venue-local-midnight anchor is materialised as `timestamptz` via `... AT TIME ZONE 'UTC'` (matching the contract's `timestamptz`); the `slot_local_label` and advance-window date are computed tz-independently via `AT TIME ZONE 'UTC' + offset`, so a client in any session tz gets the correct venue-local label. Offset resolved from `place_pool.utc_offset_minutes` (fallback 0/UTC).

---

## 3. Gate results

| Gate | Result |
|------|--------|
| Engine behavioral test (live `psql`, Supabase Postgres `17.4.1.075`, A-1..A-9) | **PASS** — all 9. Proves turn-time + no-past-end seatings (4 party-4 slots 17:00–18:30), granularity stepping (5 party-2 slots), out-of-service-day → 0, party_fit (party 12 → 0), live-reservation subtraction, full-slot returned `is_full=true`, **cancelled/non-live NOT counted**, whole-day blackout → 0, disabled-venue → 0. |
| Full migration apply (all migrations in order, fresh container) | **PASS** — incl. 2.1a engine + probe (probe NOTICE fired). |
| `deno test orch_1148_venue_suite_migration.test.ts` | **15 passed / 0 failed** (9 carried 2.0 + 6 new T-MIG-10..15). |
| `capacityRules.test.ts` (jest, T-2 family) | **5 passed**. |
| Full venue jest suite (`src/components/venue`) | **39 passed / 39** (8 suites — 2.0 tests incl. `venueSuiteLeakAndExit.tester.adversarial` + `venueModules` + `venueShellScroll` all still green). |
| `orch-1148-booking-core-engine-and-money-seam.mjs` `--self-test` + live | **PASS** (engine sole-source + money seam held). |
| I-39 a11y (`i39-pressable-label.mjs`) | **PASS** — 452 .tsx scanned, **0 violations** (every new Pressable has an a11y label). |
| `tsc --noEmit` (mingla-business) | **0 new errors** — 326 pre-existing baseline confirmed via stash-and-rerun (326 → 326). |
| `eslint` (all 13 changed business files) | **0 errors** (unused-import + exhaustive-deps warnings fixed → clean). |

---

## 4. Fails-on-revert proofs

| Invariant | Test | Revert applied | Result |
|-----------|------|----------------|--------|
| Engine subtracts live reservations | `orch_1148_available_slots_engine.test.sql` A-5 (live psql) | dropped the overlap subtraction (`v_cap_per_slot - 0 * (...)`) | A-5 **FAIL** ("remaining must be 1 … got 2" = the over-book bug); restore → ALL A-1..A-9 PASS. |
| Engine enforces party_fit server-side | `T-MIG-14` (deno) | replaced the `BETWEEN min_party..max_party` predicate with `TRUE` | **15→14 passed, 1 failed**; restore → 15 pass. |
| Catalog ships exactly the 3 MVP kinds | `T-2/T-2b/T-2c` (jest) | added `approval_required` to `CAPACITY_RULE_MVP_KINDS` | **4 of 5 FAIL**; restore → 5 pass. |
| Engine sole-source + money seam | strict-grep gate | injected `"ticket-checkout-create"` + `"pg_venue_available_slots"` into `VenueTablesModule.tsx` | gate **FAIL (2 violations)** (A + B); restore → pass. |

---

## 5. Hard-guard compliance

- **Money seam HELD:** ZERO reference to `ticket-checkout-create` / `allInPricingEngine` / Stripe / Paystack in any 2.1a file (gate B + grep verified). Manual bookings don't exist in 2.1a (that's 2.1b create RPC); no charge path touched.
- **DO-NOT-TOUCH respected:** `git diff --name-only` confirms NONE of `ticket-checkout-create`, `allInPricingEngine`, `VenueSettingsModule.tsx`, `useVenueReservationSettings.ts`, `venueFeeGate.ts`, `venueModules.ts`, `VenueModulePillRow.tsx`, `venueShellScroll.ts`, `venueSuiteStore.ts`, `VenueListingContent.tsx`, the hub nav files (`hub/_layout.tsx` / `HubSubNav.tsx` / `useHubTabs.ts`), `app-mobile/`, buyer-web, or `mingla-admin/` were touched. Reservations + Waitlist ComingSoon slots preserved.
- **Android opaque glass:** all cards/sheets use `GlassCard` / `Sheet` (opaque Android fallback automatic). No bespoke translucent fills.
- **Tokens only** (`spacing/radius/typography/text/accent/semantic`); no hardcoded design values beyond the established `rgba(...)` switch-track convention copied from `VenueSettingsModule`.
- **Currency-aware:** deposit threshold is a party-SIZE param (not a money amount); no currency rendered in 2.1a, so no GBP-fallback risk.
- **No dead taps / a11y:** every Pressable carries `accessibilityRole` + `accessibilityLabel` (I-39 = 0 violations). Read-only (below-manager) states render an explicit note, not a disabled-mystery.
- **`_hasHydrated`:** N/A — 2.1a adds no persisted Zustand store; all server data lives in React Query (the cache is the source).
- **No native deps / runtime bump** (COMMS-0035): zero new `expo-*`/native modules; all UI reuses present primitives. OTA-safe.
- **`[TRANSITIONAL]` exit conditions:** the 3 DRAFT invariants carry their flip-ACTIVE-on-CLOSE condition in SPEC §11; the engine migration documents the single 2.2 anon-GRANT seam inline.

---

## 6. SPEC ambiguities / decisions

1. **Supabase auto-anon-grant (not in SPEC).** SPEC §5.4 asserts the engine grants `authenticated` and NOT `anon`. On the live Supabase image, `public`-schema default privileges auto-grant EXECUTE to anon — so `GRANT … TO authenticated` alone leaves anon present and the probe RAISEs. Resolved by adding an explicit `REVOKE EXECUTE … FROM anon` (documented inline as the inverse of the 2.2 seam). This is the correct, intent-preserving fix; flag for the tester to confirm on the prod project's default-privilege config.
2. **`reservation_policy` exposure in the table form.** SPEC's Tables list mentions policy; 2.1a offers only `reservable` + `walk_in_only` chips (NOT `approval_required`, which is a 2.2 consumer-flow seam). The engine surfaces `reservable` only, matching SPEC §5.0 step 6.
3. **`deposit_threshold` is display/config-only** (per SPEC §5.0 step 8) — the engine does NOT return a fee column; the rule is stored for the caller (2.2) to read. The panel persists `params.min_party_for_fee`; no charge.
4. **Behavioral SQL test requires a seed `creator_accounts` row** (brands.account_id → creator_accounts → auth.users, all NOT NULL). The test reuses any existing creator account and RAISEs a clear message if none exists (it ROLLBACKs all fixtures). For a fresh DB the tester seeds one auth.users + creator_accounts (the proof run did exactly this).

---

## 7. Downstream

NEXT = **mingla-tester** (business iOS + Android + web-desktop + web-phone device/sim proof of the Tables + Availability modules + the manual-config round-trip; the engine determinism + RLS + slot-math via the live `.test.sql`; confirm the money seam + ComingSoon-on-reservations/waitlist held). Then **mingla-orchestrator CLOSE** — apply the 3 migrations via Management API from MERGED main, run `get_advisors` security, flip the 3 DRAFT invariants ACTIVE, register 2.1a on the World Map. Then **2.1b** (Reservations + Waitlist + SMS + tiles, calling the engine via the create picker), then **2.2** (consumer surface + the engine's `anon` GRANT seam).

*No deploy / no migration applied to prod / no merge performed by this implementor.*

---

## 8. Engine defect fixes (P3-1 / P3-2 / P3-3)

The tester (`reports/TEST_META-ORCH-1148_SUBB_2_1A.md`, CONDITIONAL PASS) found three engine modeling/limitation defects that ride the FROZEN reuse contract verbatim into 2.2's consumer booking. All three are now fixed IN the engine (and the minimal schema/UI each requires), the function **signature + 4-column return are unchanged** (internal-correctness only), and each is **proven live + fails-on-revert**.

**New migrations (additive, monotonic above every worktree + origin/main — max prior was `20261007000000`):**
- `supabase/migrations/20261008000000_orch_1148_availability_iana_timezone.sql` — P3-3 tz column + write-time validation trigger + location-sourced backfill.
- `supabase/migrations/20261008000001_orch_1148_available_slots_rpc_v2.sql` — the engine **v2** (all 3 fixes) + the shared `pg_venue_turn_minutes_for_party(jsonb,int)` helper.
- `supabase/migrations/20261008000002_orch_1148_booking_core_p3_probes.sql` — read-only fails-on-revert probe for all 3 fixes.

**Touched (non-migration):** `mingla-business/src/components/venue/VenueTableSheet.tsx` (P3-2 UI write-time guard), `supabase/migrations/__tests__/orch_1148_venue_suite_migration.test.ts` (+T-MIG-16..20), `Mingla_Artifacts/tests/TEST_META-ORCH-1148_SUBB_2_1A_adversarial_engine.test.sql` (B-3/B-4/B-8 flipped to fails-on-revert PASS assertions + place_pool fixture hardened).

### P3-1 — heterogeneous turn-time (existing reservation now uses ITS OWN turn)
**Before** (the overlap subquery modelled BOTH ends of an existing reservation's window with the *querying* party's `v_turn_min`):
```sql
AND r.reserved_for < (w.slot_utc + make_interval(mins => v_turn_min + v_buffer_min))
AND (r.reserved_for + make_interval(mins => v_turn_min)) > w.slot_utc
```
**After** (each existing reservation occupies its table from its start for ITS OWN party-size turn (+buffer), looked up per-row; the candidate window still uses the querying party's turn):
```sql
AND r.reserved_for < (w.slot_utc + make_interval(mins => v_turn_min + v_buffer_min))
AND (r.reserved_for + make_interval(mins =>
       public.pg_venue_turn_minutes_for_party(v_cfg.turn_times, r.party_size) + v_buffer_min)) > w.slot_utc
```
The per-party bucket rule (largest key ≤ party_size, else max bucket, else 90) is extracted into the IMMUTABLE shared helper `pg_venue_turn_minutes_for_party`, used for both the querying party and per-row.
**Live proof:** a party-2 booking on a party-4-eligible table (own turn 60 → truly ends 19:00), queried as party-4 (turn 120), no longer reduces the 19:00 slot (`remaining=2`, full cap, half-open touch). Adversarial **B-3 flipped DEFECT-CONFIRMED → PASS.**

### P3-2 — over-seat (effective max party clamped to capacity)
**Before:** `p_party_size BETWEEN COALESCE(t.min_party, 1) AND COALESCE(t.max_party, t.capacity)` — a cap-2 table with `max_party=8` offered slots to large parties.
**After:** `p_party_size BETWEEN COALESCE(t.min_party, 1) AND LEAST(COALESCE(t.max_party, t.capacity), t.capacity)` — a table can never seat more than its capacity. **Belt-and-braces:** `VenueTableSheet.tsx` now blocks save (inline error + `canSave` gate) when `maxParty > capacity` AND defensively clamps `Math.min(maxParty, capacity)` at write time, so bad data can't be entered.
**Live proof:** a cap-2/max-8 table offers **0** party-7 slots (party 7 isolates the over-seat from a legit T6 party-6 fit). Adversarial **B-4 flipped DEFECT-CONFIRMED → PASS.**

### P3-3 — DST (static offset → IANA timezone, DST-aware)
**Before:** a single static `place_pool.utc_offset_minutes` (e.g. -300) — `(p_date::timestamp - make_interval(mins => v_offset_min)) AT TIME ZONE 'UTC'` and the label `+ make_interval(mins => v_offset_min)`; 1h wrong for half the year.
**After:** convert via the venue's IANA timezone (`venue_availability_config.iana_timezone`): bounds `(p_date::timestamp) AT TIME ZONE v_tz`, label `to_char(s.slot_utc AT TIME ZONE v_tz, 'HH24:MI')`, advance-window date `(v_now AT TIME ZONE v_tz)::date`. Postgres resolves the correct DST offset per date. The static `utc_offset_minutes` is removed from the engine body.
**tz-column DECISION:** added `iana_timezone text NOT NULL DEFAULT 'UTC'` to **`venue_availability_config`** (the engine's own config table), NOT `place_pool`. Rationale: place_pool is the Google-seeded discovery pool (carries only the numeric offset, owned by the seeding pipeline, no SQL-pure lat/lng→IANA), and the Availability config is exactly where the operator tunes the reservation clock — keeping the tz there makes the engine self-sufficient and matches the events/trips precedent (`event_dates.timezone` used via `AT TIME ZONE`). A CHECK can't hold a subquery, so validity (against `pg_timezone_names`) is enforced by a BEFORE INSERT/UPDATE trigger (also normalises NULL/'' → 'UTC'). Existing rows are backfilled from the venue's `place_pool.country` (+ known US/CA offsets) → representative IANA zone, default 'UTC'.
**Live proof:** a US-Eastern venue (`America/New_York`) materialises a July (EDT) 18:00-local slot at **22:00Z** (UTC-4) and a January (EST) 18:00-local slot at **23:00Z** (UTC-5) — same wall clock, correct DST per season. The bad-zone write is rejected by the trigger. Adversarial **B-8 flipped LIMITATION-CONFIRMED → PASS.**

### Live verification (Docker `supabase/postgres:17.4.1.075`)
Applied the REAL migrations from scratch in a fresh container (all 230 in version order) — **clean apply, all 3 probes fired their PASS NOTICE** (2.0 probe, 2.1a probe, P3 probe). Then, fully independently:
- **Targeted P3 proofs** — P3-1 / P3-2 / P3-3 (summer + winter) + the tz write-guard: ALL PASSED.
- **Implementor A-1..A-9** — 9/9 PASS (no regression; default `iana_timezone='UTC'` ≡ old offset 0).
- **Tester adversarial B-1..B-12** — all PASS, including the three previously-failing-by-design cases (B-3, B-4, B-8) now flipped to PASS with hard fails-on-revert assertions.
- **Grant boundary (live-fire)** — engine ACL = authenticated + service_role + postgres only; `SET ROLE anon` → `permission denied`; `SET ROLE authenticated` → allowed. anon REVOKE preserved.

### Fails-on-revert (cited)
Reverting from the **v2 engine** (`20261008000001`) back toward the **v1 engine** (`supabase/migrations/20261006000001_orch_1148_available_slots_rpc.sql`, shipped at parent commit `c06ebde27`) re-fails each fix:
- **P3-1:** apply v1 → adversarial **B-3 RAISEs** (`remaining expected 2 got 1`) AND the P3 probe RAISEs (`overlap window must use … r.party_size`). Restore v2 → PASS.
- **P3-2 (isolated):** swap the `LEAST(COALESCE(max_party,capacity),capacity)` clamp back to `COALESCE(max_party,capacity)` → B-3 still PASS (P3-1 intact), **B-4 RAISEs** (`a party of 7 was offered 3 slots on a CAPACITY-2 table`). Restore → PASS.
- **P3-3 (isolated):** swap the venue tz to a fixed no-DST zone (`Etc/GMT+5`, mimicking the old static -300) → the July 18:00 slot regresses **22:00Z → 23:00Z** (the 1-hour error), proving the IANA/DST conversion is load-bearing. Restore → 22:00Z.

### Gates
| Gate | Result |
|------|--------|
| Full fresh in-order migration apply (Docker, 230 files) | **PASS** — clean, 3 probes PASS |
| Engine A-1..A-9 (live psql, fresh container) | **9/9 PASS** (no regression) |
| Adversarial B-1..B-12 (live psql, fresh container) | **all PASS** (B-3/B-4/B-8 flipped to PASS) |
| `deno test orch_1148_venue_suite_migration.test.ts` | **20/20 PASS** (15 carried + new T-MIG-16..20) |
| Venue jest (`src/components/venue`) | **39/39 PASS**, 8 suites |
| `orch-1148-booking-core-engine-and-money-seam.mjs` `--self-test` + live | **PASS** (money seam clean — no charge path in the booking core) |
| I-39 a11y (`i39-pressable-label.mjs`) | **PASS** — 460 .tsx, 0 violations |
| `tsc --noEmit` (mingla-business) | **333 → 333 (DELTA 0)**; 0 errors in `VenueTableSheet.tsx` |
| `eslint` `VenueTableSheet.tsx` | **exit 0, clean** |

Money seam unchanged: no checkout/pricing-engine/Stripe/Paystack reference added; the engine moves no money. Signature + 4-col return + SECURITY DEFINER + locked search_path + authenticated-only EXECUTE (anon REVOKE) all preserved.

*No deploy / no migration applied to prod / no merge performed by this implementor. These fixes ride into 2.2 at the same commit the `anon` GRANT seam lands.*
