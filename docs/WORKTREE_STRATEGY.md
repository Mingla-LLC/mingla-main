# Worktree Strategy

**Canonical owner:** orchestrator (Claude `mingla-orchestrator` or Codex `orchestrator-mingla` — full parity).

**Effective:** 2026-05-24 (worktree-per-ORCH cutover).

**Previous models superseded:**
- 2026-05-11 — single-Seth shared-checkout model (this doc's predecessor).
- 2026-04-26 — META-ORCH-0755 first attempt at worktree-per-ORCH (reverted 2026-05-11; the current model addresses every gap that drove that revert — see § Why this time is different).

---

## The rule

**Every ORCH gets its own git worktree** at `~/Desktop/mingla-orchs/<ORCH_ID>-<short-kebab-label>/` on a dedicated branch `<ORCH_ID>-<label>` — **the directory name and the branch name are identical** — branched from `main`.

`~/Desktop/mingla-main` is the **anchor checkout** — permanently parked on `main`, read-mostly, never edited directly. It exists to:
- Provide a stable base for `git worktree add`
- Hold the canonical `node_modules` for symlink-sharing
- Serve as the operator's "see what's on production" reference

Every PR opens from the per-ORCH branch directly to `main`. After merge, the CLOSE-owning orchestrator reaps the worktree + branch via `scripts/orch-worktree/reap.sh`.

The `Seth` branch is **deleted forever** after this cutover commit lands. No new work goes on `Seth`. Anyone who needs the historical `Seth` state can reach it via `git log main` (every Seth PR squash-merged onto main).

---

## Day-to-day flow

### INTAKE — orchestrator spawns a worktree

```bash
scripts/orch-worktree/spawn.sh <ORCH_ID> <short-kebab-label>
```

Example:
```bash
scripts/orch-worktree/spawn.sh orch-0946 paywall-tier-copy-refresh
```

Spawn does:
1. Sync anchor with `origin/main` (fast-forward)
2. Assert the path is free of build-hostile characters (`scripts/orch-worktree/assert-safe-worktree-path.sh`), then `git worktree add ~/Desktop/mingla-orchs/orch-0946-paywall-tier-copy-refresh -b orch-0946-paywall-tier-copy-refresh main`
3. Copy gitignored `.env*` files from anchor
4. Symlink `node_modules` for each sub-project (saves ~5 min per spawn)
5. Echo: worktree path, branch name, suggested Metro port, suggested sim assignment

After spawn, every subsequent dispatch's prompt begins with `cd <worktree-path>`.

### Per-phase dispatch — skill works inside the worktree

- INVESTIGATE / SPEC / IMPLEMENT / TEST all happen inside the worktree.
- Skills `cd` to the worktree path on entry.
- Commits, branch ops, edge-fn deploys (orchestrator-owned) all happen from the worktree.
- Tester operates the assigned sim only (one ORCH per sim/device when in parallel).

### CLOSE Step 1.7 — orchestrator reaps the worktree

After PR merges to main:
```bash
scripts/orch-worktree/reap.sh ~/Desktop/mingla-orchs/<ORCH_ID>-<label>
```

Reap does:
1. Safety: refuse if worktree dirty (unless `--force`) or branch ahead of `origin/main`
2. `git worktree remove`
3. `git branch -D` local + `git push origin --delete` remote
4. `git worktree prune`
5. Echo reminder to operator: remove folder from VS Code workspace

CLOSE banner cites: `Worktree reaped: <path> + branch <branch-name>`.

`reap.sh` now also reclaims the work item's **iOS simulator** and **Android AVD**
(issue #2300). Until then CLOSE reclaimed the folder and nothing else, so every
closed item leaked ~4 GB: a 1–3 GB simulator and a 1–5 GB emulator disk that no
step ever named. Both are ownership-scoped — a **Booted** simulator or a live
`qemu -avd` belongs to another session and is kept, whatever its name says.

### Sweeping what already accumulated

`reap.sh` handles one item at close. For everything that piled up — or that a
close missed because the session died mid-flight:

```bash
scripts/orch-worktree/sweep.sh            # dry run: prints the plan, deletes nothing
scripts/orch-worktree/sweep.sh --apply    # acts on it
```

Dry run is the default deliberately: this can delete tens of gigabytes across
surfaces other live sessions are using. It prints every artifact it KEEPS with
the reason it failed the gate.

### The reap gate — and three predicates that must never come back

The gate is in `scripts/orch-worktree/lib/artifact-liveness.sh`. A worktree is
dead only when **all four** hold: issue `CLOSED`, PR `MERGED`, working tree
clean, and idle beyond the window. Read the TRAP commentary in that file before
touching any predicate — three obvious-looking gates each read a LIVE worktree
as dead, and CI fails the build if any of them reappears:

| Predicate | Why it is wrong here |
|---|---|
| `merge-base --is-ancestor` | A freshly-spawned worktree has HEAD == `main`, so it reads as merged. Flagged four live work items in one run. |
| `rev-list --count origin/main..<branch>` | This repo squash-merges, so a *merged* branch always reads as ahead. This was `reap.sh`'s original Safety 2 and it rejected every legitimate reap — which is why 46 worktrees accumulated. |
| `find -newermt '<relative>'` | `bfs` on macOS rejects relative timestamps, errors to stderr and returns empty stdout, so an `[ -z … ]` idle check matches everything. |

---

## Naming conventions

| Pattern | Example |
|---|---|
| Worktree directory | `~/Desktop/mingla-orchs/orch-0946-paywall-tier-copy-refresh/` |
| Branch | `orch-0946-paywall-tier-copy-refresh` |
| META-ORCH worktree | `~/Desktop/mingla-orchs/meta-orch-0952-buyer-web-confirm-deep-forensics/` |
| META-ORCH branch | `meta-orch-0952-buyer-web-confirm-deep-forensics` |

### Path characters — hard rule (#2210)

A worktree path may contain **only** `A-Z a-z 0-9 . _ / -`. `spawn.sh` asserts this via `scripts/orch-worktree/assert-safe-worktree-path.sh` and **refuses to spawn** otherwise. It is an allowlist on purpose: a denylist is how `[` survived 86 days.

This is not cosmetic. Directories used to be named `<ORCH_ID>-[<label>]`. Inside a bracketed path, CMake's `file(GLOB …)` reads the brackets as a POSIX character class, matches **zero files, prints nothing, and exits 0** — so every local Android/native build got an empty source list. It failed loudly only because `add_library` rejects empty sources; a glob feeding anything optional would have built an incomplete binary and reported success. RN 0.81 codegen has the same shape (COMMS-0150). Spaces, `#`, and non-ASCII are equally banned: `URL.pathname` percent-encodes them, and `#` silently *truncates* the path (#958).

**Existing bracketed worktrees are NOT migrated.** Renaming one needs `git worktree repair` and breaks any session holding that path, for zero benefit — git keeps using the path it recorded. `reap.sh` is path-agnostic and reaps them normally; the population drains as those issues close.

Short labels: kebab-case, ≤4 words, descriptive enough that the directory listing alone tells you what the ORCH is about.

---

## Sim assignment matrix

| Sim/Device | UDID/AVD | Default use |
|---|---|---|
| iPhone 17 Pro | `<UDID-A>` | Primary consumer/business iOS |
| iPhone 16 | `<UDID-B>` | Secondary iOS |
| Pixel 7 emu | `<AVD-name>` | Android-specific ORCH |
| Operator's physical iPhone | n/a | Final human verification on every ORCH |

Orchestrator picks next available at spawn; dispatch prompt names the sim explicitly. Backend-only ORCHs (edge fn / migration / RLS / CI) get `Sim: none — backend-only`.

---

## Metro port matrix

| Port | Worktree |
|---|---|
| 8081 | First active ORCH (Expo default) |
| 8082 | Second active ORCH |
| 8083 | Third active ORCH |
| 8084 | Fourth active ORCH |

Spawn echoes the next-available port based on `git worktree list` count.

---

## node_modules — the symlink rule

`spawn.sh` symlinks `node_modules` from the anchor into each worktree's sub-projects (~80% disk savings, ~5 min faster spawn).

**If an ORCH touches `package.json` / `package-lock.json` / `pnpm-lock.yaml`:**
1. Orchestrator detects at spawn (or implementor detects at first `npm install` failure)
2. Remove the symlink: `rm <sub>/node_modules`
3. Run real `npm install` in the worktree
4. Flag in the implementation report under "Discoveries"

The anchor's `node_modules` is the source of truth. If main updates deps mid-ORCH, the symlink resolves to the new version on next read.

---

## VS Code multi-root workspace

**One-time setup** (post-cutover):
1. Open `~/Desktop/mingla-main` in VS Code
2. `File → Save Workspace As… → ~/mingla.code-workspace`
3. Always open VS Code via that workspace file going forward

**Per ORCH lifecycle:**
- **Spawn:** `File → Add Folder to Workspace…` → pick new worktree dir. Source Control panel grows a new pane labeled with the branch name.
- **Reap:** Right-click the folder in Explorer → `Remove Folder from Workspace`.

**Mental model:** the workspace's folder list = your active ORCH inventory.

`Mingla_Artifacts/WORKTREE_REGISTRY.md` is the canonical live ledger; VS Code's pane list mirrors it visually.

---

## Parallel ORCHs

Each ORCH = its own worktree + its own sim + its own Metro port + its own PR branch. They don't collide on:
- File edits (separate worktrees)
- Dev servers (separate ports)
- Sim installs (separate sims per ORCH when running in parallel)
- PR conflicts (each merges independently)

They DO serialize on:
- **Edge function deploys** (production is single-target). The orchestrator deploys from THE worktree owning the implementation.
- **Database migrations** (operator owns `supabase db push --linked`; only one push at a time).
- **GitHub merges to main** (GitHub serializes naturally).

---

## Anti-patterns (forbidden post-cutover)

- ❌ Editing files in `~/Desktop/mingla-main` (anchor is read-only).
- ❌ Reusing the same worktree for a second ORCH.
- ❌ Installing two ORCH builds (same bundle ID) on the same sim.
- ❌ Symlinking `node_modules` into the anchor checkout.
- ❌ Leaving a reaped worktree's folder in the VS Code workspace.
- ❌ Force-reaping (`reap.sh --force`) without explicit operator confirmation.
- ❌ Resurrecting the `Seth` branch (use a per-ORCH branch instead).

---

## Why this time is different (from the 2026-05-11 revert)

The previous worktree-per-ORCH attempt (META-ORCH-0755) was reverted because of accumulated friction. The current rollout addresses every gap that drove that revert:

| Past gap | Now addressed by |
|---|---|
| Manual setup overhead per ORCH | `spawn.sh` automation |
| node_modules disk/time cost | Symlink-by-default rule |
| Operator couldn't see all active worktrees | VS Code multi-root workspace + live `WORKTREE_REGISTRY.md` |
| Sim collisions when running parallel ORCHs | Per-ORCH sim assignment (matrix above) |
| Stranded worktrees on close | Mandatory `reap.sh` at CLOSE Step 1.7 |
| Edge fn deploy split (which worktree deploys?) | Memory rule: orchestrator deploys from the implementation's worktree |
| Codex/Claude parity confusion | Both orchestrators own the lifecycle symmetrically |

---

## Rollback path

If the workflow proves worse in practice, rollback is:
1. Revert this cutover commit on main
2. Re-write `WORKTREE_STRATEGY.md` to the single-Seth model
3. Update the memory rule `feedback_worktree_per_orch_workflow.md` to mark superseded
4. Operator merges + cleans up active worktrees back onto a fresh `Seth` branch

No data loss — every commit is on a remote branch + PR before the worktree gets reaped.

---

## Pre-merge gate (MANDATORY)

Before merging any PR (per-ORCH branch → main), the orchestrator MUST verify ALL of:

1. **All required GitHub checks GREEN.** Use `gh pr checks <PR#> --watch`. The bar is only the checks declared as required by branch protection / ruleset. Informational/non-required check failures (e.g. a Vercel preview rate-limited) do NOT block merge but MUST be called out in the merge-confirmation message.
2. **No conflicts with main.** `mergeStateStatus != "DIRTY"`. If main moved, rebase or merge main into the per-ORCH branch first.
3. **All review-required approvals collected.** If branch protection requires N reviewers and you only have N-1, do NOT bypass with `--admin` unless explicitly authorized for this incident.
4. **Operator-confirmed.** Either operator explicitly says "merge" / "ship" / etc., OR the orchestrator has delegated end-to-end execution authority.
5. **Vercel `[deploy]` tag present** in the commit subject if the ORCH touches any Vercel-built surface (`mingla-business/`, `mingla-admin/`, `mingla-marketing/`). See `feedback_vercel_deploy_gate.md`.
6. **Strict-grep + Tests-Append-Only + Migrations-Baseline gates** all passed against the latest HEAD.
7. **`main` ITSELF IS GREEN.** Run `node scripts/ci/main-health.mjs pregate` and require exit 0. It performs ONE snapshot read of the newest completed push-to-`main` run of every workflow and refuses when any of them is red, naming the failing check, the commit and who merged it. No `--watch`, no polling — the API quota is one shared wallet.

If ANY gate fails, do NOT merge. Investigate root cause, fix, push, re-run.

**Why item 7 exists (#2909).** On 2026-09-01 `main` was red across three consecutive commits for roughly two hours and nobody found out; the discovery was accidental, during unrelated work. Three engineers merged onto it in that window, one of them the orchestrator immediately after an explicit approval. Items 1–6 all passed, correctly, because every one of them asks about the PULL REQUEST. None of them asked whether the branch being merged INTO was healthy, so a green PR on a red `main` was certified as ready. Merging onto a red `main` compounds the breakage, hands the next person a failure they will blame on their own diff, and — under #2882, where the full suite runs after merge — converts the merge gate into no gate at all.

The same check runs unattended as the `Pre-merge: main is green` job on every pull request, and its wiring is held by the class-A gate `issue-2909-main-health-wiring.mjs`. Running it by hand before `gh pr merge` is still required: the job reports, the human decides, and neither substitutes for the other.

---

## One-PR-per-CLOSE (MANDATORY)

Every CLOSE opens its own PR from its per-ORCH branch to `main`. Bundling two or more ORCHs into a single PR is FORBIDDEN by default.

**Rationale:**
- Clean revert (`git revert <merge-sha>` removes exactly one ORCH)
- Trivial `git bisect` when main breaks
- 1-to-1 regression-test traceability (the ORCH-0840 Step 0.5 gate's two regression tests map to one PR diff)
- Unambiguous canonical current-issue override-token grammar (`#` plus one or more digits, first digit 1–9, no leading zero or suffix; legacy `ORCH-NNNN` still accepted)
- Focused CODEOWNERS review per ORCH
- Parallel close-ability between Claude and Codex orchestrators without convoy merge-conflict cascades

**Narrow exception (operator pre-approved bundles):** tightly-coupled ORCHs that must ship atomically — same migration with multiple consuming ORCHs, one bug intentionally split into 2 ORCH-IDs because of scope, hot-fix convoys — may ship as a bundle ONLY when the operator names every ORCH-ID being bundled at CLOSE-time and the PR title lists them all explicitly (e.g., `Close ORCH-0843 + ORCH-0844: <shared-bundle-reason>`).

The orchestrator must justify the bundle in chat ("these two share a migration", "ORCH-X depends on ORCH-Y's schema") rather than bundling silently for convenience.

---

## Multi-issue PRs — one closing keyword per issue (MANDATORY)

GitHub auto-closes an issue ONLY when the PR body carries a closing keyword naming it (`Fixes #NNN` / `Closes #NNN` / `Resolves #NNN`) — one line per issue. A PR that resolves several issues but names only one leaves the rest OPEN forever: they strand on the board (often stuck at "In Progress") while the code is already merged and deployed, and no one notices until a status query surfaces them.

**Pre-merge checklist item:** when a PR resolves more than one issue — a pre-approved bundle, OR a single fix that incidentally closes sibling issues carved off the same investigation — the PR body MUST carry a separate `Fixes #NNN` line for EVERY issue it resolves. At merge time, cross-check the `Fixes #` lines against every issue# in the PR title, branch lineage, and any sibling issues the diff actually closes; if a resolved issue is missing its line, add it before merging (or close + comment that issue manually right after merge).

**Proven failure:** PR #938 fixed #880 plus siblings #886/#887/#888/#889 (ORCH-1375/1376/1377/1378) but carried a single `Fixes #880`. Only #880 auto-closed; the other four sat OPEN and "In Progress" for 9 days after shipping until a board query surfaced them (closed 2026-07-27 with evidence comments).

---

## Cross-references

- Memory rule: `~/.claude/projects/-Users-sethogieva-Desktop-mingla-main/memory/feedback_worktree_per_orch_workflow.md`
- Spawn script: `scripts/orch-worktree/spawn.sh`
- Reap script: `scripts/orch-worktree/reap.sh`
- Live registry: `Mingla_Artifacts/WORKTREE_REGISTRY.md`
- Related rules: `feedback_orchestrator_cleans_worktree_on_close.md`, `feedback_close_commit_precommit_checks.md`, `feedback_sim_load_latest_bundle_before_test.md`
- Skill enforcement: every Claude + Codex skill's "Working-Branch Discipline" stanza
- Plan history: `~/.claude/plans/cosmic-swimming-teacup.md` (initial design)
