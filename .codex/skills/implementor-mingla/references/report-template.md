# Implementation Report Template

Use for ORCH/spec/launch-critical/broad/risky work, or whenever the user asks for a report. Keep every section, but be brief when a section is genuinely not applicable.

```markdown
# Implementation Report: [Title] ([ORCH-ID if any])

> Date: [YYYY-MM-DD]
> Mode: [Spec Execute | Diagnose and Fix | Design and Build | Refactor | Rework]
> Spec: [link or "User-directed"]
> Status: [implemented and verified | implemented, partially verified | implemented, unverified | blocked]

## 1. Layman Summary

[What changed, why it matters, what users/business/admins gain.]

## 2. Request And Context

- **Request:**
- **Source:**
- **Affected surfaces:**
- **Related issues/artifacts:**

## 3. Scope

- **In scope:**
- **Out of scope:**
- **Assumptions:**

## 4. Files Read

| File | Why | Relevant finding |
|---|---|---|

## 5. Blast Radius

- **Direct changes:**
- **Cascade changes:**
- **Parity surfaces:**
- **Cache impact:**
- **State boundaries:**
- **Auth/RLS/security:**
- **Deploy path:**

## 6. Old To New Receipts

### [file]

- **Before:**
- **After:**
- **Why:**
- **Approx lines changed:**

Repeat for every changed file.

## 7. Implementation Details

- **Architecture decisions:**
- **Data flow:**
- **Mutation/query behavior:**
- **State handling:**
- **Error handling:**
- **Copy/accessibility:**
- **Analytics/notifications/realtime:**

## 8. Spec / Goal Traceability

| Criterion / goal | Implemented | Verification | Status |
|---|---|---|---|

## 9. Invariant Verification

| Invariant | Relevant | Preserved | Notes |
|---|---|---|---|

## 10. Parity Check

- **Mobile:**
- **Business app:**
- **Admin:**
- **Public/web:**
- **Solo/collab:**
- **Gaps:**

## 11. Cache And Persisted State Safety

- **Query keys changed:**
- **Invalidations added:**
- **Data shape changes:**
- **AsyncStorage/Zustand impact:**
- **Cold start behavior:**

## 12. Verification

| Check | Command / method | Result | Notes |
|---|---|---|---|

## 13. Regression Surface

1. [Adjacent feature and why]
2. [...]

## 14. Risks, Limitations, Transition Items

| Item | Risk / temporary state | Exit condition | Location |
|---|---|---|---|

Or: None.

## 15. Discoveries For Orchestrator

- [Side issue, severity estimate, recommended action]
- Or: None.

## 16. Deploy Notes

- **Migrations:**
- **Edge functions:**
- **Mobile OTA/native:**
- **Business/admin web:**
- **Env vars/secrets:**

## Suggested Commit Message

```text
[area]: [concise change]

Resolves: [ORCH-ID if any]
Evidence: [tests/reports]
Deploy: [notes]
```

## Ready-To-Test Checklist

1. [Manual test and expected result]
2. [...]
```
