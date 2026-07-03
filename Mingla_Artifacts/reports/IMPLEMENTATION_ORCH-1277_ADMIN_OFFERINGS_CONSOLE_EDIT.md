# IMPLEMENTATION — ORCH-1277 [Admin Offerings console — WAVE-2 EDIT / moderation]

**Parent:** META-ORCH-1237. **Predecessor:** ORCH-1273 (offerings/venues READ, shipped). **Foundation:** ORCH-1271 (single gate + `admin_write_audit` + `HighRiskActionModal`) · ORCH-1276 (shared `EntityEditModal`).
**Surface:** Admin Web (`mingla-admin/`) + backend (2 migrations, 16 write RPCs). No shipping-app surface.
**Working tree:** `~/Desktop/mingla-orchs/1277-[admin-offerings-edit]/` on branch `1277-admin-offerings-edit` (rebased onto `origin/main`).
**Status:** implemented + self-verified (gates + build + 224 node:tests green; fails-on-revert proven). NOT deployed / merged (orchestrator owns DEPLOY + CLOSE).

---

## 1. Summary (plain English)

The admin Offerings + Venues detail pages could previously only SEE offerings; now an admin can ACT on them for support/moderation. Sixteen audited server actions ship: unpublish/republish, cancel (no refund), close/reopen bookings, soft-delete/restore, fix a mispriced ticket/trip tier, edit + reorder a trip itinerary day, edit + reorder + remove an experience stop, approve/deny/remove an RSVP guest, adjust RSVP capacity/waitlist, edit venue reservation settings + a capacity rule, and override a reservation status. Every action demands a typed reason (except one-tap approve + the two audit-only reorders) and records a `before/after` audit row bound to the acting admin. Value-bearing edits reuse the ORCH-1276 `EntityEditModal`; valueless high-risk actions use the shipped `HighRiskActionModal`. No new edit modal was created.

## 2. SPEC success-criteria coverage

| SC | Status | Evidence (commit `0673e3893` unless noted) |
|---|---|---|
| AC-1.1 guard-first / anon no-EXECUTE (16 RPCs) | ✓ built | Each RPC's first statement is `IF NOT public.is_admin_user() THEN RAISE 'not_authorized'`; each `REVOKE EXECUTE … FROM anon, PUBLIC` + `DO $$` `has_function_privilege('anon', …)=false` self-assert. `i-admin-gate-first-statement` + `i-offerings-writes-audited` PASS. Live anon-403 = tester (needs deploy). |
| AC-1.2 empty-reason RAISEs `reason_required`, no mutation/audit (HIGH); audit-only accept NULL | ✓ built | 14 HIGH RPCs gate `reason_required` before before-capture; the 2 reorders + approve-path pass `p_require_reason => false`. Regression suite asserts the split. Live = tester. |
| AC-1.3 exactly-one audit row, non-forgeable actor, before/after | ✓ built | `admin_write_audit(before/after)` in every RPC; actor bound server-side inside the 1271 helper (`p_actor_*` ignored for JWT callers). Live = tester. |
| AC-2.1 visibility flip+restore | ✓ built | `admin_set_offering_visibility` + UI. HP live = tester (PROD `699afd22`). |
| AC-2.2 cancel → cancelled, `already_cancelled` on 2nd, no refund | ✓ built | body sets `status='cancelled'`, RAISEs `already_cancelled`, no money token (regression asserts). |
| AC-2.3 bookings close/reopen + timestamp | ✓ built | `admin_set_offering_bookings_closed`. |
| AC-2.4 soft-delete still admin-visible | ✓ built | `admin_set_offering_deleted` (before-capture w/o `deleted_at` filter). Cross-read = tester (dev-branch). |
| AC-3.1 ticket price fix; `<0` → `invalid_price` | ✓ built | `admin_set_ticket_price`. |
| AC-3.2 trip-day edit + reorder w/o unique-violation | ✓ built | `admin_update_trip_day` + `admin_reorder_trip_day` loop-based min-1 sentinel renumber. Dev-branch live-fire = tester (PROD has 0 trip_days). |
| AC-3.3 experience-stop edit/remove/reorder | ✓ built | `admin_update_experience_stop` / `admin_delete_experience_stop` (hard DELETE) / `admin_reorder_experience_stop`. Dev-branch = tester. |
| AC-4.1 RSVP approve/deny reason rule | ✓ built | `admin_set_rsvp_approval` (conditional reason gate on deny). |
| AC-4.2 deny drains waitlist (trigger side-effect) | ✓ built (relied on, not extended) | documented in migration header + modal copy warns. Live = tester. |
| AC-4.3 capacity set + remove guest cascade | ✓ built | `admin_set_rsvp_capacity` + `admin_remove_rsvp_guest` (FK `ON DELETE CASCADE` verified live). |
| AC-5.1/5.2/5.3 venue settings/capacity-rule/reservation-status | ✓ built | mig 2. `no_show_fee_policy ∈ (forfeit,none)` + `zone` enum validated; reservation-override modal warns guest notified. Live = tester (dev-branch). |
| AC-6.1 build clean + net-new lint 0 | ✓ verified | `npm run build` OK (2977 modules); `eslint` on the 5 touched files = exit 0. |
| AC-6.2 correct action set per event_type + refetch | ✓ built | type-aware section builders; `load()` on every success. Runtime = tester. |
| AC-6.3 venue edit surfaces + notify warning | ✓ built | VenueDetailView. Runtime = tester. |
| AC-6.4 gate passes + no raw writes + fails-on-revert | ✓ verified | `i-offerings-writes-audited` PASS; 4 console files carry ZERO raw `.update/.insert/.delete/.upsert` + no `admin_write_audit`; fails-on-revert proven (below). |

## 3. Files changed (14 in-scope, all on the SPEC allowlist)

New:
- `supabase/migrations/20261209000000_orch_1277_offerings_edit_rpcs.sql` (RPCs #1–13, +376)
- `supabase/migrations/20261209000001_orch_1277_venue_edit_rpcs.sql` (RPCs #14–16, +176)
- `.github/scripts/strict-grep/i-offerings-writes-audited.mjs` (+~250)
- `.github/scripts/strict-grep/__tests__/i-offerings-writes-audited.test.mjs` (+~150)
- `mingla-admin/src/__tests__/orch1277_offerings_console_edit.test.js` (+~220, 83 tests)

Modified:
- `mingla-admin/src/services/offeringsService.js` (+13 write fns + `mapOfferingWriteError`, ~+150)
- `mingla-admin/src/services/venuesService.js` (+3 write fns + `mapVenueWriteError`, ~+55)
- `mingla-admin/src/pages/OfferingDetailView.jsx` (edit wiring, ~+330)
- `mingla-admin/src/pages/VenueDetailView.jsx` (edit wiring, ~+140)
- `.github/scripts/strict-grep/i-offerings-read-only.mjs` (part (c) `ALLOWED_RPCS` + self-test evolved)
- `.github/scripts/strict-grep/i-admin-write-audited.mjs` (16 RPCs appended + self-test)
- `.github/scripts/strict-grep/i-admin-gate-first-statement.mjs` (16 RPCs appended + self-test)
- `.github/workflows/strict-grep-mingla-business.yml` (job `orch-1277-offerings-admin-write`)
- `Mingla_Artifacts/INVARIANT_REGISTRY.md` (2 DRAFT invariants + 1273 supersession note)

Off-allowlist deviation (forced, documented — see §11):
- `mingla-admin/src/__tests__/orch1273_offerings_console_read.test.js` (one superseded assertion unstaled; commit `ed92ffe4c`, `[TEST-MOD-APPROVED ORCH-1277]`).

**No `AdminEditModal.jsx` created — the shared ORCH-1276 `EntityEditModal` is REUSED** (per dispatch; overrides the SPEC's modal-creation line). Verified: `components/entity/AdminEditModal.jsx` does not exist; both pages import `EntityEditModal`.

## 4. Data-model changes

16 new `SECURITY DEFINER SET search_path='public'` RPCs (golden ORCH-1271 template). No table/column/constraint/RLS changes — the 1277 write path is definer-RPC-only (no client INSERT/UPDATE RLS added). Verified live 2026-07-03: `trip_days`/`experience_stops` have an `updated_at` column but NO auto-touch trigger → RPCs set it explicitly; `event_rsvp_guests.rsvp_id` FK is `ON DELETE CASCADE`; `no_show_fee_policy` CHECK = `(forfeit,none)`; all CHECK enums + UNIQUE constraints + `venue_reservation_settings` PK=`venue_id` match the SPEC.

## 5. Edge functions touched

None. All writes are user-JWT admin RPCs (no service-role edge fn — no Stripe/refund path).

## 6. Regression test — fails-on-revert PROVEN

- Happy-path suite: `mingla-admin/src/__tests__/orch1277_offerings_console_edit.test.js` — **83 tests, all PASS**.
- Gate fixture: `.github/scripts/strict-grep/__tests__/i-offerings-writes-audited.test.mjs` — **7 tests, all PASS**.
- **fails-on-revert verified at `0673e3893`:** true LINE DELETION of the `admin_reorder_trip_day` collision-free renumber core (`v_sentinel := v_min - 1;`) → suite dropped to **82 pass / 1 fail** (test "both reorders use the loop-based sentinel (min-1) collision-free renumber"); `git checkout` restored the line → back to **83/83 PASS**.
- Full admin sweep (1271+1273+1276+1277 + 2 fixtures): **224/224 PASS**.

## 7. Old → New receipts

- **`offeringsService.js` / `venuesService.js`** — before: read-only (zero write path). now: +16 typed write wrappers via `callAdminWriteRpc` + 2 error mappers; still zero raw `.update/.insert/.delete/.upsert`; still no `admin_write_audit` reference.
- **`OfferingDetailView.jsx`** — before: read-only, empty `actions`. now: footer HIGH valueless actions (cancel `CANCEL` / close-reopen / soft-delete `DELETE`) via `HighRiskActionModal`; per-row Fix-price / day edit+reorder / stop edit+reorder+remove(`REMOVE`) / RSVP approve(one-tap)+deny+remove(`REMOVE`); Change-visibility + Adjust-capacity via `EntityEditModal`; `load()` refetch on success. No raw writes.
- **`VenueDetailView.jsx`** — before: read-only. now: edit reservation settings (incl. enabled toggle) / edit capacity rule / override reservation status (modal warns guest notified) via `EntityEditModal`; `load()` refetch.
- **3 strict-grep registries/gate** — 16 RPCs appended to gate-first + write-audited registries; read-only gate part (c) evolved to whitelist the 16 write RPCs (raw-write + client-audit bans retained; table/read-RPC halves untouched).

## 8. Cross-surface impact

| Surface | Affected | Note |
|---|---|---|
| Consumer iOS/Android · Buyer web · Business iOS/Android · Business Web preview | NO | admin-only backend + web; no shipping-app code changed |
| **Admin Web** | **YES** | the only touched surface — single surface, no parity split |

An admin edit changes what organisers/buyers see (cancelled/hidden/deleted offering, re-priced tier) via the SAME data the apps already read — no shipping-app code, so those surfaces are not "touched."

## 9. Self-verify results (pasted)

- Gates (self-test + live): `i-offerings-writes-audited` PASS (8/8) · `i-offerings-read-only` PASS (7/7) · `i-admin-write-audited` PASS · `i-admin-gate-first-statement` PASS · `i-admin-single-gate` PASS · `meta-orch-0972-no-brand-kind-reads` PASS (N1–N4) · `orch-1047-brand-owner-renamed` PASS (no stale `account_owner`).
- `mingla-admin`: `npm run build` OK (2977 modules, 3.86s); `eslint` on the 5 touched files exit 0 (net-new lint 0). Repo-wide lint has 74 PRE-EXISTING errors in untouched files (SubscriptionManagementPage / UserManagementPage / etc.) — not introduced here.
- node:test: 224/224 across the admin suites.

## 10. Known issues / deferred

- No `[TRANSITIONAL]` code introduced.
- Money edits (refunds/disputes) remain ORCH-1274; venue-listing field edit (name/address/hours/category/contact) is a follow-on (SPEC Q6, DEFER); organiser edit-log mirroring deferred (SPEC Q3); reorder UX is a number-input (Q7); reservation status override has no transition graph (Q5, intentional admin escape hatch).
- Number/currency inputs use `EntityEditModal`'s `text` type (it has no `number`/`currency` field type) parsed to integer cents in the onSave handler + validated server-side — a deliberate adaptation of reusing the shared modal instead of building a bespoke one.

## 11. Operator action required (orchestrator / DEPLOY)

- **Apply the 2 migrations (orchestrator owns; monotonic vs live head `20261208000005`; no collision w/ sibling worktrees 1278/1281 — both unpicked as of 2026-07-03):**
  ```bash
  cd "/Users/sethogieva/Desktop/mingla-orchs/1277-[admin-offerings-edit]" && /Users/sethogieva/bin/supabase db push --linked
  ```
  Each migration ships a `DO $$` `has_function_privilege` self-assert that aborts apply if any RPC is anon-executable — so a bad grant fails the push rather than shipping open.
- No edge-function deploy (none touched).
- **Coordinate migration prefix with ORCH-1278 (money-edit):** 1278 must pick `20261209000002+` or `20261210*` (this ORCH claims `20261209000000/1`).
- **Tester (mingla-tester):** run the §7 AC matrix — esp. ADV rows AC-1.1/1.2 (anon-403 + reason gate live-fire), AC-1.3 (non-forgeable audit), AC-2.4 (soft-delete-still-admin-visible), AC-3.2/3.3 (reorder no unique-violation — seed trip_days/experience_stops on a dev branch, PROD has 0), AC-4.2 (waitlist drain), AC-5.3 (reservation notify outbox — dev-branch), AC-6.4 (no-raw-write + fails-on-revert). Honor COMMS-0061 (PROD is live; destructive proofs on a dev-branch clone only).
- **CLOSE:** flip the 2 `I-PROPOSED-1277-*` invariants DRAFT→ACTIVE + note the 1273 read-only supersession; merge one PR; update WORLD_MAP.

## 12. Discoveries for Orchestrator

1. **SPEC gap (handled):** the SPEC allowlist did not include `orch1273_offerings_console_read.test.js`, but its "Offering detail EMPTY actions slot" assertion is the test-level encoding of exactly the read-only clause the SPEC §6 declares superseded by 1277. Left as-is it reds CI. I made the minimal surgical unstaling (kept the surviving raw-write ban) in a SEPARATE commit `ed92ffe4c` citing `[TEST-MOD-APPROVED ORCH-1277]` (the sanctioned append-only escape). Flagged here rather than done silently.
2. **`EntityEditModal` has no `number`/`currency` field type** (only text/textarea/select/switch/json/readonly). 1277 adapts by using `text` + integer-cents parsing. If ORCH-1278 (money-edit) also reuses it for amounts, a shared `number`/`currency` field type on `EntityEditModal` would be a clean small follow-on (out of 1277 scope).
3. **Migration-prefix coordination** with the in-flight 1278/1281 worktrees (see §11) — neither has picked a `20261209*`+ prefix yet.
