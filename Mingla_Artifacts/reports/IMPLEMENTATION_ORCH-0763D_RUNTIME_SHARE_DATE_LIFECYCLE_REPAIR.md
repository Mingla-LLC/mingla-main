# Implementation Report: Runtime Share, Date, And Lifecycle Repair (ORCH-0763D)

> Date: 2026-05-08  
> Mode: Spec Execute  
> Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0763D_RUNTIME_SHARE_DATE_LIFECYCLE_REPAIR.md`  
> Status: implemented, partially verified

## 1. Layman Summary

Publishing and sharing now use one real public URL path: `https://business.usemingla.com/...`. Native Copy Link writes to the device clipboard, Share Via sends the same SEO URL, public event/brand/checkout surfaces read the saved event date instead of showing Date TBD, and organisers can cancel or close ticket sales for server-backed events without fake local success.

## 2. Request And Context

- **Request:** Implement the ORCH-0763D repair spec after forensic proof.
- **Source:** User-dispatched `$implementor` after `SPEC_ORCH-0763D_RUNTIME_SHARE_DATE_LIFECYCLE_REPAIR.md`.
- **Affected surfaces:** Mingla Business public event pages, brand pages, checkout, Events tab, Event Detail, ShareModal, Supabase RLS/RPC.
- **Related artifacts:** `INVESTIGATION_ORCH-0763D_RUNTIME_SHARE_DATE_LIFECYCLE_BLAST_RADIUS.md`, `RUNTIME_ORCH-0763_FREE_EVENT_SHARE_DEVICE_SWEEP.md`.

## 3. Scope

- **In scope:** Clipboard/share helper, public event date mapping, server cancel/end-sales RPCs, lifecycle hooks/UI, public cancelled/ended read model, targeted regression tests.
- **Out of scope:** `supabase db push`, deployment, direct production data cleanup, Stripe/checkout payment logic.
- **Assumptions:** `business.usemingla.com` remains the canonical public domain.

## 4. Files Read

| File | Why | Relevant finding |
|---|---|---|
| `ShareModal.tsx` | Share/copy bug | Native copy only showed a workaround toast. |
| `PublicEventPage.tsx` | Public buyer surface | Had a duplicate unused share implementation and ticket rows ignored sale-ended state. |
| `publicEventsService.ts` | Date TBD bug | Ignored `public_theme.business_event.when`. |
| `businessEvents.ts`, `useBusinessEvents.ts` | Server event ownership | Publish RPC pattern could be reused for lifecycle RPC adapters/cache writes. |
| `events.tsx`, `event/[id]/index.tsx` | Organiser lifecycle UI | Server-backed lifecycle actions were blocked with unavailable toasts. |
| `20260515000003/00004` migrations | RLS/view/RPC precedent | Public read model only allowed scheduled/live; management view already included ended/cancelled. |

## 5. Blast Radius

- **Direct changes:** Sharing, public mapping, lifecycle mutations, lifecycle UI, public ticket availability.
- **Cascade changes:** React Query detail/list/public invalidations after lifecycle mutations.
- **Parity surfaces:** Events tab and Event Detail now both use the same server lifecycle hooks.
- **Cache impact:** `business-events` and `public-events` query keys are updated/invalidated after cancel/end-sales.
- **State boundaries:** Server-backed events mutate Supabase only; legacy local events still use Zustand local lifecycle for transitional records.
- **Auth/RLS/security:** RPCs enforce authenticated user plus `event_manager` rank or above and lock the event row.
- **Deploy path:** Requires Supabase migration push and native rebuild/dev-client refresh because `expo-clipboard` was added.

## 6. Old To New Receipts

| Area | Before | After | Why |
|---|---|---|---|
| `ShareModal` / `sharePublicUrl.ts` | Native Copy Link copied nothing. | Native uses `expo-clipboard`; web uses `navigator.clipboard`; share uses one helper. | One owner for public URL sharing. |
| `PublicEventPage` | Duplicate unused share code; sales-ended tickets could still show active CTA. | ShareModal owns share; sale-ended tickets are disabled/labeled. | Prevent Expo/current-route drift and false purchase affordances. |
| `EventManageMenu` | Row said `Copy share link` but opened modal. | Row says `Share event`. | Label now matches behavior. |
| `publicEventsService` | Public dates were null. | Maps `business_event.when`, format, category, location, settings, recurrence, multi-dates. | Buyer surfaces show saved event details. |
| `businessEvents` / `useBusinessEvents` | Publish was the only RPC adapter. | Added cancel and end-sales adapters/hooks with cache updates. | Server is authoritative for published event lifecycle. |
| Events tab / Event Detail | Server lifecycle actions hidden or unavailable. | Server-backed cancel/end-sales call RPC hooks with retry toasts. | Real organiser controls. |
| Supabase migration | Public view/RLS excluded ended/cancelled. | Public exact URLs can read scheduled/live/ended/cancelled; brand lists filter cancelled/ended client-side. | Cancelled pages render instead of 404. |

## 7. Implementation Details

- **Architecture decisions:** Added a small `sharePublicUrl` utility instead of duplicating web/native share logic.
- **Data flow:** Public mapper now uses `public_theme.business_event` as the source of saved runtime event details.
- **Mutation/query behavior:** Lifecycle hooks write durable event detail/list cache and invalidate public detail/brand keys.
- **State handling:** Legacy local event lifecycle remains local; server-backed event lifecycle goes through RPCs.
- **Error handling:** Copy success only after resolve; copy failures and lifecycle RPC failures show retryable toasts and keep dialogs/actions usable.
- **Copy/accessibility:** Menu label now says `Share event`; public ticket CTA labels say `Sales ended`/`Sales paused` when appropriate.
- **Analytics/notifications/realtime:** Not changed.

## 8. Spec / Goal Traceability

| Criterion / goal | Implemented | Verification | Status |
|---|---|---|---|
| Native copy writes exact public URL | Yes | `sharePublicUrl.test` | PASS |
| Share payload uses SEO URL, not Expo/current route | Yes | `sharePublicUrl.test`, ORCH-0759 gate | PASS |
| Public page maps saved date/time | Yes | `publicEventsService.test` | PASS |
| Public brand/checkout receive same date | Yes | `publicEventsService.test` | PASS |
| Server cancel for scheduled/live | Yes | migration + adapter tests | PASS |
| Server end ticket sales without ending event | Yes | migration + adapter tests | PASS |
| Cancelled/ended exact public URLs readable | Yes | migration source test | PASS |
| Existing ORCH-0759/0763 guards preserved | Yes | required scripts | PASS |

## 9. Invariant Verification

| Invariant | Relevant | Preserved | Notes |
|---|---|---|---|
| I-PROPOSED-Y public URL origin | Yes | Yes | Real scan found zero violations. |
| Server state authority | Yes | Yes | Server-backed lifecycle actions call RPCs, not local fake success. |
| Permission semantics | Yes | Yes | RPC rank gate is `event_manager` or above. |
| No hard delete of public events | Yes | Yes | Cancel updates status only. |
| Migration monotonicity | Yes | Yes | Added `20260515000005_*`, above local max `00004`. |

## 10. Parity Check

- **Mobile:** Copy/share helper supports native; requires native rebuild for `expo-clipboard`.
- **Business app:** Events tab and Event Detail wired.
- **Admin:** Not touched.
- **Public/web:** Event page, brand page, checkout mapping and availability updated.
- **Solo/collab:** Server RPC enforces rank; lower ranks stay gated by existing UI permission checks and DB.
- **Gaps:** Runtime simulator clipboard/share retest still required after native rebuild.

## 11. Cache And Persisted State Safety

- **Query keys changed:** None.
- **Invalidations added:** `businessEventKeys.detail/list`, `publicEventKeys.detailById/detailBySlug/brandBySlug`.
- **Data shape changes:** Public mapper now populates existing `LiveEvent` fields; no new client shape.
- **AsyncStorage/Zustand impact:** None for server-backed records; legacy local fallback unchanged.
- **Cold start behavior:** Server-backed lifecycle state reloads from Supabase views/RLS after migration.

## 12. Verification

| Check | Command / method | Result | Notes |
|---|---|---|---|
| ORCH-0763 regression | `/opt/homebrew/bin/npm run test:orch-0763` | PASS | 43 tests. |
| ORCH-0759 domain/slug regression | `/opt/homebrew/bin/npm run test:orch-0759` | PASS | Self-test intentionally prints a fake violation; real scan passed. |
| ORCH-0756b draft regression | `/opt/homebrew/bin/npm run test:orch-0756b` | PASS | 22 tests. |
| TypeScript | `/opt/homebrew/bin/npx tsc --noEmit` | PASS | No errors. |
| Touched-file lint | `/opt/homebrew/bin/npx eslint ...` | PASS | No warnings after cleanup. |
| Diff hygiene | `git diff --check` | PASS | No whitespace errors. |

## 13. Regression Surface

1. Public URL sharing across native/web share sheets.
2. Public date rendering across event, brand, checkout.
3. Published event lifecycle actions for authorised users.
4. Public RLS for cancelled/ended exact URLs.
5. Checkout ticket availability after server end-sales.

## 14. Risks, Limitations, Transition Items

| Item | Risk / temporary state | Exit condition | Location |
|---|---|---|---|
| Native dependency | Existing simulator/dev-client may not include `expo-clipboard`. | Rebuild/reinstall native app before runtime clipboard QA. | `mingla-business/package.json` |
| Migration pending | RPCs/RLS do not exist remotely until DB push. | Operator runs `supabase db push`. | `supabase/migrations/20260515000005_*` |
| Cancel notifications/refunds | UI copy still notes B-cycle email/refund automation is transitional. | Resend/refund automation ships. | Existing lifecycle dialogs |

## 15. Discoveries For Orchestrator

- The required strict-grep ORCH-0759 script prints an intentional `business.mingla.com` violation during `--self-test`; this is expected and exits successfully.
- Existing unrelated ORCH-0764 Stripe/report work remains dirty in the worktree and was not modified by this implementation pass.

## 16. Deploy Notes

- **Migrations:** Run `supabase db push`; do not skip `20260515000005_orch_0763d_event_lifecycle_repair.sql`.
- **Edge functions:** None changed.
- **Mobile OTA/native:** Native rebuild/dev-client reinstall required for `expo-clipboard`.
- **Business/admin web:** Web deploy needed after app changes.
- **Env vars/secrets:** None changed.

## Suggested Commit Message

```text
fix(business-events): repair public share dates and server lifecycle

Resolves: ORCH-0763D
Evidence: npm run test:orch-0763; npm run test:orch-0759; npm run test:orch-0756b; npx tsc --noEmit
Deploy: supabase db push required; native rebuild required for expo-clipboard
```

## Ready-To-Test Checklist

1. Run `supabase db push`.
2. Rebuild/reinstall the native dev client so `expo-clipboard` exists on iOS.
3. Publish a free-only Test Stripe event with date, doors-open time, and venue.
4. Confirm Step 7/share modal URL is `business.usemingla.com/e/...` with no `draft-*`.
5. Tap Copy Link and paste; expected exact public URL.
6. Tap Share Via and inspect delivered text; expected same public URL, not Expo.
7. Open public URL in Safari; expected real date/time on event page.
8. Open brand page and checkout; expected same date/time.
9. End ticket sales; expected public ticket rows/checkout show closed sales while event page still exists.
10. Cancel the QA event; expected public exact URL renders cancelled state and checkout rejects purchases.
