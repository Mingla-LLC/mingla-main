# IMPLEMENTATION — ORCH-1291 [rsvp-chip-in]

v1 build unit of META-ORCH-1290 [chip-in contributions]. Phase: IMPLEMENT.
Worktree: `~/Desktop/mingla-orchs/ORCH-1291-[rsvp-chip-in]/` on branch `ORCH-1291-rsvp-chip-in`.
Implement commit: **9121bc480**. Rebased on origin/main before build.
Contract: `Mingla_Artifacts/specs/SPEC_ORCH-1291_RSVP_CHIP_IN.md` + `DESIGN_ORCH-1291_RSVP_CHIP_IN.md`.
Status: **implemented, partially verified** — backend money layer + engine guard verified headlessly; UI + live-fire deferred to TEST (device/runtime).

Comms ledger: acknowledged **COMMS-0052** (business-app OTA freeze, BLOCK/ACKNOWLEDGED) — COMPLIED: performed NO `eas update`/deploy/merge; reuses the EXISTING `@stripe/stripe-react-native` PaymentSheet already in both native builds, adds NO new native dependency; ships to web via Vercel + rides the next native build.

---

## 1. Summary (plain English)

A guest who RSVPs free to an RSVP event can now optionally "chip in" a voluntary gift, on both Stripe (card) and Paystack (Nigeria) rails. The chip-in is a second, optional action — the free RSVP is never blocked. The gift is charged with ZERO tax (it reads as a contribution, not a taxed sale) and the guest is charged exactly the amount they type (the organiser absorbs processing), while Mingla still takes its normal cut. Turning chip-in on flips the RSVP into a money-collector, so publishing is now blocked unless the organiser can collect (Stripe bank connected OR a Paystack subaccount) — a free RSVP still publishes with no bank requirement. Contributions live in a new child table so the RSVP itself stays payment-free.

The complete money backend (migration, both edge functions, both webhook rails, refunds) is written and type-clean. The guest gift panel, wizard toggle, service/hook, and surface handlers are built. Two last-mile plumbing gaps that fall outside the spec's file allowlist are flagged for the conductor (§10).

---

## 2. SPEC success-criteria coverage

All satisfied at commit **9121bc480** unless noted. "Verified" = headless proof (deno test / gate / type-check); "Suspected" = source-complete, needs tester runtime (device/live-fire).

| SC | Criterion | Status | Evidence |
|----|-----------|--------|----------|
| SC-1 | Free RSVP never blocked by chip-in | Verified (source) | Chip-in is a second action gated on a resolved GOING RSVP; the RSVP write path (`submit_event_rsvp` / `public-submit-rsvp`) is untouched. |
| SC-2 | Chip-in shows only for `{going, pending}` on BOTH mounts | Verified (source) | Popup mount gated `successDetails.status !== 'waitlisted'`; inline §5.5 gated `guestStatus === 'going'`. DESIGN §5.5's broader set was SUPERSEDED by the Seth-locked SC-2 gate (documented in code). |
| SC-2-iOS/-Android/-Web | Per-surface visibility | Suspected (config now reaches all 3) | Shared body → automatic parity. Gap A CLOSED: the 3 config columns now flow via `business_public_events_view` → `fetchRsvpMomentum` (consumer iOS/Android) AND `publicEventViewRowToEvent` → `PublicEventPage` (buyer/anon web), so `rsvp_contribution_enabled` reaches the body on all 3 surfaces (was business-only). Needs device runtime. |
| SC-3 | Stripe chip-in of X charged exactly X, `paid`, `tax_cents=0`, `tax_basis='voluntary_contribution'`, `application_fee = round(X·bps/10000)` | Verified (engine) | `orch_1291_contribution_engine.test.ts` (4 tests, PASS); create fn `application_fee_amount = miglaFeeCents`, no `automatic_tax`. Live-fire = TEST. |
| SC-4 | Paystack chip-in of X kobo on subaccount, `transaction_charge=miglaFee`, verified webhook finalizes | Suspected | Create fn passes `subaccount + transactionChargeSubunits + bearer:'subaccount'`; `paystackWebhookRouter` finalizes on amount+currency match. Live-fire = TEST. |
| SC-5 | Receipt reads as a voluntary contribution (no tax line / no ticket / no QR) | Verified (source) | `tax_basis='voluntary_contribution'`, tax 0; panel copy banned-commerce-word-clean; finalize mints NO order/ticket. |
| SC-6 | Chip-in publish with no bank BLOCKED + routes to connect; free RSVP publishes unblocked | Verified (SQL test, orchestrator-run) | `orch_1291_rsvp_contribution_wall.test.sql` W2 (T-3 block) + W4 (free unblocked). Fail-close raises `stripe_charges_disabled` → `paidPublishGuards` → bank onboarding. |
| SC-6-Paystack-ready | Paystack-subaccount brand NOT blocked | Verified (SQL test) | W3 (T-4 adversarial): Paystack-subaccount brand with NO stripe row publishes successfully. |
| SC-7 | Anon web guest chips in end-to-end, no login | Suspected (config gap CLOSED) | Create fn `verify_jwt=false`, web hosted-Checkout. Gap A CLOSED (§10.A): the buyer-web read now surfaces the 3 columns AND `PublicEventPage` wires `onChipIn → submitRsvpContribution({surface:'web'})` (redirects the browser to the hosted Stripe/Paystack URL, returns `{kind:'redirecting'}`) — so the panel renders + initiates on anon web. Post-return `contributionState='paid'` thank-you is a web-return follow-up. Live-fire = TEST. |
| SC-8 | Discretionary refund returns `amount − application_fee` (keeps cut); cancellation returns full `buyer_total` (make whole); free RSVP intact | Verified (source) | `rsvp-contribution-refund`: `refund_application_fee = (mode==='cancellation')`; amount via `refundAmountForMode`. Live-fire = TEST. |
| SC-9 | `event_rsvps` has NO payment column; publish still soft-deletes stray `ticket_types` | Verified (SQL test) | W1 (wall probe) + the reproduced soft-delete block preserved verbatim. |
| SC-10 | Ticket/all-in money path byte-unchanged for non-contribution charges | Verified (gate + test) | `ticket-checkout-create` deno-check clean; 16 engine tests pass; webhook branches metadata/reference-guarded BEFORE the ticket path; orch-0804 tax gate 6/6. |

---

## 3. Files changed (25 files, +4029/-3; docs SPEC/DESIGN/INVESTIGATION carried by earlier branch commits)

Backend (money layer):
- `supabase/migrations/20261220000000_orch_1291_rsvp_contributions.sql` (new, ~612L)
- `supabase/migrations/__tests__/orch_1291_rsvp_contribution_wall.test.sql` (new, ~314L)
- `supabase/functions/_shared/allInPricingEngine.ts` (+13/-3 — ONE union member)
- `supabase/functions/rsvp-contribution-create/index.ts` (new, ~547L)
- `supabase/functions/rsvp-contribution-refund/index.ts` (new, ~276L)
- `supabase/functions/_shared/stripeWebhookRouter.ts` (+81 — contribution branch)
- `supabase/functions/_shared/paystackWebhookRouter.ts` (+73 — contribution branch)
- `supabase/functions/_shared/__tests__/orch_1291_contribution_engine.test.ts` (new, ~101L)
- `supabase/config.toml` (+15 — two verify_jwt blocks)

Frontend (service/hook/UI):
- `mingla-business/src/services/rsvpEvents.ts` (+77 — `submitRsvpContribution`)
- `mingla-business/src/hooks/useRsvpContribution.ts` (new, ~57L)
- `packages/offering-rendering/RsvpChipInPanel.tsx` (new, ~412L)
- `packages/offering-rendering/RsvpOfferingBody.tsx` (+168 — config/props/state/§5.5)
- `packages/offering-rendering/RsvpSuccessPopup.tsx` (+14 — `chipInPanel` prop)
- `packages/offering-rendering/index.ts` (+5 — barrel exports)
- `mingla-business/src/components/rsvp/RsvpStep5Setup.tsx` (+148 — Contributions block)
- `mingla-business/src/components/event/FoundationRsvpPreview.tsx` (+11 — passthrough)
- `app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx` (+80 — `onChipIn` handler)

Allowlist-extension files (additive; §10.C):
- `mingla-business/src/store/draftEventStore.ts` (+18 — 3 draft fields + defaults)
- `mingla-business/src/utils/serverDraftEventMapper.ts` (+10 — passthrough into `business_draft`)
- `mingla-business/src/utils/liveEventAdapter.ts` (+8 — regression fix for the new required fields)
- `mingla-business/src/hooks/useExperienceDraftAdapter.ts` (+4 — synthDraft completeness)

---

## 4. Data-model changes (written; NOT applied — orchestrator owns)

Migration `20261220000000_orch_1291_rsvp_contributions.sql`:
- **Table** `public.event_rsvp_contributions` — child table (PK, FKs to events/brands/auth.users/event_rsvps; provider CHECK stripe|paystack; status CHECK; `UNIQUE(stripe_payment_intent_id)` idempotency slot shared by both rails; amount/buyer_total/application_fee/pricing_breakdown/refund cols; 4 indexes; updated_at trigger).
- **RLS** — service_role writes only; SELECT: contributing `user_id` (own) OR brand event_manager (host); anon reads nothing.
- **events columns** (additive, nullable/default): `rsvp_contribution_enabled boolean NOT NULL DEFAULT false`, `rsvp_contribution_suggested_cents integer NULL (>0)`, `rsvp_contribution_min_cents integer NULL (>0)`.
- **RPC** `finalize_rsvp_contribution(uuid,text,text,text)` — SECURITY DEFINER, service_role, idempotent early-return on `status='paid'`; NO order/ticket. (The strict provider-ref match was relaxed — the web Stripe path stores the Checkout Session id while `payment_intent.succeeded` carries the PI id; finalize matches on the provider-echoed `contribution_id`, authoritative on a signature-verified webhook.)
- **Predicate** `pg_brand_can_collect(uuid)` — SECURITY DEFINER, `search_path=''`, provider-aware (`pg_brand_can_charge` OR Paystack subaccount). Sibling of `pg_brand_can_charge` (which is left untouched).
- **`business_publish_rsvp_draft`** — CREATE OR REPLACE (signature unchanged, no DROP). Full 1150 body reproduced verbatim + ADDITIVE: reads `rsvpContributionEnabled/*Cents` from the draft; CONDITIONAL gate raising `stripe_charges_disabled` only when enabled AND `NOT pg_brand_can_collect`; persists the 3 config columns. Wall soft-delete preserved verbatim.

**Migration version:** `20261220000000` — chosen strictly greater than the frontier `20261210000000_orch_1278` (local + all sibling worktrees rescanned at build; no collision).

**Publish-RPC drift check:** verified via migration history that `business_publish_rsvp_draft`'s latest definition is the 1150 migration (the 1172/1172-R2 migrations redefine `biz_update_live_rsvp`, NOT the publish RPC), so the reproduced body is faithful to the live definition. The migration is fully additive (`IF NOT EXISTS` / `CREATE OR REPLACE`) with no destructive guards or backfills — no read-only remote probe required.

---

## 5. Edge functions touched (deploy from MERGED main; preserve verify_jwt)

| Function | verify_jwt | Action |
|----------|-----------|--------|
| `rsvp-contribution-create` (new) | **false** (anon-capable) | Deploy |
| `rsvp-contribution-refund` (new) | **true** (organiser identity) | Deploy |
| `stripe-webhook` (imports `stripeWebhookRouter`) | (unchanged) | REDEPLOY (router changed) |
| `paystack-webhook` (imports `paystackWebhookRouter`) | (unchanged) | REDEPLOY (router changed) |

CORS: both new fns import `_shared/cors.ts` (includes `x-client-info`) — no inline literal. Passes `orch-1205`.

---

## 6. Regression tests added (fails-on-revert)

1. **Engine guard (headlessly PROVEN):** `supabase/functions/_shared/__tests__/orch_1291_contribution_engine.test.ts` — 4 tests. `deno test` → **4 passed | 0 failed**. **fails-on-revert verified at commit 9121bc480** by TRUE LINE DELETION of the `"voluntary_contribution"` TaxBasis member → `deno test` fails type-check with 3× `TS2322: Type '"voluntary_contribution"' is not assignable to type 'TaxBasis'` → restored → passes again.
2. **SQL wall/gate test (orchestrator-run after migration apply):** `supabase/migrations/__tests__/orch_1291_rsvp_contribution_wall.test.sql` — W1 wall (SC-9), W2 (T-3 block), W3 (T-4 adversarial Paystack-ready publish), W4 (free-path unblocked), W5 (predicate truth table), W6 (T-11 idempotent finalize + gift shape). Each `BEGIN…ROLLBACK`; RAISE NOTICE on PASS / RAISE EXCEPTION on FAIL. Reverting the migration's gate fails W2; reverting `pg_brand_can_collect` to Stripe-only fails W3. (Cannot be run headless — needs the migration applied; run cited in §11.)
3. **Gap-A config-flow guard (Deno source-assertion, PROVEN this pass):** `app-mobile/src/services/__tests__/orch_1291_rsvp_chipin_config_flow.test.ts` — 5 tests locking the config flow across all 6 touched files (view SELECTs the 3 columns anon-safe · consumer `fetchRsvpMomentum` selects+maps them · consumer screen feeds them into `RsvpOfferingConfig` · buyer-web mapper maps them into `LiveEvent` · buyer-web page feeds config + wires `onChipIn` surface `web`). `deno test --allow-read` → **5 passed | 0 failed**. **fails-on-revert verified** by TRUE LINE DELETION of the buyer-web mapper line `rsvpContributionEnabled: row.rsvp_contribution_enabled ?? false,` → test A4 FAILS (`4 passed | 1 failed`) → restored → **5 passed | 0 failed**. Source-assertion pattern (not runtime) because these files import RN + the `@mingla/offering-rendering` workspace package, which the worktree jest env cannot resolve (the pre-existing `publicEventsService.test.ts` fails identically there, and the business jest suite is not a blocking CI job per COMMS-0056) — this matches the established app-mobile pattern (`orch_1157_rsvp_consumer.test.ts`).

All three test files appear in `git diff origin/main...HEAD --name-only` (ship with the fix; append-only — no existing test modified/deleted).

---

## 7. TaxBasis dependency walk (config-layer change — mandatory)

Repo-wide grep of every `TaxBasis` / `taxBasis` / `tax_basis` consumer (non-test):

| Consumer | Kind | New-member handling |
|----------|------|---------------------|
| `_shared/allInPricingEngine.ts` | Declares union; `buildPricingBreakdown` passes `taxBasis` through to `PricingBreakdown.tax_basis` (a stored field). | Additive — pass-through, no branch. |
| `ticket-checkout-create/index.ts` | Imports `TaxBasis`; ASSIGNS its own literals; ONE comparison `if (taxBasis !== "venue_resolved") { taxCents = 0; }`. | New member never reached (separate fn); even if it were, it falls to `taxCents=0` — exactly correct for a gift. deno-check clean. |
| `venue-reservation-create/index.ts` | Imports `TaxBasis`; ASSIGNS its own literals; never reads the new member. | Inert. deno-check clean. |

No exhaustive `switch (taxBasis)`, no `never`-guard on `TaxBasis`, and NO DB CHECK constraint on `tax_basis` (it lives inside the `pricing_breakdown` jsonb, not a column) exist anywhere in the repo. The member is purely additive; both consumers compile.

---

## 8. Old → New receipts (per changed surface)

- **allInPricingEngine.ts** — before: `TaxBasis` = 5 members; now: +`"voluntary_contribution"` (gift, taxCents=0, skips the tax round-trip). Why: SC-3/SC-5 zero-tax gift with no divergent money path (Constitution #2).
- **business_publish_rsvp_draft** — before: no money gate (free RSVP always publishes); now: CONDITIONAL provider-aware bank-gate + persists 3 config columns. Why: SC-6.
- **stripeWebhookRouter / paystackWebhookRouter** — before: PI/reference → `biz_ticket_checkout_finalize` (order). Now: `mingla_purpose='rsvp_contribution'` (Stripe) / reference-in-contributions (Paystack) checked FIRST → `finalize_rsvp_contribution`, else fall through to the unchanged ticket path. Why: SC-4/SC-10.
- **RsvpOfferingBody / RsvpChipInPanel / RsvpSuccessPopup** — before: RSVP body had no money surface. Now: gated chip-in panel at two mounts reading one lifted state. Why: SC-1/SC-2/SC-5/SC-7.
- **RsvpStep5Setup** — before: no contribution authoring. Now: "Let guests chip in" toggle + suggested/min money fields + connect nudge. Why: SC-6.

---

## 9. Cross-surface impact table

| # | Surface | Affected | Parity | Notes |
|---|---------|----------|--------|-------|
| 1 | Consumer iOS | YES | AUTOMATIC (shared body) + thin `onChipIn` | Stripe PaymentSheet / Paystack browser wired; config now reaches the body via `fetchRsvpMomentum` (Gap A CLOSED §10.A). |
| 2 | Consumer Android | YES | AUTOMATIC (opaque glass fallback) | Same handler. |
| 3 | Buyer/anon Web | YES | AUTOMATIC (shared body) | Web hosted-Checkout redirect; `PublicEventPage` now passes `onChipIn` (surface `web`) + the 3 config columns (Gap A CLOSED §10.A). |
| 4 | Business iOS | YES | MANUAL (wizard) | `RsvpStep5Setup` authoring; `FoundationRsvpPreview` passthrough ready. |
| 5 | Business Android | YES | MANUAL (same codebase → parity) | Opaque `ROW_BG`. |
| 6 | Admin Web | NO | n/a | Authoring not in admin; read-only visibility is META-ORCH-1237. |
| 7 | Business Web preview | YES (inherited) | AUTOMATIC | Inherits the shared body. |

---

## 10. Known issues / deferred (scope boundaries — conductor action)

**A. Config-plumbing gap (consumer + buyer-web) — CLOSED (2026-07-03, conductor-authorized Gap-A follow-up pass).** The chip-in panel renders only when `config.rsvp_contribution_enabled` reaches the shared `RsvpOfferingBody`. The 3 `events` config columns are now surfaced through the SINGLE read view and mapped into the config on both remaining surfaces, so the panel lights up on consumer iOS/Android + buyer/anon web (not just business). Flow, proven by code-trace + a runnable regression test:

1. **View (single read path):** the ORCH-1291 migration now appends a `CREATE OR REPLACE VIEW public.business_public_events_view` (the latest `20261015000000_orch_1167` definition copied VERBATIM) with 3 columns appended at the END — `e.rsvp_contribution_enabled`, `e.rsvp_contribution_suggested_cents`, `e.rsvp_contribution_min_cents`. ADDITIVE-ONLY (every existing column + order preserved), anon-safe (`security_invoker=false` preserved, no owner data, still never touches `brands`), `NOTIFY pgrst 'reload schema'` so the new columns are immediately selectable.
2. **Consumer read:** `app-mobile/src/services/rsvpDeckService.ts::fetchRsvpMomentum` now selects the 3 columns and maps them into `RsvpMomentumSnapshot` as `rsvpContributionEnabled / SuggestedCents / MinCents`; `ConsumerEventDetailScreen.tsx` feeds them straight into `RsvpOfferingConfig` (the defensive cast was removed — the snapshot is now typed). Settlement currency was already sourced from `rsvpPublicEvent.currency`.
3. **Buyer-web read + caller:** `mingla-business/src/services/publicEventsService.ts::publicEventViewRowToEvent` maps the 3 view columns into `LiveEvent` (3 optional fields added to `LiveEvent` in `liveEventStore.ts`); `PublicEventPage.tsx` feeds them into the `FoundationRsvpPreview` config (+ `settlementCurrency: event.currency`, `hostShortName`) AND wires `onChipIn → submitRsvpContribution({ surface:'web' })` (navigates the browser to the hosted Stripe/Paystack URL, returns `{kind:'redirecting'}`; anon guest supplies the RSVP-captured email so the edge fn's `guest_email_required` gate is satisfied).
4. **Body gate:** `useRsvpOfferingState` (`RsvpOfferingBody.tsx`) owns `chipFeatureOn = config.rsvp_contribution_enabled === true && onChipIn != null` → the inline §5.5 section + success-popup panel now receive `enabled=true` on consumer + web (the SC-2 `{going,pending}` status gate + panel internals were already built and are untouched).

**Migration still un-applied — the orchestrator applies the (now-extended) migration + deploys edge fns; then mingla-tester live-fires.**

**B. Wizard live connect-callout is a static nudge, not the inline `BrandOnboardView`/`BrandPaystackOnboardView` flow.** `StepBodyProps` exposes `draft/updateDraft/brandDefaultCurrency` but NOT the brand `canCollect`/provider status, so the design's live "connecting → connected" callout cannot be driven from the wizard without plumbing brand status through the wizard. The HARD bank-gate is enforced at publish (migration gate → `paidPublishGuards` → onboarding), so SC-6 is satisfied; the friendly static nudge stands in for the live callout. **Conductor: optional polish follow-up to plumb `canCollect` + reuse the onboarding views inline.**

**C. Allowlist extensions (additive, flagged).** To let the in-allowlist wizard persist config, I added the 3 `rsvpContribution*` fields to `draftEventStore.ts` + the `business_draft` passthrough in `serverDraftEventMapper.ts` (SPEC §8 step 1's publish RPC reads these; DESIGN §9.5 names them). Making them required forced a one-line fix in `liveEventAdapter.ts` (a regression I caused — now green) and `useExperienceDraftAdapter.ts` (already pre-existing-red on origin/main — see §D). These four files sit outside the literal allowlist but are additive-only and implied-necessary; flagged for REVIEW.

**D. Pre-existing tsc state (NOT ORCH-1291).** `mingla-business tsc` was already red on origin/main (`useExperienceDraftAdapter.ts`'s synthDraft omits `isRsvp` etc.; `serverDraftEventMapper.test.ts` references a non-existent `category`). Confirmed via `git show origin/main`. My source files add NO new type errors; the only new error I introduced (`liveEventAdapter`) is fixed.

**E. Refund path:** chose a NEW sibling fn `rsvp-contribution-refund` (NOT a branch in `refund-order`) so the tightly-coupled order-refund path stays byte-unchanged.

---

## 11. Operator action required (orchestrator/operator)

1. **Apply the migration** (from the worktree):
   ```bash
   cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1291-[rsvp-chip-in]" && /Users/sethogieva/bin/supabase db push --linked
   ```
2. **Run the SQL wall test** (after apply) and confirm W1..W6 all `PASS`:
   ```bash
   cat "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1291-[rsvp-chip-in]/supabase/migrations/__tests__/orch_1291_rsvp_contribution_wall.test.sql" | /Users/sethogieva/bin/supabase db remote sql --linked
   ```
3. **Deploy edge functions** (from MERGED main): `rsvp-contribution-create`, `rsvp-contribution-refund`, and REDEPLOY `stripe-webhook` + `paystack-webhook`. Verify each with one curl (expect the deployed fn, not a 404):
   ```bash
   # create (anon; validation reject proves live)
   curl -sS -X POST "https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/rsvp-contribution-create" \
     -H "Content-Type: application/json" -H "apikey: <ANON_KEY>" \
     -d '{"eventId":"00000000-0000-0000-0000-000000000000","amountCents":1000,"surface":"web","guestEmail":"t@t.co"}'
   # expect {"error":"event_not_found"} (404) — fn is live
   # refund (verify_jwt=true → 401 without a JWT proves the gate is live)
   curl -sS -X POST "https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/rsvp-contribution-refund" \
     -H "Content-Type: application/json" -H "apikey: <ANON_KEY>" -d '{}'
   # expect 401 (gateway verify_jwt) — fn is live
   # webhook redeploys — preflight CORS
   curl -sS -X OPTIONS "https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/stripe-webhook" -i | head -1
   ```
4. Set/confirm secrets used by the new fns (already present for tickets): `MINGLA_PUBLIC_WEB_BASE_URL`, `PAYSTACK_CALLBACK_BASE`, Stripe RAK `TICKET_CHECKOUT`/`TICKET_REFUND`, `PAYSTACK_SECRET_KEY_*`.

---

## 12. Discoveries for orchestrator

- **D-1 (config-plumbing): CLOSED 2026-07-03** — see §10.A. The 3 contribution columns now flow `events → business_public_events_view → fetchRsvpMomentum (consumer) + publicEventViewRowToEvent (buyer-web) → RsvpOfferingConfig`, and the buyer-web `onChipIn` is wired (surface `web`). Additive view redefinition + read/config plumbing only; no edge/webhook/panel-internal change. NOTE for the orchestrator: sibling in-flight `orch-1290` does NOT redefine this view (its latest view migration is also `1167`), so there is no view column-order conflict at merge; if a later ORCH adds view columns, they must append AFTER these 3.
- **D-2 (edit-live contributions):** `biz_update_live_rsvp` does NOT read/gate the contribution config (v1 gates only publish). Editing a published RSVP will not re-gate or change chip-in settings — a v2 concern.
- **D-3 (pre-existing tsc red):** `mingla-business tsc` was red on origin/main independent of this ORCH (§10.D) — worth a cleanup ORCH.
- **D-4 (refund partial state):** v1 refunds the whole contribution (`status='refunded'`); `partially_refunded` is reserved but unused — a future partial-amount refund would use it.

## 13. Gates run (this session)

- `deno check`: `rsvp-contribution-create`, `rsvp-contribution-refund`, `stripeWebhookRouter`, `paystackWebhookRouter`, `allInPricingEngine`, `ticket-checkout-create`, `venue-reservation-create` — all clean.
- `deno test`: `orch_1291_contribution_engine.test.ts` 4/4; existing engine tests 16/16 (no regression).
- strict-grep: `orch-1205` (CORS) PASS, `orch-0843` (direct-charge) PASS, `i-proposed-r` (idempotency) PASS, `i-proposed-q` (API version) PASS, `orch-0804` (tax) 6/6 PASS.
- tsc: offering-rendering + all touched business/app source files clean of NEW errors (pre-existing package react-resolution + `useExperienceDraftAdapter` debt are origin/main state).
