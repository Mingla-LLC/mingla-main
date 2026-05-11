# Mingla Worktree Strategy

**Date:** 2026-05-10
**Author:** orchestrator (Claude `mingla-orchestrator`)
**Status:** PROPOSAL — pending operator approval; codified as META-ORCH-0755 Step 8 once accepted
**Parent:** META-ORCH-0755 (DEC-133 role split, DEC-134 next-handoff paragraph)

---

## Goal (operator directive)

> "best worktree strategy to implement across all claude and codex skills that creates sync and coordination across skills, but also makes sure that one working tree is used for related work until it closes."

Two requirements:

1. **Sync + coordination across tools/skills.** Codex and Claude must see the same files when they collaborate on the same work.
2. **One worktree per related-work unit (ORCH), held open from intake to CLOSE.** Investigation → Spec → Implement → Test → Close all happen in the same place.

---

## Recommended strategy: Hybrid (per-ORCH worktrees + main checkout for index work)

### The four canonical locations

| Location | Path | Owner | What lives here |
|----------|------|-------|-----------------|
| **Main checkout** | `/Users/sethogieva/Desktop/mingla-main` (branch `main`) | Orchestrator only | Global index artifacts (DECISION_LOG, INVARIANT_REGISTRY, WORLD_MAP, PRIORITY_BOARD, MASTER_BUG_LIST, AGENT_HANDOFFS, COVERAGE_MAP, PRODUCT_SNAPSHOT, ROOT_CAUSE_REGISTER, OPEN_INVESTIGATIONS). Skills (`.claude/skills/`, `.codex/skills/`) live here as gitignored source. META-ORCHs (process/skill/artifact-only work) run here. |
| **Per-ORCH worktree** | `.worktrees/orch-XXXX-<short>/` on branch `orch/XXXX-<short>` | All phase agents (forensics, implementor, tester) | Product code edits, schema migrations, scoped tests, scoped artifacts (`reports/INVESTIGATION_ORCH-XXXX_*`, `specs/SPEC_ORCH-XXXX_*`, `reports/IMPLEMENTATION_ORCH-XXXX_*`, `reports/QA_ORCH-XXXX_*`). |
| **`.worktrees/` parent** | `.worktrees/` (gitignored top-level) | git | Holds all active per-ORCH worktrees. Never tracked. |
| **Operator's tools** | Codex CLI session + Claude Code session, both with `cwd=<worktree path>` for phase work, OR `cwd=main` for orchestrator/META work | Operator | The operator switches `cwd` per dispatch; Next-Handoff Paragraph names the path. |

### The four canonical rules

**Rule 1 — One worktree per ORCH, lifecycle-bound.**
- Worktree is created at the **first INVESTIGATE dispatch** (DISPATCH mode in orchestrator), branched from current `origin/main`.
- Worktree stays open through all phases for that ORCH (INVESTIGATE → SPEC → IMPLEMENT → TEST → REWORK loop → ready-for-CLOSE).
- Worktree is closed only by the canonical CLOSE owner (Codex `orchestrator-mingla`), via merge-to-main + `git worktree remove` + branch delete.
- Parallel ORCHs each get their own worktree. No collision.

**Rule 2 — Scoped artifacts in the worktree; global indexes in main.**
- Inside the worktree (committed on the ORCH branch): product code, migrations, scoped tests, and the ORCH-specific scoped artifacts in `Mingla_Artifacts/reports/`, `specs/`, `prompts/` that name the ORCH-ID in the filename.
- In main only (orchestrator writes directly, never duplicated in worktrees): the global indexes — DECISION_LOG, INVARIANT_REGISTRY, WORLD_MAP, PRIORITY_BOARD, MASTER_BUG_LIST, AGENT_HANDOFFS, COVERAGE_MAP, PRODUCT_SNAPSHOT, ROOT_CAUSE_REGISTER, OPEN_INVESTIGATIONS.
- **Why this split:** multiple ORCHs are in flight at once. Their index updates must remain coherent in main. If two worktrees each tried to edit DECISION_LOG, merge would conflict every time. Keep index writes single-owner in main.
- Phase agents that need to read current index state run `git show main:Mingla_Artifacts/DECISION_LOG.md` rather than reading the worktree's snapshot.

**Rule 3 — Skills travel via symlink, not copy.**
- `.claude/skills/` and `.codex/skills/` are gitignored, so a fresh worktree starts without them.
- At worktree creation, symlink them from main: `ln -s ../../.claude/skills .worktrees/<name>/.claude/skills` and same for `.codex/skills/`.
- This guarantees skill rules stay in sync — edit a skill in main, every active worktree sees it immediately.
- The user's global `~/.claude/skills/` and `~/.codex/skills/` (if any) are independent and load alongside, as usual.

**Rule 4 — Codex owns the merge; Claude owns the read.**
- Per the canonical pipeline routing (DEC-133): CLOSE belongs to Codex `orchestrator-mingla`. The merge-to-main + worktree-remove commands run from Codex during CLOSE Step 2/3.
- Claude `mingla-orchestrator` (parity mirror) emits the same commands in the NEXT HANDOFF paragraph but does not execute them by default; the operator pastes them into Codex for execution.

---

## Worktree lifecycle commands (orchestrator-emitted, operator-executed)

### Create (at first INVESTIGATE dispatch)

```bash
ORCH_ID=ORCH-0782
SHORT=buyer-email-not-arriving
SLUG="orch-${ORCH_ID#ORCH-}-${SHORT}"
BRANCH="orch/${ORCH_ID#ORCH-}-${SHORT}"

cd /Users/sethogieva/Desktop/mingla-main
git fetch origin main
git worktree add ".worktrees/${SLUG}" -b "${BRANCH}" origin/main

# Symlink skills so every worktree sees the same rules
ln -s ../../.claude/skills ".worktrees/${SLUG}/.claude/skills"
ln -s ../../.codex/skills  ".worktrees/${SLUG}/.codex/skills"

echo "Worktree ready: .worktrees/${SLUG} (branch ${BRANCH})"
echo "Open Codex/Claude with cwd=.worktrees/${SLUG} for all phase work."
```

### Mid-lifecycle sync (only if branch is older than 3 days OR main has touched related files)

```bash
cd ".worktrees/${SLUG}"
git fetch origin main
git rebase origin/main   # resolve conflicts; or use --abort + plan a merge instead
```

### Close (at PASS → CLOSE in Codex orchestrator)

```bash
cd /Users/sethogieva/Desktop/mingla-main
git fetch origin main
git checkout main
git pull origin main
git merge --no-ff "${BRANCH}" -m "Close ${ORCH_ID}: <one-line summary>"
git push origin main
git worktree remove ".worktrees/${SLUG}"
git branch -d "${BRANCH}"
```

If the merge fails for unrelated reasons, the CLOSE banner records the blocker and the worktree stays alive until resolution.

### Emergency abandon (operator-only, deliberate)

```bash
cd /Users/sethogieva/Desktop/mingla-main
git worktree remove --force ".worktrees/${SLUG}"
git branch -D "${BRANCH}"
# Log in DECISION_LOG: ORCH-XXXX abandoned, reason, what was salvaged.
```

---

## Active-worktree registry

A new artifact: `Mingla_Artifacts/WORKTREE_REGISTRY.md`. One row per active worktree:

| Worktree path | Branch | ORCH-ID | Phase | Opened | Last sync from main | Canonical owner |
|---------------|--------|---------|-------|--------|---------------------|-----------------|
| `.worktrees/orch-0782-buyer-email-not-arriving` | `orch/0782-buyer-email-not-arriving` | ORCH-0782 | TEST | 2026-05-10 | 2026-05-10 | Claude `mingla-forensics` |

Orchestrator updates this in main on every phase transition. `WORKTREE_REGISTRY.md` is part of the index-files set (Rule 2).

---

## How skills consume this (per-skill updates needed)

| Skill | What it must know |
|-------|-------------------|
| Codex `orchestrator-mingla` (canonical) | Emits worktree-create command on first INVESTIGATE dispatch; emits worktree-close command in CLOSE Step 2; updates `WORKTREE_REGISTRY.md` on every phase transition. |
| Claude `mingla-orchestrator` (parity mirror) | Same emissions; never executes the close commands itself. |
| Claude `mingla-forensics` (INVESTIGATE / SPEC / TEST) | Operates inside the worktree. Phase 0 ingestion includes reading the worktree's scoped artifacts plus `git show main:Mingla_Artifacts/<index>.md` for current index state. Next-Handoff Paragraph names the worktree path. |
| Codex `implementor-mingla` (IMPLEMENT) | Operates inside the worktree. Commits product changes on the ORCH branch. Implementation report goes into the worktree's `Mingla_Artifacts/reports/`. Runs Deno gates inside the worktree. Edge-function deploy only happens AFTER CLOSE merges to main (deploy from main HEAD). |
| Claude `mingla-implementor` (parity mirror) | Same as Codex; only invoked if operator redirects. |
| Claude `mingla-tester` + Codex `tester-mingla` (legacy mirrors) | Operate inside the worktree. QA reports in the worktree. |
| Codex `forensic-mingla` (parity mirror) | Same as Claude forensics; only invoked if operator redirects. |

---

## Trade-offs

**What this strategy gives up:**
- Setup friction per ORCH (one `git worktree add` + 2 symlink commands). Acceptable: orchestrator emits the exact commands.
- Phase agents reading current index state need an extra `git show main:` call. Acceptable: indexes don't change mid-cycle in a way phase agents need to react to.
- Disk usage: one working tree per active ORCH (a few hundred MB each in this monorepo). Acceptable: pruned at CLOSE.

**What this strategy guarantees:**
- No mid-cycle bleed between ORCHs. ORCH-0782 cannot accidentally touch ORCH-0780's files.
- A single ORCH's history is one contiguous branch from intake to CLOSE.
- Codex and Claude inside the same worktree see each other's writes instantly (shared filesystem).
- Skills stay in sync via symlinks — edit a SKILL.md in main, every worktree sees it.
- Index files never have merge conflicts between concurrent ORCHs (single-owner in main).
- The `.worktrees/` directory is gitignored, so no accidental commits of worktree internals.

---

## Edge cases & policies

1. **META-ORCHs (process/skill/artifact-only).** Run in main. No worktree. Examples: META-ORCH-0755 itself, future skill-parity sweeps, index-cleanup work. These touch indexes only and never need code isolation.

2. **Multi-ORCH "campaigns" (e.g. Cycle 17b).** Each constituent ORCH gets its own worktree. A campaign-level coordinator artifact (in main) tracks the set. Do NOT use a single worktree for a campaign — that defeats Rule 1.

3. **Hot-fix urgency (production breaking).** Still use a worktree (`orch-HOTFIX-XXXX-<name>`). The discipline matters more under pressure, not less. CLOSE merges fast-forward.

4. **Long-running investigation (>3 days).** Rebase periodically (Sync command above). If conflicts pile up, dispatch a "spec amendment" cycle inside the same worktree rather than restarting in a fresh branch.

5. **Cross-domain ORCHs.** One worktree, branch operates across `app-mobile/` + `mingla-business/` + `supabase/` simultaneously. That's expected for the Mingla monorepo.

6. **What if an ORCH branches further (sub-ORCHs)?** Each sub-ORCH gets its own worktree. The parent ORCH's worktree is closed only when its terminal dispatch closes; sub-ORCH worktrees close independently.

7. **What if the operator wants to inspect main during a phase?** Open a second Codex/Claude session with `cwd=main`. They can read but not write the worktree's files (they would, but the orchestrator-only-writes-indexes-in-main rule means phase agents shouldn't be writing to main).

---

## Lock-in plan (if approved)

1. **Skill updates** — add a "Worktree Discipline" section to each of the 8 lifecycle skills:
   - Codex `orchestrator-mingla`: emit create / sync / close commands; update `WORKTREE_REGISTRY.md`.
   - Claude `mingla-orchestrator` (parity mirror): same emissions, never executes.
   - Claude `mingla-forensics`: operate in worktree; index reads via `git show main:`.
   - Codex `implementor-mingla` + Claude `mingla-implementor` mirror: commit in worktree; deploy only post-CLOSE.
   - Tester mirrors: QA reports in worktree.
   - Codex `forensic-mingla` (parity mirror): same as Claude forensics.

2. **New artifact** — `Mingla_Artifacts/WORKTREE_REGISTRY.md` (committable, in main).

3. **DECISION_LOG entry** — DEC-135 codifying the strategy.

4. **INVARIANT_REGISTRY entry** — I-PROPOSED-AC ONE_WORKTREE_PER_ORCH (ACTIVE on first ORCH that uses it, then ratified).

5. **Strict-grep gate (queued, not in this commit)** — any commit on the `main` branch directly touching product code under `app-mobile/`, `mingla-business/`, `mingla-admin/`, or `supabase/` must trace to a merged ORCH branch (i.e. `--first-parent` history shows the merge). Direct commits to main on those paths are forbidden except for META-ORCHs / hot-fixes flagged explicitly.

6. **Bootstrap script** — `scripts/worktree/open.sh` and `scripts/worktree/close.sh` wrappers around the commands above. The orchestrator emits them in Next-Handoff Paragraphs.

---

## Why this beats the alternatives

- **vs. "main checkout for everything"** — current default. Loses ORCH isolation; one in-progress ORCH contaminates the next; branch switches risk losing uncommitted state.
- **vs. "one worktree per cycle (longer-lived)"** — groups too many ORCHs together; merge conflicts pile up; doesn't map to the lifecycle the operator actually runs.
- **vs. "one worktree per domain"** — cross-domain ORCHs span domains; doesn't compose with the ORCH lifecycle.
- **vs. "everything in main, branches only"** — works for solo flow but loses the filesystem-level isolation that lets Codex + Claude run concurrently without confusion about which working state they see.

The hybrid model is the smallest change that gives clean isolation AND preserves the index-as-single-source-of-truth pattern.
