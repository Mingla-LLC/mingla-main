# Agent Prompts

Use these only in `DISPATCH` mode or when the user asks for a handoff prompt. Save prompts under `Mingla_Artifacts/prompts/`.

## Universal Structure

```markdown
# {Agent Role}: {Issue Title} ({ORCH-ID})

## Mission
{Exactly what this agent must produce.}

## Context
{Plain-English user/business/admin impact and why it matters.}

## Scope
IN: {bounded work}
OUT: {adjacent concerns to note but not solve}
NON-GOALS: {explicitly forbidden expansion}

## Evidence Trail
{World Map entry, reports, specs, tests, code paths, related ORCH IDs}

## Affected Files
{Ordered starting points: UI -> hook -> service -> edge/RPC -> schema/RLS -> tests}

## What Changed Since Last Pass
{Only for redispatch/retest/rework.}

## Constraints
{Architecture constitution, invariants, deploy constraints, user constraints}

## Success Criteria
{Observable, testable outcomes.}

## Output Requirements
{Exact file(s), sections, and verdict format.}

## Anti-Patterns To Avoid
{Known Mingla traps relevant to this task.}
```

## Investigator Prompt

```markdown
# Investigation: {Issue Title} ({ORCH-ID})

## Mission
Prove the root cause of {symptom}. Produce `INVESTIGATION_{NAME}.md`.

## Context
{Expected behavior vs actual behavior and user impact.}

## Scope
IN: {specific flow/layers/files}
OUT: {adjacent concerns}

## Evidence Trail
- Registered: {date/source}
- Related: {ORCH IDs}
- Prior work: {links}

## Starting Files
{component -> hook -> service -> edge/RPC -> migration/RLS}

## Constraints
- Inspect docs, code, schema/RLS, runtime/test evidence, and data assumptions where available.
- Classify each finding as confirmed bug, likely bug, UX gap, hardening gap, or open question.
- Root cause requires file/line, current behavior, expected behavior, causal chain, verification, and missing guardrail.
- Do not implement fixes.

## Output
`Mingla_Artifacts/reports/INVESTIGATION_{NAME}.md`
```

## Spec Prompt

```markdown
# Spec: {Title} ({ORCH-ID})

## Mission
Write a bounded implementation spec for the proven root cause. Produce `SPEC_{NAME}.md`.

## Inputs
- Investigation: {link}
- Root cause: {RC-ID}
- Invariants: {list}

## Scope Lock
{exact changes, non-goals, migration/deploy constraints}

## Required Sections
Summary, User Story, Success Criteria, Data/Schema Changes, Server Changes, Client Changes, Business/Admin Changes, Implementation Order, Rollback Plan, Test Matrix, Regression Prevention, Handoff To Implementor.
```

## Implementor Prompt

```markdown
# Implementation: {Title} ({ORCH-ID})

## Mission
Implement exactly what `{SPEC}` requires and produce `IMPLEMENTATION_{NAME}.md`.

## Scope Lock
Only change files listed in the spec unless the trail proves an omitted dependency. Document surprises; do not expand product scope.

## Rules
- Preserve all invariants.
- No silent failures.
- No fabricated data.
- Remove broken competing paths before adding new ones.
- Update or add focused tests where risk warrants.

## Output
- Code changes.
- Implementation report with files changed, behavior before/after, surprises, verification run, and remaining risks.
```

## Tester Prompt

```markdown
# Testing: {Title} ({ORCH-ID})

## Mission
Verify implementation against spec and produce `TEST_REPORT_{NAME}.md`.

## Required Checks
- Every success criterion.
- Loading/error/empty/populated/success/rollback where applicable.
- Cold start and warm cache where applicable.
- Solo/collab or mobile/business/admin parity where applicable.
- RLS/auth and wrong-actor behavior where applicable.
- Adjacent regression check.

## Verdict
PASS | CONDITIONAL PASS | NEEDS REWORK | REJECTED

Show evidence for every pass/fail claim.
```
