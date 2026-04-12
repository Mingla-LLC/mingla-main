# Orchestrator Assessment: Zombie Promise Errors on Background Resume

**Date:** 2026-04-11
**Related:** ORCH-0366 (closed — edge timeout optimization), ORCH-0240 (closed — foreground refresh), ORCH-0385 (closed — map avatars after background)
**Trigger:** User-reported log errors during normal usage

---

## Plain English: What's Happening

When you leave the Mingla app for more than ~30 seconds and come back, you see scary-looking errors in the console — "Failed to send a request to the Edge Function" with 275-second timeouts, and "Network request timed out" for blocked users.

**What's actually going on:** While the app was asleep, the phone's operating system killed all its internet connections (this is normal — iOS and Android do this to save battery). But the app had already sent some requests before going to sleep. Those requests are now "zombies" — the phone killed their connection, but the app doesn't know that yet. When you come back, the app discovers those zombie requests are dead, logs the errors, and then the resume system kicks in and sends fresh requests that work perfectly.

**The 275-second number is misleading.** The request didn't actually take 275 seconds. It just measures wall-clock time from when the request started to when the error showed up — which includes all the time the phone was asleep doing nothing.

**The RevenueCat and AppsFlyer warnings are noise** — not errors at all. RevenueCat is just saying "hey, your package names don't match my magic naming convention" (they don't need to). AppsFlyer is just saying it tried to send install data before your code was ready to listen (harmless race condition).

---

## Will a Fix Introduce Regressions?

**Honest answer: the risk is low but real, and here's exactly why.**

### What a fix would look like

The fix would add an AbortController that cancels in-flight network requests when the app goes to background. When the app resumes, fresh requests fire (this already happens). The zombie errors disappear because the old requests are explicitly cancelled instead of left to die.

### Where regressions could hide

1. **Request cancellation timing.** If the AbortController fires too aggressively (e.g., on a brief screen lock or notification shade pull-down), it could cancel requests that would have completed. The current code already distinguishes "trivial" (<5s), "short" (5-30s), and "long" (30s+) backgrounds. The cancel must respect these same thresholds — only cancel on transitions that trigger re-fetches.

2. **Shared AbortController scope.** The Supabase client uses a single global `fetchWithTimeout`. If we add background cancellation at that level, it could abort non-query requests (auth refresh, realtime heartbeats, edge function calls from OTHER hooks). The AbortController must be scoped to the specific query batches, not global.

3. **React Query retry interaction.** React Query retries failed queries once (configured in `queryClient.ts`). If we abort a request, React Query sees a failure and retries — but the resume handler ALSO fires a fresh request. This could cause double-fetching. The abort must be paired with query cancellation (`queryClient.cancelQueries`) so React Query doesn't auto-retry the aborted request.

4. **The useForegroundRefresh singleton invariant.** There's an explicit comment: "This hook must be instantiated EXACTLY ONCE." Any fix must live inside or coordinate with this hook — adding cancellation logic elsewhere risks the "double handler" problem that was already fixed once (ORCH-0236).

### My honest assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Cancel too aggressively (kills valid requests) | Low | Medium | Respect existing background duration thresholds |
| Double-fetch on resume (abort retry + fresh invalidation) | Medium | Low | Use `queryClient.cancelQueries` alongside abort |
| Break auth refresh during background transition | Low | High | Scope abort to content queries only, not auth |
| Break singleton invariant | Very Low | High | All logic stays inside useForegroundRefresh |

**Net regression risk: LOW.** The fix is well-scoped, the existing code already has clean background/foreground lifecycle hooks, and the thresholds are well-defined. But it touches the network layer, which means it must be tested with real background/foreground cycles, not just unit tests.

---

## Do We Even Need to Fix This?

**The system self-heals.** Your logs prove it: zombie errors fire, resume handler kicks in, fresh data loads in 2-4 seconds. Users get their 30 curated cards + 20 singles perfectly.

**What the user actually experiences:**
- A brief flash (1-3 seconds) where cards might show empty before fresh data arrives
- If React Query has cached data from before backgrounding, the user may not even see the flash

**What it costs to NOT fix:**
- Log noise (confusing for debugging, could pollute Sentry)
- Brief empty-state flash on resume (may or may not be visible depending on cache)
- No data loss, no crashes, no broken state

---

## Recommendation

**Defer this.** Classify as S3-low, register it, but don't invest implementation cycles right now.

**Why:**
1. It self-heals — the user gets correct data within seconds of resume
2. ORCH-0366 already fixed the actual timeout problem (12s was too tight, raised to 20s)
3. The foreground refresh system (ORCH-0240, ORCH-0385) is mature and working correctly
4. A fix touches the network/lifecycle layer — low regression risk but not zero
5. There are unaudited S0/S1 items (Reporting & Moderation has 2x S0) that need attention first

**If you disagree and want to fix it anyway:** The safest approach is Option B from the investigation — ensure React Query shows stale cached data during the retry window (`keepPreviousData` on the map card queries). This is a 2-line change with near-zero regression risk, versus Option A (AbortController) which is cleaner but touches more moving parts.
