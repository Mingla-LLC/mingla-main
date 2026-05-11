# QA Report Template

Every test produces this file. All sections mandatory.

---

```markdown
# QA Report: [Scope] ([ORCH-ID if dispatched])

> Date: [date]
> Mode: [TARGETED | SPEC-COMPLIANCE | PRE-RELEASE | SECURITY | RETEST | FULL-SWEEP]
> Verdict: [PASS | CONDITIONAL PASS | FAIL]
> Findings: P0:[n] P1:[n] P2:[n] P3:[n] P4:[n]

---

## 1. Layman Summary

[2-3 sentences. What was tested, what's the verdict, what needs attention.
No jargon. Same text as chat response.]

---

## 2. Test Manifest

Files inspected, organized by layer:

### Database/RLS
| File | What Was Checked |
|------|-----------------|

### Edge Functions
| File | What Was Checked |
|------|-----------------|

### Services
| File | What Was Checked |
|------|-----------------|

### Hooks
| File | What Was Checked |
|------|-----------------|

### Components
| File | What Was Checked |
|------|-----------------|

---

## 3. Implementation Claim Verification

[If implementation report exists]

| # | Implementor's Claim | Verified? | Evidence |
|---|-------------------|-----------|----------|
| 1 | [claim from report] | ✅/❌/⚠️ | [what you found] |

---

## 4. Constitution Compliance

| # | Rule | Verdict | Evidence |
|---|------|---------|----------|
| 1 | No dead taps | PASS/FAIL/N/A | [file:line or explanation] |
| 2 | One owner per truth | PASS/FAIL/N/A | |
| 3 | No silent failures | PASS/FAIL/N/A | |
| 4 | One key per entity | PASS/FAIL/N/A | |
| 5 | Server state server-side | PASS/FAIL/N/A | |
| 6 | Logout clears everything | PASS/FAIL/N/A | |
| 7 | Label temporary | PASS/FAIL/N/A | |
| 8 | Subtract before adding | PASS/FAIL/N/A | |
| 9 | No fabricated data | PASS/FAIL/N/A | |
| 10 | Currency-aware | PASS/FAIL/N/A | |
| 11 | One auth instance | PASS/FAIL/N/A | |
| 12 | Validate at right time | PASS/FAIL/N/A | |
| 13 | Exclusion consistency | PASS/FAIL/N/A | |
| 14 | Persisted-state startup | PASS/FAIL/N/A | |

---

## 5. Behavioral Contract Compliance

[Only if affected contracts exist]

| Contract | Verified? | Evidence |
|----------|-----------|----------|

---

## 6. Findings

### P0 — CRITICAL (blocks release)

**[P0-001]: [Title]**
- **File:** [path:line]
- **Code:** `[exact problematic code]`
- **What's wrong:** [precise description]
- **Impact:** [what breaks in production]
- **Fix:** [exact change required]
- **Verification:** [how to confirm the fix works]

### P1 — HIGH (must fix before production)

**[P1-001]: [Title]**
[same structure]

### P2 — MEDIUM (fix this sprint)

**[P2-001]: [Title]**
[same structure]

### P3 — LOW (fix when convenient)

**[P3-001]: [Title]**
[same structure]

### P4 — NOTES (including praise)

**[P4-001]: [Title]**
- [What was done well and why it's worth replicating]

---

## 7. Independent Test Results

### Tests Written: [count]
### Tests Passed: [count]
### Tests Failed: [count]

| ID | Test | Input | Expected | Actual | PASS/FAIL |
|----|------|-------|----------|--------|-----------|
| T-01 | [scenario] | [input] | [expected] | [actual] | ✅/❌ |

---

## 8. Parity Check

| Surface | Tested? | Result | Notes |
|---------|---------|--------|-------|
| Solo mode | Y/N/NA | PASS/FAIL | |
| Collab mode | Y/N/NA | PASS/FAIL | |
| Admin dashboard | Y/N/NA | PASS/FAIL | |
| iOS specific | Y/N/NA | PASS/FAIL | |
| Android specific | Y/N/NA | PASS/FAIL | |

---

## 9. Cross-Domain Impact Matrix

| Change | Mobile | Admin | Edge Functions | RLS |
|--------|--------|-------|---------------|-----|
| [change] | [impact] | [impact] | [impact] | [impact] |

---

## 10. Security Findings

[Separate section — security findings have severity override]

| Finding | Severity | File | Risk | Fix |
|---------|----------|------|------|-----|
| [or "No security issues found"] | | | | |

---

## 11. UX Coherence Findings

| Screen/State | Issue | Severity | Fix |
|-------------|-------|----------|-----|
| [or "No UX issues found"] | | | |

---

## 12. Pattern Compliance

| File | Convention Checked | Compliant? | Notes |
|------|-------------------|-----------|-------|

---

## 13. Spec Traceability (if spec-compliance mode)

| Criterion | Status | Evidence |
|-----------|--------|----------|
| [criterion] | IMPLEMENTED/PARTIAL/NOT/INCORRECT | [file:line] |

---

## 14. Required Actions (ordered by priority)

1. **[P0-001]:** [exact fix instruction]
2. **[P1-001]:** [exact fix instruction]
...

---

## 15. Recommended Actions (not blocking)

1. [P2 improvements]
2. [P3 improvements]

---

## 16. Discoveries for Orchestrator

[Side issues found during testing — get registered as new ORCH-IDs]

- [Discovery 1: what, where, estimated severity]
- [or "None discovered"]

---

## 17. Retest Notes (if RETEST mode)

| Previous Finding | Fixed? | Evidence | Regression? |
|-----------------|--------|----------|-------------|
| [P0-001 from v1] | Y/N | [what changed] | [new issues?] |

Retest cycle: [1st | 2nd | 3rd+]
[If 3rd+: flagged to orchestrator as stuck in loop]
```
