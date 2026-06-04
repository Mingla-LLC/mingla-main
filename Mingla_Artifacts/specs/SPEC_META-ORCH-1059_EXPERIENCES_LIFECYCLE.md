# SPEC — META-ORCH-1059 [experiences-business-parity]

**ORCH:** META-ORCH-1059 [experiences-business-parity]
**Mode:** SPEC (layered implementation contract; NOT code)
**Skill:** mingla-forensics
**Date:** 2026-06-02
**Working tree:** `~/Desktop/mingla-orchs/meta-orch-1059-[experiences-business-parity]/` on branch `meta-orch-1059-experiences-business-parity`
**Anchors:** `Mingla_Artifacts/reports/INVESTIGATION_META-ORCH-1059_EXPERIENCES_BUSINESS_PARITY.md`; `Mingla_Artifacts/design/DESIGN_META-ORCH-1059_EXPERIENCES_LIFECYCLE.md`.
**Tokens (UI surfaces):** `mingla-business/src/constants/designSystem.ts` (every visual value is a token; the design doc owns the granular visual contract — this spec references it, see §UI-CONTRACT).

**Comms-ledger acks (read on entry):**
- **COMMS-0014** + **COMMS-0016** (BLOCK-grade contract): experience checkout MUST route through the existing `ticket-checkout-create` edge fn + `biz_ticket_checkout_create_session` RPC. No parallel money fn. Factored into Sub-D §3.D as the hard guard. Confirmed viable by the C3 resolution (§3.C3) + the Stripe best-practices pass (§3.D5).
- **COMMS-0013** (web-vs-native tax-basis divergence): experiences inherit the identical divergence events/trips have today. Carried forward as residual operator decision Q6.
- **COMMS-0002** (ORCH-0863 C7 backend allowlist): every new migration / edge-fn dir lands its allowlist update in the SAME commit. Encoded as a hard guard in Sub-A and Sub-D.
- **COMMS-0003** (external-API docs cited): applies only to the Stripe slice (Sub-D). No new Stripe payload — cited in §3.D5.
- **COMMS-0015** (ship-verify-merge before deploy/reap): a CLOSE note for the orchestrator, not an implementor task.

No new cross-ORCH discovery this turn → no new COMMS entry written.

---

## 0. EXECUTIVE SUMMARY (read this; the rest is build detail)

Experiences become Mingla Business's full third offering at event-grade parity. The investigation proved all six gaps and the single deeper blocker; the design proved the work is overwhelmingly *adopt-the-proven-events-pattern*. **This spec's job was to resolve C3 — the one open architecture question — and then pin Sub-A's data materialization to match the events model exactly.** Both are done below with file+line proof.

**C3 RESOLVED (the headline):** Events sell against the **event (the series), NOT a specific occurrence** — for one-time, recurring, AND multi-date events alike. The checkout edge fn requires only that **≥1 future `event_dates` row exists** (a `count > 0` head query, `ticket-checkout-create/index.ts:258-275`); it takes **no `event_date_id` / occurrence parameter**. The session RPC `biz_ticket_checkout_create_session` keys on `p_event_id` + `p_lines:[{ticketTypeId, quantity}]` only (`20260727000000_orch_0955_native_stripe_tax.sql:58-65`; `CheckoutLine = { ticketTypeId, quantity }` at `ticket-checkout-create/index.ts:40`). **Experiences MUST match this:** the buyer never picks an occurrence at checkout. Recurring/multi-date occurrence *display* is informational only — it never rides into the money path. Full proof + the consequence for the public-page date-model selector in §3.C3.

**Sub-A materialization, pinned to the events model (§3.A):** the experience publish path must mirror `business_publish_event_draft` (`20260604000001_orch_0824_publish_rpc.sql`, latest def; identical date logic to `20260525000000_orch_0792`). That means:
- **One-time** → 1 `event_dates` row, `is_master=true`.
- **Recurring** → **1** `event_dates` master row (the first occurrence) + the recurrence descriptor stored as JSON on `events.recurrence_rules` + `is_recurring=true`. **NOT** N materialized rows.
- **Multi-date** → N `event_dates` rows, `is_master=true` stamped on the chronologically-earliest.
- **Multi-tier** → N `ticket_types` rows from the tier list (mirror the event publish ticket loop, `0824:405-...`), NOT the single `theme.experience_meta` strings.

A new SECURITY DEFINER RPC `biz_publish_experience_draft` does this atomically (one-time/recurring/multi-date date materialization + multi-tier ticket materialization + status flip), so a published experience is **sellable by construction** and inherits the entire ORCH-1006 money path with **zero money-engine changes**.

**Decomposition (dependency order):** Sub-A (prerequisite) → {Sub-B ∥ Sub-C} → Sub-D (needs A + C) → {Sub-E ∥ Sub-F}. Minimum critical path: A → C → D.

**Locked decisions baked in (do NOT re-litigate):** experiences always have ≥1 date (no evergreen); recurrence ships v1; multi-tier pricing; publish-time materialization (drafts preview-only); dashboard tiles = Check-in/QR + Orders + Buyers + Edit + Public/Brand-page + share + Blasts (NO door-cash-sales, NO reconciliation); AI accept → "Set up & publish" prefilled wizard (no bulk-publish); checkout LOCKED to `ticket-checkout-create`.

---

## 1. SCOPE / NON-GOALS / ASSUMPTIONS

### In scope
- Sub-A: experience creation (manual wizard + AI path) writes real `ticket_types` (multi-tier) + `event_dates` (one-time/recurring/multi-date) via a new publish RPC. Migration. Backend allowlist + strict-grep update. Deno test.
- Sub-B: `app/experience/[id]/` dashboard + `app/experience/[id]/edit.tsx` + Hub list tap-through (`routeForEventRow` fix).
- Sub-C: public detail page `app/exp/[brandSlug]/[experienceSlug].tsx` + `usePublicExperienceBySlug`/`ById` hooks + `getPublicExperienceBySlug`/`ById` resolvers.
- Sub-D: `ExperienceCheckoutFlow` + `/checkout-experience/[experienceEventId]/` chain, multi-tier cart selection, routed into the shared money engine. Strict-grep + audit-test allowlist.
- Sub-E: `publishedExperienceEditGuards.ts` + `EditAfterPublishExperienceBanner.tsx` (+ `biz_update_live_experience` RPC).
- Sub-F: `app/experience/[id]/orders/` (Orders | Buyers segment) + `app/experience/[id]/scanner` + dashboard revenue KPI.

### Non-goals (explicit)
- **No money-engine change.** `ticket-checkout-create`, `biz_ticket_checkout_create_session`, `resolve_event_pricing_inputs`, `resolve_effective_take_rate_bps`, the Stripe PaymentIntent path — all untouched (COMMS-0014/0016).
- **No consumer-app (`app-mobile/`) work.** The consumer app is brand-kind-agnostic and does not render public-brand routes (design Area 5 line 447).
- **No admin-web moderation parity for experiences** (Q5 — deferred; recommend confirm).
- **No buyer intake-form step** for experience checkout v1 (trips have one; experiences skip it — Q/D2).
- **No occurrence-level inventory.** Capacity is per `ticket_types` row across the series, exactly as events (see C3 consequence §3.C3).
- **No evergreen/dateless experiences** (operator lock).
- **No web-vs-native tax unification** — experiences inherit the existing divergence (COMMS-0013 / Q6).

### Assumptions (stated, not proven-blocking)
- Zero experiences exist in prod (proven via DB probe, investigation §Data) → clean-slate build, no backfill. The 0 legacy AI/wizard rows that exist in the published-but-unsellable state will be migrated only if any appear; spec includes a backfill note (§3.A6) but expects a no-op.
- `mingla-designer` produced the granular visual contract; this spec references it and requires it to govern every pixel (see §UI-CONTRACT).

---

## 2. CROSS-SURFACE IMPACT (mandatory)

The 5 primary + 2 adjacent surfaces, declared per sub-track:

| Surface | Covered? | Behaviour demanded | Parity |
|---|---|---|---|
| **1. Consumer iOS** (`app-mobile/`) | ❌ NOT covered | brand-kind-agnostic; doesn't render public-brand routes | n/a |
| **2. Consumer Android** | ❌ NOT covered | same | n/a |
| **3. Buyer/anon Web** (`mingla-business/` web) | ✅ Sub-C, Sub-D | public experience detail page `/exp/{brandSlug}/{slug}` renders; experience cards on `/b/{brandSlug}` resolve (no longer dead-link); `/checkout-experience/{id}` transacts via shared PaymentSheet | **automatic** for checkout chain (shared screens); **manual** for the public detail page + the `/exp/` route (new web-rendered route) → per-surface SC |
| **4. Business iOS** (`mingla-business/`) | ✅ Sub-A/B/E/F + share-open of C/D | wizard date+tier steps; dashboard; edit; Hub tap-through; guards; analytics; scanner | **manual** (separate iOS render path) → per-surface SC where iOS/Android diverge |
| **5. Business Android** | ✅ Sub-A/B/E/F | same as Business iOS | **manual** (Android glass policy, native date pickers) → per-surface SC |
| **6. Admin Web** (adjacent) | ❌ deferred (Q5) | experiences not surfaced in admin moderation | n/a — register follow-up ORCH if operator wants |
| **7. Business Web preview** (adjacent) | ✅ incidental | wizard + dashboard render on the web preview build; date pickers use the web hidden-input path inherited from `CreatorStep2When` | automatic (shared components) |

**Manual-parity success criteria are split per surface (SC-N-iOS / SC-N-Android / SC-N-Web) wherever the render path differs** — enumerated in each sub-track's success-criteria table.

**Surface-specific landmines the implementor must honor:**
- **Android glass policy** ([[android-glass-policy-opaque-fallback]]): every new GlassCard/tile uses the shared `GlassCard`/`GlassChrome`/`IconChrome` components (opaque ≥0.92 Android fill + `overflow:'hidden'` + zeroed Android elevation). No hand-rolled translucent fills.
- **Date pickers** (Sub-A): iOS Sheet spinner / Android native dialog / web hidden HTML5 inputs — all inherited verbatim from `CreatorStep2When`; do NOT re-implement.
- **Anon-tolerance** (Sub-C/D): the `/exp/` + `/checkout-experience/` routes must not call `useAuth` or redirect to sign-in (mirror `usePublicTripBySlug.ts` header note + `feedback_anon_buyer_routes.md`).

---

## 3. THE RESOLVED CONTRACTS + LAYERED SPEC BY SUB-TRACK

### §3.C3 — RESOLVED: the events recurring/multi-date PURCHASE model (proof-backed)

**This is the C3 resolution the dispatch demanded FIRST. Experiences MUST match it exactly.**

**Finding C3-A — How event creation materializes `event_dates` (proven):**
`business_publish_event_draft` (latest def `20260604000001_orch_0824_publish_rpc.sql`; identical date logic introduced in `20260525000000_orch_0792_publish_writes_event_dates.sql:240-307`) reads `theme.business_draft.whenMode` ∈ `{single, multi_date, recurring}` and:

- **`single` OR `recurring`** → inserts **exactly ONE** `event_dates` row with `is_master=true`, derived from `when.date` + `when.doorsOpen`/`when.endsAt` (`0792:256-269`). The recurring repetition is NOT materialized into rows — it is stored as a JSON descriptor on `events.recurrence_rules` + the boolean `events.is_recurring=true` (`0792:326,328`).
- **`multi_date`** → inserts **N** `event_dates` rows, one per `multiDates[]` entry, with `is_master=true` stamped on the chronologically-earliest occurrence (`0792:271-306`, `v_start = v_min_start`).
- A **partial unique index** `event_dates_master_unique ON event_dates(event_id) WHERE is_master=true` enforces ≤1 master per event (`0792:28-30`).
- Dates are written **BEFORE** the `status='scheduled'` flip so the `trg_events_enforce_master_date` constraint trigger passes (`0792:240-242`).

**Conclusion C3-A:** A recurring event is **ONE `events` row + ONE master `event_dates` row + a recurrence JSON rule**. A multi-date event is **ONE `events` row + N `event_dates` rows**. Mingla does NOT create one `events` row per occurrence.

**Finding C3-B — What checkout sells against (proven):**
- The checkout edge fn `ticket-checkout-create/index.ts` parses the body to `{ eventId: string, lines: CheckoutLine[] }` where `CheckoutLine = { ticketTypeId: string; quantity: number }` (`:40`, `:198`, `:215`). **There is no occurrence / `event_date_id` field anywhere in the request contract.**
- The only `event_dates` interaction is a **head count query asserting ≥1 future date exists** — `supabase.from("event_dates").select("id",{count:"exact",head:true}).eq("event_id",eventId).gt("end_at",now)` → `event_no_active_dates` (422) if zero (`:258-275`). It does NOT select a specific row.
- The session RPC `biz_ticket_checkout_create_session(p_event_id, …, p_lines, …)` (`20260727000000_orch_0955_native_stripe_tax.sql:58-65`) looks up `ticket_types WHERE id=line.ticketTypeId AND event_id=p_event_id` (`:206-208`) — keyed on **event + ticket type**, never an occurrence.

**Conclusion C3-B (THE LOCKED CONTRACT):** **Checkout sells per-SERIES (per event), never per-occurrence — for all three date modes.** The buyer's cart is `{eventId, lines:[{ticketTypeId, quantity}]}`. The "which date" question is purely a *display* affordance; the chosen occurrence does **not** ride into `biz_ticket_checkout_create_session` and there is **no per-occurrence inventory**. Capacity is the `ticket_types.quantity_total` shared across the whole series.

**Consequence for Sub-C/D UI (resolves design flag C3 + Q4-occurrence):**
- The public-page date-model block (design §C.2/C.3) renders one-time / recurring / multi-date for buyer *information* ("Every Friday · Next: Fri 20 Jun" / "5 dates").
- The occurrence selector design §C.3 proposed is **REMOVED for v1** — because checkout is per-series and there is no per-occurrence inventory, presenting a "pick a date" radio that has no effect on the cart would be a dead/misleading control (Constitution #1 + #9 risk). For multi-date, render the list of dates as **read-only informational rows** ("This experience runs on these dates: …"), NOT selectable. For recurring, render the recurrence label + next date, read-only.
- `ExperienceCheckoutFlow` (Sub-D) passes only `{ticketTypeId, quantity}` — **no occurrence param.** Matches events/trips exactly.
- **If the operator later wants per-occurrence selling** (distinct inventory per date), that is a NEW money-model ORCH touching the session RPC + edge fn + cart — explicitly out of scope here and flagged as residual decision Q-C3-FUTURE.

**Finding C3-C — the two wizard step contracts to lift (proven):**
`CreatorStep2When` (`mingla-business/src/components/event/CreatorStep2When.tsx:178`) and `CreatorStep5Tickets` (`:59`) are both `React.FC<StepBodyProps>`. `StepBodyProps` (`src/components/event/types.ts:14-71`) requires: `draft: DraftEvent`, `updateDraft(patch)`, `errors: ValidationError[]`, `showErrors: boolean`, `onShowToast`, `scrollToBottom`, + optional `editMode`, `canEditTicketPrice`, `coverMediaEventId`, `brandDefaultCurrency`, `coverMediaApplyMode`, `onCoverVideoProcessingChange`. The `DraftEvent` fields these two steps read (`src/store/draftEventStore.ts`): When → `whenMode`, `date`, `doorsOpen`, `endsAt`, `endsAtUtc`, `timezone`, `recurrenceRule`, `multiDates` (`:258-288`); Tickets → `currency`, `tickets`, `pricingSwitches` (`:320-330`). **The experience wizard does not own a `DraftEvent`** → Sub-A builds a thin adapter (design flag A1, resolved to option (a) below).

---

### §3.A — SUB-A: CREATION PARITY (PREREQUISITE — backend-heavy)

**Goal:** both creation paths (manual `ExperienceCreatorWizard` + AI `create_experience`/`usePendingExperiences`) produce a published experience carrying real multi-tier `ticket_types` + one-time/recurring/multi-date `event_dates`, materialized at **publish time** (drafts preview-only).

**Mirror precedent:** `business_publish_event_draft` (`20260604000001_orch_0824_publish_rpc.sql`) — the event publish RPC that materializes BOTH tickets + dates from the payload. (NOT the trip RPC `business_publish_trip_draft` `20260608000100`, which only writes a single master date because trips are single-tier/single-date.)

#### 3.A.1 — Database layer

**New RPC: `public.biz_publish_experience_draft(p_event_id uuid, p_draft_payload jsonb, p_client_revision integer DEFAULT NULL) RETURNS jsonb`** — SECURITY DEFINER, `SET search_path TO 'public','pg_temp'`. Atomic publish, mirroring `business_publish_event_draft` with these deltas:

- **Auth/permission:** `auth.uid()` non-null; `biz_brand_effective_rank(brand_id, uid) >= biz_role_rank('event_manager')` (experiences are `events` rows → same gate as events).
- **Type guard:** the target row must be `event_type='experience'` AND `status='draft'`. Raise `experience_draft_not_publishable` otherwise. (Mirror `0824` `event_draft_not_publishable` but type-scoped.)
- **Date materialization (LIFTED VERBATIM from `0824:283-340`, the §3.C3-A logic):**
  - read `whenMode` ∈ `{single, multi_date, recurring}` from `theme.business_draft.whenMode`; raise `experience_date_required` if absent/invalid;
  - `single|recurring` → 1 master row from `when.date` + `when.doorsOpen`/`when.endsAt`;
  - `multi_date` → N rows, master on the earliest;
  - write rows **before** the status flip;
  - set `events.is_recurring`, `events.is_multi_date`, `events.recurrence_rules` from the payload identically to `0824:355-358`.
  - **Label note:** experiences relabel "doors"→"starts" at the UI layer only (§3.A.3); the DB columns `start_at`/`end_at` are unchanged.
- **Tier materialization (LIFTED from `0824:405-...` ticket loop):** soft-delete prior `ticket_types` for the event, then INSERT one row per tier in `theme.business_draft.tickets[]` (name, `price_cents=round(priceMajor*100)`, `currency`, `quantity_total` or NULL if unlimited, `is_free`, `is_unlimited`, `display_order`, the 6 modifier flags). Validate ≥1 tier (`experience_ticket_required`), tier name required, free→price 0, capacity>0 unless unlimited — mirror `0824:159-193`.
- **Switches:** persist `pass_tax`/`pass_mingla_fee`/`pass_service_fee` from the payload (already on the row from creation; keep on re-publish).
- **Theme cleanup:** strip `theme.business_draft`, keep a `theme.experience_meta` display mirror of `venue_text` + (optionally) the first tier's `tier_name`/`price_major`/`capacity` for any non-checkout reader (design §A.3 note — the public RPC reads `ticket_types` for price, so this mirror is display-only and may be dropped).
- **Slug:** reuse the events collision-resolution loop (`0824` slug block).
- **Currency CHECK:** reuse the events allowlist (note: ORCH-1034 generalizes this off GBP-only; until then keep the events list verbatim — do NOT introduce a new CHECK shape that diverges from events).
- **Return shape:** `{ event, brand:{id,slug,name}, tickets:[…], eventDates:[…], client_revision }` (mirror `0824:438-448`).

**Draft creation:** drafts are written by the wizard as today (an `events` row, `status='draft'`, no tickets/dates) — but now the draft payload carries the full When + tier state inside `theme.business_draft` (mirroring the event draft shape) so publish can materialize. **Materialization happens ONLY at publish** (resolves investigation Q1). A draft is never sellable: `pg_public_experiences_by_brand` filters `published_at IS NOT NULL` (proven, investigation §Data) → drafts never leak to buyers.

**Migration file:** `supabase/migrations/<ts>_meta_orch_1059_experience_publish_rpc.sql` (one new function + GRANT to `authenticated`; `NOTIFY pgrst`). Timestamp per [[migration-history-drift-db-push-unsafe]] surgical-apply protocol — orchestrator/operator applies via Management API + `schema_migrations` INSERT, NOT blind `db push`.

**Backend allowlist (COMMS-0002, HARD):** the new migration file is added to the ORCH-0863 C7 `no-new-backend-files` allowlist in `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` **in the same commit** (mirror how prior migrations were allowlisted, e.g. the ORCH-0978/0963 entries).

#### 3.A.2 — Service / hook layer

**`mingla-business/src/services/experiencesService.ts`** (or a new `experienceDraftService.ts`):
- add `publishExperienceDraft(eventId, draftPayload, clientRevision?)` → `supabase.rpc("biz_publish_experience_draft", {...})`. Error contract: throws the Postgres error (the wizard maps the named errors — `experience_date_required`, `experience_ticket_required`, etc. — to Mingla-voice toast copy). Return type mirrors the event publish service return.
- keep `getExperiencesByBrand` (hub list) BUT the row shape gains derived `priceFromCents`/`isFree`/`nextOccurrenceAt`/`whenMode` so the Hub row (Sub-B.5) can show "5 dates · Next … · From £25". Source: read `ticket_types` (min price) + `event_dates` (next future) for the brand's experiences, OR reuse `pg_public_experiences_by_brand` for published + a separate draft read. **Decision:** add a small `pg_brand_experiences_manage(p_brand_id)` SECURITY DEFINER RPC returning both drafts + published with price/next-date derived, OR enrich the existing client query with two extra selects. Implementor picks the lower-blast-radius option; the Hub must show drafts (no `published_at` filter for the owner) — investigation F-7.

**Adapter (design flag A1 → resolved to option (a)):** new `mingla-business/src/components/experience/useExperienceDraftAdapter.ts` — maps experience-wizard local state ⇄ the `DraftEvent` subset that `CreatorStep2When` + `CreatorStep5Tickets` read (the fields enumerated in §3.C3-C). Returns a synthetic `DraftEvent` + an `updateDraft` that writes back into experience local state. **Do NOT extend `draftEventStore` for experiences, and do NOT fork the two step components.** Rationale: those two components are 2084 + 446 lines of battle-tested cross-platform date/recurrence/tier logic — re-implementing is the single biggest risk in this ORCH.

#### 3.A.3 — Component layer (`ExperienceCreatorWizard.tsx`)

Stepper unchanged (`Identity · Venue · When · Pricing · Cover`). Steps 1, 2, 5 unchanged. **Steps 3 + 4 are replaced** by mounting the event step bodies via the adapter:

- **Step 3 "When"** replaces the disabled "One-time only" stub (`ExperienceCreatorWizard.tsx:289-300`). Mounts `<CreatorStep2When {...adapter} />`. Copy deltas per design §A.2 table (segment labels, helper strings, "doors"→"Starts", "guests"→"buyers"). **Segment labels = design A2 recommendation "One-time / Recurring / Multiple dates"** (residual op-decision A2 if exact event parity preferred).
- **Step 4 "Pricing"** replaces the single price/capacity inputs (`:301-337`). Mounts `<CreatorStep5Tickets {...adapter} />` (multi-tier list + add-tier + summary) ABOVE the existing `WhoCoversCostsSection` (KEEP verbatim, already wired `:310-336`). Copy deltas per design §A.3 table ("Add tier", "Spots available", delete-confirm copy).
- **Footer/publish:** `Continue` per step; `Save as draft` + `Publish` on step 5. On Publish → `publishExperienceDraft(...)` (3.A.2). Publish-confirm copy per design §A.4 (one-time / "{count} dates will be created" for recurring/multi-date).

**All wizard states** are inherited from the two reused step components (empty multi-date list, day-mismatch, min/max-count, past-date, per-field tier validation, sold-count badges = 0 in create, free/unlimited). The wizard owns: submitting spinner on Publish, the named-error→toast mapping, and the draft-vs-publish branch.

#### 3.A.4 — AI-parser reconciliation (decision A5, LOCKED)

**Edge fn `supabase/functions/_shared/agentTools.ts` `create_experience` (`:474-491`)** currently inserts `status='live'/'public'` with no tickets/dates. **Change:** the tool now creates the experience as a **`status='draft'`** row (visibility `'draft'`, `published_at=null`) carrying the AI proposal in `theme.experience_meta` (title, narrative, suggested price range, capacity range, time-of-day). It does NOT publish. This is the only `agentTools.ts` change — the tool produces a DRAFT, never a sellable row.

**Client AI flow (`usePendingExperiences.ts` + `ExperienceConfirmationCard` + `ExperienceReviewCards`):**
- **"Accept" → "Set up & publish"**: routes to `/experience/create` (or `/experience/{id}/edit` for the just-created draft) with the wizard **prefilled** — Step 1 title+description from the proposal; Step 4 seeded with **one editable tier** named "Standard" at the midpoint of the suggested range (`round((min+max)/2)`), capacity = `capacity_max` (or empty); the brand lands on **Step 3 "When" with a required-empty date**. The brand sets date(s) + tweaks tiers + publishes (going through `biz_publish_experience_draft`).
- **"Edit"** (inline title/narrative) + **"Reject"** unchanged.
- **"Accept all" → removed for v1** (can't bulk-publish dated experiences). Design's coherent bulk alternative is "Save all as drafts" (creates N drafts the brand finishes) — **residual op-decision A5**: removal (recommended) vs build the draft-bulk variant.
- Copy deltas per design §A.5 table.

#### 3.A.5 — Success criteria (Sub-A)

| # | Criterion (observable, testable) | Surface | Layer |
|---|---|---|---|
| SC-A1 | Publishing a one-time experience writes exactly 1 `event_dates` row (`is_master=true`) + N `ticket_types` rows (one per tier) | Business iOS+Android | DB/RPC |
| SC-A2 | Publishing a recurring experience writes 1 master `event_dates` row + sets `events.is_recurring=true` + `events.recurrence_rules` JSON (NOT N rows) | Business iOS+Android | DB/RPC |
| SC-A3 | Publishing a multi-date experience writes N `event_dates` rows with `is_master=true` on the earliest only | Business iOS+Android | DB/RPC |
| SC-A4 | `biz_publish_experience_draft` raises `experience_date_required` when no date in payload, `experience_ticket_required` when zero tiers | — | RPC |
| SC-A5 | A published experience's `eventId` passed to `biz_ticket_checkout_create_session` with a valid line reaches a session (NOT `ticket_type_not_found`, NOT `event_no_active_dates`) | — | DB/edge |
| SC-A6 | A draft experience is NOT returned by `pg_public_experiences_by_brand` (no `published_at`) and is NOT sellable | Buyer Web | DB |
| SC-A7-iOS / SC-A7-Android | The wizard Step 3 renders the segmented Single/Recurring/Multi-date control (via the reused `CreatorStep2When`) with experience copy; Step 4 renders the multi-tier list with "Add tier" | Business iOS / Android | Component |
| SC-A8 | AI "Accept" opens the wizard prefilled (one seeded tier at range-midpoint, empty required date); the AI tool creates a DRAFT, never a published/sellable row | Business iOS+Android | Component/edge |
| SC-A9 | `pg_public_experiences_by_brand` returns real `price_from_cents` (lowest tier) for a published multi-tier experience, not NULL/Free | Buyer Web | DB |

#### 3.A.6 — Regression prevention (Sub-A)
- Deno test feeding a synthetic experience publish payload through `biz_publish_experience_draft` asserting ≥1 `ticket_types` + ≥1 master `event_dates` materialized (fails-on-revert of F-1).
- Deno test passing the resulting `eventId` through a `biz_ticket_checkout_create_session` call asserting it does NOT raise `ticket_type_not_found`/`event_no_active_dates`.
- A migration self-verify probe (or test) asserting the recurring path writes exactly ONE master row (guards against accidentally materializing N rows for recurring).
- Backfill note: if any of the 0 legacy unsellable experiences exist at deploy, a one-shot UPDATE/INSERT migrates them; expected no-op (0 rows).

---

### §3.B — SUB-B: BUSINESS MANAGEMENT (dashboard + Hub tap-through + edit)

**Designer pass: REQUIRED (new dashboard IA).** **Mirror:** `app/trip/[id]/index.tsx` (5-route structure) borrowing the `door`/`scanner` tiles from `app/event/[id]/`.

#### 3.B.1 — New routes/components
- `app/experience/[id]/index.tsx` (dashboard) — component tree per design §B.1 (SafeScreen host `#0c0e12` → TopBar(back + share + moreH) → ScrollView{ hero → ActionTile grid → KPI card → tier rows → recent activity → cancel CTA }).
- `app/experience/[id]/edit.tsx` — status-dispatch host (design §B.6): `draft`→`ExperienceCreatorWizard` edit-mode; `scheduled|live`→`EditPublishedExperienceScreen` (Sub-E); `ended|cancelled`→read-only.
- New components: `ExperienceDetailHeroStatusPill` (mirror `TripDetailHeroStatusPill`), `ExperienceDetailKpiCard` (mirror `TripDetailKpiCard`), `ExperienceManageMenu` (mirror `TripManageMenu`). REUSE: `ActionTile`, `EventDetailTicketTypeRow`, `EventDetailActivityRow`, `ShareModal`, `ConfirmDialog`, `Toast`, `EventCoverMedia`, `IconChrome`.
- New shared helper `formatExperienceDateSubline(mode, dates, recurrenceRule, venue)` (mirror `recurrenceRule.ts` + `eventDateDisplay.ts`) → the hero/public/MiniCard subline (design §B.3). **One owner**, used by dashboard hero + public page + `ExperienceMiniCard`.

#### 3.B.2 — Action tile set (operator-locked)
Per design §B.2: (1) Check-in `/experience/{id}/scanner`, (2) Orders `/experience/{id}/orders`, (3) Buyers `/experience/{id}/orders?view=buyers`, (4) Blasts `/event/{id}/blasts` (offering-agnostic, event-id-keyed — reused as trips do), (5) Public page `/exp/{brandSlug}/{slug}`, (6) Brand page `/b/{brandSlug}`, (7) Edit `/experience/{id}/edit` (primary; label "Continue editing" when draft). **NO Door-cash-sales, NO Reconciliation** (operator scope). Edit/Cancel gated on `canPerformAction(rank,"EDIT_EVENT")` (`permissionGates.ts`) — experiences are `events` rows, same gate.

#### 3.B.3 — Hub tap-through (fixes the dead taps)
- `routeForEventRow.ts:69-73` — replace `return '/experience/coming-soon'` with `return row.status === 'draft' ? \`/experience/${row.id}/edit\` : \`/experience/${row.id}\`` (mirror the event/trip branch exactly).
- `app/(tabs)/hub/experiences.tsx:248-271` — wrap each row `<View>` in a `Pressable` → `routeForEventRow({event_type:'experience', status: exp.status})`; add `accessibilityRole="button"`, `accessibilityLabel`, `pressed && {opacity:0.9}`, a status chip (Draft/Live/Ended), and the `formatExperienceDateSubline` + price meta line (design §B.5).
- **Strict-grep allowlist (HARD):** extend `.github/scripts/strict-grep/i-proposed-tr2-route-by-event-type.mjs` to exempt `app/experience/[id]/*` route files and to allow the static `/experience/coming-soon` (until deleted). Concretely: add an `EXPERIENCE_ROUTE_PREFIX = join(REPO_ROOT,"mingla-business","app","experience")+"/"` and include it in `isCallerExempt`; extend `ROUTER_PUSH_DYNAMIC_RE` + `STATIC_NO_ID_RE` to also match `/experience/` (currently only `/event/|/trip/`). Mirror the existing trip exemption block exactly (`:71-80,109-112`).
- **Cleanup:** `app/experience/coming-soon.tsx` becomes dead → delete or keep as fallback (investigation D-2). If kept, the gate's static-no-id allow covers it.

#### 3.B.4 — States (design §B.4): loading / error / not-found / draft (read-preview, Edit="Continue editing", no cancel CTA) / empty-tiers / empty-activity / populated / submitting(cancel). All mirror trip `[id]/index.tsx`.

#### 3.B.5 — Success criteria (Sub-B)

| # | Criterion | Surface | Layer |
|---|---|---|---|
| SC-B1-iOS / SC-B1-Android | Tapping an experience row in Hub navigates to `/experience/{id}` (live) or `/experience/{id}/edit` (draft) — no dead tap | Business iOS / Android | Component/route |
| SC-B2 | `routeForEventRow({event_type:'experience',status:'draft'})` returns `/experience/{id}/edit`; non-draft returns `/experience/{id}` | — | Unit |
| SC-B3-iOS / SC-B3-Android | The dashboard renders hero (status pill + date-model subline), the 7-tile action grid, KPI card, tier rows, activity, cancel CTA (live only) | Business iOS / Android | Component |
| SC-B4 | Each action tile routes to its spec'd destination (scanner/orders/orders?view=buyers/blasts/exp/b/edit) | Business iOS+Android | Route |
| SC-B5 | `formatExperienceDateSubline` renders one-time ("Sat 14 Jun · 7:00 PM"), recurring ("Every Friday · Next: …"), multi-date ("5 dates · Next: …"), ended ("Ended") | Business iOS+Android+Web | Unit |
| SC-B6 | strict-grep `i-proposed-tr2-route-by-event-type.mjs` passes with the new `/experience/{id}` pushes (allowlist extended); a hardcoded `/experience/{id}` outside the helper still FAILS the gate | CI | Gate |

#### 3.B.6 — Regression prevention: Constitution #1 dead-tap test on the Hub experience row; the extended strict-grep gate (SC-B6); a `routeForEventRow` unit test covering all experience branches.

---

### §3.C — SUB-C: PUBLIC BUYER DETAIL PAGE

**Designer pass: REQUIRED.** **Mirror:** `app/t/[brandSlug]/[tripSlug].tsx` + `usePublicTripBySlug.ts`. **Targets Buyer/anon Web (primary) + Business iOS/Android (share-open).**

#### 3.C.1 — New route/hooks/resolvers/components
- `app/exp/[brandSlug]/[experienceSlug].tsx` — anon-tolerant page (host `#0c0e12`, full-bleed cover, X-close + share `IconChrome` overlays, ScrollView of `ExperiencePreview` + `ExperienceCheckoutFlow`). Mirror `[tripSlug].tsx` skeleton (design §C.1).
- `src/hooks/usePublicExperienceBySlug.ts` + `usePublicExperienceById.ts` — React Query, query key in a new `experienceKeys.publicBySlug(brandSlug, slug)` / `publicById(id)` factory (mirror `tripKeys.publicBySlug`), `enabled` on non-null slug/id, `staleTime` 60s. **Anon-tolerant: no `useAuth`, no redirect** (mirror `usePublicTripBySlug.ts` header).
- `getPublicExperienceBySlug` / `getPublicExperienceById` in `src/services/publicEventsService.ts` — mirror the `usePublicTripBySlug` queryFn pattern (`:60-140`): (1) resolve brand by slug (anon-readable via brands public policy), (2) resolve the experience row by `(brand_id, slug, event_type='experience', status IN ('scheduled','live'), deleted_at IS NULL)`, (3) `Promise.all` fetch `event_dates` (all rows) + `ticket_types` (non-deleted) directly (anon-readable via published-only RLS). Return `{ experience, brand, dates, tickets }`. **Type guard:** these resolvers return `null` for any non-`experience` row (mirror how `getPublicEventBySlug` rejects trips — the audit test will assert this, see §3.C.4).
- `ExperiencePreview` component (mirror `TripPreview`) — cover hero, title, by-brand, venue, date-model block (§3.C.2), description/narrative, capacity/"spots" line.

**RLS note:** confirm `event_dates` + `ticket_types` rows are anon-SELECTable for published experiences via the existing published-only policies (trips already rely on this). If a policy is `event_type`-scoped to event/trip, it must be widened for experiences — implementor verifies and, if needed, adds a migration (with backend allowlist).

#### 3.C.2 — Date-model block (NET-NEW buyer presentation, REVISED per C3)
Render a `GlassCard variant="base"` "When" block under the title:
- **One-time** → single line, calendar icon + `formatSingleDateLine` → "Sat 14 Jun · 7:00–10:00 PM".
- **Recurring** → calendar icon + `formatRecurrenceLabel` ("Every Friday · 7:00 PM") + `text.tertiary` subline "Next: Fri 20 Jun". **Read-only.**
- **Multi-date** → header "Runs on these dates" + a **read-only** vertical list of future `event_dates` ("Sat 14 Jun · 7 PM"). **NOT selectable** (per §3.C3 — checkout is per-series; a selectable control with no cart effect would be a dead/misleading tap).

**Price line:** `From {currencySymbol}{lowest tier price}` (or "Free"). Uses `ticket_types` (real, post-Sub-A).

#### 3.C.3 — Occurrence selection: NONE (resolved by C3). The buyer does not pick an occurrence. `ExperienceCheckoutFlow` selects only tier(s). (Supersedes design flag C3 + design §C.3's selector.)

#### 3.C.4 — States (design §C.4): loading / error (Postgrest message extraction) / not-found-or-not-live / all-dates-past (ended banner + disabled checkout) / free / sold-out (disabled CTA) / populated. Mirror `[tripSlug].tsx`.

#### 3.C.5 — `ExperienceMiniCard` (already exists) — minor: prefer `formatExperienceDateSubline` over the raw `nextOccurrenceAt` for recurring/multi-date sublines. The `/exp/{brandSlug}/{slug}` link now resolves (route created).

#### 3.C.6 — Success criteria (Sub-C)

| # | Criterion | Surface | Layer |
|---|---|---|---|
| SC-C1-Web / SC-C1-iOS / SC-C1-Android | `/exp/{brandSlug}/{slug}` renders a published experience (cover, title, by-brand, venue, date-model block, price, checkout CTA) | Buyer Web / Business iOS / Android | Route/Component |
| SC-C2 | Tapping an experience card on `/b/{brandSlug}` navigates to `/exp/{brandSlug}/{slug}` — no longer a dead link (F-2 fixed) | Buyer Web | Route |
| SC-C3 | `getPublicExperienceBySlug`/`ById` return `null` for any non-`experience` row (event/trip rejected) | — | Service |
| SC-C4 | A draft (unpublished) experience resolves to "Experience not found" on `/exp/…` (anon) | Buyer Web | Service/RLS |
| SC-C5 | Multi-date block renders dates READ-ONLY (no selectable occurrence control); recurring renders recurrence label + next date | Buyer Web+iOS+Android | Component |
| SC-C6 | Page is anon-tolerant: no sign-in redirect, no `useAuth` call (anon buyer can view) | Buyer Web | Hook |

#### 3.C.7 — Regression prevention: extend `eventType.filter.audit.test.ts` with probes asserting `getPublicExperienceBySlug`/`ById` reject non-experience rows (mirror the existing `getPublicEventBySlug` trip-reject probes `:95-107`); a render test for the read-only multi-date block (no Pressable on date rows).

---

### §3.D — SUB-D: CHECKOUT ENTRY (LOCKED to ticket-checkout-create)

**Designer pass: light. NO new payment UI. COMMS-0014/0016 hard guard. `stripe-best-practices` invoked (§3.D5).** **Mirror:** `TripCheckoutFlow.tsx` + `app/checkout-trip/[tripEventId]/`. **Depends on Sub-A (sellable rows) + Sub-C (entry point).**

#### 3.D.1 — `ExperienceCheckoutFlow.tsx` (NEW)
Thin tier-picker (mirror `TripCheckoutFlow`), with the one difference: **multi-tier selection** (trip auto-selects its single tier; experiences let the buyer pick among tiers + quantity). Layout per design §D.1. Routes `router.push('/checkout-experience/${experience.id}')` with the chosen `ticketTypeId`(+qty) via the chain's param/store mechanism. **No occurrence param** (§3.C3). Copy per design §D.1 ("Get my spot" / "Get my free spot"; not-bookable "This experience isn't on sale yet.").

#### 3.D.2 — `/checkout-experience/[experienceEventId]/` chain (NEW)
Mirror `app/checkout-trip/[tripEventId]/` route group: `_layout` / `index` / `buyer` / `payment` / `confirm`. **NO `intake` step v1** (residual op-decision D2). The buyer→payment→confirm screens are reused wholesale — they POST `{ eventId: <experience events.id>, buyer, lines:[{ticketTypeId, quantity}], surface }` to `ticket-checkout-create`. **The payment UI is the shared ORCH-1025 all-in WYSIWYP PaymentSheet — DO NOT redesign.** Multi-tier cart = each selected tier a line with qty stepper; combined "Fees & tax" line per [[feedback_cart_combined_fees_tax_line]]. Confirm copy per design §D.2.

#### 3.D.3 — Money engine: ZERO change
`ticket-checkout-create` needs **no change** — the trip-gate (`event_type==='trip'`, `:298-299`) is correctly skipped for experiences; the future-date gate (`:258-275`) passes because Sub-A materialized `event_dates`; the session RPC looks up `ticket_types` by `(id, event_id)` which Sub-A materialized. The implementor MUST verify (not assume) these three branches by tracing the experience `eventId` through the edge fn once Sub-A is live. **If any change to the edge fn is found necessary, STOP and escalate — it would violate COMMS-0014/0016.**

#### 3.D.4 — Strict-grep + audit-test allowlist (HARD)
- `i-proposed-tr2-route-by-event-type.mjs`: the §3.B.3 extension already covers `/experience/…` route pushes; additionally allow `app/checkout-experience/[experienceEventId]/*` as a caller-exempt prefix if those files push `/experience/` or `/checkout-experience/` URLs (mirror the trip checkout-route handling).
- `eventType.filter.audit.test.ts`: add the `/checkout-experience/*` to whatever route-segregation assertions the trip checkout has, mirroring how `/checkout-trip/*` is covered.

#### 3.D.5 — Stripe verification (COMMS-0003 + [[stripe-skill-mandatory]])
`stripe-best-practices` skill invoked for this slice. **Result:** reusing the shared PaymentIntent + Connect path for a new offering type with the same `{eventId, lines:[{ticketTypeId, quantity}]}` contract is **best-practice-correct** — Stripe's guidance is "choose one charge type per integration; don't mix" ([Connect charge types](https://docs.stripe.com/connect/charges.md)). Reusing the exact path guarantees identical charge type, idempotency (keyed on the checkout session, already managed by the edge fn), webhook routing (`stripeWebhookRouter` is offering-agnostic; `mingla_event_id` metadata carries the experience id), and Connect account handling. **No new Stripe API surface, no new payload, no new webhook event types, no new idempotency concern.** No provider-docs param changes to cite because none are introduced. (PaymentIntent + Connect destination-charge + Stripe Tax `calculations.create` venue-basis all inherited verbatim from ORCH-1006/0955, previously docs-verified.)

#### 3.D.6 — Success criteria (Sub-D)

| # | Criterion | Surface | Layer |
|---|---|---|---|
| SC-D1-Web / SC-D1-iOS / SC-D1-Android | A buyer can complete an experience purchase end-to-end via `/checkout-experience/{id}` → shared PaymentSheet → confirm | Buyer Web / Business iOS / Android | Full stack |
| SC-D2 | The checkout POST body is `{eventId, buyer, lines:[{ticketTypeId, quantity}], surface}` with NO occurrence/`event_date_id` field | — | Edge contract |
| SC-D3 | Multi-tier cart: selecting tier A + tier B produces two lines; "Fees & tax" is ONE combined line | Buyer Web+iOS+Android | Component |
| SC-D4 | `ticket-checkout-create` + `biz_ticket_checkout_create_session` are byte-unchanged (git diff empty for those files) | CI | Gate |
| SC-D5 | The trip bookings-closed gate (`event_type==='trip'`) does NOT fire for an experience checkout | — | Edge |
| SC-D6 | strict-grep + `eventType.filter.audit.test.ts` pass with `/checkout-experience/*` allowlisted | CI | Gate |

#### 3.D.7 — Regression prevention: a test asserting the experience checkout POST shape carries no occurrence param; a CI guard / review-check that the two money-engine files are unchanged in this ORCH's diff (SC-D4); the extended audit test.

---

### §3.E — SUB-E: EDIT-AFTER-PUBLISH GUARDS

**Designer pass: light.** **Mirror:** `publishedTripEditGuards.ts` + `EditAfterPublishTripBanner.tsx` (+ `biz_update_live_trip` RPC). **Depends on Sub-A + Sub-B.**

#### 3.E.1 — New files
- `src/utils/publishedExperienceEditGuards.ts` — client-side UX fast-path mirroring the server RPC. Reject reasons (subset): `missing_edit_reason`/`invalid_edit_reason` (10–200 chars), `capacity_below_sold`, `dates_shifted_with_sales`, `tier_delete_with_sales`, `tier_price_change_with_sales`. (Drop trip-only `days_dropped`/`inclusions_removed`.)
- `src/components/experience/EditAfterPublishExperienceBanner.tsx` — orange `accent.tint` card, `flag` badge, copy per design §E.1.
- `EditPublishedExperienceScreen.tsx` (Sub-B host target for `scheduled|live`) — sectioned accordion (Identity / Venue / When / Tiers / Cover / Who-covers-costs-locked-after-first-sale) + Save dock + the banner + reason input. Mirror `EditPublishedScreen.tsx` (event) / `EditPublishedTripScreen`.
- **New RPC `biz_update_live_experience`** (mirror `biz_update_live_trip`) — server-enforced buyer-protection for live edits (reason required; reject on the conditions above). Migration + backend allowlist (COMMS-0002). **Date-change with sales:** mirror the event `business_patch_event_when` buyer-protection (`20260615000000_orch_0877`) — reject when changing/removing an occurrence that has orders. **Per §3.C3, capacity is per-series** so `capacity_below_sold` compares `ticket_types.quantity_total` vs total sold for that tier (not per-occurrence).

#### 3.E.2 — Success criteria (Sub-E)

| # | Criterion | Surface | Layer |
|---|---|---|---|
| SC-E1 | Editing a live experience requires a 10–200 char reason; empty/short → `missing_edit_reason`/`invalid_edit_reason` | Business iOS+Android | RPC/util |
| SC-E2 | Reducing a tier's capacity below sold → rejected `capacity_below_sold` (server) | — | RPC |
| SC-E3 | Deleting a tier / changing its price with sales → rejected with buyer-protection reason | — | RPC |
| SC-E4-iOS / SC-E4-Android | The edit-published screen shows the banner + reason input; rejections surface inline in Mingla voice | Business iOS / Android | Component |
| SC-E5 | Changing an occurrence date with orders is rejected (mirror event when-patch protection) | — | RPC |

#### 3.E.3 — Regression prevention: guard-util unit tests per reject reason; a server-RPC test asserting `capacity_below_sold` + `tier_delete_with_sales` fire with seeded orders.

---

### §3.F — SUB-F: ANALYTICS

**Designer pass: REQUIRED (orders vs buyers framing).** **Mirror:** `app/event/[id]/orders/` (the LIGHTER mirror — experiences have NO installment plans, so NOT trip `money/`). **Depends on Sub-A + Sub-D.**

#### 3.F.1 — New routes
- `app/experience/[id]/orders/index.tsx` — top segment toggle **Orders | Buyers**. Orders = the event orders ledger reused verbatim (filter pills All/Paid/Refunded/Cancelled + search + `OrderListCard` rows + `EmptyState`). Buyers = deduped attendee list (name, email, # spots, total paid; mirror event `guests/`), reached via `?view=buyers` from the dashboard "Buyers" tile.
- `app/experience/[id]/scanner` — mirror `app/event/[id]/scanner/` (QR check-in; offering-agnostic, experiences issue the same `ticket_types`-backed tickets). Generalize "event"→"experience" in the title bar only.
- **Revenue:** surfaced on the dashboard `ExperienceDetailKpiCard` (Sub-B) — total paid revenue (exclude failed/cancelled/refunded, mirror trip `revenueByCurrency`) + spots (sold/capacity). No separate revenue screen v1.
- **Hooks:** reuse `useEventOrders` (event orders are `events`-row-keyed → works for experiences) or add `useExperienceOrders` thin wrapper.

#### 3.F.2 — States (design §F.2): loading / empty-orders ("No orders yet" + "When someone books {title}…") / empty-buyers / populated / error / filter→empty. Mirror event empty states.

#### 3.F.3 — Success criteria (Sub-F)

| # | Criterion | Surface | Layer |
|---|---|---|---|
| SC-F1-iOS / SC-F1-Android | `/experience/{id}/orders` lists paid orders newest-first; empty → "No orders yet" | Business iOS / Android | Component |
| SC-F2 | The Orders\|Buyers segment toggle switches between the orders ledger and the deduped buyer list | Business iOS+Android | Component |
| SC-F3 | Dashboard KPI shows total paid revenue (excl. refunded/cancelled/failed) + sold/capacity | Business iOS+Android | Component |
| SC-F4-iOS / SC-F4-Android | `/experience/{id}/scanner` scans an experience ticket QR and checks it in (reused event scanner) | Business iOS / Android | Component |

#### 3.F.4 — Regression prevention: a render test for the empty-orders state; a test that the scanner accepts an experience-issued ticket QR (offering-agnostic).

---

## 4. UI-CONTRACT (granular visual contract — division of labor)

Per the SPEC granularity protocol, every UI surface in Sub-B/C/D/E/F has a pinned visual contract. **That contract is owned by `mingla-designer` and lives in `DESIGN_META-ORCH-1059_EXPERIENCES_LIFECYCLE.md`** — color tokens (all from `designSystem.ts`, dark-only with computed contrast in the design's Cross-Cutting Constants), typography, spacing/radius tokens, safe-area/edge rules, page width, motion + haptics, all 9 states with Mingla-voice copy, Android glass policy, no-AI-slop bans, and the "References examined" line (Partiful/Eventbrite/Airbnb Experiences/Resy/Cal.com). **This spec REQUIRES that design contract to govern every pixel; the implementor builds to it and does not invent visuals.** The functional contract + UX acceptance bar above is the forensics half; the granular visual half is the designer's.

**🔒 LOCKED (non-negotiable):** the data model (Sub-A materialization §3.A.1), the C3 per-series checkout contract (§3.C3, no occurrence param), COMMS-0014/0016 (no money-engine change), the 7-tile dashboard set (§3.B.2), publish-time-only materialization, AI→"Set up & publish" draft flow (§3.A.4), all design tokens + contrast + 9 states + Android glass + no-slop bans (design doc), the strict-grep + audit-test extensions (§3.B.3/§3.D.4), the backend-allowlist-in-same-commit rule.

**🎨 OPEN (implementor craft, within the locked floor):** the `formatExperienceDateSubline` exact string formatting micro-choices (within the design's example formats); the precise tier-card reorder micro-animation feel (within the existing system's easing band); the internal section ordering of `EditPublishedExperienceScreen`'s accordion (within the named sections); whether Hub-list enrichment uses a new RPC vs two extra client selects (§3.A.2); whether `coming-soon.tsx` is deleted or kept as a fallback; tasteful polish beyond the floor that doesn't change the contract.

---

## 5. INVARIANTS

**Preserved:**
- `I-PROPOSED-TR2-ROUTE-BY-EVENT-TYPE` — extended for experiences (§3.B.3/§3.D.4). Preserved by the strict-grep allowlist + the `routeForEventRow` experience branch.
- `I-...-EVENT-HAS-MASTER-DATE` (event_dates_master_unique) — preserved; the experience publish RPC writes ≤1 master per event for all three modes (§3.A.1).
- All-in-pricing single-engine (COMMS-0014/0016) — preserved by SC-D4 (money-engine files byte-unchanged).
- Constitution #1 (no dead taps) — F-2/F-3 are current violations; fixed by Sub-B/C and verified by SC-B1/SC-C2.
- Constitution #9 (no fabricated data) — the read-only multi-date block (§3.C2) avoids a misleading selectable control.

**New:**
- `I-PROPOSED-EXP-SELLABLE-ON-PUBLISH` (DRAFT → ACTIVE on Sub-A CLOSE): a published experience always carries ≥1 `ticket_types` + ≥1 master `event_dates` row. Verified by SC-A1/A2/A3/A5 + the migration self-verify test.
- `I-PROPOSED-EXP-CHECKOUT-PER-SERIES` (DRAFT → ACTIVE on Sub-D CLOSE): experience checkout carries no occurrence/`event_date_id` param; sells per-series exactly as events. Verified by SC-D2.

---

## 6. TEST CASES (representative; full matrices in each sub-track's SC + the implementor/tester split below)

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-A1 | Publish one-time | wizard single-mode payload | 1 master `event_dates` + N `ticket_types` | DB/RPC |
| T-A2 | Publish recurring | recurring payload (weekly, until +6mo) | 1 master row + `is_recurring=true` + `recurrence_rules` JSON; NOT N rows | DB/RPC |
| T-A3 | Publish multi-date | 5 dates | 5 `event_dates`, master on earliest | DB/RPC |
| T-A4 | Publish no date | empty when | raises `experience_date_required` | RPC |
| T-A5 | Sellability | published exp `eventId` → session RPC w/ valid line | reaches session, not `ticket_type_not_found`/`event_no_active_dates` | DB/edge |
| T-B1 | Hub tap (live) | tap live experience row | navigates `/experience/{id}` | Component |
| T-B2 | Hub tap (draft) | tap draft row | navigates `/experience/{id}/edit` | Component |
| T-C1 | Public page render | `/exp/{brand}/{slug}` for published exp | full page renders, price from lowest tier | Route |
| T-C2 | Type reject | `getPublicExperienceById(eventRowId)` | returns `null` | Service |
| T-D1 | Checkout E2E | select tier → buyer → pay | confirmed purchase via shared PaymentSheet | Full stack |
| T-D2 | No occurrence param | inspect checkout POST body | no `event_date_id` field | Edge contract |
| T-E1 | Live edit no reason | edit live exp, empty reason | `missing_edit_reason` | RPC |
| T-F1 | Orders empty | new published exp, 0 orders | "No orders yet" empty state | Component |

**Implementor happy-path regression test (per sub-track, REQUIRED):** the SC's primary happy path encoded as an automated test (e.g. T-A1 for Sub-A, T-B1 for Sub-B, T-C1 for Sub-C, T-D1 for Sub-D, T-E1 for Sub-E, T-F1 for Sub-F).

**Tester adversarial angle (distinct, per the Step-0.5 close gate):**
- Sub-A: publish a **recurring** experience and assert the DB has exactly ONE master row (NOT N) — the most likely implementor error is materializing recurring like multi-date. Also: publish with a tier priced 0 + `isFree=false` → must reject or coerce.
- Sub-B: tap a draft row and confirm it does NOT open the live dashboard read-preview by accident (routing must send drafts to `/edit`); confirm a hardcoded `/experience/{id}` added outside the helper still FAILS the strict-grep gate.
- Sub-C: load `/exp/…` for a DRAFT slug as anon → must be "not found", not a leaked preview; confirm the multi-date block has NO Pressable on date rows.
- Sub-D: confirm the two money-engine files are byte-unchanged; attempt a checkout body with an injected `event_date_id` → must be ignored (not honored), proving per-series. Confirm trip bookings-closed gate does not fire.
- Sub-E: seed orders, then attempt a tier-price change → must reject; attempt capacity below sold → reject.
- Sub-F: scan an experience ticket QR on the reused event scanner → must check in (offering-agnostic), not "wrong event type".

---

## 7. IMPLEMENTATION ORDER

1. **Sub-A** (DB RPC + migration + backend allowlist + adapter + wizard steps + AI draft flow + tests). Prerequisite — unblocks D, feeds B/C price.
2. **Sub-B ∥ Sub-C** (dashboard + Hub tap-through + routeForEventRow + strict-grep ‖ public page + hooks + resolvers). Independent file sets.
3. **Sub-D** (checkout flow + chain + audit-test allowlist + Stripe-verify). Needs A (sellable) + C (entry point).
4. **Sub-E ∥ Sub-F** (guards + banner + update RPC ‖ orders/buyers + scanner + KPI). Need orders to exist (A+D).

Each sub-track is a separate IMPLEMENT dispatch; B/C and E/F may run in parallel. Every UI sub-track (B/C/F primarily; A/D/E lightly) builds to the designer's visual contract (§4).

---

## 8. REGRESSION PREVENTION (program-level, encode at CLOSE)
- Extend `i-proposed-tr2-route-by-event-type.mjs` + `eventType.filter.audit.test.ts` for `/experience/[id]/*` + `/checkout-experience/*` (mirror trip allowlisting). [Sub-B + Sub-D]
- Migration self-verify: the experience-publish RPC writes ≥1 `ticket_types` + ≥1 master `event_dates` (fails-on-revert of F-1). [Sub-A]
- Deno test: experience `eventId` → `biz_ticket_checkout_create_session` reaches a session. [Sub-A]
- Money-engine byte-unchanged guard (SC-D4). [Sub-D]
- Constitution #1 dead-tap tests on Hub row + public brand experience card. [Sub-B/C]
- Backend allowlist (ORCH-0863 C7) updated in the SAME commit as each new migration/edge-fn dir (COMMS-0002). [Sub-A, Sub-E, any RLS migration in Sub-C]
- D-2 cleanup: `routeForEventRow` `coming-soon` branch + `app/experience/coming-soon.tsx` reaped or kept-as-fallback (note for CLOSE).

---

## 9. RESIDUAL OPERATOR DECISIONS (separate from the locked scope)

| ID | Decision | Recommendation |
|---|---|---|
| **A2** | Wizard segment labels: "One-time / Recurring / Multiple dates" vs event-parity "Single / Recurring / Multi-date" | "One-time / Recurring / Multiple dates" (buyer-warmer) |
| **A5** | AI review: drop "Accept all" (recommended) OR build "Save all as drafts" bulk variant | Drop "Accept all"; add "Save all as drafts" only if asked |
| **D2** | Experience checkout buyer-intake-form step (trips have one) | No intake step v1 |
| **Q5** | Admin-web moderation parity for experiences | Defer (register follow-up ORCH if wanted) |
| **Q6 / COMMS-0013** | Accept web-vs-native tax-basis divergence for experiences (same as events/trips today) | Accept |
| **Q-C3-FUTURE** | Per-occurrence selling (distinct inventory per date) — NEW money-model ORCH if ever wanted | Out of scope; not needed for v1 (matches events) |
| **A-HubEnrich** | Hub-list price/next-date enrichment via new `pg_brand_experiences_manage` RPC vs two client selects | Implementor picks lowest-blast-radius |

---

## /goal COMPLETION SELF-CHECK

1. **Functional contract complete for every touched layer** — DB (new publish RPC + update RPC + optional manage/RLS migrations, exact materialization rules), edge (agentTools draft change; ticket-checkout-create byte-unchanged), service/hook (publish service, public resolvers, hooks with query keys), component (wizard steps via adapter, dashboard, public page, checkout flow, guards, analytics), realtime (n/a). ✓
2. **Every UI surface's visual contract** — owned by the referenced `mingla-designer` DESIGN doc (tokens, contrast, 9 states, safe-area, page width, motion, copy); this spec requires and references it (§4). ✓
3. **No-AI-slop bans + "References examined"** — present in the DESIGN doc (referenced §4 + design §0/References). ✓
4. **Every requirement tagged 🔒 LOCKED / 🎨 OPEN** — §4 carries both; OPEN is present and generous. ✓
5. **Cross-Surface Impact** — §2, with per-surface SC (SC-N-iOS/Android/Web) where parity is manual. ✓
6. **Invariants (§5), test cases happy/error/edge (§6), implementation order (§7), regression prevention (§8).** ✓
7. **Zero hand-wave** — every change cites a file+line precedent or an exact RPC/route name; no "style nicely"/"handle errors properly". ✓
8. **C3 resolved FIRST with file+line proof (§3.C3) and Sub-A materialization designed to match it (§3.A.1).** ✓ (the dispatch's primary demand)
