# Spec Layer Guide

How to specify each layer of the Mingla stack. A spec that skips a layer
produces an implementation that guesses at that layer.

---

## Rule: Specify every layer the fix touches

Most bugs span more layers than you initially think. Default to including a layer
unless you can prove it's unaffected.

---

## Database Layer

**When to specify:** Any new table, column, constraint, index, RLS policy, or migration.

**Must include:**
- Exact SQL (not pseudocode)
- Table name and all columns with types, constraints, defaults
- `ENABLE ROW LEVEL SECURITY` (mandatory on every new table)
- RLS policies for every CRUD operation the feature uses
- Indexes on frequently queried and join columns
- Foreign key relationships with CASCADE behavior
- Migration filename: `[timestamp]_[descriptive_name].sql`

**Checklist:**
- [ ] NOT NULL on every required field?
- [ ] CHECK constraint on enum-like fields?
- [ ] UNIQUE where duplicates are invalid?
- [ ] FK with correct CASCADE (or RESTRICT if deletion should fail)?
- [ ] Index on every column used in WHERE, JOIN, or ORDER BY?
- [ ] RLS policies cover SELECT, INSERT, UPDATE, DELETE as needed?
- [ ] `auth.uid()` comparison correct in policies?

---

## Edge Function Layer

**When to specify:** Any new function, or changes to request/response shape, validation, or auth.

**Must include:**
- Function name, HTTP method
- Auth requirement (and exact check code)
- Request interface with every field typed + validation rules
- Response interfaces for success AND each error code
- External API calls: which API, what fields, timeout, error handling, caching
- Idempotency: is it safe to retry?

**Checklist:**
- [ ] Auth validated at entry (before any DB access)?
- [ ] Every request field validated (type, required, format)?
- [ ] Error responses use correct HTTP status codes?
- [ ] External calls have timeout (withTimeout)?
- [ ] External call failures return structured error (not raw error)?
- [ ] Using user role (not service role) unless service role is justified?

---

## Service Layer

**When to specify:** Any new service function or changes to existing query/mutation.

**Must include:**
- Exact file path
- Function signature with types
- Supabase query construction (which table, which columns, which filters)
- Error contract: throws | transitional fallback (with label)
- Return type

**Checklist:**
- [ ] Uses `.maybeSingle()` where row might not exist?
- [ ] Selects only needed columns (not `*`)?
- [ ] Throws on error (not return null/[]/true)?
- [ ] If transitional: marked with `[TRANSITIONAL]` + exit condition?
- [ ] Return type matches what hook expects?

---

## Hook Layer

**When to specify:** Any new hook, or changes to query key, cache invalidation, or mutation.

**Must include:**
- Hook name, file path
- Query key: from factory, with ALL parameters that affect result
- staleTime with reasoning
- enabled condition
- For each mutation:
  - What service function it calls
  - onSuccess: which query keys to invalidate (via factory)
  - onError: exact toast message text
- Return type

**Checklist:**
- [ ] Query key from factory (not hardcoded)?
- [ ] Key includes every filter/parameter that changes the result?
- [ ] Arrays in key are serialized (JSON.stringify)?
- [ ] GPS coordinates rounded in key?
- [ ] `enabled` gates on required dependencies?
- [ ] Every mutation has `onError` with user-facing message?
- [ ] `onSuccess` invalidation uses factory keys?
- [ ] No inline invalidation (only in onSuccess callback)?

---

## Component Layer

**When to specify:** Any new component, or changes to rendering, states, interactions, or copy.

**Must include:**
- Component name, file path
- Props interface (if any)
- State machine: every state (loading, error, empty, populated, submitting) with what renders
- User-facing copy for every state
- Interaction handlers: what the user does → what happens
- Haptics: which interactions get feedback and which type
- Accessibility: labels on every interactive element
- Style approach: StyleSheet.create (mobile) or Tailwind (admin)

**Checklist:**
- [ ] Loading state shows skeleton or spinner (not blank)?
- [ ] Error state shows message + retry action?
- [ ] Empty state shows guidance + action to fix?
- [ ] Submitting state disables controls + shows indicator?
- [ ] Every button/link has a handler that does something?
- [ ] Every interactive element has an accessibility label?
- [ ] Copy is friendly, clear, never blames user?
- [ ] Uses existing design tokens (colors, spacing, typography)?

---

## Realtime Layer (if applicable)

**When to specify:** Any Supabase Realtime subscription.

**Must include:**
- Channel name
- Table and event filter (INSERT, UPDATE, DELETE)
- Row filter (if not listening to all rows)
- What to do on event receipt (invalidate query? update state?)
- Cleanup: useEffect cleanup removes subscription

**Checklist:**
- [ ] Subscription created in useEffect with cleanup?
- [ ] Specific table/event filter (not listening to everything)?
- [ ] Cache update strategy correct (invalidate vs direct update)?
- [ ] Handles reconnect after network loss?

---

## Navigation Layer (Mingla-specific)

**When to specify:** Any screen transition, deep link, or modal.

**Must include:**
- How user gets here (tab, deep link, modal trigger)
- `setCurrentPage` call (NOT React Navigation)
- Modal trigger state (which flag opens it)
- Back behavior (what happens on dismiss/back)
- Deep link support (if applicable)

---

## Analytics Layer (if applicable)

**When to specify:** Any new tracked interaction.

**Must include:**
- Event name
- When it fires (which user action)
- Properties included
- Which service (Mixpanel, AppsFlyer, etc.)
