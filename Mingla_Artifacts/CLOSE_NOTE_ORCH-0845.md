# CLOSE NOTE — ORCH-0845: Discover excludes ended events

**Closed:** 2026-05-15
**Verdict:** PASS Grade A (P0:0 P1:0 P2:0 P3:1 P4:4)
**Owner:** Claude `mingla-orchestrator` (single-session end-to-end Claude pipeline)
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`

## Summary

The Mingla consumer Discover screen's default "All" filter (and every category/vibe/music chip that doesn't carry a date window) was returning events whose master `event_dates.end_at` was already in the past. Ghost-inventory probe at investigation time showed 2 of 9 currently-listed Raleigh events past their end (Big Party ended 20h ago; Friday Free Sunset Mixer QA ended 6 days ago). Root cause: `supabase/functions/discover-merged-events/index.ts` only applied the `event_dates.end_at >= window.start` floor inside the dated-chip `if (dateWindowUtc !== null)` branch, and nothing in the system auto-flipped `events.status` to `'ended'` when end-time passed.

The fix hoists the master-date filter and end-time floor into the unconditional query chain. `lowerBoundUtc` is the request-time UTC ISO string when no date window is supplied, or the window's `startUtc` when one is. The `event_dates` embed is now unconditionally `!inner` — safe under I-PROPOSED-AX EVENT_HAS_MASTER_DATE which guarantees every scheduled/live event has a master date row.

## Evidence chain

- Investigation: `reports/INVESTIGATION_ORCH-0845_DISCOVER_ENDED_EVENTS_STILL_SHOWN.md` (root cause proven via five-truth-layer cross-check + live SQL probe + ghost-inventory count).
- Spec: `specs/SPEC_ORCH-0845_DISCOVER_EXCLUDES_ENDED_EVENTS.md` (SC-01..SC-09, D-1..D-7 binding diff requirements, two-test contract).
- Implementation: `reports/IMPLEMENTATION_ORCH-0845_DISCOVER_EXCLUDES_ENDED_EVENTS.md` (one-file fix, `deno check` clean, happy-path test 6/6 PASS, `fails-on-revert verified at 47d8ca2de7c396c9b8e2a482a1d2b2226fe1848d`).
- QA: `reports/QA_ORCH-0845_DISCOVER_EXCLUDES_ENDED_EVENTS_REPORT.md` (TARGETED verdict PASS, adversarial test 5/5 PASS across boundary-equality/off-by-one/Tonight-invariant-regression-inversion/upper-bound-scope angles, `fails-on-revert verified at ebd9875f7f99590315e69291dd196bdd27c8d802` on two independent revert paths).

## Deploy

Edge function `discover-merged-events` deployed three times during this session:
- v8 (sha `98db04a7...`) — initial post-implementation deploy. SC-01/SC-02/SC-03/SC-08/SC-09 PASS.
- v9 — ad-hoc redeploy during parallel session window (silently rolled back to pre-fix code).
- v10 (sha `b7cd2ef296aea46b3717e1a5832ba327f494052d862d4dfad09886e0b5832dbd`) — corrective redeploy after operator reported lingering symptoms. `verify_jwt: false` preserved across all deploys. **Currently live.**

No DB migration required. No mobile rebuild required. No EAS OTA required (server-side fix).

## Regression-test gate (ORCH-0840 [Regression-test enforcement + append-only CI] Step 0.5)

Both tests append-only at real paths under `supabase/functions/discover-merged-events/__tests__/`, both ship in this commit, both have explicit fails-on-revert evidence with commit hashes, both attack distinct angles per spec §3.5.

| Test | Path | Run | Fails-on-revert |
|------|------|-----|-----------------|
| Implementor happy-path | `excludes_ended_events.test.ts` | 6/6 PASS | `47d8ca2d` (structural test catches hoist-removal) |
| Tester adversarial | `end_at_boundary.test.ts` | 5/5 PASS | `ebd9875f` on two paths: Attack 3 caught ternary collapse, Attack 4 caught upper-bound hoist |

## CI gate

`.github/scripts/strict-grep/i-discover-excludes-ended-master-date.mjs` registered in `.github/workflows/strict-grep-mingla-business.yml`. Verifies `const lowerBoundUtc` AND `.gte("event_dates.end_at", lowerBoundUtc)` are present on non-comment lines in `discover-merged-events/index.ts`. Green on head; synthetic revert produces exit 1.

## New invariant

**I-PROPOSED-DISCOVER-EXCLUDES-ENDED-MASTER-DATE** — flipped DRAFT → ACTIVE.

## Documents synced

- `WORLD_MAP.md` — row for ORCH-0845 flipped to `closed | A` with QA evidence.
- `INVARIANT_REGISTRY.md` — invariant flipped to ACTIVE.
- `OPEN_INVESTIGATIONS.md` — closed banner added; SPEC-dispatch banner marked superseded.
- `AGENT_HANDOFFS.md` — end-to-end pipeline trace added; SPEC-dispatch banner marked superseded.

Documents NOT synced this close (orchestrator follow-up):
- `MASTER_BUG_LIST.md` — ORCH-0845 was operator-direct intake, never on the master bug list.
- `COVERAGE_MAP.md` — Discover surface grade unchanged at A (single-flow fix; no new surface added).
- `PRODUCT_SNAPSHOT.md` — no grade-count shift.
- `PRIORITY_BOARD.md` — ORCH-0845 was never on top-20 (operator-direct intake).

## Scope carve

ORCH-0846 [Consumer event sheet address parity] was in flight in the working tree during this CLOSE (parallel session running tester). To keep ORCH-0845 standalone, the orchestrator carved `supabase/functions/discover-merged-events/index.ts` + `.github/workflows/strict-grep-mingla-business.yml` to ORCH-0845-only hunks before staging. ORCH-0846's hunks remain uncommitted in the working tree and the parallel session will close ORCH-0846 in its own commit/PR.

## Followups queued

1. Buyer-checkout `computeIsPast` `start+24h` heuristic — recommend new ORCH for "is past" semantic centralization across Discover + PublicEventPage + Checkout.
2. `events.status='ended'` auto-transition decision (currently operator-set-only; nothing flips it when end_at passes).
3. ORCH-NEW [TM dropped events on dated chips] — Ticketmaster upstream returns `totalResults>0` with `events: []` on Tonight + This Weekend windows, correctly triggering ORCH-0839-A F-6 banner ("Live events temporarily unavailable. Showing what we have."). Banner is honest user signal; root cause is upstream TM flake on dated-window queries.
4. META-ORCH-NEW [Post-deploy re-verify probe] — codify a 5-minute-after-deploy re-probe step into orchestrator CLOSE Step 3 after the v9 stale-worker incident observed mid-session (a third-party redeploy reverted the fix briefly before being corrected).

## Sign-off

Operator delegated "take over" at every phase boundary. Final operator confirmation: "yes confirmed" (device-side smoke after force-redeploy to v10). Operator chose Option B (close ORCH-0845 standalone, ORCH-0846 separately).
