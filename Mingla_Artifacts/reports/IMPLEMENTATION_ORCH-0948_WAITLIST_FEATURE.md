# IMPLEMENTATION — ORCH-0948 Waitlist Feature

**Status:** implemented, partially verified  
**Working tree:** `~/Desktop/mingla-orchs/ORCH-0948-[waitlist-feature]/` on branch `ORCH-0948-waitlist-feature`  
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0948_WAITLIST_FEATURE.md`  
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0948_WAITLIST_FEATURE.md`  
**Base hash for fails-on-revert checks:** `4b734b1c9a027eb1621b3bd3a3b270d4ca247432`

## Summary

Implemented the waitlist feature in the SPEC order: schema/RPC/trigger, migration regression tests, dispatcher/template extension, anon waitlist signup edge function, QuantityRow waitlist CTA, waitlist service/hooks, `JoinWaitlistSheet`, buyer-web checkout/public-page wiring, planner read surface, and strict-grep confirm exclusion. No `app-mobile/`, `mingla-admin/`, confirm route, or `TicketQrCarousel.tsx` source edits were made.

## Old → New Receipts

| File | Old | New |
|---|---|---|
| `supabase/migrations/20260724000006_orch_0948_waitlist_feature.sql` | No waitlist hardening, no FIFO drain trigger, no planner RPC, `ticket_order_notifications.order_id` was still NOT NULL in current migration truth. | Adds waitlist metadata/consent/qty columns, dedupe indexes, nullable `order_id`, FIFO drain trigger, waitlist invite enqueue, and `event_waitlist_get`. |
| `supabase/migrations/__tests__/orch_0948_waitlist_migration.test.ts` | No repo-running ORCH-0948 migration regression tests. | Pins T-WL-05/07/08/09 dedupe/FIFO/idempotency/order-nullability contracts. |
| `supabase/functions/ticket-confirmation-dispatch/index.ts` | Required `orderId`; unknown `waitlist_spot_open` template would fail terminally. | Adds `notificationId` route for null-order waitlist rows and renders/sends `waitlist_spot_open` email/SMS without changing legacy order flows. |
| `supabase/functions/_shared/email/templates/waitlistSpotOpen.ts` + SMS template | No waitlist copy/template. | Adds escaped email renderer and short SMS renderer with 24h claim URL. |
| `supabase/functions/waitlist-signup/index.ts` + tests | No anon-safe waitlist signup function. | Adds service-role edge writer with consent/contact validation, enabled-ticket check, DB dedupe 409 mapping, and T-WL-01/02 tests. |
| `supabase/config.toml` | No waitlist function registry. | Adds `[functions.waitlist-signup] verify_jwt = false`. |
| `supabase/functions/notification-retry-sweeper/index.ts` | Grouped only by `order_id`, so null-order waitlist rows would strand. | Dispatches `waitlist_spot_open` null-order rows by `notificationId`; existing order grouping remains. |
| `packages/event-rendering/QuantityRow.tsx` + business wrapper/test | Sold-out rows only showed static `Sold out`. | Sold-out waitlist-enabled rows render tappable `Join waitlist`; T-WL-04 pins package + wrapper contract. |
| `mingla-business/src/services/waitlistService.ts`, `useJoinWaitlistMutation.ts`, `useEventWaitlist.ts` | No client API/cache/realtime owner. | Adds join mutation, planner RPC query, and realtime invalidation on `waitlist_entries`. |
| `mingla-business/src/components/waitlist/JoinWaitlistSheet.tsx` + test | No signup sheet. | Adds email/phone/name/qty/consent sheet, success/already-waiting/error toasts, keyboard padding, and T-WL-03. |
| `mingla-business/src/components/event/PublicEventPage.tsx` | `onJoinWaitlist` showed B5 placeholder toast. | Opens `JoinWaitlistSheet` for the selected ticket. |
| `mingla-business/app/checkout/[eventId]/index.tsx` | All-sold-out event short-circuited to empty state; row had no waitlist callback. | Waitlist-enabled sold-out tiers stay visible and open the shared sheet. |
| `mingla-business/src/components/event/TicketTierEditSheet.tsx` + `CreatorStep5Tickets.tsx` | Planner could toggle waitlist but could not see signups. | Adds read-only counts/recent list and inside-parent `WaitlistEntriesSheet`. |
| `.github/scripts/strict-grep/orch-0948-waitlist-feature.mjs` + workflow | No ORCH-0948 confirm exclusion gate. | Blocks diffs touching confirm routes or `TicketQrCarousel.tsx`. |
| `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | Backend allowlist lacked ORCH-0948 backend paths. | Adds migration, `waitlist-signup`, `ticket-confirmation-dispatch`, and directly required backend support/test/template paths. |

## Verification

| Gate | Output |
|---|---|
| `deno check supabase/functions/waitlist-signup/index.ts supabase/functions/ticket-confirmation-dispatch/index.ts supabase/functions/notification-retry-sweeper/index.ts` | PASS |
| `deno test --allow-read ...signup-happy... signup-dedupe... waitlistSpotOpen... orch_0948_waitlist_migration... notification-retry-sweeper... installment_kinds...` | PASS — `33 passed | 0 failed` |
| `cd mingla-business && npx jest src/components/checkout/__tests__/QuantityRow.waitlist.test.tsx src/components/waitlist/__tests__/JoinWaitlistSheet.test.tsx --runInBand` | PASS — `2 passed`, `5 tests passed` |
| `node .github/scripts/strict-grep/orch-0948-waitlist-feature.mjs` | PASS — confirm exclusion preserved |
| `node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | PASS after commit amend |
| `git diff --check` | PASS |
| `git diff` + `git ls-files --others --exclude-standard` hard-guard grep | PASS for source edits; only pre-existing untracked `app-mobile/node_modules` / `mingla-admin/node_modules` matched excluded roots |
| `/Users/sethogieva/bin/supabase migration list --linked` | UNVERIFIED remote head — local worktree is not linked (`Cannot find project ref`) |
| `cd mingla-business && npx tsc --noEmit` | FAILED on existing broad repo typecheck issues unrelated to this ORCH surface (checkout buyer implicit anys, marketing editor typings, native package resolution, shared package module resolution). Focused Deno/Jest gates above passed. |

## Regression Tests + Fails-On-Revert

All implementor tests below are new relative to `4b734b1c9a027eb1621b3bd3a3b270d4ca247432`; `git cat-file -e <base>:<path>` returned missing for each test path, so reverting to that hash removes the regression test and the command cannot pass.

| ID | Test path | Happy-path output | Fails-on-revert |
|---|---|---|---|
| T-WL-01 | `supabase/functions/waitlist-signup/__tests__/signup-happy.test.ts` | PASS in Deno suite | verified at `4b734b1c9a027eb1621b3bd3a3b270d4ca247432` — path missing |
| T-WL-02 | `supabase/functions/waitlist-signup/__tests__/signup-dedupe.test.ts` | PASS in Deno suite | verified at `4b734b1c9a027eb1621b3bd3a3b270d4ca247432` — path missing |
| T-WL-03 | `mingla-business/src/components/waitlist/__tests__/JoinWaitlistSheet.test.tsx` | PASS in Jest suite | verified at `4b734b1c9a027eb1621b3bd3a3b270d4ca247432` — path missing |
| T-WL-04 | `mingla-business/src/components/checkout/__tests__/QuantityRow.waitlist.test.tsx` | PASS in Jest suite | verified at `4b734b1c9a027eb1621b3bd3a3b270d4ca247432` — path missing |
| T-WL-05 | `supabase/migrations/__tests__/orch_0948_waitlist_migration.test.ts` | PASS in Deno suite | verified at `4b734b1c9a027eb1621b3bd3a3b270d4ca247432` — path missing |
| T-WL-06 | `supabase/functions/_shared/email/templates/__tests__/waitlistSpotOpen.test.ts` | PASS in Deno suite | verified at `4b734b1c9a027eb1621b3bd3a3b270d4ca247432` — path missing |
| T-WL-07 | `supabase/migrations/__tests__/orch_0948_waitlist_migration.test.ts` | PASS in Deno suite | verified at `4b734b1c9a027eb1621b3bd3a3b270d4ca247432` — path missing |
| T-WL-08 | `supabase/migrations/__tests__/orch_0948_waitlist_migration.test.ts` | PASS in Deno suite | verified at `4b734b1c9a027eb1621b3bd3a3b270d4ca247432` — path missing |
| T-WL-09 | `supabase/migrations/__tests__/orch_0948_waitlist_migration.test.ts` | PASS in Deno suite | verified at `4b734b1c9a027eb1621b3bd3a3b270d4ca247432` — path missing |

## Invariants

| Invariant | Result |
|---|---|
| I-ANON-BUYER-ROUTES | Preserved: `waitlist-signup` is `verify_jwt=false`; no auth redirect added to waitlist signup. |
| I-RLS-RETURNING-OWNER-GAP | Preserved: planner RPC is `SECURITY INVOKER`; signup writes through edge service-role only. |
| I-ZUSTAND-PERSIST-NO-SERVER-SNAPSHOTS | Preserved: waitlist state uses React Query only. |
| I-NO-FABRICATED-DATA | Preserved: planner panel hides when no persisted waitlist rows. |
| I-KEYBOARD-NEVER-BLOCKS-INPUT | Preserved in `JoinWaitlistSheet` with keyboard listener padding. |
| I-TOAST-NEEDS-ABSOLUTE-WRAP | Preserved: sheet toast is in absolute wrapper. |
| I-SUB-SHEET-INSIDE-PARENT | Preserved: `WaitlistEntriesSheet` is rendered inside `TicketTierEditSheet` children. |
| I-RN-INLINE-COLORS | Preserved: RN colors are standard hex/rgba tokens. |
| I-WAITLIST-CONFIRM-EXCLUSION | Preserved: strict-grep gate passes and hard-guard grep found no confirm/TicketQrCarousel edits. |

## Deploy Notes

Do **not** run `supabase db push` from implementor. Operator owns DB push for `20260724000006_orch_0948_waitlist_feature.sql`. After operator DB push succeeds, orchestrator owns deploying `waitlist-signup` and `ticket-confirmation-dispatch`; because the retry sweeper was extended to handle null-order waitlist notifications, orchestrator should also include `notification-retry-sweeper` in the deploy decision even though the original spec named the two primary edge functions.

## Residual Risks / Tester Focus

Live DB/RLS behavior is not verified locally because the worktree is not linked to Supabase. Tester should run the adversarial DB tests T-WL-07..T-WL-12 against an applied migration, including true FIFO drain, idempotency under repeated status flips, notification order-nullability, malformed dispatcher payload handling, and native/web planner sheet parity.
