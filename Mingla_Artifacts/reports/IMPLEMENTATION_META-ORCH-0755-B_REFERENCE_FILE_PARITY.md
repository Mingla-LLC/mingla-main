# Implementation Report: META-ORCH-0755-B Reference File Parity Sync

> Date: 2026-05-10
> Executor: Codex `implementor-mingla`
> Working tree: `.worktrees/orch-meta-0755b-reference-file-parity/`
> Branch: `orch/meta-0755b-reference-file-parity`
> Status: implemented and verified

## Scope

Executed the reference-file parity sync for the four requested skill pairs:

| Pair | Claude side | Codex side |
|---|---|---|
| Forensics | `.claude/skills/mingla-forensics/` | `.codex/skills/forensic-mingla/` |
| Implementor | `.claude/skills/mingla-implementor/` | `.codex/skills/implementor-mingla/` |
| Orchestrator | `.claude/skills/mingla-orchestrator/` | `.codex/skills/orchestrator-mingla/` |
| Tester | `.claude/skills/mingla-tester/` | `.codex/skills/tester-mingla/` |

No product code, schema, edge function, app, business, admin, roadmap, or global index files were modified.

## Commits

| Commit | Scope |
|---|---|
| `facf0368` | Forensics reference parity |
| `565c8288` | Implementor reference parity |
| `a56757de` | Orchestrator reference parity |
| `11d4a112` | Tester reference parity and UX canonicalization |

This report is committed separately after those four pair commits.

## Implementation Notes

- The dispatch file existed in the main checkout at `Mingla_Artifacts/prompts/META-ORCH-0755-B_REFERENCE_FILE_PARITY_SYNC.md` but was not present on `origin/main` because `Mingla_Artifacts/prompts/` is ignored. I read it from the main checkout and did not modify or commit it.
- `origin/main` did not track `.claude/skills/` and only tracked a subset of `.codex/skills/`. To make the ORCH branch own the lifecycle result, the four scoped skill directories were materialized inside the worktree and force-added with only `SKILL.md` and `references/` paths. Non-reference helper files copied during materialization were removed before final verification.
- Each newly-created parity file includes a one-paragraph parity header naming its source file. Two inherited trailing-whitespace lines in copied templates were trimmed to satisfy `git diff --check`.
- Forensics report template clash was resolved by keeping both names on both sides: `investigation-report-template.md` for strict investigation-only output and `report-template.md` for broader forensic report scaffolding.
- Tester UX canonicalization removed Codex `ux-accessibility-protocol.md` and replaced it with canonical `ux-coherence-protocol.md`; the Codex accessibility-only checklist content was merged into the canonical file under "Accessibility Audit Notes From Former Codex `ux-accessibility-protocol.md`".

## Byte-Level Port Receipts

| Source -> Destination | Source bytes | Destination bytes | Note |
|---|---:|---:|---|
| `.claude/skills/mingla-forensics/references/invariant-violations.md` -> `.codex/skills/forensic-mingla/references/invariant-violations.md` | 4864 | 5077 | Header added |
| `.claude/skills/mingla-forensics/references/recurring-patterns.md` -> `.codex/skills/forensic-mingla/references/recurring-patterns.md` | 6219 | 6439 | Header added |
| `.codex/skills/forensic-mingla/references/forensic-checklist.md` -> `.claude/skills/mingla-forensics/references/forensic-checklist.md` | 3377 | 3579 | Header added |
| `.codex/skills/forensic-mingla/references/mingla-surface-map.md` -> `.claude/skills/mingla-forensics/references/mingla-surface-map.md` | 2620 | 2801 | Header added |
| `.claude/skills/mingla-forensics/references/investigation-report-template.md` -> `.codex/skills/forensic-mingla/references/investigation-report-template.md` | 4695 | 4987 | Header added; trailing whitespace trimmed |
| `.codex/skills/forensic-mingla/references/report-template.md` -> `.claude/skills/mingla-forensics/references/report-template.md` | 3016 | 3283 | Header added |
| `.claude/skills/mingla-implementor/references/constitutional-quick-check.md` -> `.codex/skills/implementor-mingla/references/constitutional-quick-check.md` | 2652 | 2869 | Header added |
| `.claude/skills/mingla-implementor/references/error-handling-contracts.md` -> `.codex/skills/implementor-mingla/references/error-handling-contracts.md` | 6476 | 6732 | Header added |
| `.claude/skills/mingla-implementor/references/invariant-checklist.md` -> `.codex/skills/implementor-mingla/references/invariant-checklist.md` | 3986 | 4194 | Header added |
| `.claude/skills/mingla-implementor/references/query-key-discipline.md` -> `.codex/skills/implementor-mingla/references/query-key-discipline.md` | 6407 | 6615 | Header added |
| `.codex/skills/implementor-mingla/references/execution-protocol.md` -> `.claude/skills/mingla-implementor/references/execution-protocol.md` | 4146 | 4389 | Header added |
| `.codex/skills/implementor-mingla/references/error-query-state-contracts.md` -> `.claude/skills/mingla-implementor/references/error-query-state-contracts.md` | 2730 | 2957 | Header added |
| `.codex/skills/implementor-mingla/references/invariants-and-constitution.md` -> `.claude/skills/mingla-implementor/references/invariants-and-constitution.md` | 2493 | 2714 | Header added |
| `.claude/skills/mingla-orchestrator/references/artifact-templates.md` -> `.codex/skills/orchestrator-mingla/references/artifact-templates.md` | 6730 | 6929 | Header added |
| `.claude/skills/mingla-orchestrator/references/bootstrap-sequence.md` -> `.codex/skills/orchestrator-mingla/references/bootstrap-sequence.md` | 5328 | 5554 | Header added; trailing whitespace trimmed |
| `.claude/skills/mingla-orchestrator/references/constitutional-compliance.md` -> `.codex/skills/orchestrator-mingla/references/constitutional-compliance.md` | 5673 | 5900 | Header added |
| `.claude/skills/mingla-orchestrator/references/failure-patterns.md` -> `.codex/skills/orchestrator-mingla/references/failure-patterns.md` | 6272 | 6507 | Header added |
| `.claude/skills/mingla-orchestrator/references/invariant-registry.md` -> `.codex/skills/orchestrator-mingla/references/invariant-registry.md` | 5548 | 5808 | Header added |
| `.claude/skills/mingla-orchestrator/references/user-journey-map.md` -> `.codex/skills/orchestrator-mingla/references/user-journey-map.md` | 5811 | 6017 | Header added |
| `.codex/skills/orchestrator-mingla/references/artifact-system.md` -> `.claude/skills/mingla-orchestrator/references/artifact-system.md` | 4835 | 5040 | Header added |
| `.codex/skills/orchestrator-mingla/references/mingla-journey-and-invariants.md` -> `.claude/skills/mingla-orchestrator/references/mingla-journey-and-invariants.md` | 5037 | 5291 | Header added |
| `.codex/skills/orchestrator-mingla/references/operating-system.md` -> `.claude/skills/mingla-orchestrator/references/operating-system.md` | 5167 | 5400 | Header added |
| `.codex/skills/orchestrator-mingla/references/review-close-protocol.md` -> `.claude/skills/mingla-orchestrator/references/review-close-protocol.md` | 3873 | 4088 | Header added |
| `.claude/skills/mingla-tester/references/ux-coherence-protocol.md` -> `.codex/skills/tester-mingla/references/ux-coherence-protocol.md` | 6615 | 7775 | Header added and former Codex accessibility content merged |

## Filename Parity Verification

Command:

```bash
comm -3 <(ls .codex/skills/forensic-mingla/references/ | sort) <(ls .claude/skills/mingla-forensics/references/ | sort)
comm -3 <(ls .codex/skills/implementor-mingla/references/ | sort) <(ls .claude/skills/mingla-implementor/references/ | sort)
comm -3 <(ls .codex/skills/orchestrator-mingla/references/ | sort) <(ls .claude/skills/mingla-orchestrator/references/ | sort)
comm -3 <(ls .codex/skills/tester-mingla/references/ | sort) <(ls .claude/skills/mingla-tester/references/ | sort)
```

Output:

```text
claude-forensics-audit.md

--- implementor ---
claude-implementor-audit.md

--- orchestrator ---
claude-skill-audit.md

--- tester ---
claude-tester-audit.md
```

This satisfies the expected audit-file-only filename deltas. Codex `ux-accessibility-protocol.md` no longer exists; Codex now uses `ux-coherence-protocol.md`.

## Verification Matrix

| Check | Result |
|---|---|
| Read dispatch before edits | PASS |
| Scope limited to `.claude/skills/*/SKILL.md`, `.claude/skills/*/references/`, `.codex/skills/*/SKILL.md`, `.codex/skills/*/references/`, and this implementation report | PASS |
| No product code modified | PASS |
| Global indexes untouched (`DECISION_LOG`, `INVARIANT_REGISTRY`, `WORLD_MAP`, `AGENT_HANDOFFS`, `WORKTREE_REGISTRY`) | PASS |
| Four pair commits created before report | PASS |
| `git diff --check` before each pair commit | PASS |
| Final filename parity `comm -3` checks | PASS |
| Worktree ignored residue removed | PASS |

## Discoveries For Orchestrator

1. `Mingla_Artifacts/prompts/META-ORCH-0755-B_REFERENCE_FILE_PARITY_SYNC.md` is ignored and not present on `origin/main`. That is consistent with prompt privacy, but it means fresh ORCH worktrees cannot read dispatch prompts from branch state unless the operator supplies them or orchestrator explicitly versions the prompt.
2. The requested symlink command does not make `.codex/skills` a symlink when `.codex/skills/` already exists from tracked `origin/main`; it creates `.codex/skills/skills` instead. This work removed that ignored symlink residue and materialized scoped files so the branch can own the commit.
3. Many shared filenames are not byte-identical across Claude and Codex because the skills intentionally preserve different depth/framing plus parity headers. This work synchronized filename availability and missing topic coverage only; it did not silently merge same-name content.

## Deploy Notes

No deploy, migration, Deno, app build, or runtime test is applicable. This was documentation/process reference synchronization only.

## Next Step

Route back to Codex `orchestrator-mingla` for REVIEW + CLOSE. The orchestrator owns merge-to-main and `git worktree remove` under the canonical CLOSE protocol.
