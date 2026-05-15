# Mingla

Mingla helps people discover experiences, plan with friends, and run the operational surfaces that keep the ecosystem healthy.

## Ecosystem Snapshot

Mingla is a monorepo with five active product and tooling surfaces:

| Surface | Path | Role |
|---|---|---|
| Consumer mobile app | [`app-mobile/`](app-mobile/) | React Native Expo app for discovery, saving, planning, collaboration, events, feedback, and user profile flows. |
| Business app | [`mingla-business/`](mingla-business/) | React Native Expo app for organisers, brands, public events, Stripe Connect, orders, QR, guest lists, and business operations. |
| Admin dashboard | [`mingla-admin/`](mingla-admin/) | React 19 + Vite dashboard for operations, moderation, trials, seeding, analytics, support, and backend visibility. |
| Marketing site | [`mingla-marketing/`](mingla-marketing/) | Next.js marketing/public web surface. |
| Backend and tooling | [`supabase/`](supabase/), [`scripts/`](scripts/), [`docs/`](docs/), [`Mingla_Artifacts/`](Mingla_Artifacts/) | Supabase edge functions, migrations, operational scripts, source-of-truth docs, and the artifact operating system. |

## Source Of Truth

README is a snapshot. It is not the whole truth system.

| Need | Link |
|---|---|
| What is current, historical, superseded, or private? | [`Mingla_Artifacts/ARTIFACT_MANIFEST.md`](Mingla_Artifacts/ARTIFACT_MANIFEST.md) |
| What is the current program map? | [`Mingla_Artifacts/WORLD_MAP.md`](Mingla_Artifacts/WORLD_MAP.md) |
| What changed recently? | [`Mingla_Artifacts/PRODUCT_SNAPSHOT.md`](Mingla_Artifacts/PRODUCT_SNAPSHOT.md) |
| What should happen next? | [`Mingla_Artifacts/PRIORITY_BOARD.md`](Mingla_Artifacts/PRIORITY_BOARD.md) |
| What is the current product roadmap and PMM plan? | [`Mingla_Roadmap/README.md`](Mingla_Roadmap/README.md) |
| What decisions are binding? | [`Mingla_Artifacts/DECISION_LOG.md`](Mingla_Artifacts/DECISION_LOG.md) |
| What invariants must hold? | [`Mingla_Artifacts/INVARIANT_REGISTRY.md`](Mingla_Artifacts/INVARIANT_REGISTRY.md) |
| What documentation link debt exists? | [`Mingla_Artifacts/reports/ORCH-0750A_LINK_AUDIT.md`](Mingla_Artifacts/reports/ORCH-0750A_LINK_AUDIT.md) |
| Where is historical material archived? | [`Mingla_Artifacts/archive/README.md`](Mingla_Artifacts/archive/README.md) |

The link system is measured, not fully clean yet. ORCH-0750A established the checker, ORCH-0750C created the archive structure, and ORCH-0750D locks the documentation system into skills and CI. Future archive/delete work must go through the manifest first.

## Last Synced

| Field | Value |
|---|---|
| Date | 2026-05-07 |
| Commit | `8168cf16` |
| Function count command | `find supabase/functions -mindepth 1 -maxdepth 1 -type d ...` |
| Function directories | 66 including `_shared`; 65 deployable directories excluding `_shared` |
| Migration count command | `find supabase/migrations -maxdepth 1 -type f -name '*.sql' ...` |
| Active migration files | 26 |
| Link checker | `python3 scripts/docs/check_links.py --format markdown` |
| Link baseline gate | `python3 scripts/docs/check_links.py --baseline-file scripts/docs/link_baseline.json` |
| Artifact placement gate | `python3 scripts/docs/check_artifact_placement.py` |
| README snapshot gate | `python3 scripts/docs/check_readme_snapshot.py` |

These counts are a snapshot at the commit above. Re-run the commands before updating this README.

## Architecture Constitution

Every change must preserve these rules. If a change violates one, the implementation report or PR must call it out explicitly.

1. **No dead taps.** Primary interactions show visible UI response before non-critical network work.
2. **One owner per truth.** Every important domain fact has one authoritative owner.
3. **No silent failures.** State-changing actions surface errors through logs, thrown results, UI, toast, or rollback.
4. **One key per entity.** Entity families use one query-key factory and invalidate through the factory.
5. **Server state stays server-side.** Server-authoritative state is not persisted locally unless a documented offline contract exists.
6. **Logout clears everything.** Private local data clears from React Query, Zustand, AsyncStorage, queues, and realtime channels.
7. **Label what's temporary.** Transitional work is tagged and tracked in the transitional registry.
8. **Subtract before adding.** Remove the competing stale path before adding a replacement.
9. **No fabricated data.** Missing data is hidden or shown as `--`; fake values are worse than blank states.
10. **Currency-aware everywhere.** Price display must use locale/currency plumbing, not hardcoded symbols.
11. **One auth instance.** Root auth owns auth state; other components read the store or receive props.
12. **Validate at the right time.** Time checks use the user's selected datetime, not current clock time.
13. **Serving exclusions stay consistent.** Card-serving paths must apply the same exclusion families and safety checks.
14. **Prefer persisted state for instant startup.** Hydrated local state renders first where appropriate, then server refresh follows.

Supporting contracts:

| Document | Purpose |
|---|---|
| [`docs/DOMAIN_ADRS.md`](docs/DOMAIN_ADRS.md) | Domain ownership and source-of-truth decisions. |
| [`docs/IMPLEMENTATION_GATES.md`](docs/IMPLEMENTATION_GATES.md) | Required pre-code checklist. |
| [`docs/MUTATION_CONTRACT.md`](docs/MUTATION_CONTRACT.md) | State-changing operation contract. |
| [`docs/QUERY_KEY_REGISTRY.md`](docs/QUERY_KEY_REGISTRY.md) | Query-key factories and invalidation rules. |
| [`docs/TRANSITIONAL_ITEMS_REGISTRY.md`](docs/TRANSITIONAL_ITEMS_REGISTRY.md) | Temporary work with owners and exit conditions. |

## Repo Map

```text
Mingla/
  app-mobile/          Consumer Expo app
  mingla-business/     Organiser/business Expo app
  mingla-admin/        Admin dashboard, React + Vite
  mingla-marketing/    Marketing site, Next.js
  supabase/
    functions/         Edge functions plus _shared utilities
    migrations/        Active post-squash migration chain
  scripts/             Repo and documentation tooling
  docs/                Architecture and implementation contracts
  Mingla_Artifacts/    Program operating system and evidence trail
    archive/           Historical/superseded material, indexed by manifest
  Mingla_Roadmap/      Product, marketing, GTM, launch, research, and enablement planning system
    archive/           Superseded roadmap material, indexed by roadmap manifest
  tests/               Repo-level tests and harnesses
```

## Current Backend Snapshot

At the sync commit, `supabase/functions/` contains 66 function directories including `_shared`, or 65 deployable function directories excluding `_shared`. README intentionally does not keep a long hand-maintained function table. Re-run the inventory commands in the Last Synced block when updating backend claims.

`supabase/migrations/` contains 26 active SQL migration files at the sync commit. Earlier migration history from the ORCH-0729 squash is preserved in [`Mingla_Artifacts/migrations_archive_orch_0729_2026-05-05/`](Mingla_Artifacts/migrations_archive_orch_0729_2026-05-05/); that archive is historical evidence, not junk.

## App Surfaces

| Surface | Local docs | Common command |
|---|---|---|
| Consumer mobile | [`app-mobile/README.md`](app-mobile/README.md) | `cd app-mobile && npx expo start` |
| Business app | [`mingla-business/README.md`](mingla-business/README.md) | `cd mingla-business && npx expo start` |
| Admin dashboard | [`mingla-admin/README.md`](mingla-admin/README.md) | `cd mingla-admin && npm run dev` |
| Marketing site | `mingla-marketing/` | `cd mingla-marketing && npm run dev` |

Some app-local READMEs may still contain older setup prose. Root README owns the global ecosystem snapshot; app READMEs own only their local setup and surface-specific guidance.

## Local Development

Install dependencies in the surface you are working on:

```bash
cd app-mobile
npm install
npx expo start
```

```bash
cd mingla-business
npm install
npx expo start
```

```bash
cd mingla-admin
npm install
npm run dev
```

```bash
cd mingla-marketing
npm install
npm run dev
```

Supabase local function serving and migrations are handled from `supabase/` when a spec explicitly requires backend work:

```bash
cd supabase
supabase functions serve
supabase db push
```

For release flows, follow the active orchestrator/spec instructions. Supabase migration application is operator-gated; edge function deploys require the approved lifecycle gate.

## Store Submissions (EAS Submit)

Both mobile apps are wired for automated store submission via `eas submit`. Submissions are scoped to safe defaults: Android lands as a **draft in the internal testing track**, iOS lands in **TestFlight**. Final production rollout always requires a manual click in Play Console / App Store Connect.

| App | Android command (from app dir) | iOS command (from app dir) |
|---|---|---|
| Mingla Business | `cd mingla-business && eas submit --platform android --latest` | `cd mingla-business && eas submit --platform ios --latest` |
| Mingla Consumer | `cd app-mobile && eas submit --platform android --latest` | `cd app-mobile && eas submit --platform ios --latest` |

Credential layout:

| Credential | Where it lives | Notes |
|---|---|---|
| Google Play service account JSON | `~/.mingla-secrets/playstore-mingla.json` (mode 600) | Account `eas-submit@mingla-dev.iam.gserviceaccount.com`. Scoped to testing tracks on both apps. Has NO production-release permission by design. |
| Apple App Store Connect API key | Stored in EAS (`H46434D7Z9`, Admin role, issuer `ee78d0ff-158c-4326-80ef-aec69745fc2d`) | Managed by EAS internally; no `.p8` file required on disk. |

The Google service-account JSON is git-ignored (`.gitignore:48` covers `play-service-account.json`; `~/.mingla-secrets/` lives outside the repo). The `eas.json` `submit.production` blocks reference the absolute path. The `~/.mingla-secrets/` directory is mode 700 / file mode 600 — only the owning user can read.

Safety boundaries baked in:

- Android submissions land as **draft** in the **internal** testing track. Promotion to production tracks requires manual Play Console action.
- The Play service account is intentionally scoped without `Release to production` permission. Even a misfired `eas submit` cannot reach production-track users.
- iOS submissions land in TestFlight. App Store Review submission still requires manual ASC action.

Android-specific: `mingla-business` ships with an Expo config plugin at `mingla-business/plugins/withAdiRegistration.js` that writes `assets/adi-registration.properties` into Android APK builds to satisfy Play Console package-name verification. A dedicated `production-apk` build profile in `mingla-business/eas.json` produces signed APKs for that verification flow.

## Verification And Maintenance

Use these checks when touching documentation:

```bash
python3 scripts/docs/check_links.py --format markdown
python3 scripts/docs/check_links.py --baseline-file scripts/docs/link_baseline.json
python3 scripts/docs/check_artifact_placement.py
python3 scripts/docs/check_readme_snapshot.py
```

Use these checks when refreshing README inventory:

```bash
git rev-parse --short HEAD
find supabase/functions -mindepth 1 -maxdepth 1 -type d | sed 's#supabase/functions/##' | sort | wc -l
find supabase/functions -mindepth 1 -maxdepth 1 -type d ! -name '_shared' | sed 's#supabase/functions/##' | sort | wc -l
find supabase/migrations -maxdepth 1 -type f -name '*.sql' | sed 's#supabase/migrations/##' | sort | wc -l
find . -maxdepth 2 -name package.json -not -path './node_modules/*' -print | sort
```

Do not use ignored prompt files as durable README evidence. Link to reports, specs, decisions, invariants, the manifest, or live source commands instead.
