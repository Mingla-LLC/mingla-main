# SPEC AMENDMENT — ORCH-1147 [cart does not reflect the TRUE price] · TRIP + EXPERIENCE all-in SOURCE plumbing

**Phase:** SPEC AMENDMENT (binding contract extension — no product code in this turn).
**Amends:** `Mingla_Artifacts/specs/SPEC_ORCH-1147_CART_TRUE_PRICE.md` (§4.3 stop-and-amend trigger; OQ-3).
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1147-[cart-true-price]` on branch `ORCH-1147-cart-true-price` (rebased on origin/main, 0 behind at write time).
**Skill:** mingla-forensics (SPEC mode).
**Trigger:** the implementor's `IMPLEMENTATION_ORCH-1147_CART_TRUE_PRICE.md` §11 STOP-AND-AMEND (OQ-3). Event is end-to-end live; trip + experience CART Total fall back to BASE because the per-tier server all-in (`priceAllInGbp`) is never attached to their two SOURCE services, which lie outside the original spec allowlist. The implementor correctly stopped rather than widening scope. This amendment authorizes and specifies the exact ~30-line plumbing.
**Comms:** COMMS_LEDGER read on entry — **no OPEN entries** addressed to forensics / ORCH-1147 / ALL. Nothing to ack.

---

## A. Why this amendment exists (verified, not assumed)

The core ORCH-1147 implementation (`a622e9494`, now on this branch) made the cart's headline **Total** read a server-computed per-tier all-in (`priceAllInGbp` → `CartLine.unitPriceAllIn` → `useCartTotals.allInTotal`). The **consumer side** of that chain is already wired for ALL THREE offering types:

- `TicketStub.priceAllInGbp?` field exists (`mingla-business/src/store/draftEventStore.ts:94`).
- Trip seed reads `sole.priceAllInGbp` (`checkout-trip/[tripEventId]/index.tsx:250`, multi-tier `:458`).
- Experience seed reads `stub.priceAllInGbp` (`checkout-experience/[experienceEventId]/index.tsx:281`).

The gap — verified by reading the source — is purely in the two SOURCE services that produce the trip tiers / experience ticket the stubs are mapped from:

| Verified fact | File:line (this branch) |
|---|---|
| `TripPricingTier` interface has NO `priceAllInGbp` field | `mingla-business/src/services/tripsService.ts:73-98` |
| Trip tier producer `getPublicTripById.pricingTiers.map` never sets an all-in | `mingla-business/src/services/publicEventsService.ts:1402-1426` |
| `tierToTicketStub` does NOT pass `priceAllInGbp` to the stub | `checkout-trip/[tripEventId]/index.tsx:66-78` |
| `PublicExperienceTicket` interface has NO `priceAllInGbp` field | `mingla-business/src/services/publicExperienceService.ts:40-51` |
| Experience ticket producer `mapExperience` never sets an all-in | `mingla-business/src/services/publicExperienceService.ts:193-208` |
| `ticketToStub` does NOT pass `priceAllInGbp` to the stub | `checkout-experience/[experienceEventId]/index.tsx:51-...` |
| The all-in fetch helper EXISTS but is module-private (not exported) | `publicEventsService.ts:840 const fetchTierAllInCents` |
| Helper returns `Map<ticket_types.id, all_in_cents>` from `pg_public_event_tier_allin` | `publicEventsService.ts:840-857` |

Because `tier.priceAllInGbp` / `ticket.priceAllInGbp` are `undefined`, `sole.priceAllInGbp ?? sole.priceGbp` resolves to the BASE price → trip/experience Total = base (no fee gross-up). Event works because it routes through `publicEventsService.fetchTickets` (`:879-895`), which already attaches `priceAllInGbp` via `fetchTierAllInCents`.

**The fix is to feed the existing consumer wiring the real number** — one owner of the all-in fetch (`fetchTierAllInCents`), no duplicated RPC math, no new SQL.

---

## B. Authorization — expanded file allowlist (additions ONLY)

These files are ADDED to the SPEC's "Scoped allowlist (implementor MAY change)". Everything in the original SPEC's allowlist and DO-NOT-TOUCH list stands unchanged.

| # | File | Authorized change | New? |
|---|------|-------------------|------|
| A1 | `mingla-business/src/services/publicEventsService.ts` | **Export** the existing `fetchTierAllInCents` helper (`:840`) so the experience service can reuse it. ALSO populate `TripPricingTier.priceAllInGbp` inside `getPublicTripById` (`:1402-1426`). (This file was already conditionally on the allowlist for exactly this helper — now confirmed required.) | no |
| A2 | `mingla-business/src/services/tripsService.ts` | Add `priceAllInGbp?: number \| null` to `interface TripPricingTier` (`:73-98`). TYPE-only change. | no |
| A3 | `mingla-business/src/services/publicExperienceService.ts` | Add `priceAllInGbp?: number \| null` to `interface PublicExperienceTicket` (`:40-51`); import + call `fetchTierAllInCents`; thread the all-in cents through `loadExperienceSidecars` → `MapInput` → `mapExperience` onto the ticket. | no |
| A4 | `mingla-business/app/checkout-trip/[tripEventId]/index.tsx` | In `tierToTicketStub` (`:66`) add `priceAllInGbp: tier.priceAllInGbp ?? null` to the returned `TicketStub`. (Already allowlisted; the seed already reads `stub.priceAllInGbp` — this is the missing pass-through.) | no |
| A5 | `mingla-business/app/checkout-experience/[experienceEventId]/index.tsx` | In `ticketToStub` (`:51`) add `priceAllInGbp: ticket.priceAllInGbp ?? null` to the returned `TicketStub`. (Already allowlisted; seed already reads `stub.priceAllInGbp`.) | no |

**Single owner of the all-in fetch:** `fetchTierAllInCents(eventId)` in `publicEventsService.ts` is the ONE place that calls `pg_public_event_tier_allin`. The experience service IMPORTS and CALLS it; the trip producer (already living in `publicEventsService.ts`) calls it inline. **DO NOT** copy the RPC call, re-derive fees, or add a second helper. If the implementor finds themselves writing `supabase.rpc("pg_public_event_tier_allin", …)` anywhere other than the body of `fetchTierAllInCents`, STOP — that is a scope violation.

**DO-NOT-TOUCH carried forward unchanged** (from the original SPEC §"DO-NOT-TOUCH"): `compute_all_in_cents` / `pg_public_event_tier_allin` SQL (no migration; OQ-2 PARKED — do NOT make the RPC tax-aware); native PI amount + preview return; Paystack/NGN charge path; any `app-mobile/` consumer file; ORCH-1034 GBP fallbacks; any buyer billing-address / tax form (keep `orch-1130-no-buyer-tax-form.mjs` GREEN); `useCartTotals.total`/`.subtotal` MEANING. **No new files** are created by this amendment.

---

## C. Exact per-file specification

### C1. `publicEventsService.ts` — export the helper + populate trip tiers

**C1a — export the single-owner fetch helper.**
At `:840` change the declaration from module-private to exported:
```ts
export const fetchTierAllInCents = async (
```
No body change. (Its contract is unchanged: returns `Map<string /*ticket_types.id*/, number /*all_in_cents*/>`; RPC failure → empty map → base fallback downstream. Never throws.)

**C1b — populate `TripPricingTier.priceAllInGbp` in `getPublicTripById`.**
`getPublicTripById` already awaits `fetchTicketTypesRemaining(tripEventId)` at `:1326`. Add a parallel all-in fetch keyed identically by `ticket_types.id` (the trip tier producer keys `t.ticket_type_id`, which IS `ticket_types.id` — same key space as the helper's map, VERIFIED). Recommended: fold both fetches into the existing pattern, e.g.:
```ts
// ORCH-1147 — per-tier server all-in (same single owner as the event path).
const [remainingById, allInById] = await Promise.all([
  fetchTicketTypesRemaining(tripEventId),
  fetchTierAllInCents(tripEventId),
]);
```
Then in the `pricingTiers.map` (`:1413-1425`) add, on each returned `TripPricingTier`:
```ts
priceAllInGbp: (() => {
  const cents = allInById.get(t.ticket_type_id);
  return typeof cents === "number" ? cents / 100 : null;
})(),
```
Mirror the EXACT fallback semantics `fetchTickets` uses (`:885-889`): free tier → `null`; numeric all-in → `cents/100`; otherwise `null` (NOT a fabricated base). The trip seed's `?? sole.priceGbp` provides the base fallback — do NOT also fall back to base here (keep `null` so the seed owns the single base-fallback decision, exactly as the event path does where the stub maps `priceAllInGbp` and the seed reads it). The all-in is in MAJOR units (`/100`) to match `TicketStub.priceAllInGbp` (major-unit, same as `priceGbp`).

### C2. `tripsService.ts` — interface field (TYPE-only)

In `interface TripPricingTier` (`:73-98`), add after `currency` (alongside the other optional metadata fields), preserving the file's doc-comment convention:
```ts
/**
 * ORCH-1147 — server fee-grossed per-tier all-in in MAJOR units
 * (`pg_public_event_tier_allin` → /100). Null = free tier or RPC miss;
 * the cart seed falls back to `priceCents`/base. NEVER recompute fees in TS.
 */
priceAllInGbp?: number | null;
```
No other change in this file. (`mapTripPricingTier` and admin draft loads MAY leave it unset → `undefined` → base fallback; that is correct, those paths are not buyer-checkout.)

### C3. `publicExperienceService.ts` — interface field + call the helper + thread it through

**C3a — interface field.** In `interface PublicExperienceTicket` (`:40-51`) add:
```ts
/**
 * ORCH-1147 — server fee-grossed all-in in MAJOR units
 * (`pg_public_event_tier_allin` → /100). Null = free / RPC miss; cart seed
 * falls back to `priceCents`/base. NEVER recompute fees in TS.
 */
priceAllInGbp?: number | null;
```

**C3b — import + call the single-owner helper.** Add the import (experience service currently imports only `./supabase`, `../store/draftEventStore`):
```ts
import { fetchTierAllInCents } from "./publicEventsService";
```
In `loadExperienceSidecars` (`:254-290`) add `fetchTierAllInCents(eventId)` to the existing `Promise.all` and return its map, e.g.:
```ts
const [stopsResp, ticketsResp, datesResp, allInById] = await Promise.all([
  /* …existing three… */,
  fetchTierAllInCents(eventId),
]);
/* …existing error guards… */
return { stops: …, tickets: …, dates: …, allInById };
```
(`fetchTierAllInCents` never throws → no new error guard needed; keep the existing throw-on-RLS guards for the three Supabase responses.)

**C3c — thread through `MapInput` → `mapExperience`.** Add to `interface MapInput` (`:134-146`):
```ts
/** ORCH-1147 — ticket_types.id → server all-in cents (single-owner fetch). */
allInById?: Map<string, number>;
```
Both call sites already spread sidecars into `mapExperience({ event, brand, ...sidecars, bookable })` (`:338`, `:380`) — so once `loadExperienceSidecars` returns `allInById`, it flows in automatically; no call-site edit needed beyond C3b.

In `mapExperience` (`:193-208`) set `priceAllInGbp` on the constructed ticket using the SAME free/miss semantics as the event path:
```ts
const allInCents = tt !== undefined ? input.allInById?.get(tt.id) : undefined;
// …inside the ticket object:
priceAllInGbp:
  (tt.is_free === true || (tt.price_cents ?? 0) === 0)
    ? null
    : typeof allInCents === "number" ? allInCents / 100 : null,
```
The experience ticket is keyed by `tt.id` (= `ticket_types.id`, `:197`), which matches the helper's map key — VERIFIED. MAJOR units (`/100`).

### C4 / C5. The two stub mappers — pass `priceAllInGbp` through

These mappers live in the ALREADY-allowlisted `index.tsx` files but were not touched by the core impl, so the stub never carries the all-in even after C1-C3. Add the pass-through.

**C4 — trip `tierToTicketStub` (`checkout-trip/[tripEventId]/index.tsx:66-78`):** add to the returned `TicketStub`:
```ts
priceAllInGbp: tier.priceAllInGbp ?? null,
```
(The multi-tier seed at `:455-458` reads `ticket.priceAllInGbp` off the stub mapped here; the sole-tier seed at `:250` reads `sole.priceAllInGbp` off the same stub. Both are fed once `tierToTicketStub` passes it.)

**C5 — experience `ticketToStub` (`checkout-experience/[experienceEventId]/index.tsx:51-...`):** add to the returned `TicketStub`:
```ts
priceAllInGbp: ticket.priceAllInGbp ?? null,
```

After C1-C5, for BOTH trip and experience: `pg_public_event_tier_allin` → `fetchTierAllInCents` → `TripPricingTier.priceAllInGbp` / `PublicExperienceTicket.priceAllInGbp` → stub `priceAllInGbp` → seed `unitPriceAllIn` → `useCartTotals.allInTotal` → headline Total + "Fees & tax" line. This is byte-for-byte the same display path the event already uses — the trip/experience CART Total then reads the all-in IDENTICALLY to the event path.

---

## D. Success-criteria amendment (the original SC-4 / SC-5 now have a SOURCE contract)

The original SPEC §5 SC-4 (trip) / SC-5 (experience) demanded each offering independently satisfy SC-1/SC-2. They were `◑` (display-wired, source-pending) in the implementation report. This amendment makes them fully testable:

- **SC-4 (trip) — UPGRADED.** On a **pass-fee** trip (brand passes Mingla and/or service fee), the trip checkout/payment **Total** EQUALS the server fee-grossed all-in (`Σ priceAllInGbp × qty`), NOT the base subtotal, AND the combined "Fees & tax" line renders = (Total − base). Source: `TripPricingTier.priceAllInGbp` populated via `fetchTierAllInCents` in `getPublicTripById`.
- **SC-5 (experience) — UPGRADED.** Same on a **pass-fee** experience. Source: `PublicExperienceTicket.priceAllInGbp` populated via `fetchTierAllInCents` threaded through `loadExperienceSidecars` → `mapExperience`.
- **SC-4b / SC-5b (no-regression).** On an absorb-all brand (current prod: all 8 charges-enabled), trip + experience `feesTaxCents=0`, no "Fees & tax" line, Total == base exactly as before. On a free tier, `priceAllInGbp=null` → seed falls back to 0/base.
- **SC-11 (single-owner gate, NEW).** `pg_public_event_tier_allin` is called from exactly ONE place: the body of `fetchTierAllInCents` in `publicEventsService.ts`. No second RPC call, no duplicated fee math anywhere in `tripsService.ts` / `publicExperienceService.ts`.

---

## E. Test-contract EXTENSION (Step-0.5 + tester per-type verification)

### E1. Implementor happy-path test — EXTEND, do not replace

The original Step-0.5 test `mingla-business/src/components/checkout/__tests__/orch_1147_cart_allin_total.test.ts` asserts `useCartTotals.allInTotal` + the EVENT headline binds to the all-in. **Extend that same file** (it is already on the allowlist) so the happy-path also asserts the TRIP and EXPERIENCE cart Total equals the server all-in — not only event:

1. **T-7a (trip source → cart Total).** Given a `TripPricingTier` with `priceAllInGbp` > `priceGbp`, assert that after `tierToTicketStub` + the seed mapping (`unitPriceAllIn: stub.priceAllInGbp ?? stub.priceGbp`), `useCartTotals.allInTotal` reflects the trip all-in and `feesTaxCents > 0` (Total > base). Unit-test the pure mapping (`tierToTicketStub` → stub → seed-shape → `useCartTotals`), no network.
2. **T-7b (experience source → cart Total).** Same for a `PublicExperienceTicket` with `priceAllInGbp` > base via `ticketToStub`: `useCartTotals.allInTotal` reflects the experience all-in, `feesTaxCents > 0`.
3. **T-7c (fallback, both types).** With `priceAllInGbp` absent/null on the source, the stub carries `null`, the seed falls back to base, `feesTaxCents == 0` (no regression / no fabrication) — for BOTH trip and experience.

**Fails-on-revert requirement (carry the original contract):** T-7a/T-7b MUST FAIL if any of these are reverted — the `TripPricingTier.priceAllInGbp` field removed, the `getPublicTripById` populate deleted, `tierToTicketStub` stops passing `priceAllInGbp`, or the experience equivalents. They MUST PASS when restored. The implementor proves the fail-on-revert by true line deletion (not comment-out), mirroring the original report §6.

**Single-owner structural gate (SC-11).** Either extend the existing `orch-1147-cart-total-is-allin.mjs` strict-grep OR add an assertion that `pg_public_event_tier_allin` appears in `publicEventsService.ts` ONLY (and that `tripsService.ts` / `publicExperienceService.ts` contain NO `supabase.rpc("pg_public_event_tier_allin"` string). This catches a future duplicate-RPC regression. (Implementor's choice of extend-vs-new, but the assertion is mandatory.)

### E2. Tester per-type verification — MANDATORY, all three types separately

The tester MUST device-verify the cart Total == server all-in on a **pass-fee fixture** for **all three offering types separately** (event already passing; trip + experience are the new surfaces):

1. Stand up / temporarily toggle a charges-enabled, **pass-fee** brand (D-3 from the original SPEC — a green run on absorb-only prod data proves NOTHING; 0/8 brands pass a fee today).
2. **EVENT** — confirm Total > base by the fee gross-up + "Fees & tax" line (regression check; already live).
3. **TRIP** — open the trip checkout for the pass-fee brand; confirm the cart/payment Total EQUALS `Σ priceAllInGbp × qty` (NOT base) and the "Fees & tax" line renders; confirm `getPublicTripById` returns tiers with `priceAllInGbp` populated (network/log evidence).
4. **EXPERIENCE** — same for the experience checkout; confirm `PublicExperienceTicket.priceAllInGbp` is populated and the cart Total reflects it.
5. **Per-platform:** business iOS + business Android + buyer-web for each of the three types (display-only RN change inherits parity via shared `CartContext`; web display branch verified explicitly).
6. **No-regression:** on an absorb brand, all three show Total == base, no fees line (SC-4b/SC-5b/SC-9).

A verdict that verifies only the event type, or only one platform, is INCOMPLETE and must be rejected. Three types × (display Total + "Fees & tax" line) is the gate.

---

## F. Implementation order (append to original SPEC §8 as steps 7-9)

7. **`publicEventsService.ts`** — export `fetchTierAllInCents` (C1a); populate `TripPricingTier.priceAllInGbp` in `getPublicTripById` (C1b).
8. **Trip type + stub** — `tripsService.ts` interface field (C2); `checkout-trip/.../index.tsx` `tierToTicketStub` pass-through (C4).
9. **Experience** — `publicExperienceService.ts` interface field + import + `loadExperienceSidecars` fetch + `MapInput` + `mapExperience` (C3); `checkout-experience/.../index.tsx` `ticketToStub` pass-through (C5).
10. **Tests/gate** — extend the Step-0.5 jest with T-7a/T-7b/T-7c (E1); add/extend the single-owner SC-11 gate; prove fails-on-revert; run the business jest suite + `orch-1147-*` + `orch-1130-no-buyer-tax-form.mjs` green; `npx tsc --noEmit` on the 5 touched files clean.

Estimated net: ~30 lines of product code across the 5 files + test/gate additions.

---

## G. Open questions

- **OQ-2 (exclusive-tax residual) — STILL PARKED by Seth.** `priceAllInGbp` folds FEES, excludes TAX, so in exclusive-tax regions (US `pass_tax=true`) the trip/experience floor — like the event floor — understates by tax. Blast radius ZERO today (all charges-enabled brands inclusive GB/EU/CH). This amendment does NOT change that and does NOT make the RPC tax-aware. The OQ-2 comment the core impl placed at each `displayAllIn` site already covers trip + experience payment screens — no new caveat site needed.
- No new open questions. The two source files + the helper export discharge OQ-3 in full.

---

## H. Downstream routing

- **Next = mingla-implementor.** Build §F (steps 7-10) in the worktree `~/Desktop/mingla-orchs/ORCH-1147-[cart-true-price]/` on branch `ORCH-1147-cart-true-price`. Touch ONLY the 5 files in §B (plus the existing test/gate files). Reuse `fetchTierAllInCents` — do NOT duplicate the RPC. Extend the Step-0.5 test with trip + experience assertions. Append to the implementation report (do not overwrite). Prove fails-on-revert.
- **Then = mingla-tester.** Per-type pass-fee verification (§E2) — event + trip + experience, all on business iOS + Android + web; SC-4/SC-5/SC-4b/SC-5b/SC-11; the original SC-6/SC-7/SC-8 still hold. Reject any single-type or single-platform pass.
- **Then = mingla-orchestrator CLOSE.** Flip `I-PROPOSED-1147-CART-TOTAL-IS-SERVER-ALLIN` + `I-PROPOSED-1147-WEB-CHARGE-BILLS-FEE-GROSSED-SUBTOTAL` ACTIVE (now satisfied for all three types); commit the tester adversarial test before merge; OTA the business app (runtime 1.0.0; pure RN/JS) on close.
- **Working tree:** `~/Desktop/mingla-orchs/ORCH-1147-[cart-true-price]/` on branch `ORCH-1147-cart-true-price`.
