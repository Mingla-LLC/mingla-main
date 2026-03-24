# Full-Sweep Plan: Card Pipeline Hardening

**Date:** 2026-03-24
**Mode:** FULL-SWEEP
**Scope:** Preferences → deck → discover (solo+collab) → paired view → save → schedule → card rendering → loading states

---

## Inventory: What Exists vs What's Missing

### Ready for Implementation (Specs Written)

| # | Spec | Fixes | Status |
|---|------|-------|--------|
| S1 | FIX_PREFERENCES_DECK_CONTRACT_SPEC.md | 3 gaps: collab prefs wiring, scoring priceTier, matchFactors | Approved spec, awaiting implementation |
| S2 | FIX_DISCOVER_FORYU_SPEED_SPEC.md | 6 changes: consolidate queries, parallelize, remove dupe auth, warmPing, timeout, skeleton | Approved spec, awaiting implementation |

### Investigated But Needs Spec

| # | Investigation | Key Bugs | Status |
|---|--------------|----------|--------|
| I1 | INVESTIGATION_PAIRED_HOLIDAY_CARD_LATENCY.md | Radius expansion loop (6-12 sequential queries), sequential Phase B→C, impression upsert blocking | Root causes proven, fix recommendations clear |
| I2 | INVESTIGATION_SAVE_SCHEDULE_REVIEW_CURATED.md | BUG 5 (fire-and-forget save), BUG 6 (default noop), BUG 7 (review=single-place), BUG 8 (dual IDs) | Forensic complete, needs bounded fix spec |
| I3 | INVESTIGATION_CURATED_CARD_STOPS.md | BUG 1 (stop labels wrong), BUG 2 (fine dining dead code), BUG 3 (google_place_id collision) | Forensic complete, needs bounded fix spec |

### New Finding (User-Reported, Root Cause Proven)

| # | Issue | Root Cause | Status |
|---|-------|-----------|--------|
| N1 | Preferences race condition — stale cards after PreferencesSheet change | Line 866 `invalidateQueries(["userPreferences"])` triggers server refetch that races fire-and-forget DB write. Server returns OLD prefs, overwrites optimistic cache. | Root cause proven from logs. Fix: remove lines 863-866. Needs spec. |

### Not Yet Investigated (User's Expanded Scope)

| # | Area | What Needs Checking |
|---|------|-------------------|
| U1 | Card data/icons consistency | Do single cards and curated cards show correct icons, labels, price display, ratings, hours across ALL surfaces (deck, saved, calendar, expanded, paired view)? |
| U2 | Loading states everywhere | Every page, screen, and modal: is there a proper skeleton/loading state? Does it match the populated layout? Flash of empty? |
| U3 | Save from all entry points | Deck swipe, expanded card button, paired view — do all paths save correctly? Cache invalidation? Toast feedback? |
| U4 | Schedule from all entry points | Saved tab, expanded card, paired view — do all paths schedule correctly? Calendar sync? Confirmation flow? |
| U5 | Logical consistency | Do card categories, prices, hours, travel times, icons all make sense together? Are there nonsensical combinations? |

---

## Prioritized Work Streams

### Priority Order (by user impact × fix difficulty)

**Stream A: The Stale Data Cluster (HIGH impact, MEDIUM difficulty)**
- N1: Preferences race condition (stale cards after pref change)
- S1: Preferences → deck contract gaps (collab prefs, scoring, matchFactors)
- These are the "I see cards I didn't select" bugs. Most user-visible.

**Stream B: Speed & Responsiveness (HIGH impact, MEDIUM difficulty)**
- S2: Discover "For You" sub-1s response
- I1: Paired holiday card latency (radius loop)
- These are the "why is it so slow" bugs.

**Stream C: Save/Schedule Integrity (HIGH impact, HIGH difficulty)**
- I2 BUG 5: Fire-and-forget save (silent data loss)
- I2 BUG 8: Dual ID problem (duplicate saves, broken dedup)
- I2 BUG 6: Default noop save handler (latent bomb)
- I2 BUG 7: Review treats curated as single-place (analytics corruption)
- These are the "I saved it but it's not there" bugs.

**Stream D: Generation Quality (MEDIUM impact, LOW difficulty)**
- I3 BUG 1: Stop labels wrong when optional stops skipped
- I3 BUG 2: Fine dining price floor dead code
- I3 BUG 3: google_place_id collision (curated overwrites single)
- These are data quality issues in card generation.

**Stream E: Full-Surface Audit (MEDIUM impact, requires investigation)**
- U1-U5: Card rendering consistency, loading states, save/schedule from all entry points, logical consistency
- This requires a new deep investigation before any spec can be written.

---

## Proposed Execution Plan

### Pass 1: Stale Data Fix (3 fixes)
1. N1 — Remove destructive `invalidateQueries` from PreferencesSheet (the race condition)
2. S1 Gap 1 — Wire collab aggregated prefs into useDeckCards
3. S1 Gap 2 — Add priceTierMatch to scoring service

**Why first:** These are the bugs you FEEL every time you change preferences. Most user-visible, most trust-damaging.

### Pass 2: Stale Data + Speed (3-4 fixes)
4. S1 Gap 3 — Wire real scoringFactors into matchFactors
5. S2 Changes 1+2 — Edge function: consolidate 12 queries → 1, parallelize awaits
6. S2 Changes 3+4 — Client: remove duplicate auth, add warmPing

**Why second:** Completes the preferences contract, then tackles the biggest speed win (server-side).

### Pass 3: Speed + Timeout (3 fixes)
7. S2 Change 5 — Client-side 10s timeout
8. S2 Change 6 — Skeleton pills on mount
9. I1 P0 — Replace radius expansion loop with single indexed query (paired view)

**Why third:** Finishes the speed work. Paired view latency fix needs a new migration spec first.

### Pass 4: Save/Schedule Integrity (3-4 fixes)
10. I2 BUG 5 — Await the save, show error on failure
11. I2 BUG 8 — Stabilize curated card IDs (single canonical ID)
12. I2 BUG 6 — Remove default noop handler (or make it impossible)

**Why fourth:** Save integrity is critical but less immediately visible than stale data.

### Pass 5: Generation Quality (3 fixes)
13. I3 BUG 1 — Fix stop labels (use actual stop count)
14. I3 BUG 2 — Add `return false` to fine dining price floor
15. I3 BUG 3 — Synthetic google_place_id for curated cards

**Why fifth:** Generation quality affects new cards, not existing ones. Lower urgency.

### Pass 6: Review Flow + Full-Surface Investigation
16. I2 BUG 7 — Multi-stop review redesign (needs its own spec — schema change)
17. Launch investigation for U1-U5 (card rendering, loading states, save/schedule everywhere)

**Why last:** BUG 7 is a schema-level redesign (complex, can't rush). U1-U5 needs fresh investigation.

---

## Gate Discipline Per Pass

Every pass follows: **spec → user approval → implement → test → review → commit → tracker update**

- Passes 1-3 already have specs (S1, S2) or proven root causes (N1, I1). Spec gate is fast.
- Passes 4-5 have investigations done. Need bounded fix specs written first.
- Pass 6 needs new investigation before anything else.

---

## Constitution Compliance Check

| Principle | How This Plan Obeys It |
|-----------|----------------------|
| 1. No dead taps | Skeleton pills (Pass 3), await saves (Pass 4), remove noop handler (Pass 4) |
| 2. One owner per truth | Remove duplicate auth (Pass 2), remove destructive invalidation (Pass 1) |
| 3. Narrow fix first | Each pass is 3-4 fixes, smallest blast radius |
| 5. Server state stays server-side | Remove custom cache reliance (Pass 2), React Query as truth |
| 8. Subtract before adding | Remove invalidateQueries (Pass 1), remove duplicate auth (Pass 2), remove dead code (Pass 5) |

---

## What I Need From You

1. **Priority confirmation:** Do you agree with the pass ordering (stale data → speed → save integrity → generation → review)?
2. **Scope confirmation:** Stream E (full-surface audit, U1-U5) is a separate investigation. Should I write that investigation prompt now, or after Passes 1-5?
3. **Starting point:** Should we start with Pass 1 (the preferences race condition + collab wiring + scoring)?
