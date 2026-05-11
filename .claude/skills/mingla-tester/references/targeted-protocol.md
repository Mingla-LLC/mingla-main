# Targeted Test Protocol — Full 10-Step Procedure

The core testing mode. Execute every step. Skip nothing.

---

## Step 1 — Blast Radius Mapping

Trace every changed file to ALL dependents:

| Changed File Type | Trace To |
|-------------------|----------|
| `.sql` migration | Edge functions, services, hooks, components that touch that table |
| Edge function | Services that call it, hooks, components, admin pages |
| Service | Hooks that call it, components, admin equivalents |
| Hook | Components consuming it, other hooks composing it |
| Component | Parents, navigation flows, screens containing it |
| Type/constant file | Everything importing it |
| Zustand store | Every reader + every writer |
| Query key factory | Every hook using the factory, every invalidation targeting it |

Produce a **Test Manifest**: every file to inspect, organized by layer.
Present to user before proceeding.

---

## Step 2 — Implementation Report Audit

If an implementation report exists, read it. For EVERY claim the implementor makes:
- Mark it for independent verification
- Do NOT trust it until YOU verify it

Build a **Claim Verification Table**:
```
| Claim | File | Verified? | Evidence |
```
Fill in "Verified?" AFTER you've read the actual code.

---

## Step 3 — Forensic Code Reading

Read EVERY file in the manifest. Layer-specific checklists below.

### Database / Migration

- [ ] SQL syntax is valid PostgreSQL (not MySQL, not SQLite)
- [ ] Column types match TypeScript types used in services
- [ ] NOT NULL on every required field (check what app assumes non-null)
- [ ] DEFAULT values where app doesn't explicitly set
- [ ] Foreign keys for all relationship columns with correct CASCADE
- [ ] Indexes on WHERE, ORDER BY, JOIN columns
- [ ] CHECK constraints on enum-like fields
- [ ] `timestamptz` not `timestamp` for time columns
- [ ] `gen_random_uuid()` as default for UUID PKs
- [ ] Migration is idempotent (IF NOT EXISTS where appropriate)
- [ ] No data loss from ALTER TABLE (migration plan for live data)
- [ ] Migration ordering correct (no refs to later migrations)
- [ ] Partial indexes where appropriate (e.g., `WHERE status = 'active'`)

### RLS Policies

- [ ] `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` present
- [ ] SELECT policy restricts to appropriate users
- [ ] INSERT policy with appropriate constraints
- [ ] UPDATE policy prevents cross-user modification
- [ ] DELETE policy exists (or deliberately absent with documentation)
- [ ] Policies use `auth.uid()` not `current_user`
- [ ] No `TO public` without justification
- [ ] Service role bypass is intentional and documented
- [ ] Policies handle NULL `auth.uid()` (logged-out)
- [ ] No data leak through joined tables
- [ ] **Test mentally:** Can User A see/modify User B's data? (Must be NO)

### Edge Functions

- [ ] Auth validated at entry (before any DB access)
- [ ] Every request field validated (type, format, range)
- [ ] Structured error responses with correct HTTP status codes
- [ ] No unhandled promise rejections
- [ ] No `console.log` of sensitive data (tokens, keys, PII)
- [ ] Response shape matches what services expect
- [ ] External API calls have `withTimeout`
- [ ] No hardcoded API keys (use `Deno.env.get()`)
- [ ] Parameterized queries only (no string interpolation SQL)
- [ ] Idempotent where applicable (safe to retry)
- [ ] CORS from shared module

### Services

- [ ] Uses `.maybeSingle()` for optional rows (never `.single()` for 0-or-1)
- [ ] Error handling: throws on error (not silent `return null/[]/true`)
- [ ] If transitional fallback: marked `[TRANSITIONAL]` with exit condition
- [ ] Return type matches hook expectations
- [ ] Query filters match actual column names (cross-check migrations)
- [ ] SELECT specifies needed columns (no `select('*')` without reason)
- [ ] Mutations return mutated data for cache updates
- [ ] No business logic in service (data access only)

### Hooks

- [ ] Query key from registered factory (not hardcoded string)
- [ ] Key includes ALL parameters that affect results
- [ ] Arrays in key serialized deterministically (`JSON.stringify(sorted)`)
- [ ] GPS coordinates rounded in key (prevent churn)
- [ ] `staleTime` intentional (not default, not Infinity without reason)
- [ ] `enabled` prevents firing without required params
- [ ] Every `useMutation` has `onError` with user-facing message
- [ ] Optimistic updates rollback in `onError`
- [ ] `onSuccess` invalidates ALL affected keys via factory
- [ ] No inline invalidation (only in `onSuccess`)
- [ ] No duplicate key shapes (compare with existing hooks)
- [ ] Return type explicit (no `any`, no implicit `unknown`)

### Components

- [ ] ALL 5 states: loading (skeleton/spinner), error (message + retry), empty (guidance + action), populated (actual UI), submitting (disabled + indicator)
- [ ] No blank screen path for any state
- [ ] Styles use `StyleSheet.create` (mobile) or Tailwind (admin)
- [ ] No direct Supabase calls (service → hook chain)
- [ ] Props interface typed (no `any`)
- [ ] Event handlers catch async errors
- [ ] Lists use FlatList/FlashList with keyExtractor (no `.map()` for long lists)
- [ ] Images have fallback for failed loads
- [ ] Text handles overflow (truncation or wrapping)
- [ ] Touch targets ≥44pt (iOS) / ≥48dp (Android)
- [ ] Keyboard avoidance on input screens
- [ ] Safe area insets respected
- [ ] Destructive actions confirmed with dialog
- [ ] Accessibility labels on interactive elements

### Types / Constants

- [ ] Types match database schema exactly (names, nullability, types)
- [ ] No `any` in production code
- [ ] No `@ts-ignore` / `@ts-expect-error` without documented reason
- [ ] Enum values match DB CHECK constraints
- [ ] Constants not duplicated across files
- [ ] Import paths correct and consistent with neighbors

### State Management

- [ ] Server state in React Query ONLY
- [ ] Client state in Zustand ONLY (UI flags, navigation, deck batches)
- [ ] No Zustand persisting API-fetched data without offline contract
- [ ] RQ cache + Zustand + AsyncStorage cleared on logout
- [ ] No `useState` holding data that should be in RQ
- [ ] Zustand selectors are granular (not entire store)

---

## Step 4 — Constitution Enforcement

Verify ALL 14 rules for every changed file. Format:

| Rule | Verdict | Evidence |
|------|---------|----------|
| 1. No dead taps | PASS/FAIL | [file:line or "N/A"] |
| 2. One owner per truth | PASS/FAIL | [evidence] |
| ... | ... | ... |

Any FAIL = automatic P0 finding. Non-negotiable.

---

## Step 5 — Behavioral Contract Verification

If the change touches a contracted domain (Preferences→Deck, Save, Schedule Validation,
Session Load, Auth, AI Quality Gate, Exclusion, Card Display), verify the implementation
matches the contract EXACTLY. Any deviation = P0.

---

## Step 6 — Independent Test Writing

Write YOUR OWN tests. Do not run the implementor's tests.

Minimum test counts per layer:

| Layer | Happy | Boundary | Error | Security | Perf |
|-------|-------|----------|-------|----------|------|
| DB/RLS | 2 | 2 | 1 | 3 | 1 |
| Edge Function | 2 | 3 | 3 | 3 | 1 |
| Service | 2 | 2 | 2 | 1 | - |
| Hook | 2 | 2 | 2 | - | 1 |
| Component | 3 | 2 | 2 | - | 1 |

**Test categories:**
- **Happy path:** Normal operation, valid inputs, expected state
- **Boundary:** Empty, null, undefined, max length, zero, negative, emoji, RTL, single item, max items
- **Error:** Network failure, auth expiry, malformed response, timeout, race condition
- **Security:** Unauthorized access, cross-user leak, injection, RLS bypass, IDOR
- **Performance:** Large dataset, rapid re-render, memory leak on unmount

---

## Step 7 — Parity Enforcement

If the change touches solo mode OR collab mode:
- [ ] Same fix/feature applies in both modes?
- [ ] Tested in both modes?
- [ ] If only one mode: documented why the other doesn't need it

If the change touches mobile:
- [ ] Admin dashboard equivalent checked?
- [ ] Admin data still correct after mobile changes?

If the change touches database:
- [ ] Mobile AND admin AND edge functions all handle the new shape?

---

## Step 8 — UI/UX Coherence Audit

Read `references/ux-coherence-protocol.md` for the full checklist.
This is NOT "does it render." This is "does it make sense to a human."

Quick version:
- Would a first-time user understand this screen?
- Is there a clear call to action?
- Do error/loading/empty states guide the user?
- Are interactive elements visually distinguishable?
- Does layout work on small screens (iPhone SE) and large screens?
- Is text readable at 200% accessibility size?
- Color contrast WCAG 2.1 AA (4.5:1 text, 3:1 large)?
- Destructive actions confirmed?
- Copy grammatically correct and consistent in tone?
- Currency, dates, times formatted per locale?

---

## Step 9 — Cross-Domain Impact

For every DB or edge function change, verify ALL consumers:

| Change | Mobile Impact | Admin Impact | Edge Impact | RLS Impact |
|--------|-------------|-------------|-------------|-----------|

---

## Step 10 — Pattern Compliance

Compare every changed file against its NEIGHBORS (same directory, same layer):
- Import ordering
- Export style
- Error handling shape
- Naming conventions
- File structure
- React Query hook patterns
- Service function patterns

Deviations = P2 unless demonstrably better (document why).
