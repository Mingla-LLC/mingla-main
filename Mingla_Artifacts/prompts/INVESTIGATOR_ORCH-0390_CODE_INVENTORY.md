# Investigation: Full Code Inventory (ORCH-0390 Dispatch 1)

## Mission

Produce a complete, verified inventory of every edge function, every mobile service file, and every environment variable in the Mingla monorepo. This inventory becomes the ground truth that all documentation updates depend on.

## Context

The repo's README claims "71 edge functions" (root) and "27 edge functions" (app-mobile README). We just deleted 4 dead edge functions. Nobody has verified the actual count. Similarly, app-mobile/src/services/ has ~75 service files but no canonical inventory. Environment variables are scattered across .env, .env.example, and hardcoded in code — nobody knows the full list.

This investigation does NOT write code. It reads, counts, and produces a reference document.

## Scope

### IN SCOPE
1. Every edge function in `supabase/functions/` (excluding `_shared/`)
2. Every service file in `app-mobile/src/services/`
3. Every shared utility in `supabase/functions/_shared/`
4. Every environment variable used across the monorepo
5. Admin dashboard data fetching patterns (`mingla-admin/src/`)

### OUT OF SCOPE
- Dead code detection (already done in ORCH-0390 Phase 1)
- Hooks, components, utils (covered in Dispatch 2 or not needed)
- Fixing anything — read-only investigation

## Deliverables

### 1. Edge Function Inventory

For EACH edge function directory in `supabase/functions/` (excluding `_shared/`):

| Field | What to Record |
|-------|---------------|
| Name | Directory name |
| Purpose | One-line description from reading the code |
| Trigger | How it's called: client invoke, pg_cron, pg_net trigger, database trigger, or other edge function |
| Auth | Who can call it: authenticated user, service_role only, anonymous, or mixed |
| Caller(s) | Exact file(s) that invoke it (e.g., `app-mobile/src/services/otpService.ts:22`) |
| External APIs | Any third-party APIs called (Google, OneSignal, Twilio, OpenAI, etc.) |
| Env Vars | Environment variables read via `Deno.env.get()` |
| DB Tables | Tables queried or modified |
| Shared Imports | Which `_shared/` utilities it imports |

Count the total. This is the authoritative number for the README.

### 2. Shared Utility Inventory (`_shared/`)

For each file in `supabase/functions/_shared/`:

| Field | What to Record |
|-------|---------------|
| Name | File name |
| Purpose | What it provides |
| Exports | Functions/classes/constants exported |
| Consumers | Which edge functions import from it |
| External APIs | Any third-party APIs called |
| Env Vars | Environment variables read |

### 3. Mobile Service Inventory

For EACH file in `app-mobile/src/services/`:

| Field | What to Record |
|-------|---------------|
| Name | File name |
| Purpose | One-line description |
| Edge Functions Called | Which edge functions it invokes (if any) |
| External SDKs | Direct SDK usage (RevenueCat, AppsFlyer, Mixpanel, OneSignal, etc.) |
| Supabase Tables | Direct table queries (not via edge functions) |
| Exported Functions | List of exports (function names only, not signatures) |
| Key Consumers | Major hooks/components that import from it (top 3) |

Count the total. This is the authoritative number for the README.

### 4. Environment Variable Registry

Produce a complete table of every environment variable used across the monorepo:

| Variable | Where Used | Where Set | Required? | Notes |
|----------|-----------|-----------|-----------|-------|
| e.g. EXPO_PUBLIC_MIXPANEL_TOKEN | mixpanelService.ts | NOT SET | Yes (analytics dead without it) | Missing from .env and .env.example |

Sources to check:
- `app-mobile/.env` and `.env.example` — what's documented
- `app-mobile/src/**/*.ts` — grep for `process.env.` and `Constants.expoConfig`
- `supabase/functions/**/*.ts` — grep for `Deno.env.get`
- `mingla-admin/.env` and `.env.local` — admin dashboard
- `app.json` / `app.config.js` — Expo config
- Hardcoded keys in source (note security implications)

Flag any variable that is:
- Used in code but NOT in any .env file (like MIXPANEL_TOKEN)
- In .env but NOT used in any code (dead config)
- Hardcoded in source when it should be in .env (security risk)

### 5. Admin Dashboard Data Patterns

Brief inventory of how `mingla-admin/` fetches data:

| Page | Data Source | Method |
|------|-----------|--------|
| e.g. PlacePoolManagementPage | admin-seed-places, admin-place-search | supabase.functions.invoke() |

This tells us which edge functions the admin depends on.

## Constraints

- Read-only. Do not modify any files.
- If you're uncertain about a function's purpose, read the actual code — don't guess from the name.
- Include EVERY edge function, not just the ones you think are important.
- Count empty directories (directory exists but no index.ts) separately.

## Output

Save as: `Mingla_Artifacts/outputs/INVESTIGATION_CODE_INVENTORY.md`

Structure:
```
# Code Inventory (ORCH-0390 Dispatch 1)
> Date: 2026-04-11
> Verified by: Forensic code read (not grep alone)

## Summary
- Edge functions: [exact count]
- Shared utilities: [exact count]
- Mobile services: [exact count]
- Environment variables: [total] ([set] configured, [missing] missing, [dead] unused)

## 1. Edge Function Inventory
[table]

## 2. Shared Utility Inventory
[table]

## 3. Mobile Service Inventory
[table]

## 4. Environment Variable Registry
[table]

## 5. Admin Dashboard Data Patterns
[table]

## Discrepancies Found
[anything that contradicts current documentation]
```

## Anti-Patterns
- Do NOT skip edge functions because they look unimportant
- Do NOT guess purpose from file names — read the code
- Do NOT conflate "shared utilities" with "edge functions" in the count
- Do NOT include `_shared/` in the edge function count (it's not a deployable function)
