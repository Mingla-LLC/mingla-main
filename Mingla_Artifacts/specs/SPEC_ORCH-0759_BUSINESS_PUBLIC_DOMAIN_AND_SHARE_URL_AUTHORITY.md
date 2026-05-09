# Spec: Business Public Domain and Share URL Authority (ORCH-0759)

> Date: 2026-05-08  
> Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0759_BUSINESS_PUBLIC_DOMAIN_AND_SHARE_URL_AUTHORITY.md`  
> Root cause: F-1 through F-11 in the investigation report  
> Status: ready for implementation, with explicit checkout payment boundary

## 1. Layman Summary

Mingla Business must stop giving organisers and guests dead public links.

After this spec is implemented, the app uses one canonical web origin, `https://business.usemingla.com`, for all business public URLs. Publishing an event no longer displays `mingla.com/e/...`, share buttons no longer copy `business.mingla.com/...`, and public event/brand links open from a cold browser without relying on the organiser's local app storage.

This spec does not pretend the full paid checkout backend exists. It does require the public event and checkout entry to resolve server event/ticket data from Supabase. If a payment path is still a stub, it must be visibly honest and must not fail because the buyer lacks organiser-local `LiveEvent` state.

## 2. User Story

As an organiser, I want the link shown after publishing and the link copied from a public event page to be the real public Mingla Business link, so guests can open it from any device and get to the event and ticket flow.

As a guest, I want a shared event or brand link to load from a cold browser, so I can inspect tickets without being signed in or using the organiser's device.

## 3. Scope

**In scope:**

- Replace active public URL hardcodes with one canonical Mingla Business URL builder module.
- Remove `mingla.com` / `business.mingla.com` emissions from Step 7, event share, brand share, canonical meta, OG URL, QR, and brand URL display.
- Make public event and brand pages fetch public server data by slug, not local Zustand stores.
- Make checkout entry fetch public server event/ticket data by server event id, not local `LiveEvent.id`.
- Align publish route identity so Supabase `events.slug`, local `LiveEvent.eventSlug`, and public URLs match.
- Write server ticket rows (`ticket_types`) at publish time or prove existing rows are upserted before public pages rely on them.
- Prevent public leakage of `theme.business_draft` through public event reads.
- Add Vercel/static-export rewrites so cold `/e/*`, `/b/*`, and `/checkout/*` paths serve the app.
- Update universal-link policy for `/checkout/*` or explicitly exclude it on both platforms.
- Harden domain regression gates and add URL-builder tests.

**Non-goals:**

- No marketing-site redesign.
- No public visual redesign beyond honest loading/error/not-found states.
- No full paid payment backend, Stripe PaymentIntents, webhook order fulfillment, or inventory decrement unless already present and bounded by another approved spec.
- No ORCH-0758 media/provider implementation.
- No mobile consumer app URL/domain rewrite unless a touched shared constant demands it.

**Assumptions:**

- `business.usemingla.com` remains the canonical Mingla Business public web origin.
- Existing Supabase public RLS policies for `events`, `brands`, and `ticket_types` are directionally intended for public pages, but the public read shape must be tightened.
- Current checkout can remain transitional for payment capture, but event/ticket resolution must stop being local-store-only.

**Dependencies:**

- Existing Supabase tables: `events`, `brands`, `ticket_types`.
- Existing public policies:
  - public events: `visibility='public'` and `status IN ('scheduled', 'live')`
  - public ticket types for published events
  - brands with public events
- Latest local migration head is `20260515000002_orch_0758a_event_cover_storage.sql`; any new migration must use a prefix greater than `20260515000002`.
- Operator runs `supabase db push` if a migration is included.

## 4. Evidence Trace

| Requirement | Comes from finding / source | Confidence |
|---|---|---|
| Canonical origin is `https://business.usemingla.com` | Investigation Correct Domain Authority; `platformUrl.ts`; `app.config.ts`; DNS proof | High |
| Remove Step 7 `mingla.com/e/...` | F-1, `CreatorStep7Preview.tsx:180-190` | High |
| Remove event share `business.mingla.com` | F-2, `PublicEventPage.tsx:166-176`, share/meta/ShareModal call sites | High |
| Remove brand share `business.mingla.com` | F-3, `PublicBrandPage.tsx:86-94`, `395-400` | High |
| Fix brand display URL | F-4, `BrandEditView.tsx:394-403` | High |
| Fix cold Vercel dynamic paths | F-5, runtime `curl` 404s, `vercel.json` lacking rewrites | High |
| Public event must be server-backed | F-6, route reads `useLiveEventBySlug` | High |
| Public brand must be server-backed | F-7, route reads `useBrandList` / `useLiveEventsForBrand` | High |
| Checkout must stop relying on local `LiveEvent` | F-8, checkout screens read `useLiveEventStore` | High |
| Strip public view leakage of draft snapshot | Schema read: `events_public_view` exposes `theme`; publish keeps `theme.business_draft` | High |
| Harden I-PROPOSED-Y | F-11, allowlisted active broken builders | High |

## 5. Success Criteria

1. Step 7 never renders `mingla.com/e/...` or any guessed final slug that can differ from the published route.
2. Public event share/copy/native share/QR/canonical/OG never emits `business.mingla.com` or `mingla.com`.
3. Public brand share/copy/native share/QR/canonical/OG never emits `business.mingla.com` or `mingla.com`.
4. Brand edit displays the real public brand URL: `business.usemingla.com/b/{brandSlug}`.
5. A cold browser request to `https://business.usemingla.com/e/{brandSlug}/{eventSlug}` serves the app and renders the event from Supabase public data.
6. A cold browser request to `https://business.usemingla.com/b/{brandSlug}` serves the app and renders the brand from Supabase public data.
7. A cold browser request to `https://business.usemingla.com/checkout/{eventId}` serves the app and resolves server public event/ticket data.
8. Public event/brand/checkout pages do not require `mingla-business.liveEvent.v1`, `mingla-business.draftEvent.v1`, or organiser-authenticated brand caches.
9. Public event reads do not expose `theme.business_draft`, ticket passwords, private guest settings, or organiser-only draft metadata.
10. Domain regression gates fail active `business.mingla.com`, `https://mingla.com`, and visible `mingla.com/` public-route copy in app/source code unless the occurrence is a documented historical artifact/test fixture.
11. New tests fail before the fix and pass after it for URL builders, publish slug identity, server-backed public loaders, and no-dead-domain emissions.

## 6. Invariants

### Must Preserve

| Invariant | Enforcement in this spec | Verification |
|---|---|---|
| Constitution #2: one owner per truth | Public URL origin comes from one module; public event data comes from Supabase public rows, not local `LiveEvent` | URL-builder unit tests; public route tests with empty local stores |
| Constitution #3: no silent failures | Public fetch failures render explicit error/not-found states; service functions throw typed errors | Service tests; component state tests |
| Constitution #5: server state stays server-side | Buyer-facing public pages use Supabase public reads | Route/hook tests with empty Zustand |
| Constitution #7: honest transitional states | Payment capture remains labeled transitional if not real | Checkout UI tests/manual gate |
| Constitution #9: no fabricated data | Step 7 no longer invents a final slug; public pages do not use local dummy data | Tests for no guessed URL; no local fallback tests |
| ORCH-0756B draft server envelope | Draft rows remain `status='draft'`; publish promotes server row intentionally | Publish tests |
| ORCH-0758A cover metadata | `cover_media_url/type` remain canonical event media fields | Public event mapper tests |

### New Invariants

| Invariant | Owner | Enforcement | Verification |
|---|---|---|---|
| I-PROPOSED-AB: Business public URLs are built only through `publicUrls.ts` | `mingla-business/src/constants/publicUrls.ts` | No external public URL template literals in app/src except builder tests and historical docs | strict-grep/AST gate |
| I-PROPOSED-AC: Buyer-facing public pages must be server-backed | Public routes `/e`, `/b`, `/checkout` | Routes must use public Supabase services/hooks, never `useLiveEventStore` / `useBrandList` as source of truth | route/static gate + tests |
| I-PROPOSED-AD: Published event slug is server-durable | Supabase `events.slug` | Publish writes/finalizes the slug before navigation/share; local `LiveEvent.eventSlug` mirrors server slug | publish lifecycle tests |

## 7. Database / RLS / Migration

Create a migration with a prefix greater than the current local max `20260515000002`, for example:

```sql
-- Migration: 20260515000003_orch_0759_public_event_contract.sql
```

The implementor must inspect remote migration state before finalizing the filename. If the remote head is greater than `20260515000002`, use a greater prefix.

### Required migration content

1. Replace or add a public event view that does not expose organiser-private JSON:

```sql
CREATE OR REPLACE VIEW public.business_public_events_view
WITH (security_invoker = true) AS
SELECT
  e.id,
  e.brand_id,
  b.slug AS brand_slug,
  b.name AS brand_name,
  b.description AS brand_description,
  b.profile_photo_url AS brand_profile_photo_url,
  b.display_attendee_count AS brand_display_attendee_count,
  e.title,
  e.description,
  e.slug,
  e.location_text,
  e.online_url,
  e.is_online,
  e.is_recurring,
  e.is_multi_date,
  e.recurrence_rules,
  e.cover_media_url,
  e.cover_media_type,
  e.visibility,
  e.show_on_discover,
  e.status,
  e.published_at,
  e.timezone,
  e.created_at,
  e.updated_at,
  (e.theme - 'business_draft') AS public_theme
FROM public.events e
JOIN public.brands b ON b.id = e.brand_id
WHERE
  e.deleted_at IS NULL
  AND b.deleted_at IS NULL
  AND e.visibility = 'public'
  AND e.status IN ('scheduled', 'live');
```

2. Grant the view to `anon`, `authenticated`, and `service_role`:

```sql
GRANT SELECT ON public.business_public_events_view TO anon, authenticated, service_role;
```

3. Add comments that lock the contract:

```sql
COMMENT ON VIEW public.business_public_events_view IS
  'ORCH-0759: public buyer-facing event read model. Excludes theme.business_draft and organiser-private draft metadata.';
```

4. Keep or update existing RLS policies rather than weakening them. Existing public policies already admit:
   - public `events` rows where `visibility='public'` and `status IN ('scheduled','live')`
   - public `ticket_types` rows for public published events
   - brands with public events

5. Do not grant public read to draft/private/hidden events.

### Ticket type public data

No new table is required. Use existing `ticket_types` and current public policy, but implementation must ensure publish upserts ticket rows into `ticket_types`.

Public ticket fields exposed to buyer surfaces:

- `id`
- `event_id`
- `name`
- `description`
- `price_cents`
- `currency`
- `quantity_total`
- `is_unlimited`
- `is_free`
- `sale_start_at`
- `sale_end_at`
- `min_purchase_qty`
- `max_purchase_qty`
- `is_hidden`
- `is_disabled`
- `requires_approval`
- `allow_transfers`
- `password_protected`
- `available_online`
- `available_in_person`
- `waitlist_enabled`
- `display_order`

Never expose `password_hash`.

### Publish data cleanup

At publish, either:

- remove `theme.business_draft` from the scheduled/live row, or
- ensure the public view strips it and all public services query only the stripped view.

The spec requires both defensive layers where practical: strip on public view now, and avoid relying on `theme.business_draft` for buyer surfaces.

### Rollback

Rollback for the migration:

```sql
DROP VIEW IF EXISTS public.business_public_events_view;
```

Do not remove existing base policies in rollback.

## 8. Edge Functions / RPCs / Webhooks

None required for this slice.

Rationale: current Supabase RLS already permits public `anon` reads for published public events, public ticket types, and brands with public events. The implementation should use the anon Supabase client and RLS-bound views/tables rather than adding a service-role edge function.

If implementor discovers that Supabase REST cannot express the required nested public query cleanly, they may add an RPC in the same migration:

```sql
public.get_business_public_event(p_brand_slug text, p_event_slug text)
```

Only if needed. The RPC must be `SECURITY INVOKER`, return the same safe public shape, and be granted to `anon` / `authenticated`. Do not use service-role for public page reads.

## 9. Service Layer

### Canonical URL builder

Path:

`mingla-business/src/constants/publicUrls.ts`

It must import/reuse `MINGLA_BUSINESS_WEB_URL` from `platformUrl.ts`.

Required exports:

```ts
export const BUSINESS_PUBLIC_ORIGIN: string;
export const eventPublicPath(input: { brandSlug: string; eventSlug: string }): string;
export const eventPublicUrl(input: { brandSlug: string; eventSlug: string }): string;
export const brandPublicPath(brandSlug: string): string;
export const brandPublicUrl(brandSlug: string): string;
export const checkoutPublicPath(eventId: string): string;
export const checkoutPublicUrl(eventId: string): string;
export const eventOgImageUrl(input: { eventId: string; coverMediaUrl?: string | null }): string;
export const brandOgImageUrl(input: { brandSlug: string; profilePhotoUrl?: string | null }): string;
```

Rules:

- Builders sanitize/encode path segments.
- Builders do not silently accept empty slugs/ids. They throw a typed `PublicUrlError`.
- `eventOgImageUrl` may return `coverMediaUrl` when public absolute URL exists; otherwise use a canonical static fallback under `BUSINESS_PUBLIC_ORIGIN`.
- Do not create caller-local `https://.../e/...` template strings outside this module.

### Public event service

Path:

`mingla-business/src/services/publicEventsService.ts`

Required signatures:

```ts
export interface PublicEventRecord { ... }
export interface PublicTicketTypeRecord { ... }
export interface PublicBrandRecord { ... }

export async function getPublicEventBySlug(
  brandSlug: string,
  eventSlug: string,
): Promise<{ event: PublicEventRecord; brand: PublicBrandRecord; tickets: PublicTicketTypeRecord[] } | null>;

export async function getPublicEventById(
  eventId: string,
): Promise<{ event: PublicEventRecord; brand: PublicBrandRecord; tickets: PublicTicketTypeRecord[] } | null>;

export async function getPublicBrandBySlug(
  brandSlug: string,
): Promise<{ brand: PublicBrandRecord; events: PublicEventRecord[] } | null>;
```

Behavior:

- Uses `supabase` anon client.
- Queries `business_public_events_view` for event/brand-safe fields.
- Queries `ticket_types` with `.eq("event_id", event.id)`, `.eq("available_online", true)`, `.is("deleted_at", null)`, sorted by `display_order`.
- Throws on Supabase errors.
- Returns `null` only for not found.
- Does not read Zustand stores.

### Publish service updates

Path:

`mingla-business/src/services/eventDrafts.ts`

Required changes:

- `markServerDraftPublished` must preserve/commit the final public slug.
- It must upsert server `ticket_types` rows from the draft ticket payload before or atomically with publish.
- If ticket upsert fails, publish must fail and leave the event in `draft`.
- It must not promote a draft to `scheduled` if public ticket data is missing.
- It must keep `events.visibility` mapped from draft visibility, with public events becoming `public`; unlisted becoming `hidden`; private becoming `private`.

Implementation detail allowed:

- Add a helper `syncDraftTicketsToServerEvent(draft: DraftEvent): Promise<void>` in `eventDrafts.ts` or a focused `eventTickets.ts` service.

## 10. Hook / State / Cache Layer

### Query keys

Add a public query key factory, preferably:

`mingla-business/src/hooks/usePublicEvents.ts`

```ts
export const publicEventKeys = {
  all: ["public-events"] as const,
  detailBySlug: (brandSlug: string, eventSlug: string) => ...,
  detailById: (eventId: string) => ...,
  brandBySlug: (brandSlug: string) => ...,
};
```

Do not reuse organiser event-draft query keys.

### Hooks

Required hooks:

```ts
export function usePublicEventBySlug(brandSlug: string | null, eventSlug: string | null): UseQueryResult<...>;
export function usePublicEventById(eventId: string | null): UseQueryResult<...>;
export function usePublicBrandBySlug(brandSlug: string | null): UseQueryResult<...>;
```

Behavior:

- Enabled only when required params exist.
- `staleTime`: 30-60 seconds.
- Throwing service errors surface through React Query `isError`.
- No optimistic updates.
- No Zustand persistence.
- No auth requirement.

### Local live event store

`useLiveEventStore` remains organiser-local cache only. It may still support the organiser's post-publish navigation and event management surfaces, but it must not be the source of truth for:

- `/e/[brandSlug]/[eventSlug]`
- `/b/[brandSlug]`
- `/checkout/[eventId]/*`

If local `LiveEvent` remains after publish, ensure:

- `serverEventId = events.id`
- `eventSlug = events.slug`
- `brandSlug = brands.slug`

## 11. Component / Screen Layer

### Step 7 preview

Path:

`mingla-business/src/components/event/CreatorStep7Preview.tsx`

Required behavior:

- Remove `mingla.com/e/...`.
- Do not fabricate a final slug from `draftName`.
- If the draft/server row already has a reserved server slug, display:

```text
Tickets will go live at business.usemingla.com/e/{brandSlug}/{eventSlug}
```

- If the final public slug is not yet guaranteed, display:

```text
Tickets will go live on your public Mingla event page after publish.
```

Decision for implementor: prefer reserving/using the server `events.slug` already created for server-backed drafts. Do not show a guessed slug.

### Public event route

Path:

`mingla-business/app/e/[brandSlug]/[eventSlug].tsx`

Required behavior:

- Replace `useLiveEventBySlug` with `usePublicEventBySlug`.
- Render loading, error, not-found, and populated states.
- Pass server public event/brand/tickets into public event UI.
- No `useBrandList` dependency for public brand data.

### Public event component

Path:

`mingla-business/src/components/event/PublicEventPage.tsx`

Required behavior:

- Accept public server event/tickets shape or adapt via a mapper. Do not require `LiveEvent`.
- Use `eventPublicUrl` and `eventOgImageUrl`.
- Share button, native share, clipboard, QR, canonical, OG, and Twitter tags all use canonical builder output.
- Buyer actions route to `checkoutPublicPath(event.id)` where `event.id` is the server UUID.
- If ticket data is absent due to server error, render a clear ticket-load error; do not silently show sold-out/fake empty.

### Public brand route

Path:

`mingla-business/app/b/[brandSlug]/index.tsx`

Required behavior:

- Replace `useBrandList` with `usePublicBrandBySlug`.
- Render loading, error, not-found, and populated states.
- No local `useLiveEventsForBrand` dependency.

### Public brand component

Path:

`mingla-business/src/components/brand/PublicBrandPage.tsx`

Required behavior:

- Accept public server brand/events shape or adapt via a mapper.
- Use `brandPublicUrl`, `brandOgImageUrl`, and `eventPublicPath`.
- Event cards route to canonical event public paths using server event slugs.
- Share/canonical/OG/QR use canonical builders.

### Brand edit URL display

Path:

`mingla-business/src/components/brand/BrandEditView.tsx`

Required behavior:

- Replace `mingla.com/{slug}` with `business.usemingla.com/b/{slug}` via `brandPublicUrl`.
- Preserve existing slug-lock messaging if still accurate.

### Checkout routes

Paths:

- `mingla-business/app/checkout/[eventId]/index.tsx`
- `mingla-business/app/checkout/[eventId]/buyer.tsx`
- `mingla-business/app/checkout/[eventId]/payment.tsx`
- `mingla-business/app/checkout/[eventId]/confirm.tsx`

Required behavior:

- Resolve event/tickets using `usePublicEventById(eventId)`, not `useLiveEventStore`.
- Back-to-event routes use `eventPublicPath({ brandSlug, eventSlug })`.
- Cart remains in-memory for this slice.
- If payment capture remains stubbed, show the existing/testing stub honestly; do not claim real paid ticket capture has shipped.
- Free checkout must not fail merely because local `LiveEvent` is absent.

### ShareModal

Path:

`mingla-business/src/components/ui/ShareModal.tsx`

No core behavior change required. It should continue consuming the passed `url`. Add tests around callers, not a URL-correction layer inside `ShareModal`.

## 12. Business / Admin / Public Parity

- Business app changes: required across publish, public event, public brand, checkout, brand edit, URL constants, tests, Vercel config.
- Admin changes: none.
- Public/web changes: required. Cold public routes must be served by Vercel.
- Operational dependency: deploy `mingla-business` to Vercel with updated `vercel.json` and env `EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL=https://business.usemingla.com`.

## 13. Realtime / Notifications / Analytics

Realtime: none required.

Notifications: none required.

Analytics: optional. If existing analytics exist on public page share/click flows, preserve event names and add URL host as a non-PII property only if already patterned. Do not add new analytics as a blocker.

## 14. Deployment / Vercel / Universal Links

### Vercel

Update:

`mingla-business/vercel.json`

Add rewrites that map cold dynamic paths to exported bracket HTML entrypoints. Required shape:

```json
{
  "rewrites": [
    { "source": "/e/:brandSlug/:eventSlug", "destination": "/e/[brandSlug]/[eventSlug]" },
    { "source": "/b/:brandSlug", "destination": "/b/[brandSlug]" },
    { "source": "/checkout/:eventId", "destination": "/checkout/[eventId]" },
    { "source": "/checkout/:eventId/:step", "destination": "/checkout/[eventId]/:step" }
  ]
}
```

Implementor must verify exact Vercel static-file destination syntax against the exported `dist` output. If Vercel requires `.html` destinations for bracket exports, use `.html`. Do not merge until local export and deployed cold-link smoke prove the routes do not return Vercel 404.

### Universal links

`mingla-business/public/.well-known/apple-app-site-association` currently covers `/b/*` and `/e/*`, not `/checkout/*`. Android currently matches all paths for the host.

Pick one policy and make both platforms consistent:

Preferred:

- Add `/checkout/*` to AASA if checkout is intended as a universal link.

Alternative:

- Narrow Android to exclude checkout if checkout should remain browser-only.

The preferred policy for this spec is to add `/checkout/*`, because public event ticket CTAs route to checkout under the same host.

### Env/docs

- Ensure `.env.example` and `env.example` include `EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL=https://business.usemingla.com`.
- Update stale Stripe onboarding comments that still name `business.mingla.com`.

## 15. Implementation Order

1. Add/verify monotonic Supabase migration `20260515000003_orch_0759_public_event_contract.sql` or later.
2. Add `business_public_events_view` and grants/comments; preserve public RLS.
3. Add `publicUrls.ts` and unit tests for every builder.
4. Add `publicEventsService.ts` and public query hooks.
5. Update publish flow to sync final server slug and upsert `ticket_types` before event promotion.
6. Add publish lifecycle tests for slug identity, ticket sync failure, and no promotion on ticket-sync failure.
7. Update public event route/component to use server public data and canonical URLs.
8. Update public brand route/component to use server public data and canonical URLs.
9. Update checkout routes to resolve server public event/tickets by server event id.
10. Update Step 7 preview copy/URL behavior.
11. Update BrandEditView URL display.
12. Update Vercel rewrites and universal-link files.
13. Update env examples and stale comments/docs.
14. Harden I-PROPOSED-Y or add I-PROPOSED-AB/AC/AD gates.
15. Add/extend tests.
16. Run local export and route smoke against local static output if possible.
17. After operator `supabase db push`, deploy Vercel/business web.
18. Run production cold-link smoke with `curl -I` and browser checks.

## 16. Test Matrix

| ID | Scenario | Input/setup | Expected | Layer | Verification |
|---|---|---|---|---|---|
| T-01 | URL builder event path | `brandSlug='my brand'`, `eventSlug='show one'` | Encoded `/e/my%20brand/show%20one` or chosen slug-safe equivalent; origin is `business.usemingla.com` | Unit | Jest |
| T-02 | URL builder rejects empty | empty brand/event slug | Throws `PublicUrlError` | Unit | Jest |
| T-03 | Step 7 no fake domain | ready free draft | Does not render `mingla.com` or guessed slug unless server slug is guaranteed | Component | Jest/RNTL |
| T-04 | Event share canonical | public event loaded | Share URL, QR, canonical, OG use `eventPublicUrl` | Component | Jest/RNTL |
| T-05 | Brand share canonical | public brand loaded | Share URL, QR, canonical, OG use `brandPublicUrl` | Component | Jest/RNTL |
| T-06 | Brand edit URL | brand slug `acme` | Displays `business.usemingla.com/b/acme` | Component | Jest/RNTL |
| T-07 | Public event cold data with empty stores | clear Zustand; mock Supabase public event result | Event renders from public service | Hook/route | Jest |
| T-08 | Public event not found | Supabase returns empty | Public not-found page, not organiser Home redirect | Route | Jest |
| T-09 | Public event service error | Supabase error | Error state; no silent empty/sold-out | Service/route | Jest |
| T-10 | Public brand cold data with empty stores | clear Zustand; mock Supabase brand result | Brand renders with server events | Hook/route | Jest |
| T-11 | Checkout cold data | empty `useLiveEventStore`; server event id | Checkout tickets screen renders server tickets | Route | Jest |
| T-12 | Publish slug identity | server draft slug exists | local `LiveEvent.eventSlug === events.slug` | Store/service | Jest |
| T-13 | Publish ticket sync failure | ticket upsert fails | event remains draft; user sees publish failure | Service | Jest |
| T-14 | Public view strips draft snapshot | row has `theme.business_draft` | public view result has no `business_draft` | SQL | migration test/manual SQL |
| T-15 | Strict domain gate catches active bad URL | fixture with `business.mingla.com` builder | gate fails | CI | Node gate fixture |
| T-16 | Vercel dynamic route config | local export + rewrite config | `/e/a/b`, `/b/a`, `/checkout/id` do not 404 | Deploy/static | local/production smoke |

Required repo commands:

```text
cd mingla-business && npm run test:orch-0759
cd mingla-business && npx jest publicUrls.test publicEventsService.test publicRoutes.test
cd mingla-business && npx tsc --noEmit
node ../.github/scripts/strict-grep/i-proposed-y-platform-web-url-from-env.mjs
```

Add `test:orch-0759` to `mingla-business/package.json`.

If migration tests are not automated in this repo, tester must run read-only SQL checks after `supabase db push` to verify `business_public_events_view` exists, grants exist, and `theme.business_draft` is absent from returned rows.

## 17. Regression Prevention

**Structural safeguard:**

- `publicUrls.ts` becomes the only public business URL builder.
- `publicEventsService.ts` becomes the public-page data source.

**Tests:**

- URL-builder unit tests.
- Route/service tests that clear local stores and still render server data.
- Publish lifecycle tests for slug/ticket sync.

**Strict gates:**

- Update I-PROPOSED-Y or add a new gate that scans active `mingla-business/app`, `mingla-business/src`, and `supabase/functions` source for:
  - `business.mingla.com`
  - `https://mingla.com`
  - visible public-route copy beginning `mingla.com/`
  - external URL template strings for `/e/`, `/b/`, `/checkout/` outside `publicUrls.ts` and tests
- Remove active allowlists around `PublicEventPage` / `PublicBrandPage`.

**Protective comments:**

- Add short comments only at the builder and route/service boundaries:
  - public URLs must use builder
  - public pages must not use organiser local stores

**Artifact update:**

- Implementor report must call out I-PROPOSED-AB/AC/AD registration candidates for orchestrator close.

## 18. Rollback And Deploy Safety

**Migration order:**

- DB migration first.
- Operator runs `supabase db push`.
- If migration fails, no frontend deploy should proceed.

**Edge function deploy:**

- None.

**Mobile OTA vs native build:**

- No native build expected.
- Business web/native JS changes only. If AASA/assetlinks changes alter app association behavior, normal app release timing may matter for native deep-link testing, but web route fix remains Vercel-side.

**Business/admin web deploy:**

- `mingla-business` Vercel deploy required.
- Verify `EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL` in Vercel env.

**Env vars/secrets:**

- Add `EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL` to env examples.
- Supabase edge secret `MINGLA_BUSINESS_WEB_URL` already belongs to Stripe onboarding; do not change unless current value is wrong.

**Partial rollback risk:**

- If frontend deploy lands before DB migration, public routes may query a missing view and show error.
- If DB migration lands before frontend, no user-visible change except a safe added view.
- If Vercel rewrites land without server-backed route changes, cold links may load app but still show not-found; deploy route and data changes together.

## 19. Runtime Smoke Matrix

Run after DB push and Vercel deploy:

```text
host business.usemingla.com
host business.mingla.com
curl -I -L https://business.usemingla.com/
curl -I -L https://business.usemingla.com/e/{realBrandSlug}/{realEventSlug}
curl -I -L https://business.usemingla.com/b/{realBrandSlug}
curl -I -L https://business.usemingla.com/checkout/{realServerEventId}
curl -L https://business.usemingla.com/.well-known/apple-app-site-association
curl -L https://business.usemingla.com/.well-known/assetlinks.json
```

Expected:

- canonical host resolves.
- `business.mingla.com` remains non-authoritative and is never emitted by app UI.
- public event/brand/checkout URLs do not return Vercel `x-vercel-error: NOT_FOUND`.
- event page renders in a private/incognito browser with local storage cleared.
- brand page renders in a private/incognito browser with local storage cleared.
- checkout ticket-selection page renders server tickets in a private/incognito browser.
- Step 7 and share modal produce the same canonical origin.

## 20. Launch / Residual Risk

This spec can make public links, public event pages, public brand pages, and checkout entry server-backed and reachable.

Residual risk after this implementation if no separate payment/order backend lands:

- Paid checkout may still be a transitional/stub payment flow.
- Free ticket reservation may still be local unless another approved order spec wires server orders.
- Capacity decrement, real order persistence, wallet pass generation, and cross-device scanner validation remain outside this spec unless already shipped elsewhere.

Those risks must be labeled honestly in checkout UI and in the implementation report. They do not excuse broken public links or local-only public event lookup.

## 21. Common Mistakes

1. Replacing `business.mingla.com` with `business.usemingla.com` in place while leaving local-store public pages unchanged.
2. Letting Step 7 show a guessed slug before publish.
3. Building new URLs inline instead of through `publicUrls.ts`.
4. Querying `events_public_view` and accidentally exposing `theme.business_draft`.
5. Promoting a draft before `ticket_types` rows exist.
6. Fixing client navigation but leaving cold Vercel paths as 404.
7. Making checkout work only when the organiser's local `LiveEvent` store is present.
8. Leaving old allowlist comments that let the gate pass active dead-domain code.

## 22. Handoff To Implementor

Implement the server-backed public URL contract, not a cosmetic string patch. Start with the safe public SQL view and URL builder, then wire public services/hooks, publish slug/ticket sync, public routes, checkout entry, Vercel rewrites, and regression gates. Keep `LiveEvent` as organiser cache only; buyer-facing `/e`, `/b`, and `/checkout` must work in a cold browser with empty local storage. Payment/order persistence remains an explicit residual risk unless another approved spec is in scope, but dead domains, Vercel 404s, and local-only public reads must be fixed here.

Spec Verdict: READY FOR IMPLEMENTATION

Next implementor prompt title: `IMPLEMENTOR_ORCH-0759_BUSINESS_PUBLIC_DOMAIN_AND_SHARE_URL_AUTHORITY.md`

Unresolved operator decisions: none for the public URL/server-backed route repair. If the operator wants real paid checkout/order persistence included, that should be a separate follow-on ORCH because it exceeds the proven domain/public-route failure scope.
