# Code Patterns

## React Query

- Use key factories or the canonical registry. Do not hardcode query keys.
- Include every result-affecting parameter in the key.
- Serialize arrays/objects deterministically.
- Round GPS coordinates when they are key inputs.
- Gate queries with `enabled` until required dependencies exist.
- Put invalidation/update in mutation `onSuccess`, not in a racy caller after `await`.
- Add `onError` for every user-facing mutation.
- Document cross-entity invalidation.

Anti-patterns:

- `queryKey: ['saved-cards', userId]`
- Missing preferences/filter/location/session parameters.
- Mutation changes server data but no cache update follows.
- Same entity fetched with multiple key shapes.

## Zustand And Persisted State

- Zustand owns client-only state: navigation, UI flags, local draft state, documented offline cache, feature-local ephemeral state.
- React Query owns server-fetched state unless `README.md` or domain docs explicitly define a persisted startup contract.
- Persisted state shape changes need versioning/migration and sign-out cleanup.
- Do not add a second source of truth to paper over cache drift.

## Services

- Throw on true errors or return a typed `Result` if the local codebase uses that pattern.
- Never return `null`, `[]`, or `true` from catch as fake success unless explicitly transitional.
- Transitional fallback requires `[TRANSITIONAL]`, owner/exit condition in report, and registry update when durable.
- Use `.maybeSingle()` when zero rows are valid.
- Select only required columns, especially for user/sensitive data.

## Components And Screens

- Async surfaces need loading, error, empty, populated, submitting, offline/permission states as relevant.
- User interactions should show immediate feedback where possible.
- Error copy should say what happened and what to do next.
- No dead taps or TODO handlers.
- No fabricated display values.
- Mobile: follow `StyleSheet.create` and existing design tokens.
- Admin/business: follow local component and styling conventions.
- Accessibility labels on interactive elements.

## Edge Functions, RPCs, Webhooks

- Validate auth before protected work.
- Validate input types, required fields, actor ownership, and state transitions.
- Return structured success and error responses with correct status codes.
- External calls need timeout, retry/idempotency where relevant, and safe logging.
- Service role requires an explicit authorization guard.
- Webhooks need signature verification and idempotency for money/order/ticket flows.

## Database And RLS

- New user-data tables require RLS in the same migration.
- Policies cover all operations used by the app.
- Constraints enforce real product invariants: required fields, valid statuses, uniqueness, FKs.
- Index common filters, joins, ordering, and uniqueness.
- Check latest migration chain before editing or referencing current shape.

## Navigation

- Mobile uses the repo's custom navigation contract. Do not introduce React Navigation unless the repo has explicitly migrated.
- Deep links and modals need back/dismiss behavior.

## Copy

- Friendly, clear, concise.
- Do not blame the user.
- Admin/business copy should be operational and precise.
- Error text should not expose SQL, stack traces, secrets, or internal status names.

## Anti-Pattern Catalog

| Anti-pattern | Risk | Better |
|---|---|---|
| `catch { return [] }` | Silent empty state | Throw or typed error |
| `rating ?? 4.5` | Fabricated data | Hide or show unavailable |
| Hardcoded query key | Stale cache | Factory/registry key |
| Server data in Zustand | Ownership conflict | React Query |
| `.single()` on optional row | Crash | `.maybeSingle()` |
| Missing mutation `onError` | Silent failure | Toast/log/rollback |
| Fix solo only | Parity drift | Check collab/business/admin |
| Migration without RLS | Security gap | RLS + policies same migration |
| Button with placeholder handler | Dead tap | Remove or implement |
