# IMPLEMENTATION — META-ORCH-1059 [experiences-business-parity] · SUB-C + SUB-D · BUYER JOURNEY (+ fold-in nav-lock fix)

**ORCH:** META-ORCH-1059 [experiences-business-parity] — Sub-C (public buyer page) + Sub-D (checkout entry) + operator-reported fold-in fix
**Skill:** mingla-implementor (Claude)
**Date:** 2026-06-02
**Worktree:** `~/Desktop/mingla-orchs/meta-orch-1059-[experiences-business-parity]/` on branch `meta-orch-1059-experiences-business-parity`
**Anchors:** `DESIGN_META-ORCH-1059_EXPERIENCES_LIFECYCLE.md` (Sub-C §C, Sub-D §D), Sub-A/Sub-B impl reports, `COMMS_LEDGER.md`.
**Status:** implemented and verified (tsc clean on all touched files; new jest gates green + fails-on-revert proven; live buyer journey driven end-to-end on physical Android R58R54YV7JT through public page → checkout index → buyer details).

**Comms-ledger acks (this turn):**
- **COMMS-0014 + COMMS-0016** (BLOCK/WARN — experience checkout MUST route through the EXISTING `ticket-checkout-create`; no parallel money fn): honoured. The checkout chain reuses the shared `createTicketCheckout` service (event_type-agnostic) + the shared `NativeCheckoutPaymentBoundary` PaymentSheet + the shared `CartTaxPreview` all-in line. ZERO new money fn, ZERO new payment UI. Machine-asserted (audit test "COMMS-0014/0016 — checkout POSTs to the SHARED ticket-checkout-create").
- **COMMS-0002** (strict-grep backend allowlist): **N/A** — Sub-C/D added NO migration and NO edge function (the anon RLS policies for published experiences already exist; verified live). Nothing touches `supabase/functions/` or `supabase/migrations/`.
- **COMMS-0003** (external-API docs cited): **N/A** — no external API introduced (no Stripe/Mapbox/Pexels/OpenAI call added; the money path is the byte-unchanged existing engine).
- No new cross-ORCH discovery requiring a ledger write.

---

## 0. SELF-SPEC'D CONTRACT (no separate forensics spec; design §C/§D + the operator fold-in)

### Fold-in fix (operator-reported "minor")
**Symptom:** "clicking Raleigh Wine and Dine Crawl does not open anything, just a swipe animation, comes back to the same page; freezes the screen, nav menu unusable."

**Root cause (PROVEN on physical Android, not inferred):** The Hub tab `app/(tabs)/hub/_layout.tsx` stays MOUNTED while a hub list row pushes a route OUTSIDE the hub group (`/experience/{id}`). Its visible-tab redirect `useEffect` (lines 103-116) read `pathname` unconditionally; once the pathname was no longer `/hub/...`, it fell through to `active="events"`, found that the experiences-only brand "Lantern & Vine" has `visibleTabs = ["experiences"]` (NO "events" — events count is 0), and fired `router.replace('/(tabs)/hub/experiences')` — **yanking the user off the just-pushed experience dashboard mid-transition and leaving the tab navigator unresponsive** (the bounce-back + nav-lock).
- The dashboard mount + `routeForEventRow` experience branch were ALREADY correct (Sub-B). Proof: the Home → Upcoming tap-through opened the dashboard cleanly (Home is not under `hub/_layout`, so the effect never ran there). The Hub tap-through bounced because of the layout effect.
- Live repro + fix confirmation via Maestro on R58R54YV7JT: before fix, the Hub "Raleigh Wine and Dine Crawl" row tap did NOT navigate (no Metro log, no red-box); after fix, `Hub → tap row → dashboard (Edit + STOPS) → back → Hub → Blast → Account → Hub` all pass, tab bar fully responsive.

**Fix (2 parts):**
1. **Primary** — `hub/_layout.tsx`: the redirect effect early-returns when the pathname is not a `/hub/` sub-route (`if (!activePath.includes("/hub/")) return;`). The layout no longer hijacks navigation to another stack.
2. **Defensive parallel** — `hub/experiences.tsx`: the experiences-list ScrollView padded by a flat `paddingBottom: 120` (no safe-area inset), unlike the events hub (`insets.bottom + 120`). On gesture-nav devices the only/last experience card could sit under the floating absolute `BottomNav`. Switched to `insets.bottom + 120` (mirror `app/(tabs)/hub/events.tsx:553`) so the card is never tap-blocked.

### Sub-C contract (public buyer page)
- Anon-tolerant single-experience resolver (mirror trip's direct-table pattern, NOT a new RPC — the anon RLS policies on `events`/`brands`/`experience_stops`/`ticket_types`/`event_dates` already cover published experiences; verified live against `b8bd995b`).
- `/exp/[brandSlug]/[experienceSlug]` route: full-bleed cover, X-close + share `IconChrome` overlays, `ExperiencePreview` (cover, title, by-brand, date-model block via `formatExperienceDateSubline`, description, STOPS itinerary, "From {price}"), then the checkout flow. All states: loading / error / not-found-or-not-live / ended / sold-out / free / populated.

### Sub-D contract (checkout entry, LOCKED to the existing engine)
- `ExperienceCheckoutFlow` thin CTA ("Get my spot" / "Get my free spot") → `/checkout-experience/{id}`.
- `/checkout-experience/[experienceEventId]/` chain (`_layout`/`index`/`buyer`/`payment`/`confirm`; NO intake step). ONE ticket (the whole itinerary) — no per-stop/multi-tier selection. buyer→payment→confirm POST to the EXISTING `ticket-checkout-create` via the shared `createTicketCheckout`; shared all-in PaymentSheet; combined "Fees & tax" line.

---

## 1. Files changed (receipts)

### NEW
| File | Layer | What it does |
|---|---|---|
| `mingla-business/src/services/publicExperienceService.ts` | L4 | `getPublicExperienceBySlug` + `getPublicExperienceById` — anon-tolerant single-experience resolvers (events-row + stops + the one ticket + dates), direct anon table reads gated by existing RLS. Mirrors the trip by-slug/by-id resolvers; NO new RPC. |
| `mingla-business/src/hooks/usePublicExperience.ts` | L5 | `usePublicExperienceBySlug` (public page) + `usePublicExperienceById` (checkout chain) React Query hooks + `publicExperienceKeys`. Anon-tolerant. |
| `mingla-business/src/components/experience/ExperiencePreview.tsx` | L5 | Buyer-eye preview: full-bleed cover, title, by-brand, date-model block (`formatExperienceDateSubline`), description, STOPS itinerary, "From {price}". Mirror `TripPreview`. |
| `mingla-business/src/components/experience/ExperienceCheckoutFlow.tsx` | L5 | Thin one-ticket CTA → `/checkout-experience/{id}`. "Get my spot" / "Get my free spot" / "Ended". Mirror `TripCheckoutFlow`. |
| `mingla-business/app/exp/[brandSlug]/[experienceSlug].tsx` | L5 | Public buyer-anon route: full-bleed cover + X/share overlays + `ExperiencePreview` + (ended/sold-out banner OR `ExperienceCheckoutFlow`). All 7 states. Mirror `/t/[brandSlug]/[tripSlug]`. |
| `mingla-business/app/checkout-experience/[experienceEventId]/_layout.tsx` | L5 | `CartProvider` + `Stack` outside `(tabs)`. Mirror `/checkout-trip/_layout`. |
| `mingla-business/app/checkout-experience/[experienceEventId]/index.tsx` | L5 | Single-ticket selection (QuantityRow), mini-card, Continue. Mirror trip index (one ticket, no multi-tier). |
| `mingla-business/app/checkout-experience/[experienceEventId]/buyer.tsx` | L5 | Name/email/phone/marketing form → free order via shared `createTicketCheckout` OR push to /payment. Mirror trip buyer, **minus** intake-schema + installment branches. |
| `mingla-business/app/checkout-experience/[experienceEventId]/payment.tsx` | L5 | Web hosted Checkout + native PaymentSheet via shared `NativeCheckoutPaymentBoundary` + ORCH-0852 fire-and-forget confirm + shared `CartTaxPreview`. Mirror trip payment, **minus** installment plan. |
| `mingla-business/app/checkout-experience/[experienceEventId]/confirm.tsx` | L5 | "You're in" + order summary (combined "Fees & tax" line) + QR carousel + ORCH-0852 web sync-confirm + Realtime fallback. Mirror trip confirm. |
| `mingla-business/app/(tabs)/hub/__tests__/hub-layout-nav-lock.test.ts` | L7 | Regression for the fold-in: pins the `/hub/` guard in `hub/_layout.tsx` + the `insets.bottom + 120` padding. Fails-on-revert proven. |

### MODIFIED
#### `mingla-business/app/(tabs)/hub/_layout.tsx`
- **Before:** the visible-tab redirect effect read `pathname` unconditionally; when the user pushed `/experience/{id}` from a hub row, `active` defaulted to `"events"`, and an experiences-only brand (no "events" tab) triggered `router.replace('/(tabs)/hub/...')` → bounced off the pushed screen + nav-lock.
- **Now:** `if (!activePath.includes("/hub/")) return;` guards the redirect so the layout never hijacks navigation to another stack. **Lines:** +11 (comment + guard).
- **Why:** root-cause fix for the operator-reported dead-tap + nav-lock.

#### `mingla-business/app/(tabs)/hub/experiences.tsx`
- **Before:** the list ScrollView used a flat `paddingBottom: 120` (no safe-area inset); the only/last experience card could sit under the floating absolute tab bar.
- **Now:** imports `useSafeAreaInsets`; the surface ScrollView + the empty-state ScrollViews pad by `insets.bottom + 120` (mirror events hub). **Lines:** ~20.
- **Why:** defensive parallel to the nav-lock fix — ensures the experience card's Pressable is always reachable.

#### `mingla-business/src/services/__tests__/eventType.filter.audit.test.ts` (existing test — APPEND only)
- Added a `META-ORCH-1059 Sub-C/D — buyer journey` describe block (5 tests). Pure addition (`git diff --numstat` = 65 added / **0 deleted** — append-only gate safe).

---

## 2. Spec traceability (design §C/§D + fold-in → evidence)

| Criterion | Status | Evidence |
|---|---|---|
| Fold-in: Hub experience tap opens dashboard, no bounce, nav not locked | PASS | live Maestro on R58R54YV7JT: Hub → tap row → dashboard (Edit + STOPS) → back → Hub → Blast → Account → Hub all pass; nav-lock test fails-on-revert. |
| Fold-in: ALL experience tap entry points route correctly (Home upcoming/recent, Hub list, "Your experiences") | PASS | Home Upcoming already worked (Sub-B); Hub "Your experiences" fixed + verified; both use `routeForEventRow(Defensive)` → `/experience/{id}`. |
| Sub-C: `/exp/[brandSlug]/[experienceSlug]` resolves a published experience | PASS | live: title + by-brand + date subline + description + STOP 1/2 + "From $55.00" rendered. |
| Sub-C: single-experience-by-slug resolver returns stops + the one ticket + dates | PASS | `getPublicExperienceBySlug`; live anon RLS probe = ev/stops(2)/ticket(1)/dates(1) visible. |
| Sub-C: full-bleed cover + X-close + share overlays | PASS | `app/exp/.../[experienceSlug].tsx` IconChrome overlays (mirror trip). |
| Sub-C: all states (loading/error/not-found-or-not-live/ended/sold-out/free/populated) | PASS | every branch present + handled; not-live → anon RLS returns null → "not found". |
| Sub-C: `ExperienceMiniCard` `/exp/{brandSlug}/{experienceSlug}` now resolves | PASS | MiniCard line 45-46 pushes the route; route exists. |
| Sub-D: `ExperienceCheckoutFlow` thin CTA into the buyer chain | PASS | "Get my spot" → `/checkout-experience/{id}` (live). |
| Sub-D: one-ticket (whole itinerary), no per-stop selection | PASS | index shows the single "Standard" ticket; QuantityRow only. |
| Sub-D: `/checkout-experience/[id]/` chain (_layout/index/buyer/payment/confirm; no intake) | PASS | 5 files created; live: index → Continue → buyer ("Your details · 2 OF 3", order summary + form filled). |
| Sub-D: POST to EXISTING `ticket-checkout-create`, shared PaymentSheet, no new money fn | PASS | buyer/payment use shared `createTicketCheckout` + `NativeCheckoutPaymentBoundary`; audit test asserts no `experience-checkout-create`. |
| Sub-D: cart shows combined "Fees & tax" line | PASS | confirm.tsx summary uses "Fees & tax" label; native preview via shared `CartTaxPreview`. |
| Sub-D: extend `eventType.filter.audit.test.ts` + route allowlist for `/checkout-experience/*` | PASS (allowlist N/A) | audit block added; the route-by-event-type gate only bans `/event/`+`/trip/` pushes — `/checkout-experience/` + `/exp/` are NOT banned, so no allowlist change required; gate run shows 0 new violations. |
| Adversarial: draft/not-live returns not-found | PASS | resolver `PUBLIC_STATUSES` excludes "draft"; audit test pins it; anon RLS enforces server-side. |
| Adversarial: ended experience disables CTA | PASS | `ExperienceCheckoutFlow` `allDatesPast` → CTA disabled "Ended" + page shows ended banner instead of checkout. |

---

## 3. Local gate results (captured)

- **tsc (mingla-business):** `node_modules/.bin/tsc --noEmit` → **zero errors in any new/modified file**. Total baseline **241 → 241** (no new errors; the 241 are pre-existing untouched-file errors documented by Sub-A/Sub-B).
- **jest — new Sub-C/D audit block:** 5/5 PASS.
- **jest — fold-in nav-lock test:** 3/3 PASS.
- **jest — Sub-B audit block (regression):** 4/4 still PASS.
- **fails-on-revert (mandatory):**
  - nav-lock guard: removed `if (!activePath.includes("/hub/")) return;` → nav-lock test **2 failed**; restored → **3 passed**. Anchor commit before fix: `f0782b7459577d3deff9d84371f5b6d1e4a001c7`.
  - Sub-D routing: repointed `ExperienceCheckoutFlow` CTA to `/checkout-trip/` → routing test **FAILED**; restored → PASS.
- **strict-grep route-by-event-type:** 3 violations, all pre-existing (home scanner, accept-scanner-invitation, ScannerHome) — confirmed baseline (Sub-B documented these 3); **zero from new files**.
- **append-only:** audit-test diff = 65 added / 0 deleted.
- **Pre-existing audit-test failures:** 3 (the brittle `getPublicTripById` trip-source regex matchers — Sub-B D-2). Fail with my changes stashed too; NOT introduced here.

---

## 4. Live verification (physical Android R58R54YV7JT, Metro 8090)

1. **Fold-in repro + fix** — Hub "Your experiences" row tap: before fix = dead (no nav); after fix = opens `/experience/{id}` dashboard cleanly. Full nav cycle (Hub→dashboard→back→Hub→Blast→Account→Hub) responsive.
2. **Sub-C public page** — `/exp/lanternvine/raleigh-wine-and-dine-crawl` via the dashboard "Public page" tile: rendered title, "by Lantern & Vine", date subline, description, "THE ITINERARY" (STOP 1 Sparkling Welcome Flight, STOP 2 Rooftop Nightcap), "From $55.00", then the checkout-flow card with "Get my spot".
3. **Sub-D checkout entry** — "Get my spot" → checkout index ("Get your spot · 1 OF 3", mini-card, "Standard" QuantityRow $55.00) → set qty 1 (Subtotal $55.00) → Continue → buyer ("Your details · 2 OF 3", order summary 1× Standard $55.00 Total $55.00, form accepted "Test Buyer" + "testbuyer@example.com"). Stopped before the real Stripe PaymentSheet (no real charge).

---

## 5. Deploy / apply instructions (orchestrator owns these)

- **Migrations:** NONE. Sub-C/D add no migration (the anon RLS policies for published experiences already exist on remote; verified live 2026-06-02).
- **Edge functions:** NONE new/changed. The money path is the byte-unchanged existing `ticket-checkout-create` + `NativeCheckoutPaymentBoundary` + `confirm`.
- **Strict-grep allowlist (COMMS-0002):** no change needed (no backend files touched).
- **Action:** merge the branch PR to main; no `db push`, no `functions deploy`. (Consumer/business app changes ride the next native build per `[[ota-deferred-until-new-build]]`; web preview picks them up on Vercel.)

---

## 6. Invariant verification
| ID | Preserved? | How |
|---|---|---|
| I-6 NO PARALLEL MONEY FN (COMMS-0014/0016) | Y | checkout reuses `createTicketCheckout` + shared PaymentSheet; audit test asserts no `experience-checkout-create`. |
| I-1 ONE-TICKET | Y | the chain sells the single `ticket_types` row resolved server-side; index shows one ticket only. |
| route-by-event-type | Y | `/checkout-experience/` + `/exp/` are NOT `/event/`|`/trip/`; gate shows 0 new violations; CTA routes to its own chain (not event/trip). |
| anon-buyer-routes (no useAuth on public/checkout) | Y | resolver + page + chain are anon-tolerant; `_layout` outside `(tabs)`. |
| combined Fees & tax line ([[feedback_cart_combined_fees_tax_line]]) | Y | confirm summary uses "Fees & tax"; native preview is the shared all-in `CartTaxPreview`. |

---

## 7. Cross-surface impact
- **Business iOS + Android + Web preview (buyer-anon):** new public experience page + checkout chain. Parity automatic (shared `mingla-business` code path; web/native branches in payment mirror the proven trip chain). The fold-in nav fix affects Business iOS + Android (the hub layout is shared).
- **Backend / Admin / Consumer app:** unaffected (no migration, no edge fn, no consumer code).

---

## 8. Regression surface (for the tester)
1. Hub tap-through on an **events-only** brand and a **mixed** brand (the redirect guard must still correctly bounce a genuinely-invalid `/hub/{tab}` when that tab isn't visible, but NEVER bounce a `/experience/` or `/checkout-experience/` push).
2. Free experience checkout (price 0 → "Get my free spot" → buyer "Reserve free spot" → confirm, no payment screen).
3. Ended experience (all dates past → page shows ended banner, CTA disabled).
4. Web buyer path (hosted Stripe Checkout redirect + `?cs=`/`csi=`/`bst=` confirm recovery on `/checkout-experience/.../confirm`).
5. Sold-out gate when `ticket_types.quantity_total` is finite and sold out.
6. Native PaymentSheet real charge end-to-end (the one leg not exercised live this turn).

---

## 9. Discoveries for orchestrator
- **D-1 (pre-existing audit-test matchers, carried from Sub-B D-2):** 3 `getPublicTripById` trip-source regex assertions in `eventType.filter.audit.test.ts` fail on current source (regex drift), independent of this work. Register a small fix-the-matchers ORCH.
- **D-2 (fold-in root cause is a general hub-layout pattern):** any future route pushed from a hub list row to a non-`/hub/` stack would have hit the same redirect-hijack. The guard now covers all of them (trips/events too), but worth noting the layout effect is a shared chokepoint.
- **D-3 (Sub-D native real-charge leg unverified live):** the buyer journey was driven through buyer-details; the actual Stripe PaymentSheet charge + confirm was not triggered (no real card). The code path is the proven shared trip chain; the tester should run one real native charge to close I-1 end-to-end.

---

## 10. /goal completion self-check
1. Every self-spec criterion implemented + demonstrated — §2 (live evidence per row). ✓
2. Regression tests green + fails-on-revert at cited hash (`f0782b74…`) for the nav-lock guard AND the Sub-D routing assertion — §3. ✓
3. tsc clean on every touched file; total errors 241→241 (no new) — §3. ✓
4. Constitution: all async states handled (public page 7 states, checkout chain loading/error/not-found/empty/submitting); no silent catches (Share user-cancel exempt; all money catches → error state/toast); no dead taps (fold-in fixed); one-owner-per-truth (single date-subline helper, single money path). ✓
5. Edge deploy + verify-first-call — N/A (no new/changed edge function; money path byte-unchanged). ✓
