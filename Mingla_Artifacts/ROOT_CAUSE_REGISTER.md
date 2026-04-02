# Root Cause Register

> Last updated: 2026-03-30
> Proven root causes with causal clusters.

## Root Causes

### RC-001: Duplicate State Authorities
- **Discovery date:** 2026-03-23
- **Proof:** Query key consolidation audit, Zustand field removal
- **Symptoms caused:** ORCH-0205 (query key drift), stale cache after mutations, ghost data
- **Causal chain:** Multiple query keys for same entity → invalidation misses one → stale data displayed
- **Structural fix:** One factory per entity, dead Zustand fields removed
- **Status:** Fixed
- **Invariant:** INV-S02, INV-S07

### RC-002: Silent Error Swallowing
- **Discovery date:** 2026-03-23
- **Proof:** 16 mutations without onError, 7 silent catches
- **Symptoms caused:** ORCH-0206, user actions appearing to succeed but failing silently
- **Causal chain:** try/catch without throw or toast → user sees no feedback → data inconsistency
- **Structural fix:** onError on all mutations, withTimeout wrappers, mutation error toast utility
- **Status:** Partially fixed (50+ remaining non-state-changing silent catches documented)
- **Invariant:** Constitutional #3 (no silent failures)

### RC-003: Fabricated Data on Card Surfaces
- **Discovery date:** 2026-03-24
- **Proof:** INVESTIGATION_FULL_CARD_PIPELINE_AUDIT.md Pass 1
- **Symptoms caused:** Fake ratings, hardcoded travel times, wrong currency symbols
- **Causal chain:** Fallback defaults used instead of real data → user sees plausible but false information
- **Structural fix:** All fallbacks removed, real data or nothing shown
- **Status:** Fixed
- **Invariant:** INV-D08, Constitutional #9

### RC-004: Race Condition in Preferences-to-Deck Pipeline
- **Discovery date:** 2026-03-24
- **Proof:** Commit 79d0905b, TEST_PASS2.md
- **Symptoms caused:** ORCH-0064, stale deck after preference change, cards from old preferences appearing
- **Causal chain:** invalidateQueries after preference save → batch fetch starts before cache clear → old params used
- **Structural fix:** invalidateQueries removed, prefsHash matching gates batch acceptance
- **Status:** Fixed
- **Invariant:** INV-S06

### RC-005: Error-Swallowing Multi-Step Operations
- **Discovery date:** 2026-03-22
- **Proof:** Commit 23f3a0dd (unpair flow)
- **Symptoms caused:** ORCH-0177, partial unpair leaving orphaned data
- **Causal chain:** 3-step sequential code with try/catch per step → step 2 fails → steps 1 and 3 succeed → inconsistent state
- **Structural fix:** Atomic RPC replaces multi-step client code
- **Status:** Fixed for unpair. Pattern likely exists elsewhere (unaudited).

## Recurring Patterns

| Pattern | Occurrences | Examples | Structural Fix | Status |
|---------|------------|----------|----------------|--------|
| Query-key drift | 8+ | ORCH-0205 (3 saved, 2 person, 2 blocked) | Key factory discipline | Fixed |
| Silent catch swallowing | 50+ | ORCH-0206 (16 mutations fixed) | onError + mutationErrorToast | Partially fixed |
| Fabricated fallback data | 10 surfaces | ORCH-0061 (ratings, prices, times) | Remove all fallbacks | Fixed |
| Duplicate state owners | 3 | Zustand prefs, Zustand blocked, old query keys | Single authority map | Fixed |
| Multi-step client mutation | Unknown | Unpair (fixed), other flows unaudited | Atomic RPCs | Partially fixed |

## Causal Clusters

### Cluster 1: "Card Data Truthfulness" (RESOLVED)
Root cause: RC-003. 10+ symptoms across card rendering, pricing, ratings, travel times.
All resolved in Card Pipeline Audit Passes 1-5.

### Cluster 2: "State Consistency" (PARTIALLY RESOLVED)
Root causes: RC-001 + RC-002 + RC-004. Query key drift + silent failures + race conditions.
Key factory fixed. Mutation errors partially addressed. Unknown extent in unaudited surfaces.

### Cluster 3: "Security Layer" (UNAUDITED)
Potential root cause: Missing or inconsistent RLS policies, unvalidated edge functions.
No investigation started. ORCH-0223, 0224, 0225, 0226 all at F.
