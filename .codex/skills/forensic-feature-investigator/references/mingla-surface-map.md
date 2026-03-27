# Mingla Surface Map

## Primary intent sources

- `README.md`: product promise, architecture constitution, verified behavioral contracts, and repo map
- `docs/DOMAIN_ADRS.md`: source-of-truth ownership by domain
- `docs/MUTATION_CONTRACT.md`: expected error handling and mutation behavior
- `docs/QUERY_KEY_REGISTRY.md`: query ownership and invalidation rules
- `docs/IMPLEMENTATION_GATES.md`: readiness checklist used by implementors
- `outputs/PRODUCT_DOCUMENT.md`: product language and user-facing intent
- `outputs/LAUNCH_READINESS_TRACKER.md`: known launch blockers and readiness framing
- `outputs/INVESTIGATION_*.md`: prior forensic work that may already contain evidence

## Feature tracing order

1. Start at the user entry point in `app-mobile/` or `mingla-admin/`.
2. Follow the hook, service, store, or component chain that issues the mutation or query.
3. Trace the request into `supabase/functions/`, SQL migrations, views, triggers, and RLS-related tables or policies.
4. Trace the return path back into cache invalidation, optimistic state, realtime listeners, and user-visible confirmation.
5. Check whether admin tooling, scheduled jobs, or backoffice-only actions are required for the feature to work in production.

## Repository surfaces

- `app-mobile/app/` and `app-mobile/src/`: mobile entry points, UI, hooks, services, Zustand store, and feature constants
- `mingla-admin/src/`: admin pages, operational controls, dashboards, auth context, and Supabase client usage
- `supabase/functions/`: edge functions and shared backend helpers
- `supabase/migrations/` and `supabase/schema.sql`: schema, data contracts, RLS, triggers, and RPC behavior
- `backend/`: backend-adjacent utilities or mirrored Supabase assets
- `tests/`: focused automated tests; absence of coverage is itself a signal

## Fast validation commands

- `npm run lint` in `app-mobile`
- `npm run lint` in `mingla-admin`
- `npm run build` in `mingla-admin`
- Run any focused test files that already exist for the feature under `tests/` or the app package

If no focused automated verification exists for a critical feature path, call that out as a production-readiness gap instead of silently accepting it.
