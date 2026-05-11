# Investigation Report Template

Use this for durable investigations. Keep it proportional for small issues, but do not omit evidence, confidence, or production-readiness sections for launch-relevant work.

```markdown
# Investigation Report: [Issue Name] ([ORCH-ID if any])

> Date: [YYYY-MM-DD]
> Source: [User report | Orchestrator | Sweep | Regression | Review]
> Confidence: [H | M | L] — [why]
> Status: [root cause proven | root cause probable | root cause suspected | inconclusive]

## 1. Layman Summary

[What is broken, what the user/business/admin experiences, why it matters, recommended direction.]

## 2. Scope

- **Feature / issue:**
- **Actor:**
- **Environment:**
- **Success definition:**
- **Assumptions:**
- **Out of scope:**

## 3. Intended Journey

`entry point -> user action -> network call -> server/data side effect -> user-visible result`

Include expected failure behavior: permissions, loading, empty, error, retry, rollback, copy.

## 4. Historical Context

- Prior reports/specs/prompts checked:
- ORCH IDs or handoffs checked:
- Superseded/stale artifacts found:

## 5. Investigation Manifest

| # | File / artifact | Layer | Why read |
|---|---|---|---|
| 1 |  |  |  |

## 6. Five-Layer Cross-Check

| Layer | What it says | Evidence | Matches? |
|---|---|---|---|
| Docs |  |  |  |
| Schema/RLS |  |  |  |
| Code |  |  |  |
| Runtime/tests |  |  |  |
| Data/cache |  |  |  |

**Contradictions:**

## 7. Findings

### Finding 1: [Title]

- **Severity:**
- **Type:** [confirmed bug | likely bug | UX gap | production-hardening gap | security gap | invariant violation | open question]
- **Confidence:** [proven | probable | suspected | inconclusive]
- **Broken journey step:**
- **Evidence:** [file:line, command, report, schema]
- **Current behavior:**
- **Expected behavior:**
- **Causal chain:**
- **User impact:**
- **Fix direction:**
- **Missing test or guardrail:**
- **Invariant violated:** [if any]

## 8. Root Cause Proof

For each proven root cause:

- **File + line:**
- **Exact code/schema:**
- **What it does:**
- **What it should do:**
- **Causal chain:**
- **Verification step:**

## 9. Static / Security / Pattern Flags

| Flag | File | Evidence | Severity | Classification |
|---|---|---|---|---|

## 10. Blast Radius

- Other flows affected:
- Mobile/business/admin/public parity:
- Query keys/cache/state involved:
- RLS/auth/permission implications:
- Integrations involved:
- Deploy/migration implications:
- Recurring pattern:

## 11. Production Readiness Verdict

- **Ready / not ready:**
- **Launch blockers:**
- **Residual risks:**
- **Telemetry/monitoring gaps:**
- **Missing tests:**
- **Fastest next verification:**

## 12. Discoveries For Orchestrator

- [Side issue, severity, recommended action, or "None"]

## 13. Recommended Next Step

[spec | implement smallest fix | deeper investigation | retest | defer] with reasoning.
```

## Production-Readiness Verdict

- Ready / Not ready:
- Launch blockers:
- Residual risks:
- Fastest next verification:
