# QA Report Template

Use for ORCH/spec/security/pre-release/broad/risky QA, or when the user asks for a report.

```markdown
# QA Report: [Scope] ([ORCH-ID if any])

> Date: [YYYY-MM-DD]
> Mode: [TARGETED | SPEC-COMPLIANCE | RETEST | SECURITY | UX-ACCESSIBILITY | PRE-RELEASE | FULL-SWEEP | REVIEW]
> Verdict: [PASS | CONDITIONAL PASS | FAIL | BLOCKED/UNVERIFIED]
> Findings: P0:[n] P1:[n] P2:[n] P3:[n] P4:[n]

## 1. Layman Summary

[What was tested, verdict, and what needs attention.]

## 2. Inputs Reviewed

- Spec:
- Implementation report:
- Investigation:
- Changed files:
- Tests/artifacts:

## 3. Test Manifest

| Layer | Files / artifacts | What was checked |
|---|---|---|
| Database/RLS |  |  |
| Edge/RPC/Webhooks |  |  |
| Services |  |  |
| Hooks/State/Cache |  |  |
| Components/Screens |  |  |
| Business/Admin/Public |  |  |
| Tests/Build |  |  |

## 4. Claim Verification

| Claim / criterion | Evidence checked | Status | Notes |
|---|---|---|---|

## 5. Verification Performed

| Check | Command / method | Result | Evidence |
|---|---|---|---|

## 6. Constitution Compliance

| Rule | Verdict | Evidence |
|---|---|---|
| No dead taps | PASS/FAIL/N/A |  |
| One owner per truth | PASS/FAIL/N/A |  |
| No silent failures | PASS/FAIL/N/A |  |
| One key per entity | PASS/FAIL/N/A |  |
| Server state server-side | PASS/FAIL/N/A |  |
| Logout clears everything | PASS/FAIL/N/A |  |
| Label temporary | PASS/FAIL/N/A |  |
| Subtract before adding | PASS/FAIL/N/A |  |
| No fabricated data | PASS/FAIL/N/A |  |
| Currency-aware | PASS/FAIL/N/A |  |
| One auth instance | PASS/FAIL/N/A |  |
| Validate at right time | PASS/FAIL/N/A |  |
| Exclusion consistency | PASS/FAIL/N/A |  |
| Persisted-state startup | PASS/FAIL/N/A |  |

## 7. Findings

### P0 Critical

**P0-001: [Title]**
- **Evidence:** [file:line / command / schema]
- **What is wrong:**
- **Impact:**
- **Required fix:**
- **Retest:**

### P1 High

[same structure]

### P2 Medium

[same structure]

### P3 Low

[same structure]

### P4 Notes

[observations or praise]

## 8. Spec Traceability

| Criterion | Status | Evidence | Finding |
|---|---|---|---|

## 9. Security

| Finding/check | Severity | Evidence | Result |
|---|---|---|---|

## 10. UX / Accessibility

| Screen/state | Finding/check | Severity | Result |
|---|---|---|---|

## 11. Parity

| Surface/path | Tested? | Result | Notes |
|---|---|---|---|
| Mobile |  |  |  |
| Business |  |  |  |
| Admin |  |  |  |
| Public/web |  |  |  |
| Solo |  |  |  |
| Collab |  |  |  |
| iOS |  |  |  |
| Android |  |  |  |

## 12. Cross-Domain Impact

| Change | Mobile | Business | Admin | Edge/RPC | RLS/Data | Notes |
|---|---|---|---|---|---|---|

## 13. Production Verification

| Check | Method | Result | Remaining manual test |
|---|---|---|---|

## 14. Required Actions

1. **[P0/P1 ID]:** [exact rework instruction]

## 15. Conditional / Recommended Actions

1. [P2/P3/manual/deploy condition]

## 16. Discoveries For Orchestrator

- [Side issue, severity estimate, recommended action]
- Or: None.

## 17. Retest Notes

| Previous finding | Fixed? | Evidence | Regression? |
|---|---|---|---|

Retest cycle: [N/A | 1 | 2 | 3+ stuck]
```
