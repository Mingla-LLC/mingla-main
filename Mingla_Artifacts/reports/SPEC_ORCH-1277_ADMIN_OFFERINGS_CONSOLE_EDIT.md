# SPEC — ORCH-1277 [Admin Offerings console — WAVE-2 EDIT / moderation]

**Parent:** META-ORCH-1237 (Admin full-visibility console). **Foundation:** ORCH-1271 (single admin gate + audited-write primitive + `HighRiskActionModal`) · ORCH-1273 (offerings/venues READ console — shipped + LIVE on prod).
**Phase:** SPEC (build contract). **Author:** mingla-forensics. **Mode:** WRITE — this wave ships audited EDIT/moderation actions.
**Backend:** Supabase LIVE PROD `gqnoajqerqhnvulmnyvv`. **Surface:** Admin Web (`mingla-admin/`) + backend (write RPCs). No shipping-app surface.
**Inputs consumed (read in full):** `SPEC_ORCH-1273_ADMIN_OFFERINGS_CONSOLE_READ.md` §6 (Wave-2 deferred-edit notes = starting scope), `IMPLEMENTATION_ORCH-1273_ADMIN_OFFERINGS_CONSOLE_READ.md`, `INVESTIGATION_META-ORCH-1237_OFFERINGS_EVENTS_TRIPS_EXPERIENCES_VENUES.md`, the ORCH-1271 golden write-RPC template (`20261204000003_orch_1271_p0_hardening.sql` §2d), `HighRiskActionModal.jsx`, `adminWriteService.js`, `EntityDetailView.jsx`, and the four shipped 1273 read pages + two read services + read-RPC migration.
**COMMS ledger:** scanned on entry. Only OPEN row touching scope = COMMS-0061 (WARN→ALL: `gqnoajqerqhnvulmnyvv` is LIVE PROD; restores clone-only). Honored — every probe this session was a read-only `execute_sql` SELECT; this SPEC mutates nothing (the orchestrator owns DEPLOY, which is a migration apply, not a DR restore). WARN, not BLOCK → factored, no ledger write.

> Every schema/column/constraint/policy/trigger/enum name below was re-verified against LIVE PROD via read-only `execute_sql` on 2026-07-03. Citations: `[verified]` = confirmed this session; `[1271]`/`[1273]` = inherited contract; `[report]` = sealed by the cited investigation. The ORCH-1271/1273/1274 foundation lives on `origin/main` (local anchor is behind — implementor rebases onto `origin/main` in the worktree before working).

---

## 1. Executive summary

The 1273 console lets an admin SEE every offering/venue (incl. draft/private/cross-brand). ORCH-1277 gives the admin the power to ACT on them for support/moderation — unpublish, cancel, close/reopen bookings, soft-delete/restore an offering; fix a mispriced ticket tier; fix/reorder a trip itinerary day; edit/remove/reorder an experience stop and correct its AI text; approve/deny/remove an RSVP guest and adjust capacity; edit a venue's reservation settings/capacity and override a reservation's status. Every mutation runs through a single-gate, `is_admin_user()`-gated `SECURITY DEFINER` write RPC built on the ORCH-1271 golden template (guard-first → reason gate → before-capture → mutate → `admin_write_audit` → least-privilege `REVOKE`). High-risk actions demand a typed reason + confirm in the shipped `HighRiskActionModal` (or the new value-collecting `AdminEditModal`); low-risk reorders are audit-only. Admin twins are separate from the brand-gated `biz_update_live_*` organiser path — they never reuse the brand rank gate.

---

## 2. Scope & non-goals

### In scope (16 audited write RPCs + UI wiring)

Six action groups over the ONE `events` hub (`event_type` ∈ `event`/`rsvp`/`trip`/`experience`) plus venues:

1. **Any offering (`events`):** unpublish (`visibility`), cancel (`status`), close/reopen bookings (`bookings_closed`), soft-delete/restore (`deleted_at`).
2. **Standard event:** fix a mispriced `ticket_types` tier (`price_cents`).
3. **Trip:** fix a `trip_days` itinerary day (title/narrative/date), reorder a day (`ordinal`), fix a pricing tier (via the tier's linked `ticket_types` row — reuses the price RPC).
4. **Experience:** edit/moderate an `experience_stops` item + correct `ai_description`, remove a stop, reorder a stop (`stop_order`).
5. **RSVP:** approve/deny an `event_rsvps` guest, remove a guest, adjust capacity/waitlist (`events.rsvp_capacity`/`rsvp_waitlist_enabled`).
6. **Venue:** edit reservation settings (`venue_reservation_settings`) incl. the enabled toggle, edit a capacity rule (`venue_capacity_rules`), override a `reservations` row status.

### Non-goals (HARD — do NOT build in 1277)

- **NO refunds / money movement.** Cancel sets `status='cancelled'` and audits; it issues NO refund. Refund/dispute/payout actions are ORCH-1274 (Money console) — out of scope. The cancel modal copy names this ("Refunds are handled in the Money console").
- **NO venue-listing field edit** (name/address/hours/category/contact/cover). §6 of the 1273 SPEC lists `admin_update_venue`, but the numbered 1277 scope covers only reservation settings/capacity + reservation status. Venue-listing edit = a follow-on ORCH (Open Q6, default DEFER).
- **NO buyer/guest re-notification wiring beyond existing triggers.** The admin RPCs do NOT compute `affected_order_ids` or send bespoke buyer emails; existing DB triggers (`orch_1161_reservation_notify_trg`, RSVP waitlist drain) fire as designed — documented in §5, not extended.
- **NO new authorization primitive.** 1277 consumes `is_admin_user()` [1271], `admin_write_audit` [1271], `HighRiskActionModal` + `EntityDetailView.actions` [1271], and the shipped 1273 pages/services. It does not redefine them. **NO `brands.kind`.**
- **NO reuse of the brand-gated `biz_*` path.** `biz_update_live_trip`/`biz_update_live_experience` are `biz_brand_effective_rank`-gated organiser RPCs; the admin twins are independent `is_admin_user()`-gated RPCs. They are NOT modified.
- **NO change to the 1273 READ RLS policies or READ RPCs.** They stay SELECT-only / `STABLE` / mutation-free forever. 1277 adds writes via NEW definer RPCs; it does NOT loosen any read policy into a write policy, and adds NO client INSERT/UPDATE RLS on any offering table (writes go only through definer RPCs).
- **NO un-cancel** (`cancelled → live`) and **NO status promotion** (`draft → scheduled/live`). Admin state-changes only move toward hidden/closed/cancelled/deleted (+ their reversals: republish, reopen, restore). Promotion belongs to the organiser publish flow.

### Assumptions

- ORCH-1273 has SHIPPED to prod [verified — commit `9ab04109c` on `origin/main`; 14 read RLS + 6 read RPCs live]. 1277 extends its pages/services; **if the 1273 branch is not merged into the working base, 1277 BLOCKS** (Open Q1).
- The admin browser holds the anon key + an admin-session JWT. Every 1277 write RPC is a **user-JWT admin RPC**: `REVOKE EXECUTE FROM anon, PUBLIC; GRANT EXECUTE TO authenticated;` with the internal `is_admin_user()` guard as the real gate. NO service-role edge function is needed (no Stripe/refund path).

### Risk classification (Seth's rule)

**HIGH-risk = typed REASON + CONFIRM (`HighRiskActionModal`/`AdminEditModal`) + server-side AUDIT.** **Audit-only = one-tap, no reason gate, still audited** (reorders + RSVP approve).

| # | Action | Table.column | Write RPC | Risk | UI modal |
|---|---|---|---|---|---|
| 1 | Unpublish / republish offering | `events.visibility` | `admin_set_offering_visibility(uuid,text,text)` | HIGH | AdminEditModal (visibility select) |
| 2 | Cancel offering | `events.status`→`cancelled` | `admin_cancel_offering(uuid,text)` | HIGH (destructive, confirmPhrase `CANCEL`) | HighRiskActionModal |
| 3 | Close / reopen bookings | `events.bookings_closed`(+`bookings_closed_at`) | `admin_set_offering_bookings_closed(uuid,boolean,text)` | HIGH | HighRiskActionModal |
| 4 | Soft-delete / restore offering | `events.deleted_at` | `admin_set_offering_deleted(uuid,boolean,text)` | HIGH (delete: destructive, confirmPhrase `DELETE`) | HighRiskActionModal |
| 5 | Fix mispriced ticket / trip tier | `ticket_types.price_cents` | `admin_set_ticket_price(uuid,integer,text)` | HIGH | AdminEditModal (currency number) |
| 6 | Fix a trip itinerary day | `trip_days` (title/narrative/date) | `admin_update_trip_day(uuid,jsonb,text)` | HIGH | AdminEditModal (multi-field) |
| 7 | Reorder a trip itinerary day | `trip_days.ordinal` | `admin_reorder_trip_day(uuid,integer,text)` | AUDIT-ONLY | AdminEditModal (number, reason optional) |
| 8 | Edit / moderate an experience stop | `experience_stops` (ai_description/place_name/address/start_time) | `admin_update_experience_stop(uuid,jsonb,text)` | HIGH | AdminEditModal (multi-field) |
| 9 | Remove an experience stop | `experience_stops` (row DELETE) | `admin_delete_experience_stop(uuid,text)` | HIGH (destructive, confirmPhrase `REMOVE`) | HighRiskActionModal |
| 10 | Reorder an experience stop | `experience_stops.stop_order` | `admin_reorder_experience_stop(uuid,integer,text)` | AUDIT-ONLY | AdminEditModal (number, reason optional) |
| 11 | Approve / deny an RSVP guest | `event_rsvps.approval_status` | `admin_set_rsvp_approval(uuid,text,text)` | deny = HIGH; approve/pending = AUDIT-ONLY | deny → HighRiskActionModal; approve → one-tap |
| 12 | Remove an RSVP guest | `event_rsvps` (row DELETE, cascades `event_rsvp_guests`) | `admin_remove_rsvp_guest(uuid,text)` | HIGH (destructive, confirmPhrase `REMOVE`) | HighRiskActionModal |
| 13 | Adjust RSVP capacity / waitlist | `events.rsvp_capacity`,`rsvp_waitlist_enabled` | `admin_set_rsvp_capacity(uuid,integer,boolean,text)` | HIGH | AdminEditModal (number + toggle) |
| 14 | Edit venue reservation settings | `venue_reservation_settings` (enabled/fee/cutoff/no_show) | `admin_update_venue_reservation_settings(uuid,jsonb,text)` | HIGH | AdminEditModal (multi-field) |
| 15 | Edit a venue capacity rule | `venue_capacity_rules` (params/is_active/zone) | `admin_update_venue_capacity_rule(uuid,jsonb,text)` | HIGH | AdminEditModal (multi-field) |
| 16 | Override a reservation status | `reservations.status` | `admin_set_reservation_status(uuid,text,text)` | HIGH | AdminEditModal (status select) |

---

## 3. Foundation-contract dependencies (do NOT reinvent)

| Inherited artifact | Source | How 1277 uses it |
|---|---|---|
| `is_admin_user()` gate | 1271 §1 [verified] | Sole gate; FIRST statement of every write RPC. |
| **Golden write-RPC template** | `20261204000003…§2d` [verified] | MANDATORY shape for all 16 RPCs: guard-first → reason gate → `SELECT to_jsonb(t) INTO v_before … IF v_before IS NULL RAISE 'not_found'` → `UPDATE … SET …, updated_at = now() RETURNING to_jsonb() INTO v_after` → `PERFORM admin_write_audit('<entity>.<verb>', '<entity>', p_id::text, p_reason, jsonb_build_object('before',v_before,'after',v_after))` → `REVOKE EXECUTE FROM anon, PUBLIC; GRANT EXECUTE TO authenticated;`. |
| `admin_write_audit(p_action,p_entity_type,p_entity_id,p_reason,p_metadata,p_require_reason,…)` | 1271 [verified] | The audit sink. JWT caller's actor is bound server-side (cannot be forged); `p_actor_*` IGNORED for JWT callers; EXECUTE granted to `service_role` + definer RPCs only. Called in `SECURITY DEFINER` (definer=postgres) context, so the admin RPC reaches it. `p_require_reason=false` for audit-only actions. |
| `admin_audit_log` (`admin_email,actor_uid,action,target_type,target_id,reason,metadata`) | 1271 [verified] | Canonical audit table; append-only (INSERT+SELECT RLS only). Metadata carries `{before,after}`. |
| `HighRiskActionModal({title,description,confirmLabel,destructive?,requireReason?,reasonLabel?,confirmPhrase?,onConfirm:async({reason})=>void,successMessage})` | 1271 `HighRiskActionModal.jsx` [verified] | Confirm disabled until `reason.trim()` non-empty (when `requireReason`) AND `confirmPhrase` matches EXACTLY; submitting→inline-error-preserves-reason; reset-on-close. **Consume as-is; do NOT modify.** |
| `EntityDetailView({header,sections,actions,loading,error,onRetry})` | 1271 `EntityDetailView.jsx` [verified] | `actions` = footer HighRiskAction array `{label,title,description,confirmLabel,destructive?,requireReason?,reasonLabel?,confirmPhrase?,buttonVariant?,onConfirm}`. **Consume as-is** — offering-level actions use the footer slot; per-row actions render INSIDE the existing section `render` closures (§4.2). Do NOT modify EntityDetailView. |
| `adminWriteService.callAdminWriteRpc(rpcName, params)` → `{data,error}` | 1271 [verified] | The write seam the 1277 services call. |
| Shipped 1273 read pages/services | 1273 [verified] | `OfferingDetailView.jsx`, `VenueDetailView.jsx`, `offeringsService.js`, `venuesService.js` — extended (not rebuilt). |
| `i-admin-gate-first-statement.mjs`, `i-admin-write-audited.mjs`, `i-offerings-read-only.mjs` | 1271/1273 [verified] | Append-only registries + the read-only gate to evolve (§6). |

---

## 4. Layered specification

### 4.1 Database — the 16 write RPCs (golden template, verbatim shape)

All 16: `LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'`, guard `IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;` as the FIRST executable statement, then reason gate, before-capture, mutate, audit, `RETURN v_after`. Least-privilege after each: `REVOKE EXECUTE … FROM anon, PUBLIC; GRANT EXECUTE … TO authenticated;` + a `DO $$ … has_function_privilege` self-assert block (mirrors the 1273 read-RPC migration) that aborts apply if any RPC is anon-executable. **Migration files:** `supabase/migrations/20261209000000_orch_1277_offerings_edit_rpcs.sql` (offering/event/trip/experience/rsvp RPCs, #1–13) + `20261209000001_orch_1277_venue_edit_rpcs.sql` (#14–16). Monotonic vs the live `20261207*` (1274) — implementor re-checks collision vs `origin/main` + sibling worktrees before finalizing the timestamp.

**Verified write-target facts (all confirmed live 2026-07-03):**
- `events`: `status` CHECK `(draft,scheduled,live,ended,cancelled)`; `visibility` CHECK `(public,discover,private,hidden,draft)`; `bookings_closed bool NOT NULL`, `bookings_closed_at tstz NULL`; `deleted_at tstz NULL`; `rsvp_capacity int NULL`, `rsvp_waitlist_enabled bool NOT NULL`. Has auto `trg_events_updated_at`. **Triggers to respect:** `trg_events_enforce_master_date` BEFORE UPDATE (a non-draft event must retain a master `event_date` — 1277 never promotes to non-draft, so safe; if a cancel/soft-delete on a master-date-less draft trips it, the RPC must surface the error, not swallow it — Open Q2), immutable brand_id/created_by/slug (untouched). `events_published_currency_required_check` (currency required unless `status='draft'` — 1277 never sets a null currency, safe).
- `ticket_types`: `price_cents int NOT NULL` CHECK `>= 0`; `currency` NOT NULL. Auto `trg_ticket_types_updated_at`. `trg_enforce_event_ticket_currency` BEFORE UPDATE (currency must match the event — 1277 changes ONLY `price_cents`, safe).
- `trip_days`: PK `id`; **UNIQUE `(event_id, ordinal)`**; `ordinal smallint NOT NULL`; title/narrative/date editable. **NO auto updated_at trigger → RPC MUST set `updated_at = now()` explicitly.**
- `experience_stops`: PK `id`; **UNIQUE `(event_id, stop_order)`**; `stop_order int NOT NULL`; `ai_description text NOT NULL` (edit must keep non-empty); place_name/address/start_time editable; **NO `deleted_at` column → removal = row DELETE**. **NO auto updated_at trigger → set `updated_at = now()` explicitly.**
- `event_rsvps`: PK `id`; `approval_status` CHECK `(pending,approved,denied)`; `rsvp_status` CHECK `(going,not_going,waitlisted,maybe)`; `plus_count int NOT NULL >= 0`. Auto `trg_event_rsvps_touch_updated_at`. **`event_rsvps_link_guest_contact_required` CHECK** (user_id OR guest_email+guest_phone) — 1277 changes only `approval_status`, safe. **AFTER-UPDATE `trg_rsvp_drain_on_status`** auto-promotes waitlisted guests when capacity frees (deny of a going/approved guest) — expected, documented, tested (§7).
- `reservations`: PK `id`; `status` CHECK `(requested,confirmed,seated,completed,no_show,cancelled_by_guest,cancelled_by_venue,waitlisted)`. Auto `reservations_set_updated_at`. **AFTER-UPDATE `orch_1161_reservation_notify_trg`** → guest notification outbox fires on any status change (expected; the modal copy warns "the guest is notified"). `trg_orch1255_reservations_venue_brand_match` BEFORE UPDATE (venue↔brand unchanged, safe).
- `venue_reservation_settings`: **PK `venue_id`** (not `id`); `reservations_enabled bool NOT NULL`, `fee_amount_cents int NULL`, `fee_currency char NULL`, `cancel_cutoff_hours int NOT NULL`, `no_show_fee_policy text NOT NULL`. Auto updated_at + `_orch1255_venue_belongs_to_brand` guard (safe).
- `venue_capacity_rules`: PK `id`; `params jsonb NOT NULL`, `is_active bool NOT NULL`, `kind` CHECK `(party_fit,deposit_threshold,blackout_scope,approval_required,walk_in_only,weekend_only)` (kind NOT edited by 1277), `zone` CHECK `(indoor,outdoor,private_room,bar,patio)`. Auto updated_at + `_orch1255` guard (safe).
- **Organiser edit-logs** `trip_edit_log`/`experience_edit_log` [verified cols: `event_id,brand_id,edited_by uuid,reason text CHECK len 10–200,severity text CHECK (additive|material),changed_field_keys text[],diff_summary jsonb,affected_order_ids uuid[],occurred_at`]. See Open Q3 (edit-log mirroring — default: admin_audit_log ONLY; edit-log mirroring deferred to avoid the 10–200 reason coupling + affected_order_ids buyer-notify machinery).

**Per-RPC contract (deltas from the template):**

| RPC | Params | Reason gate | Mutate | Audit action | Notes |
|---|---|---|---|---|---|
| `admin_set_offering_visibility` | `p_event_id uuid, p_visibility text, p_reason text` | required (non-empty) | validate `p_visibility` ∈ enum (else `RAISE 'invalid_visibility'`); `UPDATE events SET visibility=p_visibility` | `offering.set_visibility` | before/after visibility in metadata. |
| `admin_cancel_offering` | `p_event_id uuid, p_reason text` | required | `UPDATE events SET status='cancelled'`; `RAISE 'already_cancelled'` if already | `offering.cancel` | no refund (Q non-goal). |
| `admin_set_offering_bookings_closed` | `p_event_id uuid, p_closed boolean, p_reason text` | required | `SET bookings_closed=p_closed, bookings_closed_at = CASE WHEN p_closed THEN now() ELSE NULL END` | `offering.bookings_closed` | idempotent. |
| `admin_set_offering_deleted` | `p_event_id uuid, p_deleted boolean, p_reason text` | required | `SET deleted_at = CASE WHEN p_deleted THEN now() ELSE NULL END` | `offering.soft_delete` / `offering.restore` | before-capture must read WITHOUT a `deleted_at IS NULL` filter. |
| `admin_set_ticket_price` | `p_ticket_type_id uuid, p_price_cents integer, p_reason text` | required | `RAISE 'invalid_price'` if `p_price_cents < 0`; `UPDATE ticket_types SET price_cents=p_price_cents` | `ticket.set_price` | currency unchanged (trigger-safe). Trip pricing-tier fix reuses this on the tier's `ticket_type_id`. |
| `admin_update_trip_day` | `p_trip_day_id uuid, p_patch jsonb, p_reason text` | required | whitelist keys `{title,narrative,date}`; ignore others; `UPDATE trip_days SET …, updated_at=now()` | `trip_day.update` | reject empty/unknown-only patch → `RAISE 'no_editable_fields'`. |
| `admin_reorder_trip_day` | `p_trip_day_id uuid, p_new_ordinal integer, p_reason text DEFAULT NULL` | **not required** (audit-only) | atomic renumber within `event_id` respecting UNIQUE (§4.1a); `updated_at=now()` | `trip_day.reorder` | `admin_write_audit(…, p_require_reason=>false)`. |
| `admin_update_experience_stop` | `p_stop_id uuid, p_patch jsonb, p_reason text` | required | whitelist `{ai_description,place_name,address,start_time}`; `ai_description` must stay non-empty (`RAISE 'ai_description_empty'`); `updated_at=now()` | `experience_stop.update` | covers "correct AI text" + "moderate". |
| `admin_delete_experience_stop` | `p_stop_id uuid, p_reason text` | required | capture before; `DELETE FROM experience_stops WHERE id=p_stop_id`; audit with `{before}` | `experience_stop.remove` | no `deleted_at` → hard delete. |
| `admin_reorder_experience_stop` | `p_stop_id uuid, p_new_order integer, p_reason text DEFAULT NULL` | not required | atomic renumber within `event_id` respecting UNIQUE (§4.1a); `updated_at=now()` | `experience_stop.reorder` | audit `p_require_reason=>false`. |
| `admin_set_rsvp_approval` | `p_rsvp_id uuid, p_approval_status text, p_reason text` | required IFF `p_approval_status='denied'`; else optional | validate ∈ `(pending,approved,denied)`; `UPDATE event_rsvps SET approval_status=…` | `rsvp.approve` / `rsvp.deny` | AFTER-trigger auto-drains waitlist on deny (documented). Action label in metadata reflects target. |
| `admin_remove_rsvp_guest` | `p_rsvp_id uuid, p_reason text` | required | capture before (incl. child `event_rsvp_guests`); `DELETE FROM event_rsvps WHERE id=p_rsvp_id` (cascade) | `rsvp.remove` | true removal (spam/abuse); distinct from soft deny. |
| `admin_set_rsvp_capacity` | `p_event_id uuid, p_rsvp_capacity integer, p_waitlist_enabled boolean, p_reason text` | required | `RAISE 'invalid_capacity'` if `p_rsvp_capacity < 0`; `UPDATE events SET rsvp_capacity=p_rsvp_capacity, rsvp_waitlist_enabled=p_waitlist_enabled` (NULL capacity = uncapped) | `rsvp.set_capacity` | raising capacity fires `trg_rsvp_drain_on_cap_raise` auto-promote (documented). |
| `admin_update_venue_reservation_settings` | `p_venue_id uuid, p_patch jsonb, p_reason text` | required | whitelist `{reservations_enabled,fee_amount_cents,fee_currency,cancel_cutoff_hours,no_show_fee_policy}`; before/after by `WHERE venue_id=p_venue_id` (PK) | `venue_reservation_settings.update` | covers the enabled toggle. `RAISE 'not_found'` if no settings row. |
| `admin_update_venue_capacity_rule` | `p_rule_id uuid, p_patch jsonb, p_reason text` | required | whitelist `{params,is_active,zone}` (validate `zone` enum when present); `WHERE id=p_rule_id` | `venue_capacity_rule.update` | `kind` immutable in 1277. |
| `admin_set_reservation_status` | `p_reservation_id uuid, p_status text, p_reason text` | required | validate ∈ 8-value enum; `UPDATE reservations SET status=p_status` | `reservation.set_status` | notify-trigger fires (modal warns). |

**Rowcount verification (`I-i-MUTATION-ROWCOUNT-VERIFIED` [existing gate]):** every RPC captures `v_after` via `RETURNING to_jsonb(t) INTO v_after`; `IF v_before IS NULL THEN RAISE 'not_found'` guarantees exactly one target row existed; the audit's `{before,after}` is the receipt. For the two hard-DELETE RPCs (#9,#12), capture `v_before` first; `IF v_before IS NULL RAISE 'not_found'` before DELETE; audit `{before}`.

**Reorder atomic-renumber hazard (#7,#10) — MANDATORY.** UNIQUE `(event_id, ordinal)` and `(event_id, stop_order)` are NOT deferrable [verified]. A naive `UPDATE … SET ordinal=p_new_ordinal` collides if the slot is occupied, and a bulk shift transiently violates the per-row unique check. The RPC MUST renumber in a collision-free order: read `event_id` + `v_old`; clamp `p_new_ordinal` to `[min,max]` of the group; move the target to a sentinel outside the live range (e.g. `-1` or `max+1`), shift the block between `v_old` and `p_new` by ±1, then set the target to `p_new`. Guard the whole thing so the audit's `{before,after}` reflects the target row's ordinal change only.

### 4.2 Frontend — services + pages + one new modal

**Service writes (extend the shipped read services; each `→ {data,error}` via `callAdminWriteRpc`):**
- `offeringsService.js` (add): `setOfferingVisibility`, `cancelOffering`, `setBookingsClosed`, `setOfferingDeleted`, `setTicketPrice`, `updateTripDay`, `reorderTripDay`, `updateExperienceStop`, `deleteExperienceStop`, `reorderExperienceStop`, `setRsvpApproval`, `removeRsvpGuest`, `setRsvpCapacity`.
- `venuesService.js` (add): `updateVenueReservationSettings`, `updateVenueCapacityRule`, `setReservationStatus`.
- Each maps camelCase args → `p_*` params and calls `callAdminWriteRpc('<rpc>', {…})`. NO raw `.update()/.insert()/.delete()/.upsert()` — writes ONLY through RPCs (enforced by §6 gate).

**New component — `mingla-admin/src/components/entity/AdminEditModal.jsx` (1277-owned):** a value-collecting sibling of `HighRiskActionModal` (does NOT modify the 1271 modal). Contract:
- Props: `open,onClose,title,description,confirmLabel,destructive?,requireReason=true,reasonLabel?,confirmPhrase?,fields:[{key,label,type:'text'|'textarea'|'number'|'currency'|'select'|'toggle',options?,currencyCode?,initial,required?}],onConfirm:async({reason,values})=>void,successMessage`.
- Same HARD contract as `HighRiskActionModal`: confirm disabled until `requireReason` reason non-empty AND all `required` field values present AND `confirmPhrase` (if set) matches; submitting→spinner→inline-error-preserves-input; reset-on-close (event-driven, not effect); `onConfirm` never called with an empty required value or empty required reason; the client checks are UX only — the server RPC is the real gate.
- Money fields send integer cents (client parses the displayed amount → cents; server takes cents). Select for visibility/status/zone; toggle for booleans.

**`OfferingDetailView.jsx` (extend):**
- **Offering-level actions → `EntityDetailView.actions` footer** (valueless): Cancel (destructive, `confirmPhrase='CANCEL'`), Close/Reopen bookings (label reflects current `bookings_closed`), Soft-delete/Restore (delete destructive `confirmPhrase='DELETE'`). Visibility (value) opens `AdminEditModal` from a footer button too. Each `onConfirm` calls the service, then `load()` (the existing re-fetch) so the header badges + fields refresh.
- **Per-row actions → rendered INSIDE the existing section `render` closures** (no `EntityDetailView` change): ticket-tier rows get a "Fix price" affordance (→AdminEditModal); trip itinerary day rows get "Edit"/"Reorder"; experience stop rows get "Edit"/"Reorder"/"Remove"; RSVP guest rows get "Approve" (one-tap audit-only)/"Deny"/"Remove". The page holds one `activeAction` state `{kind,targetId,initialValues}` and renders ONE shared modal instance (HighRiskActionModal or AdminEditModal by action) outside the section list.
- RSVP counts section gets an "Adjust capacity" action (→AdminEditModal number+toggle).
- Reason length: HIGH content actions may keep the default non-empty reason (admin_audit_log has no length CHECK). (Edit-log mirroring's 10–200 constraint is deferred — Q3.)

**`VenueDetailView.jsx` (extend):**
- Reservation-settings section → "Edit reservation settings" (→AdminEditModal multi-field, incl. the enabled toggle).
- Capacity-rule rows → "Edit rule" (→AdminEditModal).
- Reservation rows (from `admin_list_venue_reservations`) → "Override status" (→AdminEditModal status select). Modal copy warns the guest is notified.

**States (all modals):** loading (submitting spinner, inputs disabled), error (inline, input preserved, stays open), success (toast + close + parent re-fetch). Disabled confirm until gates pass. a11y: labels on every input, ≥44px targets (inherit shipped modal/button primitives).

### 4.3 No new READ work

1277 reads are already shipped (1273). After every write, the detail page re-invokes its existing `load()` to reflect new state. No new read RPC, no new read RLS.

---

## 5. Trigger side-effects (documented, NOT extended)

| Admin action | DB trigger that also fires | Effect (expected) |
|---|---|---|
| Deny a going/approved RSVP guest (#11) | `trg_rsvp_drain_on_status` AFTER UPDATE | frees capacity → auto-promotes the next waitlisted guest. |
| Raise `rsvp_capacity` (#13) | `trg_rsvp_drain_on_cap_raise` AFTER UPDATE | auto-promotes waitlisted guests up to new capacity. |
| Override a reservation status (#16) | `orch_1161_reservation_notify_trg` AFTER UPDATE | queues a guest notification (outbox). Modal copy MUST warn. |

These are the same organiser-path behaviors; 1277 relies on them rather than re-implementing. The tester verifies them (§7) but 1277 adds NO new notification code.

---

## 6. Invariants + strict-grep gate evolution

### New DRAFT invariants (orchestrator flips ACTIVE on CLOSE)

| ID | Rule | Enforcement | Fails-on-revert |
|---|---|---|---|
| `I-PROPOSED-1277-OFFERINGS-WRITE-VIA-AUDITED-RPC` | Every offerings/venues admin mutation goes through an `is_admin_user()`-gated `SECURITY DEFINER` RPC that (a) audits via `admin_write_audit`, (b) is `REVOKE`d from anon/PUBLIC + `GRANT`ed only to authenticated, (c) is the ONLY write path — the console service/page files contain ZERO raw `.update/.insert/.delete/.upsert` and call ONLY whitelisted read+write RPCs. | `i-offerings-writes-audited.mjs` (new) + append the 16 RPCs to `i-admin-write-audited.mjs` + `i-admin-gate-first-statement.mjs` + revise `i-offerings-read-only.mjs` (c). | Revert the write migration → RPCs absent → gate FAIL. Add a raw `.update()` in a console file → FAIL. |
| `I-PROPOSED-1277-HIGH-RISK-REASON-REQUIRED` | Every HIGH-risk write RPC RAISEs `reason_required` on an empty/whitespace reason (server gate, independent of the modal); audit-only RPCs pass `p_require_reason=false`. | node:test asserting a reason-less HIGH RPC call RAISEs, and an audit-only RPC does not; `i-offerings-writes-audited.mjs` asserts each HIGH RPC body contains the reason gate. | Remove the reason gate from any HIGH RPC → test + gate FAIL. |

### Gate changes (append-only registries + one evolved gate)

1. **`i-admin-gate-first-statement.mjs`** — APPEND the 16 write-RPC names to `GUARDED_DEFINER_FNS` + the self-test fixture list (mirrors how 1273's 6 reads were appended). Guard-first still enforced.
2. **`i-admin-write-audited.mjs`** — APPEND the 16 names to `ADMIN_WRITE_RPCS` (append-only). Each must have a body referencing `admin_write_audit(` (all do). This is the audited-write registry the READ RPCs were deliberately kept OUT of.
3. **`i-offerings-read-only.mjs`** — the read-table (a) + read-RPC (b) halves STAY (those tables/RPCs remain read-only forever). Part (c) EVOLVES: the console service/page files may now call the 16 write RPCs → add them to `ALLOWED_RPCS`; **KEEP** the raw `.update/.insert/.delete/.upsert` ban (admin writes must never be raw table writes) and **KEEP** the "no direct `admin_write_audit` reference in client files" ban (audit is server-side only). Update the self-test: the shipped BAD5 ("a service calls `admin_cancel_offering` → FAIL") becomes a GOOD case (whitelisted write RPC allowed); ADD a new BAD case (an UN-whitelisted `rpc("admin_something")` OR a raw `.update()` in a console file → FAIL). Its `I-PROPOSED-1273-OFFERINGS-READ-ONLY` invariant is **superseded for the service/page layer** by `I-PROPOSED-1277-OFFERINGS-WRITE-VIA-AUDITED-RPC` (note the supersession in `INVARIANT_REGISTRY.md`; the read-table/read-RPC halves remain ACTIVE).
4. **`i-offerings-writes-audited.mjs`** (NEW) — for each of the 16 write RPCs: assert (i) defined in migrations, (ii) body performs a mutation (`UPDATE public.`/`DELETE FROM`) AND references `admin_write_audit(`, (iii) the migration contains a `REVOKE EXECUTE … FROM anon` for it, (iv) each HIGH RPC contains a `reason_required` gate. `--self-test` proves fail-on-revert with GOOD/BAD fixtures.
5. **`strict-grep-mingla-business.yml`** — append one job step running `i-offerings-writes-audited.mjs --self-test` + live, and the revised read-only + the two registries' self-tests.

---

## 7. Success criteria (testable; per-surface = single Admin-Web surface; `HP` = implementor self-verify, `ADV` = tester live-fire)

Concrete PROD targets [verified 2026-07-03]: live event `699afd22` (Summer Rooftop Festival, brand `655ba0ef`); scheduled event `de1211d0` (FIFA Grill Night) with tiers `3e2b71b3` ($10 General), `b03f914a` ($20), `8de19a6a` ($35); draft event `e5d6c2e6`; draft trip `84f481d0`; draft rsvp `c38359da`; scheduled public rsvp `8b84539d` (July 4th BBQ Pool Party) with 1 going+approved guest. PROD has 0 `trip_days`, 0 `experience_stops`, 0 `reservations` → those actions are proven on a Supabase **dev branch/clone** (NEVER a PROD write; COMMS-0061).

**AC-1 — Guard + audit (every RPC)**
- AC-1.1 [ADV] Each of the 16 RPCs called by a NON-admin authed session RAISEs `not_authorized` (guard is the first statement); anon → no EXECUTE (403). Proven by `has_function_privilege('anon', …)=false` + a live call.
- AC-1.2 [ADV] Each HIGH RPC called with an empty/whitespace reason RAISEs `reason_required` and writes NO `admin_audit_log` row and does NOT mutate (before=after). Audit-only RPCs (#7,#10, approve-path of #11) accept a NULL reason and still write an audit row.
- AC-1.3 [ADV] A successful HIGH mutation writes exactly ONE `admin_audit_log` row with `action='<entity>.<verb>'`, server-bound `admin_email`/`actor_uid` (NOT forgeable), and `metadata.before`/`metadata.after` reflecting the change. `p_actor_*` passed by a JWT caller is IGNORED.

**AC-2 — Offering state-changes (live-provable on PROD)**
- AC-2.1 [HP] `admin_set_offering_visibility('699afd22…','hidden',reason)` flips visibility public→hidden; `admin_list_offerings(p_visibility=>'hidden')` now includes it; re-run with `'public'` restores (rowcount-verified before/after).
- AC-2.2 [ADV] `admin_cancel_offering` sets `status='cancelled'`; second call RAISEs `already_cancelled`; NO refund row created (money untouched).
- AC-2.3 [HP] `admin_set_offering_bookings_closed(id,true,reason)` sets `bookings_closed=true` + `bookings_closed_at=now()`; `false` clears both.
- AC-2.4 [ADV] `admin_set_offering_deleted(id,true,reason)` sets `deleted_at`; the row vanishes from the organiser-facing RLS read but STILL appears in `admin_list_offerings(p_include_deleted=>true)`; restore clears it. (Use a disposable dev-branch row to avoid touching a real PROD offering — Q4.)

**AC-3 — Ticket / trip / experience**
- AC-3.1 [HP] `admin_set_ticket_price('3e2b71b3…',1500,reason)` sets `price_cents=1500`, currency unchanged; `<0` RAISEs `invalid_price`.
- AC-3.2 [ADV, dev-branch] `admin_update_trip_day` edits title/narrative/date (unknown keys ignored; empty patch RAISEs `no_editable_fields`); `admin_reorder_trip_day` moves a day across an occupied ordinal WITHOUT a unique-violation and leaves a gap-free `(event_id,ordinal)` set.
- AC-3.3 [ADV, dev-branch] `admin_update_experience_stop` corrects `ai_description` (empty → RAISEs `ai_description_empty`); `admin_delete_experience_stop` removes the row + audits `{before}`; `admin_reorder_experience_stop` reorders without unique-violation.

**AC-4 — RSVP (live-provable on `8b84539d`)**
- AC-4.1 [ADV] `admin_set_rsvp_approval(guest,'denied',reason)` sets `approval_status='denied'`; deny with empty reason RAISEs `reason_required`; approve (`'approved'`) succeeds with NULL reason (audit-only) and still audits.
- AC-4.2 [ADV] Denying a going+approved guest on a capacity-full RSVP fires `trg_rsvp_drain_on_status` → a waitlisted guest auto-promotes (verify a promoted row's `promoted_at` set). Documented side-effect, not a bug.
- AC-4.3 [ADV] `admin_set_rsvp_capacity(event, N, true, reason)` sets capacity+waitlist; raising it auto-drains waitlist; `admin_remove_rsvp_guest` hard-deletes the `event_rsvps` row + cascades `event_rsvp_guests`, audit carries `{before}`.

**AC-5 — Venue (dev-branch; PROD has the 1 venue but 0 reservations)**
- AC-5.1 [ADV] `admin_update_venue_reservation_settings(venue,{reservations_enabled:false},reason)` toggles off (by `venue_id` PK); RAISEs `not_found` when no settings row.
- AC-5.2 [ADV] `admin_update_venue_capacity_rule` edits params/is_active/zone (invalid zone RAISEs); `kind` cannot be changed.
- AC-5.3 [ADV, dev-branch seed a reservation] `admin_set_reservation_status(res,'cancelled_by_venue',reason)` sets status; invalid status RAISEs; the notify trigger queues a guest notification (verify the outbox row).

**AC-6 — UI (Admin Web)**
- AC-6.1 [HP] `mingla-admin` builds clean (`npm run build`), 0 new lint/type errors; `AdminEditModal` unit tests pass (reason+value+confirmPhrase gating; reset-on-close; inline error preserves input).
- AC-6.2 [HP] Offering detail shows the correct action set per `event_type` (event→price fix; trip→day edit/reorder; experience→stop edit/remove/reorder; rsvp→approve/deny/remove/capacity) + the 4 offering-level footer actions; a HIGH action opens the reason+confirm modal, an audit-only reorder does not require a reason; after a successful action the view re-fetches and reflects the change.
- AC-6.3 [ADV] Venue detail exposes reservation-settings edit, capacity-rule edit, and per-reservation status override; the reservation-override modal warns the guest is notified.
- **AC-6.4 [ADV — fails-on-revert]** `i-offerings-writes-audited.mjs` PASSES; `grep` proves the console service/page files contain ZERO raw `.update/.insert/.delete/.upsert` (writes only via the 16 RPCs) and reference NO `admin_write_audit` directly; the revised `i-offerings-read-only.mjs` still enforces the 14 read policies + 6 read RPCs. Reverting the write migration → both gates FAIL; adding a raw `.update()` → gate FAILS.

---

## 8. Test cases (min per SC)

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-1 happy | Fix a mispriced tier | admin JWT, `admin_set_ticket_price('3e2b71b3…',1500,'ticket mispriced at launch')` | `price_cents=1500`; 1 audit row `ticket.set_price` w/ before 1000 after 1500 | RPC+audit |
| T-2 error | Empty reason on HIGH | `admin_cancel_offering(id,'')` | RAISE `reason_required`; no mutation; no audit row | RPC |
| T-3 authz | Non-admin call | authed non-admin, any write RPC | RAISE `not_authorized` | RPC guard |
| T-4 anon | Anon EXECUTE | anon key rpc call | 403 / no EXECUTE | grant |
| T-5 edge | Reorder across occupied slot | `admin_reorder_trip_day(day,newOrd)` where slot taken | no unique-violation; gap-free ordinals | RPC renumber |
| T-6 side-effect | Deny frees capacity | deny a going+approved guest on full RSVP | waitlisted guest auto-promoted (`promoted_at` set) | trigger |
| T-7 audit-only | Approve w/o reason | `admin_set_rsvp_approval(guest,'approved',NULL)` | success + audit row; no reason_required | RPC |
| T-8 restore | Soft-delete then admin-list | `admin_set_offering_deleted(id,true,r)` then `admin_list_offerings(include_deleted=true)` | row present in admin list, absent from organiser RLS read | RPC+RLS |
| T-9 gate | Add raw `.update()` to `offeringsService.js` | edit file | `i-offerings-writes-audited.mjs` exit 1 | strict-grep |
| T-10 fails-on-revert | Revert write migration | remove `20261209000000…` | write-audited + gate-first + read-only gates all FAIL | strict-grep |
| T-11 modal | Confirm disabled until gates | AdminEditModal, empty reason / missing required value / wrong confirmPhrase | confirm button disabled; `onConfirm` never fired | component |
| T-12 notify | Reservation override | `admin_set_reservation_status(res,'cancelled_by_venue',r)` | status set; notify outbox row queued | RPC+trigger |

---

## 9. Implementation order + allowlist

1. **DB — offering/event/trip/experience/rsvp write RPCs** `20261209000000_orch_1277_offerings_edit_rpcs.sql` (RPCs #1–13) — golden template each; guard-first; reason gate (HIGH) / `p_require_reason=false` (audit-only); before-capture; mutate (explicit `updated_at=now()` for `trip_days`/`experience_stops`); `admin_write_audit`; `REVOKE anon/PUBLIC` + `GRANT authenticated`; `DO $$` `has_function_privilege` self-assert. Reorder RPCs use the sentinel renumber (§4.1a). (AC-1..AC-4)
2. **DB — venue write RPCs** `20261209000001_orch_1277_venue_edit_rpcs.sql` (RPCs #14–16). (AC-5)
3. **Service — writes.** Extend `mingla-admin/src/services/offeringsService.js` (+13 fns) + `venuesService.js` (+3 fns) — all via `callAdminWriteRpc`, `{data,error}`, NO raw table writes.
4. **UI — new modal.** `mingla-admin/src/components/entity/AdminEditModal.jsx` (value+reason+confirm; mirrors HighRiskActionModal contract).
5. **UI — offering detail.** Extend `OfferingDetailView.jsx`: footer `actions` (cancel/close-reopen/soft-delete-restore/visibility) + per-row actions inside section `render` closures + one shared modal state + `load()` re-fetch on success.
6. **UI — venue detail.** Extend `VenueDetailView.jsx`: settings edit + capacity-rule edit + reservation status override.
7. **Gates + invariants.** New `i-offerings-writes-audited.mjs` (+ `__tests__` fixture); APPEND 16 RPCs to `i-admin-write-audited.mjs` + `i-admin-gate-first-statement.mjs`; REVISE `i-offerings-read-only.mjs` (c) (+ self-test); append job step(s) to `strict-grep-mingla-business.yml`; add the 2 `I-PROPOSED-1277-*` DRAFT invariants + supersession note to `INVARIANT_REGISTRY.md`.
8. **Self-verify.** `npm run build` clean; run new + inherited strict-grep (`--self-test` + live) PASS; prove AC-1.1/1.2 + AC-6.4 locally; hand the 2 migrations to the orchestrator for DEPLOY (with the AC verification queries + the dev-branch seed for trip/experience/reservation).

**Allowlist (implementor may create/modify ONLY these):**
`supabase/migrations/20261209000000_orch_1277_offerings_edit_rpcs.sql`, `20261209000001_orch_1277_venue_edit_rpcs.sql` · `mingla-admin/src/services/offeringsService.js`, `venuesService.js` · `mingla-admin/src/components/entity/AdminEditModal.jsx` · `mingla-admin/src/pages/OfferingDetailView.jsx`, `VenueDetailView.jsx` · `.github/scripts/strict-grep/i-offerings-writes-audited.mjs` (+ `__tests__/` fixture) · `.github/scripts/strict-grep/i-offerings-read-only.mjs` (revise part (c) + self-test ONLY) · `.github/scripts/strict-grep/i-admin-write-audited.mjs` (append 16 names ONLY) · `.github/scripts/strict-grep/i-admin-gate-first-statement.mjs` (append 16 names ONLY) · `.github/workflows/strict-grep-mingla-business.yml` (append step) · `mingla-admin/src/__tests__/orch1277_offerings_console_edit.test.js` (new) · `Mingla_Artifacts/INVARIANT_REGISTRY.md`.

**DO-NOT-TOUCH (stop-and-amend first):** `is_admin_user()`, `admin_write_audit`, `admin_audit_probe` (1271 primitives — consume only) · `HighRiskActionModal.jsx`, `EntityDetailView.jsx`, `EntityListView.jsx`, `adminWriteService.js` (1271 shells — consume as-is; missing prop ⇒ stop-and-amend) · the 1273 READ migrations (`20261206000000/…000001`) + their 14 read policies + 6 read RPCs (immutable) · `OfferingsConsolePage.jsx`, `VenuesConsolePage.jsx` (list pages — no edit there) · `biz_update_live_trip`, `biz_update_live_experience`, the brand-team RLS/gates, `trip_edit_log`/`experience_edit_log` (organiser path — do NOT reuse or write unless Q3 flips) · any admin RLS on `orders`/`event_rsvps`/`event_rsvp_guests`/`reservations` (RPC-only PII posture — do NOT add a policy) · any shipping-app code (`app-mobile/`, `mingla-business/`) · `eventLifecycle.ts`/`eventDateMath.ts` (never import into admin).

---

## 10. Cross-surface impact declaration (MANDATORY)

| # | Surface | Covered? | User-visible behavior | Files | Parity |
|---|---|---|---|---|---|
| 1 | Consumer iOS (`app-mobile/`) | NO | none | none | Admin-only backend + web. |
| 2 | Consumer Android | NO | none | none | " |
| 3 | Buyer/anon Web (`mingla-business/` public routes) | NO | none | none | " |
| 4 | Business iOS | NO | none | none | " |
| 5 | Business Android | NO | none | none | " |
| 6 | **Admin Web (`mingla-admin/`)** | **YES** | Edit/moderation actions on the shipped Offerings + Venues detail views (reason+confirm modals; audit trail). | see §9 allowlist | Single surface — no parity split. |
| 7 | Business Web preview (adjacent) | NO | none | none | Untouched. |

Backend (2 migrations + 16 write RPCs) is shared infra gating surface 6. Note: an admin edit to an offering DOES change what organisers/buyers see (a cancelled/hidden/soft-deleted offering, a re-priced tier), but through the SAME data the shipping apps already read — no shipping-app CODE changes, so those surfaces are not "touched," only the shared data they read.

---

## 11. Open questions (with defaults)

- **Q1 (BLOCKING iff 1273 unmerged).** 1277 extends the 1273 pages/services + consumes the 1271 shells; all are on `origin/main` [verified]. **Default:** dispatch 1277 implementation only after the working base includes 1273 (rebase the 1277 worktree onto `origin/main`). If 1273 were reverted, 1277 blocks.
- **Q2 (non-blocking).** `trg_events_enforce_master_date` fires BEFORE UPDATE on `events`. 1277 never promotes status to non-draft, so it should never trip — but a cancel/soft-delete on a master-date-less draft could. **Default:** let the RPC surface any trigger error verbatim (do NOT swallow); the tester probes a master-date-less draft to confirm cancel/soft-delete still succeed. If the trigger blocks them, add a narrow exemption in a SPEC amendment.
- **Q3 (non-blocking — organiser edit-log mirroring).** The dispatch's §6 note says "mirror `biz_update_live_trip` + `trip_edit_log`." The edit-logs require `reason` 10–200 chars + `severity ∈ {additive,material}` + `affected_order_ids` (buyer-notify machinery). **Default:** 1277 writes the canonical `admin_audit_log` ONLY (the admin trail); it does NOT write `trip_edit_log`/`experience_edit_log` (avoids the 10–200 reason coupling forcing a stricter modal, and the buyer-notify affected_order_ids scope). If Seth wants organiser-visible provenance of admin content edits, a follow-on adds an edit-log INSERT with `severity='material'`, `edited_by=auth.uid()`, and a reason gated to 10–200. (PROD has 0 trip_days/experience_stops today, so no organiser is currently affected.)
- **Q4 (non-blocking — test-data + destructive-on-prod).** State-change/price/RSVP paths are live-provable on the named PROD rows, but proving cancel/soft-delete on a REAL PROD offering would alter live data. **Default:** prove non-destructive paths (visibility flip+restore, price fix+restore, approve/deny+restore) on PROD with immediate reversal; prove cancel/soft-delete/reservation-override/trip/experience/reservation paths on a Supabase **dev branch/clone** with seeded rows (NEVER a PROD write; COMMS-0061). The orchestrator seeds the dev branch at DEPLOY/TEST.
- **Q5 (non-blocking — reservation status transition rules).** The `reservations.status` CHECK allows all 8 values but enforces NO transition graph (e.g. `completed → requested` is technically allowed). **Default:** the admin override permits ANY enum value (admin support needs the escape hatch); the modal groups them sensibly (seat/complete/no-show/cancel) but does not hard-block a transition. Flag if Seth wants a guarded transition graph.
- **Q6 (non-blocking — venue-listing field edit).** The numbered scope covers reservation settings/capacity + reservation status, NOT venue name/category/contact/hours (which §6 of the 1273 SPEC lists as `admin_update_venue`, and whose writes are RPC/service-role-only [report]). **Default:** DEFER venue-listing field edit to a follow-on ORCH; 1277 ships the reservation-stack edits only.
- **Q7 (non-blocking — reorder UX).** Reorder is specced as an `AdminEditModal` number input (target position). **Default:** ship the number-input form (works with the shared modal, minimal UI). If Seth prefers inline drag/up-down arrows, that is a later polish (needs a section-row refactor of the detail view).

---

## 12. Downstream routing

Next = **mingla-implementor** (build §9 in the per-ORCH worktree, rebased onto `origin/main`; gated on 1273 in-base per Q1). Then **mingla-tester** (the §7 AC matrix — especially ADV rows AC-1.1/1.2 guard+reason gates, AC-1.3 non-forgeable audit, AC-2.4 soft-delete-still-admin-visible, AC-4.2 waitlist-drain side-effect, AC-6.4 no-raw-write + fails-on-revert; seed trip_day/experience_stop/reservation rows on a dev branch per Q4). Then **orchestrator CLOSE** (flip the 2 `I-PROPOSED-1277-*` invariants DRAFT→ACTIVE + note the read-only-invariant supersession, DEPLOY the 2 migrations via `supabase db push --linked`, merge one PR, update WORLD_MAP). 1277 is the Wave-2 EDIT child of META-ORCH-1237; the money-edit actions (refunds/disputes) remain ORCH-1274's domain.

*Working tree: to be spawned by the orchestrator at `~/Desktop/mingla-orchs/1277-[offerings-console-edit]/` on branch `1277-offerings-console-edit`. This SPEC written to the anchor `Mingla_Artifacts/reports/` per the dispatch's explicit output path (sibling 1273 SPEC + all META-1237 artifacts live there); the implementor's scoped work lands in the worktree.*
