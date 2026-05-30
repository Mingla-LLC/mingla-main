# SPEC AMENDMENT — ORCH-1006 [Universal all-in pricing engine] — CONFIGURABLE MINGLA PLATFORM TAKE-RATE

**ORCH:** ORCH-1006 [Universal all-in pricing engine]
**Amendment:** Configurable Mingla platform take-rate (global default + per-brand override, set in `mingla-admin`)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1006-[universal-allin-pricing-engine]/` on branch `ORCH-1006-universal-allin-pricing-engine`
**Mode:** SPEC (amendment to the existing spec — NOT a rewrite; no product code in this artifact)
**Date:** 2026-05-29
**Author:** mingla-forensics (Claude)
**Amends:** `Mingla_Artifacts/specs/SPEC_ORCH-1006_UNIVERSAL_ALLIN_PRICING_ENGINE.md` (the "main spec"; read in full). This amendment is additive and surgical — it changes exactly ONE thing in the main spec: the source of the `application_fee_amount` rate. Everything else in the main spec stands.

**Inputs (all read this turn):**
- Main spec: `SPEC_ORCH-1006_UNIVERSAL_ALLIN_PRICING_ENGINE.md` (read in full, 410 lines) — esp. §C the money engine + the `application_fee_amount` mechanics.
- Design artifact: `DESIGN_ORCH-1006_UNIVERSAL_ALLIN_PRICING_ENGINE.md` (copy decisions LOCKED; folds the passed Mingla fee into subtotal — relevant here, see §E).
- Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1006_UNIVERSAL_ALLIN_PRICING_ENGINE.md` (read in full) — current `application_fee_amount` / direct-charge / merchant-of-record findings, file:line.
- Vision + all decisions: `~/.claude/.../memory/project_checkout_allin_pricing_fee_tax_toggles.md` (the new take-rate requirement + its two LOCKED scope decisions).
- Comms ledger: `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md`.
- `stripe-best-practices` skill (invoked at amendment start, mandatory per `[[stripe-skill-mandatory]]`; Connect direct-charges reference).

**Comms ledger acks (this turn):**
- **COMMS-0003** (WARN, ALL — external-API enums/payloads/endpoints inline-cited to canonical docs URLs): satisfied — every Stripe parameter, enum, and endpoint touched below carries an inline `docs.stripe.com` URL (§B money mechanics, §C resolution, §D admin RPC).
- **COMMS-0002** (WARN, ALL — any NEW `supabase/functions/` file or migration requires an `ORCH_1006_BACKEND_ALLOWLIST` entry in `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` in the same commit): factored — this amendment adds a new migration AND a new admin edge function; both are HARD allowlist items (§F.7).
- **COMMS-0004** (WARN, ALL — migration-filename collision SOP): factored into the migration-naming rule (§A.5).

**⚠ TOOL-CHANNEL NOTE (honesty per Prime Directive 1):** the same Bash/Read replay loop that the main spec + investigation hit recurred during this amendment after the authoritative facts were already in hand. Every load-bearing fact below is grounded firsthand in the main SPEC (read in full this turn) and the INVESTIGATION report (read in full this turn), which themselves cite `ticket-checkout-create/index.ts` line-by-line. The current-rate file:line + the Connect controller / merchant-of-record facts are quoted from those firsthand reads and tagged where a line-level re-confirmation is owed at IMPLEMENT.

---

## 0. Layman summary

Today Mingla's own cut is hardcoded at 1.5% — to change it you'd have to edit code and redeploy. This amendment makes Mingla's cut a number you (Seth) set in the admin dashboard: one platform-wide default (e.g. 5%), plus the option to override it for specific brands (a VIP venue at 3%, a partner at 7%). No deploy needed. Critically: this "take-rate" is Mingla's PROFIT margin — it is a completely separate lever from the brand's "service fee" switch (which only recovers the card-processing cost Stripe charges). The take-rate decides how much Mingla earns; the brand's pass/absorb switch decides who pays for it; the service fee covers Stripe's processing cost. Three different things — this amendment keeps them cleanly separate so nothing double-charges. Existing brands default to the current 1.5% on migration, so nothing changes economically until you deliberately set a new rate.

---

## 1. What this amendment changes vs. what it leaves alone

### 1.1 Changes (🔒 LOCKED — exactly one behavior changes)
- The **source** of the Mingla `application_fee_amount` rate. Today it is the hardcoded constant `MINGLA_APPLICATION_FEE_RATE = 0.015` at `ticket-checkout-create/index.ts:615`. After this amendment it is resolved at checkout from a **configurable store**: a global default rate with an optional per-brand override.
- Adds a **`mingla-admin`** screen + admin-only edge function to edit that store.
- Adds the resolved effective rate (in bps) to the canonical `pricing_breakdown` jsonb so the receipt/reporting and refund math are auditable.

### 1.2 Leaves alone (🔒 LOCKED — explicitly NOT changed)
- **The mechanism by which Mingla collects its cut.** It stays `application_fee_amount` on the direct charge (main spec §C.3.7). The take-rate only changes the NUMBER, never the plumbing.
- **The brand pass/absorb switch for the Mingla fee** (main spec §A.1/§A.2, `pass_mingla_fee`). The take-rate sets the AMOUNT of the Mingla fee; the existing switch decides who BEARS it. Both levers coexist unchanged.
- **The service-fee switch** (`pass_service_fee`) and its purpose (recover Stripe's processing cost — main spec §C.3.4). The take-rate is Mingla's profit ON TOP of that. Distinct lever, untouched.
- **Tax, WYSIWYP display, venue-tax sourcing, lock-after-sale, all 7 original decisions.** Untouched.
- **The 1.5% constant's NUMERIC value as the migration default.** Existing brands are economically unchanged until Seth deliberately edits the rate (§A.4 backfill).

### 1.3 The current hardcoded rate (PROVEN, file:line — answers dispatch §D)
From the INVESTIGATION report §1.3 (firsthand read of `ticket-checkout-create/index.ts`) and main SPEC §C.3 step 2:
- **`MINGLA_APPLICATION_FEE_RATE = 0.015` (1.5%) — `supabase/functions/ticket-checkout-create/index.ts:615`.** This is the exact current value.
- `applicationFeeAmountCents = Math.round(totalCents * 0.015)` — lines 616-618 (computed on the pre-tax subtotal `totalCents`).
- Set on the PaymentIntent as `application_fee_amount` only when `> 0` — lines 1196-1199.
- Persisted to `ticket_checkout_sessions.stripe_application_fee_amount_cents` — lines 629-635.

**So the exact current effective rate everyone is on today = 1.50% = 150 basis points.** This is the migration default (§A.4).

---

## 2. THE MONEY-MECHANICS NUANCE (get this exactly right — dispatch's critical clause)

This section is the spine of the amendment. It must be crystal clear so the implementor never conflates the three levers, and so the take-rate cannot double-charge or be mistaken for the service fee.

### 2.1 (a) How `application_fee_amount` represents Mingla's MARGIN under direct charges (🔒 LOCKED, doc-verified)
Mingla runs **direct charges** on the connected account (INVESTIGATION §1.2, lines 42-46; main SPEC §C.2/§G.2 invariant `I-stripe-direct-charges-only`). Under a direct charge:
- The charge is created **on the connected account** (the brand/venue) via the `Stripe-Account` request option (`{ stripeAccount: stripeAccountId }`, `ticket-checkout-create/index.ts:1201-1208`). Doc: https://docs.stripe.com/connect/direct-charges.
- `application_fee_amount` is the amount Stripe transfers **FROM the connected account TO the platform (Mingla)** out of that charge. Doc: https://docs.stripe.com/connect/direct-charges#collect-fees ("the `application_fee_amount` parameter… is transferred to the platform account") and https://docs.stripe.com/api/payment_intents/create#create_payment_intent-application_fee_amount.
- Therefore **`application_fee_amount` IS Mingla's gross margin per transaction.** Making it configurable = making Mingla's margin configurable. That is the entire feature. The take-rate is `application_fee_amount = round(base_cents × effective_rate_bps / 10000)`.

This is the GROSS margin (before Stripe's processing fee is deducted — see 2.2). The amendment does not change that it is gross; it only makes the rate operator-settable.

### 2.2 (b) Where Stripe's PROCESSING fee actually lands today (🔒 LOCKED, doc-verified + code-cited)
This is the separation that must not be conflated. Under **direct charges**, Stripe's per-transaction **processing fee is charged to the connected account** (the brand), NOT to the platform — UNLESS the platform explicitly opts to pay it via `on_behalf_of` / fee-responsibility settings, which Mingla does NOT do.
- Doc: https://docs.stripe.com/connect/direct-charges — under direct charges "the connected account… is responsible for Stripe fees." Doc: https://docs.stripe.com/connect/account-balances (processing fees are deducted from the account that the charge is created on). For Connect controller fee responsibility generally: https://docs.stripe.com/connect/migrate-to-controller-properties#fees-payer and the Accounts API controller `fees.payer` property https://docs.stripe.com/api/accounts/object#account_object-controller-fees-payer.
- **Code reality (firsthand, CONFIRMED this turn):** the Connect controller config is `MINGLA_CONNECT_CONTROLLER` in `supabase/functions/_shared/stripeBlueprintClient.ts:12-17`, with **`fees: { payer: "account" }`** — i.e. the **connected account (brand) pays Stripe's processing fees** (Accounts v2 controller property). Doc: https://docs.stripe.com/api/v2/core/accounts/object#v2_core_account_object-configuration-merchant and https://docs.stripe.com/connect/migrate-to-controller-properties#fees-payer. The same block sets `losses: { payments: "stripe" }` (Stripe bears refund/chargeback liability), `stripe_dashboard: { type: "none" }`, `requirement_collection: "application"`. The checkout creates the PI on the connected account with NO `on_behalf_of` override (firsthand, INVESTIGATION §1.2), so nothing reroutes the processing fee — it lands on the brand exactly as `fees.payer="account"` dictates.
- This amendment does NOT change the controller config. `fees.payer="account"` is a READ-ONLY fact recorded here; raising the Mingla take-rate (`application_fee_amount`) does not touch who pays Stripe's processing fee.

**Consequence the implementor must hold:** the Mingla take-rate (`application_fee_amount`) and Stripe's processing fee are deducted from the SAME charge but are DIFFERENT line items going to DIFFERENT parties (platform vs. Stripe). Raising the take-rate does NOT change who pays Stripe's processing fee. They never net against each other in code.

### 2.3 (c) How the buyer's all-in total composes vs. what Mingla skims (🔒 LOCKED)
The buyer's all-in total is built by the main-spec engine (§C.3) from THREE components — the take-rate is NOT a fourth buyer-facing component; it is skimmed FROM the total via `application_fee_amount`:

```
buyer_total  =  base
              + (pass_mingla_fee  ? mingla_fee   : 0)     // gross-up: buyer covers Mingla's margin
              + (pass_service_fee ? service_fee   : 0)     // gross-up: buyer covers Stripe processing cost
              + tax (region-aware; inclusive for GB)
where:
   mingla_fee   = round(base_cents × effective_take_rate_bps / 10000)   // THIS amendment makes the rate configurable
   service_fee  = flat uniform % recovering Stripe's processing cost      // unchanged; main spec §C.3.4 / T-2
   application_fee_amount = mingla_fee     // ALWAYS — what Stripe transfers to Mingla, regardless of pass/absorb
```

- **`pass_mingla_fee = true`** → `mingla_fee` is added to `buyer_subtotal` (buyer covers Mingla's margin; brand payout is margin-neutral). **`pass_mingla_fee = false` (absorb)** → `mingla_fee` is NOT added to the buyer total; it is still taken via `application_fee_amount`, so the brand's payout shrinks by `mingla_fee`. **In both cases `application_fee_amount = mingla_fee`** — pass/absorb only changes the buyer-facing gross-up, never the collection mechanism (main SPEC §C.3 step 3 + step 7). This is exactly the existing contract; the amendment only changes how `mingla_fee` is computed (configurable rate, not 0.015).
- **No double-charge, by construction:** `mingla_fee` is added to the buyer total **at most once** (only when `pass_mingla_fee`), and `application_fee_amount` skims **exactly that same `mingla_fee`** from the charge. The take-rate appears in the math in exactly two coupled places: the (optional) buyer gross-up and the `application_fee_amount`. It can never be the service fee — the service fee is a separate `service_fee` term with its own switch and its own purpose (Stripe-cost recovery), never `application_fee_amount`.
- **Not mistaken for the service fee:** in `pricing_breakdown` (main SPEC §C.6) `mingla_fee_cents` and `service_fee_cents` are distinct keys; `application_fee_amount_cents` equals `mingla_fee_cents`, never `service_fee_cents`. The DESIGN artifact folds a *passed* Mingla fee into the subtotal (no named buyer line) and gives only the *service fee* a named buyer line — reinforcing that they are different things to the buyer too.

### 2.4 One-line mental model (put in a code comment per Constitution #8 "why")
> **Take-rate = Mingla's profit (set by Seth, collected via `application_fee_amount`). Service fee = Stripe's cost recovery (set by the brand's switch). Stripe's processing fee = paid by the connected account. Three levers, three owners, never netted.**

---

## A. DATA MODEL (dispatch §A)

### A.1 Why basis points, integer (🔒 LOCKED)
The rate is stored as an **integer number of basis points (bps)**: `500 = 5.00%`, `150 = 1.50%`, `725 = 7.25%`.
- **Rationale (avoids float drift):** money math in this engine is integer-cents end-to-end (`base_cents`, `application_fee_amount_cents`). Storing the rate as a float (`0.05`) reintroduces IEEE-754 representation error into the one multiplication that decides Mingla's revenue (`base_cents × rate`). Integer bps keeps the entire computation in integer arithmetic: `application_fee_amount = round(base_cents × bps / 10000)` — a single integer multiply + integer divide with one explicit rounding step, deterministic and auditable. This mirrors Stripe's own zero-float money convention (amounts in the smallest currency unit — https://docs.stripe.com/currencies#zero-decimal and https://docs.stripe.com/api/payment_intents/object#payment_intent_object-amount). bps also makes the admin UI unambiguous (whole-number percent to two decimals) and makes the guardrail a simple integer range check.

### A.2 Global default — `platform_pricing_config` singleton (🔒 LOCKED)
A single-row config table (singleton pattern) — NOT a column on `brands`, because the global default is a platform-level fact, not a brand fact:

```sql
CREATE TABLE public.platform_pricing_config (
  id                       boolean PRIMARY KEY DEFAULT true,   -- singleton guard
  default_take_rate_bps    integer NOT NULL DEFAULT 150,       -- 1.50% = current hardcoded value (§1.3)
  updated_at               timestamptz NOT NULL DEFAULT now(),
  updated_by               uuid REFERENCES auth.users(id),     -- audit: who last changed it
  CONSTRAINT platform_pricing_config_singleton CHECK (id = true),
  CONSTRAINT platform_pricing_config_default_take_rate_bounds
    CHECK (default_take_rate_bps BETWEEN 0 AND 3000)           -- guardrail: 0%–30.00% (§A.6)
);
-- Seed the singleton at migration time with the current effective rate so nothing moves (§A.4):
INSERT INTO public.platform_pricing_config (id, default_take_rate_bps)
  VALUES (true, 150)
  ON CONFLICT (id) DO NOTHING;
```

- **Singleton via `id boolean PRIMARY KEY DEFAULT true` + `CHECK (id = true)`** — the canonical Postgres single-row enforcement (only one row can ever exist). `[CONFIRM at IMPLEMENT]` this pattern against any existing singleton table convention in the repo; if the codebase already uses a `app_config`/`platform_config` table, EXTEND it rather than add a parallel one (subtract-before-adding, Constitution #8) — grep `supabase/migrations/` for an existing platform/global config table first.
- `updated_by` is nullable only to allow the seed row; every admin write sets it (§D.4).

### A.3 Per-brand override — column on `brands` (🔒 LOCKED)
A nullable override column on `brands` (NULL = "use the global default"), NOT a separate `brand_pricing_overrides` table:

```sql
ALTER TABLE public.brands
  ADD COLUMN take_rate_bps_override        integer,            -- NULL = inherit platform default
  ADD COLUMN take_rate_override_updated_at timestamptz,        -- audit: when the override last changed
  ADD COLUMN take_rate_override_updated_by uuid REFERENCES auth.users(id),  -- audit: who
  ADD CONSTRAINT brands_take_rate_override_bounds
    CHECK (take_rate_bps_override IS NULL OR take_rate_bps_override BETWEEN 0 AND 3000);  -- same guardrail
```

- **Rationale for a column, not a side table:** the override is 1:1 with a brand, read on the checkout hot path (one fewer join), and the main spec already adds `default_pass_*` + `pricing_*` columns to `brands` (§A.1 of main spec) — co-locating the override matches that established shape and the `COALESCE(events.x, brands.x)` resolution idiom. A side table would only earn its keep with rate *history/scheduling*, which is a non-goal (§ Non-goals).
- **NULL semantics deliberate:** NULL = inherit (the common case); a non-NULL value = this brand is on a negotiated rate. This is the exact three-valued idiom the main spec uses for `events.pass_x` (NULL=inherit).

### A.4 Backfill / defaults (decision: nothing changes economically — dispatch §D) (🔒 LOCKED)
- `platform_pricing_config.default_take_rate_bps` seeds to **150 (= 1.50%)** — the exact current hardcoded value (§1.3). So the global default reproduces today's behavior on day one.
- `brands.take_rate_bps_override` defaults to **NULL** for all existing rows → every existing brand inherits the 150 bps default → **every existing brand keeps paying exactly 1.50%, byte-for-byte unchanged**, until Seth deliberately edits the default or sets an override. Decision #4-style "nothing visibly moves" is preserved for the take-rate.
- No data backfill loop needed — the column default (NULL) + the seeded singleton (150) achieve it by construction.

### A.5 Migration filename (🔒 LOCKED — COMMS-0004 SOP)
- Do NOT hardcode a timestamp here. At IMPLEMENT, grep `~/Desktop/mingla-orchs/*/supabase/migrations/` + `main` for the highest `2026MMDD` prefix and pick a strictly-greater timestamp (per main SPEC §A.6 + COMMS-0004). This amendment's migration must sort AFTER the main spec's `<TS>_orch_1006_pricing_switches.sql` (it references `brands`, which the main migration also alters — order them so both apply cleanly; if landed in one IMPLEMENT pass, fold these columns into the main pricing-switches migration to avoid an extra file, but the singleton TABLE stays its own statement). Suggested base name if separate: `<TS+2>_orch_1006_configurable_take_rate.sql`.

### A.6 Guardrail (🔒 LOCKED — fat-finger protection)
- **Range: 0–3000 bps (0.00%–30.00%) inclusive**, enforced by a DB `CHECK` on BOTH the singleton default and the per-brand override (above), AND re-validated in the admin RPC (§D.4) AND in the admin UI (§C.5) — defense in depth so a fat-finger can't set 500% (50000 bps) at any layer.
  - Lower bound `0` allows a deliberate 0% (free/promotional brand) — legitimate, not a footgun.
  - Upper bound `3000` (30%) is a generous ceiling well above any realistic platform take while making a misplaced decimal (e.g. typing 500 meaning 5% but into a percent field that expects 5 → caught; typing 5000 → rejected) impossible to persist. `[OPEN — operator] §H T-A: confirm 30% ceiling; lower it to e.g. 1500 bps (15%) if Seth wants a tighter clamp.`
- The DB CHECK is the last line of defense (it survives any client/RPC bug). The RPC + UI checks give a friendly error before the DB ever rejects.

### A.7 RLS (🔒 LOCKED)
- `platform_pricing_config`: RLS enabled. **No anon/consumer/business access at all** — it is platform-internal. Only the admin RPC (`SECURITY DEFINER`, §D.4) and the checkout edge function (service-role context) read it. No public SELECT policy. Buyer-facing surfaces never see the raw rate; they only ever see the resolved `pricing_breakdown` numbers the engine already exposes.
- `brands.take_rate_bps_override`: the column inherits `brands` RLS, BUT it must NOT be exposed in any public/anon view (`business_public_events_view`, `claimed_venues_public_view`, brand public page) — it is commercially sensitive (a brand's negotiated rate). Mirror the ORCH-0964 security-definer view pattern (COMMS-0009): the public views select an explicit column list; this column is simply omitted. The brand-owner themselves should NOT be able to edit it (it's a Seth-negotiated rate) — the brand-owner UPDATE policy on `brands` must EXCLUDE `take_rate_bps_override` (or the admin RPC is the only writer and the column is not in any brand-self-service write path). `[CONFIRM at IMPLEMENT]` the brand-owner UPDATE policy on `brands` does not grant the brand write access to this column.

---

## B. RESOLUTION LOGIC (dispatch §B)

### B.1 Effective-rate resolution (🔒 LOCKED)
At checkout, the effective take-rate in bps is:

```
effective_take_rate_bps = COALESCE(brands.take_rate_bps_override, platform_pricing_config.default_take_rate_bps)
```

Per-brand override wins if present; otherwise the global default. This is the identical `COALESCE(override, default)` idiom the main spec uses for the pass/absorb switches (§C.1) — one consistent resolution pattern across the engine.

### B.2 Where the read happens (🔒 LOCKED — replaces the hardcoded line)
- **Today:** `MINGLA_APPLICATION_FEE_RATE = 0.015` constant at `ticket-checkout-create/index.ts:615`; `applicationFeeAmountCents = Math.round(totalCents * 0.015)` at lines 616-618 (PROVEN, §1.3).
- **After:** the money engine (main SPEC §C.3 step 2) reads `effective_take_rate_bps` and computes `mingla_fee = round(base_cents × effective_take_rate_bps / 10000)`. The literal `0.015` and the `MINGLA_APPLICATION_FEE_RATE` constant are **DELETED** (Constitution #8 — no drift; a leftover constant that nothing reads is a future-bug magnet).
- **Read site (🔒 LOCKED):** the rate is read **server-side inside the same RPC the main spec already extends** — `biz_ticket_checkout_create_session` — which the main SPEC §C.3 already designates as the single price source returning the resolved switches + venue address + region/currency. **Add the resolved `effective_take_rate_bps` to that RPC's returned shape.** This keeps ONE round-trip (no extra query on the hot path) and ONE owner of the price inputs. `[CONFIRM at IMPLEMENT]` the latest `biz_ticket_checkout_create_session` definition and extend it to `JOIN platform_pricing_config` (singleton) + read `brands.take_rate_bps_override`, returning `effective_take_rate_bps`. The edge function then uses that value where it used `0.015` — the engine multiply changes from `× 0.015` to `× bps / 10000`.
- The resolved `effective_take_rate_bps` is recorded in `pricing_breakdown` (§E) so the receipt + refund + reporting are auditable and the value charged is provable after the fact (even if Seth later changes the rate, historical orders carry the rate they were charged at).

### B.3 Caching / perf note (🔒 LOCKED, implementation-quality)
- The singleton `platform_pricing_config` is read once per checkout via the existing RPC JOIN — negligible cost (single-row PK lookup, already inside a query that hits `brands`). No separate Stripe round-trip (unlike the registration probe T-4 in the main spec) — this is a pure DB read.
- The admin UI may read the config on screen load; that is a one-row select, no caching needed.
- **Point-in-time correctness:** because the rate is read at session-create and frozen into `pricing_breakdown`, a rate change mid-checkout cannot retroactively alter an in-flight session — the buyer pays the rate that was effective when their session was created. Document this in the engine code comment.

---

## C. ADMIN-WEB UI CONTRACT (`mingla-admin`) (dispatch §C)

Stack: React 19 + Vite + JSX + Tailwind v4 (per the Mingla stack map — `mingla-admin/` uses React Context for Auth/Theme/Toast, direct Supabase calls, no React Query, no Zustand). This section defines the **functional contract + fields + states fully**; the **visual/layout** specifics are 🎨 OPEN for an optional `mingla-designer` pass (§G), but the functional floor below is 🔒 LOCKED.

### C.1 Screen (🔒 LOCKED, functional)
A "Platform Pricing" / "Take-rate" screen (or a section within an existing admin Settings page — `[CONFIRM at IMPLEMENT]` whether `mingla-admin` has a Settings page to host it; prefer extending one over adding a new top-level page). It has two regions:
1. **Global default** — a single labeled numeric field for the platform-wide default take-rate (percent, two decimals; stored as bps).
2. **Per-brand overrides** — a list of brands that currently have an override, with add / edit / remove; plus a way to add an override for a brand not yet in the list.

### C.2 Global default field (🔒 LOCKED, functional)
- Label: "Mingla platform take-rate (default)". Helper text: "Mingla's cut of each transaction. Applies to all brands unless overridden below." (copy 🎨 OPEN-for-designer; intent LOCKED).
- Input: percent with two-decimal precision (e.g. `5.00`). Converted to bps on save (`5.00% → 500 bps`).
- Pre-filled with the current `default_take_rate_bps / 100`.
- Validation: numeric, ≥ 0.00, ≤ 30.00 (the §A.6 guardrail in percent terms), max two decimals. Inline error on violation; Save disabled while invalid.

### C.3 Per-brand override list (🔒 LOCKED, functional)
- Each row: brand name (+ brand id/slug for disambiguation), the override percent, edit + remove controls.
- **Add override:** a brand picker (search/select an existing brand) + a percent field with the same validation as C.2. On save → sets `brands.take_rate_bps_override`.
- **Edit override:** change the percent → updates the column.
- **Remove override:** clears `brands.take_rate_bps_override` to NULL → that brand reverts to the global default. Removal requires confirmation (§C.6).
- Each row shows the EFFECTIVE rate so it's unambiguous (the override value == effective for overridden brands; for clarity the list may also show "(default: X%)" — 🎨 OPEN).

### C.4 Validation + guardrail (🔒 LOCKED)
- Client-side: reject < 0, > 30.00 (= §A.6 bounds), non-numeric, > 2 decimals — with an inline message before submit (e.g. "Enter a rate between 0% and 30%"). Save disabled until valid.
- This is the FRIENDLY layer; the RPC (§D.4) and DB CHECK (§A.6) are the authoritative layers. The UI must still handle an RPC rejection gracefully (toast the server error) in case of a stale client.

### C.5 States (all required — 🔒 LOCKED functional; 🎨 OPEN visual)
| State | Behavior / copy (Mingla voice; copy 🎨 OPEN) |
|---|---|
| Loading | Skeleton/spinner while the config + overrides load. |
| Loaded / populated | Global field pre-filled; override list rendered (or empty-state if none). |
| Empty (no overrides) | "No brand overrides yet. Every brand uses the default rate." + an "Add override" affordance. |
| Editing / dirty | Save enabled only when a field changed AND is valid; a "discard" path. |
| Submitting | Save shows a pending state; controls disabled to prevent double-submit. |
| Success | Toast "Take-rate updated" (existing admin Toast context); values reflect the saved state; the new rate applies to all FUTURE checkouts immediately (no deploy). |
| Validation error | Inline message + Save disabled (§C.4). |
| Server/permission error | Toast the server error (e.g. "You don't have permission" if a non-admin somehow reaches it; "Couldn't save — try again" on network). The change is NOT applied; the prior value remains shown. |
| Offline / network fail | Save fails loud (no silent success — Constitution #3); retry affordance. |

### C.6 Confirmation on change (🔒 LOCKED, functional)
- Because this is real money, **every persist requires an explicit confirm step** (a modal or an inline "Confirm" two-step), stating the brand affected + old → new rate (e.g. "Change Acme Venue's take-rate from 5.00% to 3.00%? This applies to all future sales.") and that it does NOT affect already-sold orders (those carry the rate they were charged at — §B.2). Removal confirms "Acme Venue will revert to the default 5.00%." 🎨 OPEN: modal vs inline-confirm visual.

### C.7 Who can edit — admin auth (🔒 LOCKED)
- The screen is reachable only by an authenticated **admin** user of `mingla-admin` (the admin app already gates behind its Auth context). The persist path (§D.4) re-checks admin authorization server-side — the UI gate is convenience, the RPC gate is authority (never trust the client).
- `[CONFIRM at IMPLEMENT]` how `mingla-admin` identifies an admin (an `is_admin` flag / a role claim / an allowlist table). The RPC's admin check (§D.4) MUST use that same authority. If no admin-role concept exists yet, that is a blocker — surface it (§H T-B) rather than shipping an unauthenticated money lever.

---

## D. ADMIN PERSIST PATH — edge function / RPC (dispatch §C)

### D.1 Shape (🔒 LOCKED)
A single admin-only writer. Two viable homes — pick at IMPLEMENT per repo convention:
- **(Preferred) A `SECURITY DEFINER` RPC** `admin_set_platform_take_rate(...)` + `admin_set_brand_take_rate_override(...)` (or one RPC with a discriminator), called from `mingla-admin` via the Supabase client. RLS/auth enforced inside the RPC. No new edge function → no COMMS-0002 backend-allowlist edge-function entry (only the migration needs the allowlist). This is the lighter-weight path and matches how `mingla-admin` does "direct Supabase calls."
- **(Alternative) A new edge function** `admin-set-take-rate` if admin writes must run with service-role + extra audit/logging the RPC can't do. **If this path is chosen it is a NEW `supabase/functions/` file → it REQUIRES the `ORCH_1006_BACKEND_ALLOWLIST` entry in `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` in the same commit (COMMS-0002), or CI fails.**

`[OPEN — implementor judgment within the locked contract]` RPC vs edge function. Default recommendation: **RPC** (lighter, matches admin's direct-Supabase pattern, no new edge file). Whichever is chosen, the auth + guardrail + audit contract below is LOCKED.

### D.2 Operations (🔒 LOCKED)
1. `set_global_default(new_bps)` — writes `platform_pricing_config.default_take_rate_bps`, `updated_at = now()`, `updated_by = auth.uid()`.
2. `set_brand_override(brand_id, new_bps)` — writes `brands.take_rate_bps_override`, `take_rate_override_updated_at = now()`, `take_rate_override_updated_by = auth.uid()`.
3. `clear_brand_override(brand_id)` — sets `brands.take_rate_bps_override = NULL` (+ audit stamps).

### D.3 Auth gate (🔒 LOCKED)
- Server-side admin check FIRST (before any write), using the same admin authority the admin app uses (§C.7). Non-admin → reject with a clear error (`not_authorized`). This is an `SECURITY DEFINER` function, so it MUST gate explicitly (a definer function with no auth check is an RLS bypass — automatic P0). Pair an owner/admin-direct predicate per `[[rls-returning-owner-gap]]`.

### D.4 Validation (🔒 LOCKED)
- Re-validate `0 ≤ new_bps ≤ 3000` inside the RPC and raise `take_rate_out_of_bounds` on violation (don't rely on the DB CHECK alone for the error message; the CHECK is the backstop). Reject non-integer bps.

### D.5 Audit (🔒 LOCKED)
- `updated_by`/`updated_at` (global) and `take_rate_override_updated_by`/`take_rate_override_updated_at` (per-brand) record who changed what, when. `[OPEN — operator] §H T-C:` if Seth wants a full immutable change-log (every historical rate, not just the latest), that needs an append-only `platform_pricing_audit` table — flagged as an optional follow-up, NOT built this amendment (the `updated_by/at` stamps cover the minimum audit requirement the dispatch asked for).

### D.6 Docs cites (COMMS-0003)
- This admin path touches NO Stripe API (it only writes DB config). The Stripe-facing change is entirely in the checkout engine (§B, already doc-cited in §2). No external-API enum is introduced here; the only "API" is the Supabase RPC. (COMMS-0003 satisfied — the Stripe parameters touched, `application_fee_amount` under direct charges, are cited in §2.)

---

## E. INTERACTION WITH THE BRAND PASS/ABSORB SWITCH + WORKED EXAMPLE (dispatch §E)

### E.1 Clarification (🔒 LOCKED)
- **The take-rate sets the AMOUNT of the Mingla fee.** (`mingla_fee = round(base × effective_take_rate_bps / 10000)`.)
- **The brand's `pass_mingla_fee` switch decides WHO BEARS it** (buyer via gross-up, or brand via reduced payout).
- These compose cleanly: the switch reads the amount the take-rate produced. Neither replaces the other. The service fee (`pass_service_fee`) is a THIRD, unrelated term (Stripe-cost recovery).
- `pricing_breakdown` must carry the resolved `effective_take_rate_bps` AND `mingla_fee_cents` AND its pass/absorb split (the main-spec §C.6 `passed`/`absorbed` partition already does this for `mingla_fee_cents`; this amendment adds the `effective_take_rate_bps` field so the rate itself is auditable):

```jsonc
// addition to main-spec §C.6 pricing_breakdown:
"effective_take_rate_bps": 500,     // the resolved rate this order was charged at (override or default)
"take_rate_source": "brand_override" | "platform_default"
```

### E.2 Worked numeric example (🔒 LOCKED — dispatch-mandated)
**Scenario:** £40.00 ticket (`base = 4000` p), **Mingla take-rate 5.00% (500 bps)**, **service fee 3.00%** (Stripe-cost recovery, illustrative), **UK GB region → 20% VAT, inclusive by law**. All amounts in pence; rounding `round(half-up)` per cent.

**Common to both:**
- `base = 4000`
- `mingla_fee = round(4000 × 500 / 10000) = round(200) = 200` (£2.00) → this is `application_fee_amount` ALWAYS.
- `service_fee = round(4000 × 300 / 10000) = round(120) = 120` (£1.20).
- Stripe's processing fee (UK standard, illustrative ~1.5% + 20p): borne by the **connected account (brand)** under direct charges (§2.2) — NOT by Mingla, NOT a separate buyer line. Computed on the final charged amount.

---

**CASE 1 — brand PASSES the Mingla fee (`pass_mingla_fee = true`), passes service fee, GB inclusive VAT:**

| Step | Calc | Pence |
|---|---|---|
| base | — | 4000 |
| + Mingla fee (passed, on top) | +200 | 4200 |
| + service fee (passed, on top) | +120 | 4320 |
| buyer_subtotal | — | 4320 |
| tax (GB inclusive) | VAT is *inside* 4320; `amount_total == buyer_subtotal` | 4320 |
| **buyer_total (what buyer pays)** | = amount_total | **4320 (£43.20)** |
| VAT portion (inclusive, shown on receipt only) | `4320 − round(4320 / 1.20) = 4320 − 3600 = 720` | 720 (£7.20) |
| `application_fee_amount` (→ Mingla) | = mingla_fee | **200 (£2.00) = Mingla GROSS margin** |
| Stripe processing fee (→ Stripe, paid by brand) | ~`round(4320 × 0.015) + 20 = 65 + 20 = 85` (illustrative) | 85 (£0.85) |
| **Brand payout** | `buyer_total − application_fee − stripe_fee − VAT-remitted` = `4320 − 200 − 85 − 720` | **3315 (£33.15)** |

Note: VAT (720) is the brand's to remit to HMRC if VAT-registered (it's inside the price; the brand is merchant of record under direct charges). If the brand is not VAT-registered/under threshold, the "VAT portion" is just part of the brand's revenue (UK legal for sub-threshold sellers — main SPEC §B.5 / T-1). Mingla's margin is the £2.00 regardless.

---

**CASE 2 — brand ABSORBS the Mingla fee (`pass_mingla_fee = false`), passes service fee, GB inclusive VAT:**

| Step | Calc | Pence |
|---|---|---|
| base | — | 4000 |
| + Mingla fee (absorbed → NOT added to buyer) | +0 | 4000 |
| + service fee (passed, on top) | +120 | 4120 |
| buyer_subtotal | — | 4120 |
| tax (GB inclusive) | `amount_total == buyer_subtotal` | 4120 |
| **buyer_total (what buyer pays)** | = amount_total | **4120 (£41.20)** |
| VAT portion (inclusive, receipt only) | `4120 − round(4120 / 1.20) = 4120 − 3433 = 687` | 687 (£6.87) |
| `application_fee_amount` (→ Mingla) | = mingla_fee (STILL skimmed, even though absorbed) | **200 (£2.00) = Mingla GROSS margin** |
| Stripe processing fee (→ Stripe, paid by brand) | ~`round(4120 × 0.015) + 20 = 62 + 20 = 82` (illustrative) | 82 (£0.82) |
| **Brand payout** | `4120 − 200 − 82 − 687` | **3151 (£31.51)** |

---

**The two cases side by side (the whole point of the switch):**

| | Case 1: PASS Mingla fee | Case 2: ABSORB Mingla fee |
|---|---|---|
| Buyer pays | **£43.20** | **£41.20** |
| Mingla gross margin (`application_fee_amount`) | **£2.00** | **£2.00** (identical — take-rate unchanged) |
| Stripe fee (paid by brand) | £0.85 | £0.82 |
| Brand payout | £33.15 | £31.51 |

**Reading of the comparison (the clarification, proven by numbers):**
- The **take-rate is identical (£2.00 = 5% of base) in BOTH cases** — the rate sets the amount; the switch does not change the amount. ✅
- The **switch changes who bears it:** PASS → buyer pays £2.00 more (£43.20 vs £41.20) and the brand's payout is margin-neutral on the Mingla fee. ABSORB → buyer pays £2.00 less, and the brand eats the £2.00 (lower payout, £31.51 incl. the £2.00 it absorbed). ✅
- **`application_fee_amount` is NEVER the service fee** — the service fee (£1.20) is in the buyer total in both cases (it's `pass_service_fee=true`), and Mingla's skim is the separate £2.00. No double-charge: the £2.00 appears once in the buyer total (Case 1 only) and is skimmed once via `application_fee_amount` (both cases). ✅
- **Stripe's processing fee is the brand's, not Mingla's, and not a buyer line** — it just reduces the brand payout. ✅

(Stripe processing-fee numbers are illustrative — the exact UK Stripe rate is set in Stripe's pricing, not in our code; what's LOCKED is that it lands on the connected account, §2.2.)

---

## F. SUCCESS CRITERIA, INVARIANTS, TESTS, CI (dispatch §F)

### F.1 Success criteria (observable, testable)
- **SC-A1**: With the global default at 5.00% (500 bps) and no brand override, a £40 GB order computes `application_fee_amount = 200` p (= 5% of base), recorded as `effective_take_rate_bps: 500, take_rate_source: "platform_default"` in `pricing_breakdown`.
- **SC-A2**: With a brand override of 3.00% (300 bps), the SAME £40 order computes `application_fee_amount = 120` p, `effective_take_rate_bps: 300, take_rate_source: "brand_override"`. Other brands (no override) still compute at the 500 bps default in the same run.
- **SC-A3**: Pre-migration / pre-edit, every brand's effective rate = 150 bps (1.50%) → existing economics UNCHANGED (§A.4). (Migration default proof.)
- **SC-A4**: Seth changes the default in `mingla-admin`; the next checkout uses the new rate with NO deploy; an in-flight session created before the change still charges the old rate (point-in-time, §B.3).
- **SC-A5**: Pass vs absorb Mingla fee both skim the identical `application_fee_amount` for the same rate; only the buyer total + brand payout differ (the §E worked example).
- **SC-A6**: Take-rate and service fee are distinct in `pricing_breakdown` (`application_fee_amount_cents == mingla_fee_cents ≠ service_fee_cents`); no double-charge.
- **SC-A7 (guardrail)**: Attempting to set a rate < 0 or > 3000 bps is rejected at the UI, at the RPC (`take_rate_out_of_bounds`), AND at the DB CHECK.
- **SC-A8 (auth)**: A non-admin caller of the persist RPC is rejected (`not_authorized`); the value is unchanged.
- **SC-A9 (audit)**: After a change, `updated_by`/`updated_at` (and the per-brand stamps) reflect the admin user + time.

### F.2 Invariants
**Preserved:**
- `I-stripe-direct-charges-only` — the amendment keeps `application_fee_amount` on the direct charge; no `transfer_data.destination`.
- Currency/bps integer-money invariant (Constitution #10 + the main spec's currency-aware invariant) — see new invariant below.

**NEW (🔒 LOCKED):**
- **I-PROPOSED-TAKE-RATE-BPS-INTEGER** — the take-rate is stored and computed as integer basis points; the engine computes `application_fee_amount` via integer `round(base_cents × bps / 10000)`. No float rate (`0.015`-style literal) may exist on the fee path. **Strict-grep:** ban the literal `MINGLA_APPLICATION_FEE_RATE` and a hardcoded `* 0.015` (or any `application_fee` float multiplier) in `ticket-checkout-create`.
- **I-PROPOSED-TAKE-RATE-CONFIG-RESOLVED** — `application_fee_amount` MUST derive from `COALESCE(brands.take_rate_bps_override, platform_pricing_config.default_take_rate_bps)`, never from a hardcoded constant. **Strict-grep:** assert the resolution read exists; ban re-introduction of a hardcoded rate constant.
- **I-PROPOSED-TAKE-RATE-WITHIN-BOUNDS** — every persisted rate (default + override) is within `[0, 3000]` bps; the admin RPC rejects out-of-bounds.

### F.3 Test cases (implementor writes happy-path; tester writes adversarial — different angles)
| Test | Scenario | Input | Expected | Layer | Angle |
|---|---|---|---|---|---|
| TR-01 | Global default applies | default 500, no override, £40 GB | `application_fee_amount=200`; bps=500; source=platform_default | Edge+DB | happy (impl) |
| TR-02 | Per-brand override wins | brand override 300, £40 | `application_fee_amount=120`; bps=300; source=brand_override | Edge+DB | happy |
| TR-03 | Mixed in one run | brand A override 300, brand B none, default 500 | A→120, B→200 in the same checkout batch | Edge+DB | adversarial (test) |
| TR-04 | Migration default unchanged | pre-edit order | effective bps=150 (1.50%) — economics unchanged | Migration | happy |
| TR-05 | No-deploy change | edit default in admin → new checkout | new rate applied without redeploy | Admin+Edge | happy |
| TR-06 | Point-in-time | session created at rate 500, rate changed to 300 mid-flight, then finalize | order charged at 500 (frozen in breakdown) | Edge | adversarial |
| TR-07 | Pass vs absorb identical skim | £40, rate 500, pass vs absorb mingla fee | application_fee=200 both; buyer total differs; (the §E example) | Edge | adversarial |
| TR-08 | Not the service fee | rate 500 + service fee 300 | `application_fee=mingla_fee=200 ≠ service_fee=120`; no double-charge | Edge | adversarial |
| TR-09 | Guardrail UI | type 500% / -1% / 5.001% | UI blocks, Save disabled | Admin UI | adversarial |
| TR-10 | Guardrail RPC | call RPC with bps=50000 / -1 / 5.5 (non-int) | `take_rate_out_of_bounds` / rejected | RPC | adversarial |
| TR-11 | Guardrail DB | attempt direct UPDATE to 50000 bps | DB CHECK rejects | DB | adversarial |
| TR-12 | Non-admin blocked | non-admin calls persist RPC | `not_authorized`; value unchanged | RPC/RLS | security |
| TR-13 | Override exposure | anon hits public brand/event view | `take_rate_bps_override` absent from response | View/RLS | security |
| TR-14 | Refund math | full + partial refund on an order with bps=500 | platform fee clawback uses the order's recorded rate, not the current default | Edge | adversarial |
| TR-15 | Installments | installment plan, rate 500 | each installment's app-fee derives from the order's frozen rate | Edge+cron | adversarial |
| TR-16 | Audit stamp | admin sets rate | `updated_by`=admin uid, `updated_at`≈now | DB | happy |

### F.4 Regression prevention
- The new strict-grep gates (F.2) prevent re-introducing a hardcoded rate.
- TR-14/TR-15 protect the refund + installment paths (which read the persisted fee) from drifting when the rate becomes dynamic — they MUST read the order's recorded `application_fee_amount`/`effective_take_rate_bps` from `pricing_breakdown`, never recompute against the current default.
- Any existing test asserting the 1.5% constant must be repointed under `[TEST-MOD-APPROVED ORCH-1006]` to assert the resolved-rate path. `[CONFIRM at IMPLEMENT]` whether `orch_0955_native_stripe_tax.test.ts` or another test pins `0.015`.

### F.5 CI / strict-grep (COMMS-0002) (🔒 LOCKED)
- The new migration (singleton table + `brands` columns) is a NEW file under `supabase/migrations/` → REQUIRES an `ORCH_1006_BACKEND_ALLOWLIST` entry in `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` (C7 `no-new-backend-files`) in the same commit, or CI fails.
- IF the admin persist path is a NEW edge function (§D.1 alternative), that file ALSO needs the allowlist entry. (The RPC path avoids this.)
- New strict-grep gate file(s) for F.2 invariants also need the allowlist entry + a workflow job (mirror the main-spec §G.6 + ORCH-0963 precedent).

### F.6 Cross-surface impact (amendment-scoped)
| Surface | Covered? | Note |
|---|---|---|
| Consumer iOS / Android | YES (indirect) | The resolved rate flows into the buyer total the engine already computes; no consumer UI change beyond what the main spec ships. |
| Buyer/anon Web | NO (buyer path) | Web buyer checkout is out of scope per main spec §F.2; BUT the take-rate config is read server-side at checkout, so IF web checkout also routes through the same fee computation it inherits the configurable rate. `[CONFIRM at IMPLEMENT]` whether the web hosted-Checkout path computes `application_fee_amount` from the same constant (INVESTIGATION shows web uses Checkout Sessions; verify its app-fee source and repoint it to the resolved rate too, else web + native diverge on Mingla's own margin). **This is a real divergence risk — see §H T-D.** |
| Business iOS / Android | YES (indirect) | Same as consumer. |
| **Admin Web (`mingla-admin/`)** | **YES (the new UI)** | The take-rate screen (§C). NEW surface for this amendment — the main spec §F marked admin "NO"; this amendment ADDS it. |
| Business Web preview | N/A | No buyer pricing authored there. |

### F.7 Backend allowlist (COMMS-0002) — HARD implementor checklist item
- Migration file → `ORCH_1006_BACKEND_ALLOWLIST`. Edge function (if chosen) → same. Strict-grep gate files → same. All in the landing commit.

---

## G. 🎨 DESIGNER HANDOFF (optional `mingla-designer` pass — admin surface)

The **functional contract above is LOCKED.** The following are 🎨 OPEN for an optional designer pass (the admin take-rate screen is a low-traffic internal tool, so a full premium-craft pass is optional — the functional floor is sufficient to ship; flag to Seth whether he wants a polish pass):
1. Layout of the global-default field + per-brand override list (table vs cards; `mingla-admin` is Tailwind v4 — match existing admin page conventions/tokens).
2. The confirmation modal vs inline-confirm treatment (§C.6).
3. Exact Mingla-voice copy for labels, helper text, confirm dialog, and all state messages (§C.5).
4. Empty-state + success-toast styling (reuse the existing admin Toast context).
5. How the effective rate + "(default: X%)" hint reads in each override row.

🎨 OPEN items for a designer (consolidated for the dispatch return): admin screen layout, confirm dialog treatment, all copy, empty/success states, override-row effective-rate display. Everything functional (fields, validation, guardrail, auth, states-exist, RPC contract) is LOCKED.

---

## H. TENSIONS / INFEASIBILITY FLAGS (do not paper over)

- **T-A (guardrail ceiling).** §A.6 proposes 0–30% (0–3000 bps). 30% is a generous fat-finger ceiling; if Seth wants a tighter clamp (e.g. 15%) say so — purely a constant. Not infeasible; operator confirm.
- **T-B (admin-role authority may not exist).** §C.7/§D.3 require a server-side admin check. If `mingla-admin` has no first-class admin-role / `is_admin` concept (it may gate purely on "can authenticate to the admin app"), then the persist RPC's "admin only" gate has nothing authoritative to check, and shipping a money lever behind only client-side auth is a P0 security gap. **The implementor MUST confirm the admin authority mechanism at IMPLEMENT; if none exists, that is a blocker to surface to Seth, not to paper over with a client-only gate.**
- **T-C (audit depth).** §D.5 ships `updated_by/at` stamps (latest-change only), which meets the dispatch's "who/when changed" ask. A full immutable rate-history log is a deliberate non-goal; flag if Seth wants it.
- **T-D (web vs native take-rate divergence).** §F.6 — if the web hosted-Checkout path computes `application_fee_amount` from its own copy of the 1.5% constant and is NOT repointed to the resolved rate, then the SAME brand could pay a different Mingla margin on web vs native after Seth edits the rate. The main spec already flags a native↔web TAX divergence (its §F.2); this is the analogous FEE divergence. **Recommendation: repoint BOTH paths to the resolved rate in this amendment's IMPLEMENT** (it's the same config read), even though the web BUYER experience is otherwise out of scope — Mingla's own margin should be consistent across surfaces. `[CONFIRM at IMPLEMENT]` the web path's app-fee source and repoint it. If deferred, register a COMMS entry + follow-up ORCH.
- **T-E (singleton table vs existing config).** §A.2 — if a platform/global config table already exists, EXTEND it rather than add `platform_pricing_config`. Grep first (Constitution #8). Not infeasible; a one-grep confirmation.

---

## I. NEXT ROUTING

This amendment folds into the main ORCH-1006 spec. Sequence: the main spec's designer pass (its §I) + this amendment → `mingla-implementor` (IMPLEMENT) implements the main spec AND this amendment together (they share the `brands` migration + the `biz_ticket_checkout_create_session` extension + the `pricing_breakdown` shape). The implementor MUST: resolve every `[CONFIRM at IMPLEMENT]` tag here AND in the main spec; confirm the admin-role authority (T-B) before wiring the persist gate; repoint the web app-fee source or register the divergence (T-D); add the COMMS-0002 backend-allowlist entries; write happy-path tests (tester writes adversarial). An optional `mingla-designer` pass on the admin screen (§G) is at Seth's discretion.
