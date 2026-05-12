# CLOSE NOTE — ORCH-0800

Date closed: 2026-05-11
Closed by: Claude `mingla-orchestrator` (operator delegated "lets proceed. close")
Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
PR: pending (this close opens it)

## Verdict

**PASS.** Operator-confirmed in chat ("all fioxed lets proceed. close"). Single-tile, single-file UI honesty fix on the event detail screen. No migrations, no edge functions, no schema changes, no behavioural risk to other surfaces.

## Plain-English impact

The "Guests" ActionTile on the brand-side event detail screen (`mingla-business/app/event/[id]/index.tsx`) used to display the static literal `"0 pending"` under the Guests label regardless of how many tickets had been sold, comps issued, or door sales recorded. There was no concept of a "pending guest" anywhere in the schema — the placeholder copy was scaffolded with the tile and never wired. The tile now shows a live, refund-aware count of total guests for the event in the form `"N guests"` (singular when N=1).

## What changed

Single file: `mingla-business/app/event/[id]/index.tsx`.

1. Imported `useGuestStore` from `../../../src/store/guestStore`.
2. Added `compGuestCount` memo — `allCompEntries.filter((c) => c.eventId === event.id).length`. Stable-ref via raw entries + useMemo per the §4.5 selector pattern rule already followed for `doorSoldCount` two memos above (see existing comment at line 332).
3. Computed `totalGuestCount = totalSoldCount + doorSoldCount + compGuestCount`. Reuses the existing memos:
   - `totalSoldCount` (line 315): online paid attendees, net of refunds — sums `Math.max(0, line.quantity - line.refundedQuantity)` across paid + refunded_partial orders.
   - `doorSoldCount` (line 338): door-sale attendees, net of refunds — same per-line refund-aware sum across `doorSalesStore` entries scoped to event.id.
   - `compGuestCount` (new): comp guests scoped to event.id.
4. Replaced the Guests `ActionTile` `sub` prop from `"0 pending"` to ``${totalGuestCount} ${totalGuestCount === 1 ? "guest" : "guests"}``.

## Out of scope (not addressed by this close)

- Real "to-check-in" / unscanned count (Option B from the dispatch). Defer until door-mode UX is reviewed in a future cycle.
- Time-based switching between "total guests" pre-doors and "to-check-in" post-doors.
- Other ActionTiles on this screen (Scanners, Brand page, Door sales) — unchanged.

## Verification

- Type-check: `cd mingla-business && npx tsc --noEmit -p tsconfig.json` → clean (no new errors on the touched file).
- Operator manual confirmation: "all fioxed lets proceed."
- No tester report filed — single hardcoded literal swap with no behavioural surface beyond the tile sub-text. Future regression risk covered by visual inspection on the event detail screen any time a tile renders.

## DIAG reap

```bash
grep -rn "\[ORCH-0800-DIAG\]" mingla-business/src/ mingla-business/app/ app-mobile/src/ supabase/functions/ mingla-admin/src/ 2>/dev/null
```

Zero matches. (No DIAG markers were introduced; the change is purely declarative UI.)

## Deploy notes

- **No migration.** No SQL touched.
- **No edge function deploy.** No `supabase/functions/` files touched.
- **No native module change.** Pure React Native JS — eligible for OTA when the operator next ships a `mingla-business` update. EAS OTA command (operator may run when ready):

```bash
cd mingla-business && eas update --branch production --platform ios --message "ORCH-0800: Guests tile live count"
cd mingla-business && eas update --branch production --platform android --message "ORCH-0800: Guests tile live count"
```

(Note: this fix lives in `mingla-business/`, not `app-mobile/`. Two separate single-platform invocations per `feedback_eas_update_no_web.md` — never the comma form.)

## Evidence

- Commit on `Seth`: see `git log --oneline -1` after close.
- File diff: `mingla-business/app/event/[id]/index.tsx` (1 import added, 1 memo added, 1 derived total added, 1 sub-prop literal replaced).

## Invariants / decisions

- No new invariants. No architectural decisions. No new memory entries. UI honesty fix only — falls under the already-active Constitution #9 (No fabricated data) without requiring new tooling.

## Document sync

- `MASTER_BUG_LIST.md` — REGISTERED + CLOSED entry added in same banner (single-pass close).
- `WORLD_MAP.md` — same.
- `PRODUCT_SNAPSHOT.md`, `PRIORITY_BOARD.md`, `COVERAGE_MAP.md`, `AGENT_HANDOFFS.md`, `OPEN_INVESTIGATIONS.md`, `RETEST_LEDGER.md` — no change required (this ORCH never entered the formal investigate/spec/implement/test pipeline; it was an INTAKE-direct-to-CLOSE single-file UI fix authorised in chat with the operator providing both the diagnose-first confirmation and the post-fix smoke).
