> Parity note: ported from `.claude/skills/mingla-orchestrator/references/constitutional-compliance.md` during META-ORCH-0755-B so Codex orchestrator can load Claude’s full architecture-constitution checklist during review.

# Constitutional Compliance — Mingla Architecture Non-Negotiables

Every issue, every proposed solution, and every implementation review is checked
against these principles. Violations are classified as architecture flaws (not just bugs)
and receive automatic severity escalation.

---

## The 14 Principles

### 1. No Dead Taps
Every interactive element must respond to user input. No button that does nothing.
No tap target that swallows the gesture. If a feature isn't ready, show "Coming Soon"
or remove the element entirely.

**Test:** Tap every button, link, and interactive element. Something must happen.

### 2. One Owner Per Truth
Every piece of data has exactly one authoritative source. No duplicate state.
React Query owns server state. Zustand owns client-only state. Database owns
persisted truth. When two systems disagree, the owner wins.

**Test:** For any data point, can you name exactly one place it lives?

### 3. No Silent Failures
Every error must surface — to the user (toast/alert), to logs, or to monitoring.
No empty catch blocks. No `catch () {}`. No functions that return `true` after
swallowing an error. The system must never pretend success when it failed.

**Test:** Force every error path. Does something visible happen?

### 4. One Query Key Per Entity
React Query keys follow a strict factory pattern. One factory per entity type.
No hardcoded string keys. No duplicate keys for the same data. No keys that
miss parameters that affect the query result.

**Test:** Grep for hardcoded query key strings. There should be zero.

### 5. Server State Stays Server-Side
Zustand stores do NOT hold server-fetched data as primary state. React Query
is the server-state authority. Zustand may hold derived client-only state
(current page, UI flags, navigation state).

**Test:** Does any Zustand store hold data that came from an API call?

### 6. Logout Clears Everything
Sign-out must clear: React Query cache, Zustand stores, AsyncStorage, push tokens,
realtime subscriptions, in-memory caches, navigation state. No private data survives.

**Test:** Sign out, sign in as different user. See any data from previous user?

### 7. Label Temporary Fixes
Every temporary fix, workaround, or partial safeguard must be:
- Labeled with `[TRANSITIONAL]` comment
- Tracked in the World Map with an exit condition
- Owned by someone responsible for replacing it
- Given a deadline or trigger for permanent resolution

**Test:** Grep for `[TRANSITIONAL]`. Is every one tracked?

### 8. Subtract Before Adding
When fixing a bug, first remove the broken code/behavior. Then add the correct
replacement. Never layer new code on top of broken code. Never add a sync layer
to paper over a state ownership problem.

**Test:** Did the fix remove broken code, or just add code around it?

### 9. No Fabricated Data
Never show fake data to users. No placeholder ratings, no invented prices,
no estimated travel times presented as exact. If data is unavailable, show
"Not available" or hide the element. Approximations must be labeled as such.

**Test:** Is every number on screen sourced from real data?

### 10. Currency-Aware UI
Every price surface must respect the user's configured currency and locale.
No hardcoded "$". No mixed currency displays. Price formatting must use
the user's measurement system and currency from their profile.

**Test:** Change user country. Do all prices reflect the correct currency?

### 11. One Auth Instance
Single session authority. No competing auth states. Token refresh is
centralized. No component independently checks or refreshes auth.

**Test:** Is there exactly one auth management system?

### 12. Validate at the Right Time
Don't validate too early (blocking UX for no reason) or too late
(letting invalid data persist). Onboarding validates on step completion.
Scheduling validates on save. Preferences validate on submit.

**Test:** Where does validation happen? Is it the right moment?

### 13. Exclusion Consistency
The same exclusion rules must apply during card generation AND card serving.
If a type is excluded at generation, it must also be excluded at serve time.
No inconsistency between what gets created and what gets shown.

**Test:** Are exclusion lists identical in generation and serving code?

### 14. Persisted-State Startup
The app must work correctly when starting from cold cache (AsyncStorage
has stale data from a previous session). Schema version checks, hydration
gates, and stale-data detection must all function.

**Test:** Kill app, wait, reopen. Does everything load correctly?

---

## Compliance Check Procedure

When reviewing any proposed solution:

1. Read the solution summary
2. For EACH of the 14 principles:
   - Does this solution comply? (Y/N/NA)
   - If N: what specific violation?
   - If NA: why doesn't this principle apply?
3. Any violation → solution needs revision before approval
4. Record compliance check result in the review

---

## Common Violation Patterns

| Principle | Common Violation | Where It Hides |
|-----------|-----------------|----------------|
| #2 One Owner | Zustand duplicating React Query data | useAppState holding server-fetched user data |
| #3 No Silent Failures | `catch () { return [] }` | Service files returning fallback on error |
| #6 Logout Clears | AsyncStorage not cleared on sign-out | Persisted Zustand stores surviving |
| #8 Subtract First | Adding wrapper around broken hook | New hook calling old broken hook |
| #9 No Fabricated Data | `rating ?? 4.0` fallback | Default values masking missing data |
| #13 Exclusion Consistency | SQL exclusion in one function but not another | Multiple card-serving edge functions |
