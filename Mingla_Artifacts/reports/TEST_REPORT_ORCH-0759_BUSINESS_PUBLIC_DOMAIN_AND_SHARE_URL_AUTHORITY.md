# QA Report: Business Public Domain and Share URL Authority (ORCH-0759)

> Date: 2026-05-08  
> Mode: SPEC-COMPLIANCE / TARGETED  
> Verdict: FAIL  
> Findings: P0:0 P1:2 P2:2 P3:0 P4:2

## 1. Layman Summary

The implementation fixes the main public event page and brand page paths, but ORCH-0759 is not ready to close or deploy as-is. Two active organiser-facing share surfaces still generate the dead `https://business.mingla.com/e/...` event URL, and the strict domain gate incorrectly passes because stale allowlist comments hide those active violations.

Local tests, TypeScript, and Expo export pass. Production runtime checks remain blocked until `supabase db push` and business Vercel deploy happen.

## 2. Inputs Reviewed

- Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0759_BUSINESS_PUBLIC_DOMAIN_AND_SHARE_URL_AUTHORITY.md`
- Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0759_BUSINESS_PUBLIC_DOMAIN_AND_SHARE_URL_AUTHORITY.md`
- Implementation report: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0759_BUSINESS_PUBLIC_DOMAIN_AND_SHARE_URL_AUTHORITY.md`
- Tester prompt: `Mingla_Artifacts/prompts/TESTER_ORCH-0759_BUSINESS_PUBLIC_DOMAIN_AND_SHARE_URL_AUTHORITY.md`
- Primary code inspected: `publicUrls.ts`, `publicEventsService.ts`, `usePublicEvents.ts`, public `/e`, `/b`, `/checkout` routes, publish services, Vercel config, AASA, tests, strict-grep gate, SQL migration.

## 3. Test Manifest

| Layer | Files / artifacts | What was checked |
|---|---|---|
| Database/RLS | `20260515000003_orch_0759_public_event_contract.sql`, baseline policies | View safety, security invoker, grants, draft metadata stripping, migration order |
| Services | `publicEventsService.ts`, `eventDrafts.ts`, `ticketTypeMapper.ts` | Safe selects, password hash exclusion, publish ticket sync, slug behavior |
| Hooks/State/Cache | `usePublicEvents.ts`, draft/live event store and mapper | Public query keys, no public route local-store source of truth, persisted draft migration |
| Components/Screens | Step 7, public event/brand, checkout, organiser event surfaces | Domain output, route data source, loading/error states, share URLs |
| Deploy/Public Web | `vercel.json`, AASA, `dist/` export | Dynamic route rewrite/export compatibility and universal-link coverage |
| Tests/Build | ORCH-0759 tests, strict gate, TypeScript, Expo export | Regression coverage and build health |

## 4. Claim Verification

| Claim / criterion | Evidence checked | Status | Notes |
|---|---|---|---|
| Public event page share uses canonical builder | `PublicEventPage.tsx`, `publicUrls.ts` | Verified | Public `/e` page now uses `eventPublicUrl`. |
| Public brand page share uses canonical builder | `PublicBrandPage.tsx`, `publicUrls.ts` | Verified | Public `/b` page now uses `brandPublicUrl`. |
| Brand edit displays canonical brand URL | `BrandEditView.tsx` | Verified | Uses `brandPublicUrl(...).replace(/^https?:\/\//, "")`. |
| No active code emits `business.mingla.com` public links | `rg "https://business\\.mingla\\.com/e/" mingla-business/app mingla-business/src` | Refuted | Two active organiser share surfaces still emit dead event URLs. |
| Strict gate catches active bad-domain code | `node ../.github/scripts/strict-grep/i-proposed-y-platform-web-url-from-env.mjs` plus source inspection | Refuted | Gate passes while active violations remain because allowlist comments suppress them. |
| `/e`, `/b`, `/checkout` are server-backed | Route files + hooks | Verified | Public routes use `usePublicEventBySlug`, `usePublicBrandBySlug`, `usePublicEventById`. |
| Ticket public reads avoid `password_hash` | `publicEventsService.ts:219-227` | Verified | Select excludes `password_hash`. |
| Public view strips `business_draft` | Migration | Verified statically | Runtime DB push not performed. |
| Vercel rewrites match export output | `npx expo export -p web`, `find dist ...`, `vercel.json` | Partially verified | Export files exist; deployed Vercel smoke not run. |

## 5. Verification Performed

| Check | Command / method | Result | Evidence |
|---|---|---|---|
| Targeted ORCH tests/gate | `cd mingla-business && npm run test:orch-0759` | PASS | 4 suites, 23 tests passed; gate scanned 364 files, 0 reported violations. Watchman recrawl warning only. |
| TypeScript | `cd mingla-business && npx tsc --noEmit` | PASS | Exit 0. |
| Expo web export | `cd mingla-business && npx expo export -p web` | PASS | Exported `dist`; Sentry config and Stripe SSR warnings only. |
| Export route files | `find dist -maxdepth 4 -type f ...` | PASS | Found `dist/e/[brandSlug]/[eventSlug].html`, `dist/b/[brandSlug].html`, and checkout entries. |
| Migration ledger | `/Users/sethogieva/bin/supabase migration list --linked` | PASS / deploy pending | Local includes `20260515000003`; remote currently blank for `20260515000002` and `20260515000003`. |
| Active bad-domain sweep | `rg "https://business\\.mingla\\.com/e/" mingla-business/app mingla-business/src` | FAIL | Found active emitters in organiser event detail and events tab. |

## 6. Constitution Compliance

| Rule | Verdict | Evidence |
|---|---|---|
| No dead taps | PASS | No new dead tap found in inspected surfaces. |
| One owner per truth | FAIL | Active organiser share URLs still bypass `publicUrls.ts`. |
| No silent failures | CONDITIONAL | Public routes have error states; deploy/runtime still unverified. |
| One key per entity | PASS | Public query keys are parameterized by slug/id. |
| Server state server-side | PASS | Public buyer routes are server-backed in code. |
| Logout clears everything | N/A | No logout behavior changed. |
| Label temporary | CONDITIONAL | Checkout/order stubs remain transitional and out of ORCH-0759 scope. |
| Subtract before adding | FAIL | Stale allowed bad-domain paths were not removed before adding new builders. |
| No fabricated data | CONDITIONAL | Step 7 no longer fabricates slugs; public event date fidelity remains incomplete. |
| Currency-aware | PASS | Ticket price mapping uses cents -> GBP existing shape; multi-currency not introduced. |
| One auth instance | PASS | No new auth client found. |
| Validate at right time | CONDITIONAL | Publish sync failure blocks promotion, but ticket sync is not atomic. |
| Exclusion consistency | N/A | Not touched. |
| Persisted-state startup | PASS | `serverSlug` migration defaults legacy drafts to `null`. |

## 7. Findings

### P1 High

**P1-001: Two active organiser share surfaces still emit the dead `business.mingla.com` event URL**

- **Evidence:** `mingla-business/app/(tabs)/events.tsx:86-88`, `mingla-business/app/(tabs)/events.tsx:650-655`, `mingla-business/app/event/[id]/index.tsx:98-100`, `mingla-business/app/event/[id]/index.tsx:685-690`; `rg "https://business\\.mingla\\.com/e/" mingla-business/app mingla-business/src` returns both files.
- **What is wrong:** The Events tab manage-share modal and Event Detail share modal still build `https://business.mingla.com/e/${event.brandSlug}/${event.eventSlug}` instead of using `eventPublicUrl`.
- **Impact:** An organiser can still copy/share the dead domain from active business app surfaces after the fix. This violates ORCH-0759 success criteria 2 and 10 and preserves the root problem in an adjacent organiser workflow.
- **Required fix:** Replace both local `canonicalEventUrl` / `canonicalUrl` helpers with `eventPublicUrl({ brandSlug, eventSlug })` from `src/constants/publicUrls.ts`. Remove the stale allowlist comments.
- **Retest:** Re-run `rg "https://business\\.mingla\\.com/e/" mingla-business/app mingla-business/src`; re-run `npm run test:orch-0759`; manually verify Events tab manage-share and Event Detail share modal receive `business.usemingla.com/e/...`.

**P1-002: The strict domain regression gate passes while active dead-domain emitters remain**

- **Evidence:** `node ../.github/scripts/strict-grep/i-proposed-y-platform-web-url-from-env.mjs` reports `0 violations`; the same active files have `orch-strict-grep-allow platform-web-url-historical` comments immediately above dead-domain builders at `mingla-business/app/(tabs)/events.tsx:86` and `mingla-business/app/event/[id]/index.tsx:98`.
- **What is wrong:** The gate allows active production code to keep emitting the exact dead domain ORCH-0759 is meant to eradicate. The allowlist is valid for historical docs, not active share builders.
- **Impact:** CI/regression protection gives a false green result, so this bug can survive future changes.
- **Required fix:** Tighten the gate or remove active allowlist use so active `mingla-business/app` / `src` URL emitters cannot bypass the bad-domain rule. Allow historical references only in docs/reports/tests or with narrower non-emitting patterns.
- **Retest:** Introduce a temporary fixture or verify existing active dead-domain lines fail the gate before the code fix; after replacing the helpers, the gate should pass with no active allowlisted dead-domain builders.

### P2 Medium

**P2-001: Public event server mapper drops event schedule fields, so cold public pages render `Date TBD`**

- **Evidence:** `mingla-business/src/services/publicEventsService.ts:183-192` sets `date: null`, `doorsOpen: null`, `endsAt: null`, and `multiDates: null` for every public event. `formatDraftDateLine(event)` in public event/checkout surfaces will therefore show `Date TBD`.
- **What is wrong:** The new safe public view strips `theme.business_draft`, which is good for privacy, but no replacement schedule read model is used.
- **Impact:** Cold public event and checkout pages can open, but they lose core buyer information. This is not the original dead-domain failure, but it is a user-visible public-page fidelity gap and should be tracked before launch.
- **Required fix:** Either publish safe schedule fields into first-class event/event_dates data and map them here, or explicitly defer with a dedicated ORCH and manual launch caveat.
- **Retest:** Open a server-backed public event after DB push/deploy and confirm date/time renders from safe server data, not draft JSON.

**P2-002: Publish ticket sync is not atomic and can delete existing draft ticket rows before insert failure**

- **Evidence:** `mingla-business/src/services/eventDrafts.ts:42-56` soft-deletes current `ticket_types` rows, then inserts new rows. `markServerDraftPublished` promotes the event only after sync at `eventDrafts.ts:171-185`.
- **What is wrong:** Event promotion is blocked on insert failure, which is good, but existing ticket rows may already be soft-deleted if the insert fails.
- **Impact:** A publish retry can recover from draft JSON, but the operation is not a true upsert/atomic sync and can leave server ticket rows temporarily empty for the draft.
- **Required fix:** Prefer transactional RPC/upsert semantics or insert replacement rows before deleting old rows. If kept as-is, record the risk as transitional and add a failure-path test for the exact behavior.
- **Retest:** Simulate insert failure after existing ticket rows and verify no ticket row data is lost or the recovery path is explicit and tested.

### P4 Notes

- **P4-001:** `npm run test:orch-0759`, TypeScript, and Expo export all pass locally. The implementation is structurally close, but the active share-domain miss blocks approval.
- **P4-002:** Production runtime proof is correctly still gated on DB push and Vercel deploy. I did not run `supabase db push`, deploy, or mutate live data.

## 8. Spec Traceability

| Criterion | Status | Evidence | Finding |
|---|---|---|---|
| Step 7 never renders `mingla.com/e/...` or guessed slug | PASS | `CreatorStep7Preview.tsx` uses `eventPublicUrl` only when `draft.serverSlug` exists | None |
| Public event share/copy/native share/QR/canonical/OG never emits dead domains | PARTIAL | Public `/e` page fixed; organiser event detail/events tab still emit bad share URL | P1-001 |
| Public brand share/copy/native share/QR/canonical/OG never emits dead domains | PASS | `PublicBrandPage.tsx` uses `brandPublicUrl` / `brandOgImageUrl` | None |
| Brand edit displays real public brand URL | PASS | `BrandEditView.tsx` uses `brandPublicUrl` | None |
| Cold `/e/...` serves app and renders Supabase public data | PARTIAL / DEPLOY BLOCKED | Route/hook/service implemented; runtime not deployed; schedule fields missing | P2-001 |
| Cold `/b/...` serves app and renders Supabase public data | PARTIAL / DEPLOY BLOCKED | Route/hook/service implemented; runtime not deployed | None |
| Cold `/checkout/{eventId}` serves app and resolves server data | PARTIAL / DEPLOY BLOCKED | Route/hook/service implemented; runtime not deployed; schedule fields missing | P2-001 |
| Public pages do not require local stores | PASS | Public routes use public hooks; source guard tests pass | None |
| Public reads do not expose draft/private ticket data | PASS statically | View strips `business_draft`; ticket select excludes `password_hash` | Runtime DB not pushed |
| Domain gates fail active dead-domain code | FAIL | Gate passes while active dead-domain builders remain | P1-002 |
| Regression tests cover URL builders/public loaders/no dead domains | PARTIAL | Tests pass but miss organiser event share emitters | P1-001/P1-002 |

## 9. Security

| Finding/check | Severity | Evidence | Result |
|---|---|---|---|
| Public event view strips draft metadata | None | `20260515000003...sql` uses `(e.theme - 'business_draft') AS public_theme` | PASS statically |
| Ticket select excludes `password_hash` | None | `publicEventsService.ts:219-227` select list | PASS |
| View uses security invoker | None | Migration `WITH (security_invoker = true)` | PASS statically |
| Existing RLS weakened? | None | Migration adds view/grant only; no base policy changes | PASS statically |

## 10. UX / Accessibility

| Screen/state | Finding/check | Severity | Result |
|---|---|---|---|
| Step 7 ready copy | Correct domain/no guessed slug | None | PASS |
| Public event/brand route states | Loading/error/not-found/populated states present | None | PASS |
| Checkout ticket route states | Loading/error/not-found/past/sold-out/populated states present | None | PASS |
| Public event/checkout date display | Server mapper sets date null | P2 | Public pages can show `Date TBD` |
| Organiser share modals | Dead share URL remains | P1 | FAIL |

## 11. Parity

| Surface/path | Tested? | Result | Notes |
|---|---|---|---|
| Mobile | Static only | CONDITIONAL | Business native JS compiles; no device runtime. |
| Business | Static + tests | FAIL | Active organiser share surfaces still emit bad host. |
| Admin | N/A | N/A | Not touched. |
| Public/web | Export + static | CONDITIONAL | Export passes; deployed cold links not run. |
| Solo | N/A | N/A | Not relevant. |
| Collab | N/A | N/A | Not relevant. |
| iOS | Static only | CONDITIONAL | AASA includes checkout; device universal-link runtime not run. |
| Android | Static only | CONDITIONAL | Assetlinks still handles all URLs. |

## 12. Cross-Domain Impact

| Change | Mobile | Business | Admin | Edge/RPC | RLS/Data | Notes |
|---|---|---|---|---|---|---|
| Public URL builder | Business JS | Yes | No | No | No | Good pattern, but not adopted by all active emitters. |
| Public Supabase view | No | Yes | No | No | Yes | Needs DB push before frontend deploy. |
| Public hooks/services | Business JS | Yes | No | No | Yes | Cold route behavior not production-smoked. |
| Vercel rewrites | Web only | Yes | No | No | No | Export files exist; Vercel runtime pending. |

## 13. Production Verification

| Check | Method | Result | Remaining manual test |
|---|---|---|---|
| Public event cold URL | `curl` / incognito after deploy | BLOCKED / NOT RUN | Requires `supabase db push`, Vercel deploy, real event slug. |
| Public brand cold URL | `curl` / incognito after deploy | BLOCKED / NOT RUN | Requires deploy and real brand slug. |
| Checkout cold URL | `curl` / incognito after deploy | BLOCKED / NOT RUN | Requires deploy and real server event id. |
| Publish free event Step 7/share | Runtime publish flow | BLOCKED / NOT RUN | Requires app runtime and deployed DB/view for full proof. |
| Domain `business.mingla.com` not emitted | Static sweep | FAIL | Active organiser share emitters remain. |

## 14. Required Actions

1. **P1-001:** Replace active organiser event share URL helpers in `app/(tabs)/events.tsx` and `app/event/[id]/index.tsx` with `eventPublicUrl` from `src/constants/publicUrls.ts`; remove stale allowlist comments.
2. **P1-002:** Harden `i-proposed-y-platform-web-url-from-env.mjs` so active app/source bad-domain emitters cannot be allowlisted as historical. Historical docs/tests can remain exempt; active public URL builders cannot.

## 15. Conditional / Recommended Actions

1. **P2-001:** Track or fix the public safe schedule read model before launch; server-backed public event pages should not show `Date TBD` for scheduled events.
2. **P2-002:** Consider making publish ticket sync transactional/upsert-based, or add an explicit failure-path test and accepted transitional note.
3. After rework, run:
   - `cd mingla-business && npm run test:orch-0759`
   - `cd mingla-business && npx tsc --noEmit`
   - `cd mingla-business && npx expo export -p web`
   - `rg "https://business\\.mingla\\.com/e/" mingla-business/app mingla-business/src`

## 16. Discoveries For Orchestrator

- ORCH-0759 should return to `$implementor` for a small rework, not proceed to DB push/deploy or close.
- The strict gate’s allowlist model needs a policy distinction between historical artifact references and active runtime URL emitters.
- Public schedule fidelity likely deserves a follow-on ORCH unless reworked inside ORCH-0759 before launch.

## 17. Retest Notes

| Previous finding | Fixed? | Evidence | Regression? |
|---|---|---|---|
| N/A first tester pass | N/A | N/A | N/A |

Retest cycle: N/A
