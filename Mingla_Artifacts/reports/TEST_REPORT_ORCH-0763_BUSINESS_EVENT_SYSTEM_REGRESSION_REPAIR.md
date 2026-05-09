# QA Report: Business Event System Regression Repair (ORCH-0763)

> Date: 2026-05-08
> Mode: SPEC-COMPLIANCE / TARGETED
> Verdict: FAIL
> Findings: P0:0 P1:4 P2:2 P3:1 P4:3

## 1. Layman Summary

The fix moves publish in the right direction: Step 7 no longer invents a `mingla.com/e/...` URL, share modals now display a tappable canonical URL, and publish calls a new server RPC that rejects `draft-*` slugs.

It is not ready to close or deploy as-is. The app still has stale local-only behavior around draft autosave and published-event lifecycle actions. That means a user can still see misleading success, lose newer draft edits to older server responses, or keep seeing "draft" style state until the server repair is deployed and retested.

## 2. Inputs Reviewed

- Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0763_BUSINESS_EVENT_SYSTEM_REGRESSION_REPAIR.md`
- Implementation report: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0763_BUSINESS_EVENT_SYSTEM_REGRESSION_REPAIR.md`
- Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0763A_PUBLISH_DRAFT_SLUG_AND_SHARE_LINK_AUDIT.md`
- Migration: `supabase/migrations/20260515000004_orch_0763_event_system_regression_repair.sql`
- Key code: event publish service/hook, server draft hook, event wizard, Events tab, Event Detail, Edit route, ShareModal, public URL builders, public event route/service
- Tests: ORCH-0763, ORCH-0759, TypeScript, ESLint, diff-check, remote migration list

## 3. Test Manifest

| Layer | Files / artifacts | What was checked |
|---|---|---|
| Database/RLS | `20260515000004...sql`, baseline RLS policies | RPC shape, slug trigger exception, management read view, remote migration status |
| Services | `businessEvents.ts`, `eventDrafts.ts`, `publicEventsService.ts` | RPC usage, draft-publish disablement, public/management read models |
| Hooks/State/Cache | `useBusinessEvents.ts`, `useServerDraftEvents.ts`, `liveEventStore.ts` | Query ownership, cache invalidation, autosave conflict behavior, local fallback |
| Screens | Events tab, Event Detail, Edit route, EventCreatorWizard, Step 7, ShareModal | Publish flow, share URL, lifecycle actions, routing after publish |
| Tests/Build | Jest suites, tsc, ESLint, diff-check | Claimed command verification and coverage quality |

## 4. Claim Verification

| Claim / criterion | Evidence checked | Status | Notes |
|---|---|---|---|
| Step 7 no longer shows `mingla.com/e/...` or a guessed `draft-*` link | `CreatorStep7Preview.tsx:142-205` | Verified | Ready card now says the public link is created after publish unless a non-draft slug exists. |
| Share modal URL is clickable/actionable | `ShareModal.tsx:176-182`, `ShareModal.tsx:248-260` | Verified | URL text is inside a `Pressable` that calls `Linking.openURL(url)`. |
| Publish uses server RPC and rejects `draft-*` returned slugs | `businessEvents.ts:404-426` | Verified | Calls `business_publish_event_draft`; throws if returned slug starts with `draft-`. |
| Old client-side server publish path is disabled | `eventDrafts.ts:159-165` | Verified | `markServerDraftPublished` now throws. |
| Published events are server-backed in Home/Events/Detail/Edit | `useBusinessEvents.ts`, Events tab, Event Detail, Edit route | Partial | Reads are server-backed, but actions still mutate local store only. See P1-002. |
| Autosave has monotonic `clientRevision` and stale-response protection | `useServerDraftEvents.ts:56-60`, `138-165`; `EventCreatorWizard.tsx:201-210`, `331-340`; repo sweep for `clientRevision` | Refuted | Client revision only appears in publish service, defaults to `null`, and autosave responses overwrite unconditionally. See P1-001. |
| Lifecycle actions call server mutations or are disabled honestly | Events tab `390-422`; Event Detail `243-270` | Refuted | End sales/cancel still call `liveEventStore.updateLifecycle` and show success. See P1-002. |
| Regression tests cover original critical behavior | Jest tests reviewed | Refuted | Existing tests are mostly adapter/static source checks and do not simulate autosave races, hydration races, real hook behavior, or lifecycle false-success. See P1-004. |
| Remote DB has migration applied | `supabase migration list --linked` | Refuted | Local `20260515000004` is absent on remote. See P1-003. |

## 5. Verification Performed

| Check | Command / method | Result |
|---|---|---|
| ORCH-0763 tests | `PATH="/opt/homebrew/bin:$PATH" npm run test:orch-0763` in `mingla-business` | PASS: 4 suites / 24 tests |
| ORCH-0759 tests | `PATH="/opt/homebrew/bin:$PATH" npm run test:orch-0759` in `mingla-business` | PASS: 4 suites / 24 tests |
| TypeScript | `PATH="/opt/homebrew/bin:$PATH" npx tsc --noEmit` | PASS |
| Targeted ESLint | `npx eslint src/hooks/useBusinessEvents.ts src/services/businessEvents.ts src/hooks/useServerDraftEvents.ts src/components/event/EventCreatorWizard.tsx app/(tabs)/events.tsx app/event/[id]/index.tsx app/event/[id]/edit.tsx` | PASS |
| Whitespace | `git diff --check` | PASS |
| Remote migration head | `/Users/sethogieva/bin/supabase migration list --linked` | FAIL for release: `20260515000004` local only, not remote |
| Domain sweep | `rg "business\\.mingla\\.com|mingla\\.com/e|MINGLA_BUSINESS_WEB_URL|eventPublicUrl"` | PASS for active share code; stale docs/comments remain |

## 6. Findings

### P1 High

**P1-001: Autosave race protection required by the spec is not implemented**

- **Evidence:** `EventCreatorWizard.tsx:201-210` only debounces a draft; `EventCreatorWizard.tsx:331-340` sends the latest local draft without any revision. `useServerDraftEvents.ts:161-165` unconditionally `upsertDraft(draft)`, updates query data, and invalidates the list after every autosave success. `useServerDraftEvents.ts:56-60` and `138-142` also unconditionally hydrate list/detail responses into the local draft store.
- **What is wrong:** The spec required a monotonic `clientRevision`, stale response rejection, and protection so list/detail hydration cannot overwrite a dirty active editor. The code has none of that for autosave.
- **Impact:** A slower old autosave or list/detail refetch can overwrite newer text the organiser just typed. This is one of the original root-cause classes and is a release blocker for the event creator.
- **Required fix:** Add client-side draft revision tracking to autosave, send revision in the payload, apply server responses only when they are current, and prevent list/detail hydration from overwriting an active dirty draft.
- **Retest:** Add a repo-running test that simulates autosave response B returning before older response A and proves A cannot overwrite the UI/store. Add a hydration race test for active dirty editor state.

**P1-002: Server-loaded lifecycle actions still mutate only the old local store while showing success**

- **Evidence:** Events tab uses server events via `useBusinessEventsForBrand` / `mergeServerAndLegacyLiveEvents` at `app/(tabs)/events.tsx:118-129`, but end-sales/cancel handlers still call `updateLifecycle` from `liveEventStore` at `app/(tabs)/events.tsx:390-422`. Event Detail resolves server events at `app/event/[id]/index.tsx:105-108`, but its end-sales/cancel handlers call the same local store at `app/event/[id]/index.tsx:243-270`.
- **What is wrong:** For events loaded from Supabase, the old local store may not contain that event. The UI can show "Ticket sales ended" or "Event cancelled" without changing the server event.
- **Impact:** Organisers can believe an event was cancelled or sales ended when nothing persisted. That is a critical trust and operational issue.
- **Required fix:** Either wire real server mutations for published lifecycle actions, or disable/hide those actions for server-loaded events with honest copy until the mutation exists.
- **Retest:** Add tests for server-loaded event end-sales/cancel behavior proving either a server mutation is called or the action is unavailable with a clear message.

**P1-003: The required DB migration is not deployed, so the real environment cannot have the claimed fix yet**

- **Evidence:** `supabase migration list --linked` shows local `20260515000004` with no matching remote version.
- **What is wrong:** The new RPC, slug-trigger exception, and management view are not active remotely.
- **Impact:** Publishing in any environment pointed at the linked remote will still use the old database behavior or fail if the app calls the new RPC before the migration is pushed.
- **Required fix:** After code rework passes, operator must run `supabase db push` and then tester must run a real publish smoke against a safe fixture.
- **Retest:** Confirm remote migration list includes `20260515000004`, then create/publish a free-ticket event and verify public URL is `https://business.usemingla.com/e/{brandSlug}/{titleSlug}`, not `draft-*`.

**P1-004: Regression coverage is too shallow for a critical launch blocker**

- **Evidence:** `businessEventsPublish.test.ts` covers the service adapter and mocked RPC response. `serverDraftLifecycleGuards.test.ts` is mostly string/source inspection. There is no behavioral hook/component test for autosave race, hydration race, lifecycle false-success, empty `liveEventStore` publish recovery, or insufficient-role publish failure.
- **What is wrong:** The tests pass while P1-001 and P1-002 remain. That proves the suite would not catch regressions in the exact areas that hurt users.
- **Impact:** A green test run can falsely clear a broken publish/share lifecycle.
- **Required fix:** Add behavior tests for autosave ordering, hydration protection, post-publish server event read with empty local store, lifecycle action handling, free-ticket publish path, and role failure handling.
- **Retest:** Re-run ORCH-0763 and related suites; tester should review that at least one test fails on the old broken behavior.

### P2 Medium

**P2-001: Legacy local `le_...` route recovery is not implemented**

- **Evidence:** Event Detail and Edit route resolve `useBusinessEventById(id)` plus local fallback, but I found no router replacement from local `le_...` to `serverEventId`.
- **What is wrong:** The spec required compatibility recovery when a local cached event has `serverEventId`.
- **Impact:** Older cached links can remain on local IDs and miss the server-backed path.
- **Required fix:** If route id is local and cached event has `serverEventId`, replace the route with `/event/{serverEventId}`.

**P2-002: The publish RPC was not runtime-applied or smoke-tested by tester because the DB migration is still local-only**

- **Evidence:** Remote migration missing. No safe runtime publish fixture was available in this tester pass.
- **Impact:** SQL syntax, RLS interaction, trigger behavior, and public buyer rendering still need a real DB smoke after push.
- **Required fix:** After rework and DB push, run a full publish/public-route smoke with a free-ticket event.

### P3 Low

**P3-001: Stale domain references remain in docs/comments**

- **Evidence:** Sweep still finds historical docs/comments such as `brandStripeService.ts` comment text and older artifact reports.
- **Impact:** Not active runtime emission, but it increases future drift risk.
- **Required fix:** Clean in a hygiene pass after the blocker is stable.

### P4 Notes

- The Step 7 copy fix is good: it stops promising a public link before the server finalizes the slug.
- The ShareModal change is directionally right: the displayed URL is now pressable and opens through `Linking.openURL`.
- RLS baseline includes brand-member select policies for `brands`, `events`, and `ticket_types`; the new management view correctly avoids granting anon access.

## 7. Security

| Check | Result |
|---|---|
| RPC auth required | PASS by SQL inspection: `auth.uid()` must exist and event-manager rank is checked. |
| Anon management view read | PASS by SQL inspection: anon SELECT revoked on management view. |
| Public buyer read model | PARTIAL: existing public view remains, but runtime publish/public read not smoke-tested because migration is not remote. |
| Ticket password handling | PASS by SQL inspection: publish rejects plaintext ticket password payloads. |

## 8. Production Verification

| Check | Result | Remaining manual test |
|---|---|---|
| Remote DB migration | FAIL | Push `20260515000004`. |
| Real free-ticket publish | UNVERIFIED | Publish a new safe fixture after DB push. |
| Public link opens | UNVERIFIED | Open `https://business.usemingla.com/e/{brandSlug}/{eventSlug}` cold after publish. |
| Share/copy/native share | PARTIAL | Code verified; runtime ShareModal smoke still needed. |

## 9. Required Actions

1. **P1-001:** Implement autosave/clientRevision/stale-response protection and dirty active draft hydration guard.
2. **P1-002:** Replace local-only lifecycle actions with server mutations or disable them honestly for server-loaded events.
3. **P1-004:** Add behavioral regression tests that fail on the old bug classes.
4. **P1-003:** After code rework passes, push DB migration and run a real publish/public-link smoke.

## 10. Verdict

FAIL. The main URL/publish direction is correct, but two core behavior classes remain unsafe and the database repair is not active remotely. Do not close ORCH-0763 or declare the user-visible issue fixed until rework plus DB push plus runtime publish smoke pass.
