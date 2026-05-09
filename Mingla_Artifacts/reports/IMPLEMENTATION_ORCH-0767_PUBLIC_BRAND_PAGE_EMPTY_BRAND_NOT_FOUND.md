# Implementation Report: Public Brand Page Empty-Brand Repair (ORCH-0767)

> Date: 2026-05-09
> Mode: Spec Execute
> Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0767_PUBLIC_BRAND_PAGE_EMPTY_BRAND_NOT_FOUND.md`
> Status: implemented and locally verified; DB push/deploy/runtime smoke pending

## 1. Layman Summary

Mingla Business no longer treats "brand has no public events" as "brand does not exist." The public brand page now reads brand identity from a dedicated public brand profile view, then reads event cards separately from the existing public event view. Empty real brands can render a profile with zero events, while missing/deleted brands still return not-found.

The same source-of-truth repair is wired through the crawler/social preview path so empty brands can get brand-specific HTML/OG metadata after migration/deploy.

## 2. Request And Context

- **Request:** Implement ORCH-0767 without causing regressions.
- **Source:** `Mingla_Artifacts/prompts/IMPLEMENT_ORCH-0767_PUBLIC_BRAND_PAGE_EMPTY_BRAND_NOT_FOUND.md`
- **Affected surfaces:** Supabase public read model, `mingla-business` public brand service, `/b/{brandSlug}` data path, social preview HTML, brand OG props, focused tests.
- **Related issues/artifacts:** Investigation and spec for ORCH-0767.

## 3. Scope

- **In scope:** field-limited public brand view, service split between brand profile and public events, server preview parity, regression tests, implementation report.
- **Out of scope:** event publish lifecycle, checkout/orders/Stripe/admin/Explorer, slug editing, CTA hiding, brand privacy toggle.
- **Assumptions:** Current product contract makes non-deleted brand slugs public. Contact fields are intentionally excluded from ORCH-0767 public view.

## 4. Files Read

| File | Why | Relevant finding |
|---|---|---|
| `Mingla_Artifacts/prompts/IMPLEMENT_ORCH-0767_PUBLIC_BRAND_PAGE_EMPTY_BRAND_NOT_FOUND.md` | Implementation contract | Requires public brand read model, app/server parity, tests |
| `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0767_PUBLIC_BRAND_PAGE_EMPTY_BRAND_NOT_FOUND.md` | Root-cause proof | Existing brand lookup was event-backed |
| `Mingla_Artifacts/specs/SPEC_ORCH-0767_PUBLIC_BRAND_PAGE_EMPTY_BRAND_NOT_FOUND.md` | Layer contract | Field whitelist and regression matrix |
| `README.md` | Constitution | No dead taps, one owner per truth, no fabricated data |
| `docs/QUERY_KEY_REGISTRY.md` | Cache pattern check | Preserve existing public brand key |
| `docs/DOMAIN_ADRS.md` | Ownership pattern check | Server truth stays server-backed |
| `supabase/migrations/20260515000005_orch_0763d_event_lifecycle_repair.sql` | Latest public event view/policy | Event view remains public-event-only |
| `mingla-business/src/services/publicEventsService.ts` | Public route service | Split brand identity from event rows |
| `mingla-business/server/socialPreview.js` | Crawler/OG path | Shared false-empty bug |
| `mingla-business/src/services/__tests__/publicEventsService.test.ts` | Service regression tests | Added empty/missing/populated brand cases |
| `mingla-business/server/__tests__/socialPreview.test.ts` | Preview regression tests | Added empty-brand metadata/OG cases |

## 5. Blast Radius

- **Direct changes:** Supabase migration, public brand service, preview server helpers, brand preview APIs, tests.
- **Cascade changes:** Public brand route now receives `{ brand, events: [] }` for empty brands without route/component changes.
- **Parity surfaces:** Browser/app public route and server crawler/OG path now share the same empty-brand contract.
- **Cache impact:** No query key changes; `publicEventKeys.brandBySlug(brandSlug)` stays valid.
- **State boundaries:** No Zustand/local-store public brand fallback added.
- **Auth/RLS/security:** New view exposes only approved public profile fields; base `brands` table policy was not widened.
- **Deploy path:** Operator must run `supabase db push`; `mingla-business` web/server deploy required before production behavior changes.

## 6. Old To New Receipts

### `supabase/migrations/20260515000008_orch_0767_public_brand_profile_view.sql`

- **Before:** No public read model for brand identity independent of public event rows.
- **After:** Adds `public.business_public_brands_view` with only approved public profile fields and `deleted_at IS NULL`.
- **Why:** Empty brands need a public identity row without exposing private organiser/payment/contact fields.

### `mingla-business/src/services/publicEventsService.ts`

- **Before:** `getPublicBrandBySlug` queried `business_public_events_view`; zero event rows returned `null`.
- **After:** Reads `business_public_brands_view` first; missing brand returns `null`; existing brand fetches event rows separately and may return `events: []`.
- **Why:** Separates brand existence from public event availability.

### `mingla-business/server/socialPreview.js`

- **Before:** `fetchPublicBrandBySlug`, `renderBrandHtml`, and `buildBrandOgCardProps` assumed brand identity came from event rows.
- **After:** `fetchPublicBrandBySlug` returns `{ brand, events }`; renderers accept that shape and still tolerate legacy row arrays in tests/helpers.
- **Why:** Crawlers/OG cards must render brand identity for empty real brands.

### `mingla-business/api/public-brand.js`

- **Before:** Empty event rows produced 404.
- **After:** Only missing brand profile returns 404; empty existing brand renders brand HTML.

### `mingla-business/api/og-brand.js`

- **Before:** Empty brand lookup produced generic Mingla fallback props.
- **After:** Empty existing brand passes brand identity into OG props.

### Tests

- **Before:** Tests covered event mapper and populated brand preview only.
- **After:** Tests cover empty brand, missing brand, populated brand/tickets, brand field preservation, migration field guard, empty-brand HTML, and empty-brand OG props.

## 7. Implementation Details

- **Architecture decisions:** Added a field-limited view instead of broadening public `brands` table reads.
- **Data flow:** `/b/{slug}` service flow is now brand profile view -> public events view -> ticket types per event.
- **Mutation/query behavior:** No mutations changed; no query-key changes.
- **State handling:** React Query remains owner of public server data; no persisted state introduced.
- **Error handling:** Supabase errors still throw through existing query error handling.
- **Copy/accessibility:** Existing public page empty copy remains; preview HTML adds "No upcoming events yet" for crawler pages.
- **Analytics/notifications/realtime:** None.

## 8. Spec / Goal Traceability

| Criterion / goal | Implemented | Verification | Status |
|---|---|---|---|
| Empty real brands render profile, not not-found | Yes | `publicEventsService.test.ts` empty-brand case | PASS |
| Missing/deleted brands remain not-found | Missing row returns `null`; deleted rows excluded by view | service test + SQL filter review | PASS locally |
| Public event lists remain event-backed | Yes | service still queries `business_public_events_view` for events | PASS |
| Public brand data is field-limited | Yes | migration whitelist + static test excludes private fields | PASS |
| Social preview/OG parity | Yes | socialPreview tests for empty-brand HTML and OG props | PASS |
| Regression tests added | Yes | focused Jest suite | PASS |

## 9. Invariant Verification

| Invariant | Relevant | Preserved | Notes |
|---|---|---|---|
| No dead taps | Yes | Yes | CTA can now resolve an empty real brand after deploy |
| One owner per truth | Yes | Yes | Brand identity and event list have distinct server read models |
| No silent failures | Yes | Yes | Service still throws Supabase errors |
| No fabricated data | Yes | Yes | Event count comes from returned public rows; no fake stats added |
| Server state stays server-side | Yes | Yes | No local store fallback |

## 10. Parity Check

- **Mobile:** Native business app JS will need OTA/rebuild if it bundles this service code.
- **Business app:** Implemented in `mingla-business`.
- **Admin:** Not affected.
- **Public/web:** Implemented locally; production requires DB push and web/server deploy.
- **Solo/collab:** Not applicable.
- **Gaps:** Runtime smoke pending after migration/deploy.

## 11. Cache And Persisted State Safety

- **Query keys changed:** None.
- **Invalidations added:** None.
- **Data shape changes:** `getPublicBrandBySlug` same external result shape; it now returns non-null for empty brands.
- **AsyncStorage/Zustand impact:** None.
- **Cold start behavior:** Public route still cold-fetches server data by slug.

## 12. Verification

| Check | Command / method | Result | Notes |
|---|---|---|---|
| Migration authority | `/Users/sethogieva/bin/supabase migration list --linked` and local `ls supabase/migrations` | PASS | Local and linked remote max were `20260515000007`; new migration uses `20260515000008` |
| Focused Jest | `cd mingla-business && npx jest --runTestsByPath src/services/__tests__/publicEventsService.test.ts server/__tests__/socialPreview.test.ts` | PASS | 2 suites, 16 tests |
| TypeScript | `cd mingla-business && npx tsc --noEmit` | PASS | No output |
| Diff hygiene | `git diff --check -- <ORCH-0767 files>` | PASS | No whitespace errors |

`npm test -- --runTestsByPath ...` was attempted first and failed because `mingla-business` has no `test` script. The repo's existing ORCH scripts use `npx jest`, so verification continued with that runner.

## 13. Regression Surface

1. Public brand pages for populated brands: covered by populated service and preview tests.
2. Missing brand 404 behavior: covered by service missing-row test; API behavior should be runtime-smoked.
3. Public event privacy: preserved because events still come only from `business_public_events_view`.
4. Social previews: covered for empty brand and existing populated metadata helpers.

## 14. Risks, Limitations, Transition Items

| Item | Risk / temporary state | Exit condition | Location |
|---|---|---|---|
| Runtime not smoked | Local tests cannot prove production DB view exists or deployed web/server bundle is live | Operator runs DB push, deploys business web/server, tester verifies `/b/brand3` and preview routes | Deploy gate |
| Contact fields excluded | PublicBrandPage can render contact if present, but ORCH-0767 intentionally does not expose it | Product explicitly decides contact fields are public | Spec open question |

## 15. Discoveries For Orchestrator

- None beyond the known deploy/runtime gate.

## 16. Deploy Notes

- **Migrations:** New `supabase/migrations/20260515000008_orch_0767_public_brand_profile_view.sql`; operator must run `supabase db push`.
- **Edge functions:** None.
- **Mobile OTA/native:** Business app JS update required for installed native app parity.
- **Business/admin web:** `mingla-business` web/server deploy required for public route and API preview behavior.
- **Env vars/secrets:** None.

## Suggested Commit Message

```text
fix(business): render empty public brand pages

Resolves: ORCH-0767
Evidence: npx jest --runTestsByPath publicEventsService.test.ts socialPreview.test.ts; npx tsc --noEmit
Deploy: supabase db push for 20260515000008, then mingla-business web/server deploy
```

## Ready-To-Test Checklist

1. After DB push/deploy, open signed-out `https://business.usemingla.com/b/brand3`; expected brand name plus `No upcoming events yet`.
2. Open `https://business.usemingla.com/b/__definitely_missing_orch_0767__`; expected true not-found.
3. Open a populated public brand; expected identity plus event cards.
4. Inspect `/api/public-brand?brandSlug=brand3`; expected brand-specific HTML, not 404.
5. Inspect `/api/og-brand?brandSlug=brand3`; expected brand-specific OG image props/output, not generic fallback.
