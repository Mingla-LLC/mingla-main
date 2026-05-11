# Implementation Report Template

Copy this structure for every implementation report. All 15 sections are mandatory.
Sections may be brief if genuinely not applicable, but never omitted.

---

```markdown
# Implementation Report: [Title] ([ORCH-ID if dispatched])

> Date: [date]
> Mode: [Spec Execute | Diagnose and Fix | Design and Build | Copy Pass | Data Pipeline | Refactor | Rework]
> Spec: [link to spec, or "User-directed (no spec)"]
> Status: [implemented and verified | implemented, partially verified | implemented, unverified]

---

## 1. Layman Summary

[2-4 sentences. What changed, why it matters, what users gain. No jargon.
This is the same text that appears in chat.]

---

## 2. Request & Context

- **Request:** [What was asked, in plain terms]
- **Source:** [Orchestrator dispatch ORCH-XXXX | User request | Test failure rework]
- **Affected surfaces:** [Mobile / Admin / Backend / Edge Functions / Database]
- **Related issues:** [ORCH-IDs of related items]

---

## 3. Scope

- **In scope:** [Exactly what was implemented]
- **Out of scope:** [What was explicitly excluded]
- **Assumptions:** [Anything assumed that wasn't in the spec]

---

## 4. Pre-Flight: Files Read

| File | Why | Relevant Finding |
|------|-----|-----------------|
| [path] | [what you needed to understand] | [anything notable found] |

---

## 5. Pre-Flight: Blast Radius

- **Direct changes:** [files modified]
- **Cascade changes:** [files that needed propagation]
- **Parity surfaces:** [solo/collab/admin implications]
- **Cache impact:** [query keys affected]
- **State boundaries crossed:** [RQ/Zustand/Context/AsyncStorage]

---

## 6. Old → New Receipts

### [filename.ts]
- **Before:** [exact previous behavior]
- **After:** [exact new behavior]
- **Why:** [which spec criterion / requirement / bug this addresses]
- **Lines changed:** [count]

### [filename2.ts]
...

[Repeat for every file changed. This is the core evidence trail.]

---

## 7. Implementation Details

### Architecture Decisions
[Any design choices made during implementation]

### Data Flow
[How data moves through the system after changes]

### Mutation / Query Behavior
[Which mutations fire, which keys invalidate, cache strategy]

### State Handling
[Loading, error, empty, populated, submitting — what renders in each]

### Error Handling
[How errors surface at each layer]

### Copy
[User-facing text added or changed]

### Accessibility
[Labels, roles, focus management]

### Analytics
[Events added or changed]

---

## 8. Spec Traceability

| Spec Criterion | Implemented? | Verification | Status |
|---------------|-------------|-------------|--------|
| [criterion 1 from spec] | [what was done] | [how verified] | PASS/FAIL/UNVERIFIED |
| [criterion 2] | ... | ... | ... |

[If no spec: map to the stated goals from the request]

---

## 9. Invariant Verification

| Invariant | Relevant? | Preserved? | Notes |
|-----------|-----------|-----------|-------|
| [INV-ID: description] | Y/N | Y/N/UNVERIFIED | [any notes] |

[Only include invariants marked RELEVANT in pre-flight]

---

## 10. Parity Check

- **Solo mode:** [tested / not applicable / needs manual test]
- **Collab mode:** [tested / not applicable / needs manual test]
- **Admin surface:** [tested / not applicable / needs manual test]
- **Gaps:** [what parity issues remain]

---

## 11. Cache Safety

- **Query keys changed:** [list, or "none"]
- **New invalidations added:** [list, or "none"]
- **Data shape changes:** [list + AsyncStorage migration status, or "none"]
- **Persisted state impact:** [what happens on cold start with old cache]

---

## 12. Regression Surface

The tester should verify these adjacent features:

1. [Most likely to break — what and why]
2. [Second most likely]
3. [Third]
4. [Fourth if applicable]
5. [Fifth if applicable]

---

## 13. Risks & Limitations

- [Edge case not solved + why]
- [Technical debt left + exit condition]
- [Performance concern if any]
- [Security consideration if any]

---

## 14. Transition Items

| Item | What's Temporary | Exit Condition | Code Location |
|------|-----------------|----------------|--------------|
| [description] | [why it's not permanent] | [when/how to fix permanently] | [file:line] |

[Or "None — all changes are permanent."]

---

## 15. Discoveries for Orchestrator

[Side issues, hidden flaws, unrelated bugs found during implementation.
These get registered as new ORCH-IDs by the orchestrator.]

- [Discovery 1: what, where, severity estimate]
- [Discovery 2: ...]

[Or "None discovered."]

---

## Suggested Commit Message

```
[type]: [concise description]

[body with context if needed]

Resolves: ORCH-XXXX
```

---

## Ready-to-Test Checklist

1. [Most important manual test — steps + expected result]
2. [Second priority test]
3. [Third priority test]
4. [Edge case to check]
```

---

## Rules for Writing the Report

1. Every section present, even if brief
2. Old → New Receipts for EVERY file changed — no exceptions
3. Spec Traceability maps every criterion — no missing rows
4. Honest verification status — never claim PASS without evidence
5. Discoveries go here, not silently fixed in code
6. Transition items have exit conditions — no open-ended debt
7. Commit message ready to copy-paste
