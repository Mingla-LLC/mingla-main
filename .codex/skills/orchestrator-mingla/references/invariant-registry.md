> Parity note: ported from `.claude/skills/mingla-orchestrator/references/invariant-registry.md` during META-ORCH-0755-B so Codex orchestrator can load the same invariant registry reference as Claude without touching `Mingla_Artifacts/INVARIANT_REGISTRY.md`.

# Invariant Registry — Mingla

Rules that must ALWAYS hold. Violation = architecture flaw, not just a bug.

---

## Data Integrity Invariants

| ID | Invariant | Layer | Enforcement |
|----|-----------|-------|-------------|
| INV-D01 | Every card in card_pool has at least one photo URL | DB + Edge | NOT NULL constraint + generation validation |
| INV-D02 | Every card_pool entry has city and country TEXT populated | DB | NOT NULL constraint + backfill migration |
| INV-D03 | Curated cards reference only active place_pool entries | DB | FK constraint + cascade deactivation |
| INV-D04 | Category slugs are the canonical format everywhere | DB + Code | SQL CASE normalization in query_pool_cards |
| INV-D05 | Exclusion rules apply identically in generation and serving | Edge | Shared exclusion logic, NOT EXISTS in both paths |
| INV-D06 | Impressions are scoped to session (reset on preference change) | Edge | preferences.updated_at comparison |
| INV-D07 | User phone numbers are E.164 format in DB | DB | Validation in send-otp edge function |
| INV-D08 | Every price surface shows real data or nothing (no fabrication) | Code | No fallback defaults for ratings, prices, times |
| INV-D09 | Paired saves are bidirectionally visible | DB + RLS | RLS policies on saves + pair relationship check |
| INV-D10 | Blocked users are completely mutually invisible | DB + RLS | Bidirectional block check in all visibility queries |

## State Management Invariants

| ID | Invariant | Layer | Enforcement |
|----|-----------|-------|-------------|
| INV-S01 | React Query is the sole authority for server-fetched data | Code | No Zustand stores holding API data |
| INV-S02 | Every mutation invalidates the correct query keys | Code | Key factory pattern + explicit invalidation |
| INV-S03 | Zustand holds only client-side state (page, UI flags, navigation) | Code | Architecture review |
| INV-S04 | AsyncStorage schema is versioned | Code | DECK_SCHEMA_VERSION + migration on mismatch |
| INV-S05 | Sign-out clears all caches, stores, subscriptions, tokens | Code | Centralized cleanup in sign-out flow |
| INV-S06 | Preferences → deck pipeline has no race condition | Code | No invalidateQueries; prefsHash matching |
| INV-S07 | Query keys contain ALL parameters that affect the result | Code | Key factory with all dependencies |
| INV-S08 | Optimistic updates rollback on mutation failure | Code | onError handlers on all state-changing mutations |

## Auth & Session Invariants

| ID | Invariant | Layer | Enforcement |
|----|-----------|-------|-------------|
| INV-A01 | Single auth instance — no competing session states | Code | Centralized useAuthSimple |
| INV-A02 | Token refresh is centralized and race-free | Code | Grace period + invalidateQueries on refresh |
| INV-A03 | 401 responses trigger refresh, not logout (within grace) | Code | 401 detector with grace period |
| INV-A04 | Every edge function validates auth (no unauthenticated access) | Edge | Auth check at function entry |
| INV-A05 | RLS policies exist on every table with user data | DB | Policy coverage audit |

## UI Invariants

| ID | Invariant | Layer | Enforcement |
|----|-----------|-------|-------------|
| INV-U01 | Every screen has loading, error, empty, and populated states | Code | Component state machine |
| INV-U02 | No dead taps — every interactive element responds | Code | No disabled-but-visible buttons without feedback |
| INV-U03 | Currency follows user locale everywhere | Code | User profile currency propagation |
| INV-U04 | Travel time uses user's configured travel mode | Code | effectiveTravelMode resolution |
| INV-U05 | Category labels are display names, not slugs, in UI | Code | EXPERIENCE_TYPE_LABELS mapping |
| INV-U06 | Icons resolve for all known types | Code | ICON_MAP completeness |

## Realtime & Notification Invariants

| ID | Invariant | Layer | Enforcement |
|----|-----------|-------|-------------|
| INV-R01 | Realtime subscriptions clean up on unmount | Code | useEffect cleanup |
| INV-R02 | Notifications respect user preference toggles | Edge | Preference check in notify-dispatch |
| INV-R03 | Quiet hours enforced (10 PM - 8 AM, DMs bypass) | Edge | Timezone-aware check |
| INV-R04 | Push tokens cleaned up after 30 days inactive | DB | Cron job |
| INV-R05 | Notification for deleted content doesn't crash | Code + Edge | Null-safe deep link handling |

## Pipeline Invariants

| ID | Invariant | Layer | Enforcement |
|----|-----------|-------|-------------|
| INV-P01 | No card-serving function touches Google/OpenAI directly | Edge | All card_pool-only serving |
| INV-P02 | AI validation is the sole quality gate for cards | Edge | No type-based SQL exclusion blocks |
| INV-P03 | Children's venues excluded across all 3 card pipelines | Edge | isChildVenueName() in all generators |
| INV-P04 | Per-category exclusions enforced at both generation and serve time | Edge + DB | category_type_exclusions table + NOT EXISTS |

---

## How to Use This Registry

1. **During investigation:** Check if the bug violates any invariant. If so, classify as invariant violation → automatic severity escalation.
2. **During spec:** List which invariants the fix must preserve. Add new invariants if the fix introduces a new rule that must always hold.
3. **During review:** Verify the implementation doesn't break any existing invariant.
4. **During testing:** Include invariant checks in the test matrix.
5. **When closing:** If a new invariant was established, add it here with enforcement mechanism.
