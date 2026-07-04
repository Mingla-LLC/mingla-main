# IMPLEMENTATION — ORCH-1296 [chip-in-edit-published-gap]

Status: **implemented and verified** (runtime-proven for the frontend triad via a
sucrase harness against the real source; SQL gate proven by contract-test design +
live-prod body diff). Migration NOT applied (orchestrator applies it).

Worktree: `~/Desktop/mingla-orchs/ORCH-1296-[chip-in-edit-published-gap]/` on branch
`ORCH-1296-chip-in-edit-published-gap`. Fix commit: **`ab361f395`** (pushed).

## 1. Summary

Editing an already-PUBLISHED RSVP event now handles the voluntary "chip-in" config
end-to-end, at parity with the create/publish flow (ORCH-1291):

- **LOAD** — opening Edit now shows the TRUE chip-in state (toggle + suggested/min
  amounts) instead of always-OFF/blank.
- **CHANGE-DETECTION** — toggling chip-in or changing an amount now registers a real
  change (no more false "No changes to save.").
- **SAVE** — the live-edit RPC persists the 3 chip-in columns, and enabling chip-in
  on a brand that can't collect is blocked with a provider-aware bank-gate (Stripe
  OR Paystack), exactly like publish. The screen shows an actionable "Connect a bank"
  toast instead of a generic failure.

## 2. SPEC / dispatch success-criteria coverage

| SC | Requirement | Status | Where (commit `ab361f395`) |
|----|-------------|--------|-----------|
| A (LOAD) | Edit hydrates the TRUE chip-in state | ✓ | `businessEvents.ts` by-id + list probes select `rsvp_contribution_*`, thread via `rsvpMeta` → `eventFromRow` → LiveEvent; `liveEventToEditableDraft` already projects them (ORCH-1291) |
| B (DIFF) | Toggling/changing chip-in registers a change | ✓ | `liveEventAdapter.ts` `editableDraftToPatch` diffs the 3 fields; `EditableLiveEventFields` + `FIELD_LABELS` + `SAFE_KEYS` extended |
| C (SAVE / RPC) | `biz_update_live_rsvp` reads + gates + persists the 3 fields | ✓ | new migration `20261222000000_orch_1296_rsvp_edit_chip_in.sql` |
| C (gate) | CONDITIONAL provider-aware bank-gate on ENABLE (`pg_brand_can_collect`, not `pg_brand_can_charge`); NOT gated when off | ✓ | migration gate block; SQL test E1/E2/E3 |
| D (client payload) | Client sends the 3 fields to `biz_update_live_rsvp` | ✓ | `serverDraftEventMapper.ts` `RsvpUpdatePayload` + `buildRsvpUpdatePayloadDiff` + `buildRsvpUpdatePayload` |
| — (UX) | Bank-gate surfaces an actionable message | ✓ | `EditPublishedScreen.tsx` maps `stripe_charges_disabled` |

## 3. Files changed (8, all ORCH-1296-scoped)

| File | Δ | Role |
|------|---|------|
| `supabase/migrations/20261222000000_orch_1296_rsvp_edit_chip_in.sql` | +new | RPC read/gate/persist (SAVE) |
| `supabase/migrations/__tests__/orch_1296_rsvp_edit_chip_in.test.sql` | +new | SQL contract test (fails-on-revert) |
| `mingla-business/src/utils/__tests__/rsvpEditChipIn.test.ts` | +new | frontend contract test |
| `mingla-business/src/services/businessEvents.ts` | ~+40 | LOAD — both probes + rsvpMeta + eventFromRow |
| `mingla-business/src/utils/liveEventAdapter.ts` | ~+25 | DIFF — editableDraftToPatch + labels + SAFE_KEYS |
| `mingla-business/src/utils/serverDraftEventMapper.ts` | ~+25 | SAVE payload — interface + 2 builders |
| `mingla-business/src/store/liveEventStore.ts` | +12 | `EditableLiveEventFields` Pick + 3 keys |
| `mingla-business/src/components/event/EditPublishedScreen.tsx` | +7 | actionable bank-gate toast |

## 4. Data-model changes

None (no DDL). The migration only `CREATE OR REPLACE`s the existing function
`biz_update_live_rsvp(uuid, jsonb, text)` — identical signature → no DROP. The 3
columns (`rsvp_contribution_enabled` / `_suggested_cents` / `_min_cents`) and
`pg_brand_can_collect` already exist (created by ORCH-1291's `20261220000000`).

## 5. Edge functions touched

None. No edge-fn redeploy required.

## 6. Regression tests + fails-on-revert

- **Frontend** — `mingla-business/src/utils/__tests__/rsvpEditChipIn.test.ts` (6
  tests: LOAD hydration, DIFF positive/negative, SAVE positive/negative). Executed
  against the REAL source functions via a sucrase require-hook harness (jest deps not
  installed in this worktree — see §11): **18/18 assertions PASS**.
  **fails-on-revert verified at `ab361f395`**: deleting the `editableDraftToPatch`
  chip-in diff block (true line deletion) → the DIFF test drops to an EMPTY patch (4
  assertions FAIL — the exact "No changes to save" bug); restoring → 18/18 PASS again.
- **SQL** — `supabase/migrations/__tests__/orch_1296_rsvp_edit_chip_in.test.sql`
  (E1: enable-chip-in on can't-collect brand RAISEs `stripe_charges_disabled` →
  reverting the gate fails E1; E2: enable + amounts on a Paystack-subaccount brand
  SUCCEEDS + persists the 3 columns → reverting the column writes OR the
  provider-aware gate fails E2; E3: unrelated title-only edit on a can't-collect
  chip-in-OFF RSVP SUCCEEDS + no clobber). Hand-run after the orchestrator applies
  the migration (repo SQL-probe convention; the implementor does not apply).

## 7. Old → New receipts

**`businessEvents.ts`** — before: `fetchBusinessEventById` (and the list fetch)
probed 6 rsvp_* columns; the LiveEvent never carried chip-in → the editor hydrated
OFF/blank. Now: both probes also select the 3 `rsvp_contribution_*` columns, thread
them through `rsvpMeta` → `eventFromRow`, so the LiveEvent carries the true state.

**`liveEventStore.ts`** — before: `EditableLiveEventFields` stopped at
`rsvpDiscoverable`. Now: includes the 3 chip-in keys (they already exist on
`LiveEvent`), so the diff/labels typecheck.

**`liveEventAdapter.ts`** — before: `editableDraftToPatch` diffed 6 rsvp_* controls,
not chip-in → a chip-in-only edit produced an empty patch → "No changes to save."
Now: diffs the 3 chip-in fields (+ FIELD_LABELS + SAFE_KEYS), so the change registers.

**`serverDraftEventMapper.ts`** — before: `RsvpUpdatePayload` + both builders omitted
chip-in → the RPC never received it. Now: the diff builder emits each chip-in field
only when changed (COALESCE-safe on the RPC side); the full builder sets all 3.

**`biz_update_live_rsvp` (migration)** — before: never read/gated/persisted chip-in.
Now: reads the 3 fields (default-to-stored when absent), CONDITIONAL provider-aware
bank-gate on ENABLE (`pg_brand_can_collect`), persists the 3 columns. Body reproduced
VERBATIM from the live-prod definition (== `20261114000000`, confirmed by a read-only
`pg_get_functiondef` diff — see §11 / COMMS-0029) + only the additive bits.

**`EditPublishedScreen.tsx`** — before: any RSVP save error → generic "Couldn't save."
Now: `stripe_charges_disabled` → "Connect a bank to collect chip-in contributions
before turning it on."

## 8. Cross-surface impact

| Surface | Affected? | Notes |
|---------|-----------|-------|
| Business Web (edit-published) | YES | the target surface — parity automatic (shared RN code) |
| Business iOS / Android | YES (same code) | ships on next OTA/build; web ships via Vercel `[deploy]` |
| Buyer/anon Web | NO | public RSVP page untouched (chip-in render was already wired by ORCH-1291) |
| Consumer iOS / Android | NO | no consumer file touched |
| Admin Web | NO | not touched |

Parity is AUTOMATIC across business iOS/Android/Web (one RN codebase). No manual
per-surface fork.

## 9. Smoke / runtime result

Sucrase harness against the real `liveEventAdapter` + `serverDraftEventMapper`: LOAD
hydrates true state; DIFF flags a chip-in change (non-empty patch) and omits when
unchanged; SAVE payload carries the 3 fields when changed and omits when unchanged.
18/18 PASS; fails-on-revert proven. Full authed biz-web runtime edit-save is capped at
"suspected→proven-by-unit" (authed biz-web runtime is unreachable headlessly per the
memory rule) — the tester should drive the live edit screen.

## 10. Known issues / deferred

- **Fail-close on an already-enabled chip-in event whose brand LATER loses collect
  ability:** the gate keys off the RESOLVED enabled state (mirrors publish exactly).
  If chip-in is already ON and the brand can no longer collect, an unrelated edit is
  blocked until the host either reconnects a bank or turns chip-in OFF (the diff then
  sends `enabled=false` → gate never fires). This is the intended fail-close posture
  and matches `business_publish_rsvp_draft`. Documented, not a bug.
- **List-path chip-in hydration** was extended too (for type + value consistency with
  the 6 sibling host-controls); inert for the Hub list card, which renders no chip-in.

## 11. Operator action required

1. **Apply the migration** (orchestrator/operator — the implementor does NOT apply):
   ```bash
   cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1296-[chip-in-edit-published-gap]" && /Users/sethogieva/bin/supabase db push --linked
   ```
   Migration: `supabase/migrations/20261222000000_orch_1296_rsvp_edit_chip_in.sql`
   (monotonic prefix `20261222000000` > global max `20261221000001`; additive
   `CREATE OR REPLACE`, no DROP, no backfill → no read-only remote probe needed).
2. **No edge-fn redeploy** (none touched).
3. **Gates unrun in this session** (mingla-business deps not installed here — parallels
   the "Deno unavailable" cross-host rule): the CI `strict-grep-mingla-business` job +
   `mingla-business` jest + tsc run on the PR are authoritative. Locally: the relevant
   `i-proposed-tr2-events-type-filter` gate PASSES (0 violations); a full strict-grep
   sweep showed 14 pre-existing failures, NONE on any ORCH-1296-touched file (all on
   files outside this 8-file diff — identical to origin/main; see §12).
4. After merge, web ships via Vercel `[deploy]`; business app ships on the next native
   build (COMMS-0052: biz-app OTA is blocked — not relevant to the web ship).

## 12. Discoveries for orchestrator

- **COMMS-0029 satisfied (biz_update_live_* clobber precedent):** confirmed via a
  read-only `pg_get_functiondef` probe that the LIVE-PROD `biz_update_live_rsvp` body
  is byte-identical to `20261114000000_orch_1172_r2` (comment + every line) — no
  prod-applied-unmerged hotfix to fold in. My migration reproduces that exact body +
  the additive chip-in read/gate/write.
- **Pre-existing strict-grep red on main:** 14 gates fail on the current tree
  (`i-proposed-tr2-route-by-event-type`, `-safearea-on-fullscreen-routes`,
  `i37/i38/i39`, `orch-0769-app-wide-currency`, `orch-0910-chat-payload-curated-aware`,
  etc.) — every flagged file is OUTSIDE this ORCH's 8-file diff (unchanged vs
  origin/main). Not introduced by ORCH-1296; worth a cleanup ORCH (echoes ORCH-1291
  §10.D-3 tsc-red note).
- **Comms WARNs factored (not clobbered):** COMMS-0040/0041/0038/0044 (public-page
  → `packages/` consolidation) — ORCH-1296 touches NONE of the public-RSVP body files;
  COMMS-0021 (provider-neutral bank-gate) — the gate uses `pg_brand_can_collect`
  (provider-aware) as required. These are WARN rows; acked here (no anchor-ledger write
  from the worktree per the never-edit-anchor guard).
