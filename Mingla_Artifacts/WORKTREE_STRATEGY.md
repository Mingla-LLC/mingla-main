# Mingla Working-Branch Strategy

**Date:** 2026-05-11  
**Author:** Codex `orchestrator-mingla`  
**Status:** ACTIVE — supersedes META-ORCH-0755 / DEC-135 per operator directive  
**Branch authority:** `Seth` is the canonical working branch; `main` is the promotion branch after close.

---

## Goal (operator directive)

> "I want to remove the need to work on different working tree across all skills both Claude and Codex. I want to register that Seth is the working branch, and all work should be done there on the working tree. When close is done, we push to main. I also want outputs to contain a layman explanation for me if I have to do anything walking me through the steps."

Plain meaning: Seth should not have to remember which `.worktrees/...` folder belongs to which agent. Every Claude and Codex skill should work from the same repo checkout on the same branch, explain what the operator has to do in normal language, and only promote finished, verified work to `main`.

---

## Canonical strategy: One shared checkout on branch `Seth`

| Location | Path / branch | Owner | What happens here |
|----------|---------------|-------|-------------------|
| **Shared working tree** | `/Users/sethogieva/Desktop/mingla-main` on branch `Seth` | All Claude and Codex Mingla skills | Investigation, specs, implementation, tests, scoped reports, prompts, product code, migrations, and artifact updates. |
| **Promotion branch** | `main` | Codex `orchestrator-mingla` at CLOSE | Finished, evidence-backed work reaches `main` only through a GitHub PR from `Seth` after local checks and GitHub PR checks pass. |
| **Legacy worktree registry** | `Mingla_Artifacts/WORKTREE_REGISTRY.md` | Codex `orchestrator-mingla` | Historical transition ledger only. Do not add new active worktree rows. |

---

## The four canonical rules

**Rule 1 — One branch, one working tree.**  
All Mingla skills operate in `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`. Do not create per-ORCH git worktrees. Do not ask the operator to open `.worktrees/<slug>/`.

**Rule 2 — Scope by ORCH, not by filesystem.**  
Multiple ORCHs may exist in the same checkout, so every agent must stage and commit only the files named by its dispatch/spec. Unrelated dirty files are preserved and explicitly excluded. Reports, prompts, specs, tests, code, migrations, and global indexes stay in the shared checkout.

**Rule 3 — Close promotes `Seth` to `main` through a checked PR.**  
When tester PASS or accepted CONDITIONAL PASS returns and close artifacts are synced, Codex `orchestrator-mingla` runs the scoped local checks, commits scoped close-out work on `Seth`, pushes `Seth` only after those local checks pass, opens a GitHub PR from `Seth` to `main`, waits for GitHub PR checks/statuses to pass, merges the PR, and returns to `Seth` for the next task. Direct local merge/push to `main` is forbidden unless the operator explicitly overrides the rule for that one incident.

**Rule 4 — Outputs explain operator steps in layman terms.**  
If Seth/the operator has to run a command, dispatch another skill, approve a risk, apply a migration, publish an OTA update, or do any manual check, the response must first explain the steps in plain English and then provide the exact command or handoff block.

---

## Start / sync command

Use this before a new phase or when an agent might be in the wrong branch:

```bash
cd /Users/sethogieva/Desktop/mingla-main
git fetch origin
git checkout Seth
git pull --ff-only origin Seth
git status --short
echo "Working tree ready at /Users/sethogieva/Desktop/mingla-main on branch Seth."
```

If the status output shows unrelated dirty work, do not revert it. Keep working only on the scoped files and call out the unrelated files in the report or close note.

---

## Close / promote command

Codex `orchestrator-mingla` runs or emits this after close evidence is complete:

```bash
cd /Users/sethogieva/Desktop/mingla-main
git checkout Seth
git status --short
<run scoped local checks and confirm PASS>
git add <scoped files only>
git commit -m "Close ORCH-XXXX: <one-line summary>"
git push origin Seth
gh pr create --base main --head Seth --title "Close ORCH-XXXX: <one-line summary>" --body "<evidence summary + checks>"
gh pr checks <PR number> --watch
gh pr merge <PR number> --merge --delete-branch=false
git fetch origin
git checkout Seth
git pull --ff-only origin Seth
```

If local checks fail, do not push `Seth`; report the failing command and fix or dispatch rework. If the PR cannot be opened, GitHub checks fail, or merge is blocked, report the blocker, preserve the `Seth` commit SHA, and leave the repo on `Seth`. Do not delete any branch or worktree.

---

## How skills consume this

| Skill | Required behavior |
|-------|-------------------|
| Codex `orchestrator-mingla` | Canonical close owner. Verifies branch `Seth`, writes prompts/artifacts, runs scoped local checks, commits scoped close work, pushes `Seth`, opens a PR to `main`, waits for GitHub checks, merges only when green, and explains operator steps in layman terms. |
| Claude `mingla-orchestrator` | Parity mirror. Uses the same branch language and routes final close to Codex unless explicitly told otherwise. |
| Claude `mingla-forensics` / Codex `forensic-mingla` | Investigate, spec, and test from `/Users/sethogieva/Desktop/mingla-main` on `Seth`; write reports/specs there. |
| Codex `implementor-mingla` / Claude `mingla-implementor` | Implement from `/Users/sethogieva/Desktop/mingla-main` on `Seth`; stage only scoped files; include repo-running regression tests in the scoped commit. |
| Claude `mingla-tester` / Codex `tester-mingla` | Verify from `/Users/sethogieva/Desktop/mingla-main` on `Seth`; write QA reports there; do not mutate implementation unless explicitly redirected. |
| PMM/UI/product skills | Use the same branch when editing Mingla artifacts or product docs and include layman operator steps when the user must act. |

---

## Legacy worktree handling

Existing `.worktrees/...` folders and rows in `Mingla_Artifacts/WORKTREE_REGISTRY.md` are legacy transition state. Do not open new rows. If old worktree content must be salvaged, the orchestrator should write an explicit migration/cleanup note and bring only reviewed scoped files into `Seth`.

---

## Why this beats the retired model

The retired per-ORCH model protected isolation but made the operator carry too much path and branch context across Claude and Codex. The new `Seth` model keeps every skill looking at the same files, makes handoffs easier, and still protects quality through scoped prompts, scoped staging, regression tests, evidence gates, and final promotion to `main` only after close.
