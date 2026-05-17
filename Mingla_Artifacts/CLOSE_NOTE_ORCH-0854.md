# CLOSE NOTE — ORCH-0854 [Consumer ticket status live-flip valid→used on scan]

**Closed:** 2026-05-17
**Verdict:** CONDITIONAL PASS Grade A — Seth-run live-fire deferred per Phase 0.A (sim attempt made, blocker named: no Mingla consumer dev build on the booted iOS sim + no signed-in test buyer pre-staged); operator accepted close on this basis (tester path-B authorization).
**Severity counts:** P0:0 P1:0 P2:0 P3:0 P4:3 (praise).
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.

---

## What shipped

Consumer Mingla mobile app's Tickets/Calendar badges now flip `Valid → Used` within ~1s of the door scanner's commit. Coupled two-change fix:

1. **Migration** `supabase/migrations/20260606000200_orch_0854_tickets_realtime_publication.sql` adds `public.tickets` to the `supabase_realtime` publication. (Live probe today showed `tickets` already present in the publication — Discovery #2 — but the on-disk file is required for fresh-environment provisioning + ledger consistency; `ALTER PUBLICATION ... ADD TABLE` is idempotent per PostgreSQL.)
2. **Client hook** `useTicketsRealtimeSubscription(userId)` in `app-mobile/src/hooks/useCalendarEntries.ts`, wired into `CalendarTab.tsx` next to the existing `useOrdersRealtimeSubscription`. Verbatim mirror of the post-ORCH-0851 [Consumer Tickets tab post-purchase realtime freshness] orders pattern; invalidates BOTH `["businessEventOrders", userId]` AND `["consumerCalendar", userId]` for H-2 defense.

All ORCH-0851 fallback layers preserved (60s staleTime, refetchOnWindowFocus, 3-attempt post-purchase invalidate loop in `ExpandedBusinessEventSheet.handleBuy`). Server-side scan path UNTOUCHED per SPEC §Non-goals.

## Step 0.5 regression-test gate (PASS)

- **Implementor happy-path:** `app-mobile/scripts/ci/orch-0854-regression-check.mjs` 9/9 PASS. Fails-on-revert verified at commit `d8b2aa96b1c4f1b1536d68b15c63d66a85ea72e0` (true line-deletion of `queryClient.invalidateQueries({ queryKey: ["businessEventOrders", userId] })` → exit 1 with FAIL H-04; restore → exit 0).
- **Implementor adversarial:** `app-mobile/scripts/ci/orch-0854-adversarial-check.mjs` 7/7 PASS (lifecycle: anon-safety, dep array, in-useEffect; fallback preservation: refetchOnWindowFocus, 3-attempt loop, staleTime; channel-name no-collision).
- **Tester adversarial:** `app-mobile/scripts/ci/orch-0854-tester-adversarial-check.mjs` 7/7 PASS attacking NEW angles vs implementor's — TA1 cache-key consistency between subscriber and producer hooks (Constitution #4 enforcement); TA2 migration filename monotonicity; TA3 no `buyer_user_id` filter trap (tickets has no such column); TA4 server-path-untouched (`supabase/functions/scan-ticket/index.ts` still routes to `biz_ticket_scan`, no `UPDATE orders` side-effect); TA5 ALTER (not CREATE / DROP) PUBLICATION semantics.

All three test files ship in the closing PR alongside the fix per ORCH-0840 [Regression-test enforcement + append-only CI] append-only requirement.

## Step 1.5 DIAG reap (PASS)

`grep -rn "\[ORCH-0854-DIAG\]"` against `mingla-business/src/`, `mingla-business/app/`, `app-mobile/src/`, `supabase/functions/`, `mingla-admin/src/` → zero matches. Clean.

## New invariant

**I-PROPOSED-BV — REALTIME-TABLE-IN-PUBLICATION-OR-NO-SUBSCRIPTION** — flipped DRAFT → ACTIVE in `Mingla_Artifacts/INVARIANT_REGISTRY.md`. Enforced by new strict-grep gate `.github/scripts/strict-grep/orch-0854-tickets-realtime-publication-paired.mjs` plugged into `.github/workflows/strict-grep-mingla-business.yml`. Gate exit 0 with 14 informational WARN lines (legacy subscriptions tracked under ORCH-0856).

## Follow-up ORCH registered

**ORCH-0856** (S2, quality-gap, audit-only) — audit the 14 legacy unpublished client subscriptions surfaced by the new gate's first run. Full table list + per-table investigation scope in MASTER_BUG_LIST.md entry.

## Discoveries logged for future ORCH consideration

1. 14 legacy unpublished subscriptions → ORCH-0856 registered above.
2. `tickets` already in live publication when probed today (parallel apply or prior session/dashboard add).
3. `scan_events` not in publication — flag-and-track if a future surface needs live scan-history feed.
4. No push-notification-on-scan UX gap — separate ORCH if product wants.
5. Regression-script anti-pattern lesson: comment-revert doesn't trigger fails-on-revert because regex matches commented text; true line-deletion required. Worth a process note for ORCH-0840 enforcement guidance.
6. Pre-existing merge conflict in `CalendarTab.tsx` (lines 43-55 comment-only) auto-resolved during implementation by external lint-on-save process.

## Pre-deploy gates for operator

1. `cd /Users/sethogieva/Desktop/mingla-main && supabase db push --linked` — idempotent ALTER PUBLICATION; registers file in `supabase_migrations.schema_migrations`.
2. Verify: MCP `SELECT version FROM supabase_migrations.schema_migrations WHERE version = '20260606000200';` returns one row.
3. No edge function deploy required (none touched).
4. No native rebuild required (JS-only change to `app-mobile/`).
5. EAS OTA after merge per `feedback_eas_update_no_web.md` two-command pattern: `cd app-mobile && eas update --branch production --platform ios --message "ORCH-0854: ticket scan live-flip"` then the same with `--platform android`.

## Pipeline

INTAKE (Claude `mingla-orchestrator`) → INVESTIGATE (Claude `mingla-forensics`) → SPEC (Claude `mingla-forensics`) → IMPLEMENT (Claude `mingla-implementor`) → TEST (Claude `mingla-tester`, CONDITIONAL PASS) → CLOSE (Claude `mingla-orchestrator`).

## Evidence

- Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0854_CONSUMER_TICKET_SCAN_STATUS_NOT_LIVE.md`
- Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0854_CONSUMER_TICKET_SCAN_STATUS_LIVE_FLIP.md`
- Implementation: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0854_CONSUMER_TICKET_SCAN_STATUS_LIVE_FLIP.md`
- QA: `Mingla_Artifacts/reports/QA_ORCH-0854_CONSUMER_TICKET_SCAN_STATUS_LIVE_FLIP_REPORT.md`
