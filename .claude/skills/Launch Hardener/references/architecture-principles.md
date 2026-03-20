# Architecture Principles Reference

## Table of Contents
1. How to Think About Fixes
2. How to Handle Architecture
3. Contract Thinking
4. Documentation Rules
5. Cross-Cutting Reliability Concerns
6. The Invariant Discipline

---

## 1. How to Think About Fixes

Treat each important behavior as a **contract**. A fix is not done until ALL of these are true:

- [ ] Code changed
- [ ] Behavior proven (not assumed — show evidence)
- [ ] Tests added (or manual smoke test documented with steps + results)
- [ ] README updated (if any behavior contract changed)
- [ ] Protective comment added (if the fix is fragile or non-obvious)
- [ ] Invariant named and enforcement mechanism identified

"Done" means: implemented + tested + reviewed + documented + hardened.
If any box is unchecked, say so plainly. The fix is incomplete.

### Fix Prioritization

When multiple issues exist, prioritize by this matrix:

| | High User Impact | Low User Impact |
|---|---|---|
| **Easy Fix** | Do first | Do third |
| **Hard Fix** | Do second | Do last (or defer) |

Within the same priority tier, prefer:
1. Fixes that make the system more truthful (remove lies from UI)
2. Fixes that prevent data corruption (integrity > cosmetic)
3. Fixes that reduce blast radius of future bugs (isolation > optimization)

### Narrow Fix Principle

Always try the narrowest fix first. A narrow fix:
- Changes the fewest files
- Has the smallest blast radius
- Can be tested in isolation
- Can be rolled back without side effects

Only go broader when the narrow fix is proven inadequate — not when it's "less clean."

---

## 2. How to Handle Architecture

When architecture comes up, do NOT jump to "rewrite." Follow this sequence strictly:

### Step 1: Make the System Truthful
Remove lies. Wrong states, masked errors, misleading fallback behavior.
A screen that shows "No results" when the API errored is lying.
A loading spinner that never resolves is lying.
A stale cached list that doesn't reflect a mutation is lying.

### Step 2: Remove Hidden Fallback Behavior
Kill silent catch-alls that swallow real problems.
If a catch block returns a default value, the real error is invisible.
If a fallback hides a network failure, the user thinks their action succeeded.

### Step 3: Make Operational Gaps Visible
If something is broken, make it obviously broken.
Better to show an error screen than to show fake success.
Better to crash visibly than to corrupt data silently.

### Step 4: Then Simplify Structure
Only once reality is clear and proven.
Simplify with confidence because you now know what's real.

### Transitional Architecture

Prefer transitional architecture that is explicit and documented over elegant architecture
that is risky and unproven.

A transitional state is OK if:
- It's documented (comment explaining what's temporary and why)
- It has a defined end state (what the final architecture should look like)
- It doesn't make the system LESS reliable in the meantime
- It can be evolved incrementally (not a big-bang migration)

A transitional state is NOT OK if:
- It introduces a new category of bug
- It makes two systems responsible for the same truth
- It creates data that's in an inconsistent state between old and new

---

## 3. Contract Thinking

Every feature should have a behavioral contract — a plain-English description of what it
guarantees. Contracts live in the main README.

### What Makes a Good Contract

A good contract says:
- What the user sees in each state (loading, error, empty, populated)
- What actions are available and what they do
- What data persists and when
- What happens on failure

A good contract does NOT say:
- Implementation details (which hook, which query key)
- Performance targets (those go in the tracker, not the contract)
- Technical architecture (that goes in the architecture doc)

### Contract Examples

```
## Discovery Deck
- On load: user sees 20 cards matching their selected filters within 2 seconds
- On swipe right: card is saved to Saved tab immediately, persisted to database
- On swipe left: card is dismissed and tracked for session review
- On schedule: card is added to Calendar tab and synced to device calendar
- When all cards exhausted: user sees end-of-results notification with review option
- On filter change: deck resets with fresh results matching new filters
```

### When to Update Contracts

Update the contract in the main README when:
- A new user-facing behavior is added
- An existing behavior changes (including error/empty states)
- A behavior is removed or deprecated

Do NOT update the contract for:
- Internal refactors that don't change user-facing behavior
- Performance improvements (track in LAUNCH_READINESS_TRACKER)
- Bug fixes that restore already-contracted behavior

---

## 4. Documentation Rules

### LAUNCH_READINESS_TRACKER.md
- Living document in the repo
- Updated after every verified fix
- Reflects reality (grades backed by evidence)
- Owned by the Launch Hardener process

### Main README
- Permanent system and behavior contracts only
- Updated when a behavior contract changes
- NOT updated for internal refactors

### Workflow Artifacts (audit/spec/implementation/testing reports)
- Used for decisions
- NOT committed to repo unless user explicitly asks
- Temporary by nature — inform the pipeline, then become history

### Sidecar Docs (README_*, CONTRACTS_*)
- NOT created unless the user explicitly requests them
- All contracts live in the main README
- Don't fragment documentation across multiple files

### Protective Comments
Add to code when a fix is fragile or non-obvious:
```typescript
// RELIABILITY: This check prevents [specific failure mode].
// Removing it will cause [specific consequence].
// See LAUNCH_READINESS_TRACKER.md issue #[N] for context.
```

---

## 5. Cross-Cutting Reliability Concerns

Check these on every FULL-SWEEP. They span all flows.

### Auth Token Lifecycle
- What happens when JWT expires mid-session?
- Does the app refresh automatically or break?
- Does the Supabase client handle token refresh?
- What if refresh fails? Is the user signed out gracefully?

### App Lifecycle
- What happens on background → foreground transition?
- Does state survive correctly?
- Do Realtime subscriptions reconnect?
- Do stale queries refetch?

### AsyncStorage Schema Migration
- What happens when app updates change Zustand shape?
- Is there a migration or does it crash on hydration?
- What happens when React Query cache contains old data shapes?

### Push Notifications
- What if the notification references content that's been deleted?
- What if the user taps a notification for a screen they don't have access to?

### Supabase Realtime
- Are subscriptions cleaned up on unmount?
- What happens after network loss + reconnection?
- Are multiple subscriptions on the same channel deduplicated?

### Memory Pressure
- Are large lists virtualized (FlashList)?
- Are images cached and sized appropriately?
- Do screens with heavy data unmount cleanly?

### Cold Start Performance
- How many sequential queries fire on first load?
- Which queries could be parallelized?
- Is there a waterfall of: auth → user → preferences → places → cards?

### Network Resilience
- What does each screen show with no network?
- What does each mutation do with no network?
- Is there offline queueing, or just errors?
- Are timeouts configured on external API calls?

---

## 6. The Invariant Discipline

Every important fix should name the invariant it protects. An invariant is a rule that
must always be true for the system to be correct.

### How to Write Invariants

Good: "Every active card must reference only existing active places"
Good: "Cache must invalidate within staleTime of any mutation to source data"
Good: "No API call should fire without validated user filters"

Bad: "Cards should be correct" (too vague)
Bad: "Cache should be fresh" (no enforcement mechanism)

### Enforcement Hierarchy

Prefer stronger enforcement mechanisms:

| Level | Enforcement | Strength |
|-------|-----------|----------|
| 1 | Database constraint (FK, CHECK, UNIQUE, NOT NULL) | Strongest — impossible to violate |
| 2 | RLS policy | Strong — enforced on every query |
| 3 | Edge function validation | Medium — enforced on API boundary |
| 4 | TypeScript type system | Medium — enforced at compile time |
| 5 | Application code check | Weak — can be bypassed, forgotten, or removed |
| 6 | Convention / documentation | Weakest — only works if everyone reads and follows |

When specifying a fix, always say which level enforces the invariant. If the answer is
level 5 or 6, ask: "Can we push this to level 1-4?"

### The Ultimate Question

For every fix, every spec, every architecture decision:

**How do we make the bad state impossible, not just unlikely?**

If the bad state can still happen but is "very rare," the fix is incomplete. Push for
structural enforcement. Schema beats code. Types beat runtime checks. Constraints beat
conventions. Impossibility beats improbability.