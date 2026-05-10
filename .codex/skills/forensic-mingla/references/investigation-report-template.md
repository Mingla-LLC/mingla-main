> Parity note: ported from `.claude/skills/mingla-forensics/references/investigation-report-template.md` during META-ORCH-0755-B. Use this when the desired output is a strict investigation-only report; use `report-template.md` for Codex broader investigation/spec/review report scaffolding.

# Investigation Report Template

Every investigation produces this file. All sections mandatory.

---

```markdown
# Investigation Report: [Issue Name] ([ORCH-ID if dispatched])

> Date: [date]
> Source: [Orchestrator dispatch | User report | Sweep finding | Regression]
> Confidence: [H | M | L] — [why this confidence level]
> Status: [root cause proven | root cause probable | root cause suspected | inconclusive]

---

## 1. Layman Summary

[2-4 sentences. What's broken, what users experience, why it matters.
No jargon. This is the same text that appears in chat.]

---

## 2. Symptom

- **Expected behavior:** [What should happen]
- **Actual behavior:** [What actually happens]
- **Reproduction:** [Steps to reproduce, or "intermittent — conditions unclear"]
- **Affected flow:** [Which user journey step(s)]
- **Affected surface:** [Mobile / Admin / Backend / All]

---

## 3. Investigation Manifest

Files read, in trace order:

| # | File | Layer | Why |
|---|------|-------|-----|
| 1 | [path] | Component | Entry point — where user sees the symptom |
| 2 | [path] | Hook | Data provider for the component |
| 3 | [path] | Service | Supabase query layer |
| ... | ... | ... | ... |

---

## 4. Five-Layer Cross-Check

| Layer | What It Says | Matches Reality? |
|-------|-------------|-----------------|
| Docs | [What product doc/spec/README claims] | [Y/N — discrepancy?] |
| Schema | [What DB constraints/RLS enforce] | [Y/N — discrepancy?] |
| Code | [What the code actually does] | [Y/N — discrepancy?] |
| Runtime | [What happens when it runs] | [Y/N — discrepancy?] |
| Data | [What's actually in DB/cache] | [Y/N — discrepancy?] |

**Contradictions found:** [Which layers disagree and what the truth is]

---

## 5. Findings

### 🔴 Root Cause

**RC-1: [Name]**
- **File:** [exact path + line number]
- **Code:**
```[language]
[exact problematic code, verbatim]
```
- **What it does:** [precise current behavior]
- **What it should do:** [precise correct behavior]
- **Causal chain:**
  1. [Step 1: what happens in the code]
  2. [Step 2: what that causes downstream]
  3. [Step 3: ... continuing to user symptom]
- **Verification:** [How to confirm this is the cause]
- **Invariant violated:** [INV-ID, or "none"]

### 🟠 Contributing Factors

**CF-1: [Name]**
- **File:** [path]
- **Code:** `[relevant snippet]`
- **Why it contributes:** [How this makes the root cause possible or worse]
- **Severity if root cause is fixed:** [Does this matter independently?]

### 🟡 Hidden Flaws

**HF-1: [Name]**
- **File:** [path]
- **Code:** `[relevant snippet]`
- **Risk:** [What future bug this could cause]
- **Recommended fix:** [Direction, not implementation]
- **Priority:** [Fix now with root cause | Fix in next wave | Track as debt]

### 🔵 Observations

**OB-1: [Name]**
- [What was noticed and why it's worth recording]

---

## 6. Static Analysis Flags

| Flag | File | Issue | Severity |
|------|------|-------|----------|
| [type] | [path:line] | [description] | [H/M/L] |

---

## 7. Security Findings

| Finding | File | Risk | Severity |
|---------|------|------|----------|
| [or "No security issues found"] | | | |

---

## 8. Pattern Compliance

| File | Pattern Check | Compliant? | Notes |
|------|--------------|-----------|-------|
| [path] | [what convention was checked] | [Y/N] | [deviation if N] |

---

## 9. Blast Radius

- **Other flows affected:** [list]
- **Solo/collab parity:** [both affected? only one?]
- **Admin surface:** [affected?]
- **Query keys involved:** [list]
- **Invariants violated:** [INV-IDs]
- **Recurring pattern?** [Is this a known pattern from recurring-patterns.md?]

---

## 10. Fix Strategy

[Direction only — what needs to change at each layer. NOT a spec.
NOT code. Just the architectural direction.]

- **Database:** [changes needed, or "none"]
- **Edge functions:** [changes needed, or "none"]
- **Services:** [changes needed, or "none"]
- **Hooks:** [changes needed, or "none"]
- **Components:** [changes needed, or "none"]

---

## 11. Regression Prevention Requirements

[What must be true to prevent this class of bug from recurring]

- **Structural safeguard:** [architecture change that makes recurrence impossible]
- **Test requirement:** [what test must exist]
- **Protective comment:** [what code comment explains the "why"]

---

## 12. Discoveries for Orchestrator

[Side issues found during investigation. Each gets registered as a new ORCH-ID.]

- **DISC-1:** [what, where, estimated severity, recommended action]
- **DISC-2:** [...]

[Or "None discovered."]

---

## 13. Recommended Next Step

[Exactly one: write spec | deeper investigation | escalate | defer]
[With reasoning]
```
