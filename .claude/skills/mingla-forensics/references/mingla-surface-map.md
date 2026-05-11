> Parity note: ported from `.codex/skills/forensic-mingla/references/mingla-surface-map.md` during META-ORCH-0755-B so Claude forensics has the same repo-orientation map as Codex.

# Mingla Surface Map

## Primary intent sources

- `README.md`: product promise, architecture constitution, verified behavioral contracts, and repo map
- `docs/DOMAIN_ADRS.md`: source-of-truth ownership by domain
- `docs/MUTATION_CONTRACT.md`: expected error handling and mutation behavior
- `docs/QUERY_KEY_REGISTRY.md`: query ownership and invalidation rules
- `docs/IMPLEMENTATION_GATES.md`: readiness checklist used by implementors
- `Mingla_Artifacts/ARTIFACT_MANIFEST.md`: current artifact classification and archive map
- `Mingla_Artifacts/archive/README.md`: historical evidence index
- `Mingla_Artifacts/reports/*.md`: prior forensic, implementation, QA, and audit evidence
- `Mingla_Artifacts/specs/*.md`: prior specs and accepted contracts
- `Mingla_Artifacts/AGENT_HANDOFFS.md`: current handoff chronology

## Feature tracing order

1. Start at the user entry point in `app-mobile/` or `mingla-admin/`.
2. Follow the hook, service, store, or component chain that issues the mutation or query.
3. Trace the request into `supabase/functions/`, SQL migrations, views, triggers, and RLS-related tables or policies.
4. Trace the return path back into cache invalidation, optimistic state, realtime listeners, and user-visible confirmation.
5. Check whether admin tooling, scheduled jobs, or backoffice-only actions are required for the feature to work in production.
6. For database-backed behavior, grep the full migration chain and treat the latest relevant definition as current truth.

## Repository surfaces

- `app-mobile/app/` and `app-mobile/src/`: mobile entry points, UI, hooks, services, Zustand store, and feature constants
- `mingla-business/`: organiser app, Stripe Connect, events, tickets, checkout/order flows, QR/door sales, guest list, permissions, finance, and business settings
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
