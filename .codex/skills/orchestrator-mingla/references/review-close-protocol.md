# Review And Close Protocol

## Review Checklist

Lead with findings. For each issue, include severity, file/line or artifact link, user impact, evidence, and fix direction.

Ask:

- Root cause proven or merely plausible?
- Scope minimal and correct?
- Any hidden fallback masking failure?
- Any stale cache/query-key path?
- Any duplicate truth owner?
- Any swallowed error?
- All UI states truthful?
- Auth/RLS actor path checked?
- Solo/collab, mobile/business/admin/web parity checked where relevant?
- Migration/deploy order understood?
- Tests or focused verification run?
- Artifacts updated?

Verdict:

- `APPROVED`: evidence complete and residual risk acceptable.
- `CONDITIONAL PASS`: acceptable with named conditions and no launch blocker.
- `NEEDS WORK`: specific gaps remain.
- `REJECTED`: wrong root cause, unsafe fix, missing evidence, or invariant violation.

## Close Preconditions

Close only when:

- The tracked issue has a stable ID.
- Root cause or accepted scope is documented.
- Implementation evidence exists.
- Verification evidence exists or the unverified portion is explicitly accepted.
- Relevant artifacts are synced.
- Deployment/migration/native-build implications are known.

## Mandatory Git Finalization

A close is not complete until the orchestrator commits and pushes the scoped close-out work.

Rules:

- Stage only files that belong to the item being closed.
- Do not bundle unrelated dirty work, even if it is already present in the worktree.
- Run `git diff --check` before committing.
- Use a commit message that names the closed ORCH/cycle and evidence.
- Push the commit to the active branch.
- If the worktree contains unrelated changes, leave them unstaged and mention them as excluded.
- If push fails, report the blocker and the exact local commit SHA that still needs pushing.

## Full Artifact Close Sync

For verified tracked closes, update relevant documents:

- `WORLD_MAP.md`: status, grade, verified date, evidence.
- `MASTER_BUG_LIST.md`: move to recently closed or update state.
- `COVERAGE_MAP.md`: surface grade/confidence if changed.
- `PRODUCT_SNAPSHOT.md`: launch blockers, fragile/strong surfaces, grade counts if changed.
- `PRIORITY_BOARD.md`: remove/renumber or adjust.
- `AGENT_HANDOFFS.md`: completed handoff if agents were used.
- `OPEN_INVESTIGATIONS.md`, `SPEC_QUEUE.md`, `IMPLEMENTATION_QUEUE.md`, `TEST_QUEUE.md`, `RETEST_LEDGER.md`: clear or update the relevant row.
- `ROOT_CAUSE_REGISTER.md`: mark fixed/mitigated if a root cause was closed.
- `DECISION_LOG.md`: add accepted tradeoff/deferral if applicable.
- `docs/TRANSITIONAL_ITEMS_REGISTRY.md`: add/remove transitional items.

## Deployment Notes

Always state the deploy path if code changed:

- SQL migration: migration must be applied before dependent app/server deployment.
- Supabase edge function change: deploy the specific function(s).
- Mobile JS-only change: EAS update may be enough.
- Native dependency/config change: full native build, not OTA only.
- Business/admin web change: web build/deploy path.
- Env var change: list required key names and surfaces; do not print secrets.

## Commit Message Template

```text
{area}: {plain-English change}

- Closes {ORCH-ID(s)}
- Evidence: {test/report/link}
- Deploy notes: {migration/edge/mobile/web/native/env}
```

## Deprecation Close Extension

Use when closing work that removes or decommissions a system, column, table, RPC, edge function, feature surface, or fundamental concept.

Record:

- Deprecated thing.
- Replacement.
- Active-code rule: stale references are bugs.
- Historical-artifact rule: preserve as audit trail and cite supersession.
- Migration/backup rule.
- Docs/memory updates required.
- Any future investigator warning.

Add or update persistent project memory only if the repository/session supports it and the user approves writes outside the workspace.
