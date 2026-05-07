# Mingla Mobile

Consumer-facing React Native Expo app for discovery, saving, planning, collaboration, event browsing, onboarding, profile, and feedback flows.

This README is app-local. For the full ecosystem map, backend snapshot, and artifact truth system, start at [`../README.md`](../README.md) and [`../Mingla_Artifacts/ARTIFACT_MANIFEST.md`](../Mingla_Artifacts/ARTIFACT_MANIFEST.md).

## Local Setup

```bash
cd app-mobile
npm install
npx expo start
```

The app uses Expo SDK 54 and Expo Router. Some native modules and production-like flows require a development build rather than Expo Go.

## Common Commands

```bash
# Start local dev server
npx expo start

# Run on native targets with dev client tooling
npm run android
npm run ios

# Web target
npm run web

# EAS development builds
npm run build-dev-android
npm run build-dev-ios

# EAS production builds
npm run build-production-android
npm run build-production-ios

# ORCH-0749 regression gate
npm run test:orch-0749
```

## App Architecture Pointers

```text
app-mobile/
  app/                  Expo Router entry and routes
  src/
    components/         Screens, cards, sheets, profile, onboarding, shared UI
    hooks/              React Query hooks, auth/session hooks, feature hooks
    services/           Supabase/API clients and domain services
    contexts/           App-level React contexts
    store/              Zustand client-state store
    constants/          Design tokens, config, categories
    utils/              Shared utilities and app helpers
  scripts/              Mobile-local CI and maintenance scripts
```

## State And Data Rules

- React Query owns server state.
- Zustand owns client-only state and explicitly documented persisted startup state.
- Mutations must surface errors and roll back optimistic state where applicable.
- Query keys must follow the registry and factory rules.
- Temporary fixes must be tagged and tracked before they become permanent.

Core contracts:

| Document | Purpose |
|---|---|
| [`../docs/DOMAIN_ADRS.md`](../docs/DOMAIN_ADRS.md) | Domain ownership and source-of-truth rules. |
| [`../docs/IMPLEMENTATION_GATES.md`](../docs/IMPLEMENTATION_GATES.md) | Pre-code checklist. |
| [`../docs/MUTATION_CONTRACT.md`](../docs/MUTATION_CONTRACT.md) | Mutation behavior and failure contract. |
| [`../docs/QUERY_KEY_REGISTRY.md`](../docs/QUERY_KEY_REGISTRY.md) | Query-key and invalidation contract. |
| [`../docs/TRANSITIONAL_ITEMS_REGISTRY.md`](../docs/TRANSITIONAL_ITEMS_REGISTRY.md) | Temporary work and exit conditions. |

## Environment Variables

Mobile public env vars are read through Expo public config:

```bash
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
EXPO_PUBLIC_MIXPANEL_TOKEN=
```

Backend secrets belong to Supabase and must not be copied into mobile env files.

## Builds

Development builds include the dev client:

```bash
eas build --platform android --profile development
eas build --platform ios --profile development
```

Production builds use the production EAS profile:

```bash
eas build --platform android --profile production
eas build --platform ios --profile production
```

Follow the active ORCH/spec instructions for OTA updates, TestFlight, Play Store, or runtime QA gates. README does not declare release readiness.

## Documentation Boundary

This file should not duplicate global backend counts, migration inventories, or program status. Those live in:

- [`../README.md`](../README.md)
- [`../Mingla_Artifacts/ARTIFACT_MANIFEST.md`](../Mingla_Artifacts/ARTIFACT_MANIFEST.md)
- [`../Mingla_Artifacts/WORLD_MAP.md`](../Mingla_Artifacts/WORLD_MAP.md)
- [`../Mingla_Artifacts/PRODUCT_SNAPSHOT.md`](../Mingla_Artifacts/PRODUCT_SNAPSHOT.md)
- [`../Mingla_Artifacts/PRIORITY_BOARD.md`](../Mingla_Artifacts/PRIORITY_BOARD.md)

When app-local behavior changes, update this README only for mobile setup, app architecture, commands, and local contracts.
