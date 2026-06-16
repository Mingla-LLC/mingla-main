# SPEC — META-ORCH-1148 sub-ORCH 2.0 — Venue Suite FOUNDATION (toggle + shell + Settings + 7-table data model)

- **Sub-ORCH:** META-ORCH-1148 / **2.0** (the foundation ship). Phase 1 = ORCH-1145 (venue listing → Hub tab, MERGED `c8f7fbc3b` / PR #492, on origin/main).
- **Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1148-[venue-suite-foundation]/` on branch `ORCH-1148-venue-suite-foundation` (rebased onto current origin/main; ORCH-1145 venue tab present).
- **Mode:** SPEC (binding contract). No product code. No migrations applied. Illustrative SQL/TS snippets ≤ a few lines only.
- **Binding inputs (read, cited inline):** `VISION_META-ORCH-1148_VENUE_MANAGEMENT_SUITE.md` (DECISIONS LOCKED r1+r2 — non-negotiable) · `PRD_META-ORCH-1148_FIRSTSHIP_BOOKING_LOOP.md` (§3 data model, §7 sub-ORCH split, §9 open forks) · `DESIGN_IA_META-ORCH-1148_VENUE_SUITE.md` (shell, module nav, toggle UX, responsive reflow) · `SPEC_ORCH-1145_VENUE_LISTING_TO_HUB_TAB.md` (the base) · live source read this session (citations inline).
- **COMMS ledger:** read on entry (`/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md`). The only OPEN/WARN rows are trip-migration coordination (COMMS-0029, `biz_update_live_trip`) and the ORCH-1133 ID-collision (COMMS-0033) — neither touches venue/1148 files, schema, or this skill. No BLOCK to ALL/1148. Nothing to ack. This SPEC adds ONLY net-new venue_* tables + a new `reservations` table + new venue components; ZERO overlap with any in-flight ORCH's files or functions.

---

## 1. Executive summary

Sub-ORCH 2.0 is the **foundation** of the Venue Management Suite. It is shippable and valuable on its own, with **no dead taps**, and it lays the full data model so 2.1/2.2 build only logic + UI on top. It delivers four things:

1. **The single "Reservations" capability toggle** (LOCKED DECISION 4) — one per-venue switch, persisted on the new `venue_reservation_settings` table, that unlocks the suite. The existing ORCH-1145 listing (status / AI scores / gallery / feedback) is **preserved verbatim** and re-housed as the suite's **Overview module body** (always on, even with the toggle OFF).
2. **The suite SHELL** inside the Hub Venue tab — the module-nav architecture from the Design IA: two-column list-detail on web desktop (`isWideDesktop`), segmented-scroller single column on web-phone, and on the native app the venue module pills **REPLACE** the Hub Events/Experiences/Trips pill row while inside Venue (LOCKED DECISION 5). Build the shell + `activeModule` nav state machine; only **Overview** and **Settings** are wired with real content in 2.0.
3. **Settings module** (MVP subset) — venue profile (reuse), hours summary (read-only seed from `place_pool.opening_hours`, editor deferred to 2.1 Availability), reservation rules, the **optional reservation-fee config** (free by default; rides the existing all-in Stripe/Paystack engine — NO new tax/billing form), cancellation/no-show policy fields, and a **team-roles scaffold** (display only, role enum + current members; mutation deferred). The canonical Reservations toggle lives here; the Overview invitation card is the discovery surface.
4. **The NET-NEW DATA MODEL — all 7 tables** (`venue_tables`, `venue_capacity_rules`, `venue_availability_config`, `venue_blackouts`, `venue_reservation_settings`, `reservations`, `venue_waitlist`) with full schema + RLS, applied via the safe-migration protocol (Management API; CLI drift-wedged; MCP read-only). 2.0 writes ONLY `venue_reservation_settings` (the toggle + fee/policy from Settings); the other 6 tables are schema-only seams for 2.1/2.2.

**Out (named, not built):** all booking COMPUTE (availability/turn-time RPC) + operator Tables/Availability/Reservations/Waitlist management UIs (2.1); the consumer reserve surface + Stripe fee charge + no-show auto-forfeit (2.2); Menu CMS, Demand, Campaigns wiring, Guests, Feedback (later). **Dead-tap policy resolved in §6.**

**Affected surfaces (2.0):** business iOS + business Android + business web desktop + business web phone + Supabase (7 migrations + RLS). **NOT** consumer app, **NOT** buyer-web, **NOT** admin. (No consumer-visible change in 2.0 → the all-surface-parity rule is N/A this ship; it binds 2.2.)

---

## 2. Cross-Surface Impact Declaration

| # | Surface | Covered? | User-visible behavior in 2.0 | Files touched | Parity |
|---|---------|----------|------------------------------|---------------|--------|
| 1 | Consumer iOS/Android (`app-mobile/`) | NO | none | none | N/A — different app; reserve surface is 2.2 |
| 2 | Buyer / anonymous web | NO | none — `/b/{slug}` venue page unchanged | none | N/A — 2.2 adds the public Reserve button |
| 3 | Business iOS | YES | Venue tab becomes the suite shell; Overview = the old listing; a "Turn on Reservations" toggle; Settings module; with toggle ON the booking modules show honest "set up next" states (no dead tap) | all §5 files | shared RN |
| 4 | Business Android | YES | identical; every new glass surface uses the opaque fallback | same | shared RN (automatic) |
| 5 | Business web desktop (`isWideDesktop`) | YES | two-column master-rail + workspace inside the Hub content frame | same (`.web` deltas via `useResponsiveLayout`, no separate `.web.tsx` expected) | shared RN-web |
| 6 | Business web phone (web `<1024`) | YES | single column; module nav = segmented scroller | same | shared RN-web |
| 7 | Admin web (`mingla-admin/`) | NO | none | none | N/A |
| 8 | Supabase (DB) | YES | 7 new tables + RLS; `venue_reservation_settings` read/written by the suite | §4 migrations | server |

---

## 3. Architecture decisions taken in this SPEC (resolving PRD §9 / Design Q's for the 2.0 surface)

These are the forks 2.0 must settle to lay correct schema. Each is the PRD/Design recommendation unless noted; flagged in §12 if Seth must confirm.

- **D1 — Bookable-slot model (PRD Q1/Q4):** `reservations` is a **separate primitive**; the optional fee rides `ticket-checkout-create` via a small additive `reservation` mode in 2.2 (NOT a synthetic `event_dates` row). Schema impact NOW: keep a **nullable `event_date_id uuid`** column on `reservations` as a forward seam (cheap, lets 2.2 pivot if Seth reverses) but do NOT FK-enforce a slot model. This matches PRD recommendation. **No `event_dates` coupling in 2.0.**
- **D2 — Reservation status enum (PRD §3.6):** ship the **full lifecycle enum** now as a CHECK constraint so 2.1 builds only transitions: `requested`, `confirmed`, `seated`, `completed`, `no_show`, `cancelled_by_guest`, `cancelled_by_venue`, `waitlisted`. `requested`/approval flow is operator-only later (PRD Q2) — the enum is laid now regardless.
- **D3 — No-show fee (PRD Q3):** `no_show_fee_policy` column shipped as `forfeit | none` default `forfeit` per VISION r2-7, but enforcement/auto-capture is **2.2**. 2.0 stores the policy only.
- **D4 — Notifications (PRD Q5):** push-only path is a 2.1 concern; SMS (VISION r2-7, Twilio verified) is a 2.1/2.2 build. 2.0 adds **no notification code** — but `venue_waitlist` carries `notify_via text` + `notified_at` columns as seams.
- **D5 — Smart Capacity Rules (PRD §6 / Design Q4):** ship the `venue_capacity_rules` **table schema** (kind/params/scope) now; the rule CATALOG + evaluation engine is 2.1. 2.0 writes nothing to it.
- **D6 — Venue category gating (PRD Q8):** the Reservations toggle + suite show for **any** brand whose Venue pill is visible (`hasPhysicalLocation || placePoolId`), NOT only `venueCategory='restaurant'`. "Table" copy is generic enough; matches the existing pill gate so no new gating logic. **Confirm at §12.**
- **D7 — Toggle canonical home (Design Q7):** the switch lives in **Settings → Reservations** (canonical write site) AND surfaces as the **Overview invitation card** (discovery). Both write `venue_reservation_settings.reservations_enabled`. Matches Design.
- **D8 — Mobile nested-nav (LOCKED DECISION 5, Design Q2):** entering Venue **REPLACES** the Hub pill row with the venue module pill row on native + web-phone. This is locked, not optional. §5.3 specifies the mechanism. (Design's "second lighter pill row" alternative is SUPERSEDED by the locked decision.)
- **D9 — "Fill open tables" hero CTA (VISION r2-6 vs Design Q5):** VISION r2-6 says FUNCTIONAL in ship 1 — but that is the **full loop's** Overview, and Campaigns wiring is the 2.4 pillar. In **2.0** the Overview is the preserved listing only; the bento KPI dashboard + the "Fill open tables" CTA are **2.1+ content** (they need reservation data that does not exist until 2.1). 2.0 does NOT render a "Fill open tables" button at all → **no dead tap by omission.** (The Design's bento dashboard is later-ship; 2.0 Overview = the ORCH-1145 listing body, unchanged.) **Flag to Seth (§12): confirm the hero CTA is correctly sequenced into 2.1, not 2.0.**

---

## 4. NET-NEW DATA MODEL — exact migrations (DDL contract)

### 4.0 Migration protocol (binding — per `feedback_edge_deploy_and_migration_apply_hazards`)

- **Version prefix:** latest across origin/main AND all active worktrees is `20261002000000` (verified this session: ORCH-1138/1147/1148/1149/1146 worktrees all share it). Use base **`20261003000000`** and increment by `000001` per file. Re-scan `git fetch origin && ls supabase/migrations/` immediately before apply; bump if anything landed.
- **Additive-only.** No drops/renames of existing objects. `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `CREATE POLICY` guarded by a `DROP POLICY IF EXISTS` immediately above (policies are not `IF NOT EXISTS`-able).
- **`$function$;` close before any GRANT.** `DROP FUNCTION` before widening a `RETURNS TABLE` (N/A here — no functions in 2.0; the availability RPC is 2.1).
- **Apply via the Supabase Management API** (browser UA; token in `~/.claude.json`) — NOT the drift-wedged CLI, NOT MCP (read-only). Apply from a clean checkout of MERGED main + this branch.
- **CHECK constraints** added inline at `CREATE TABLE` (fresh tables, no `NOT VALID`/`VALIDATE` dance needed since the tables start empty).
- **RLS:** `ALTER TABLE … ENABLE ROW LEVEL SECURITY` on every new table. No table ships RLS-off.

### 4.1 RLS pattern (binding — mirror the proven helpers)

Confirmed live (`baseline_squash_orch_0729.sql`):
- **Read gate:** `public.biz_is_brand_member_for_read_for_caller(brand_id uuid) → boolean` (`:3170`) — any brand team member.
- **Operator write gate:** the events pattern `public.biz_brand_effective_rank_for_caller(brand_id) >= public.biz_role_rank('event_manager')` (`:14246/:14258`) — manager-plus. **Use this same rank gate** for operator writes on all venue tables (a Host/Server can READ but not mutate inventory/settings; manager-plus mutates — matches the VISION §11 role hierarchy).
- **Consumer writes (2.2 only):** via a **service-role RPC** (mirrors `waitlist_entries`); 2.0 grants NO direct consumer INSERT on any table. The `consumer_user_id` columns are seams.
- `GRANT SELECT, INSERT, UPDATE, DELETE … TO authenticated` (RLS enforces the actual gate); `GRANT … TO service_role` for the 2.2 consumer-write path.

Each table below uses, verbatim shape:
```
ALTER TABLE public.<t> ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "<t> brand member can read" ON public.<t>;
CREATE POLICY "<t> brand member can read" ON public.<t>
  FOR SELECT TO authenticated
  USING (public.biz_is_brand_member_for_read_for_caller(brand_id));
DROP POLICY IF EXISTS "<t> manager plus can write" ON public.<t>;
CREATE POLICY "<t> manager plus can write" ON public.<t>
  FOR ALL TO authenticated
  USING (public.biz_brand_effective_rank_for_caller(brand_id) >= public.biz_role_rank('event_manager'))
  WITH CHECK (public.biz_brand_effective_rank_for_caller(brand_id) >= public.biz_role_rank('event_manager'));
```
Common columns on EVERY table (unless noted): `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`, `brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE`, `place_pool_id uuid NULL REFERENCES public.place_pool(id) ON DELETE SET NULL`, `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz NOT NULL DEFAULT now()`. Each table gets a `BEFORE UPDATE` `set_updated_at` trigger using a **shared per-table trigger fn** (`tg_<t>_set_updated_at`, mirroring the `tg_*_set_updated_at` convention at `baseline:6421`). Index: `CREATE INDEX … ON public.<t>(brand_id)` on every table.

> **One migration file per table** (7 files), each self-contained (table + indexes + RLS enable + 2 policies + trigger). Plus one **invariant-probe** file (§4.10). Total = **8 migration files**.

### 4.2 `20261003000000_orch_1148_venue_tables.sql` — `venue_tables` (inventory)

| column | type | constraint |
|--------|------|-----------|
| id, brand_id, place_pool_id, created_at, updated_at | (common) | |
| name | text NOT NULL | `CHECK (length(btrim(name)) > 0)` |
| capacity | int NOT NULL | `CHECK (capacity > 0 AND capacity <= 100)` |
| min_party | int NULL | `CHECK (min_party IS NULL OR min_party >= 1)` |
| max_party | int NULL | `CHECK (max_party IS NULL OR max_party >= 1)` |
| zone | text NULL | `CHECK (zone IS NULL OR zone IN ('indoor','outdoor','private_room','bar','patio'))` |
| seating_type | text NULL | `CHECK (seating_type IS NULL OR seating_type IN ('high_top','booth','lounge','standard'))` |
| combinable | boolean NOT NULL DEFAULT false | |
| accessible | boolean NOT NULL DEFAULT false | |
| is_active | boolean NOT NULL DEFAULT true | |
| reservation_policy | text NOT NULL DEFAULT 'reservable' | `CHECK (reservation_policy IN ('reservable','walk_in_only','approval_required'))` |
| sort_order | int NOT NULL DEFAULT 0 | display order |
| notes | text NULL | |

Indexes: `(brand_id)`, partial `(brand_id) WHERE is_active` for the availability engine (2.1).

### 4.3 `20261003000001_orch_1148_venue_capacity_rules.sql` — `venue_capacity_rules` (Smart Capacity Rules)

| column | type | constraint |
|--------|------|-----------|
| id, brand_id, place_pool_id, created_at, updated_at | (common) | |
| kind | text NOT NULL | `CHECK (kind IN ('party_fit','deposit_threshold','blackout_scope','approval_required','walk_in_only','weekend_only'))` — full catalog laid; 2.1 evaluates the first 3 (PRD §6) |
| params | jsonb NOT NULL DEFAULT '{}'::jsonb | e.g. `{"min_party_for_fee":8}` |
| table_id | uuid NULL REFERENCES public.venue_tables(id) ON DELETE CASCADE | scope: a table |
| zone | text NULL | scope: a zone (same enum as `venue_tables.zone`) |
| is_active | boolean NOT NULL DEFAULT true | |

Index: `(brand_id) WHERE is_active`. (No row written in 2.0; engine = 2.1.)

### 4.4 `20261003000002_orch_1148_venue_availability_config.sql` — `venue_availability_config`

One row per brand (UNIQUE). Seeds from `place_pool.opening_hours` later; reservation-specific config is editable in 2.1.

| column | type | constraint |
|--------|------|-----------|
| id, brand_id, place_pool_id, created_at, updated_at | (common) | `UNIQUE (brand_id)` |
| service_periods | jsonb NOT NULL DEFAULT '[]'::jsonb | `[{name,days:[0..6],start:'HH:MM',end:'HH:MM',type}]` |
| turn_times | jsonb NOT NULL DEFAULT '{}'::jsonb | `{"p2":75,"p4":90,"p6":120}` minutes by party bucket |
| buffer_minutes | int NOT NULL DEFAULT 0 | `CHECK (buffer_minutes >= 0 AND buffer_minutes <= 240)` |
| max_reservations_per_slot | int NULL | `CHECK (max_reservations_per_slot IS NULL OR max_reservations_per_slot > 0)` |
| slot_granularity_minutes | int NOT NULL DEFAULT 15 | `CHECK (slot_granularity_minutes IN (5,10,15,20,30,60))` |
| advance_window_days | int NOT NULL DEFAULT 30 | `CHECK (advance_window_days BETWEEN 0 AND 365)` |
| min_notice_minutes | int NOT NULL DEFAULT 0 | `CHECK (min_notice_minutes >= 0)` |

### 4.5 `20261003000003_orch_1148_venue_blackouts.sql` — `venue_blackouts`

| column | type | constraint |
|--------|------|-----------|
| id, brand_id, place_pool_id, created_at, updated_at | (common) | |
| date_start | date NOT NULL | |
| date_end | date NOT NULL | `CHECK (date_end >= date_start)` |
| reason | text NULL | |
| applies_to | text NOT NULL DEFAULT 'all' | `CHECK (applies_to IN ('all','zone','table'))` |
| zone | text NULL | when applies_to='zone' |
| table_id | uuid NULL REFERENCES public.venue_tables(id) ON DELETE CASCADE | when applies_to='table' |

Index: `(brand_id, date_start, date_end)`.

### 4.6 `20261003000004_orch_1148_venue_reservation_settings.sql` — `venue_reservation_settings` ⭐ (the only table 2.0 writes)

The single source for "is this venue reservable" + the optional fee + policies. **One row per brand.** `brand_id` is the PK (not a synthetic id) so upsert-on-toggle is trivial and there is exactly one row.

| column | type | constraint |
|--------|------|-----------|
| brand_id | uuid PRIMARY KEY REFERENCES public.brands(id) ON DELETE CASCADE | |
| place_pool_id | uuid NULL REFERENCES public.place_pool(id) ON DELETE SET NULL | |
| reservations_enabled | boolean NOT NULL DEFAULT false | **the LOCKED single toggle** (VISION dec 4) |
| fee_enabled | boolean NOT NULL DEFAULT false | free by default |
| fee_amount_cents | int NULL | `CHECK (fee_amount_cents IS NULL OR fee_amount_cents >= 0)` |
| fee_currency | char(3) NULL | inherits `brands.default_currency` at write time; NULL until set |
| fee_refundable | boolean NOT NULL DEFAULT true | |
| cancel_cutoff_hours | int NOT NULL DEFAULT 24 | `CHECK (cancel_cutoff_hours >= 0 AND cancel_cutoff_hours <= 720)` |
| no_show_fee_policy | text NOT NULL DEFAULT 'forfeit' | `CHECK (no_show_fee_policy IN ('forfeit','none'))` (enforcement = 2.2, D3) |
| pass_fee_override | boolean NULL | NULL → inherit `brands.default_pass_mingla_fee`/`default_pass_service_fee` |
| pass_tax_override | boolean NULL | NULL → inherit `brands.default_pass_tax` |
| created_at, updated_at | (common) | |

Indexes: PK covers `brand_id`. Partial `(brand_id) WHERE reservations_enabled` for the 2.2 consumer-deck "reservable" derivation.

> **Paid-fee integrity (ORCH-1073/1075 lineage, PRD §8):** a **DB CHECK cannot read `brands.stripe_charges_enabled`** cross-row, so the fail-close is enforced at the **service/RPC layer** in 2.1/2.2, not as a table constraint. 2.0's Settings UI MUST gate "turn on a paid fee" on `brand.stripeChargesEnabled || brand.paystackSubaccountCode` (mirror the `stripe_account_not_ready` 409 at the toggle, §5.4). The column constraint here only validates amount ≥ 0.

### 4.7 `20261003000005_orch_1148_reservations.sql` — `reservations` (the heart; schema-only in 2.0)

| column | type | constraint |
|--------|------|-----------|
| id, brand_id, place_pool_id, created_at, updated_at | (common) | |
| table_id | uuid NULL REFERENCES public.venue_tables(id) ON DELETE SET NULL | assigned table |
| reserved_for | timestamptz NOT NULL | slot start (venue-local resolved via `place_pool.utc_offset_minutes`, confirmed `baseline:7220`) |
| party_size | int NOT NULL | `CHECK (party_size >= 1 AND party_size <= 100)` |
| status | text NOT NULL DEFAULT 'confirmed' | `CHECK (status IN ('requested','confirmed','seated','completed','no_show','cancelled_by_guest','cancelled_by_venue','waitlisted'))` — full enum (D2) |
| source | text NOT NULL DEFAULT 'phone' | `CHECK (source IN ('mingla','phone','walk_in','website','instagram'))` |
| created_via | text NOT NULL DEFAULT 'operator' | `CHECK (created_via IN ('operator','consumer'))` |
| guest_name | text NULL | |
| guest_phone_e164 | text NULL | normalized in app (reuse `normalizePhoneE164`) |
| guest_email | text NULL | |
| consumer_user_id | uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL | set when source='mingla' (2.2 seam) |
| occasion | text NULL | |
| guest_notes | text NULL | |
| tags | text[] NOT NULL DEFAULT '{}'::text[] | VIP/first_time/regular/high_risk_no_show |
| fee_cents | int NULL | `CHECK (fee_cents IS NULL OR fee_cents >= 0)` |
| fee_currency | char(3) NULL | |
| payment_intent_id | text NULL | checkout linkage (2.2) |
| payment_status | text NOT NULL DEFAULT 'none' | `CHECK (payment_status IN ('none','paid','refunded'))` |
| event_date_id | uuid NULL | **nullable forward seam, NO FK** (D1) |

Indexes: `(brand_id, reserved_for)` (operator Today/Upcoming views, 2.1), `(brand_id, status)` (view filters), partial `(consumer_user_id) WHERE consumer_user_id IS NOT NULL` (2.2 "my reservations").

> **Consumer read (2.2 seam):** 2.0 RLS = brand-member read + manager-plus write ONLY. The consumer's "see my own reservation" SELECT policy (`consumer_user_id = auth.uid()`) is added in 2.2 with the consumer write RPC — NOT in 2.0 (no consumer surface this ship).

### 4.8 `20261003000006_orch_1148_venue_waitlist.sql` — `venue_waitlist` (MVP; DISTINCT from `waitlist_entries`)

**Audit-confirmed (PRD §3.7):** `public.waitlist_entries` is event-ticket-scoped (FKs `event_id`/`ticket_type_id`, statuses `waiting/invited/converted/expired`, `qty_requested`, drain trigger on `tickets.status` — `orch_0948_waitlist_feature.sql`). A restaurant waitlist is a different shape. **Do NOT overload it.** New table, reuse only the status vocabulary + RLS shape.

| column | type | constraint |
|--------|------|-----------|
| id, brand_id, place_pool_id, created_at, updated_at | (common) | |
| guest_name | text NULL | |
| guest_phone_e164 | text NULL | |
| guest_email | text NULL | |
| party_size | int NOT NULL | `CHECK (party_size >= 1 AND party_size <= 100)` |
| preferred_zone | text NULL | same enum as `venue_tables.zone` |
| quoted_wait_minutes | int NULL | `CHECK (quoted_wait_minutes IS NULL OR quoted_wait_minutes >= 0)` |
| status | text NOT NULL DEFAULT 'waiting' | `CHECK (status IN ('waiting','notified','converted','expired','lost'))` |
| notify_via | text NOT NULL DEFAULT 'push' | `CHECK (notify_via IN ('push','sms','none'))` (D4 seam) |
| notified_at | timestamptz NULL | |
| expires_at | timestamptz NULL | |
| converted_reservation_id | uuid NULL REFERENCES public.reservations(id) ON DELETE SET NULL | |
| consumer_user_id | uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL | |

Index: `(brand_id, status, created_at)` (FIFO queue, 2.1).

### 4.9 Migration dependency order

`venue_tables` first (others FK it: `venue_capacity_rules.table_id`, `venue_blackouts.table_id`, `reservations.table_id`). Then `venue_capacity_rules`, `venue_availability_config`, `venue_blackouts`, `venue_reservation_settings`, `reservations`, `venue_waitlist` (FKs `reservations`). File ordering by version prefix enforces this. The probe (§4.10) runs LAST.

### 4.10 `20261003000007_orch_1148_invariant_probes.sql` — read-only assertion (fails-on-revert at DB layer)

A `DO $$ … RAISE EXCEPTION …` block asserting the 2.0 invariants are physically present, so a future migration that drops/weakens them trips a baseline CI/probe. Assert:
- All 7 tables exist (`to_regclass('public.venue_*')` / `'public.reservations'` not null).
- RLS is enabled on all 7 (`relrowsecurity` true in `pg_class`).
- `venue_reservation_settings.reservations_enabled` exists, type boolean, default false.
- `reservations.status` CHECK contains all 8 enum values (introspect `pg_constraint.consrc`/`pg_get_constraintdef`).
- Each table has the read policy (member-read) AND the write policy (manager-plus) in `pg_policies`.
This block is **read-only** (no writes) per the invariant-probe rule. **I-PROPOSED-1148-RESERVATIONS-RLS-BRAND-SCOPED** is its fails-on-revert anchor.

---

## 5. Toggle + Shell + Settings — component plan

### 5.0 Reuse map (no parallel design system — Design §8)

| Need | Reuse | Source |
|------|-------|--------|
| Cards | `GlassCard` (Android opaque fallback automatic) | `src/components/ui/GlassCard.tsx` |
| Sub-flows (edit fee, etc.) | `BaseBottomSheet` / `TopSheet` | existing |
| Desktop two-column gate | `useResponsiveLayout().isWideDesktop` (NO new breakpoint; `I-DESKTOP-GATE-VIA-HOOK`) | `src/hooks/useResponsiveLayout.ts` |
| Module nav pill idiom | `HubSubNav` pattern (warm-fill active / glass inactive pills, ScrollView) | `src/components/hub/HubSubNav.tsx` |
| Adoption nudge | `BusinessTodoToggle` pattern (already in `_layout.tsx`) | existing |
| Preserved listing body | `VenueListingContent` mounted as Overview | `src/components/venue/VenueListingContent.tsx` |
| Tokens | `spacing/radius/typography/text/glass/accent/canvas/semantic` | `src/constants/designSystem.ts` |
| Toggle/inputs | existing `Button`, switch, form tokens | existing |
| Lucide on web | per-icon named import via the established Proxy shim (NEVER barrel import) | per memory |

**New tokens (Design §8):** `venueRailWidth = 260`, `venueSuiteMaxWidth = 1200` — add to `designSystem.ts`. No raw hex/spacing in components.

### 5.1 The shell — `VenueSuiteShell.tsx` (NEW)

`mingla-business/src/components/venue/VenueSuiteShell.tsx`. The suite container; it OWNS the `activeModule` state machine (§5.6) and renders the responsive shell. It replaces the current direct mount of `VenueListingContent` in the Venue tab.

- Props: `{ brandId: string | null; focus?: "feedback"; initialModule?: VenueModule }`.
- Reads `venue_reservation_settings` via a new `useVenueReservationSettings(brandId)` hook (§5.5) → `reservationsEnabled`.
- Reads `useResponsiveLayout()` → picks one of three layouts (§5.2/5.3).
- Renders the module master (rail/scroller/pill row) + the active module workspace.
- **Module workspace dispatch:** `overview` → `<VenueListingContent brandId focus chromeMode="tab" />` (the preserved listing, verbatim); `settings` → `<VenueSettingsModule />` (§5.4); booking modules (`tables`/`availability`/`reservations`/`waitlist`) → `<VenueModuleComingSoon module={…} />` (§6, honest "set up next" state — NOT a dead tap). Later bands not rendered at all in 2.0.

### 5.2 Web desktop two-column (Design §2.1)

When `isWideDesktop`:
- Outer: centered, `maxWidth: venueSuiteMaxWidth (1200)`, inside the Hub content frame (the Hub `_layout.tsx` chrome stays above, unchanged).
- **Col 1 — master rail:** `width: venueRailWidth (260)`, vertical, banded section headers (A · Command / B · Booking; C/D absent in 2.0). Rows: Overview, Settings (always); Tables, Availability, Reservations, Waitlist (only when `reservationsEnabled`). Active row = `warm` 3px left-edge bar + `accent` tint fill + `text.primary`; inactive = `text.secondary` transparent, hover `glass.tint` wash + `cursor:pointer`, no layout shift. `role="tablist"`, rows `role="tab"`, focus-visible rings (keyboard nav).
- **Gutter:** `spacing.lg`. **Col 2 — workspace:** `flex:1`, renders the active module.

### 5.3 Web phone + Mobile app single column (LOCKED DECISION 5 — REPLACE the Hub pills)

This is the load-bearing locked behavior. On native AND web-phone, **while inside Venue the Hub pill row is replaced by the venue module pill row** (no stacked double-nav).

**Mechanism (the clean, low-risk path):** the Hub `_layout.tsx` already renders `HubSubNav` then `<Slot/>`. The Venue route (`hub/listing.tsx`) is the only Slot child that needs to swap the pill row. Implement via a **shell-rendered module pill row INSIDE the Venue workspace** plus a **Hub-pill suppression signal**:
- Add a tiny module-scoped store/flag (`useVenueSuiteActive`, zustand, mirrors `useHubCreatorStore`) the Venue tab sets `true` on mount / `false` on unmount.
- In `_layout.tsx`, when `useVenueSuiteActive()` is true AND `!isWideDesktop`, render the **venue module pill row** in place of `HubSubNav` (the module row reuses the `HubSubNav` pill visuals but is driven by `activeModule`, not routes — it calls `setActiveModule`, no `router.push`). When false, render `HubSubNav` as today.
- On `isWideDesktop`, `HubSubNav` stays (the offering pills remain visible above the two-column suite — the master rail is the module nav; no replacement needed on desktop, matching Design §2.1 which keeps the Hub chrome above).
- A **back affordance** to the offering pills: the module row's first element is a small "‹ Hub" chip (or the brand chip) so the operator can return to Events/Experiences/Trips. (Leaving the Venue tab via the bottom-tab or brand switcher already restores Hub pills on unmount.)

> **Nav-lock preservation (binding):** the `_layout.tsx` visible-tab redirect effect + the `if (!activePath.includes("/hub/")) return;` guard (`:167`) and its ordering before `router.replace` (`:187`) are pinned by `hub-layout-nav-lock.test.ts`. The pill-replacement is a **render swap**, NOT a route change — it must NOT touch the redirect effect, the guard, or `HUB_TAB_ROUTES`. The module pill row drives `activeModule` state, never navigation. `hub-layout-nav-lock.test.ts` MUST stay green unmodified.

- Module-internal views (later: Reservations Today/Upcoming) = a secondary segmented control atop the workspace — not the pill row. Not built in 2.0 (booking modules are coming-soon states).

### 5.4 Settings module — `VenueSettingsModule.tsx` (NEW)

`mingla-business/src/components/venue/VenueSettingsModule.tsx`. Grouped `GlassCard` sections (Design §4.6). Each section writes via `useVenueReservationSettings` mutations (§5.5). Sections in 2.0:

1. **Reservations** (canonical toggle home, D7): the `reservations_enabled` switch + a one-line explainer. Toggling ON writes `venue_reservation_settings` (upsert) and animates the booking module rows into the rail/pill row.
2. **Reservation fee** (optional, free default): "Charge a reservation fee" switch → amount input (currency = `brand.defaultCurrency`, formatted via the existing currency formatter) → `fee_refundable` switch → `cancel_cutoff_hours` input → `no_show_fee_policy` (forfeit/none) → a **one-line WYSIWYP preview** of what the guest pays all-in, computed by reusing the all-in pricing engine read path (display only; NO charge in 2.0). **NO billing-address field, NO "Calculate tax" form** (`orch-1130-no-buyer-tax-form` invariant — venue tax stays server-sourced). **Paid-fee gate (ORCH-1073/1075):** if `fee_enabled` is toggled on while `!(brand.stripeChargesEnabled || brand.paystackSubaccountCode)`, block + show the same "finish your payout setup" message as the checkout `stripe_account_not_ready` 409, with a route to payout onboarding. The pass/absorb toggles are NOT re-rendered here — they reuse the brand Pricing-defaults surface; this section only adds the venue fee amount + refund/cancel/no-show policy + optional per-venue overrides.
3. **Venue profile** (reuse): name/address/contact pulled from `brand` + `place_pool` — read-mostly in 2.0 (editing routes to the existing brand/venue edit surfaces; do not rebuild forms).
4. **Hours** (read-only summary in 2.0): render `place_pool.opening_hours` as a summary with a "Set reservation hours →" affordance that opens the Availability module's **coming-soon** state (§6) — NOT a dead tap (it explains the editor lands in the next update). The full editor is 2.1.
5. **Team roles scaffold** (display only): list current `brand_team_members` with their role label (Owner/Manager/Host/Server/Marketing/Finance/Scanner — VISION §11). Role mutation = later. A clear "more roles coming" line; no dead controls.
6. **Cancellation/no-show policy**: the `cancel_cutoff_hours` + `no_show_fee_policy` fields (also surfaced in the fee section; single source = `venue_reservation_settings`).

All sections role-gated: a Host (rank < manager) sees read-only sections (the RLS write policy enforces server-side; UI hides mutation controls, not greyed — Design §4.6).

### 5.5 Data hook — `useVenueReservationSettings.ts` (NEW)

`mingla-business/src/hooks/useVenueReservationSettings.ts`. React-Query, mirrors existing brand hooks.
- `useVenueReservationSettings(brandId)` → `{ data: VenueReservationSettings | null, isLoading }` (SELECT the one row; null when none yet = toggle OFF default).
- `useSetReservationsEnabled()` → mutation upserting `{ brand_id, reservations_enabled }` (default-creates the row on first toggle).
- `useUpdateReservationFee()` → mutation patching fee/policy columns; guarded client-side on the paid-fee integrity check (§5.4-2).
- All via the supabase client (RLS enforces manager-plus). Type `VenueReservationSettings` added to `src/types/` (camelCase mapped from snake_case columns).

### 5.6 Module nav state model

```
type VenueModule =
  | 'overview' | 'settings'                                  // Band A — always
  | 'tables' | 'availability' | 'reservations' | 'waitlist'; // Band B — gated on reservationsEnabled
```
- `activeModule` lives in `VenueSuiteShell` local state (the suite's `setCurrentPage` analog), default `'overview'`.
- **Visible modules** = `deriveVenueModules(reservationsEnabled)`: `['overview','settings']` when OFF; `['overview','tables','availability','reservations','waitlist','settings']` when ON (Settings stays last; booking modules between). Pure function, unit-tested (mirrors `deriveHubVisibleTabs`).
- Guard: if `activeModule` is a booking module and `reservationsEnabled` flips false, snap back to `'overview'`.
- C/D bands (Menu/Demand/Guests/Campaigns/Feedback) are NOT in the union in 2.0 → cannot be selected → cannot dead-tap.

### 5.7 The toggle UX flow (Design §3)

- **OFF:** rail/pill row shows only Overview + Settings. Overview body = `VenueListingContent` (preserved) + an **invitation card** at the bottom ("Take table reservations on Mingla / Free to switch on / [Turn on Reservations]" — copy verbatim from PRD §10 / Design §3.1). The card's button writes `reservations_enabled=true` via `useSetReservationsEnabled`.
- **Transition:** on toggle ON, booking module rows animate in (Design §5: spring, staggered 40ms/row), and the shell lands on **Settings → Reservations** (or Overview) — NOT on Tables (Design §3.2 lands on Tables-empty, but Tables is a coming-soon state in 2.0, so land on Settings where the operator sets the fee/rules; the 3-step starter is referenced honestly — see §6).
- **Invitation copy promises ONLY 2.0/loop capabilities** (honesty rule) — no "Demand intelligence" claim.

---

## 6. The 2.0 / 2.1 boundary — what's visible/active vs deferred (DEAD-TAP DECISION)

**Decision: booking module nav entries ARE present when the toggle is ON (so the operator sees the suite's shape), but each renders an honest "set up next" state — NEVER a dead tap, NEVER a fake UI.** Rationale: hiding Tables/Availability/Reservations/Waitlist entirely until 2.1 would make the toggle-on moment feel empty and would hide the product's shape; rendering fake/non-functional CRUD would be a dead tap. The honest interstitial is the correct middle — it teaches what's coming and (where applicable) routes to the real 2.0 action (set the fee in Settings).

| Nav entry | Toggle OFF | Toggle ON (2.0) | 2.1 |
|-----------|-----------|-----------------|-----|
| **Overview** | LIVE (preserved listing + invitation card) | LIVE (preserved listing) | + bento KPI dashboard (needs reservation data) |
| **Settings** | LIVE (toggle, profile, team scaffold) | LIVE (toggle + fee + rules + team scaffold) | + hours/turn-time deep editor link |
| **Tables** | absent | **coming-soon state** | LIVE (CRUD + capacity rules) |
| **Availability** | absent | **coming-soon state** | LIVE (editor + RPC) |
| **Reservations** | absent | **coming-soon state** | LIVE (list + lifecycle) |
| **Waitlist** | absent | **coming-soon state** | LIVE (queue) |
| Menu / Demand / Guests / Campaigns / Feedback | absent | absent | later ships |

**`VenueModuleComingSoon.tsx` (NEW)** — one component, parametrized by module. Renders: the module's one-line job description (from Design §3.3 empty-state copy, reused), an honest "Coming in the next update" line, and where useful a real CTA into a 2.0 surface (e.g. Tables/Availability point to "Set your reservation fee & rules" → Settings). This is the honest landing for the toggle-on "add a table → set hours → fee" starter that references 2.1 surfaces: the **fee/rules step is real (Settings, 2.0)**; the **add-a-table / set-hours steps show the coming-soon state** with the explanation, so the starter chain has no dead end. Copy must NOT claim the booking modules work yet.

**"Fill open tables" hero CTA:** NOT rendered in 2.0 (D9) — the Overview is the preserved listing, the bento dashboard + CTA are 2.1+ content. No dead tap by omission. Flagged for Seth (§12).

**Seam markers (for 2.1/2.2):** protective comments at the shell dispatch (`// META-ORCH-1148 2.0 — booking modules render ComingSoon; 2.1 wires real CRUD here`), at `reservations` migration (`-- 2.0 schema-only; 2.1 lifecycle RPCs, 2.2 consumer write RPC + consumer SELECT policy`), and at `venue_capacity_rules` (`-- 2.1 evaluates party_fit/deposit_threshold/blackout_scope`).

---

## 7. Pre-staged DRAFT invariants (flip ACTIVE on CLOSE)

| Invariant (DRAFT) | Statement | Fails-on-revert test |
|-------------------|-----------|----------------------|
| **I-PROPOSED-1148-RESERVATION-TOGGLE-GATES-SUITE** | `deriveVenueModules(false)` = `['overview','settings']` (no booking modules); `deriveVenueModules(true)` includes tables/availability/reservations/waitlist. The suite's booking band is gated SOLELY on `reservations_enabled`. | T-1/T-2 unit (§9) |
| **I-PROPOSED-1148-RESERVATIONS-RLS-BRAND-SCOPED** | Every new venue_* table + `reservations` has RLS ENABLED with a brand-member read policy + manager-plus write policy; no public/anon read; no consumer direct write in 2.0. | §4.10 DB probe + T-8 RLS test |
| **I-PROPOSED-1148-NO-BUYER-TAX-FORM-IN-VENUE-SETTINGS** | The venue reservation-fee Settings UI contains NO billing-address input and NO "Calculate tax" control (extends `orch-1130-no-buyer-tax-form`). | T-6 strict-grep static |
| **I-PROPOSED-1148-PAID-FEE-REQUIRES-CHARGES-ENABLED** | The fee toggle blocks enabling a paid fee when the brand lacks `stripe_charges_enabled`/Paystack subaccount (publish-time fail-close, ORCH-1073/1075 lineage). | T-7 component |
| **I-PROPOSED-1148-VENUE-MODULE-NAV-REPLACES-HUB-PILLS** | On native + web-phone, while the Venue suite is active the Hub offering-pill row is replaced (not stacked) by the venue module nav (LOCKED DECISION 5). | T-9 component |

Reuse-preserved (must stay green, NOT re-asserted): `ANDROID_GLASS_USES_OPAQUE_FALLBACK`, `I-DESKTOP-GATE-VIA-HOOK`, `hub-layout-nav-lock.test.ts`, `I-PROPOSED-1145-VENUE-TAB-CONDITIONAL` (now ACTIVE post-1145), `orch-1130-no-buyer-tax-form`.

---

## 8. Implementation order

1. **Migrations (8 files)** §4.2–4.10 in version order; apply via Management API from clean merged-main+branch; run `mcp__supabase__get_advisors` (security) after apply. (DB probe + RLS test FIRST so later UI builds against a real schema.)
2. **Types + hook** — `VenueReservationSettings` type; `useVenueReservationSettings` (+ mutations). Unit/integration smoke.
3. **`designSystem.ts`** — add `venueRailWidth`, `venueSuiteMaxWidth`.
4. **`deriveVenueModules` + `VenueModule` type** (pure) + unit tests T-1/T-2.
5. **`VenueModuleComingSoon.tsx`** (honest interstitial).
6. **`VenueSettingsModule.tsx`** (toggle + fee + rules + profile read + team scaffold) + paid-fee gate (T-6/T-7).
7. **`useVenueSuiteActive` store** (Hub-pill suppression signal).
8. **`VenueSuiteShell.tsx`** — `activeModule` machine, responsive layouts, module dispatch (Overview=`VenueListingContent`).
9. **`hub/listing.tsx`** — replace the direct `VenueListingContent` mount with `<VenueSuiteShell brandId focus />`; set `useVenueSuiteActive(true)` on mount, false on unmount.
10. **`hub/_layout.tsx`** — when `useVenueSuiteActive() && !isWideDesktop`, render the venue module pill row in place of `HubSubNav`; PRESERVE the nav-lock guard + redirect ordering + `HUB_TAB_ROUTES` exactly. (T-12 = `hub-layout-nav-lock.test.ts` stays green unmodified.)
11. Run business jest + strict-grep gates; confirm T-1/T-2/T-6/T-7/T-8/T-9 fail on revert; web-build the ORCH-1083 `__common` bundle-budget gate (lucide per-icon imports only).
12. Device/sim proof: business iOS + Android (toggle OFF→ON, Settings fee gate, pill replacement), web desktop two-column, web phone single column.

---

## 9. Test plan (happy + adversarial; fails-on-revert targets)

| Test | Scenario | Expected | Layer |
|------|----------|----------|-------|
| T-1 (happy, FoR) | `deriveVenueModules(false)` | `['overview','settings']` — no booking modules | unit |
| T-2 (happy, FoR) | `deriveVenueModules(true)` | includes tables/availability/reservations/waitlist; settings last | unit |
| T-3 (edge) | toggle ON then OFF while `activeModule='tables'` | shell snaps `activeModule` back to `'overview'` | component |
| T-4 (happy) | OFF state Overview | renders `VenueListingContent` body + invitation card; no booking rows | component |
| T-5 (happy) | tap a booking module (ON) | renders `VenueModuleComingSoon`, NOT a blank/dead screen, NOT fake CRUD | component |
| T-6 (FoR, static) | `VenueSettingsModule.tsx` source | contains NO `billing`/`address` input + NO "Calculate tax" string (strict-grep) | static |
| T-7 (FoR) | toggle paid fee, brand `stripeChargesEnabled=false`, no Paystack subaccount | fee NOT enabled; "finish payout setup" message + route shown | component |
| T-8 (FoR, RLS) | non-member SELECT/INSERT on each venue_* + reservations | denied; member SELECT ok; manager-plus INSERT ok; member-below-manager INSERT denied | DB/RLS (live or pgTAP-style) |
| T-9 (FoR) | native/web-phone, suite active | Hub offering pills NOT rendered; venue module pills rendered in their place | component |
| T-10 (happy) | web desktop `isWideDesktop` | two-column: 260px master rail + workspace; `role=tablist` | component (jsdom width≥1024) |
| T-11 (DB probe) | run §4.10 probe | passes on correct schema; RAISEs if a table/RLS/enum value missing | DB |
| T-12 (preserve) | `hub-layout-nav-lock.test.ts` | PASSES unmodified | static |
| T-13 (preserve) | existing `useHubTabs.venue` + ORCH-1145 venue-tab contract tests | PASS unmodified (Venue pill still gated on `hasPhysicalLocation||placePoolId`) | unit |

**Adversarial angles for the tester:**
- **RLS bypass:** can an authenticated user of brand A read/write brand B's `reservations`/`venue_reservation_settings`? (Must be denied — T-8.) Probe `service_role` is the ONLY consumer-write path (none exists in 2.0).
- **Toggle race:** double-tap the toggle / toggle while a fee mutation is in flight — no duplicate rows (PK = brand_id guarantees single row; upsert idempotent).
- **Paid-fee fail-open:** confirm the fee CANNOT be enabled by directly patching the row from the client when charges aren't enabled (RLS allows the write for manager-plus, so the integrity gate is **UI + 2.1 RPC**, not RLS — tester must confirm 2.0 only exposes the gated UI path; flag that the server-side fail-close is genuinely a 2.1/2.2 RPC, not present in 2.0, so a hand-rolled client write could set `fee_enabled` — acceptable for 2.0 since NO charge path exists yet, but DOCUMENT it).
- **Nav-lock regression:** push a non-hub route from inside Venue (e.g. brand switcher) — no bounce-back; pills restore on return.
- **Desktop↔phone resize:** cross 1024 while on a booking module — layout reflows, `activeModule` preserved, no crash.
- **Empty brand:** brand with `hasPhysicalLocation` but no `place_pool` — Settings hours summary handles null `opening_hours` gracefully.
- **Android glass:** every new `GlassCard`/rail surface opaque on Android (no translucent fill, `overflow:hidden`, no square-halo shadow).

---

## 10. Scoped allowlist (implementor may change ONLY these)

**Add (migrations):**
- `supabase/migrations/20261003000000_orch_1148_venue_tables.sql`
- `supabase/migrations/20261003000001_orch_1148_venue_capacity_rules.sql`
- `supabase/migrations/20261003000002_orch_1148_venue_availability_config.sql`
- `supabase/migrations/20261003000003_orch_1148_venue_blackouts.sql`
- `supabase/migrations/20261003000004_orch_1148_venue_reservation_settings.sql`
- `supabase/migrations/20261003000005_orch_1148_reservations.sql`
- `supabase/migrations/20261003000006_orch_1148_venue_waitlist.sql`
- `supabase/migrations/20261003000007_orch_1148_invariant_probes.sql`
- `supabase/migrations/__tests__/orch_1148_venue_suite_migration.test.ts` (schema/RLS assertions)

**Add (business app):**
- `mingla-business/src/components/venue/VenueSuiteShell.tsx`
- `mingla-business/src/components/venue/VenueSettingsModule.tsx`
- `mingla-business/src/components/venue/VenueModuleComingSoon.tsx`
- `mingla-business/src/components/venue/venueModules.ts` (the `VenueModule` type + `deriveVenueModules`)
- `mingla-business/src/hooks/useVenueReservationSettings.ts`
- `mingla-business/src/store/venueSuiteStore.ts` (`useVenueSuiteActive`)
- `mingla-business/src/types/venueReservation.ts` (`VenueReservationSettings` + module types)
- New unit/component tests for T-1..T-11 (e.g. `src/components/venue/__tests__/venueModules.test.ts`, `venueSuiteShell.contract.test.tsx`, `venueSettings.feeGate.test.tsx`).

**Modify:**
- `mingla-business/app/(tabs)/hub/listing.tsx` (mount `VenueSuiteShell` instead of `VenueListingContent`; set/clear `useVenueSuiteActive`)
- `mingla-business/app/(tabs)/hub/_layout.tsx` (conditional venue-module pill row in place of `HubSubNav` on native/web-phone when suite active; PRESERVE nav-lock guard + ordering + `HUB_TAB_ROUTES`)
- `mingla-business/src/constants/designSystem.ts` (add `venueRailWidth`, `venueSuiteMaxWidth`)

**DO-NOT-TOUCH (stop-and-amend before any edit):**
- `mingla-business/src/components/venue/VenueListingContent.tsx` — mounted verbatim as Overview; NO redesign (the invitation card is added by the SHELL/Overview wrapper, not by editing this file — if it must be edited, stop-and-amend).
- `mingla-business/src/components/hub/HubSubNav.tsx`, `src/hooks/useHubTabs.ts` — the offering-pill + Venue-pill gate is ORCH-1145's, reused; do NOT change the gate. (The venue MODULE pill row is a NEW component, not a HubSubNav edit.)
- The `_layout.tsx` nav-lock redirect effect + `:167` guard + `:187` ordering + `HUB_TAB_ROUTES` — preserve exactly (T-12).
- `mingla-business/src/components/brand/PublicBrandPage.tsx`, `PublicVenueDetail`, all consumer/`app-mobile`, buyer-web, admin — out of scope (2.2).
- `ticket-checkout-create`, `allInPricingEngine`, brand Pricing-defaults surface — REUSED read-only for the fee preview; NO change in 2.0 (the additive `reservation` checkout mode is 2.2).
- `public.waitlist_entries` + its trigger — DO NOT overload; `venue_waitlist` is the new table.
- Any existing table/function/RLS — additive-only; no drops/renames.

---

## 11. Regression prevention (fails-on-revert contract)

- **Toggle gates suite (I-...TOGGLE-GATES-SUITE):** T-1/T-2 — reverting `deriveVenueModules` to show booking modules unconditionally (or hide them when ON) flips these → FAIL. Protective comment in `venueModules.ts`.
- **RLS brand-scoped (I-...RLS-BRAND-SCOPED):** §4.10 DB probe + T-8 — dropping/weakening any policy or RLS-enable trips the probe + the RLS test.
- **No buyer tax form (I-...NO-BUYER-TAX-FORM):** T-6 strict-grep — adding a billing-address/Calculate-tax control to `VenueSettingsModule` → FAIL.
- **Paid-fee fail-close (I-...PAID-FEE-REQUIRES-CHARGES-ENABLED):** T-7 — removing the gate lets a paid fee enable without charges → FAIL.
- **Pill replacement (I-...REPLACES-HUB-PILLS):** T-9 — reverting to a stacked double pill row → FAIL.
- **Preserve gates:** `hub-layout-nav-lock.test.ts` (T-12) + ORCH-1145 venue-tab tests (T-13) stay green WITHOUT modification.

---

## 12. Open questions for Seth (genuine forks — answer before / at REVIEW)

1. **"Fill open tables" hero CTA sequencing (D9).** VISION r2-6 says FUNCTIONAL in ship 1. This SPEC sequences the Overview bento dashboard + that CTA into **2.1** (they need reservation data 2.0 doesn't generate); 2.0's Overview = the preserved ORCH-1145 listing. Confirm the CTA belongs in 2.1, not 2.0. (If Seth wants the CTA visible in 2.0, it would be a "coming soon, notify me" sheet — but that risks a near-dead-tap; recommend 2.1.)
2. **Venue-category gating (D6 / PRD Q8).** Reservations toggle shows for ANY venue (`hasPhysicalLocation||placePoolId`), not only `venueCategory='restaurant'`. Confirm — or restrict to restaurant + play, deferring creative_and_arts.
3. **Toggle-on landing (5.7).** This SPEC lands on **Settings → Reservations** after toggle-ON (where the real 2.0 action is), since Tables is a coming-soon state. Design §3.2 lands on Tables-empty. Confirm Settings-landing for 2.0 (Tables-landing returns in 2.1).
4. **Team-roles scaffold depth (5.4-5).** 2.0 ships role DISPLAY only (list members + role labels). Confirm role MUTATION is deferred to a later ship (it overlaps the existing brand Team surface — recommend reusing that, not rebuilding in the suite).
5. **Paid-fee server fail-close timing.** The genuine server-side `stripe_account_not_ready` fail-close for the fee is a 2.1/2.2 RPC (no charge path exists in 2.0). 2.0 enforces it at the UI only. Acceptable since no money moves in 2.0 — confirm, or require a service-role validator now (recommend defer: no charge surface yet).

---

## 13. Downstream routing

NEXT = **mingla-implementor (business + Supabase)** after Seth answers §12 (Q1 is the only one that could re-scope; Q2–Q5 are confirmations). Then **mingla-tester** (business iOS + Android + web-desktop + web-phone, with device/sim proof of toggle OFF→ON, Settings fee gate, pill replacement, two-column reflow, + the RLS/probe DB tests). Then **mingla-orchestrator CLOSE** (flip the 5 DRAFT invariants → ACTIVE; register META-ORCH-1148 + sub-ORCH 2.0/2.1/2.2 on the World Map; reconcile against ORCH-1145's merged base; confirm no scope bleed per `feedback_shared_worldmap_scope_bleed`). Then 2.1 (booking core + availability RPC), then 2.2 (consumer surface + all-surface parity + OTA).

---

*End of SPEC. This is the binding contract for META-ORCH-1148 sub-ORCH 2.0. The implementor builds exactly this; no widening. Migrations applied via Management API only; no code written by this SPEC.*
