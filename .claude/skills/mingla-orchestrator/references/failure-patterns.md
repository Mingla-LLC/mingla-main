# Failure Patterns — Mingla

The patterns that cause the most real-world production issues. Check against
these during every investigation and audit.

---

## Pattern 1: The Lying UI
**What:** Screen shows stale data, fake empty state, or "success" when mutation failed.
**Root cause:** Wrong React Query key, missing cache invalidation, swallowed error.
**Detection:** Force a mutation → check if UI reflects the change immediately.
**Mingla hotspots:** Saved cards list after save/unsave, calendar after schedule,
preferences after change, friend list after accept/block.

## Pattern 2: The Silent Crash
**What:** App crashes under specific conditions with no user-facing error.
**Root cause:** `.single()` on empty result, null access on optional data, unhandled rejection.
**Detection:** Test empty states, missing data, rapid navigation.
**Mingla hotspots:** Card rendering with missing fields, profile load for deleted user,
edge function responses with unexpected shape.

## Pattern 3: The Race Condition
**What:** Two operations interfere, producing inconsistent state.
**Root cause:** Rapid navigation + stale callbacks, optimistic updates + server conflict,
concurrent realtime subscriptions updating same cache key.
**Detection:** Rapid tap sequences, background/foreground toggle during mutation.
**Mingla hotspots:** Preferences → deck pipeline, simultaneous swipes, session voting,
realtime subscription reconnect.

## Pattern 4: The Stale Cache
**What:** Data updated but UI shows old state until hard refresh.
**Root cause:** Mutation doesn't invalidate correct query keys, key missing parameter.
**Detection:** Mutate data → check UI without manual refresh.
**Mingla hotspots:** Saved cards after preference change, deck after category filter,
notification badge after read, subscription tier after purchase.

## Pattern 5: The Auth Gap
**What:** Edge function missing auth check, or RLS policy with gap.
**Root cause:** Incomplete security implementation.
**Detection:** Call edge function without auth token. Query table as wrong user.
**Mingla hotspots:** Admin endpoints, new edge functions, tables without RLS.

## Pattern 6: The Masked Error
**What:** Catch block swallows real error, returns fallback. Looks fine but action didn't persist.
**Root cause:** `catch () { return [] }` or `catch () { return true }` patterns.
**Detection:** Force the error condition → check if mutation actually persisted.
**Mingla hotspots:** PreferencesService, save operations, notification sends, all service
files with try/catch blocks.

## Pattern 7: The Zombie State
**What:** App continues operating with expired/invalid auth, showing partial data or errors.
**Root cause:** Token expired but no refresh triggered, auth state inconsistent.
**Detection:** Let token expire while app is backgrounded → foreground.
**Mingla hotspots:** Long sessions, background → foreground after hours, multi-device.

## Pattern 8: The Ownership Conflict
**What:** Two systems both think they own the same data, producing contradictions.
**Root cause:** Zustand holding server data, React Context duplicating React Query.
**Detection:** Update data in one place → check if the other reflects the change.
**Mingla hotspots:** User profile (Zustand vs React Query), preferences (multiple hooks),
subscription tier (RevenueCat vs DB vs admin override).

## Pattern 9: The Cold Start Surprise
**What:** App works fine during session but fails on cold start from persisted state.
**Root cause:** AsyncStorage shape mismatch after schema change, stale Zustand hydration.
**Detection:** Kill app → clear nothing → reopen.
**Mingla hotspots:** Deck batches in Zustand, persisted query cache, onboarding resume.

## Pattern 10: The Parity Drift
**What:** Feature works in solo mode but breaks in collab mode (or vice versa).
**Root cause:** Fix applied to one code path but not its sibling.
**Detection:** Test every fix in both solo AND collab mode.
**Mingla hotspots:** Preferences pipeline (solo vs board_session_preferences),
card serving (personal deck vs session deck), save operations.

## Pattern 11: The Fabricated Comfort
**What:** UI shows plausible-looking but fake data (default ratings, estimated prices).
**Root cause:** Fallback values that look real: `rating ?? 4.0`, `price ?? '$$'`.
**Detection:** Check every displayed number — is it from real data or a default?
**Mingla hotspots:** Card ratings, travel times, price tiers, match scores.

## Pattern 12: The Dangling Subscription
**What:** Realtime subscription survives component unmount, causing ghost updates.
**Root cause:** Missing cleanup in useEffect, subscription not removed on navigation.
**Detection:** Navigate away → check if subscription callbacks still fire.
**Mingla hotspots:** Chat presence, session voting, social realtime, notification badges.

## Pattern 13: The Temporal Confusion
**What:** Time-dependent logic uses wrong timezone, format, or reference point.
**Root cause:** Mixing UTC and local time, wrong timezone in opening hours check,
12h/24h format mismatch.
**Detection:** Test with non-UTC timezone, edge-of-day times, DST transitions.
**Mingla hotspots:** "Now" filter, opening hours parsing, calendar entries,
notification quiet hours, holiday reminders.

## Pattern 14: The Query Key Drift
**What:** Same data fetched with different keys, causing cache misses or stale data.
**Root cause:** Hardcoded strings instead of factory, missing parameters in key.
**Detection:** Grep for query key strings — any duplicates or near-duplicates?
**Mingla hotspots:** Saved cards (was 3 keys → 1), person cards (was 2 → 1),
any hook with inline key array.

---

## Quick Audit Checklist

For any screen or feature, run through these:

- [ ] Does the UI tell the truth in ALL states? (loading, error, empty, populated)
- [ ] Does every mutation invalidate the right query keys?
- [ ] Is there a code path that swallows errors?
- [ ] Does this work from cold start (persisted cache)?
- [ ] Does this work after background → foreground?
- [ ] Does this work in solo AND collab mode?
- [ ] Are all displayed numbers from real data?
- [ ] Do subscriptions clean up on unmount?
- [ ] Is timezone handling correct?
- [ ] Are query keys from a factory (not hardcoded)?
