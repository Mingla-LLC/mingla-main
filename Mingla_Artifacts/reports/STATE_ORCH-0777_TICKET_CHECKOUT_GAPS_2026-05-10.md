# STATE — ORCH-0777 Ticket Checkout, Sales Registration & Buyer Notifications

Date: 2026-05-10
Mode: Orchestrator ANSWER + INTAKE
Owner: Operator-driven; next dispatch goes to Codex `implementor-mingla` (canonical IMPLEMENT owner per pipeline routing 2026-05-10)

## Plain-English Status

We tried to make ticket purchase real — buyers actually pay, the event records the sale, the buyer gets confirmation by email + SMS, and the organizer sees the order in their app. The implementor shipped a candidate. An independent tester then proved that the candidate is **not safe to ship**. Several pieces work in code, but the chain breaks in three places that turn a real customer into a bad outcome:

1. **Every checkout will refuse to start** because a SQL bug rejects both `scheduled` and `live` events as "not selling." So no buyer — free or paid — can complete a sale today even if everything else were right.
2. **A successful card payment can land on a red error screen** because the app only checks once for the Stripe webhook to finalize, and if Stripe is even half a second late, the buyer sees `"Payment succeeded. Ticket issuance is still processing"` framed as a failure.
3. **Organizers won't actually see the sales** in most places they expect. The Orders list reads server orders, but Order detail, Event Detail "sold/revenue/activity," Guest list, Reconciliation, EventListCard, and the published-edit web-purchase guard all still read the old local `useOrderStore`. So a real buyer creates a real ticket, but the organizer's dashboard shows it as if nothing happened.

There is also one privacy hole (the QR bearer token is stored in plaintext and the status endpoint that returns it is unauthenticated), one silent failure (the PaymentIntent → session DB update error is ignored), and a **deploy gate** — the SQL migration `20260515000013_orch_0777_ticket_checkout_core.sql` is local-only and has **not** been applied to the linked Supabase project. Even if the code were perfect, nothing would work in production until that migration is applied and the new Edge Functions are deployed.

## Current State (verified live in working tree, 2026-05-10)

| Layer | Tester Finding | Current Code State |
|---|---|---|
| SQL — selling-state predicate | P0: `<> ANY(...)` rejects every scheduled/live event | **Still broken.** `supabase/migrations/20260515000013_orch_0777_ticket_checkout_core.sql:296`: `v_event.status <> ANY (ARRAY['scheduled'::text, 'live'::text])` |
| Paid checkout — webhook latency | P0: throws "still processing" after one poll | **Still broken.** `mingla-business/app/checkout/[eventId]/payment.tsx:155-158` still calls `getTicketCheckoutStatus()` exactly once and throws on null order. |
| Migration deploy | P0: not applied remotely | **Confirmed.** `supabase migration list --linked` shows `20260515000013` as local-only. |
| Organizer Order detail | P1: imports `useOrderStore` and `getOrderById` | **Still broken.** `mingla-business/app/event/[id]/orders/[oid]/index.tsx:39, 172`. |
| Organizer Event Detail (sold / revenue / activity) | P1: derives from local store | **Still broken.** `mingla-business/app/event/[id]/index.tsx:39, 314, 317`. |
| Organizer Guest list / detail | P1: merges local store entries | **Still broken.** `mingla-business/app/event/[id]/guests/index.tsx:217`; `guests/[guestId].tsx:170, 188`. |
| Reconciliation | P1: local store sums | **Still broken.** `mingla-business/app/event/[id]/reconciliation.tsx:57, 102`. |
| Event card sold/revenue | P1: local store | **Still broken.** `mingla-business/src/components/event/EventListCard.tsx:30, 99-100`. |
| Edit-published web-purchase guard | P1: local store | **Still broken.** `mingla-business/src/components/event/EditPublishedScreen.tsx:71, 749`. |
| QR token storage + status endpoint | P1: plaintext qr_code, unauthenticated lookup by checkoutSessionId | **Still broken.** Migration line 525-535 stores raw bearer; `supabase/functions/ticket-checkout-status/index.ts` returns it without buyer auth. |
| PaymentIntent session-update error | P1: silent ignore | **Still broken.** `supabase/functions/ticket-checkout-create/index.ts:139-148`. |
| Spec/schema drift | P2: `orders.stripe_payment_intent_status`, `failed_at`, source default, unique index on qr_token_hash, fuller session fields | **Still missing.** |

What did land cleanly:
- Phone is now required and E.164-shaped (passing test `phone.test.ts`, strict-grep `orch-0777` passing).
- `confirm.tsx` no longer writes the local `useOrderStore` (it reads only server-issued ticket QR payloads).
- New Edge Functions and the strict-grep guardrail script ship correctly and Deno-typecheck.

## Five-Truth-Layer Reconciliation

| Layer | What it says |
|---|---|
| Docs (spec) | "Buyer reserves/buys, durable orders/tickets, Resend + Twilio confirmations, server-truth scanner/orders" |
| Schema | New tables/RPCs exist locally but **not deployed remotely**. `qr_code` stores raw bearer token. |
| Code (frontend) | New checkout calls Edge Functions; many organizer surfaces still on local store. Paid path treats webhook delay as failure. |
| Runtime | Cannot run the path because (a) migration not applied, (b) SQL predicate would reject every event regardless. |
| Data | No durable order/ticket rows yet — the candidate has never run end-to-end against a real event. |

Three layers disagree (code/spec say "production"; schema and runtime say "not deployed and would not work"). This is a launch blocker.

## Severity & Verdict

ORCH-0777 verdict: **FAIL — REWORK REQUIRED**. Do not deploy, do not announce, do not move ORCH-0777 toward CLOSE.

S0 commerce-integrity item; remains the highest-priority revenue/trust gate on the program (Score 91 / Fix Now per Priority Board).

## Recommended Path

Single bundled rework dispatch to Codex `implementor-mingla`, scoped to the failing tester findings only — no scope creep. After rework returns, re-test through Claude `mingla-forensics` (TEST mode) using the ORCH-0777 tester prompt, then run the operator-assisted live-fire gate (free + paid + webhook replay + Resend + Twilio + scanner cross-device) before CLOSE.

Rework deltas in priority order:

1. **P0a** — Replace `<> ANY` predicate with `NOT (status = ANY(...))` (or `<> ALL`). Add a SQL/Edge regression test that proves `scheduled` and `live` public events can create sessions, and `hidden`/`deleted`/non-selling cannot. Locally apply the corrected migration.
2. **P0b** — Add a post-payment "processing" state in `payment.tsx`: poll `getTicketCheckoutStatus` (e.g. up to ~15s with backoff) or subscribe to the order; never throw a successful PaymentSheet result as an error. Add regression test for delayed webhook.
3. **P0c** — Apply the corrected migration to the linked Supabase project after operator gate. Re-verify `supabase migration list --linked`.
4. **P1a** — Build one server-backed event-orders/sales/attendees source (React Query hook + service) and migrate Order detail, Event Detail (sold / revenue / activity), Guest list + detail, Reconciliation, EventListCard, and EditPublishedScreen web-purchase guard onto it. Add tests that create a server order and assert each surface adapter exposes correct counts/rows.
5. **P1b** — Stop returning raw bearer in `qr_code`. Either (a) move raw token off the row entirely and return a signed/short-lived display payload from a buyer-authenticated endpoint, or (b) add buyer/auth/session-claim ownership to the status endpoint. Move from `md5` to a stronger digest for bearer-hash matching.
6. **P1c** — In `ticket-checkout-create`, check the result of the session update that persists `stripe_payment_intent_id`. On error, cancel the PaymentIntent and return a hard failure before the buyer sees the PaymentSheet.
7. **P2** — Reconcile schema drift with the spec (`orders.stripe_payment_intent_status`, `orders.failed_at`, `orders.source` default `online_checkout`, `orders.notification_status` default `pending`, `stripe_application_fee_amount_cents` default 0, unique index on `tickets.qr_token_hash`, fuller `ticket_checkout_sessions` session contract) — or amend the spec with explicit, justified compatibility decisions and document them.

## Open Questions for Operator (path-fork only — defaults below)

1. Reslot the QR contract: do we move the **raw token off `tickets.qr_code` entirely** (preferred — strongest privacy) or **add buyer-auth/session-claim** to the status endpoint and keep `qr_code` as bearer (faster, weaker)? **Default: move raw token off, return a signed payload from a buyer-authenticated endpoint.**
2. Schema drift: do we **align migration to spec** (preferred — fewer surprises later) or **amend the spec** to match what shipped? **Default: align migration to spec.**
3. Organizer surface migration: bundle all 6 surfaces into one PR (preferred — single source of truth lands once) or split into Order Detail first, then bulk projection? **Default: bundle.**

## Documents Updated

- This report: `Mingla_Artifacts/reports/STATE_ORCH-0777_TICKET_CHECKOUT_GAPS_2026-05-10.md`
- Implementor rework prompt: `Mingla_Artifacts/prompts/IMPLEMENTOR_REWORK_ORCH-0777_PRODUCTION_TICKET_CHECKOUT_REWORK.md`
- Priority Board / World Map / Master Bug List: pending updates after operator confirms rework dispatch (per orchestrator policy: do not promote/demote without dispatch decision)

## Next Step

Dispatch Codex `implementor-mingla` with the prompt at
`Mingla_Artifacts/prompts/IMPLEMENTOR_REWORK_ORCH-0777_PRODUCTION_TICKET_CHECKOUT_REWORK.md`.
Expected output: `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0777_PRODUCTION_TICKET_CHECKOUT_REWORK.md`.
After implementor returns, dispatch Claude `mingla-forensics` (TEST mode) for a focused retest covering all 7 rework points, then operator-assisted live-fire.

Hard guard: no close, no remote DB push, no Edge deploy, and no announcement until the rework returns and an independent tester PASSes — then operator runs the live-fire matrix from the tester prompt.
