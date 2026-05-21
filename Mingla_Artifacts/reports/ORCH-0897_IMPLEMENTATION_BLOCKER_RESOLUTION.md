# ORCH-0897 [Trips + Events Group Chat] — Implementation Blocker Resolution Note

**Date:** 2026-05-21
**Author:** Claude `mingla-orchestrator`
**Trigger:** Codex `implementor-mingla` returned a blocker report at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0897_TRIP_EVENT_GROUP_CHAT.md` (initial implementation NOT attempted due to two collisions in the `Seth` working tree).

---

## Blocker — what Codex flagged

1. **Working-tree contention.** `Seth` currently has 40+ uncommitted file modifications from parallel ORCH-0906 [collab session deck cards mixed type] + ORCH-0908 [collab session lifecycle lockin + chat card tags] + ORCH-0909 [collab positional shared deck] [collab deck mechanics cluster] sessions. Three of the dirty files are required ORCH-0897 [Trips + Events Group Chat] modification targets:
   - `app-mobile/src/components/MessageInterface.tsx` — countdown banner slot
   - `app-mobile/src/services/messagingService.ts` — `getOrCreateGroupConversationForEvent` add
   - `app-mobile/app/index.tsx` — deep-link executor branches

   Codex correctly refused to layer ORCH-0897 changes on top of unreviewed parallel work — bundling would have polluted the ORCH-0897 PR with ~50 unrelated files, broken the one-PR-per-CLOSE rule (codified 2026-05-15 by ORCH-0840 [Regression-test enforcement + append-only CI] first-use), broken 1-to-1 regression-test traceability, and made `git revert` impossible.

2. **Migration timestamp collision.** ORCH-0897 SPEC §3.1 named the new migration `20260703000000_orch_0897_trip_event_group_chat.sql`. Local working tree already has `20260703000000_orch_0906_session_deck_cards_mixed_type.sql` (uncommitted). Same timestamp prefix → broken monotonic naming rule per memory `feedback_orchestrator_deploys_edge_functions.md` rule 10.

---

## Resolution — operator-authorized Option C (fresh branch off `main`)

**Operator decision 2026-05-21:** "C"

**Resolution path:** ORCH-0897 implementation will proceed on a NEW branch `orch-0897-impl` branched from `origin/main` (NOT from `Seth`), in a parallel `git worktree` at `/Users/sethogieva/Desktop/mingla-main-orch-0897/`. The canonical `Seth` working tree stays untouched — the parallel ORCH-0906/0908/0909 [collab deck mechanics cluster] work continues there without interference.

### Why this resolution

- **Zero parallel-work contamination.** `orch-0897-impl` branches from `origin/main`, which does NOT contain the in-flight ORCH-0906/0908/0909 [collab deck mechanics cluster] changes. The ORCH-0897 PR will diff cleanly against `main`.
- **Operator-authorized convention break.** Working-Branch Discipline rule 1 ("All Mingla skills operate from `Seth`") is a default, not a hard physics law. Rule 5 (one-PR-per-CLOSE) explicitly acknowledges operator-pre-approved exceptions when ORCHs are scope-orthogonal — and ORCH-0897 [chat substrate extension] is fully orthogonal to ORCH-0906/0908/0909 [collab deck mechanics cluster]. Zero merge risk between them.
- **ORCH-0897 ships independently.** PR goes `orch-0897-impl → main` directly. ORCH-0906/0908/0909 [collab deck mechanics cluster] close in their own sequenced PRs from `Seth` whenever the operator finishes them. The two tracks merge to `main` independently; if `Seth` rebases on `main` post-ORCH-0897-merge and a file conflict surfaces in the parallel work, the operator resolves it per-ORCH at that point.
- **Cleanest historical bisect.** Each PR's commit set maps 1-to-1 to its ORCH-ID.

### Migration filename update

SPEC §3.1 specified `20260703000000_orch_0897_trip_event_group_chat.sql`. **NEW filename: `20260710000000_orch_0897_trip_event_group_chat.sql`**.

Rationale: the local `Seth` has migrations at timestamps `20260626` through `20260703` for the in-flight ORCH-0906/0908/0909 [collab deck mechanics cluster] work. To avoid post-merge ordering chaos (where ORCH-0897's migration could land BETWEEN parallel migrations after both PRs land on `main`), ORCH-0897 picks a timestamp comfortably above any in-flight ORCH-ID's day. `20260710000000` = one week after the latest local migration timestamp. Monotonic against both the fresh branch's `origin/main` head (which currently stops at `20260624000000`) AND any conceivable in-flight ORCH that might land before this one.

### Operator action items

None right now. The orchestrator handles worktree creation + artifact cherry-pick + branch push in this same turn. The operator's next action is the standard implementor-output review when Codex returns with the implementation report. The operator IS still the canonical owner of `supabase db push --linked` (per `feedback_orchestrator_deploys_edge_functions.md`) — Codex writes the migration file but does NOT apply it; operator applies it on remote at the appropriate gate point in the pipeline.

### What stays the same

- All other SPEC items unchanged (success criteria SC-01..SC-17 + SC-CRITICAL-SECURITY, hard guards §15, regression test paths §13, RLS extensions §3.7, edge function contracts §4)
- Investigation evidence + audit proof matrix unchanged (`Mingla_Artifacts/reports/INVESTIGATION_ORCH-0897_TRIP_EVENT_GROUP_CHAT.md`)
- Substrate inheritance from ORCH-0898 [Consumer collab session → Friends-tab group chat] unchanged
- DISC-0897-1 (`event_type='experience'` out of scope) operator-confirmed unchanged

### Downstream pipeline

After Codex implementor returns with `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0897_TRIP_EVENT_GROUP_CHAT.md` on `orch-0897-impl`:
1. Operator applies the migration on remote via `supabase db push --linked`
2. Codex orchestrator deploys the new + extended edge functions
3. Claude `mingla-forensics` TEST mode runs adversarial regression check + cross-trip/cross-event RLS isolation verification
4. Either orchestrator opens PR `orch-0897-impl → main` and runs the standard pre-merge gate (5 conditions: required checks GREEN, MERGEABLE + CLEAN, reviews APPROVED, not BEHIND, operator-confirmed)
5. Post-merge: EAS OTA publish for the consumer + business app JS bundles; operator-owned `apple-app-site-association` deploy for `/orders/*/chat` universal-link path
6. `Seth` rebases on `main` post-merge; if any conflicts surface in the parallel ORCH-0906/0908/0909 [collab deck mechanics cluster] work, operator resolves per-ORCH at that point

---

## Setup commands the orchestrator executes this turn

```bash
git fetch origin
git worktree add /Users/sethogieva/Desktop/mingla-main-orch-0897 -b orch-0897-impl origin/main
cd /Users/sethogieva/Desktop/mingla-main-orch-0897
git cherry-pick 37fd625e  # ORCH-0897 investigation + spec
git cherry-pick <this resolution note's commit hash>
git push -u origin orch-0897-impl
```

Working-tree contract for Codex implementor: `/Users/sethogieva/Desktop/mingla-main-orch-0897` on branch `orch-0897-impl`.

---

**End of resolution.**
