# Anchor Hygiene — the rule, the guard, and the 2026-06-21 cleanup manifest

**Owner:** mingla-orchestrator · **Established:** 2026-06-21 (ORCH-1185) · **Status:** ACTIVE (enforced)

---

## The rule (non-negotiable)

> **Nothing is ever created or edited directly on `main`. A worktree must be spawned before any file is created or changed.**

The shared anchor checkout `~/Desktop/mingla-main` MUST stay a clean mirror of `origin/main`
at all times. It is never edited. All work — product code, migrations, prompts, specs, QA,
artifact docs — happens in a per-ORCH worktree:

```
scripts/orch-worktree/spawn.sh ORCH-NNNN <short-kebab-label>
```

Work on the `ORCH-####` branch, then reach `main` via a PR. Sanctioned doc/ledger syncs may
commit on a short-lived branch and `git push origin HEAD:main` — but a commit is **never**
authored while sitting on the `main` branch.

## The guard (enforcement — "never again")

Enforced by a repo-tracked pre-commit hook, active on the anchor and every worktree:

- **`.githooks/pre-commit`** — rejects `git commit` whenever `HEAD` is on `main`.
- **`scripts/orch-worktree/install-hooks.sh`** — sets `core.hooksPath=.githooks`. Run once per
  fresh clone: `bash scripts/orch-worktree/install-hooks.sh`. (Worktrees share the anchor's
  `.git/config`, so one install covers the anchor + all current/future worktrees.)
- **`scripts/orch-worktree/spawn.sh`** — re-asserts `core.hooksPath` on every spawn, so the guard
  is self-healing.

Worktrees are always on an `ORCH-####` branch, so their commits pass. The only thing blocked is
the failure mode that caused this cleanup: editing + committing straight on the shared `main`.

Sanctioned automation that genuinely must commit on main overrides for a single command:
`MINGLA_ALLOW_MAIN_COMMIT=1 git commit ...` (prefer commit-on-branch + push instead).

---

## 2026-06-21 cleanup manifest — what was done (read this if you are missing work)

The anchor had drifted to **84 commits behind origin/main with 191 uncommitted items** (122
modified tracked files + 47 untracked + 1 unpushed commit) — accumulated multi-session work and
cruft edited directly on the shared `main`. It was cleaned as follows, **losslessly**:

### 1. Everything preserved (nothing destroyed)

All 191 items were committed and pushed to a rescue branch:

- **Branch:** `origin/anchor-rescue-2026-06-21`
- **Snapshot commit:** `c38cb686ef746baeace04d0c3a8add0e403b1bf3`
- **Parent commit:** `05f99b665` (the unpushed COMMS-0040/0041 ack — `COMMS_LEDGER.md`)

**If you are missing uncommitted work from the anchor**, it is on that branch. Recover with:
```
git fetch origin
git checkout origin/anchor-rescue-2026-06-21 -- <path/to/your/file>   # single file
# or diff your file against it:
git diff origin/anchor-rescue-2026-06-21 -- <path/to/your/file>
```

### 2. What was in the snapshot (categories — full list is in the rescue commit)

- **122 modified tracked files:** spanning `mingla-business/src` (46), `app-mobile/src` (21),
  `mingla-business/app` (16), `supabase/functions` (11), `packages/*` (7), `.github/scripts` (3),
  all 9 `Mingla_Artifacts/*.md` operational docs, the `.transitional-baseline.txt`, two
  `package.json`/lock pairs, and several test files. These were edits sitting on the anchor; they
  were NOT individually merged to main (each owning ORCH must merge its own via PR).
- **47 untracked files:** `Mingla_Artifacts/investigations` (16), `specs` (10), `reports` (6),
  `design` (5), `Mingla_Roadmap/living` (4), `clickup` (1); **4 new source components**
  (`app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx`,
  `app-mobile/src/components/expandedCard/ExperienceItinerary.tsx`,
  `mingla-business/src/components/experience/ExperienceConfirmationCard.tsx`,
  `mingla-business/src/components/experience/ExperienceReviewCards.tsx`); and `addr7.png` (a
  throwaway screenshot — junk, but preserved anyway).

### 3. Anchor reset to clean origin/main

After the push, `~/Desktop/mingla-main` was reset to `origin/main` (HEAD `945e8f2c6` at the time).
It is now `0 dirty files`, fully synced. The "191 in source control" is resolved.

### 4. Stale worktrees reaped (5 — provably dead: merged PR + clean tree)

- `META-ORCH-1174-[trip-page-standardization]` (detached at merged `ba662cf5c`)
- `meta-orch-1180-[trip-cart-installment-aware]` (PR #574 MERGED)
- `meta-orch-1181-[trip-tile-installment]` (PR #576 MERGED)
- `ORCH-1168-[event-deadcode-cleanup]` (PR #542 MERGED)
- `orch-1183-[experience-standardize]` (PR #581 MERGED)

### 5. Worktrees FLAGGED, not deleted (possible live sessions — owners please reconcile)

- `ORCH-1158-[event-page-wizard-fixes]` — commits present, **no PR opened**. If abandoned, open a
  PR or reap; if live, carry on.
- `orch-1183-[ota]` — at main HEAD but **3 uncommitted files**. Likely an OTA-deploy leftover.
- `orch1138_sim` — detached, **2 uncommitted files**. Ad-hoc sim worktree.

These were left untouched because their branches still exist or they hold uncommitted work — the
hygiene rule deletes only what is provably dead and flags everything else.

---

## Recovery / questions

Snapshot branch `origin/anchor-rescue-2026-06-21` (`c38cb686`) is the single source of truth for
anything that was on the anchor before 2026-06-21. Keep it until every owning session confirms it
has recovered what it needs; then it can be deleted by the orchestrator.
