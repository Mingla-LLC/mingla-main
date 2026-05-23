# QA Retest Report: Profile Circle Event Connection Mapping

> Date: 2026-05-23  
> Mode: TARGETED RETEST + SECURITY/PRIVACY CHECK  
> Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`  
> Inputs: `Mingla_Artifacts/reports/IMPLEMENTATION_PROFILE_CIRCLE_EVENT_CONNECTION_MAPPING_REWORK.md`, `Mingla_Artifacts/reports/QA_PROFILE_CIRCLE_EVENT_CONNECTION_MAPPING.md`, `Mingla_Artifacts/reports/IMPLEMENTATION_PROFILE_CIRCLE_EVENT_CONNECTION_MAPPING.md`, `Mingla_Artifacts/reports/INVESTIGATION_PROFILE_CIRCLE_EVENT_CONNECTION_MAPPING.md`  
> Verdict: **CONDITIONAL PASS**

## Verdict Summary

The two prior P1 release blockers are fixed in the shared checkout. The local relationship-source migration no longer collides with linked remote version `20260724000004`; it now exists as pending local migration `20260724000005_profile_circle_relationship_source.sql`. The mobile legacy fallback also no longer fabricates `Friend of a friend` for source-less old `extended` rows; those rows now map to `relationshipSource = mixed` and `relationshipLabel = Connected through Mingla`, while explicit backend `friend_of_friend` rows still render the specific backend label.

This is a **CONDITIONAL PASS** because runtime database execution and live RPC behavior remain gated on the operator applying `supabase/migrations/20260724000005_profile_circle_relationship_source.sql`. Tester did not mutate remote Supabase and did not apply migrations.

## Severity Counts

| Severity | Count |
|---|---:|
| P0 Critical | 0 |
| P1 High | 0 |
| P2 Medium | 1 |
| P3 Low | 0 |
| P4 Note | 2 |

## Findings

### P2-001 — Runtime DB/RPC verification remains gated on operator migration apply

- **Severity:** P2 MEDIUM
- **Status:** Explicit manual/deploy gate, not implementor rework
- **Evidence:** Read-only `/Users/sethogieva/bin/supabase migration list --linked` shows remote-only `20260724000004` and local-only `20260724000005`.
- **Evidence:** Local migration file exists at `supabase/migrations/20260724000005_profile_circle_relationship_source.sql`; local colliding `20260724000004_profile_circle_relationship_source.sql` is absent.
- **Why it matters:** Static SQL and source tests prove the contract shape, but only applying the migration can prove the linked DB now executes the new return signature and returns live `co_attendee` / `friend_of_friend` labels.
- **Required gate:** Operator runs `supabase db push` from `/Users/sethogieva/Desktop/mingla-main`, applying `20260724000005_profile_circle_relationship_source.sql`, then runtime QA verifies confirmed co-attendees see each other with event labels and no private order/ticket/payment data.

### P4-001 — Full app-mobile typecheck remains blocked by unrelated branch/package errors

- **Severity:** P4 NOTE
- **Status:** Existing residual branch risk
- **Evidence:** `cd app-mobile && npx tsc --noEmit --pretty false` exits `2` with errors in `LockedPlanBanner`, `BoardDiscussion`, `CollabDeckSheet.providerWrap.test`, `TicketCartSheet`, `nativeCheckoutFlow`, `LockedCardSchedulingSheet`, and workspace packages under `packages/event-rendering`, `packages/payments-native`, and `packages/phone-input`.
- **Why it matters:** This prevents a repo-wide green TypeScript claim, but the failures are outside the Profile Circle relationship-source rework and match the prior implementation report's known residual.

### P4-002 — Scoped ESLint still has two pre-existing warnings

- **Severity:** P4 NOTE
- **Status:** Non-blocking
- **Evidence:** Scoped ESLint exits `0` with two warnings in `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx`: `import/no-named-as-default` for `TicketCartSheet` and an unnecessary dependency warning in `useMemo`.
- **Why it matters:** No lint errors block this retest; warnings remain cleanup candidates.

## Prior FAIL Retest Matrix

| Prior finding | Retest result | Evidence |
|---|---|---|
| P1-001 migration version collides with linked remote head | **Fixed locally** | Local tail ends at `20260724000005_profile_circle_relationship_source.sql`; `test -f supabase/migrations/20260724000004_profile_circle_relationship_source.sql` returned non-zero; linked migration list shows `20260724000005` local-only after remote-only `20260724000004`. |
| P1-002 legacy `extended` fallback fabricates `Friend of a friend` | **Fixed** | `app-mobile/src/services/circleService.ts:49-64` maps source-less `extended` to `mixed` / `Connected through Mingla`; `Friend of a friend` fallback is only used when `relationship_source = friend_of_friend`. |

## Verified Claims

| Claim | Result | Evidence |
|---|---|---|
| Migration filename is monotonic after linked remote head | Verified | `supabase/migrations/20260724000005_profile_circle_relationship_source.sql`; `/Users/sethogieva/bin/supabase migration list --linked` shows remote-only `20260724000004` and local-only `20260724000005`. |
| Colliding local `20260724000004_profile_circle_relationship_source.sql` was removed | Verified | `ls supabase/migrations | tail -12`; `test -f ...20260724000004_profile_circle_relationship_source.sql` returned exit `1`. |
| RPC exposes safe relationship-source contract | Verified statically | `supabase/migrations/20260724000005_profile_circle_relationship_source.sql:13-26` returns relationship source/label/context fields only. |
| RPC retains wrong-actor auth guard | Verified statically | `supabase/migrations/20260724000005_profile_circle_relationship_source.sql:33-39` checks `auth.uid()` against `p_viewer_user_id` and raises SQLSTATE `42501`. |
| RPC excludes anonymous buyers from co-attendee mapping | Verified statically | `supabase/migrations/20260724000005_profile_circle_relationship_source.sql:153-164` requires `o2.buyer_user_id IS NOT NULL`. |
| RPC preserves reverse-block exclusion | Verified statically | `supabase/migrations/20260724000005_profile_circle_relationship_source.sql:314-329` checks viewer-blocked and reverse-blocked rows. |
| Co-attendee source is prioritized over friend-of-friend when both exist | Verified statically | `supabase/migrations/20260724000005_profile_circle_relationship_source.sql:192-243` ranks co-attendee with higher source priority and marks multi-source rows as `mixed`. |
| Mobile no longer locally renders `Mingla connection` | Verified | `app-mobile/src/components/profile/circle/CircleAvatarTile.tsx:65-75` and `:130-136` render `person.relationshipLabel`; `rg` found no `Mingla connection` in Profile Circle/service/type paths. |
| Source-less legacy `extended` rows are ambiguity-preserving | Verified | `app-mobile/src/services/circleService.ts:49-64`; adversarial test asserts `Connected through Mingla` at `app-mobile/src/components/profile/circle/__tests__/YourCircleSection.adversarial.test.tsx:246-307`. |
| Explicit `friend_of_friend` and `co_attendee` rows still map to concrete labels | Verified | Adversarial test rows and assertions at `app-mobile/src/components/profile/circle/__tests__/YourCircleSection.adversarial.test.tsx:246-303`. |
| Purchase success invalidates Circle | Verified statically and by regression | `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx:267-280`; adversarial test asserts `circleKeys.all` invalidation. |
| Orders realtime invalidates Circle | Verified statically and by regression | `app-mobile/src/hooks/useCalendarEntries.ts:94-107`; adversarial test asserts `circleKeys.all` invalidation. |

## Commands Run

| Command | Result | Notes |
|---|---|---|
| `node app-mobile/src/components/profile/circle/__tests__/YourCircleSection.happy.test.tsx` | PASS | `PASS ORCH-0933 YourCircleSection happy-path regression`. |
| `node app-mobile/src/components/profile/circle/__tests__/YourCircleSection.adversarial.test.tsx` | PASS | `PASS ORCH-0933 YourCircleSection adversarial regression`; includes migration-version and legacy fallback guards. |
| `git diff --check` | PASS | No whitespace output. |
| `git ls-tree origin/main supabase/migrations/ \| tail -12` | PASS evidence | Origin/main tail ends at `20260724000003_orch_0933_get_user_circle_rpc_ambiguity_fix.sql`; no profile-circle `20260724000004` file in origin/main tail. |
| `/Users/sethogieva/bin/supabase migration list --linked` | PASS evidence | Read-only check shows remote-only `20260724000004` and local-only `20260724000005`. |
| `test -f supabase/migrations/20260724000004_profile_circle_relationship_source.sql; echo "colliding_file_exists=$?"` | PASS evidence | Printed `colliding_file_exists=1`, meaning the colliding file is absent. |
| `cd app-mobile && npx eslint ...` | PASS with warnings | Exit `0`; two warnings in `ExpandedBusinessEventSheet.tsx`. |
| `cd app-mobile && npx tsc --noEmit --pretty false` | FAIL unrelated | Existing branch/package TypeScript errors outside this feature slice. |

## Security And Privacy Check

- No remote Supabase mutation was performed.
- The RPC remains server-owned via `public.get_user_circle`; mobile still calls `supabase.rpc('get_user_circle', ...)` and does not query `friends`, `pairings`, or `orders` directly.
- The return signature exposes relationship metadata, profile fields, and sort score only; it does not return order IDs, ticket IDs, buyer emails/names/phones, Stripe fields, or QR payloads.
- Anonymous buyers remain excluded from co-attendee mapping.
- Viewer-blocked and reverse-blocked exclusions are present in the new SQL.
- Runtime privacy verification remains part of P2-001 after the operator applies the migration.

## Regression Coverage Review

The rework did not weaken the targeted tests. The adversarial regression now locks both prior FAIL fixes: `20260724000005_profile_circle_relationship_source.sql` must exist while the colliding `20260724000004_profile_circle_relationship_source.sql` must not, and source-less legacy `extended` rows must map to `Connected through Mingla` rather than `Friend of a friend`. The same test still covers RPC ownership, wrong-actor SQLSTATE shape, block exclusions, consumer-only filtering, safe return fields, relationship-source mapping, purchase invalidation, and orders realtime invalidation.

## Remaining Manual Gate

After the operator applies `supabase/migrations/20260724000005_profile_circle_relationship_source.sql`:

1. Runtime-call `get_user_circle` as the viewer and confirm wrong-actor calls still fail with SQLSTATE `42501`.
2. Verify two signed-in consumer users with confirmed paid/free orders for the same eligible event see each other with `Also going to {event}` or `Also attended {event}`.
3. Verify direct friends still show `Friend`, close pairings still show `Close friend`, and explicit friend-of-friend rows show `Friend of {name}`.
4. Confirm the RPC response does not expose order, ticket, buyer contact, Stripe, or QR fields.
5. Buy or claim a ticket from mobile and confirm Circle refreshes via purchase success and/or orders realtime invalidation.

## Downstream Routing

- **Current route:** Conditional close readiness through Codex `orchestrator-mingla` only if the operator accepts the explicit migration/runtime gate.
- **No implementor rework required** unless runtime migration apply or live RPC verification fails.
- **If runtime gate fails:** route back to Codex `implementor-mingla` with P2-001 promoted to the concrete runtime failure evidence.
