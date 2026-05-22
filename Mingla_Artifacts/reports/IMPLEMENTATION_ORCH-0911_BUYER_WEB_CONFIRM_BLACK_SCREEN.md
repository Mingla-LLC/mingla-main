# Implementation Report: Buyer-Web Checkout Confirm Black Screen (ORCH-0911)

> Date: 2026-05-22
> Mode: Spec Execute
> Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0911_BUYER_WEB_CONFIRM_BLACK_SCREEN.md`
> Status: implemented and verified

## 1. Layman Summary

Trip buyers who paid through Stripe-hosted Checkout were being redirected to the event confirmation route, which could never load trip details and could paint a permanent black screen. Buyer-web confirm screens also painted a black shell during the initial `?cs=` return window. This implementation routes web trip checkouts to `/checkout-trip/...` and shows a visible "Confirming..." hero from the first paint while the ORCH-0852 sync-confirm + Realtime flow resolves.

## 2. Request And Context

- **Request:** Implement ORCH-0911 against the spec and investigation.
- **Source:** `Mingla_Artifacts/specs/SPEC_ORCH-0911_BUYER_WEB_CONFIRM_BLACK_SCREEN.md` and `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0911_BUYER_WEB_CONFIRM_BLACK_SCREEN.md`.
- **Affected surfaces:** buyer-anon-web checkout confirm, trip checkout confirm, `ticket-checkout-create` hosted-Checkout URL builder.
- **Related issues/artifacts:** ORCH-0852 sync-confirm + Realtime fallback comments in `confirm.tsx`; ORCH-0839-B mobile-web custom-scheme branch.

## 3. Scope

- **In scope:** Three product files named by the dispatch; happy-path Deno/Jest regressions; implementation report.
- **Out of scope:** Native PaymentSheet, telemetry, retry/help/dead-end fallback UI, DB migrations, RLS, edge deploy, Vercel deploy, strict-grep additions.
- **Assumptions:** `tripGateRow` remains loaded before URL construction; `event_type === "trip"` is the only trip discriminator; null/undefined event_type defaults to event route.

## 4. Files Read

| File | Why | Relevant finding |
|---|---|---|
| `Mingla_Artifacts/specs/SPEC_ORCH-0911_BUYER_WEB_CONFIRM_BLACK_SCREEN.md` | Implementation contract | Required event_type URL branch and first-paint `?cs=` hero gates. |
| `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0911_BUYER_WEB_CONFIRM_BLACK_SCREEN.md` | Root-cause proof | RC-1 trip rows were routed to event confirm; RC-2 bare host rendered black. |
| `supabase/functions/ticket-checkout-create/index.ts` | Edge function target | `tripGateRow` already loaded; web URLs were hardcoded to `/checkout`. |
| `mingla-business/app/checkout/[eventId]/confirm.tsx` | Event confirm target | Old hero required `realtimePending && event !== null`; fallback was bare host. |
| `mingla-business/app/checkout-trip/[tripEventId]/confirm.tsx` | Trip confirm target | Same shape with trip copy. |
| Existing Deno/Jest tests | Test style | Edge tests use source-shape Deno checks; checkout package lacks RNTL dependency. |

## 5. Blast Radius

- **Direct changes:** Hosted Checkout URL construction and two confirm render branches.
- **Cascade changes:** Stripe `success_url` and `cancel_url` for web trip rows now target trip checkout routes.
- **Parity surfaces:** Event path preserved; trip path fixed; mobile-web custom-scheme branch preserved.
- **Cache impact:** None.
- **State boundaries:** Cart resume, `result`, `realtimePending`, and Realtime subscription ownership unchanged.
- **Auth/RLS/security:** None.
- **Deploy path:** Edge function deploy is required after close/promotion; Vercel deploy is required for business web.

## 6. Old To New Receipts

### `supabase/functions/ticket-checkout-create/index.ts`

- **Before:** `surface === "web"` always built `${baseUrl}/checkout/${eventId}/confirm` and `/payment`.
- **After:** `surface === "web"` reads `tripGateRow?.event_type === "trip"` and uses `checkout-trip` for trip rows, `checkout` otherwise.
- **Why:** Trip buyers must land on the trip confirm screen that calls `usePublicTripById`.
- **Approx lines changed:** 430-435.

### `mingla-business/app/checkout/[eventId]/confirm.tsx`

- **Before:** Loading hero required `Platform.OS === "web" && result === null && realtimePending && event !== null`; otherwise `event === null || result === null` returned a bare black host.
- **After:** `result === null` checks web `?cs=` first and renders "Confirming your tickets..." independent of event/realtimePending; non-`?cs=` still returns the bare host; `event === null` after result renders the same hero.
- **Why:** Buyer-web `?cs=` arrivals need visible confirmation from first paint without altering ORCH-0852 resolution architecture.
- **Approx lines changed:** 353-393.

### `mingla-business/app/checkout-trip/[tripEventId]/confirm.tsx`

- **Before:** Trip loading hero required `realtimePending && trip !== null`; fallback returned bare host.
- **After:** `result === null` + web `?cs=` renders "Confirming your reservation..." independent of trip/realtimePending; non-`?cs=` still returns bare host; `trip === null` after result renders the same hero.
- **Why:** Trip confirm needs identical black-screen protection with trip copy.
- **Approx lines changed:** 311-350.

### Regression Tests

- **Added:** `supabase/functions/ticket-checkout-create/__tests__/orch_0911_success_url_branching.test.ts`.
- **Added:** `mingla-business/app/checkout/[eventId]/__tests__/orch_0911_confirm_loading_state.test.tsx`.
- **Added:** `mingla-business/app/checkout-trip/[tripEventId]/__tests__/orch_0911_trip_confirm_loading_state.test.tsx`.

## 7. Implementation Details

- **Architecture decisions:** Inline event_type branch inside the existing `surface === "web"` block; no helper extraction or re-query.
- **Data flow:** Stripe-hosted Checkout receives route-matched success/cancel URLs for web; mobile-web keeps custom scheme.
- **Mutation/query behavior:** Unchanged.
- **State handling:** `result` remains the render owner for resolved checkout state; `realtimePending` remains only for Realtime subscription activation.
- **Error handling:** Unchanged by spec; no retry/help/dead-end fallback added.
- **Copy/accessibility:** Existing hero copy and check badge reused; trip title remains "Confirming your reservation...".
- **Analytics/notifications/realtime:** No telemetry added; Realtime fallback untouched.

## 8. Spec / Goal Traceability

| Criterion / goal | Implemented | Verification | Status |
|---|---|---|---|
| SC-1 / T-02 event rows keep `/checkout` | Yes | Deno T-02 | PASS |
| SC-2 / T-01 trip rows use `/checkout-trip` success URL | Yes | Deno T-01; fails-on-revert | PASS |
| SC-3 / T-03 null event_type defaults event | Yes | Deno T-03 | PASS |
| SC-4 / T-05 mobile-web unchanged | Yes | Deno T-05 | PASS |
| SC-5 / T-06 event `?cs=` + result null renders hero | Yes | Jest T-06; fails-on-revert | PASS |
| SC-6 / T-07 event result populated + event null renders hero | Yes | Jest T-07 | PASS |
| SC-7 / T-08 event no `?cs=` result null remains bare host | Yes | Jest T-08 | PASS |
| SC-8 / T-09 event full render unchanged | Yes | Jest T-09 | PASS |
| SC-9 / T-10 trip `?cs=` + result null renders hero | Yes | Jest T-10; fails-on-revert | PASS |
| SC-12 / T-11 trip full render unchanged | Yes | Jest T-11 | PASS |
| SC-13 / T-12 E2E trip buyer | Not run by implementor | Manual Vercel/Stripe gate remains | PENDING |
| SC-14 / T-13 E2E event buyer | Not run by implementor | Manual Vercel/Stripe gate remains | PENDING |

## 9. Invariant Verification

| Invariant | Relevant | Preserved | Notes |
|---|---|---|---|
| I-OUTSIDE-TABS | Yes | Yes | Route groups unchanged. |
| I-ORCH-0852-NO-DEAD-END-CONFIRM | Yes | Yes | No retry button, help link, or fallback added. |
| I-ANON-TOLERANT-BUYER-ROUTES | Yes | Yes | No auth hook added. |
| I-PROPOSED-BUYER-WEB-CONFIRM-HAS-LOADING-STATE | Yes | Yes | `?cs=` + result-null paths now render hero. |
| I-PROPOSED-CHECKOUT-SUCCESS-URL-MATCHES-EVENT-TYPE | Yes | Yes | Web URL path now follows event_type. |

## 10. Parity Check

- **Mobile:** Native PaymentSheet and mobile-web custom-scheme branch untouched.
- **Business app:** Buyer-web event and trip confirm screens updated in parity.
- **Admin:** Not applicable.
- **Public/web:** Web hosted-Checkout success/cancel paths fixed.
- **Solo/collab:** Not applicable.
- **Gaps:** Full Stripe/Vercel E2E remains for orchestrator/operator after deploy.

## 11. Cache And Persisted State Safety

- **Query keys changed:** None.
- **Invalidations added:** None.
- **Data shape changes:** None.
- **AsyncStorage/Zustand impact:** None; cart `result` and sessionStorage resume flow unchanged.
- **Cold start behavior:** Improved for web `?cs=` arrivals: visible hero renders even if sessionStorage is absent or event/trip query is still null.

## 12. Verification

| Check | Command / method | Result | Notes |
|---|---|---|---|
| Deno check | `/Users/sethogieva/.deno/bin/deno check supabase/functions/ticket-checkout-create/index.ts` | PASS | Edge function type check. |
| Deno function tests | `/Users/sethogieva/.deno/bin/deno test --allow-read supabase/functions/ticket-checkout-create/` | PASS, 23 tests | Includes ORCH-0911 T-01 through T-05. |
| Jest confirm tests | `npx jest --runTestsByPath 'app/checkout/[eventId]/__tests__/orch_0911_confirm_loading_state.test.tsx' 'app/checkout-trip/[tripEventId]/__tests__/orch_0911_trip_confirm_loading_state.test.tsx' --runInBand` | PASS, 6 tests | Watchman recrawl warning only. |
| Diff hygiene | `git diff --check -- [scoped files]` | PASS | No whitespace errors. |
| Fails-on-revert | Temporarily reversed only the three product-file edits, left tests in place, ran targeted Deno/Jest, then restored patch | EXPECTED FAIL | Deno T-01/T-04 failed; Jest T-06/T-10 failed. Evidence applies to the scoped ORCH-0911 implementation diff on branch `Seth`; final scoped commit hash is recorded in the implementor chat. |

## 13. Regression Surface

1. Hosted Checkout URL path construction for web event rows, trip rows, and null event_type rows.
2. Mobile-web custom-scheme hosted Checkout return URL.
3. Event confirm initial `?cs=` render, result-populated/event-null render, non-resume defensive redirect window, and full success render.
4. Trip confirm initial `?cs=` render and full success render.

## 14. Risks, Limitations, Transition Items

| Item | Risk / temporary state | Exit condition | Location |
|---|---|---|---|
| E2E not run | Stripe/Vercel deployed behavior still needs preview smoke | Orchestrator deploys edge function and Vercel, then T-12/T-13 manual smoke passes | SPEC T-12/T-13 |
| RNTL unavailable | Checkout package has no `@testing-library/react-native`, so confirm tests are Jest source-branch contract tests | Tester can add adversarial runtime tests if dependency/tooling is approved | `mingla-business/package.json` |
| Edge deploy pending | Code not live until orchestrator deploys `ticket-checkout-create` | Orchestrator close/deploy per deploy split | Supabase edge |

## 15. Discoveries For Orchestrator

- Existing Watchman recrawl warning appears during Jest runs; tests still pass. Optional local maintenance command is printed by Watchman.
- No new side issue fixed; DISC-0911-D telemetry and HF-1 sessionStorage recovery remain carry-forward by spec.

## 16. Deploy Notes

- **Migrations:** None. `supabase db push` was not run.
- **Edge functions:** `ticket-checkout-create` changed; do not deploy from implementor. Orchestrator owns deploy.
- **Mobile OTA/native:** None.
- **Business/admin web:** Vercel deploy needed after close for buyer-web confirm screens.
- **Env vars/secrets:** Existing `MINGLA_PUBLIC_WEB_BASE_URL` requirement unchanged.

## Suggested Commit Message

```text
fix(checkout): prevent buyer-web confirm black screen

Resolves: ORCH-0911
Evidence: deno check; deno test supabase/functions/ticket-checkout-create/; focused jest confirm tests; fails-on-revert T-01/T-04/T-06/T-10
Deploy: orchestrator deploys ticket-checkout-create and Vercel after close
```

## Ready-To-Test Checklist

1. Orchestrator deploys `ticket-checkout-create`.
2. On Vercel preview, pay for a trip via `/checkout-trip/{tripEventId}/payment` with Stripe test card `4242 4242 4242 4242`; expect redirect to `/checkout-trip/{tripEventId}/confirm?cs=...`, visible "Confirming your reservation..." hero, then full success view with "Back to trip".
3. On Vercel preview, pay for an event via `/checkout/{eventId}/payment`; expect redirect to `/checkout/{eventId}/confirm?cs=...`, visible "Confirming your tickets..." hero, then full success view with "Back to event".
