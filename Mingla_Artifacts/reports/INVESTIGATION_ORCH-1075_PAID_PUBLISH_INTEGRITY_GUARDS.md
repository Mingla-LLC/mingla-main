# INVESTIGATION — ORCH-1075 [Paid-publish integrity guards]

- **Mode:** mingla-forensics INVESTIGATE (investigation only; no fixes, no scope expansion)
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1075-[paid-publish-integrity-guards]/` on branch `ORCH-1075-paid-publish-integrity-guards`
- **Date:** 2026-06-04
- **Dispatched by:** orchestrator (operator-reported 2026-06-04 after Lantern & Vine 409 at experience checkout)
- **Confidence:** **root cause PROVEN** (six-field; DB state confirmed by read-only probe; canonical predicate read line-by-line; all latest RPC definitions confirmed via migration-chain grep→sort→read-latest; Stripe field semantics verified against docs). Backend/SQL investigation — Prime Directive 7 sim-repro exemption applies (pure backend RPC + edge-function gap).

---

## Symptom Summary

| | |
|---|---|
| **Expected** | A brand whose Stripe Connect onboarding never finished (`charges_enabled=false`) should be **unable to publish a PAID offering it cannot actually sell.** Likewise a paid offering whose date is already past should not be publishable/sellable. |
| **Actual** | The brand publishes the paid offering successfully. The money fail-close fires only at the **buyer's checkout** (`ticket-checkout-create` → HTTP 409 `stripe_account_not_ready`). The buyer hits a dead end on a listing that should never have gone live. |
| **Reproducer (operator, 2026-06-04)** | Booking an experience from brand **Lantern & Vine** (`53aaea42-0e7d-4b2a-92db-c220d78a352c`) returned 409 `stripe_account_not_ready`. Brand has `stripe_connect_id=acct_1Tdu4cPjlZvMV1oP` but `charges_enabled=false` / `payouts_enabled=false`. |
| **Class** | Missing server-side **publish-time** integrity guard (the correct fail-close exists, but at the wrong layer — checkout-time, not publish-time). |

---

## Five-Layer Cross-Check

| Layer | Finding |
|---|---|
| **Docs** | Stripe: `charges_enabled` = "Whether the account can process charges"; accounts where onboarding/requirements are incomplete have it `false` and "should be directed to an onboarding flow to finish submitting account details." (https://docs.stripe.com/api/accounts/object, https://docs.stripe.com/connect/onboarding.md). Mingla memory: experiences route through the SAME `ticket-checkout-create` money path (COMMS-0014/0016). |
| **Schema** | `stripe_connect_accounts.charges_enabled` (boolean, authoritative, webhook-written) + `brands.stripe_charges_enabled` (boolean, **trigger-synced cache mirror**). `event_dates(start_at,end_at,is_master)` is the canonical date model for all three kinds; a master row is REQUIRED at publish (trigger `trg_events_enforce_master_date`). "Paid" = a `ticket_types` row with `available_online=true` and `price_cents>0`. |
| **Code** | The checkout session RPC enforces readiness; **none** of the publish/edit RPCs do. Verified by reading the latest definition of each. |
| **Runtime** | Checkout RPC raises `stripe_account_not_ready` → edge fn returns 409. Publish RPCs return success with no readiness/date check. |
| **Data** | Probe (read-only, 2026-06-04): Lantern & Vine `brands.stripe_charges_enabled=false`, `stripe_connect_accounts.charges_enabled=false`, `detached_at=NULL`, `stripe_connect_id` present. The two columns AGREE (trigger keeps them in sync). |

No layer disagrees about the *desired* behavior; the gap is that the **publish layer never implements it**. That IS the bug.

---

## Goal 1 — The Canonical Readiness Predicate (the thing the guards must mirror)

The 409 lives in the edge function, but the **decision** is made one layer deeper, in the checkout-session RPC.

**Edge function** — `supabase/functions/ticket-checkout-create/index.ts:543-548`:
```ts
const stripeAccountId = typeof session.stripeAccountId === "string"
  ? session.stripeAccountId
  : null;
if (!stripeAccountId) {
  return jsonResponse({ error: "stripe_account_not_ready" }, 409);
}
```
> NOTE: the dispatch said "~line 607"; the actual 409 string is at **line 547**. The edge fn only re-surfaces a null `stripeAccountId` that the RPC already gated. The authoritative `RAISE EXCEPTION 'stripe_account_not_ready'` (line 451-456 maps the RPC error to a 409) happens in the RPC.

**The RPC predicate** — `public.biz_ticket_checkout_create_session`. Latest definition (migration-chain grep→sort→read-latest confirms this is current): `supabase/migrations/20260727000000_orch_0955_native_stripe_tax.sql`.

Readiness columns are sourced at **lines 176-184**:
```sql
SELECT e.id, e.brand_id, e.visibility, e.status, e.deleted_at, e.event_type,
       s.stripe_account_id, s.charges_enabled
  INTO v_event
  FROM public.events e
  LEFT JOIN public.stripe_connect_accounts s
    ON s.brand_id = e.brand_id
   AND s.detached_at IS NULL
 WHERE e.id = p_event_id
 FOR SHARE OF e;
```

The predicate itself — **line 380-382**:
```sql
IF v_total > 0 AND (v_event.stripe_account_id IS NULL OR v_event.charges_enabled IS DISTINCT FROM true) THEN
  RAISE EXCEPTION 'stripe_account_not_ready';
END IF;
```

**Pinned canonical predicate (what the publish guards must mirror):**
> An offering is sellable for money iff `v_total > 0` AND it has an **attached** `stripe_connect_accounts` row (`detached_at IS NULL`) with a non-null `stripe_account_id` AND `charges_enabled = true`.

- **Authoritative column:** `stripe_connect_accounts.charges_enabled` (NOT `brands.stripe_charges_enabled`, though the dispatch named the latter — see Goal 5 sync note: they cannot drift). `payouts_enabled` is **NOT** part of the predicate; only `charges_enabled` gates selling.
- **Supplied by:** the single `LEFT JOIN public.stripe_connect_accounts ... detached_at IS NULL` inside the session RPC — there is no separate readiness RPC.

---

## Goal 2 — Every Publish + Edit-to-Paid Entry Point That Lacks the Guard

For each RPC below I confirmed it is the **latest** definition (grep-all → sort by timestamp → read newest) and grepped its full body for `charges_enabled` / `stripe_account` / `stripe_charges` / `payouts_enabled` / `< now()` / past-date — **all returned ZERO hits.** Every one loads the brand row with `SELECT id, slug, name, default_currency` only (no Stripe columns).

### Experiences

| RPC | Latest migration | Client call site (`mingla-business/`) | Guards Stripe? | Guards past date? |
|---|---|---|---|---|
| `biz_create_experience` (`p_publish`) | `supabase/migrations/20260829000000_meta_orch_1059_draft_roundtrip_cover_neverends.sql:51` | `src/components/experience/ExperienceCreatorWizard.tsx:405` (`p_publish:false` draft mint) | **No** | **No** |
| `biz_publish_experience` (`p_publish`) | `supabase/migrations/20260829000000_…neverends.sql:554` | `ExperienceCreatorWizard.tsx:477` (`p_publish:publish`) | **No** | **No** |
| `biz_update_live_experience` (edit-to-paid) | `supabase/migrations/20260906000000_orch_1069_live_edit_persists_experience_intents.sql:22` | `ExperienceCreatorWizard.tsx:575`; guards in `src/utils/publishedExperienceEditGuards.ts` | **No** | **No** |

`biz_publish_experience` validates auth, title, description (10-500), intents, currency, modes, stop count (2-5), stop addresses, and price (`v_resolved_total<=0` → `experience_price_invalid` when not free) — lines 625-793. It writes `event_dates` (lines 458-494) and a `ticket_types` row (line 422, `available_online`) AT PUBLISH. No readiness/expiry check.

`biz_update_live_experience` recomputes `v_resolved_total` (free→paid / paid→paid) and writes `events.price_cents` + ticket `price_cents` (lines 237-491). A free→paid edit on a Stripe-unready brand is **not** blocked.

### Events

| RPC | Latest migration | Client call site | Guards Stripe? | Guards past date? |
|---|---|---|---|---|
| `business_publish_event_draft` | `supabase/migrations/20260604000001_orch_0824_publish_rpc.sql:28` (confirmed latest — 5 prior defs all superseded) | `src/services/businessEvents.ts:677` | **No** | **No** |

Validates auth, `status='draft'`, permission rank, currency, title, tickets, price (`v_price<0` → invalid). Writes `event_dates` (lines 281-330) + `ticket_types` (line 406, `available_online`). No readiness/expiry check. Edit-published-event path routes through `business_patch_event_when` / `updateLiveEventFields` (event edit family) — same gap class (no Stripe/expiry gate); the `business_patch_event_when` call is at `businessEvents.ts:947`.

### Trips

| RPC | Latest migration | Client call site | Guards Stripe? | Guards past date? |
|---|---|---|---|---|
| `business_publish_trip_draft` | `supabase/migrations/20260725000002_orch_0950_expanded_scope_dashboard_coherence.sql:748` (confirmed latest) | `src/services/tripsService.ts:1080` | **No** | **No** |
| `biz_update_live_trip` (edit-live-trip) | `supabase/migrations/20260725000002_…coherence.sql:232` (confirmed latest) | `src/services/tripsService.ts:1222` | **No** | **No** |

`business_publish_trip_draft` validates title, destination, capacity, dates (`trip_dates_required`, and `v_end <= v_start` → `trip_end_before_start` at line 874), days, pricing tier. It checks **end-before-start but NOT start-in-past.** Writes `event_dates` (section 10, ~line 938). No Stripe readiness gate.

**Summary: 7 unguarded entry points** (3 experience, 2 event-family, 2 trip) — none check Stripe readiness, none check past-date (one trip checks only end>start).

---

## Goal 3 — The "Paid Offering" Definition

**Definition (proven):** an offering is PAID iff, post-publish, it has a `ticket_types` row with `available_online = true` and `price_cents > 0`. This is exactly what the checkout reads.

Evidence in the checkout session RPC (`20260727000000_orch_0955`):
- Tickets are skipped unless sellable: `IF v_ticket_type.is_hidden OR v_ticket_type.is_disabled OR NOT v_ticket_type.available_online THEN RAISE EXCEPTION 'ticket_type_unavailable';` (line 215).
- The paid/free fork is purely `v_total` = `SUM(ticket_types.price_cents * qty)` (line 262); `v_total > 0` is the "paid" gate (lines 379-380); `v_total = 0` is the free path.

**Data exists at publish time, inside the RPC, BEFORE the guard would need it:**
- Experience publish computes `v_resolved_total` (line 785) then writes the ticket with `available_online` + `price_cents` (lines 422-427). Free vs paid is `v_is_free` / `v_resolved_total`.
- Event publish computes `v_price` (line 154/398) and writes the ticket (line 406-420).
- Trip publish writes pricing tier + ticket likewise.

**Implication for SPEC:** the guard can run **inline inside each existing publish RPC** — the resolved price and the `available_online` intent are both in local scope at publish. No new "is-this-paid" predicate or new RPC is required; the guard reads the brand's `charges_enabled` (one extra column on the already-present brand SELECT, or a join to `stripe_connect_accounts`) and the locally-computed price. **The locked scope is implementable in-place.**

---

## Goal 4 — The Date / Expiry Model

**Canonical date store for all three kinds = `public.event_dates`** (`start_at`, `end_at`, `timezone`, `is_master`). All three publish RPCs **materialise `event_dates` at publish** (event: `20260604000001`:281-330; experience: `20260829000000`:458-494; trip: `20260725000002` section 10). A master `event_dates` row is mandatory — `trg_events_enforce_master_date` blocks status→`scheduled`/`live` without one (INVARIANT I-PUBLISH-WRITES-EVENT-DATES, `INVARIANT_REGISTRY.md:825-827`). Post-publish reads MUST source from `event_dates` / `master_*` view columns (I-EVENT-TIMING-FROM-EVENT-DATES, `:835`).

**The existing "ended" notion (what the guard should reuse):** the deck-supply RPC `pg_eligible_experiences_for_deck` (latest = `supabase/migrations/20260907000000_orch_1070_deck_experiences_strict_intent.sql`) expresses expired/ended as the **absence of any future-active date**:
```sql
-- future master/active date (mirrors i-discover-excludes-ended-master-date):
AND EXISTS (
  SELECT 1 FROM public.event_dates ed
  WHERE ed.event_id = e.id
    AND ed.end_at > p_now
)
```
(lines 78-83; same `end_at > p_now` test at lines 38, 46). The named invariant is `i-discover-excludes-ended-master-date`.

**Canonical "expired" for the publish guard:** an offering is expired when **no `event_dates` row has `end_at > now()`** (equivalently, at single-date publish, the computed master `v_end <= now()`). Per kind:
- **Event/Experience:** single master date (+ optional multi-date / recurrence rows); `v_start`/`v_end` are computed in-RPC just before the `event_dates` INSERT.
- **Trip:** a date range; `v_start`/`v_end` from `startAt`/`endAt`. The trip RPC already validates `v_end <= v_start` (end-before-start) but NOT `v_start < now()`.

**Data caveat (probe, read-only 2026-06-04):** `event_dates` is sparsely populated for existing rows — events 15/17, experiences 1/5, trips 3/42 have any `event_dates` row. This is because `event_dates` is **publish-only** (drafts have none) plus legacy unpublished/legacy rows. It does NOT undermine the guard: at the moment a publish RPC runs, it computes the dates itself and inserts them, so the past-date check uses the in-scope `v_start`/`v_end`, not a pre-existing read. The sparsity only means a guard must not assume a pre-existing `event_dates` row for DRAFT-state offerings.

---

## Goal 5 — Blast Radius & Invariants

**Authoritative-column / sync clarification (important for SPEC):**
- `stripe_connect_accounts.charges_enabled` is written by the Stripe `account.updated` webhook handler — `supabase/functions/_shared/stripeWebhookRouter.ts:224` (`charges_enabled: account.charges_enabled === true`).
- A DB trigger mirrors it to the brand cache: `tg_sync_brand_stripe_cache()` on `stripe_connect_accounts` sets `brands.stripe_charges_enabled = NEW.charges_enabled` — `supabase/migrations/20260508000000_b2a_stripe_connect_onboarding.sql:101-126` (`CREATE TRIGGER trg_sync_brand_stripe_cache`).
- **Consequence:** the two columns cannot drift in normal operation; probe confirms both `false` for Lantern & Vine. The guard may read either; reading `stripe_connect_accounts.charges_enabled` (with `detached_at IS NULL`) is byte-for-byte the checkout predicate, while `brands.stripe_charges_enabled` is one column on the already-loaded brand SELECT. SPEC decides; both are correct. (Dispatch named `brands.stripe_charges_enabled`; that is the synced cache, not the source — note for SPEC.)

**Established rejection-shape precedent (for actionable reasons):** `biz_update_live_experience` already returns structured rejections like `RETURN jsonb_build_object('ok', false, 'reason', 'price_change_with_sales', ...)` (`20260906000000`:267-272). The event-edit family uses `{ok:false, reason:'missing_edit_reason'/'invalid_edit_reason'}` (INVARIANT_REGISTRY:1791). The publish RPCs by contrast `RAISE EXCEPTION` (e.g. `experience_price_invalid`). SPEC must choose one shape per RPC consistent with its existing contract so the new rejection (`stripe_charges_disabled` / `offering_date_past` or similar) is surfaced gracefully client-side.

**Strict-grep gates touching these RPCs (must not be broken; some assert RPC body content):**
- `.github/scripts/strict-grep/orch-0792-publish-writes-event-dates.mjs` — asserts the **latest** publish RPC body contains `INSERT INTO public.event_dates`. Any guard added must be inserted without removing that.
- `.github/scripts/strict-grep/orch-0824-event-category-frozen.mjs`
- `.github/scripts/strict-grep/orch-0783-event-cover-image-provider-pivot.mjs`
- `.github/scripts/strict-grep/i-proposed-tr5-schema-valid-at-write.mjs`
- `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` (the C7 `no-new-backend-files` gate from COMMS-0002).

**COMMS-0002 backend-allowlist requirement (HARD, for the SPEC/IMPLEMENT phases — not this INVESTIGATE):** any new/changed `supabase/functions/**` or `supabase/migrations/**` file must be added to a `*_BACKEND_ALLOWLIST` array in `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` (or the per-ORCH gate) **in the SAME commit** as the backend change, or the C7 gate fails the PR. Model: ORCH-1064/1066 added `ORCH_xxxx_BACKEND_ALLOWLIST` with the migration. ORCH-1075 will need an `ORCH_1075_BACKEND_ALLOWLIST` listing the new migration(s).

**COMMS-0003 (external-API docs inline, HARD):** any SPEC introducing/relying on Stripe fields must cite Stripe docs URLs inline. This report does (Goal 1, below). Carry forward to SPEC.

**Cross-ORCH coordination — the publish side is INDEPENDENT of the money engine (confirmed):**
- ORCH-1006's all-in pricing engine owns the **money path** via `ticket-checkout-create` + `resolve_event_pricing_inputs`; experiences route through that same edge fn (COMMS-0014/0016, confirmed: `mingla-business/src/services/publicExperienceService.ts` + `ExperienceCheckoutFlow.tsx` + `nativeCheckoutFlow.native.ts` reference `ticket-checkout-create`).
- The **publish** RPCs (`business_publish_event_draft`, `business_publish_trip_draft`, `biz_publish_experience`, the three edit RPCs) do **not** touch the pricing engine, `resolve_event_pricing_inputs`, or `ticket-checkout-create`. ORCH-1075 adds guards entirely on the publish side; **zero overlap** with ORCH-1006's money path. No COMMS coordination entry required beyond awareness.

**Recurring-pattern note:** this is the same class as ORCH-0877's buyer-protection (a server-side RPC guard that returns `{ok:false, reason}`) and the I-PUBLISH-WRITES-EVENT-DATES trigger gate — moving an integrity check to the correct (earliest) layer. Established Mingla pattern; no novel risk.

---

## Goal 6 — Cross-Surface Impact (Phase 2.5 preview for SPEC)

| Surface | In ORCH-1075 scope? | What changes |
|---|---|---|
| **Backend (RPCs)** | YES | Add publish-time guards to the 7 RPCs: reject paid publish/edit-to-paid when brand `charges_enabled=false`; reject paid publish/sell when offering date is past. Mirror the checkout predicate. New rejection reason(s) + (likely) new migration + allowlist. |
| **Business iOS** | YES | The wizard / edit screens (`ExperienceCreatorWizard.tsx`, event publish via `businessEvents.ts`, trip publish/edit via `tripsService.ts` + `EditPublishedTripScreen.tsx`) must catch the new rejection and surface an **actionable** message (route to finish Stripe Connect onboarding for the Stripe case; "date is in the past" for the expiry case) rather than a raw RPC error. |
| **Business Android** | YES | Same code paths (shared `mingla-business` RN) — parity automatic, but the rejection-handling UI must be verified on both. |
| **Consumer iOS / Android** (`app-mobile/`) | NO — no publish flow on consumer; buyer-side checkout 409 stays as the last line of defense. No client change. |
| **Buyer/anonymous Web** | NO — no publish flow; existing `ticket-checkout-create` 409 unchanged (intentional last line of defense). |
| **Admin Web** (`mingla-admin/`) | NO — no publish flow. |
| **Business Web preview** | Inherits the business-app changes; adjacent. |

---

## Causal Chain (six-field root cause)

- **File + line:** Absence is the defect. Present-but-insufficient layer: `supabase/migrations/20260727000000_orch_0955_native_stripe_tax.sql:380-382` (the readiness predicate lives ONLY here). Missing-guard sites: `20260829000000_…neverends.sql:554` (`biz_publish_experience`), `:51` (`biz_create_experience`), `20260906000000_orch_1069…:22` (`biz_update_live_experience`), `20260604000001_orch_0824_publish_rpc.sql:28` (`business_publish_event_draft`), `20260725000002_…coherence.sql:748` (`business_publish_trip_draft`), `:232` (`biz_update_live_trip`).
- **Exact code:** publish RPCs load the brand as `SELECT id, slug, name, default_currency` (e.g. experience publish `:651-655`) — Stripe columns are never read; no `end_at > now()` / `v_start < now()` test exists in any publish RPC.
- **What it does:** publishes/edits-to-paid an offering regardless of whether the brand can charge or whether the date is past.
- **What it should do:** when the resolved offering is paid (`price_cents > 0`, `available_online`), reject publish/edit-to-paid if the brand's `charges_enabled` is not true, with an actionable onboarding reason; and reject if the offering's date is already past.
- **Causal chain:** brand finishes onboarding partially → `stripe_connect_accounts.charges_enabled=false` (Stripe: requirements outstanding) → brand publishes a paid experience (publish RPC has no readiness gate) → listing goes live → buyer taps Book → `ticket-checkout-create` → session RPC `:380` `RAISE 'stripe_account_not_ready'` → edge fn `:547` returns 409 → buyer dead-ends.
- **Verification step:** read-only probe (run 2026-06-04) confirms Lantern & Vine `charges_enabled=false` on both columns with `detached_at=NULL`; grep of every latest publish RPC body for `charges_enabled|stripe_account|< now()` returns zero hits; the checkout predicate at `:380` is the only enforcement. Re-running the probe after a SPEC'd guard lands should show the publish RPC rejecting before the buyer ever sees the listing.

---

## Fix Strategy (DIRECTION ONLY — not a spec)

Locked scope is implementable in-place: add a publish-time guard inside each of the 7 RPCs (and/or a shared `plpgsql` helper) that, when the resolved offering is paid, (a) checks the brand's `charges_enabled` (mirror the checkout predicate — read `stripe_connect_accounts.charges_enabled WHERE detached_at IS NULL`, or the synced `brands.stripe_charges_enabled` cache) and rejects with an actionable Stripe-onboarding reason, and (b) checks the in-scope master `v_end`/`v_start` against `now()` and rejects past dates. Choose the rejection shape per-RPC to match its existing contract (`RAISE EXCEPTION` vs `{ok:false,reason}`). Business-app catch sites map the new reason to actionable copy + a route to Stripe onboarding. SPEC owns the exact predicate, reason strings, per-RPC shape, copy, and per-surface success criteria.

## Regression Prevention (direction)

A strict-grep gate asserting each latest paid-publish RPC body contains the readiness + past-date guard (mirroring `orch-0792-publish-writes-event-dates.mjs`); Deno/pgTAP tests asserting paid publish is rejected when `charges_enabled=false` and when the date is past, and that FREE offerings + Stripe-ready future-dated paid offerings still publish.

## Discoveries for Orchestrator

1. **Dispatch column-name correction:** the canonical readiness column is `stripe_connect_accounts.charges_enabled` (webhook-written), not `brands.stripe_charges_enabled` (which is a trigger-synced cache via `tg_sync_brand_stripe_cache`). They cannot drift; SPEC should pick deliberately. (Not a defect — clarification.)
2. **Dispatch line-number correction:** the 409 is at `ticket-checkout-create/index.ts:547`, and the authoritative `RAISE` is in the RPC at `20260727000000_orch_0955:380`, not "~line 607".
3. **`event_dates` sparsity** (events 15/17, experiences 1/5, trips 3/42) is expected (publish-only writes) but worth noting so a SPEC'd guard does not assume a pre-existing `event_dates` row for drafts — it must use the in-RPC computed `v_start`/`v_end`.
4. **Trip publish already half-guards dates** (`v_end <= v_start` → `trip_end_before_start`) but not past-start; the new past-date guard slots next to it.

## Open Questions for SPEC

- **Q1 — readiness column:** read `stripe_connect_accounts.charges_enabled` (exact checkout mirror, requires a join) or the synced `brands.stripe_charges_enabled` cache (one extra column on the existing brand SELECT)? Recommend mirroring the checkout source to keep a single source of truth.
- **Q2 — rejection shape per RPC:** `RAISE EXCEPTION 'stripe_charges_disabled'` / `'offering_date_past'` (matches publish RPCs' current style) vs structured `{ok:false,reason}` (matches the edit RPCs). Likely split by RPC family.
- **Q3 — edit-to-paid scope:** does the guard fire on ANY paid live-edit when `charges_enabled=false`, or only on a free→paid transition? (Lantern & Vine could have published paid while ready, then lost `charges_enabled` — should a later paid edit be blocked? Recommend: block any paid publish/edit-to-paid while not ready.)
- **Q4 — recurring/multi-date offerings:** "past" = no future-active `event_dates` row (`end_at > now()`), matching the deck `i-discover-excludes-ended-master-date` semantics — confirm this is the intended notion for multi-date/recurring, not just the master date.
- **Q5 — past-date guard scope:** does the expiry guard apply to FREE offerings too (the operator rule #2 says "paid offering whose date is past"), or paid-only like guard #1? Dispatch scopes it to paid; confirm.
