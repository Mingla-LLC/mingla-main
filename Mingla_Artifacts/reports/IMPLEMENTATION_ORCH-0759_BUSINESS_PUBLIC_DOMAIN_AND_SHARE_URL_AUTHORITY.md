# Implementation Report: Business Public Domain and Share URL Authority (ORCH-0759)

> Date: 2026-05-08  
> Mode: Spec Execute  
> Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0759_BUSINESS_PUBLIC_DOMAIN_AND_SHARE_URL_AUTHORITY.md`  
> Status: implemented, partially verified

## 1. Layman Summary

Mingla Business now has one public URL authority for event, brand, checkout, and OG/share links: `https://business.usemingla.com`. The old broken public-domain emissions were replaced, public event/brand/checkout routes now read server-backed public Supabase data instead of organiser-local Zustand live-event/brand caches, and publish now syncs server ticket rows before promoting a draft.

## 2. Request And Context

- **Request:** Implement the ORCH-0759 spec after forensics proved dead-domain and local-store public-route failures.
- **Source:** User-dispatched `$implementor` after `SPEC_ORCH-0759_BUSINESS_PUBLIC_DOMAIN_AND_SHARE_URL_AUTHORITY.md`.
- **Affected surfaces:** Mingla Business publish Step 7, public event, public brand, checkout, share/meta/OG, Vercel routes, universal links, Supabase public read model, publish ticket sync, regression gates.
- **Related artifacts:** Investigation and spec for ORCH-0759.

## 3. Scope

- **In scope:** Canonical URL builder, public Supabase event service/hooks, publish slug/ticket sync, public route state handling, checkout server event lookup, Vercel rewrites, AASA checkout path, env examples, tests/gate.
- **Out of scope:** Real paid checkout backend, order persistence, inventory decrement, Stripe PaymentIntents/webhooks, production DB push/deploy.
- **Assumptions:** `business.usemingla.com` remains the canonical business public host.

## 4. Files Read

| File | Why | Relevant finding |
|---|---|---|
| `SPEC_ORCH-0759_BUSINESS_PUBLIC_DOMAIN_AND_SHARE_URL_AUTHORITY.md` | Contract | Required server-backed public routes and canonical URL builder. |
| `CreatorStep7Preview.tsx` | Broken publish copy | Displayed guessed `mingla.com/e/...`. |
| `PublicEventPage.tsx`, `/app/e/...` | Public event/share | Used `business.mingla.com` and local live-event store. |
| `PublicBrandPage.tsx`, `/app/b/...` | Public brand/share | Used `business.mingla.com` and local brand/live-event stores. |
| `checkout/[eventId]/*` | Checkout entry | Used `useLiveEventStore`, failing cold shared links. |
| `eventDrafts.ts`, `liveEventConverter.ts`, `serverDraftEventMapper.ts` | Publish identity | Server draft slug was not carried into local published event identity. |
| Supabase baseline migrations | Schema/RLS | Existing tables support public events/tickets; public view leaked `theme`. |
| `vercel.json`, AASA, env examples | Deploy/routing | Dynamic public paths needed cold-link rewrites and checkout universal-link parity. |

## 5. Blast Radius

- **Direct changes:** Business public URL constants, public event service/hooks, public routes/components, checkout routes, publish service, draft/live event slug shape, SQL migration, Vercel/AASA/env, strict gate/tests.
- **Cascade changes:** `DraftEvent` gained `serverSlug`; persisted draft migration bumped to v8; live conversion uses server slug when available.
- **Parity surfaces:** Business web/native JS changed; admin and mobile consumer untouched.
- **Cache impact:** Added `publicEventKeys`; no organiser query key reuse.
- **State boundaries:** Buyer-facing `/e`, `/b`, `/checkout` no longer source data from local `useLiveEventStore` or brand list caches.
- **Auth/RLS/security:** Added `business_public_events_view` with `security_invoker`; public view strips `theme.business_draft`; ticket query never selects `password_hash`.
- **Deploy path:** Supabase migration must be pushed before business Vercel deploy.

## 6. Old To New Receipts

### URL authority

- **Before:** Callers built `mingla.com` / `business.mingla.com` URLs inline.
- **After:** `src/constants/publicUrls.ts` owns event, brand, checkout, and OG URL construction.
- **Why:** Prevents per-screen domain drift.

### Public routes

- **Before:** `/e`, `/b`, and `/checkout` depended on organiser-local stores.
- **After:** Routes use `usePublicEventBySlug`, `usePublicBrandBySlug`, and `usePublicEventById` backed by Supabase public reads.
- **Why:** Cold shared links can render without organiser local storage.

### Publish

- **Before:** Local published event slug was generated separately from the server event slug; server ticket rows were not synced in the publish path.
- **After:** Drafts carry `serverSlug`; local live events mirror it; `markServerDraftPublished` syncs `ticket_types` before promoting the event.
- **Why:** Step 7/share/checkout identity now points at the durable server event.

### Deploy routing

- **Before:** Vercel had no rewrites for dynamic public paths.
- **After:** `vercel.json` rewrites `/e/*`, `/b/*`, and `/checkout/*` to Expo static dynamic route outputs.
- **Why:** Cold direct URLs should serve the app instead of a Vercel 404.

## 7. Implementation Details

- **Architecture decisions:** Kept existing `LiveEvent`/`Brand` UI shapes by mapping public Supabase rows into compatible public records, minimizing component churn.
- **Data flow:** Public route params -> React Query public hooks -> `business_public_events_view` + `ticket_types` -> existing public UI components.
- **Mutation/query behavior:** Publish soft-deletes old ticket rows, inserts current draft ticket rows, then promotes the event. If ticket sync fails, publish throws before event promotion.
- **State handling:** Local `useLiveEventStore` remains organiser cache only; checkout cart stays in-memory per spec.
- **Error handling:** Public routes now render loading/error/not-found states instead of falling through to local-store not found.
- **Copy/accessibility:** Step 7 no longer guesses a slug; it shows the reserved server URL only when known, otherwise honest generic copy.

## 8. Spec / Goal Traceability

| Criterion / goal | Implemented | Verification | Status |
|---|---|---|---|
| Canonical `business.usemingla.com` builder | Yes | `publicUrls.test`, strict gate | Pass |
| Remove Step 7 `mingla.com/e/...` | Yes | `test:orch-0759`, strict gate | Pass |
| Remove public event/brand `business.mingla.com` | Yes | `test:orch-0759`, strict gate | Pass |
| Public event/brand server-backed | Yes | Source guard tests + TypeScript | Pass |
| Checkout entry server-backed by event id | Yes | Source guard tests + TypeScript | Pass |
| Publish slug identity | Yes | Mapper/converter tests + TypeScript | Pass |
| Publish ticket sync | Yes | Ticket mapper tests; runtime DB not pushed | Partially verified |
| Public view strips draft metadata | Yes | Migration inspection; DB not pushed | Partially verified |
| Vercel cold route rewrites | Yes | `expo export -p web` produced matching static route files | Partially verified until deployed smoke |

## 9. Invariant Verification

| Invariant | Relevant | Preserved | Notes |
|---|---|---|---|
| One owner per public URL truth | Yes | Yes | `publicUrls.ts` owns active public URL building. |
| Server state owns buyer public pages | Yes | Yes | Public routes use React Query + Supabase service. |
| No silent failures | Yes | Yes | Public routes have explicit loading/error/not-found states. |
| No public draft leakage | Yes | Yes | New SQL view removes `business_draft`; services query that view. |
| No dead-domain regression | Yes | Yes | Strict gate now catches active `business.mingla.com`, `https://mingla.com`, and visible `mingla.com/` copy. |

## 10. Parity Check

- **Mobile:** Business native JS compiles; AASA adds checkout path. No consumer app changes.
- **Business app:** Publish, public event, public brand, checkout, env/config touched.
- **Admin:** Not touched.
- **Public/web:** Expo export succeeded and produced `/e/[brandSlug]/[eventSlug].html`, `/b/[brandSlug].html`, and checkout static entries.
- **Solo/collab:** Not applicable.
- **Gaps:** Production cold-link smoke requires DB push and Vercel deploy.

## 11. Cache And Persisted State Safety

- **Query keys changed:** Added `publicEventKeys` under `["public-events"]`.
- **Invalidations added:** None; public reads are query-only.
- **Data shape changes:** `DraftEvent.serverSlug` added; v7 persisted drafts migrate to `serverSlug: null`.
- **AsyncStorage/Zustand impact:** Existing drafts survive with null server slug; server-backed drafts hydrate with `events.slug`.
- **Cold start behavior:** Public event/brand/checkout reads no longer need local Zustand live-event state.

## 12. Verification

| Check | Command / method | Result | Notes |
|---|---|---|---|
| ORCH-0759 targeted tests/gate | `cd mingla-business && npm run test:orch-0759` | Pass | 21 tests; strict gate scanned 360 files, 0 violations. Watchman recrawl warning only. |
| TypeScript | `cd mingla-business && npx tsc --noEmit` | Pass | No TS errors. |
| Expo web export | `cd mingla-business && npx expo export -p web` | Pass | Exported `dist`; Sentry/Stripe SSR warnings only. |
| Migration ordering | `/Users/sethogieva/bin/supabase migration list --linked` | Checked | Remote has through `20260515000001`; local `20260515000002` pending; new migration uses greater `20260515000003`. |

## 13. Regression Surface

1. Public event page date fidelity: current public safe view strips `theme.business_draft`, so date details are limited until event dates are server-authored outside the draft blob.
2. Checkout buyer/payment/confirm still use transitional in-memory cart/order behavior; event resolution is fixed, real order backend remains separate.
3. Vercel rewrite behavior must be proved on deployed host because local static export cannot emulate Vercel rewrites by itself.

## 14. Risks, Limitations, Transition Items

| Item | Risk / temporary state | Exit condition | Location |
|---|---|---|---|
| Paid/free order persistence | Checkout still generates local/stub orders | Separate approved order/payment backend ORCH | Checkout buyer/payment/confirm |
| Public schedule fidelity | Public view strips draft blob; no event_dates writer added in this slice | Follow-on server event dates publication | `publicEventsService.ts`, SQL view |
| Deployment dependency | Frontend queries new view | Operator runs `supabase db push` before Vercel deploy | Supabase migration |

## 15. Discoveries For Orchestrator

- Register I-PROPOSED-AB/AC/AD as close candidates: canonical public URL builder, server-backed public pages, server-durable published slug.
- Consider a follow-on ORCH for public event date publication into `event_dates` or first-class event columns, because stripping draft metadata is correct but exposes the absence of a safe schedule read model.
- Consider a follow-on ORCH for real checkout/order persistence; this implementation intentionally stops at server-backed event/ticket resolution.

## 16. Deploy Notes

- **Migrations:** Operator must run `supabase db push`; new migration is `20260515000003_orch_0759_public_event_contract.sql`.
- **Edge functions:** None.
- **Mobile OTA/native:** JS changes only; universal-link AASA changed for checkout and should be validated on deployed host.
- **Business/admin web:** Deploy `mingla-business` to Vercel after DB push.
- **Env vars/secrets:** Ensure Vercel has `EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL=https://business.usemingla.com`.

## Suggested Commit Message

```text
fix(business): canonicalize public links and server-back public routes

Resolves: ORCH-0759
Evidence: npm run test:orch-0759; npx tsc --noEmit; npx expo export -p web
Deploy: supabase db push before mingla-business Vercel deploy
```

## Ready-To-Test Checklist

1. Push migration, deploy business web, then open `https://business.usemingla.com/e/{brandSlug}/{eventSlug}` in an incognito browser with empty local storage.
2. Open `https://business.usemingla.com/b/{brandSlug}` cold and confirm brand plus events render.
3. Open `https://business.usemingla.com/checkout/{eventId}` cold and confirm ticket selection renders from server ticket rows.
4. Publish a free event and confirm Step 7 never shows `mingla.com/e/...`.
5. Share from the public event page and confirm the copied/shared URL is under `business.usemingla.com`.
6. Confirm `business.mingla.com` is never emitted by app UI.
