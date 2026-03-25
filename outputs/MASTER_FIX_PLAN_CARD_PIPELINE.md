# Master Fix Plan: Card Pipeline Hardening

**Date:** 2026-03-24 (updated)
**Mode:** PIPELINE (gated)
**Approach:** Truthfulness → preferences → save safety → collab → loading states → speed → generation

---

## Completed Passes

| Pass | Commit | What |
|------|--------|------|
| Pass 1 | `5702067b` | Kill the Lies — fabricated data, currency, hours, icons (11 files) |
| Exclusions | `0ae81113` | Kids venues, shuffle dedup, impressions (5 files) |
| Pass 2 | `79d0905b` | Preferences contract — race condition, stale batches, collab prefs (5 files) |
| Session Load | `3ee1bce9` | 11→6 queries, 3→1 phases (2 files) |
| Pass 3 | IN PROGRESS | Save rollback, schedule validation, dead code (6 files) — implemented, awaiting test |

---

## Remaining Passes

### Pass 4: Collab Mode Fixes (NEW — from log analysis)

**Theme:** Collaboration mode preferences→deck contract is broken. Session modal crashes on Android.

| # | Bug | Severity | Source |
|---|-----|----------|--------|
| C1 | Collab prefs change doesn't trigger session deck refresh | RED | iOS logs — no `generate-session-deck` after collab prefs close |
| C2 | Realtime subscription churns on every prefs open/close | ORANGE | iOS logs — subscribe/unsubscribe tied to PreferencesSheet lifecycle |
| C3 | Mode switch clears deck but doesn't fetch | ORANGE | iOS logs — `Solo mode selected` → batches cleared → dead moment |
| C4 | Session modal crashes/times out on Android | RED | Android logs — Realtime subscribes then immediately unsubscribes, 10s timeout fires every time |
| C5 | Expanded card always shows walking icon regardless of travelMode | ORANGE | Device testing — CardInfoSection ignores travelMode for icon |

### Pass 5: Loading & Error States

| # | Bug | Severity |
|---|-----|----------|
| A9 | ForYou tab no Retry button on error | ORANGE |
| A10 | SavedTab no error state for initial load failure | ORANGE |
| A11 | CalendarTab no loading state for initial data | ORANGE |
| A26 | ProfilePage locationError never rendered | GREEN |
| A27 | Two skeleton components are dead code | GREEN |
| E10 | No skeleton pills on mount (S2 Spec) | PERF |

### Pass 6: Visual Consistency Polish

| # | Bug | Severity |
|---|-----|----------|
| A18 | No haptic feedback on swipe | GREEN |
| A19 | 5 different category icon systems | GREEN |
| A21 | Rating star color varies across 5 hex values | GREEN |
| A23 | Unsplash stock photo fallback only on swipe deck | GREEN |
| A24 | Optional curated stops shown on SavedTab but filtered on deck | GREEN |
| A28 | isSaved hardcoded false — no "already saved" indicator | GREEN |

### Pass 7: Speed + Scoring (existing S1/S2 specs)

| # | Bug | Severity |
|---|-----|----------|
| E3 | Scoring ignores priceTier | ORANGE |
| E4 | matchFactors hardcoded | ORANGE |
| E5+E6 | 12→1 query consolidation + parallelize in discover-experiences | PERF |
| E7 | Duplicate useAuthSimple on tab switch (auth re-init) | PERF |
| E8 | No warmPing on boot | PERF |
| E9 | No client timeout on discoverExperiences | PERF |

### Pass 8: Generation Quality + Paired Latency (needs specs)

| # | Bug | Severity |
|---|-----|----------|
| E11 | Paired view radius expansion loop (latency) | PERF |
| E14 | Stop labels wrong when optional skipped | RED |
| E15 | Fine dining price floor dead code | RED |
| E16 | google_place_id collision (curated overwrites single) | RED |

---

## Cross-Cutting Issues (from logs, not yet assigned)

| # | Issue | Severity | Notes |
|---|-------|----------|-------|
| X1 | 20s safety timeout fires on first mount | ORANGE | RecommendationsContext never signals "complete" — likely architectural |
| X2 | Triple lifecycle mount on startup | YELLOW | `useLifecycleLogger mounted` 3× — component tree mounts 3 times |
| X3 | Auth re-init on every tab switch | ORANGE | Known E7 — duplicate useAuthSimple (Pass 7) |
| X4 | Android bundle time 68s vs iOS 5.6s | YELLOW | Dev build only — not a production issue but painful for testing |
| X5 | BusynessService has no GOOGLE_MAPS_API_KEY | YELLOW | Shows device-time busyness, not real data — config issue |

---

## Priority Recommendation

**Pass 4 (Collab) should come AFTER Pass 3 commits** because:
- C1 (no deck refresh) and C4 (Android crash) are RED — user-blocking
- C4 may share root cause with the session load optimization (our changes may have introduced the Android issue)
- Needs investigation before spec — the Android immediate-unsubscribe pattern suggests the modal unmounts instantly, possibly from an error our iOS test didn't catch
