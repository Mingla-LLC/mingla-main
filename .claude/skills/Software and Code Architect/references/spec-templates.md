# Spec Templates Reference

## Table of Contents
1. Bug-Mode Spec Template (FIX_*.md)
2. Feature-Mode Spec Template (FEATURE_*.md)
3. Migration Plan Template
4. Verification Queries Template
5. Architecture Document Update Process

---

## 1. Bug-Mode Spec Template

Save as `FIX_[ISSUE_NAME]_SPEC.md`. Use this EXACT structure:

```markdown
# Fix: [Name]
**Date:** [today]
**Status:** Planned
**Mode:** Investigation + Fix
**Reported symptom:** [exact user complaint]

---

## 1. Forensic Context

### What Was Reported
[Exact symptom in user's words]

### Investigation Summary
**Truth layers inspected:** Docs ✅ Schema ✅ Code ✅ Runtime ✅ Data ✅
**Files read:** [N]
**Root cause(s):** [one-sentence summary per root cause]
**Contributing factors:** [count]
**Hidden flaws found:** [count]

### Root Cause Analysis

#### 🔴 RC-001: [Title]
**Fact:** `path/to/file.ts` line [N] does [X]
**Inference:** This causes [Y] because [Z]
**Impact:** User sees [symptom]
**Defective code:**
```typescript
// exact broken code
```
**What it should do:** [correct behavior]
**Causal chain:**
1. [defect occurs]
2. [downstream effect]
3. [downstream effect]
4. [user sees symptom]
**Invariant violated:** "[the rule that should hold but doesn't]"
**Enforced by:** [what should enforce it — FK constraint / RLS / CHECK / app code]
**Verification:** [exact action — "change X to Y, symptom resolves"]

[Repeat for each root cause]

#### 🟠 Contributing Factors
| ID | File | Line | Fact | Inference | Impact |
|----|------|------|------|-----------|--------|
| CF-001 | `path` | N | [what exists] | [why fragile] | [what can break] |

#### 🟡 Hidden Flaws
| ID | File | Line | Fact | Inference | Future Risk |
|----|------|------|------|-----------|-------------|
| HF-001 | `path` | N | [what exists] | [what will drift] | [what breaks] |

#### 🔵 Observations
| ID | File | Note |
|----|------|------|
| OB-001 | `path` | [what noticed and why] |

### Invariants That Must Hold After Fix
1. [Named invariant + what enforces it]
2. [Named invariant + what enforces it]

### What NOT to Change
[Areas that look suspicious but are correct. Implementor leaves these alone.]

---

## 2. Summary
[One paragraph. What is being fixed, why, core approach. Facts only.]

## 3. Design Principle
[One sentence governing rule. Example: "Curated cards are derived artifacts — they can always
be rebuilt from source." Resolves ambiguous implementation decisions.]

## 4. Source of Truth Definition
| Entity | Source of Truth | Derived From | Cacheable? | Rebuildable? |
|--------|----------------|-------------|------------|-------------|
| [entity] | [table/API] | [source] | [yes/no, TTL] | [yes/no] |

## 5. Success Criteria
1. [Specific, testable — exact input, output, behavior]
2. ...

## 6. Non-Goals
1. [What this spec deliberately does NOT do]
2. ...

---

## 7. Database Changes
### 7.1 New Tables
```sql
-- Exact SQL or "None"
```
### 7.2 Modified Tables
```sql
-- Exact ALTER or "None"
```
### 7.3 RLS Policy Summary
| Table | Policy | Operation | Rule |
|-------|--------|-----------|------|
### 7.4 Data Integrity Guarantees
| Invariant | Enforced By | Layer |
|-----------|------------|-------|
| [rule] | [FK / RLS / CHECK / unique / app code] | [schema/code] |

---

## 8. Edge Functions
### 8.1 [Function Name]
**File path:** `supabase/functions/[name]/index.ts`
**Method:** POST/GET | **Auth:** Required/Not | **Idempotent:** Yes/No
**Purpose:** [one sentence]
**Request body:**
```typescript
interface RequestBody { ... }
```
**Success (200):**
```typescript
interface SuccessResponse { ... }
```
**Error responses:**
| Status | Condition | Body |
|--------|-----------|------|
| 400 | [validation] | `{ error: "msg" }` |
| 401 | No JWT | `{ error: "Unauthorized" }` |
| 500 | [API fail] | `{ error: "msg" }` |
**Logic (exact order):** 1. ... 2. ... 3. ...
**Failure handling:**
| Failure | Response | Side Effects |
|---------|----------|-------------|

---

## 9. Mobile Implementation
### 9.1 New Files
[Exact paths, purposes, exports, types, signatures, query keys, staleTime + justification,
invalidation strategy. Components: four states (loading/error/empty/success), interactions
with haptics, StyleSheet.create().]
### 9.2 Files to Modify
[Exact path, location, change, why.]
### 9.3 State Classification
| State | Source of Truth | Derived? | Cached? | Where Stored |
|-------|----------------|----------|---------|-------------|

---

## 10. Migration Plan
[See Migration Plan Template below]

## 11. Implementation Order
**Step 1:** [command — what to do, how to verify]
**Step 2:** ...
**Step N:** Integration test — [exact user flow]

## 12. Test Cases
| # | Test | Input | Expected | Layer |
|---|------|-------|----------|-------|
Include: happy path, null input, duplicate, concurrent write, API failure, wrong user, rollback.

## 13. Verification Queries
[See Verification Queries Template below]

## 14. Common Mistakes to Avoid
1. **[Mistake]:** → **Correct:** [what to do]

## 15. Handoff to Implementor
Implementor: this is your single source of truth. §3 is the design principle — refer to it for
ambiguous decisions. §4 defines what is authoritative vs derived — never confuse them. §1
contains the forensic diagnosis — read it to understand WHY. Execute in order from §11. Do not
skip, reorder, or expand scope. Produce IMPLEMENTATION_REPORT.md referencing each section, hand
to tester. Not done until tester's report is green.
```

---

## 2. Feature-Mode Spec Template

Same as bug-mode but: skip §1 (Forensic Context), start at §2 (Summary). All other sections
identical. Save as `FEATURE_[FEATURE_NAME]_SPEC.md`.

---

## 3. Migration Plan Template

Every spec with database changes must include this:

```markdown
## Migration Plan

### Forward Migration
1. **Create** — exact SQL from §7 (run as migration file, not direct ALTER)
2. **Backfill** — exact SQL to populate existing data if needed
3. **Dual-read window** — can old and new schemas coexist? For how long?
4. **Validate** — exact SQL verification queries confirming migration succeeded
5. **Cleanup** — remove old columns/tables ONLY after validation passes

### Rollback Plan
- What happens if migration fails halfway?
- How to restore reads to old schema?
- Is the backfill reversible?
- Can old and new code coexist during rollback window?

### Data Safety
- Is this migration destructive? (DROP COLUMN, ALTER TYPE, DELETE rows)
- If destructive, what backup step is required before execution?
- If non-destructive, confirm: old code can still read/write safely?
```

---

## 4. Verification Queries Template

Every spec must include SQL queries that prove correctness after deploy:

```markdown
## Verification Queries

### Integrity Checks
```sql
-- No orphaned references
SELECT child.id FROM child_table child
LEFT JOIN parent_table parent ON child.parent_id = parent.id
WHERE parent.id IS NULL;
-- Expected: 0 rows

-- Invariant holds: [name the invariant]
SELECT * FROM table WHERE [invariant_violation_condition];
-- Expected: 0 rows
```

### Data Quality Checks
```sql
-- Row counts match expectations
SELECT COUNT(*) FROM table;
-- Expected: [N] or within [range]

-- No duplicates on unique business key
SELECT business_key, COUNT(*) FROM table
GROUP BY business_key HAVING COUNT(*) > 1;
-- Expected: 0 rows

-- No nulls in required fields
SELECT COUNT(*) FROM table WHERE required_field IS NULL;
-- Expected: 0
```

### Runtime Behavior Checks
- [ ] Endpoint returns 200 with valid input
- [ ] Endpoint returns 401 without auth
- [ ] Endpoint returns 400 with invalid input
- [ ] Component renders loading → success transition
- [ ] Component renders error state on API failure
- [ ] Cache invalidates after mutation
```

---

## 5. Architecture Document Update Process

When user confirms a feature is implemented:

1. Confirm which feature and what changed (or infer from context).
2. Update `full_scope_architecture.md`:
   - §22 (Edge Functions) — add new functions with signatures
   - §23 (Database Schema) — add new tables, columns, constraints
   - §29 (Component Inventory) — add new components with purpose
   - §30 (Service Inventory) — add new services with exports
   - §31 (Hook Inventory) — add new hooks with query keys
   - Update relevant flow diagrams
3. Update File Size Breakdown appendix (new files + line estimates).
4. Add changelog entry:
```markdown
| Date | Feature | Status |
|------|---------|--------|
| YYYY-MM-DD | Feature Name | Implemented |
```
5. Present updated architecture file using `present_files`.