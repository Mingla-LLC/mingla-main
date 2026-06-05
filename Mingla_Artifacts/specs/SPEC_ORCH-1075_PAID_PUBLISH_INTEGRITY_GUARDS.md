# SPEC — ORCH-1075 [Paid-publish integrity guards]

- **Mode:** mingla-forensics SPEC (contract only; no production code in this file)
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1075-[paid-publish-integrity-guards]/` on branch `ORCH-1075-paid-publish-integrity-guards`
- **Date:** 2026-06-04
- **Authoritative input:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1075_PAID_PUBLISH_INTEGRITY_GUARDS.md` (committed `55c7de9d4`). All RPC names, migration citations, the canonical predicate, the paid definition, the date model, and the 5 open questions come from there and are **not re-derived**.
- **Dispatch:** orchestrator, operator-reported 2026-06-04 (Lantern & Vine 409 at experience checkout).
- **Stripe-skill:** `stripe-best-practices` consulted; `charges_enabled` semantics confirmed against Stripe docs (cited inline, COMMS-0003).

---

## 0. Layman summary

Today a brand that never finished Stripe onboarding (`charges_enabled = false`) can still hit **Publish** on a paid event/experience/trip. The listing goes live, a buyer taps **Book**, and only THEN does the money path slam the door with a 409 — a dead end on a listing that should never have existed. Same story for a paid offering whose date is already in the past. This SPEC moves the fail-close **earlier**: server-side guards inside the publish/edit RPCs reject the paid publish (or paid live-edit) before the listing ever goes live, with an actionable reason the business app turns into "Finish Stripe setup" / "Pick a future date." Free offerings are untouched. The buyer-side 409 stays as the last line of defense.

---

## 1. Scope and Non-Goals

### In scope (operator-locked — do NOT expand)
- **Server-side publish-time guards on PAID offerings only.** "Paid" = the offering, post-publish, has a `ticket_types` row with `available_online = true` AND `price_cents > 0` (Investigation Goal 3).
- **Guard A — Stripe readiness:** reject paid publish OR paid live-edit when the brand's Stripe `charges_enabled = false` (or no attached connect account).
- **Guard B — past-date:** reject publishing/selling a PAID offering whose date is already past.
- The **7 RPCs** named in the investigation (Goal 2), across event / experience / trip.
- **Business iOS + Android** catch-site copy + a route to finish Stripe Connect onboarding for each new rejection reason.
- **Regression:** one strict-grep gate asserting each paid-publish RPC body carries both guards (modeled on `orch-0792`); Deno/pgTAP-style SQL tests.

### Non-goals (explicit)
- **No consumer/buyer-web client change.** The existing `ticket-checkout-create` 409 `stripe_account_not_ready` stays as the last line of defense (Investigation Goal 6).
- **No change to the money engine** (`ticket-checkout-create`, `resolve_event_pricing_inputs`, `allInPricingEngine.ts`). Publish side is independent — zero overlap with ORCH-1006 (Investigation Goal 5; no COMMS coordination entry required).
- **FREE offerings are unaffected by BOTH guards.** A free offering with `charges_enabled=false` still publishes; a free past-dated offering is out of scope (Open Question Q5 resolved below: paid-only).
- **No new readiness RPC, no new "is-paid" predicate.** Guards run inline in each existing RPC using values already in local scope (Investigation Goal 3).
- **No change to `trg_events_enforce_master_date`** or the `event_dates` write blocks (must be preserved — Investigation Goal 5).
- **`payouts_enabled` is NOT part of the predicate.** Only `charges_enabled` gates selling (Investigation Goal 1).

### Assumptions (proven in investigation, restated)
- The canonical checkout predicate lives at `supabase/migrations/20260727000000_orch_0955_native_stripe_tax.sql:380-382` and sources readiness from `stripe_connect_accounts` via `LEFT JOIN ... s.detached_at IS NULL` (lines 176-184).
- `stripe_connect_accounts.charges_enabled` (webhook-written) and `brands.stripe_charges_enabled` (trigger-synced cache via `tg_sync_brand_stripe_cache`) cannot drift in normal operation; the source is the connect-account column.
- At publish time each RPC computes its own `v_start`/`v_end` (event/experience) or `v_start`/`v_end` range (trip) and its own resolved price (`v_price` / `v_resolved_total`) — both are in local scope before the guard runs (Investigation Goal 4).
- Stripe is currently TEST mode end-to-end. **The guard logic is mode-agnostic** — it reads `charges_enabled`, which Stripe sets identically in test and live; no mode branching is introduced (operator constraint).

---

## 2. Locked Decisions (the 5 open questions, resolved)

| # | Question | Locked decision | Rationale |
|---|---|---|---|
| **Q1** | Readiness column | **🔒 Read the SOURCE: `stripe_connect_accounts.charges_enabled WHERE brand_id = <brand> AND detached_at IS NULL`** — byte-for-byte the checkout predicate. The `brands.stripe_charges_enabled` cache is an acceptable fallback ONLY where a join is materially awkward in a given RPC; prefer the source. | Single source of truth identical to checkout → publish-gate and checkout-gate can never disagree. The cache is trigger-synced but is a derived mirror, not the authority (Investigation Goal 1 + Goal 5 sync note; operator default). |
| **Q2** | Rejection shape per RPC | **🔒 Match each RPC's existing contract.** Publish RPCs (`RAISE EXCEPTION 'reason'` style) → `RAISE EXCEPTION`. Edit RPCs (`RETURN jsonb_build_object('ok',false,'reason',…)` style) → structured return. Mapping table in §3.5. | Narrowest correct answer consistent with each RPC's existing client contract; clients already catch both shapes. |
| **Q3** | Edit-to-paid scope | **🔒 Block ANY paid publish OR paid live-edit while `charges_enabled=false`** — not only free→paid transitions. | Buyer-facing harm is identical regardless of how the offering became paid (operator default). A brand that published paid while ready, then lost `charges_enabled`, must not be able to re-save the paid offering live. |
| **Q4** | Recurring/multi-date "expired" notion | **🔒 "Past" = NO `event_dates` row with `end_at > now()`** — mirrors the deck `i-discover-excludes-ended-master-date` semantics (Investigation Goal 4). For single-date, equivalent to computed master `v_end <= now()`. For trip, `v_end <= now()` on the range. | Reuses the established "ended" notion already shipped in `pg_eligible_experiences_for_deck`; correct for multi-date/recurring (an offering with ANY future date is still sellable). |
| **Q5** | Does expiry apply to FREE? | **🔒 PAID-only.** Both guards apply to PAID offerings only; FREE offerings are out of scope per the locked rule. | Operator scope locks expiry to "paid offering whose date is past." Narrowest correct answer. |

### Per-RPC scope refinement (narrowest-correct, derived from investigation + this SPEC's code reading)

The investigation counts **7 unguarded entry points**. Reading each RPC's actual mutation surface tightens which guard applies where:

| RPC | Guard A (Stripe) | Guard B (past-date) | Notes |
|---|---|---|---|
| `biz_create_experience` (`p_publish=true`) | ✅ | ✅ | Draft mint (`p_publish=false`) is exempt — see §3.1 NB. |
| `biz_publish_experience` (`p_publish=true`) | ✅ | ✅ | Primary experience publish. |
| `biz_update_live_experience` | ✅ | ✅ | Edit-to-paid + date-shift to past both gated. Structured return. |
| `business_publish_event_draft` | ✅ | ✅ | Primary event publish. |
| `business_publish_trip_draft` | ✅ | ✅ | Adds past-start next to existing `trip_end_before_start`. |
| `biz_update_live_trip` | ✅ | ✅ | Edit-to-paid + date-shift to past. Structured return. |
| `business_patch_event_when` (event-edit family) | ❌ N/A | ✅ | **Reading confirms** this RPC patches WHEN (dates) only; it does NOT write `price_cents`/`available_online`. There is no event live-price-edit RPC (`patchPublishedEventPricingSwitches` writes only `pass_*` cost-allocation switches, not price). So an event cannot transition free↔paid after publish → **Guard A is N/A for events post-publish.** But editing dates CAN push an already-PAID event to a past date → **Guard B applies** (only when the event is currently paid). |

> **This is the "narrowest correct answer consistent with each RPC's existing contract" the dispatch requires.** Guard A on `business_patch_event_when` would be dead code (no paid transition possible there); Guard B on it is live (date shift to past on a paid event). Both guards still appear in all 6 publish/edit-of-money RPCs.

---

## 3. Layer-by-Layer Change Contract

### 3.0 Shared helper (DB) — `pg_brand_can_charge(p_brand_id uuid) → boolean`

🔒 **LOCKED.** Introduce ONE `STABLE` `SECURITY DEFINER`-free (or invoker, matching siblings) plpgsql helper so all six RPCs mirror the exact checkout predicate without copy-paste drift:

```sql
-- ORCH-1075 — canonical Stripe-readiness predicate, mirrors the checkout-session
-- RPC at 20260727000000_orch_0955_native_stripe_tax.sql:380-382.
-- Stripe `charges_enabled` = "Whether the account can process charges."
--   https://docs.stripe.com/api/accounts/object
-- Accounts with outstanding requirements have charges_enabled=false and must
-- finish onboarding:  https://docs.stripe.com/connect/onboarding.md
CREATE OR REPLACE FUNCTION public.pg_brand_can_charge(p_brand_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.stripe_connect_accounts s
     WHERE s.brand_id = p_brand_id
       AND s.detached_at IS NULL
       AND s.stripe_account_id IS NOT NULL
       AND s.charges_enabled IS DISTINCT FROM false  -- true only
  );
$$;
```

- **Contract:** returns `true` iff an attached connect account exists with a non-null `stripe_account_id` AND `charges_enabled = true`. Mirrors checkout exactly (`v_event.stripe_account_id IS NULL OR v_event.charges_enabled IS DISTINCT FROM true` → false).
- **Why a helper:** the regression gate (§5) can assert each RPC body calls `pg_brand_can_charge(` — one grep marker, no SQL-fragment matching. Also kills drift across 6 call sites.
- 🎨 **OPEN:** implementor may inline the predicate instead of a helper IF the strict-grep gate is updated to match the inlined fragment in every RPC; the helper is strongly preferred and is the default. If inlining, each RPC must still read `stripe_connect_accounts ... detached_at IS NULL`, never the `brands` cache.

### 3.1 `biz_create_experience` + `biz_publish_experience`

**Latest definition:** `supabase/migrations/20260829000000_meta_orch_1059_draft_roundtrip_cover_neverends.sql` (`biz_create_experience` at `:51`, `biz_publish_experience` at `:554`). Both share the same shape: brand SELECT at `:130` (`SELECT id, slug, name, default_currency`), `v_resolved_total` resolved at `:263`, ticket written at `:427` (`available_online`, `price_cents = v_resolved_total`), `event_dates` written inside `IF p_publish` at `:458`/`:494` with computed `v_start`/`v_end`.

🔒 **LOCKED — Guard placement:** Add a guard block inside the `IF p_publish THEN` branch, AFTER `v_resolved_total` is finalized and the master `v_start`/`v_end` are computed, but BEFORE the `events` row flips to `scheduled`/`public` (currently `:343-345`). Because dates are computed inside the date loop (`:442+`) which currently runs AFTER the `events` INSERT, the implementor MUST compute the paid-flag and the earliest-future-date check using the in-scope `v_when`/`v_resolved_total` values; the cleanest placement is a dedicated validation block immediately after `v_resolved_total` is set (`:263`) and after the date strings are parsed, guarded by `IF p_publish AND NOT v_is_free AND v_resolved_total > 0 THEN`.

```sql
-- ORCH-1075 paid-publish integrity guards (experience publish path)
IF p_publish AND v_pricing_mode = 'whole' AND NOT v_is_free AND v_resolved_total > 0 THEN
  -- Guard A: Stripe readiness (mirror checkout predicate)
  IF NOT public.pg_brand_can_charge(v_brand.id) THEN
    RAISE EXCEPTION 'stripe_charges_disabled';
  END IF;
  -- Guard B: no future-active date  (master v_end already computed for single;
  -- for multi/recurring use the MAX(end_at) about to be inserted)
  IF v_max_end IS NULL OR v_max_end <= v_now THEN
    RAISE EXCEPTION 'offering_date_past';
  END IF;
END IF;
```

- **NB (draft exemption):** `biz_create_experience` with `p_publish=false` mints a DRAFT — neither guard fires (drafts are not sellable and have no `event_dates`). Both guards are inside `IF p_publish`.
- **`v_max_end`:** 🔒 the implementor computes the maximum `end_at` across the single/multi/recurring dates that will be inserted (the offering is past iff its latest occurrence has already ended — Q4 semantics). For single-date this equals the master `v_end`. The date parsing already loops these (`:442-495`); compute `v_max_end := GREATEST(v_max_end, v_end)` inside that loop OR pre-scan the `v_when` payload. 🎨 OPEN: exact computation strategy (pre-scan vs accumulate-in-loop) is implementor's choice as long as it equals MAX(end_at over inserted rows).
- **Rejection shape:** `RAISE EXCEPTION` (matches this RPC's existing `experience_price_invalid` etc.).

### 3.2 `biz_update_live_experience`

**Latest definition:** `supabase/migrations/20260906000000_orch_1069_live_edit_persists_experience_intents.sql:22`. Brand SELECT at `:148-152`; `v_resolved_total` at `:237`; existing structured rejections `price_change_with_sales` (`:267-272`), `capacity_below_sold` (`:253`), `stop_removed_with_sales` (`:296`), `dates_shifted_with_sales` (`:385`); writes `price_cents = v_resolved_total` (`:487`); writes `event_dates` (date block `:313+`).

🔒 **LOCKED — Guard placement:** after `v_resolved_total` is computed (`:237`) and after the new dates are parsed, before the `events`/`ticket_types` UPDATE. Both guards use the **structured return** shape (matches this RPC):

```sql
-- ORCH-1075 — block paid live-edit while not Stripe-ready (Q3: ANY paid edit)
IF NOT v_is_free AND v_resolved_total > 0 THEN
  IF NOT public.pg_brand_can_charge(v_brand.id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'stripe_charges_disabled');
  END IF;
  IF v_max_end IS NULL OR v_max_end <= v_now THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'offering_date_past');
  END IF;
END IF;
```

- **Q3 applied:** fires on ANY resulting paid state (free→paid, paid→paid), not only transitions.
- **`v_max_end`:** MAX(end_at) across the edited date set (same Q4 rule).

### 3.3 `business_publish_event_draft`

**Latest definition:** `supabase/migrations/20260604000001_orch_0824_publish_rpc.sql:28` (confirmed latest — 5 prior superseded; `orch-0792` gate watches this same file). Brand SELECT `:109`; `v_price` `:154`; ticket write `:406` (`available_online`); `event_dates` write `:295` (single, master) / `:303+` (multi); computed `v_start`/`v_end` `:290-291`.

🔒 **LOCKED — Guard placement:** after `v_price` is resolved (`:154-167`) and after the date parsing/`event_dates` computation, before the `events.status` flip. `RAISE EXCEPTION` shape (matches `event_currency_unsupported` etc.). The guard must NOT remove or move the `INSERT INTO public.event_dates` blocks (the `orch-0792` gate asserts the file still contains `INSERT INTO public.event_dates`).

```sql
-- ORCH-1075 paid-publish integrity guards (event publish path)
IF v_price > 0 THEN
  IF NOT public.pg_brand_can_charge(v_brand.id) THEN
    RAISE EXCEPTION 'stripe_charges_disabled';
  END IF;
  IF v_max_end IS NULL OR v_max_end <= v_now THEN
    RAISE EXCEPTION 'offering_date_past';
  END IF;
END IF;
```

- **Paid test:** `v_price > 0` (the ticket about to be written has `available_online=true` for online events; for in-person-only events `available_online` is false and the offering is not online-sellable — the implementor MUST gate on the SAME `available_online` flag the ticket write uses, i.e. paid = `v_price > 0 AND <ticket available_online = true>`, to match the checkout "paid" definition exactly). 🔒 If the event ticket is `available_online=false`, Guard A does NOT fire (not online-sellable → no checkout 409 risk). Mirror whatever boolean the ticket INSERT uses for `available_online`.
- **`v_now`:** use the RPC's existing `now()`/`v_now` reference (the file already computes timestamps via `AT TIME ZONE`).

### 3.4 `business_publish_trip_draft` + `biz_update_live_trip`

**Latest definition:** `supabase/migrations/20260725000002_orch_0950_expanded_scope_dashboard_coherence.sql` (`biz_update_live_trip` `:232`, `business_publish_trip_draft` `:748`). Trip publish computes a single range `v_start`/`v_end` from `startAt`/`endAt` (`:865-878`) and already validates `v_end <= v_start` → `trip_end_before_start` (Investigation Goal 4); brand SELECT `:834`; writes `event_dates` (section 10, ~`:938`). `biz_update_live_trip` uses the structured `{ok:false,reason}` shape throughout (`:285`, `:298`, `:307`, …).

🔒 **LOCKED — `business_publish_trip_draft` (publish):** `RAISE EXCEPTION` shape, placed next to the existing `trip_end_before_start` check, after pricing tier resolution:

```sql
-- ORCH-1075 paid-publish integrity guards (trip publish path)
IF v_trip_price_cents > 0 THEN          -- paid trip (resolved pricing tier)
  IF NOT public.pg_brand_can_charge(v_brand.id) THEN
    RAISE EXCEPTION 'stripe_charges_disabled';
  END IF;
  IF v_end <= v_now THEN                 -- trip already ended (Q4: range end past)
    RAISE EXCEPTION 'offering_date_past';
  END IF;
END IF;
```

🔒 **LOCKED — `biz_update_live_trip` (edit):** structured return shape (matches RPC):

```sql
IF v_trip_price_cents > 0 THEN
  IF NOT public.pg_brand_can_charge(v_brand.id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'stripe_charges_disabled');
  END IF;
  IF v_end <= v_now THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'offering_date_past');
  END IF;
END IF;
```

- **Paid test for trips:** the resolved trip pricing-tier `price_cents > 0` (trip "paid" maps to the same `ticket_types.price_cents>0 AND available_online=true` post-publish — trip publish writes exactly one ticket row from the pricing tier per ORCH-0950). 🔒 The implementor uses the same resolved-price variable the trip ticket write already uses; do not introduce a parallel paid notion.
- **`v_now`:** the trip RPCs already reference `now()` for timestamps; reuse it.

### 3.5 `business_patch_event_when` (event-edit family — Guard B only)

**Latest definition:** `supabase/migrations/20260820000000_schedule_change_buyer_protection_refund_all.sql`. Uses `RAISE EXCEPTION` shape (e.g. `when_mode_drops_active_date` `:129`, `multi_date_remove_with_sales` `:160`, `event_end_must_differ_from_start` `:220`); computes new `v_start`/`v_end` per the patched WHEN.

🔒 **LOCKED — Guard B only (no Guard A — see §2 refinement):** after the new dates are computed, only when the event is currently PAID, reject if the new latest date is past:

```sql
-- ORCH-1075 — block shifting a PAID event onto an already-past date.
-- (No Stripe guard here: business_patch_event_when never changes price/availability.)
IF v_event_is_paid_online                       -- ticket_types: available_online AND price_cents>0
   AND (v_max_end IS NULL OR v_max_end <= v_now) THEN
  RAISE EXCEPTION 'offering_date_past';
END IF;
```

- 🔒 `v_event_is_paid_online`: derive via a scalar subquery against the event's `ticket_types` (`EXISTS (SELECT 1 FROM ticket_types t WHERE t.event_id = <id> AND t.available_online AND t.price_cents > 0)`). This RPC does not currently load price; the implementor adds this read.
- `v_max_end`: MAX(end_at) across the patched date set (Q4 — multi-date event with any future date is NOT past).
- 🎨 **OPEN:** if reading the codebase shows `business_patch_event_when` already cannot reach a past date for any reason (e.g. an existing `event_date_required` future check), the implementor may document that and make this guard a defense-in-depth assertion. It MUST still appear in the body for the strict-grep gate.

### 3.6 Edge functions

🔵 **No edge-function change.** Guards live entirely in DB RPCs. `ticket-checkout-create` is unchanged (its 409 stays as last-line defense). No `supabase/functions/**` file is modified → the COMMS-0002 allowlist requirement applies ONLY to the new migration(s) (§7).

### 3.7 Business-app catch sites (iOS + Android — shared RN, parity automatic in code, manual in QA)

The new reason strings must surface as actionable copy with a route to finish Stripe Connect onboarding (Guard A) or to fix the date (Guard B). Catch sites by RPC:

| RPC | Call site (`mingla-business/`) | Existing catch pattern to extend |
|---|---|---|
| `biz_create_experience` / `biz_publish_experience` / `biz_update_live_experience` | `src/components/experience/ExperienceCreatorWizard.tsx:405 / :477 / :575`; guard utils `src/utils/publishedExperienceEditGuards.ts` | Wizard already maps RPC errors → user copy; add the two reasons. |
| `business_publish_event_draft` | `src/services/businessEvents.ts:677` (+ its UI caller) | Event publish error mapping. |
| `business_patch_event_when` | `src/services/businessEvents.ts:947` | Already surfaces `multi_date_remove_with_sales` etc. — add `offering_date_past`. |
| `business_publish_trip_draft` / `biz_update_live_trip` | `src/services/tripsService.ts:1080 / :1222`; `EditPublishedTripScreen.tsx` | Trip publish/edit error mapping. |

🔒 **LOCKED — reason→copy mapping (exact strings the client catches):**

| Reason string (from RPC) | Title | Body copy (Mingla voice) | Primary action |
|---|---|---|---|
| `stripe_charges_disabled` | "Finish your payment setup" | "You can't publish a paid listing until your Stripe payouts are switched on. It takes a couple of minutes." | **Finish Stripe setup** → route to the brand's Stripe Connect onboarding screen (the existing `/connect-*` / account-management entry the business app already uses for onboarding). |
| `offering_date_past` | "Pick a future date" | "This date has already passed. Choose a date that's still ahead so people can book it." | **Edit date** → focus/scroll to the WHEN step of the wizard (or the date field in the edit screen). |

- 🔒 Both reasons map regardless of shape: for `RAISE EXCEPTION` RPCs the client reads `error.message`; for structured-return RPCs the client reads `data.reason`. The catch logic MUST handle BOTH (the wizard already does for experiences/trips).
- 🔒 The Stripe action MUST route to the brand's actual onboarding entry point (the same one the brand uses to reach `charges_enabled=true`). The implementor confirms the existing route name from the business app's Stripe-onboarding flow (do not invent a new screen).
- 🎨 **OPEN:** exact toast vs inline-banner vs modal presentation, animation, and haptic are the implementor's craft within Mingla's existing error-surface patterns — but the copy strings above are LOCKED and the route MUST exist (not a dead button).

---

## 4. Cross-Surface Impact Declaration (Phase 2.5)

| Surface | Covered? | Behaviour / files / parity |
|---|---|---|
| **1. Consumer iOS** (`app-mobile/`) | **NO** | No publish flow on consumer. Buyer-side checkout 409 unchanged. Reason: consumer never publishes. |
| **2. Consumer Android** | **NO** | Same — no publish flow. |
| **3. Buyer/anonymous Web** (`mingla-business` checkout routes) | **NO** | No publish flow; `ticket-checkout-create` 409 stays as last-line defense (intentional). |
| **4. Business iOS** (`mingla-business/`) | **YES** | Catch the two new reasons → actionable copy + route to Stripe onboarding / date fix. Files: §3.7. **SC-4-iOS** (per-surface gate). |
| **5. Business Android** | **YES** | Shared RN code → parity automatic; **but QA must verify on both** (manual gate). **SC-4-Android.** |
| **6. Admin Web** (`mingla-admin/`) | **NO** | No publish flow. Reason: admin doesn't render the brand publish wizard. |
| **7. Business Web preview** | Adjacent | Inherits business-app changes; rejection handling should also render in the web build. **SC-4-Web** (secondary). |

**Backend (RPCs + migration)** — the substance of the change — is surface-agnostic and covered by SC-1…SC-8 below. Because the business-app catch is shared RN, parity is automatic in code but **each platform gets its own success criterion** (SC-9-iOS / SC-9-Android) so the implementor can't ship one and skip the other.

---

## 5. Success Criteria (observable, testable, unambiguous)

**Backend (the guards):**
- **SC-1** — `biz_publish_experience` / `biz_create_experience(p_publish=true)` with a PAID payload (`v_resolved_total > 0`) on a brand whose `stripe_connect_accounts.charges_enabled = false` (or no attached account) raises `stripe_charges_disabled`; the offering is NOT published (`events.status` stays `draft`, no live ticket).
- **SC-2** — The same publish with a PAID payload whose latest date `end_at <= now()` raises `offering_date_past`; not published.
- **SC-3** — `business_publish_event_draft` with `v_price > 0` (online ticket) on a not-ready brand raises `stripe_charges_disabled`; past-dated paid event raises `offering_date_past`. The `INSERT INTO public.event_dates` block is still present (orch-0792 gate green).
- **SC-4** — `business_publish_trip_draft` with a paid pricing tier on a not-ready brand raises `stripe_charges_disabled`; a trip whose range `v_end <= now()` raises `offering_date_past`. Existing `trip_end_before_start` still raised for end<start.
- **SC-5** — `biz_update_live_experience` and `biz_update_live_trip`, when the edited offering resolves to PAID and the brand is not ready, RETURN `{ok:false, reason:'stripe_charges_disabled'}`; when the edited latest date is past, RETURN `{ok:false, reason:'offering_date_past'}`. Existing `price_change_with_sales` / `dates_shifted_with_sales` rejections still fire.
- **SC-6** — `business_patch_event_when` patching a currently-PAID event onto an already-past latest date raises `offering_date_past`. Patching a FREE event onto a past date does NOT (paid-only).
- **SC-7** — `pg_brand_can_charge(brand_id)` returns `true` iff an attached (`detached_at IS NULL`) connect account exists with non-null `stripe_account_id` and `charges_enabled = true` — verified equal to the checkout predicate for the same brand.
- **SC-8** — FREE offerings (`v_resolved_total = 0` / `v_price = 0` / free trip) publish and edit normally on a not-ready brand AND when past-dated (neither guard fires). Stripe-ready brands publishing future-dated PAID offerings publish normally.

**Business app (per-surface — parity manual in QA):**
- **SC-9-iOS** — On Business iOS, a paid-publish attempt that returns `stripe_charges_disabled` shows the "Finish your payment setup" copy with a working button that routes to the brand's Stripe Connect onboarding; `offering_date_past` shows "Pick a future date" with a route to the date field. No raw RPC error string is shown.
- **SC-9-Android** — Identical behaviour verified independently on Business Android.
- **SC-10** — The buyer-side `ticket-checkout-create` 409 path is unchanged (regression check: an already-live not-ready paid listing still returns 409, proving the last-line defense survives).

---

## 6. Invariants

**Preserve (must not break):**
- **I-PUBLISH-WRITES-EVENT-DATES** (`INVARIANT_REGISTRY.md:825`) — guards inserted WITHOUT removing/relocating any `INSERT INTO public.event_dates` block. Verified by `orch-0792-publish-writes-event-dates.mjs` staying green.
- **`trg_events_enforce_master_date`** — untouched; still blocks status→scheduled/live without a master date.
- **I-EVENT-TIMING-FROM-EVENT-DATES** (`:835`) — post-publish date reads still from `event_dates`; guards read in-scope computed dates, not a divergent source.
- The checkout predicate at `20260727000000_orch_0955:380-382` — unchanged; `pg_brand_can_charge` mirrors it, does not replace it.

**New (this change establishes):**
- **I-PAID-PUBLISH-REQUIRES-CHARGES-ENABLED** (PROPOSED → ACTIVE on CLOSE) — every paid-publish/paid-live-edit RPC body MUST gate on `pg_brand_can_charge(` (or the inlined `stripe_connect_accounts ... charges_enabled` predicate). Asserted by the new strict-grep gate.
- **I-PAID-PUBLISH-REJECTS-PAST-DATE** (PROPOSED → ACTIVE on CLOSE) — every paid-publish/paid-live-edit RPC body MUST gate on the offering's latest `end_at`/`v_end` against `now()` for paid offerings. Asserted by the same gate.

### Regression gate (strict-grep) — `orch-1075-paid-publish-integrity-guards.mjs`

🔒 **LOCKED — modeled on `orch-0792-publish-writes-event-dates.mjs`.** For each of the 6 money RPC names, find the LATEST migration that defines it (grep `CREATE OR REPLACE FUNCTION public.<name>` → sort descending → first hit) and assert its body contains BOTH markers:
1. **Guard A marker:** `pg_brand_can_charge(` (or, if inlined per §3.0 OPEN, `charges_enabled` within the same function body).
2. **Guard B marker:** `offering_date_past`.

RPC list the gate checks: `biz_publish_experience`, `biz_create_experience`, `biz_update_live_experience`, `business_publish_event_draft`, `business_publish_trip_draft`, `biz_update_live_trip`. For `business_patch_event_when` assert ONLY the Guard B marker (`offering_date_past`), since Guard A is N/A there.

- 🔒 The gate must FAIL if a future migration supersedes any of these RPCs and drops a guard (fails-on-revert intent).
- 🔒 Add a workflow job to `.github/workflows/strict-grep-mingla-business.yml` (modeled on the `orch-0978-video-cap-29s` job block) running `node .github/scripts/strict-grep/orch-1075-paid-publish-integrity-guards.mjs`.
- 🎨 OPEN: the gate may include a `--self-test` mode (like `i-curated-hours-via-canonical-reader.mjs`) — encouraged, not required.

---

## 7. Implementation Order + COMMS Checklist

🔒 **LOCKED order:**
1. **DB migration** `supabase/migrations/<ts>_orch_1075_paid_publish_integrity_guards.sql`:
   - (a) `CREATE OR REPLACE FUNCTION public.pg_brand_can_charge(...)` (§3.0) + `GRANT EXECUTE` matching sibling helper grants.
   - (b) `CREATE OR REPLACE FUNCTION` for each of the 6 money RPCs and `business_patch_event_when`, **re-emitting each latest body verbatim plus the guard block** (since these are `CREATE OR REPLACE`, the migration must carry the whole current body — copy from the latest defining migration cited in §3, then insert the guard). Re-emit the GRANTs and COMMENTs each carries.
   - (c) Inline cite Stripe docs URLs in the migration header for `charges_enabled` + onboarding status (COMMS-0003): `https://docs.stripe.com/api/accounts/object`, `https://docs.stripe.com/connect/onboarding.md`.
2. **Strict-grep gate** `.github/scripts/strict-grep/orch-1075-paid-publish-integrity-guards.mjs` + workflow job (§6).
3. **Business-app catch sites** (§3.7) — reason→copy + onboarding route, iOS + Android.
4. **Tests** (§8).

🔒 **COMMS-0002 (backend allowlist) — HARD, IN THE SAME COMMIT as the migration:** add an `ORCH_1075_BACKEND_ALLOWLIST` array listing the new migration file `supabase/migrations/<ts>_orch_1075_paid_publish_integrity_guards.sql` to the C7 `no-new-backend-files` gate at `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` (model: ORCH-1064/1066). The new strict-grep `.mjs` file under `.github/scripts/` is not under `supabase/functions/**`, but verify the C7 gate's file globs; if it flags `.github/scripts` additions, allowlist that too. No `supabase/functions/**` file changes in this ORCH.

🔒 **COMMS-0003 (external-API docs) — HARD:** the two Stripe doc URLs above are cited inline in this SPEC (§3.0) and MUST be cited inline in the migration header.

🔒 **Safe-migration discipline (read-only pre-flight probe the implementor MUST run BEFORE writing/applying the migration):**
```sql
-- 1. Confirm the latest defining migration of each RPC matches §3 citations
--    (grep CREATE OR REPLACE ... → sort → newest). Re-emit THAT body.
-- 2. Read-only invariant probe — current checkout-readiness truth for the repro brand:
SELECT b.id, b.stripe_charges_enabled,
       s.charges_enabled, s.stripe_account_id, s.detached_at,
       public.pg_brand_can_charge(b.id) AS can_charge   -- after helper exists
  FROM public.brands b
  LEFT JOIN public.stripe_connect_accounts s
    ON s.brand_id = b.id AND s.detached_at IS NULL
 WHERE b.id = '53aaea42-0e7d-4b2a-92db-c220d78a352c';  -- Lantern & Vine
-- EXPECT: charges_enabled=false on both columns, detached_at NULL,
--         pg_brand_can_charge = false  (guard would reject this brand's paid publish).
```
The migration is `CREATE OR REPLACE` only (no DROP, no data backfill, no column changes) → idempotent and safe to re-run. **No `apply_migration` via MCP** — the operator runs `supabase db push`; the implementor verifies with read-only queries.

---

## 8. Test Cases

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| **T-01** (happy/impl) | Paid experience publish, brand not Stripe-ready | `biz_publish_experience`, paid payload, `charges_enabled=false` | `RAISE 'stripe_charges_disabled'`; status stays draft | DB RPC |
| **T-02** (happy/impl) | Paid experience publish, past date | paid payload, latest `end_at < now()`, brand ready | `RAISE 'offering_date_past'`; not published | DB RPC |
| **T-03** | Paid event publish, not ready | `business_publish_event_draft`, `v_price>0`, online ticket, `charges_enabled=false` | `RAISE 'stripe_charges_disabled'` | DB RPC |
| **T-04** | Paid event publish, past date | `v_price>0`, master `end_at<now()`, ready | `RAISE 'offering_date_past'` | DB RPC |
| **T-05** | Paid trip publish, not ready | `business_publish_trip_draft`, paid tier, `charges_enabled=false` | `RAISE 'stripe_charges_disabled'` | DB RPC |
| **T-06** | Paid trip publish, range ended | paid tier, `v_end<now()`, ready | `RAISE 'offering_date_past'`; `trip_end_before_start` still works for end<start | DB RPC |
| **T-07** | Edit-to-paid live experience, not ready | `biz_update_live_experience` → paid, `charges_enabled=false` | `{ok:false,reason:'stripe_charges_disabled'}` | DB RPC |
| **T-08** | Edit live trip → past date, paid | `biz_update_live_trip`, paid, `v_end<now()` | `{ok:false,reason:'offering_date_past'}` | DB RPC |
| **T-09 (adversarial)** | FREE offering, not ready | free experience/event/trip publish, `charges_enabled=false` | **PUBLISHES** (neither guard fires) | DB RPC |
| **T-10 (adversarial)** | FREE offering, past date | free publish, past date | **PUBLISHES** (paid-only expiry) | DB RPC |
| **T-11 (adversarial)** | Stripe-ready, future-dated PAID | paid publish, `charges_enabled=true`, future date | **PUBLISHES** normally | DB RPC |
| **T-12 (adversarial)** | Multi-date paid offering, one future date | paid experience, dates = [past, future], ready | **PUBLISHES** (Q4: latest `end_at>now()` → not past) | DB RPC |
| **T-13 (adversarial)** | Multi-date paid, ALL past | paid, dates all `end_at<now()` | `RAISE 'offering_date_past'` | DB RPC |
| **T-14 (adversarial)** | `business_patch_event_when` shift PAID event to past | paid event, patched latest date past | `RAISE 'offering_date_past'` | DB RPC |
| **T-15 (adversarial)** | `business_patch_event_when` shift FREE event to past | free event, patched past | **succeeds** (paid-only) | DB RPC |
| **T-16 (adversarial)** | In-person-only paid event (`available_online=false`) | paid in-person ticket, not ready | **PUBLISHES** (not online-sellable → no checkout-409 risk → Guard A N/A) | DB RPC |
| **T-17** | `pg_brand_can_charge` equals checkout predicate | same brand both fns | identical boolean | DB |
| **T-18 (regression)** | Strict-grep gate fails-on-revert | remove a guard from any RPC's latest def | gate exits non-zero | CI |
| **T-19 (regression)** | orch-0792 still green | run after migration | `INSERT INTO public.event_dates` still present in `business_publish_event_draft` latest def | CI |
| **T-20-iOS / T-20-Android** | Catch-site copy + route | trigger each reason on each platform | actionable copy; Stripe button routes to onboarding; date button routes to date field; no raw error | Business app |
| **T-21** | Buyer 409 survives | existing not-ready live listing → checkout | `ticket-checkout-create` still 409 `stripe_account_not_ready` | Edge (regression) |

**Fails-on-revert intent:** T-18 (gate) + T-01…T-08 + T-13…T-14 must FAIL if any guard is reverted; T-09…T-12, T-15, T-16, T-19, T-21 must PASS to prove the guards did NOT over-reach (free/ready/future/multi-date-with-future/in-person/event-dates/buyer-409 all intact).

---

## 9. 🔒 LOCKED / 🎨 OPEN summary

**🔒 LOCKED:** the 5 question resolutions (§2); the per-RPC guard placement, paid-test variable, and rejection shape (§3.1-3.5); reading `stripe_connect_accounts.charges_enabled WHERE detached_at IS NULL` as the source; `pg_brand_can_charge` contract; the two reason strings (`stripe_charges_disabled`, `offering_date_past`) and their exact client copy + the requirement that the Stripe button routes to the real onboarding entry; Q4 "latest `end_at > now()`" expiry semantics; FREE exemption from both guards; preserving `event_dates` writes + `orch-0792` + `trg_events_enforce_master_date`; the strict-grep gate markers + workflow job; the COMMS-0002 allowlist-in-same-commit + COMMS-0003 doc-URL requirements; the read-only pre-flight probe; all 21 test cases.

**🎨 OPEN:** helper vs inlined predicate (helper preferred); exact `v_max_end` computation strategy (pre-scan vs accumulate); error-surface presentation (toast/banner/modal), animation, haptic within Mingla patterns; optional `--self-test` on the gate; defense-in-depth framing of the `business_patch_event_when` guard if a past date is already unreachable there.

---

## 10. Residual operator decision

- **None blocking.** All 5 investigation open questions are resolved with orchestrator-approved defaults (§2). One item for awareness, not a blocker: **T-16 / §3.3** treats an in-person-only paid event (`available_online=false`) as out of scope for Guard A because it cannot reach the buyer-web/native checkout 409 (not online-sellable). If the operator later wants door-sales-only paid events to also require Stripe readiness at publish, that is a deliberate scope addition for a follow-up ORCH — flagged here, NOT silently included.
