# Invariant Checklist — Implementation Pre/Post Flight

Run this checklist BEFORE coding (to know what must hold) and AFTER coding (to verify
nothing broke). Mark each Y/N/NA.

---

## Pre-Flight: Which invariants does this change touch?

Scan the list. Mark "RELEVANT" for any invariant your change could affect.
For each RELEVANT invariant, verify it still holds after your changes.

---

## Data Integrity

| ID | Invariant | Relevant? | Still Holds? |
|----|-----------|-----------|-------------|
| INV-D01 | Every card in card_pool has at least one photo URL | | |
| INV-D02 | Every card_pool entry has city and country TEXT | | |
| INV-D03 | Curated cards reference only active place_pool entries | | |
| INV-D04 | Category slugs are canonical format everywhere | | |
| INV-D05 | Exclusion rules identical in generation AND serving | | |
| INV-D06 | Impressions scoped to session (reset on pref change) | | |
| INV-D07 | Phone numbers are E.164 in DB | | |
| INV-D08 | Every price surface shows real data or nothing | | |
| INV-D09 | Paired saves are bidirectionally visible | | |
| INV-D10 | Blocked users completely mutually invisible | | |

## State Management

| ID | Invariant | Relevant? | Still Holds? |
|----|-----------|-----------|-------------|
| INV-S01 | React Query is sole authority for server data | | |
| INV-S02 | Every mutation invalidates correct query keys | | |
| INV-S03 | Zustand holds only client-side state | | |
| INV-S04 | AsyncStorage schema is versioned | | |
| INV-S05 | Sign-out clears all caches, stores, subscriptions | | |
| INV-S06 | Preferences → deck pipeline has no race condition | | |
| INV-S07 | Query keys contain ALL result-affecting parameters | | |
| INV-S08 | Optimistic updates rollback on mutation failure | | |

## Auth & Session

| ID | Invariant | Relevant? | Still Holds? |
|----|-----------|-----------|-------------|
| INV-A01 | Single auth instance — no competing sessions | | |
| INV-A02 | Token refresh centralized and race-free | | |
| INV-A03 | 401 triggers refresh, not logout (within grace) | | |
| INV-A04 | Every edge function validates auth | | |
| INV-A05 | RLS policies on every table with user data | | |

## UI

| ID | Invariant | Relevant? | Still Holds? |
|----|-----------|-----------|-------------|
| INV-U01 | Every screen has loading/error/empty/populated states | | |
| INV-U02 | No dead taps — every element responds | | |
| INV-U03 | Currency follows user locale everywhere | | |
| INV-U04 | Travel time uses user's travel mode | | |
| INV-U05 | Category labels are display names in UI (not slugs) | | |
| INV-U06 | Icons resolve for all known types | | |

## Realtime & Notifications

| ID | Invariant | Relevant? | Still Holds? |
|----|-----------|-----------|-------------|
| INV-R01 | Realtime subscriptions clean up on unmount | | |
| INV-R02 | Notifications respect user preference toggles | | |
| INV-R03 | Quiet hours enforced (10 PM - 8 AM) | | |
| INV-R04 | Push tokens cleaned after 30 days inactive | | |
| INV-R05 | Notification for deleted content doesn't crash | | |

## Pipeline

| ID | Invariant | Relevant? | Still Holds? |
|----|-----------|-----------|-------------|
| INV-P01 | No card-serving function touches Google/OpenAI | | |
| INV-P02 | AI validation is sole quality gate for cards | | |
| INV-P03 | Children's venues excluded across all 3 pipelines | | |
| INV-P04 | Per-category exclusions enforced at generation + serve | | |

---

## How to Fill This Out

**Pre-flight:**
1. Read through all invariants
2. Mark RELEVANT for any your change could possibly affect
3. For RELEVANT ones, note the current enforcement mechanism
4. This becomes your "must not break" list

**Post-flight:**
1. For each RELEVANT invariant, verify your changes preserve it
2. Mark Y (still holds), N (broken — STOP AND FIX), or UNVERIFIED (needs manual testing)
3. Include the filled checklist in your implementation report
4. Any N → this is a blocker. Fix before reporting success.
