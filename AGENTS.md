# AGENTS.md

## How Mingla work is tracked

All work — bugs, features, ideas, discoveries — lives as GitHub issues on the **Mingla Avengers board** (https://github.com/orgs/Mingla-LLC/projects/4). The board README is the operating manual. If it's not an issue, it doesn't exist.

- **Issue titles are plain English**; the **issue # is the work ID**. Branches are `<issue#>-short-slug`; PRs say `Fixes #<issue#>`.
- **Status lifecycle:** `Todo` (queued) → `In Progress` (investigating / building) → `In Review` (PR open, testing) → `Done` (merged + verified; auto-closes the issue).
- **Documentation goes to the issue**, not the repo: investigation findings, spec decisions, implementation notes, and test evidence are issue comments (attach screenshots). Do NOT create per-work-item .md files — CI (`scripts/docs/check_artifact_placement.py`) rejects them.
- When something ships, append one line to `REPORTS.md` (format documented in that file).
- Set board fields when creating issues (Work Type, Product, Theme, Priority, Estimate; Horizon/Quarter for roadmap items) — board views filter on them.
- Setting Status = Done auto-closes the issue (a project workflow); don't mark Done anything that should stay open.

## Canonical docs (the only durable .md surface)

| Doc | Owns |
|---|---|
| `PRODUCT_AND_STRATEGY.md` | Product, positioning, roadmap, strategy |
| `MARKETING.md` | Channels, attribution, marketing motions |
| `COMMS.md` | Cross-session coordination (read on entry — see below) |
| `REPORTS.md` | Shipped-work log |
| `docs/` | Engineering references: invariant registry, handbook, worktree strategy, runbooks, contracts |

Everything pre-2026-07-19 (Mingla_Artifacts/, Mingla_Roadmap/, per-ORCH docs, the old COMMS_LEDGER) is preserved at git tag `pre-avengers-archive`.

## Read COMMS.md on entry (MANDATORY)

Before other work, read `/Users/sethogieva/Desktop/mingla-main/COMMS.md` and scan the Active table for rows addressed to you, your current issue #, or `ALL`. `BLOCK`+`OPEN` → stop and execute the body, then ack. `WARN`+`OPEN` → factor in and ack. `FYI` → read and continue. When you discover something affecting another in-flight session, append a `COMMS-NNNN` row via a one-file direct-to-`main` commit and push immediately (procedure in the file).

## Engineering discipline (unchanged)

- **Never commit on the anchor `main`** (`~/Desktop/mingla-main`). Work in a per-issue worktree: `~/Desktop/mingla-orchs/<issue#>-<slug>/` on branch `<issue#>-<slug>`, branched from fresh `origin/main`. Full rules: `docs/WORKTREE_STRATEGY.md`.
- **One PR per issue; merge only when all required checks are GREEN** and the PR is mergeable. Never merge red, never disable a check.
- The 14-rule Architecture Constitution in `README.md` binds every change; invariants in `docs/INVARIANT_REGISTRY.md` are enforced by strict-grep CI gates.
- Fixes ship with regression tests; the tests suite is append-only (CI-gated).
- Both apps ship the SAME version — bump together (CI parity gate).
- Public trip/offering changes must hit ALL surfaces (consumer iOS/Android, business iOS/Android, buyer web, admin where applicable).

## Response style

Every chat response uses exactly two top-level sections: **A — What just happened** (1–4 plain-English sentences, outcome first, layman first) and **B — Handoff** (next steps for Seth, a handoff paragraph for the next agent, or "none; awaiting your direction"). Detail beyond summary-grade goes to the issue, not chat.
