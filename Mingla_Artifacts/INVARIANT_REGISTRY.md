# Invariant Registry

> Last updated: 2026-04-17 (ORCH-0474 closed — INV-042 + INV-043 locked in)
> Source: Mingla Orchestrator skill references

## Architecture / Response-Shape Invariants

| ID | Invariant | Layer | Enforcement | Status |
|----|-----------|-------|-------------|--------|
| **INV-042** | No edge-function response may conflate runtime failures with data-absence signals. Runtime errors (auth, exceptions, timeouts) and data signals (empty pool, filtered to zero) must use mutually-exclusive `path` values. A client that cannot distinguish "server crashed" from "no data" cannot implement correct retry/recovery UX. | Edge function | Per-path explicit `return` branches in `discover-cards/index.ts` (`auth-required` / `pool-empty` / `pipeline-error` / `pipeline`). Protective comment at `pool-empty` return prohibits fall-through additions. Tester T-06 runtime-verified the response shape. | **Enforced (ORCH-0474, 2026-04-17, QA cycle 1 PASS)** |
| **INV-043** | Every edge-function code path must `return` explicitly. No unconditional fall-throughs that hide which upstream branch is responsible. If a new exit condition is added, it must have its own explicit `return` with a unique `sourceBreakdown.path` value. | Edge function | Structural comment at `discover-cards/index.ts` file header names INV-043 and ORCH-0474. Current deployed code (v118) has zero fall-throughs — every exit returns. | **Enforced (ORCH-0474, 2026-04-17, QA cycle 1 PASS)** |

## Data Integrity Invariants

| ID | Invariant | Layer | Enforcement | Status |
|----|-----------|-------|-------------|--------|
| **I-EMPTY-CACHE-NONPERSIST** | `deck-cards` React Query responses with `cards.length === 0` MUST NOT be dehydrated to AsyncStorage. `staleTime: Infinity` is only safe because of this guard. Pairing Infinity staleTime + persistence + response-can-be-empty without the guard produces permanent warm-session cache poisoning. Extended by ORCH-0474 to cover all four non-populated paths (pool-empty, filtered pipeline, auth-required, pipeline-error). | App root + Hook | `shouldDehydrateQuery` at `app-mobile/app/index.tsx:2968-2983`; protective comment at `app-mobile/src/hooks/useDeckCards.ts:165-174` | Enforced (ORCH-0469 2026-04-17; ORCH-0474 coverage extension 2026-04-17) |
| INV-D01 | Every card in card_pool has at least one photo URL | DB + Edge | NOT NULL + validation | Enforced |
| INV-D02 | Every card_pool entry has city and country TEXT populated | DB | NOT NULL + backfill migration | Enforced (Commit 5db8dbe8) |
| INV-D03 | Curated cards reference only active place_pool entries | DB | FK + cascade deactivation | Enforced |
| INV-D04 | Category slugs are canonical format everywhere | DB + Code | SQL CASE normalization (26 branches) | Enforced (Commit 6c7b2429) |
| INV-D05 | Exclusion rules apply identically in generation and serving | Edge | Shared exclusion logic, NOT EXISTS | Enforced (Commits 984f8be7, a408e1b1) |
| INV-D06 | Impressions scoped to session (reset on preference change) | Edge | preferences.updated_at comparison | Enforced |
| INV-D07 | User phone numbers are E.164 format in DB | DB | Validation in send-otp | Enforced |
| INV-D08 | Every price surface shows real data or nothing | Code | No fallback defaults | Enforced (Pass 1 + Constitution) |
| INV-D09 | Paired saves are bidirectionally visible | DB + RLS | RLS policies | UNVERIFIED |
| INV-D10 | Blocked users are completely mutually invisible | DB + RLS | Bidirectional block check | UNVERIFIED |

## State Management Invariants

| ID | Invariant | Layer | Enforcement | Status |
|----|-----------|-------|-------------|--------|
| INV-S01 | React Query is sole authority for server-fetched data | Code | No Zustand stores holding API data | Enforced |
| INV-S02 | Every mutation invalidates correct query keys | Code | Key factory + explicit invalidation | Enforced (Commit 846e7cce) |
| INV-S03 | Zustand holds only client-side state | Code | Architecture review | Enforced |
| INV-S04 | AsyncStorage schema is versioned | Code | DECK_SCHEMA_VERSION + migration | UNVERIFIED |
| INV-S05 | Sign-out clears all caches, stores, subscriptions, tokens | Code | Centralized cleanup | UNVERIFIED (ORCH-0004) |
| INV-S06 | Preferences to deck pipeline has no race condition | Code | No invalidateQueries; prefsHash matching | Enforced (Commit 79d0905b) |
| INV-S07 | Query keys contain ALL parameters that affect result | Code | Key factory with all dependencies | Enforced (Commit 846e7cce) |
| INV-S08 | Optimistic updates rollback on mutation failure | Code | onError handlers | Partial (16 mutations covered) |

### I-PROGRESSIVE-DELIVERY-INTERLEAVE-AUTHORITATIVE

**Established:** 2026-04-18 (ORCH-0503 v3)
**Location:** `RecommendationsContext.tsx` sync-effect flag-on `batchSeed === 0` branch

**Statement:** When the provider's deck-sync effect processes a non-placeholder
`deckCards` array whose ID set is a strict superset of the accumulated prior ID
set (including the equal-cardinality and growing-cardinality sub-cases), it
MUST adopt `deckCards` verbatim as the new `recommendations` /
`accumulatedCardsRef`. Prev-preserving merge fallbacks (e.g.,
`[...prev, ...toAppend]`) are INVALID in this branch because React Query
collapses partial-2 and queryFn-resolve notifications under React 18 batching —
cardinality alone cannot distinguish mid-partial growth from final-interleave
arrival.

**Preserved by:**
- `const merged = deckCards` inside the strict-superset branch (single-line adoption)
- `__DEV__` runtime guard comparing `merged[0..3]` to `deckCards[0..3]`
- Grep invariant: `grep '\[\.\.\.prev, \.\.\.toAppend\]' RecommendationsContext.tsx` → 0 matches

**Verified by:** SC-0503v3-02 (device), SC-0503v3-09 (structural grep), SC-0503v3-11 (dev runtime guard present)
**Closed ORCH-ID:** ORCH-0503
**Related:** I-PROGRESSIVE-DELIVERY-EXPANSION-NOT-REPLACEMENT (ORCH-0498)

## Auth & Session Invariants

| ID | Invariant | Layer | Enforcement | Status |
|----|-----------|-------|-------------|--------|
| INV-A01 | Single auth instance | Code | Centralized useAuthSimple | Enforced |
| INV-A02 | Token refresh is centralized and race-free | Code | Grace period + invalidateQueries | Enforced (Commit aa9cfd68) |
| INV-A03 | 401 responses trigger refresh, not logout (within grace) | Code | 401 detector with grace period | Enforced |
| INV-A04 | Every edge function validates auth | Edge | Auth check at function entry | UNVERIFIED |
| INV-A05 | RLS policies exist on every table with user data | DB | Policy coverage audit | UNVERIFIED (ORCH-0223) |

## UI Invariants

| ID | Invariant | Layer | Enforcement | Status |
|----|-----------|-------|-------------|--------|
| INV-U01 | Every screen has loading, error, empty, populated states | Code | Component state machine | Partial |
| INV-U02 | No dead taps | Code | No disabled-but-visible buttons | UNVERIFIED |
| INV-U03 | Currency follows user locale everywhere | Code | User profile currency propagation | Enforced (Pass 1) |
| INV-U04 | Travel time uses user's configured travel mode | Code | effectiveTravelMode resolution | Enforced |
| INV-U05 | Category labels are display names, not slugs | Code | EXPERIENCE_TYPE_LABELS mapping | Enforced |
| INV-U06 | Icons resolve for all known types | Code | ICON_MAP completeness | Enforced (Commit 88f2d43f) |

## Realtime & Notification Invariants

| ID | Invariant | Layer | Enforcement | Status |
|----|-----------|-------|-------------|--------|
| INV-R01 | Realtime subscriptions clean up on unmount | Code | useEffect cleanup | Enforced (Commit ea655d36) |
| INV-R02 | Notifications respect user preference toggles | Edge | Preference check in dispatch | Enforced |
| INV-R03 | Quiet hours enforced (10 PM - 8 AM, DMs bypass) | Edge | Timezone-aware check | UNVERIFIED |
| INV-R04 | Push tokens cleaned up after 30 days inactive | DB | Cron job | UNVERIFIED |
| INV-R05 | Notification for deleted content doesn't crash | Code + Edge | Null-safe handling | UNVERIFIED (ORCH-0089) |

## Pipeline Invariants

| ID | Invariant | Layer | Enforcement | Status |
|----|-----------|-------|-------------|--------|
| INV-P01 | No card-serving function touches Google/OpenAI directly | Edge | All card_pool-only serving | Enforced |
| INV-P02 | AI validation is the sole quality gate for cards | Edge | No type-based SQL exclusion | Enforced (Commits c9708465, 97a5dfd0) |
| INV-P03 | Children's venues excluded across all 3 card pipelines | Edge | isChildVenueName() in all generators | Enforced |
| INV-P04 | Per-category exclusions at both generation and serve time | Edge + DB | category_type_exclusions + NOT EXISTS | Enforced |

## Invariant Status Summary

| Status | Count |
|--------|-------|
| Enforced (with evidence) | 24 |
| Partial | 2 |
| UNVERIFIED | 10 |

Unverified invariants represent latent risk. Each maps to an open ORCH issue.
