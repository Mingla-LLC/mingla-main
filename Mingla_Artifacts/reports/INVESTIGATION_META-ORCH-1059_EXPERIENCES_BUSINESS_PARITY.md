# INVESTIGATION — META-ORCH-1059 [experiences-business-parity]

**ORCH:** META-ORCH-1059 [experiences-business-parity]
**Mode:** INVESTIGATE (build-map / contract; NOT a spec, NOT code)
**Skill:** mingla-forensics
**Date:** 2026-06-02
**Working tree:** `~/Desktop/mingla-orchs/meta-orch-1059-[experiences-business-parity]/` on branch `meta-orch-1059-experiences-business-parity`
**Confidence:** HIGH (code-only investigation; UI not yet reproducible — zero experiences exist in prod, see §Data. Backend/data-model claims are `proven` via DB probes + migration reads. UI dead-link claims are `proven` via source. Runtime sim repro deferred to SPEC/designer/tester per the build-map nature of this dispatch.)

**Comms-ledger acks:** Read `COMMS_LEDGER.md` on entry. Relevant: **COMMS-0014** + **COMMS-0016** (BLOCKING contract — experience checkout MUST route through the existing `ticket-checkout-create` edge fn / `biz_ticket_checkout_create_session` RPC to inherit the ORCH-1006 all-in engine; do NOT build a parallel experience-checkout fn) — both factored and proven in §5 below. **COMMS-0013** (web vs native tax basis divergence — applies to the experiences buyer-web surface identically; carried forward as Open Question Q6). No new cross-ORCH discovery requiring a new COMMS entry this turn.

---

## EXECUTIVE SUMMARY

Mingla Business lets brands author three offering kinds — Events, Trips, Experiences — all stored in **one `events` table** discriminated by `event_type` (`'event' | 'trip' | 'experience'`, CHECK-constrained; proven via DB probe). Events and Trips are at full lifecycle parity. **Experiences are creation-only**: a brand can build one (manual `ExperienceCreatorWizard` 5-step flow + AI menu/activities parsers), and it shows in the Hub list — but **every surface after creation is missing or dead-ends**. All 6 confirmed gaps are verified true. One gap (checkout) sits on top of a **deeper structural blocker** that the other gaps do not have.

**The 6 confirmed gaps (all verified):**

| # | Gap | Evidence | Mirror precedent to build like |
|---|-----|----------|-------------------------------|
| 1 | Public experience detail page `/exp/{brandSlug}/{experienceSlug}` does not exist | `app/exp/` directory absent; `ExperienceMiniCard.tsx:44-48` + `PublicBrandPage.tsx:211,230` push to it → dead link | `app/t/[brandSlug]/[tripSlug].tsx` (closest — slug-based on `events` table) + `app/e/[brandSlug]/[eventSlug].tsx` |
| 2 | Business detail/manage/edit screen `app/experience/[id]/` does not exist | `app/experience/` holds only `create.tsx` + `coming-soon.tsx`; no `[id]/` | `app/trip/[id]/` (5 routes — the lighter mirror) NOT `app/event/[id]/` (16 files — too heavy) |
| 3 | Hub list rows are dead taps | `(tabs)/hub/experiences.tsx:248-271` renders experiences as plain `<View>` cards with no `Pressable`/`router.push` | `(tabs)/hub/trips.tsx` row → `routeForEventRow()` → `/trip/{id}` |
| 4 | No checkout / purchase flow | `app/checkout/[eventId]/` rejects non-event rows; no experience entry point exists | `/checkout-trip/[tripEventId]/` chain + `TripCheckoutFlow.tsx` |
| 5 | No edit-after-publish guards | `publishedEventEditGuards.ts` + `publishedTripEditGuards.ts` exist; no experience analog | `publishedTripEditGuards.ts` + `EditAfterPublishTripBanner.tsx` |
| 6 | No analytics | events have orders/guests/blasts/reconciliation; trips have money/travelers; experiences have none | `app/trip/[id]/money/` + `app/trip/[id]/travelers/` |

**THE DEEPER BLOCKER (root cause, gates Sub-D checkout):** Both experience creation paths — the manual `ExperienceCreatorWizard.tsx:160-188` AND the AI `create_experience` tool `agentTools.ts:474-491` — insert the `events` row with `status='scheduled'/'live'` + `visibility='public'` but write **NO `ticket_types` rows and NO `event_dates` rows**. Pricing is stored as raw STRINGS inside `theme.experience_meta` (`tier_name`, `price_major`, `capacity`). The locked checkout path (`ticket-checkout-create` → `biz_ticket_checkout_create_session`) hard-requires (a) a future `event_dates` row (edge fn `index.ts:258-275` → 422 `event_no_active_dates`) and (b) a `ticket_types` row matching the cart line (session RPC, proven via DB probe → `RAISE EXCEPTION 'ticket_type_not_found'`). **Therefore the all-in engine cannot transact an experience as currently created.** The fix is NOT a parallel edge function (forbidden by COMMS-0014/0016) — it is to make experience creation write real `ticket_types` + `event_dates` rows (a "materialize pricing tiers + occurrence" step), after which experiences inherit the entire ORCH-1006 money path for free (the session RPC + pricing RPC are already `event_type`-agnostic; proven via DB probe — only trip-specific gating branches on `event_type='trip'`).

**Recommended decomposition:** 6 sub-tracks, Sub-A is the structural prerequisite that unblocks Sub-D and improves Sub-B/E. Sub-A → {Sub-B, Sub-C} parallel → Sub-D (needs A) → {Sub-E, Sub-F} parallel. Every UI sub-track needs a **mingla-designer** pass (flagged per track). Full detail in §7.

---

## INVESTIGATION MANIFEST (every file read, in trace order)

| # | File | Why read |
|---|------|----------|
| 1 | `COMMS_LEDGER.md` | mandatory entry; found COMMS-0014/0016/0013 |
| 2 | `mingla-business/app/{e,t,exp,event,trip,experience}/` (dir listings) | confirm route topology — which exist, which don't |
| 3 | `app/(tabs)/hub/experiences.tsx` | gap #3 — dead-tap list rows |
| 4 | `src/components/brand/ExperienceMiniCard.tsx` | gap #1 — dead `/exp/` link source |
| 5 | `supabase/migrations/20260729000000_meta_orch_0972_universal_authoring.sql` | authoritative experiences data model + `pg_public_experiences_by_brand` + `pg_brand_offering_counts` RPCs |
| 6 | `src/services/publicEventsService.ts` (symbols + guard lines 900-958) | experience card types + event-resolver `event_type` rejection |
| 7 | `app/e/[brandSlug]/[eventSlug].tsx` | gap #1 mirror — event public page |
| 8 | `app/t/[brandSlug]/[tripSlug].tsx` | gap #1 mirror — trip public page (closest; slug-based) |
| 9 | `src/components/trip/TripCheckoutFlow.tsx` | gap #4 — checkout routing precedent + audit-test note |
| 10 | `src/services/__tests__/eventType.filter.audit.test.ts` | proves event-resolver rejects non-event rows (incl. experience) |
| 11 | `app/checkout/[eventId]/index.tsx` | gap #4 — event checkout uses `usePublicEventById` (rejects experiences) |
| 12 | `supabase/functions/ticket-checkout-create/index.ts` (entry + lines 200-320, 430-556) | LOCKED money path — proves `event_dates` + `ticket_types` requirements |
| 13 | `src/services/experiencesService.ts` | hub-list fetch shape (no published filter) |
| 14 | `src/utils/routeForEventRow.ts` | canonical routing — experiences route to `coming-soon` stub |
| 15 | `app/event/[id]/index.tsx` (head) | gap #2 heavy mirror (16 files) |
| 16 | `app/trip/[id]/index.tsx` (head) | gap #2 light mirror (5 routes) — recommended template |
| 17 | `src/components/experience/ExperienceCreatorWizard.tsx` | **root-cause** — persist path writes no tickets/dates |
| 18 | `supabase/functions/_shared/agentTools.ts:351-503` | **root-cause** — AI `create_experience` also writes no tickets/dates |
| 19 | `src/hooks/usePendingExperiences.ts` | AI-parser confirm path |
| 20 | `src/utils/publishedEventEditGuards.ts` | gap #5 mirror |
| 21 | design `PHASE_2_DESIGN_META-ORCH-0972_USER_JOURNEYS.md` (Areas 5 & 6) | intended experiences design + Phase-3-deferred decisions |
| 22 | design `PHASE_2_DESIGN_META-ORCH-0972_COPY_INVENTORY.md` (experience rows) | locked experiences copy |
| 23 | DB probes (live, see §Data) | row counts, triggers, CHECK, RPC `event_type`-agnosticism |

---

## DATA-MODEL TRUTH (proven via DB probe + latest migration)

**Discriminator:** `events.event_type` CHECK `IN ('event','experience','trip')` (proven: `pg_get_constraintdef`). Trips use `'trip'`, experiences use `'experience'`, identically modeled.

**Experience row shape (what creation writes today):**
- `events` row: `event_type='experience'`, `title`, `slug`, `description`, `status` (`'draft'`|`'scheduled'`|`'live'`), `visibility` (`'draft'`|`'public'`), `published_at`, `currency`, ORCH-1006 switches (`pass_tax`, `pass_mingla_fee`, `pass_service_fee`).
- `theme.experience_meta` JSONB: `venue_text`, `next_occurrence_at` (ISO), `tier_name` (string), `price_major` (string), `capacity` (string), and AI variants (`intent_tags`, `capacity_min/max`, `suggested_time_of_day`, `suggested_price_*_cents`, `ai_metadata`).
- **NO `event_dates` row. NO `ticket_types` row.** (Proven: `ExperienceCreatorWizard.tsx:160-188` + `agentTools.ts:474-491` — both single `events` insert, no child writes.)

**Index already present:** `events_experience_next_occurrence_idx ON ((theme->'experience_meta'->>'next_occurrence_at')) WHERE event_type='experience' AND deleted_at IS NULL` (migration line 8-10).

**RPCs that already exist (no rebuild needed):**
- `pg_public_experiences_by_brand(p_brand_slug text)` — SECURITY DEFINER, anon+authenticated GRANT. Returns full card: `experience_id, brand_id, brand_slug, brand_name, experience_slug, title, description, cover_media_url, theme, venue_text, next_occurrence_at, price_from_cents, currency, is_free, published_at`. **Reads `ticket_types` for `price_from_cents`/`is_free` (lines 379-396)** — so with no `ticket_types` rows it returns `price_from_cents=NULL`, `is_free=true`. Filters `published_at IS NOT NULL`. (migration lines 344-412)
- `pg_brand_offering_counts(p_brand_id)` → `{events, trips, experiences}`, filters `published_at IS NOT NULL` (lines 12-33). Powers the data-driven Hub/public tab visibility.
- `pg_public_brand_upcoming(...)` — already interleaves experiences via `theme->...->>'next_occurrence_at'` (lines 414-511).

**Triggers (proven via `pg_trigger`):** `biz_enforce_event_has_master_date` fires **only on UPDATE status-transition into scheduled/live** (`OLD.status IS DISTINCT FROM NEW.status`). Experience creation INSERTs directly at `status='scheduled'`, **bypassing the trigger** — which is exactly why experiences persist today with no `event_dates`, in a state the checkout path cannot service.

**Production data:** `0` experiences exist (total/published/with-dates/with-tickets/with-next-occurrence all `0`; proven via probe). This is a **clean-slate build** — no data backfill needed, and no live experience to break.

---

## FINDINGS (classified, evidence-backed)

### 🔴 F-1 (ROOT CAUSE for Sub-D) — Experience creation writes no `ticket_types` / `event_dates`, so the locked checkout engine cannot transact it
- **File+line:** `ExperienceCreatorWizard.tsx:160-188` (manual) + `_shared/agentTools.ts:474-491` (AI). Single `events` insert in both; price → `theme.experience_meta.price_major` as a string.
- **Current behavior:** A "published" experience is `status='scheduled'/'live'`, `visibility='public'`, but has zero `ticket_types` and zero `event_dates`.
- **Correct behavior:** Creation must materialize ≥1 `ticket_types` row (price_cents from the tier) and ≥1 `event_dates` row (`is_master=true`, derived from `next_occurrence_at`), so the row matches the buyer-facing money contract — exactly as events/trips do.
- **Causal chain:** no `ticket_types` → session RPC `biz_ticket_checkout_create_session` raises `ticket_type_not_found` (proven via `pg_get_functiondef` substring: `SELECT * INTO v_ticket_type FROM ticket_types WHERE id=line.ticketTypeId AND event_id=p_event_id ... IF NOT FOUND THEN RAISE EXCEPTION 'ticket_type_not_found'`). Independently, no future `event_dates` → edge fn `ticket-checkout-create/index.ts:258-275` returns 422 `event_no_active_dates`. Either alone blocks checkout. Also: `pg_public_experiences_by_brand` shows `From £—`/`Free` because it reads the (empty) `ticket_types`.
- **Verification step:** Insert a test experience via the wizard, then call `biz_ticket_checkout_create_session(p_event_id := <that id>, …)` with a cart line — it raises `ticket_type_not_found`. (Not run live — zero-data env; mechanism proven from RPC source + edge-fn source.)

### 🔴 F-2 (ROOT CAUSE, Sub-A/B/C) — Public experience route `/exp/{brandSlug}/{experienceSlug}` does not exist; two live call sites dead-link to it
- **File+line:** `app/exp/` directory absent (proven). `ExperienceMiniCard.tsx:44-48` `router.push('/exp/${brandSlug}/${experienceSlug}')`; `PublicBrandPage.tsx:211` (`handleOpenExperience`) + `:230` (upcoming `offeringType==='experience'`) push the same.
- **Correct behavior:** Create `app/exp/[brandSlug]/[experienceSlug].tsx` mirroring `app/t/[brandSlug]/[tripSlug].tsx` (resolve via a new `usePublicExperienceBySlug` hook → render an `ExperiencePreview` + checkout CTA).
- **Causal chain:** buyer taps an experience card on the public brand page → `router.push('/exp/...')` → expo-router has no matching route → blank/404 (constitutional dead-tap).
- **Verification:** open `/b/{brandSlug}` for any brand with a published experience, tap the experience card → no screen.

### 🔴 F-3 (ROOT CAUSE, Sub-B) — Hub experience list rows are dead taps
- **File+line:** `(tabs)/hub/experiences.tsx:248-271` — `experiences.map(exp => <View><GlassCard>…</GlassCard></View>)`. No `Pressable`, no `onPress`, no `router.push`. (Contrast: the empty-state "Create experience" `<Button>` at :237 works.)
- **Correct behavior:** wrap each row in a `Pressable` → `routeForEventRow({event_type:'experience', status})` (see F-4) → `/experience/{id}` or `/experience/{id}/edit`.
- **Causal chain:** operator taps their own experience in the Hub list → nothing happens (Constitution #1 dead-tap).
- **Verification:** Hub > Experiences with ≥1 experience → tap a row → no navigation.

### 🟠 F-4 (CONTRIBUTING, Sub-B) — `routeForEventRow` sends experiences to the `coming-soon` stub
- **File+line:** `src/utils/routeForEventRow.ts:69-73` — `if (event_type==='experience') return '/experience/coming-soon'`. This is the canonical, strict-grep-enforced routing helper (no caller may hardcode `/experience/${id}`).
- **Correct behavior:** mirror the event/trip branch — `status==='draft' ? '/experience/${id}/edit' : '/experience/${id}'`. The `coming-soon.tsx` route can then be deleted (or kept as a fallback). NOTE: the strict-grep gate `i-proposed-tr2-route-by-event-type.mjs` bans hardcoded `/experience/${id}` outside this helper + `app/experience/[id]/*` — Sub-B must extend the allowlist exactly as events/trips did.

### 🟠 F-5 (CONTRIBUTING, Sub-D) — Event/Trip checkout chains structurally reject experiences
- **File+line:** `publicEventsService.ts:921-922` (`getPublicEventBySlug`) + `:943` (`getPublicEventById`) return `null` unless `event_type==='event'`. The event checkout `app/checkout/[eventId]/index.tsx:75` uses `usePublicEventById` → experiences resolve to `null` → "Event not found". The trip chain (`/checkout-trip/`) is itself type-segregated. Pinned by `eventType.filter.audit.test.ts:95-107`.
- **Implication:** experiences need their OWN buyer resolver (`getPublicExperienceBySlug`/`ById` + hooks) and their OWN thin checkout entry component — exactly the trip precedent (`TripCheckoutFlow` exists *specifically* so trip-entry copy can diverge while the underlying session RPC stays shared; see its header comment lines 1-20).

### 🔵 F-6 (OBSERVATION) — The money engine is already experience-ready below the entry layer
- **Proven via DB probe:** `biz_ticket_checkout_create_session` is `event_type`-agnostic (only `v_is_trip := event_type='trip'` for trip gating; experiences fall through the default branch identically to events). `resolve_event_pricing_inputs` does not mention `event_type` at all and resolves `venue_tax_address` for the all-in tax basis. `resolve_effective_take_rate_bps(p_brand_id)` is brand-keyed. The edge fn's only `event_type` branch is the trip bookings-closed gate (`index.ts:299`). **Conclusion: once F-1 is fixed (experiences carry real `ticket_types` + `event_dates`), an experience `eventId` flows through `ticket-checkout-create` end-to-end with zero money-engine changes** — satisfying COMMS-0014/0016 by construction. See §5 for the full flow proof.

### 🟡 F-7 (HIDDEN FLAW) — `getExperiencesByBrand` returns drafts + published with no status/published filter, but the public RPC requires `published_at`
- **File+line:** `experiencesService.ts:70-80` (hub list, no `published_at` filter) vs `pg_public_experiences_by_brand` (line 404, `published_at IS NOT NULL`). Acceptable for the owner Hub (it should show drafts), but Sub-B routing must branch on `status` so draft rows route to `/edit` not the live dashboard, and Sub-A must decide draft vs published `event_dates`/`ticket_types` materialization timing.

### 🔵 F-8 (OBSERVATION) — No `usePublicExperienceBySlug` / `usePublicExperienceById` hooks exist
- **Proven:** `find hooks -iname '*PublicExperience*'` returns nothing; `usePublicTripBySlug.ts` + `usePublicTripById.ts` exist. Sub-C/D must add the experience equivalents (mirror the trip hooks: React Query, query key in the `publicEvents`/new `publicExperiences` factory, `enabled` on non-null slug).

---

## FIVE-LAYER CROSS-CHECK

| Layer | Finding |
|-------|---------|
| **Docs** | Design `META-ORCH-0972` Areas 5 & 6 explicitly spec `/exp/{brandSlug}/{experienceSlug}` (Area 5 line 423) + `<ExperienceMiniCard>` + the 5-step creation wizard, and **defer to "Phase 3 spec"** (a) whether `next_occurrence_at` defaults or stays null (line 439) and (b) whether recurrence ships v1 (line 493). COPY inventory locks all experience strings. This ORCH **is** that deferred Phase-3-and-beyond build. |
| **Schema** | `event_type` CHECK includes `'experience'`; `pg_public_experiences_by_brand` + `pg_brand_offering_counts` exist; `event_dates`/`ticket_types` are the canonical money children; `biz_enforce_event_has_master_date` only fires on UPDATE-transition (so INSERT-published experiences skip it). |
| **Code** | Creation exists (wizard + AI tools + hub list). Everything downstream (public page, dashboard, checkout entry, edit guards, analytics) is absent. Two live call sites dead-link to `/exp/`. `routeForEventRow` stubs experiences to `coming-soon`. |
| **Runtime** | Not sim-reproducible this turn — zero experiences in prod (clean slate). Money-path mechanism proven from RPC/edge-fn source + DB probes (caps UI claims at code-proven; flagged for tester live-fire post-implement). |
| **Data** | `0` experiences; data uniformly clean; no backfill. **Contradiction surfaced:** an experience can be `status='scheduled' AND visibility='public'` with NO sellable children — a "published but unsellable" state that the money layer treats as not-found. This is the bug class F-1 fixes. |

**Layer disagreement = the bug:** Docs/Schema assume a published offering is sellable (has tickets + a date). Code (creation) produces published experiences that are NOT sellable. That divergence is the root of the checkout gap.

---

## §5 — CHECKOUT CONTRACT: how an experience `eventId` flows through the EXISTING engine (LOCKED — COMMS-0014/0016)

**Hard guard restated:** experience checkout MUST route through `supabase/functions/ticket-checkout-create/index.ts` (same `eventId` contract) → `biz_ticket_checkout_create_session` + `resolve_event_pricing_inputs` + `resolve_effective_take_rate_bps`. **Do NOT** create a parallel experience-checkout edge function. Proven viable by F-6.

**The flow (what Sub-D must wire, mirroring `TripCheckoutFlow`):**

```
Experience public page  app/exp/[brandSlug]/[experienceSlug].tsx
  └─ <ExperienceCheckoutFlow> (NEW; mirror TripCheckoutFlow.tsx)
       └─ router.push('/checkout-experience/{experienceEventId}')   ← own chain (event/trip chains reject by type, F-5)
            └─ buyer info → POST ticket-checkout-create
                 body: { eventId: <experience events.id>, buyer, lines:[{ticketTypeId, quantity}], surface }
                 │
                 ├─ edge fn validates future event_dates  ← REQUIRES F-1 (event_dates materialized)
                 ├─ edge fn trip-gate: event_type!=='trip' → skipped (correct for experiences)
                 ├─ resolve_event_pricing_inputs(eventId)  → venue tax address + ORCH-1006 switches (event_type-agnostic)
                 ├─ resolve_effective_take_rate_bps(brand_id) → configurable Mingla take-rate
                 ├─ biz_ticket_checkout_create_session(p_event_id=eventId, p_lines=…)
                 │     → looks up ticket_types by (id, event_id)  ← REQUIRES F-1 (ticket_types materialized)
                 │     → experiences fall through the non-trip default branch identically to events
                 └─ Stripe PaymentIntent on the Connect account → all-in WYSIWYP + pricing_breakdown receipt
```

**What experiences inherit for free** once F-1 lands: the 3 pass/absorb switches (already written by the wizard at `ExperienceCreatorWizard.tsx:174-176`), venue-based inclusive tax, configurable take-rate, lock-after-sale, the `pricing_breakdown` receipt. **Zero money-engine changes.**

**The ONLY two decisions Sub-D depends on (both belong to Sub-A):**
1. Materialize `ticket_types` from the tier (price_cents = `price_major`×100, capacity, currency) at create/publish time.
2. Materialize an `event_dates` master row from `next_occurrence_at` (an experience "occurrence" = a master event_date) so the future-date gate passes.

**External API note (Prime Directive 12):** No new Stripe API surface is introduced — experiences reuse the exact ORCH-1006 PaymentIntent path already verified against Stripe docs (per COMMS-0003/0013 + `IMPLEMENTATION_ORCH-1006_UNIVERSAL_ALLIN_PRICING_ENGINE.md`). The `stripe-best-practices` skill must still be invoked at SPEC for the Sub-D slice per `feedback_stripe_skill_mandatory.md`, but no payload changes are anticipated. **COMMS-0013 carries forward:** the buyer-web experience checkout will inherit the same web-vs-native tax-basis divergence trips/events have (web hosted-Checkout = buyer-address auto-tax; native = venue inclusive) — flagged as Q6.

---

## BLAST RADIUS

- **Surfaces:** Business iOS + Business Android (Hub, dashboard, edit, guards, analytics) + Buyer/anonymous Web (`/exp/{brandSlug}/{experienceSlug}`, `/b/{brandSlug}` experience cards, `/checkout-experience/...`). Consumer app (`app-mobile/`) is OUT (per design Area 5 line 447 — consumer app is brand-kind-agnostic, doesn't render public-brand routes today). Admin Web: experiences not surfaced; out unless operator wants moderation parity (Q5).
- **Shared code touched:** `routeForEventRow.ts` (F-4) is used by Home + Hub + deep-link handlers — changing the experience branch affects all experience taps app-wide (intended). `publicEventsService.ts` gains experience resolvers alongside the existing event/trip ones. The strict-grep gate `i-proposed-tr2-route-by-event-type.mjs` + the audit test `eventType.filter.audit.test.ts` must be extended for the new `/experience/[id]/*` + `/checkout-experience/*` routes (mirror how trips were allowlisted).
- **Backend allowlist (COMMS-0002):** any new migration / edge fn dir requires the ORCH-0863 C7 allowlist update in the same commit.
- **Invariants in play:** `I-PROPOSED-TR2-ROUTE-BY-EVENT-TYPE` (extend for experiences), constitutional #1 (no dead taps — F-2/F-3 are current violations), the all-in-pricing single-engine invariant (COMMS-0014/0016 — Sub-D must not fork it).

---

## §7 — RECOMMENDED SUB-TRACK DECOMPOSITION

Dependency order: **Sub-A first (unblocks D).** Then B + C in parallel. Then D (needs A). Then E + F in parallel.

### Sub-A — Creation parity: materialize sellable experiences (PREREQUISITE, backend-heavy)
- **Goal:** experience creation (both manual wizard + AI tool) writes real `ticket_types` + a master `event_dates` row, so a published experience is sellable and shows real price.
- **New:** a `biz_create_experience` (or extend an existing) SECURITY DEFINER RPC that atomically inserts the `events` row + `ticket_types` (from tier) + `event_dates` (from `next_occurrence_at`, `is_master=true`); migration; backend allowlist + strict-grep update; Deno test.
- **Modified:** `ExperienceCreatorWizard.tsx:160-188` (route through the RPC instead of raw insert) + `_shared/agentTools.ts:474-491` (same) + `pg_public_experiences_by_brand` consumers (now return real price).
- **Surfaces:** Business iOS/Android (creation) + buyer-web (price now renders). **Designer pass: light** (pricing step already designed; mainly confirms tier→ticket mapping copy).
- **Hard guards:** must NOT change the money engine; must keep `theme.experience_meta` for display fields; decide draft vs publish materialization (Q1).

### Sub-B — Business detail/manage/edit screen + Hub tap-through (fixes #2, #3, #4-edit, #6-routing)
- **Goal:** `app/experience/[id]/` dashboard (mirror `app/trip/[id]/index.tsx` — action tiles + KPI + tiers + activity + cancel) + `app/experience/[id]/edit.tsx`; Hub rows become live taps.
- **New:** `app/experience/[id]/index.tsx`, `app/experience/[id]/edit.tsx`; experience manage menu; experience KPI/detail components (reuse `ActionTile`, `EventDetailKpiCard`, `EventDetailTicketTypeRow`, `EventDetailActivityRow`).
- **Modified:** `routeForEventRow.ts:69-73` (F-4) + allowlist; `(tabs)/hub/experiences.tsx:248-271` (wrap rows in `Pressable`→`routeForEventRow`); delete/repoint `app/experience/coming-soon.tsx`.
- **Surfaces:** Business iOS/Android. **Designer pass: REQUIRED** (new dashboard IA — decide which trip tiles apply; experiences likely need fewer than trips).
- **Depends on:** Sub-A (real tiers to show KPIs).

### Sub-C — Public experience detail page (fixes #1)
- **Goal:** `app/exp/[brandSlug]/[experienceSlug].tsx` mirroring `app/t/[brandSlug]/[tripSlug].tsx` — X-close + share overlays, full-bleed cover, `ExperiencePreview` body, checkout CTA region.
- **New:** the route; `usePublicExperienceBySlug` + `usePublicExperienceById` hooks (mirror trip hooks); `getPublicExperienceBySlug`/`ById` in `publicEventsService.ts`; `ExperiencePreview` component.
- **Surfaces:** Buyer/anon Web (primary) + Business iOS/Android (share-link open). **Designer pass: REQUIRED** (the detail page layout — Area 5 specs the card, not the full detail page).
- **Parallel with:** Sub-B (independent files). Both light-depend on Sub-A for real price display.

### Sub-D — Checkout chain (fixes #4) — LOCKED to `ticket-checkout-create`
- **Goal:** `app/checkout-experience/[experienceEventId]/` chain (mirror `app/checkout-trip/`) + `ExperienceCheckoutFlow` entry (mirror `TripCheckoutFlow.tsx`). Routes the experience `eventId` through the existing edge fn (§5).
- **New:** the checkout route group (`index`/`buyer`/`payment`/`confirm`/`_layout`); `ExperienceCheckoutFlow.tsx`; strict-grep + audit-test allowlist for the new route.
- **Modified:** none in the money engine (forbidden). `ticket-checkout-create` may need ZERO change (verify the trip-gate `event_type==='trip'` branch is correctly skipped for experiences — it is, per source).
- **Surfaces:** Buyer/anon Web + Business iOS/Android. **Designer pass: light** (checkout chain UI already designed for events/trips; mainly entry copy).
- **Depends on:** Sub-A (HARD — no tickets/dates = no checkout) + Sub-C (entry point lives on the public page).
- **Hard guards:** COMMS-0014/0016 (no parallel fn); invoke `stripe-best-practices` at SPEC.

### Sub-E — Edit-after-publish guards (fixes #5)
- **Goal:** `publishedExperienceEditGuards.ts` + `EditAfterPublishExperienceBanner.tsx` mirroring the trip versions — reason-required + buyer-protection when an experience with sales changes price/occurrence.
- **New:** the guard util + banner + tests; possibly a `biz_update_live_experience` RPC (mirror `biz_update_live_trip`) if live-edits need server enforcement.
- **Surfaces:** Business iOS/Android. **Designer pass: light** (banner pattern exists).
- **Depends on:** Sub-A + Sub-B (edit screen exists).

### Sub-F — Analytics (fixes #6)
- **Goal:** experience equivalent of trip money/travelers — `app/experience/[id]/orders/` (or `money/`) + a buyers/attendees list. Reuse `useEventOrders`/`useTripOrders` pattern.
- **New:** the analytics route(s) + hook(s).
- **Surfaces:** Business iOS/Android. **Designer pass: REQUIRED for the empty/populated states** (decide orders vs guests framing for experiences).
- **Depends on:** Sub-A + Sub-D (orders only exist once checkout works).

**Parallelization:** A → (B ∥ C) → D → (E ∥ F). Sub-C can technically start before A (it's a render shell) but its price line needs A. Minimum critical path: A → C → D.

---

## OPEN QUESTIONS (operator decisions before/at SPEC)

- **Q1 (Sub-A):** Materialize `ticket_types`+`event_dates` at *publish* only, or also for *drafts*? (Drafts need tickets for edit-screen KPIs but must not be sellable — recommend publish-time materialization + draft preview-only.)
- **Q2 (Sub-A, design Area 5 line 439):** Does an experience REQUIRE `next_occurrence_at` (so it can have a master `event_date` + appear in Upcoming + be checkout-able), or can it be a true "evergreen" with no date? Evergreen breaks the `event_dates` future-gate — needs a policy (e.g., evergreen experiences are bookable but not in Upcoming, with a synthetic far-future master date, OR a checkout-path carve-out — the latter risks the COMMS-0014 guard).
- **Q3 (Sub-A, design Area 6 line 493):** Does recurrence (weekly/monthly) ship v1, or one-time-only first? (Wizard step 3 currently hardcodes "One-time only" disabled.)
- **Q4 (Sub-B):** Which event/trip dashboard tiles apply to experiences? (Events have scan/door/guests/blasts/reconciliation; trips have money/travelers. Experiences likely = orders + edit + public-page + share — operator to confirm scope.)
- **Q5 (blast radius):** Admin Web moderation parity for experiences in scope, or defer?
- **Q6 (Sub-D, COMMS-0013):** Accept the web-vs-native tax-basis divergence for experiences (same as events/trips today), or block buyer-web experience checkout until a unified web tax path exists?
- **Q7 (capacity):** Experience `capacity` is a single number in `theme`; map it to the `ticket_types.quantity_total` (single-tier) — confirm single-tier-only for v1 or multi-tier.

---

## REGRESSION PREVENTION (for the SPEC to encode)

- Extend `i-proposed-tr2-route-by-event-type.mjs` + `eventType.filter.audit.test.ts` for `/experience/[id]/*` + `/checkout-experience/*` (mirror the trip allowlisting) so experiences can't leak into event/trip screens and vice-versa.
- A migration self-verify probe asserting the new experience-create RPC writes ≥1 `ticket_types` + ≥1 master `event_dates` (fails-on-revert of F-1).
- A Deno test feeding an experience `eventId` through `biz_ticket_checkout_create_session` asserting it reaches a session (not `ticket_type_not_found`).
- Constitution #1 dead-tap test on the Hub experience row + public-brand experience card.

---

## DISCOVERIES FOR ORCHESTRATOR

- **D-1:** The published-but-unsellable experience state (F-1) is a latent data-integrity hazard independent of this ORCH — any experience created today is already in it. No prod impact (0 rows) but worth a note.
- **D-2:** `routeForEventRow` `coming-soon` stub (F-4) + `app/experience/coming-soon.tsx` become dead once Sub-B lands — flag for cleanup at CLOSE.
- **D-3:** COMMS-0014/0016 were addressed to a now-reaped `meta-orch-0980` and re-homed to META-ORCH-1009 Sub-F; this ORCH (META-ORCH-1059) is the actual full-parity owner — recommend a COMMS update or ack so the binding checkout constraint is formally attached here.

**Confidence:** HIGH on the structural map + checkout contract (DB-probe + source proven). MEDIUM on exact dashboard tile scope (Q4 — operator-dependent). Runtime/UI sim repro deferred to tester post-implement (zero-data env; build-map dispatch).
