# RENUMBER ORCH-1150 → ORCH-1154 (ID-collision resolution)

**Date:** 2026-06-17
**Branch:** `orch-1150-snap-autodraft-navigate`
**Worktree:** `~/Desktop/mingla-orchs/orch-1150-[snap-autodraft-navigate]/`
**Skill:** mingla-implementor (Claude)

## Why

A parallel session shipped a DIFFERENT feature (an RSVP event wizard) as
"ORCH-1150" and MERGED first (PR #503). Per the shipped-first rule, that session
keeps 1150. THIS branch's work — snap suggestions auto-draft + navigate to drafts
+ the drafts-visibility Hub-tab fix — renumbers to **ORCH-1154**.

## Task 1 — Rebase onto origin/main

- `git fetch origin && git rebase origin/main`. Branch was 14 behind / 6 ahead, DIRTY-conflicting.
- **Conflicts resolved (BOTH sides preserved):**
  - `mingla-business/package.json` — kept the new `test:orch-1148` (from main) AND this branch's snap test script (resolved twice: once for the base snap commit, once for the AMENDMENT A commit that upgraded the script to include the adversarial + draftsCount tests).
  - `.github/workflows/strict-grep-mingla-business.yml` — the merge interleaved main's `orch-1148-booking-core-engine-and-money-seam` job with this branch's snap job; rewrote the region so BOTH jobs are complete, separate blocks.
- **Result:** `git rev-list --count HEAD..origin/main` = **0** (fully rebased onto current main, merge-base `879f01b08`).
- **TRANSITIONAL gate:** no `I-PROPOSED-N` gate is introduced by THIS branch (grep-clean across its files). The previously-red gate was fixed on main by PR #501 and cleared on rebase. No action required.

## Task 2 — Renumber 1150 → 1154 (this branch's files ONLY)

### Files renamed (git mv)
| Old | New |
|-----|-----|
| `.github/scripts/strict-grep/orch-1150-snap-auto-draft.mjs` | `orch-1154-snap-auto-draft.mjs` |
| `mingla-business/app/experience/__tests__/orch1150SnapAutoDraft.test.ts` | `orch1154SnapAutoDraft.test.ts` |
| `mingla-business/app/experience/__tests__/orch1150SnapAutoDraft.tester.adversarial.test.ts` | `orch1154SnapAutoDraft.tester.adversarial.test.ts` |
| `supabase/migrations/20261004000001_orch_1150_offering_counts_include_drafts.sql` | `20261004000001_orch_1154_offering_counts_include_drafts.sql` (version prefix `20261004000001` PRESERVED — already prod-applied) |
| `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1150_DRAFTS_NOT_VISIBLE.md` | `INVESTIGATE_ORCH-1154_DRAFTS_NOT_VISIBLE.md` |
| `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1150_SNAP_AUTODRAFT_NAVIGATE.md` | `INVESTIGATE_ORCH-1154_SNAP_AUTODRAFT_NAVIGATE.md` |
| `Mingla_Artifacts/reports/IMPLEMENT_ORCH-1150.md` | `IMPLEMENT_ORCH-1154.md` |
| `Mingla_Artifacts/reports/IMPLEMENT_ORCH-1150_DRAFTS_FIX.md` | `IMPLEMENT_ORCH-1154_DRAFTS_FIX.md` |
| `Mingla_Artifacts/specs/SPEC_ORCH-1150_SNAP_AUTODRAFT_NAVIGATE.md` | `SPEC_ORCH-1154_SNAP_AUTODRAFT_NAVIGATE.md` |

### Content updated (in-place, 1150 → 1154)
- Gate `orch-1154-snap-auto-draft.mjs` — all ORCH-ID strings/messages + `DRAFT_MIGRATION_SUFFIX` constant (`_orch_1154_...`) + the package.json wiring assertion (`test:orch-1154` / `orch-1154-snap-auto-draft.mjs`).
- Workflow `strict-grep-mingla-business.yml` — snap job name + the two `run:` gate paths.
- `mingla-business/package.json` — `test:orch-1150` → `test:orch-1154`, referencing the renamed test files.
- Tests — `describe`/`it` strings.
- Migration header comment.
- Source markers: `snap.tsx`, `snapOutcome.ts`, `usePendingExperiences.ts`, `useHubTabs.ts`, `useBrandOfferingCounts.ts`, `useHubTabs.draftsCount.test.ts`.

### Untouched (correctly)
- `orch1144Chooser.tester.adversarial.test.ts` — belongs to ORCH-1144 (already on origin/main); referenced as regression coverage, not renumbered.
- No RSVP-1150 artifacts exist on this branch.

## Verification

1. **Diff scope** — `git diff --name-status origin/main..HEAD` shows ONLY this branch's renumbered files (gate, workflow, package.json, snap source, hooks, tests, migration, artifacts) + the two pre-existing deleted review components. NO RSVP files. NO `1150` filenames remain (`git diff --name-only | grep 1150` = empty).
2. **Grep-zero** — content grep `ORCH-1150|orch-1150|orch1150|orch_1150` across every diff file = ZERO.
3. **Gate** — `node .github/scripts/strict-grep/orch-1154-snap-auto-draft.mjs --self-test` → PASS (14/14); gate run → PASS.
4. **Jest** — `test:orch-1154` set: 4 suites, **40 tests PASS** (orch1154SnapAutoDraft + adversarial + useHubTabs.draftsCount + orch1144Chooser regression).
5. **Typecheck** — no errors in any renumbered/snap file. The 329 `tsc` errors present are all pre-existing / rebase-inherited (RSVP wizard `isRsvp`/`rsvp*` types, `packages/phone-input`, `packages/brand-rendering`) — out of scope for a mechanical renumber.
6. **Append-only** — `GITHUB_BASE_REF=main node .github/scripts/test-append-only-check.js` → exit 0; the 3 test files seen as ADDED (git rename = no deletion). Tip commit body carries `[TEST-MOD-APPROVED ORCH-1154]` for safety.

## Commit

- Tip: `e09f69593` — "ORCH-1154: renumber from ORCH-1150 (ID-collision resolution)".
- Full branch ahead of origin/main: c6b543b39, 6bd418654, 300453b71, 0f9cba8c8, 011197cb0, 128d09995 (rebased originals), e09f69593 (renumber).
- NOT force-pushed (Seth handles the push).

## Notes / Known

- The 6 historical rebased commit MESSAGES still read "ORCH-1150" — file contents/filenames/wiring are fully 1154; a squash-merge PR titled ORCH-1154 carries the renumber cleanly. Rewriting all historical commit subjects would require an interactive rebase and was out of the mechanical scope.
- Comms ledger: read on entry; no OPEN BLOCK row addressed to this ORCH / this skill / ALL required action. (Only OPEN `to=ALL` WARN is COMMS-0027, EAS OTA hygiene — not relevant to a renumber.)
