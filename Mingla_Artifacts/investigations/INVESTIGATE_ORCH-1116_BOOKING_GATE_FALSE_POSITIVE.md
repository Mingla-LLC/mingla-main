# INVESTIGATE — ORCH-1116: Public paid-event booking gate false-positive

**Status:** COMPLETE — root cause PROVEN with live DB evidence (DB/data layer; no sim repro required — pure backend RLS investigation, exempt per Prime Directive 7).
**Confidence:** `proven` (root cause reproduced live by executing the RPC under `SET ROLE anon` and `SET ROLE authenticated`).
**Date:** 2026-06-11
**Project ref:** `gqnoajqerqhnvulmnyvv`
**Investigator:** mingla-forensics

---

## 1. Symptom summary (expected vs actual)

- **Reported (2026-06-11):** On the public/buyer event page for "The party block" (brand "Leggo This"), the Get-Tickets CTA is replaced by the banner **"Booking unavailable right now — This organizer is finishing their payment setup."** Operator states the brand HAS bank set up and Stripe active. Buyers blocked → revenue blocked.
- **Expected:** Brand can charge (Stripe active) ⇒ `bookable=true` ⇒ Get-Tickets CTA renders, buyer can check out.
- **Actual:** `bookable=false` ⇒ banner renders, CTA neutralized — a **false positive** of the ORCH-1076 "paid-supply-requires-charges-enabled" gate.

The orchestrator's lead (RPC `pg_brand_can_charge` returns false; suspected Paystack-blindness or stale Stripe flag) was a HYPOTHESIS. **Both sub-hypotheses are REFUTED.** The true cause is an RLS/SECURITY-INVOKER trap — see F-1.

---

## 2. Investigation manifest (files read, in trace order)

| # | File / object | Layer | Why |
|---|---|---|---|
| 1 | `COMMS_LEDGER.md` (Active table; COMMS-0018/0019/0021/0022) | docs | Entry mandate; COMMS-0021 = Paystack neutral readiness helper; COMMS-0022 = "Leggo This" is a real prod brand |
| 2 | `mingla-business/src/services/publicEventsService.ts` L900-1002 | code | `resolveEventBookable` → RPC; `detailFromRow`; `fetchReadyBrandIds` |
| 3 | `mingla-business/src/components/event/PublicEventPage.tsx` L196-399 | code | `bookable` prop default + banner render + CTA neutralization |
| 4 | `mingla-business/app/e/[brandSlug]/[eventSlug].tsx` L36-67 | code | Route passes `query.data.bookable` to the page |
| 5 | `mingla-business/src/hooks/usePublicEvents.ts` (usePublicEventBySlug) | code | Hook → service |
| 6 | `supabase/migrations/20260911000000_orch_1075_paid_publish_integrity_guards.sql` L65-83 | schema | `pg_brand_can_charge` DEFINITION (Stripe-only EXISTS) + publish-guard call sites |
| 7 | `supabase/migrations/20260917000000_orch_1076_paid_supply_requires_charges_enabled.sql` L90-116 | schema | `pg_brands_can_charge` + **anon grant** + the load-bearing (and wrong) "anon-safe / mirrors SECURITY-DEFINER" comment |
| 8 | live `pg_get_functiondef` / `pg_proc.prosecdef` | schema | Function body + SECURITY INVOKER vs DEFINER |
| 9 | live `pg_policy` on `stripe_connect_accounts` | schema | RLS policies (only `{authenticated}` + owner predicate) |
| 10 | `brands` + `stripe_connect_accounts` + `events` + `ticket_types` rows for Leggo | data | Real column values |
| 11 | `audit_log` (`stripe_connect.status_refreshed`) | data | charges_enabled flip timeline |
| 12 | `supabase/functions/_shared/stripeWebhookRouter.ts` + `brand-stripe-refresh-status/index.ts` | code | What syncs `stripe_connect_accounts.charges_enabled` |
| 13 | `app-mobile/src/hooks/useBrandBySlug.ts` L348-385; `publicExperienceService.ts` L162-380; `discover-merged-events/index.ts` L285,459 | code | Blast radius — every other RPC call site + its auth context |
| 14 | `supabase/migrations/__tests__/orch_1076_paid_supply_suppression.test.sql` G-00 | docs/test | Why the bug was invisible to CI |

---

## 3. Q-scorecard

**Q1 — Does `pg_brand_can_charge` return false for "Leggo This" on current data (as superuser)?**
`Verdict:` NO. As postgres/service it returns **true**. The brand row, the source `stripe_connect_accounts` row, the event, and the ticket all check out. (F-3) `proven`.

**Q2 — Is "Leggo This" a Paystack/Nigeria brand the Stripe-only RPC is blind to?**
`Verdict:` NO — REFUTED. `payment_provider='stripe'`, `paystack_subaccount_code=NULL`, `payment_country=NULL`, currency `USD`. Not a Paystack brand. (F-3) `proven`.

**Q3 — Was the brand's `charges_enabled` stale/false at report time (webhook never synced)?**
`Verdict:` NO — REFUTED. `charges_enabled` flipped false→true on **2026-05-09 05:20:30Z** and has had **zero** transitions since. It was `true` continuously through the 2026-06-11 report. (F-4) `proven`.

**Q4 — Then why does the buyer see `bookable=false`?**
`Verdict:` Because the buyer is NOT postgres. `pg_brand_can_charge` is **SECURITY INVOKER**; `stripe_connect_accounts` has RLS enabled with the ONLY SELECT-capable policy scoped to `{authenticated}` brand-payments-admins. When the **anon** (or any non-owner **authenticated**) buyer calls the RPC, RLS hides the row, the inner `EXISTS` sees zero rows, and the function returns **false** for a brand that can demonstrably charge. (F-1) `proven`.

**Q5 — Why did the brand still successfully PUBLISH the paid event despite the same predicate?**
`Verdict:` The publish/update RPCs (`business_publish_event_draft`, `biz_publish_experience`, etc.) are **SECURITY DEFINER** — they call `pg_brand_can_charge` with elevated privileges, RLS is bypassed, the row is visible, predicate returns true, publish succeeds. The buyer-facing helpers are SECURITY INVOKER → predicate returns false. The two surfaces disagree by design accident. (F-2) `proven`.

**Q6 — Is `pg_brand_can_charge` the single shared authority across all buyer surfaces?**
`Verdict:` YES for the predicate, but the auth context differs per call site. Service-role callers (`discover-merged-events`) are fine; every client-JWT caller (anon web + authenticated consumer app) is broken. (F-5) `proven`.

---

## 4. Findings (six-field evidence)

### F-1 — CONFIRMED ROOT CAUSE: `pg_brand_can_charge` is SECURITY INVOKER over an RLS-protected table with no buyer-readable policy → returns FALSE for every non-owner caller

1. **Symptom:** Anon/authenticated buyer's `supabase.rpc("pg_brand_can_charge", {p_brand_id})` returns `false` for a brand whose `stripe_connect_accounts.charges_enabled=true`.
2. **Layer:** schema (function security mode) × schema (RLS) × data.
3. **Probe:**
   ```sql
   SET ROLE anon;
   SELECT public.pg_brand_can_charge('22a18413-bfbf-4087-9ba7-45f70deba0f3') AS anon_can_charge,
          (SELECT count(*) FROM public.stripe_connect_accounts
            WHERE brand_id='22a18413-bfbf-4087-9ba7-45f70deba0f3') AS anon_visible_rows;
   RESET ROLE;
   ```
4. **Evidence (verbatim):**
   - Function body (live `pg_get_functiondef`): `CREATE OR REPLACE FUNCTION public.pg_brand_can_charge(p_brand_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $function$ SELECT EXISTS ( SELECT 1 FROM public.stripe_connect_accounts s WHERE s.brand_id = p_brand_id AND s.detached_at IS NULL AND s.stripe_account_id IS NOT NULL AND s.charges_enabled IS DISTINCT FROM false ); $function$` — **no `SECURITY DEFINER` clause**.
   - `pg_proc.prosecdef` for `pg_brand_can_charge` = **`false`** (SECURITY INVOKER), owner `postgres`.
   - RLS on `public.stripe_connect_accounts`: `relrowsecurity=true`. The ONLY policy: `polname="Brand admin plus can manage stripe_connect_accounts"`, `polcmd='*'`, `roles={authenticated}`, `using_expr=biz_can_manage_payments_for_brand_for_caller(brand_id)`. **No `anon` policy; no buyer-scoped SELECT policy.**
   - Live result as anon: `[{"anon_can_charge": false, "anon_visible_rows": 0}]`.
   - Live result as authenticated non-owner: `[{"authed_buyer_can_charge": false, "authed_visible_rows": 0}]`.
   - Live result as postgres (superuser, RLS-exempt): `pg_brand_can_charge=true` (see F-3).
5. **Mechanism:** SECURITY INVOKER means the inner `SELECT … FROM stripe_connect_accounts` runs under the *caller's* RLS. The buyer (anon, or authenticated-but-not-this-brand's-payments-admin) matches no policy → 0 rows visible → `EXISTS(...)` is false → `pg_brand_can_charge` returns false → `resolveEventBookable` returns `data === true` ⇒ false ⇒ `bookable=false` ⇒ PublicEventPage renders the "Booking unavailable" banner and neutralizes the CTA.
6. **Severity:** `CONFIRMED ROOT CAUSE`.

### F-2 — SECONDARY (explains "but it published fine"): publish/update RPCs are SECURITY DEFINER, so the SAME predicate passes brand-side

1. **Symptom:** The brand could publish the paid event (no `stripe_charges_disabled` publish error) yet buyers are gated.
2. **Layer:** schema.
3. **Probe:** `SELECT proname, prosecdef FROM pg_proc … WHERE proname IN ('business_publish_event_draft', 'biz_publish_experience', …)`.
4. **Evidence (verbatim):** `business_publish_event_draft`=DEFINER `true`, `business_publish_trip_draft`=`true`, `biz_publish_experience`=`true`, `biz_create_experience`=`true`, `biz_update_live_experience`=`true`, `biz_update_live_trip`=`true`, `business_patch_event_when`=`true`, `pg_eligible_experiences_for_deck`=`true`. By contrast `pg_brand_can_charge`=`false`, `pg_brands_can_charge`=`false`.
5. **Mechanism:** DEFINER RPCs invoke `pg_brand_can_charge` with `postgres` privileges → RLS bypassed → row visible → predicate true → publish allowed. INVOKER buyer-helpers run under the buyer's role → predicate false. The publish gate and the buyer gate read the same function but resolve to opposite booleans purely because of caller security context. This is the contradiction the bug hides in.
6. **Severity:** `SECONDARY ROOT CAUSE` (it is not the false-positive itself, but it is why the inconsistency exists and why nobody caught it on the authoring side).

### F-3 — RULED OUT: Paystack-blindness AND stale-flag. Brand data is clean and Stripe-active

1. **Symptom:** Hypothesised Paystack brand or never-synced flag.
2. **Layer:** data.
3. **Probe:** `SELECT id,name,slug,payment_provider,payment_country,paystack_subaccount_code,stripe_connect_id,stripe_charges_enabled,stripe_payouts_enabled,default_currency,pricing_currency,deleted_at, public.pg_brand_can_charge(id) FROM public.brands WHERE name ILIKE '%leggo%';` plus the `stripe_connect_accounts` row.
4. **Evidence (verbatim):**
   - brands row: `{"id":"22a18413-bfbf-4087-9ba7-45f70deba0f3","name":"Leggo This","slug":"leggothis","payment_provider":"stripe","payment_country":null,"paystack_subaccount_code":null,"stripe_connect_id":"acct_1TUNLtB5v00XfDTX","stripe_charges_enabled":true,"stripe_payouts_enabled":true,"default_currency":"USD","pricing_currency":"USD","deleted_at":null,"rpc_can_charge":true}`
   - stripe_connect_accounts row: `{"brand_id":"22a18413-…","stripe_account_id":"acct_1TUNLtB5v00XfDTX","charges_enabled":true,"payouts_enabled":true,"detached_at":null,"created_at":"2026-05-07 08:32:17Z","updated_at":"2026-06-12 03:29:56Z"}`
   - event row: `{"id":"a3f71d85-33a5-4149-be8c-a1c1e33b3f7e","title":"The party block","slug":"the-party-block","event_type":"event","status":"scheduled","brand_id":"22a18413-…","rpc_can_charge":true}`
   - ticket row: `{"name":"The basic","is_free":false,"price_cents":5000,"currency":"USD","available_in_person":true,"available_online":true,"deleted_at":null}` → paid-online ⇒ gate IS evaluated.
5. **Mechanism:** N/A — this finding REFUTES the two leading hypotheses. The brand is a Stripe brand, fully charge-enabled, single (no duplicate "leggo" brand), and the RPC returns true under superuser. There is nothing stale or Paystack-shaped here.
6. **Severity:** `RULED OUT` (Paystack-blindness; stale-flag).

### F-4 — RULED OUT: timing/webhook lag. `charges_enabled` has been true since 2026-05-09

1. **Symptom:** Hypothesised the flag was false at report time and synced true after.
2. **Layer:** data.
3. **Probe:** `SELECT created_at, before->>'charges_enabled', after->>'charges_enabled' FROM public.audit_log WHERE brand_id='22a18413-…' AND action='stripe_connect.status_refreshed' AND (before->>'charges_enabled') IS DISTINCT FROM (after->>'charges_enabled') ORDER BY created_at;`
4. **Evidence (verbatim):** exactly ONE transition row: `[{"created_at":"2026-05-09 05:20:30.051746+00","before_ce":"false","after_ce":"true"}]`. (Sync arrives via `brand-stripe-refresh-status` → `stripe_connect.status_refreshed` audit, 851 events; the `account.updated` webhook path logged 0 rows for this brand.)
5. **Mechanism:** N/A — refutes the timing hypothesis. The flag was true for ~33 days before the report. The `updated_at=2026-06-12` on the row is a no-op refresh touch (value unchanged), not a flip.
6. **Severity:** `RULED OUT` (stale/timing).

### F-5 — CONFIRMED CONTRIBUTOR: the CI gate (ORCH-1076 G-00 + the migration comment) institutionalized the wrong mental model

1. **Symptom:** A revenue-blocking false-positive shipped with passing tests.
2. **Layer:** docs/test.
3. **Probe:** read `orch_1076_paid_supply_suppression.test.sql` G-00 + migration comment L106-116.
4. **Evidence (verbatim):**
   - Test G-00: `IF NOT has_function_privilege('anon', 'public.pg_brand_can_charge(uuid)', 'EXECUTE') THEN RAISE EXCEPTION 'G-00 FAIL: anon lacks EXECUTE …'`. It asserts the **grant** exists; it NEVER runs the RPC `SET ROLE anon` against a ready brand to assert it returns **true**. The body seeds rows and runs as the migration superuser, so RLS never bites in test.
   - Migration comment L113-115: *"The function reads only stripe_connect_accounts via a single-row EXISTS and returns a boolean — it exposes NO row data to the caller, so anon-grant leaks nothing (**mirrors the anon-safe posture of the SECURITY-DEFINER supply RPCs**)."* This is the load-bearing error: `pg_brand_can_charge` is **NOT** SECURITY DEFINER. The author believed granting EXECUTE to anon was sufficient and that the function behaved like the DEFINER deck RPCs; it does not.
5. **Mechanism:** The grant was added without making the function able to read its own table under anon RLS. The test verified the grant, not the behavior, so the false-positive was invisible. The comment encodes the misconception for the next maintainer.
6. **Severity:** `SECONDARY ROOT CAUSE` / contributor (process + comment).

---

## 5. Five-Truth-Layer reconciliation

| Layer | What it says | Contradiction |
|---|---|---|
| **Docs** | ORCH-1075/1076 headers + migration comment: "canonical Stripe-readiness predicate," anon-granted, "mirrors the anon-safe posture of the SECURITY-DEFINER supply RPCs." | **The comment asserts DEFINER-equivalent behavior that the function does not have.** |
| **Schema** | `pg_brand_can_charge` is SECURITY INVOKER (prosecdef=false) over `stripe_connect_accounts`, whose only RLS policy is `{authenticated}` + owner predicate. Publish RPCs are DEFINER. | **INVOKER predicate + owner-only RLS = false for all buyers.** This is the bug, enforced by the schema. |
| **Code** | `resolveEventBookable` returns `data === true`; on RPC *error* fails OPEN. But anon gets `data=false` (NOT an error) → fails CLOSED. `useBrandBySlug` drops paid rows. `discover-merged-events` uses service_role (safe). | The "fail OPEN on error" safety net does not fire — the RPC succeeds and returns a real `false`. |
| **Runtime** | As anon: `pg_brand_can_charge=false`, 0 visible rows. As authenticated non-owner: `false`, 0 rows. As postgres: `true`. | The same input yields opposite answers by caller role — the contradiction made executable. |
| **Data** | Brand is Stripe, charges_enabled=true since 2026-05-09, event is paid-online, single brand. The brand genuinely CAN charge. | Data says "can charge"; buyer-context schema says "cannot." Schema (RLS+INVOKER) holds the lie. |

**The contradiction that IS the bug:** the gate's authority (`pg_brand_can_charge`) reads a table the buyer is forbidden to read, while running as the buyer. Truth lives in the data (brand can charge); the schema's INVOKER+RLS combination overrides truth with `false` for every buyer.

---

## 6. Blast radius / cross-surface map

`pg_brand_can_charge` / `pg_brands_can_charge` is the single shared authority — but the defect manifests on **every client-JWT (anon or non-owner authenticated) call site** and is harmless only on **service-role** call sites.

**AFFECTED (false-positive: paid offerings wrongly gated/hidden for buyers):**
| Surface | Call site | Failure mode |
|---|---|---|
| Buyer/anon web — event | `mingla-business/src/services/publicEventsService.ts:914-924` (`resolveEventBookable`) | Banner + dead CTA (the reported symptom) |
| Buyer/anon web — brand event feed | `publicEventsService.ts:929-942` (`fetchReadyBrandIds`) → on empty set, paid rows fail closed | Paid events vanish from brand page |
| Buyer/anon web — experience | `mingla-business/src/services/publicExperienceService.ts:162-177,336,378` (`resolveBookable`) | Experience banner + dead "Book" CTA |
| Consumer app — brand page | `app-mobile/src/hooks/useBrandBySlug.ts:348-385` (`pg_brands_can_charge`, fail-closed) | Paid events dropped from feed for buyers |
| Consumer app — event/experience/trip detail + checkout | any client-JWT `pg_brand_can_charge` resolver mirroring the above | Same banner/gate; the `ticket-checkout-create` 409 `stripe_account_not_ready` is a SEPARATE service-role check (see below) |

**NOT AFFECTED (service-role or DEFINER — RLS bypassed):**
| Surface | Call site | Why safe |
|---|---|---|
| Consumer discover/swipe feed | `supabase/functions/discover-merged-events/index.ts:285,459` | Uses `SUPABASE_SERVICE_ROLE_KEY` → RLS bypass |
| Consumer experience deck supply | `pg_eligible_experiences_for_deck` (DEFINER) | RLS bypass |
| Publish-time guards | `business_publish_event_draft` / `biz_publish_experience` / `business_publish_trip_draft` / `biz_update_live_*` / `business_patch_event_when` (all DEFINER) | RLS bypass → predicate true → publish correctly allowed |
| Brand-side publish preflight UI | `mingla-business/src/components/offering/publishStripeReadiness.ts` | Reads the client `BrandStripeStatus` store, not the RPC; runs as owner |

**`ticket-checkout-create` 409 note:** the orchestrator linked the checkout 409 (`stripe_account_not_ready`, ORCH-1073). That edge function runs server-side; whether it shares this defect depends on whether it queries `stripe_connect_accounts` with service-role (safe) or calls `pg_brand_can_charge` under the buyer JWT (affected). It is NOT confirmed in this investigation and should be checked in SPEC — but it is the "backstop" the buyer-page comments rely on, so if it is service-role it would (correctly) ALLOW Leggo's checkout, meaning the banner is the only thing wrongly blocking the buyer. (Layer: code; confidence on checkout path: `inconclusive` — verify in SPEC.)

**Invariant impact:** `I-PAID-SUPPLY-REQUIRES-CHARGES-ENABLED` (ORCH-1076) is being violated in the WRONG direction — it is over-suppressing ready brands rather than only suppressing not-ready ones. Any fix must preserve the true-negative (a genuinely not-ready brand must still be gated) while eliminating the false-positive.

---

## 7. Discoveries for Orchestrator (side issues)

- **D-1 (process):** ORCH-1076's CI gate G-00 asserts the anon EXECUTE grant but never asserts anon RPC *behavior* (returns true for a ready brand). A whole class of SECURITY-INVOKER-over-RLS bugs can pass this gate. The fix's regression test MUST run `SET ROLE anon` and assert `true`.
- **D-2 (comment rot):** `20260917000000_…sql` L113-115 claims the function "mirrors the anon-safe posture of the SECURITY-DEFINER supply RPCs" — factually wrong (it is INVOKER). Any code/migration touching this file should correct the comment to avoid re-propagating the misconception.
- **D-3 (consumer parity, unverified):** the consumer app event/trip/experience *detail* screens and `ticket-checkout-create` likely call the same predicate under a buyer JWT. SPEC should enumerate and confirm each, because they are not in this report's directly-proven set.

---

## 8. What must change (direction only — for SPEC; NOT a fix)

The gate's authority must be able to read its own source table when called by a buyer, WITHOUT exposing `stripe_connect_accounts` row data to buyers and WITHOUT weakening the true-negative (a not-ready brand must still gate). The SPEC must choose among (and the orchestrator/SPEC owns the choice — this investigation does not pre-decide it):
- making `pg_brand_can_charge` SECURITY DEFINER (matching the publish RPCs and the `pg_eligible_experiences_for_deck` deck RPC it was *believed* to mirror), with a locked `search_path`; **or**
- a narrowly-scoped buyer-readable RLS policy / readiness projection that exposes ONLY the boolean, not the row; **or**
- reading a buyer-safe readiness column/view instead of the RLS-protected base table.

Whichever is chosen, the binding success criteria are: (1) `SET ROLE anon; SELECT pg_brand_can_charge(<ready brand>)` returns **true**; (2) the same for a genuinely not-ready brand returns **false**; (3) no `stripe_connect_accounts` row fields become readable by anon/buyer beyond the boolean; (4) a regression test that FAILS when the fix is reverted; (5) parity across the affected surfaces in §6 (web event, web brand feed, web experience, consumer brand page, consumer detail/checkout) — fix lands in the single shared predicate so all surfaces inherit it.

---

## 9. Confidence

`proven`. The root cause was reproduced live by executing the production RPC under `SET ROLE anon` (returns false, 0 rows visible) and `SET ROLE authenticated` (false, 0 rows) versus superuser (true), against the real "Leggo This" brand row, with the function's SECURITY-INVOKER mode and the table's RLS policy set both pulled from live catalogs, and the charges_enabled timeline pulled from `audit_log`. No sim repro is required (pure backend/RLS/SQL investigation — Prime Directive 7 exemption). The two leading hypotheses (Paystack-blindness, stale flag) are positively REFUTED with data.
