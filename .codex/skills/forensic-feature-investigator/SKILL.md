---
name: forensic-feature-investigator
description: End-to-end forensic investigation of Mingla features across user journey, mobile UI, admin UI, Supabase functions, database and RLS paths, integrations, tests, and production-readiness gaps. Use when Codex needs to trace what a feature is supposed to do, map how it actually behaves through this repository, identify server/UI/UX failures, validate happy-path and edge-case flows, or explain what blocks a feature from being production ready.
---

# Forensic Feature Investigator

## Overview

Treat each feature like a case file. Reconstruct the user promise, trace the real execution path across Mingla surfaces, verify the happy path and the breakpoints, then explain the evidence-backed gaps between intended behavior and implemented behavior.

Use [references/mingla-surface-map.md](references/mingla-surface-map.md) to orient yourself in this repo, [references/forensic-checklist.md](references/forensic-checklist.md) for the deeper investigation checklist, and [references/report-template.md](references/report-template.md) when the user wants a polished write-up.

## Investigation Workflow

1. Frame the case.
   Define the feature slice, actor, start trigger, success outcome, prerequisites, and environment. If the user gives only a symptom, infer the smallest coherent feature boundary and state that assumption.

2. Reconstruct intended behavior.
   Read repo-level intent first: `README.md`, relevant files in `docs/`, and, if needed, `outputs/PRODUCT_DOCUMENT.md`, `outputs/LAUNCH_READINESS_TRACKER.md`, or prior `outputs/INVESTIGATION_*.md`. Write a short happy-path narrative:
   `entry point -> user action -> network call -> server or data side effect -> user-visible result`.
   Note negative expectations too: permissions, loading states, retries, rollbacks, and error copy.

3. Trace the implementation end to end.
   Start from the first user touchpoint and move forward through the stack rather than reading one folder at a time. Search by feature nouns, route names, button labels, query keys, function names, table names, analytics events, and environment variables. Build a thin evidence chain across `app-mobile/`, `mingla-admin/` if relevant, `supabase/functions/`, `supabase/migrations/`, `backend/`, and `tests/`.

4. Validate the journey.
   Prefer targeted verification over broad sweeps. Run the smallest command, test, or reproduction that can confirm or falsify a suspected failure. Check optimistic updates, rollback behavior, cache invalidation, auth freshness, RLS or permission rules, validation timing, offline or degraded-network behavior, realtime side effects, and error visibility.

5. Compare intent to reality.
   Separate findings into `confirmed bug`, `likely bug`, `UX gap`, `production-hardening gap`, and `open question`. Rank by user impact and blast radius, not by code neatness.

6. Close the case.
   Report findings first, ordered by severity. For each finding include the symptom, the broken user journey step, the technical cause, the concrete evidence, the user impact, the fix direction, and the missing test or guardrail that would have caught it.

## Mingla-Specific Priorities

- Respect the architecture constitution in `README.md`. If a feature violates rules like `No dead taps`, `No silent failures`, `One owner per truth`, `Logout clears everything`, or `No fabricated data`, call that out explicitly.
- Cross-check the repository contracts in `docs/DOMAIN_ADRS.md`, `docs/MUTATION_CONTRACT.md`, `docs/QUERY_KEY_REGISTRY.md`, `docs/IMPLEMENTATION_GATES.md`, and `docs/TRANSITIONAL_ITEMS_REGISTRY.md`.
- For feature readiness, inspect every relevant surface:
  - `app-mobile/` for the user journey, device UX, state ownership, hooks, and services.
  - `mingla-admin/` for moderation or operational flows that enable or contradict the feature.
  - `supabase/functions/` and `supabase/migrations/` for edge logic, schema, triggers, RLS, and data contracts.
  - `outputs/INVESTIGATION_*.md` and `outputs/LAUNCH_READINESS_TRACKER.md` for prior evidence or known regressions.

## Common Failure Patterns

- UI promise exists, but the backend write, invalidation, or refetch never completes.
- Mutation succeeds server-side, but the local cache or store never reflects it.
- RLS, auth freshness, or role checks block real users while dev or admin paths appear healthy.
- One surface is updated, but another still uses stale field names, query keys, or business rules.
- Error states are swallowed, leaving dead taps, infinite spinners, phantom success, or stale UI.
- A feature works in isolation but fails as a full journey because schedules, invites, payments, notifications, analytics, or admin tooling are not wired through.
- Launch blockers hide outside the main code path: missing migration, missing env var, admin-only dependency, rate limit, absent rollback, or no monitoring.

## Working Style

- Follow the data and user journey, not the folder structure.
- Prefer evidence over confidence. Label inference as inference.
- Treat missing telemetry, missing tests, undefined failure handling, and unclear ownership as production-readiness gaps even when the happy path works.
- Avoid declaring a feature production ready unless the full journey, failure handling, and verification story are covered.
- If the user asks for fixes after the investigation, implement the smallest high-confidence repair first and verify the repaired journey with a focused test or reproduction.
