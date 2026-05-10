# Agent Prompt Templates

Templates for writing handoff prompts to downstream specialist agents.
Each prompt is a self-contained document saved to `Mingla_Artifacts/prompts/`.

---

## Universal Prompt Structure

Every agent prompt must contain these sections:

```
# {Agent Role}: {Issue Title} ({ORCH-ID})

## Mission
{One sentence: exactly what this agent must produce}

## Context
{Plain-English background: what the issue is, why it matters, what users experience}

## Scope
{Explicit boundaries: what IS in scope, what is NOT}

## Evidence Trail
{Links to prior work: investigation reports, specs, test reports, related ORCH-IDs}

## Affected Files
{Explicit file list with paths — the agent reads ONLY these unless trail leads elsewhere}

## What Changed Since Last Pass
{If this is a re-dispatch: what happened, what was tried, what failed, what's different now}

## Constraints
- {Architectural constraints from the constitution}
- {Invariants that must hold}
- {Performance/UX requirements}

## Success Criteria
{Numbered list of observable outcomes that prove the work is complete}

## Output Requirements
{Exact file(s) the agent must produce, with naming convention and required sections}

## Anti-Patterns to Avoid
{Specific mistakes this agent must NOT make, based on Mingla history}
```

---

## Investigator Prompt Template

```markdown
# Investigation: {Issue Title} ({ORCH-ID})

## Mission
Prove the root cause of {symptom}. Produce INVESTIGATION_{ISSUE_NAME}_REPORT.md.

## Context
{What the user experiences. What should happen vs what does happen.}

## Scope
IN: {Specific flow, specific files, specific layers}
OUT: {Adjacent concerns to note but not investigate deeply}

## Evidence Trail
- Registered: {date}, source: {user report / sweep / regression}
- Related: {ORCH-IDs of similar symptoms}
- Prior work: {any previous investigation attempts}

## Affected Files (start here)
{Ordered list: component → hook → service → edge function → DB/RLS}

## Constraints
- Must inspect all 5 truth layers (docs, schema, code, runtime, data)
- Must classify every finding (🔴 root cause, 🟠 contributing, 🟡 hidden, 🔵 observation)
- Root cause requires all 6 fields (file+line, exact code, what it does, what it should do, causal chain, verification step)
- Do NOT propose solutions — only prove what's broken

## Success Criteria
1. Root cause identified with complete 6-field proof
2. Causal chain traces from root cause to user symptom
3. All adjacent/hidden flaws documented
4. Blast radius mapped (what else could this affect)

## Output
File: `INVESTIGATION_{ISSUE_NAME}_REPORT.md`
Sections: Symptom Summary, Investigation Manifest, Findings (classified), Blast Radius, Verification Steps
```

---

## Spec Writer Prompt Template

```markdown
# Spec: {Feature/Fix Title} ({ORCH-ID})

## Mission
Write a bounded implementation spec for {fix/feature}. Produce SPEC_{NAME}.md.

## Context
{Investigation summary. Root cause. What must change and why.}

## Scope
IN: {Exact changes required}
OUT: {Adjacent improvements to defer}
NON-GOALS: {What this spec explicitly does NOT address}

## Evidence Trail
- Investigation: {link to investigation report}
- Root cause: {RC-ID from Root Cause Register}
- Constitutional implications: {which principles apply}

## Affected Files
{From investigation, plus any new files needed}

## Invariants That Must Hold
{List specific invariants from the registry}

## Constraints
- Every layer (DB → edge → service → hook → component) must be specified
- Every success criterion must map to a testable outcome
- Must include rollback safety plan
- Must include migration plan if schema changes
- Subtract before adding — remove broken code before writing new

## Success Criteria
{Numbered list from investigation's fix strategy}

## Output
File: `SPEC_{NAME}.md`
Sections: Summary, User Story, Success Criteria, Database Changes, Edge Functions,
Mobile Implementation (services, hooks, components), Implementation Order,
Test Cases, Common Mistakes, Regression Prevention, Handoff to Implementor
```

---

## Implementor Prompt Template

```markdown
# Implementation: {Title} ({ORCH-ID})

## Mission
Implement the changes specified in {SPEC_NAME}.md. Produce code + IMPLEMENTATION_REPORT_{NAME}.md.

## Spec
{Full spec content or link — implementor must not deviate from spec}

## Scope Lock
You may ONLY change what the spec defines. If you discover something the spec missed,
document it in the implementation report under "Surprises" — do NOT fix it yourself.

## Implementation Order
{From spec — database first, then edge functions, then services, hooks, components}

## Invariants (must not break)
{Copy from spec}

## Anti-Patterns
- Do NOT expand scope beyond the spec
- Do NOT add "while I'm here" improvements
- Do NOT swallow errors — every catch must surface or log
- Do NOT create new sources of truth
- Do NOT skip loading/error/empty states

## Output
1. Code changes (committed or staged)
2. `IMPLEMENTATION_REPORT_{NAME}.md` with:
   - Files changed and exactly how
   - Old behavior vs new behavior
   - Surprises encountered (things spec didn't anticipate)
   - What still needs testing
```

---

## Tester Prompt Template

```markdown
# Testing: {Title} ({ORCH-ID})

## Mission
Verify implementation against spec. Produce TEST_REPORT_{NAME}.md.

## Spec Reference
{Link to spec — every success criterion must be tested}

## Implementation Reference
{Link to implementation report — test what was actually changed}

## Test Matrix
{From spec's test cases section — every row must get a pass/fail}

## Additional Checks (mandatory)
- [ ] Solo mode AND collab mode (if applicable)
- [ ] Loading state renders correctly
- [ ] Error state renders correctly
- [ ] Empty state renders correctly
- [ ] Populated state renders correctly
- [ ] Cold start (no cache) works
- [ ] Warm start (cached data) works
- [ ] Background → foreground transition preserves state
- [ ] Adjacent flows not regressed

## Anti-Patterns
- Do NOT trust the implementor's "it works" claim — verify independently
- Do NOT skip edge cases because happy path works
- Do NOT mark pass without showing evidence (screenshot, log, query result)

## Output
`TEST_REPORT_{NAME}.md` with:
- Each test case: scenario → input → expected → actual → PASS/FAIL
- Edge cases discovered during testing
- Regressions found in adjacent behavior
- Verdict: PASS (100% green) | NEEDS REWORK (specific failures listed)
- Recommendations for orchestrator (side issues, risks, observations)
```

---

## Deeper Investigation Prompt Template

Use when initial investigation was inconclusive or new evidence emerged.

```markdown
# Deeper Investigation: {Title} ({ORCH-ID})

## Mission
Resolve remaining uncertainty from initial investigation. Prior investigation
found {what was found} but could not conclusively {what remains unknown}.

## Prior Investigation Summary
{Key findings, confidence levels, what layers were checked}

## What's Still Unknown
{Specific questions that must be answered}

## New Evidence Since Last Pass
{Any new symptoms, user reports, code changes, or runtime observations}

## Focus Areas
{Specific files/layers/interactions to examine that prior investigation missed}

## Output
Updated `INVESTIGATION_{ISSUE_NAME}_REPORT.md` with new findings integrated.
```
