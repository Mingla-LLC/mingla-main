# Investigation Report: Business Draft And Brand Persistence (ORCH-0756)

> Date: 2026-05-08
> Source: User report via orchestrator
> Confidence: High for root causes; medium for full persisted-data audit breadth
> Status: root cause proven

## 1. Layman Summary

The draft was not secretly deleted from the database. The business app currently saves event drafts only on the device, then deliberately wipes that local storage when the user signs out. So sign-out/sign-in removes the draft, and deleting/reinstalling the app would remove it too.

The Home brand problem has the same shape. The actual brand row lives in Supabase, but the "currently selected brand" pointer lives only in local app storage. Sign-out clears that pointer. When the user signs back in, the app fetches the user's brands but does not automatically pick one, so Home can wrongly show "No brands yet" even when `brands.length > 0`.

This is a product-contract mismatch: logout cleanup is doing what the old local-only architecture asked for, but drafts, live events, orders, scans, door sales, team invites, and similar business records are now important records that should survive sign-out and app deletion. The fix should move real business records to server-backed storage and keep logout cleanup focused on local cache/session data.

## 2. Scope

- **Feature / issue:** Business app event draft persistence and active brand recovery after sign-out/sign-in.
- **Actor:** Signed-in business organiser.
- **Environment:** `mingla-business`, Supabase schema/RLS, persisted Zustand/AsyncStorage, React Query.
- **Success definition:** Draft events and other important organiser records survive sign-out and app deletion; Home selects a valid brand after sign-in when one exists; Home never says "No brands yet" when the user has brands.
- **Assumptions:** "App deletion" means local AsyncStorage is gone and only Supabase/server state can recover data.
- **Out of scope:** Implementing the fix in this forensic pass; live Supabase mutation/testing.

## 3. Intended Journey

`Home/Event create -> create draft -> autosave draft to durable account/brand-scoped storage -> sign out clears session/local cache only -> sign in -> account row and brands reload -> default/last/recent brand is selected -> draft list and Home upcoming recover from server-backed event data`

Expected failure behavior: if network save fails, the user should see an error/retry state or offline queue; if the previous default brand was deleted or access was revoked, the app should pick the newest valid brand or show a "select brand" state, not "No brands yet."

## 4. Historical Context

- `README.md:59-60` creates the tension: server-authoritative state must stay server-side, while logout clears local private data.
- `README.md:68` allows persisted local state for instant startup, but not as the only durable copy for important records.
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0754_BUSINESS_HOME_UPCOMING_STUB_DATA.md:61-64` already noted schema supports events but Home/event truth was still local persisted draft/live stores.
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0754_BUSINESS_HOME_UPCOMING_STUB_DATA.md:169` warned not to rehydrate full Brand snapshots; this investigation preserves that invariant and recommends server-backed IDs/defaults.
- `Mingla_Artifacts/PRIORITY_BOARD.md:3` registered this as ORCH-0756 and required investigation before implementation.
- Prior ORCH-0742/0743 context intentionally moved `currentBrand` to ID-only local state to stop stale brand snapshots. That was correct, but no server-backed fallback selection was added.

## 5. Investigation Manifest

| # | File / artifact | Layer | Why read |
|---|---|---|---|
| 1 | `README.md` | Docs | Architecture constitution for server state and logout cleanup |
| 2 | `docs/IMPLEMENTATION_GATES.md` | Docs | Logout/user-switch persistence checklist |
| 3 | ORCH-0754 report | History | Current Home event-source and currentBrand background |
| 4 | `draftEventStore.ts` | State/cache | Draft creation, updates, persistence, reset |
| 5 | `AuthContext.tsx` + `clearAllStores.ts` | Auth/lifecycle | Sign-out cleanup path |
| 6 | `event/create.tsx` + `EventCreatorWizard.tsx` | UI/code | Draft user journey write path |
| 7 | `currentBrandStore.ts` + `useCurrentBrand.ts` | State/cache | Active brand pointer semantics |
| 8 | `useBrands.ts`, `brandsService.ts`, `BrandSwitcherSheet.tsx` | Query/service/UI | Brand list, brand creation, brand picking |
| 9 | `useCreatorAccount.ts`, `creatorAccount.ts` | Query/service | `default_brand_id` availability and usage |
| 10 | baseline Supabase migration | Schema/RLS | Events, creator account default brand, policies |
| 11 | adjacent persisted stores | Data/cache | What else is local-only and cleared on logout |

## 6. Five-Layer Cross-Check

| Layer | What it says | Evidence | Matches? |
|---|---|---|---|
| Docs | Server state stays server-side; logout clears local private data; lifecycle questions must include logout/user switch. | `README.md:59-60`, `docs/IMPLEMENTATION_GATES.md:28-33` | No: important business records are currently local-only and logout-cleared. |
| Schema/RLS | Server can store draft events and a default brand pointer. | `events.status` includes `draft` at baseline `7792-7822`; `creator_accounts.default_brand_id` exists at `8020-8050`; RLS allows event manager+ event writes at `14246-14258` and creator account self-update at `14222-14230`. | Partial: schema is ready, client does not use it for drafts/default selection. |
| Code | Drafts, selected brand, live events, orders, guests, scans, door sales, team invites, scanner invites, and prefs are local persisted stores cleared on sign-out. | `clearAllStores.ts:30-41`; store headers listed below. | No for durable product expectations. |
| Runtime/tests | Static trace deterministically proves the flow. No live runtime was needed; no automated regression test was found for logout draft persistence or brand auto-selection. | `event/create.tsx:46-52`, `AuthContext.tsx:180-188`, `AuthContext.tsx:470-489`. | No: missing test guard. |
| Data/cache | AsyncStorage survives app restarts but not sign-out reset or app deletion. React Query cache is also cleared on sign-out. | `draftEventStore.ts:466-472`, `currentBrandStore.ts:127-133`, `AuthContext.tsx:185-187`, `AuthContext.tsx:486-489`. | No for app deletion persistence. |

**Contradictions:** The code comments label many stores as transitional and local-only, but the user-facing product now treats the data as real business records. Logout clearing is constitutionally correct for local private cache, but destructive when the only copy of a draft/order/scan/sale lives locally.

## 7. Findings

### Finding 1: Draft Events Are Local-Only And Intentionally Cleared On Sign-Out

- **Severity:** S1 launch blocker for organiser trust
- **Type:** confirmed bug + production-hardening gap + invariant tension
- **Confidence:** proven
- **Broken journey step:** user creates a draft, signs out, signs back in, and expects the draft to still exist.
- **Evidence:** `draftEventStore.ts:18-20` says drafts are transitional client-side storage; `draftEventStore.ts:466-472` persists only to AsyncStorage; `createDraft`/`updateDraft` only mutate local `drafts` at `517-542`; `reset` empties drafts at `576-578`; `AuthContext.tsx:470-489` and `clearAllStores.ts:30-41` call that reset on sign-out.
- **Current behavior:** Drafts survive ordinary app restarts only while AsyncStorage remains and the user does not sign out. Sign-out and app deletion lose them.
- **Expected behavior:** Drafts should be saved to server-backed, account/brand-scoped storage and rehydrated after sign-in, including after app deletion.
- **Causal chain:** Event create route calls local `createDraft` -> wizard autosaves with local `updateDraft` -> signOut calls `clearAllStores` -> draft store reset sets `drafts: []` -> sign-in has no server draft query to recover from.
- **User impact:** Real work appears deleted. Trust damage is high because the user has no warning that drafts are device/session-local.
- **Fix direction:** Move draft events to Supabase `events` with `status='draft'` and related draft metadata/dates/tickets as needed; make Zustand a cache/offline buffer, not the source of truth.
- **Missing test or guardrail:** Sign-out/sign-in regression test proving a draft created before logout reappears after auth bootstrap; app-delete simulation test by clearing AsyncStorage while leaving Supabase rows.
- **Invariant violated:** Constitution #5 in product effect: server-worthy business state is local-only without a durable offline contract.

### Finding 2: Home Says "No Brands Yet" Because No Active Brand Is Recovered After Logout

- **Severity:** S1 UX/data trust bug
- **Type:** confirmed bug + UX gap
- **Confidence:** proven
- **Broken journey step:** user has one or more brands, signs out/signs in, Home says no brand/no brands.
- **Evidence:** `currentBrandStore.ts:127-133` persists only `currentBrandId` locally; `currentBrandStore.ts:161` resets it to null; `clearAllStores.ts:31` calls that reset; `useCurrentBrand.ts:34-45` fetches a brand only if `currentBrandId` exists and has no fallback when null; Home sets `isEmpty = brands.length === 0 || currentBrand === null` at `home.tsx:212`, then renders "No brands yet" at `home.tsx:259-269`.
- **Current behavior:** After logout, `currentBrandId` is null. The app may fetch a non-empty brand list, but Home still enters the empty branch because `currentBrand === null`.
- **Expected behavior:** If brands exist, the app should select a valid brand automatically or render a true "Select a brand" state. It must not say "No brands yet."
- **Causal chain:** Sign-out clears local selected brand -> sign-in refetches brand list -> no code writes `currentBrandId` from server/default/fallback -> `useCurrentBrand` returns null -> Home collapses "no selected brand" into "no brands exist."
- **User impact:** User is told their brand does not exist, even though it does. This also hides drafts/events because brand-scoped selectors receive null.
- **Fix direction:** Use `creator_accounts.default_brand_id` as the server-backed default. On sign-in/brand-list load, if `currentBrandId` is null or invalid, select default brand if still accessible, else newest created brand from `getBrands()` ordering, later replace with most-recent-event heuristic once server events are authoritative. Split Home empty copy into "no brands exist" versus "choose a brand."
- **Missing test or guardrail:** Home test with `brands.length > 0` and `currentBrand === null` must not render "No brands yet"; resolver test for default-brand/newest-brand fallback.
- **Invariant violated:** No fabricated data is not the issue here; the copy is false data about brand existence.

### Finding 3: `default_brand_id` Exists Server-Side But Is Not Wired Into Current Brand Selection

- **Severity:** S1 contributing root cause
- **Type:** confirmed bug / missing product contract
- **Confidence:** proven
- **Evidence:** Supabase has `creator_accounts.default_brand_id` and comments it as an optional UI default at `8020-8050`; FK is present at `13265-13266`; RLS permits creators to read/update own account at `14222-14230`. But `useCreatorAccount.ts:17-30` omits `default_brand_id` from types, `useCreatorAccount.ts:60-64` omits it from select, and update patches cannot set it. `BrandSwitcherSheet.tsx:110-113` and `123-133` set only local current brand on pick/create.
- **Current behavior:** Brand create and pick update local Zustand only; the server never learns the user's preferred/default brand.
- **Expected behavior:** Brand pick/create should update local currentBrandId immediately and persist the chosen brand ID to `creator_accounts.default_brand_id`.
- **Causal chain:** Existing schema was built for this exact UI default -> app never selects/updates the field -> logout clears local pointer -> sign-in has no server pointer to recover.
- **User impact:** Every sign-out can strand the user in a no-selection state.
- **Fix direction:** Extend creator-account query/mutation types to include `default_brand_id`; add a small current-brand resolver hook/mutation; update BrandSwitcher pick/create to persist the choice with rollback/error handling.
- **Missing test or guardrail:** Mutation test or integration-style mock proving brand pick calls `creator_accounts.update({ default_brand_id })`; sign-in resolver test uses server default.

### Finding 4: Multiple Important Business Records Are Also Local-Only And Logout/App-Deletion Fragile

- **Severity:** S1/S2 depending on record type; launch-blocking for finance/door/scan operations before real usage
- **Type:** production-hardening gap
- **Confidence:** proven for listed stores being local-only; medium for final priority order
- **Evidence:** `clearAllStores.ts:30-41` resets current brand, drafts, live events, edit logs, orders, guests, scans, scanner invitations, door sales, brand team, and notification prefs. Store headers explicitly mark local-only/transitional state:
  - Live events: `liveEventStore.ts:16-18`
  - Orders: `orderStore.ts:28-30`
  - Door sales: `doorSalesStore.ts:28-31`
  - Comp guests: `guestStore.ts:4-6`, `29-31`
  - Scans: `scanStore.ts:9-15`, `16-18`
  - Brand team invites/members: `brandTeamStore.ts:4-13`
  - Notification prefs: `notificationPrefsStore.ts:4-10`, `18-20`
- **Current behavior:** These records can vanish on logout/app deletion if they only exist in the business app store.
- **Expected behavior:** Financial, ticketing, access-control, attendance, audit, and durable preference records should be server-backed. Local stores can cache and queue, but should not be the only owner.
- **Causal chain:** Transitional local stores shipped as UI foundations -> logout cleanup correctly clears all stores -> no backend sync exists for several real-world records -> app deletion destroys the only copy.
- **User impact:** Published event data, orders, guest lists, scan history, door sales, team access, scanner invitations, audit trails, and notification preferences can be lost or misrepresented.
- **Fix direction:** Prioritize server backing in this order: event drafts/live events, orders/tickets/payment records, door sales, scans/check-ins, comp guests, team/scanner invitations, audit logs, notification prefs. Existing schema already contains many target tables: `audit_log`, `brand_invitations`, `brand_team_members`, `door_sales_ledger`, `event_dates`, `orders`, `scan_events`, `scanner_invitations`, `ticket_types`.
- **Missing test or guardrail:** Per-domain logout/app-delete persistence tests and a static CI gate preventing new "real record" stores from persisting only in AsyncStorage without an exit condition.

### Finding 5: Brand List Query Only Returns Owned Brands, Not Team-Member Brands

- **Severity:** S2 likely bug
- **Type:** likely bug / open product-scope question
- **Confidence:** probable
- **Evidence:** `getBrands(accountId)` filters `brands.account_id = accountId` at `brandsService.ts:115-121`. RLS supports brand-team reads, and the schema includes `brand_team_members`, but this list query does not join/read team memberships.
- **Current behavior:** A collaborator with brand access but not `brands.account_id` owner may not see the brand in the switcher/list.
- **Expected behavior:** If business app supports brand team members, the brand list should include accessible brands, not owner-only brands.
- **Fix direction:** Separate ORCH/spec unless ORCH-0756 current-brand resolver needs to handle team brands immediately.
- **Missing test or guardrail:** Brand list test for invited team member.

### Finding 6: Event Status Vocabulary Drift Still Exists In Brand Deletion/Preview Paths

- **Severity:** S2 adjacent bug
- **Type:** confirmed side discovery
- **Confidence:** proven
- **Evidence:** DB `events.status` check allows `draft`, `scheduled`, `live`, `ended`, `cancelled` at baseline `7821`; `softDeleteBrand` counts `["upcoming", "live"]` at `brandsService.ts:198-207`; `useBrands.ts` also queries `past`/`upcoming`.
- **Current behavior:** Queries for `upcoming`/`past` cannot match current DB enum values.
- **Expected behavior:** Use DB statuses or a lifecycle helper that maps scheduled/live/ended to UI terms.
- **Fix direction:** Carry forward ORCH-0754 discovery C into the backend-event persistence spec; do not build new draft/live server queries on stale vocabulary.

## 8. Root Cause Proof

### RC-0756-A: Drafts disappear because the only draft copy is in a logout-cleared local store

- **File + line:** `draftEventStore.ts:466-472`, `517-542`, `576-578`; `clearAllStores.ts:30-33`; `AuthContext.tsx:470-489`.
- **Exact code/schema:** persist key `mingla-business.draftEvent.v1` partializes `{ drafts }`; create/update mutate local array; reset sets `{ drafts: [] }`; signOut calls `clearAllStores()`.
- **What it does:** Saves drafts in AsyncStorage-backed Zustand, then empties that store on sign-out.
- **What it should do:** Save draft event rows server-side and only clear local cache/session state on sign-out.
- **Causal chain:** local create -> local autosave -> logout reset -> no server fetch -> draft gone.
- **Verification step:** Create a draft, inspect local store count, call signOut, inspect `useDraftEventStore.getState().drafts.length === 0`; then sign in and observe no Supabase draft query runs.

### RC-0756-B: Home misreports "No brands yet" because brand existence and active brand selection are collapsed

- **File + line:** `home.tsx:212`, `259-269`; `currentBrandStore.ts:153-161`; `useCurrentBrand.ts:34-45`.
- **Exact code/schema:** `const isEmpty = brands.length === 0 || currentBrand === null`; currentBrand reset sets `currentBrandId: null`; `useCurrentBrand` returns `brand ?? null` and has no null-id fallback.
- **What it does:** Treats "brand list is empty" and "no current brand selected" as the same UI state.
- **What it should do:** Distinguish no brands from no selection, and auto-select a valid default when brands exist.
- **Causal chain:** logout clears currentBrandId -> sign-in fetches brands -> no resolver sets currentBrandId -> currentBrand null -> Home says no brands.
- **Verification step:** Mock `useBrandList()` returning one brand while `currentBrandId` is null; Home renders "No brands yet."

### RC-0756-C: Server default brand infrastructure exists but app never reads or writes it

- **File + line:** baseline migration `8020-8050`, `13265-13266`, `14222-14230`; `useCreatorAccount.ts:17-30`, `60-64`; `BrandSwitcherSheet.tsx:110-113`, `123-133`.
- **Exact code/schema:** `creator_accounts.default_brand_id uuid` exists and is self-readable/updatable, but creator account types/selects omit it; brand switcher only calls local `setCurrentBrand`.
- **What it does:** Leaves the durable UI default unused.
- **What it should do:** Persist active brand choice to `creator_accounts.default_brand_id` and use it during post-auth resolution.
- **Causal chain:** default pointer never written -> local pointer cleared -> no durable fallback -> no active brand after sign-in.
- **Verification step:** Pick/create a brand, query `creator_accounts.default_brand_id`; it remains unchanged/null.

## 9. Static / Security / Pattern Flags

| Flag | File | Evidence | Severity | Classification |
|---|---|---|---|---|
| Local-only drafts | `draftEventStore.ts` | Transitional client-side store, logout reset | S1 | confirmed bug |
| False empty copy | `home.tsx` | `brands.length === 0 || currentBrand === null` -> "No brands yet" | S1 | UX gap |
| Unused default brand | `creator_accounts` + hooks | Schema exists; hook omits field | S1 | confirmed bug |
| Local-only money/order state | `orderStore.ts`, `doorSalesStore.ts` | Transitional local persistence | S1/S2 | production-hardening gap |
| Local-only scan/audit state | `scanStore.ts`, `eventEditLogStore.ts` | offline/local authority | S2 | production-hardening gap |
| Team brand list owner-only | `brandsService.ts` | `.eq("account_id", accountId)` | S2 | likely bug |
| Status vocabulary drift | `brandsService.ts`, `useBrands.ts` | `upcoming`/`past` queried against DB enum that lacks them | S2 | confirmed side discovery |

## 10. Blast Radius

- **Other flows affected:** Events tab, event editor, event publish, order ledger, guest list, scanner, door sales, brand team/scanner team, account notification preferences.
- **Mobile/business/admin/public parity:** Evidence is business-app specific. Supabase schema is shared; mobile/admin parity should be checked before backend event status changes.
- **Query keys/cache/state involved:** `brandKeys`, `creatorAccountKeys`, `currentBrandStore`, `draftEventStore`, `liveEventStore`, React Query cache cleared on sign-out.
- **RLS/auth/permission implications:** Event insert/update RLS already requires event-manager-plus for brand; creator account self-update allows default brand pointer. Fix must validate that selected/default brand is readable by the signed-in user.
- **Integrations involved:** Stripe/payment/order flows are adjacent because local order/door sale data is currently fragile.
- **Deploy/migration implications:** Small brand-selection fix likely needs no migration. Draft persistence may need migrations only if existing `events`/`event_dates`/`ticket_types` cannot represent all local draft fields. If a migration is needed, filename prefix must be greater than current max local migration `20260514000000`.
- **Recurring pattern:** Transitional local stores have become user-facing product truth.

## 11. Production Readiness Verdict

- **Ready / not ready:** Not ready for production organiser data durability.
- **Launch blockers:** Drafts and active brand recovery; server-backed event persistence; false Home empty state.
- **Residual risks:** App deletion will continue to lose any local-only store until each domain is moved to server/cache split.
- **Telemetry/monitoring gaps:** No telemetry or audit event for draft autosave failure, default-brand resolution failure, or logout data clearing.
- **Missing tests:** No logout/app-delete persistence tests for drafts; no brand auto-selection resolver tests; no Home "brands exist but none selected" UI test.
- **Fastest next verification:** Implement a focused resolver test: given `brands=[brandA]`, `currentBrandId=null`, `creator.default_brand_id=null`, resolver sets `brandA.id` and Home does not render "No brands yet."

## 12. Discoveries For Orchestrator

- **DISC-0756-A:** Brand team members may not see accessible brands because `getBrands` filters only owner `account_id`. Recommended separate brand-access ORCH unless folded into active-brand resolver.
- **DISC-0756-B:** Event status vocabulary drift from ORCH-0754 is still live in brand delete/preview code. Must be fixed before server-backed events become Home truth.
- **DISC-0756-C:** Local-only business records audit should become a B-cycle durability program, not a one-off patch. Highest risk: drafts/live events, orders, door sales, scans, comp guests, audit logs.

## 13. Recommended Next Step

Write two implementation specs, then dispatch implementor in sequence:

1. **ORCH-0756A: Active brand recovery and honest Home empty state.** No migration expected. Wire `creator_accounts.default_brand_id`, persist brand picks/creates, add a resolver that selects default/newest valid brand after sign-in, and split Home copy for no-brands vs no-selected-brand.
2. **ORCH-0756B: Server-backed event drafts.** Use Supabase `events.status='draft'` as the durable source, define mapping for dates/tickets/local draft fields, add autosave/hydration/error handling, and make Zustand cache-only. This spec must explicitly cover sign-out and app deletion.

Then queue **ORCH-0756C** for the broader durability audit/fix of orders, door sales, scans, guests, team/scanner invitations, edit logs, and notification prefs.
