# INVESTIGATION — ORCH-0826 — Convert Mingla monorepo to pnpm workspaces

**Mode:** INVESTIGATE
**Date:** 2026-05-13
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Operator-locked decisions:**
- Package manager: **pnpm**
- Folder layout: **restructure** to `apps/{mobile,business,admin}` + `packages/*`
- Collapse scope: **all known duplicates** (audit performed below — most aren't real duplicates)
- Migration cycle: **weekend / quiet period** focused work block

**Blocks:** ORCH-0824-F Phase 2 (native checkout + calendar) is paused at SPEC awaiting this migration.

---

## Headline

The migration is **smaller than the "all known duplicates" framing initially suggested**. A duplicate-divergence audit shows that:

- The two Expo/RN apps (`app-mobile`, `mingla-business`) are on **identical Expo SDK + React Native + @react-native-*` versions** — no native dep reconciliation risk.
- 10 same-named files exist across the two apps' `src/services/` and `src/utils/` directories — but **every single one is DIVERGED in line count and implementation**. They aren't shared code that should be deduplicated; they're per-app implementations that happen to share a filename.
- Real candidates for `packages/*` extraction are only TWO: `eventTaxonomy.ts` (the 3-copy forced-parity taxonomy module from ORCH-0824) and the upcoming `payments/*` files (post-ORCH-0824-F).
- Migration steps are well-documented (Expo + pnpm + EAS officially support this monorepo pattern since SDK 50).

Net work: ~5-8 focused hours for a careful migration + ~1 day of build validation on iOS + Android + EAS submit.

---

## Phase 1 — Cross-app duplicate audit

### Files with matching names across apps

| File | app-mobile lines | mingla-business lines | Divergence | Real duplicate? |
|---|---|---|---|---|
| `src/constants/designSystem.ts` | (large) | (large) | Different token sets (mingla-business has `accent`, `glass`, `canvas`; app-mobile has `animations`, `touchTargets`, `taglineTypography`) | NO — designed-different per app |
| `src/constants/eventTaxonomy.ts` | 135 | 135 (byte-equivalent) | None — forced parity by CI gate | YES — collapses to package |
| `src/services/supabase.ts` | 108 | 50 | Different (auth + RLS contexts per app) | NO — per-app |
| `src/services/appsFlyerService.ts` | 164 | 269 | Different event taxonomies + project IDs | NO — per-app |
| `src/services/mixpanelService.ts` | 848 | 200 | Massive divergence (consumer has rich event tracking; business has minimal) | NO — per-app |
| `src/services/oneSignalService.ts` | 241 | 91 | Different notification routing | NO — per-app |
| `src/services/revenueCatService.ts` | 297 | 111 | Different subscription products | NO — per-app |
| `src/utils/currency.ts` | 114 | 185 | Diverged formatters | NO — per-app (could merge but not blocking) |
| `src/utils/hapticFeedback.ts` | 138 | 17 | Massive divergence (consumer = rich haptic library; business = stub) | NO — per-app |
| `src/utils/responsive.ts` | 69 | 21 | Different responsive utilities | NO — per-app |

**Verdict: only 1 real duplicate today** (`eventTaxonomy.ts`). The rest are per-app code that simply shares a filename.

### Real candidates for `packages/*`

| Source today | Future package | Why |
|---|---|---|
| `supabase/functions/_shared/eventTaxonomy.ts` + `mingla-business/src/constants/eventTaxonomy.ts` + `app-mobile/src/constants/eventTaxonomy.ts` | `packages/event-taxonomy/` | 3-way forced parity → 1 source. Removes CI parity gate. |
| `mingla-business/src/payments/*` (5 files, post-ORCH-0824-F also needed in app-mobile) | `packages/payments/` | Avoid the parity-gate duplication that ORCH-0824-F's SPEC currently mandates. |

### Files mingla-business has + app-mobile lacks

`platformUrl.ts`, `publicUrls.ts`, `stripeKycRemediationMessages.ts`, `stripeNotificationTemplates.ts`, `stripeSupportedCountries.ts` — mingla-business-only constants. Stay as-is unless ORCH-0824-F or a future ORCH needs them on the consumer side.

### Files app-mobile has + mingla-business lacks

`categories.ts`, `coachMarkSteps.ts`, `colors.ts`, `countries.ts`, `holidays.ts`, `interestIcons.ts`, `languages.ts`, `priceTiers.ts`, `tierLimits.ts`, `urls.ts`, `venuePopularityPatterns.ts` — consumer-only constants. Stay.

---

## Phase 2 — pnpm + Expo + EAS compatibility

### Versions in play

- Expo SDK: **54** (both apps — identical)
- React Native: **0.81.5** (both apps — identical)
- `@react-native-async-storage/async-storage`: `^2.2.0` (both apps — identical)
- `@react-native-community/datetimepicker`: `8.4.4` (both apps — identical)
- mingla-admin: React 19 + Vite (not RN, different stack — still works in pnpm workspaces; just doesn't share native deps)

**No native version conflicts.** Both Expo apps can resolve to the same hoisted `react-native` and `expo` packages in `node_modules` at the workspace root.

### Officially supported config

Expo docs (`https://docs.expo.dev/guides/monorepos/`) cover pnpm + Expo + EAS as a supported pattern since SDK 50. Specifically:

- pnpm workspaces work natively
- Metro must be configured with `nodeModulesPaths` (or `watchFolders`) to look up the monorepo tree
- EAS Build supports monorepo apps via `cli.appRoot` in `eas.json` OR by running `eas build` from the app subdirectory
- Native modules resolve correctly thanks to pnpm's strict node_modules symlink structure (modules are not hoisted unless explicitly allowed)

### Specific pnpm settings needed

`pnpm-workspace.yaml` at repo root:
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

`.npmrc` at repo root (Expo-specific):
```
node-linker=hoisted
public-hoist-pattern[]=*react-native*
public-hoist-pattern[]=*expo*
public-hoist-pattern[]=*metro*
shamefully-hoist=false
```

`hoisted` linker + selective hoist patterns are the Expo-recommended config. Strict isolation breaks some RN native modules; hoisted is the safe default.

### Per-app `metro.config.js` changes

Each Expo app needs to add `watchFolders` + `nodeModulesPaths`:

```js
const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
```

(mingla-business's existing zustand-CJS override is preserved.)

### `eas.json` changes

EAS Build needs `cli.appRoot` or running from the app subdir. Recommend `cli.appRoot` for clarity:

```json
{
  "cli": {
    "version": ">= 16.25.1",
    "appVersionSource": "remote",
    "appRoot": "apps/mobile"
  }
}
```

One `eas.json` per app, with each pointing at its own subdir. EAS will then correctly bundle the workspace's hoisted node_modules.

---

## Phase 3 — Native build pipeline impact

### What changes

- iOS native projects (`apps/mobile/ios/`, `apps/business/ios/`) — paths inside the project change, but Expo's `prebuild` regenerates them. `ios/Podfile` may need `node_modules` path adjustments (Expo handles this automatically post-pnpm-install).
- Android (`android/build.gradle`) — same story; Expo's Gradle integration handles workspace node_modules resolution.

### What does NOT change

- Bundle identifiers — same
- Signing certificates — same
- App Store / Play Store records — same
- EAS Build credentials — same
- Submit pipeline (`eas submit`) — same, just runs from new path
- TestFlight + Play Store internal track — existing builds keep working; new builds from the new structure submit identically

### Risk: native module resolution

The biggest historical pain point in Expo monorepos: native modules that have post-install hooks (e.g., `expo`, `expo-modules-core`) sometimes resolve the wrong path when hoisted. Mitigation:
- Use pnpm's `hoist-pattern[]` to keep `expo` + `react-native` + `metro` accessible at the workspace root
- Run `expo prebuild --clean` after migration to regenerate native projects from scratch
- Test iOS + Android builds locally BEFORE merging the migration

### Risk: development client (dev build) breakage

The current dev build the operator is running might stop working after the migration until a fresh `eas build --profile development` runs. **Implementor must coordinate the dev-build cycle as part of the migration runbook** so the operator doesn't lose their sim setup mid-work.

---

## Phase 4 — CI workflow impact

### Workflow files to update

```
.github/workflows/strict-grep-mingla-business.yml
.github/workflows/deploy-functions.yml
.github/workflows/docs-artifact-regression.yml
.github/workflows/rotate-apple-jwt.yml
.github/workflows/stripe-connect-smoke.yml
.github/workflows/supabase-migrations-and-stripe-deno.yml
```

Per-file updates:
- Path filters (e.g., `paths: ["mingla-business/**"]` → `paths: ["apps/business/**"]`)
- Workspace install commands (`pnpm install` at root, `pnpm --filter business test`)
- Working directory references in test steps

### Strict-grep gates that become obsolete

- `orch-0824-event-taxonomy-parity.mjs` — collapsed to a single `packages/event-taxonomy/` source, no parity to enforce. **DELETE** after migration.

### Strict-grep gates that survive

- `i37-topbar-cluster.mjs`, `i38-icon-chrome-touch-target.mjs`, `i39-pressable-label.mjs` — app-internal CI gates; only path filter updates.
- All `orch-0xxx-*` gates that scan app-internal patterns — same, only path-filter updates.
- The ORCH-0824-F gates (public-event-body-parity, stripe-payment-sheet-parity) — **never need to be written** if we collapse to `packages/event-body/` and `packages/payments/` during this migration.

---

## Phase 5 — Migration runbook (high-level)

| # | Step | Risk |
|---|---|---|
| 1 | Snapshot branch state. Confirm no in-flight PRs on `Seth`. | Low |
| 2 | Install pnpm globally. `npm install -g pnpm`. | Low |
| 3 | Create root `package.json` + `pnpm-workspace.yaml` + `.npmrc`. | Low |
| 4 | `git mv app-mobile apps/mobile` + `git mv mingla-business apps/business` + `git mv mingla-admin apps/admin`. | Low — git preserves history. |
| 5 | Update each app's `metro.config.js` for monorepo watchFolders. | Medium — may break Metro until correct |
| 6 | Update each `eas.json` with `cli.appRoot`. | Medium — verify with `eas build --dry-run` |
| 7 | Update CI workflow path filters. | Low |
| 8 | Create `packages/event-taxonomy/` from one of the three current copies. Update three current sites to import from package. Delete duplicates. | Medium — TS strict will catch import errors immediately |
| 9 | (If ORCH-0824-F is already implemented w/ byte-equivalent) Create `packages/payments/` similarly. (If not yet implemented, skip — ORCH-0824-F resumes against the new structure and writes payments as a package from the start.) | Low if skipped |
| 10 | `rm -rf node_modules` in old app dirs + run `pnpm install` at root. | Medium — may surface unresolved peer deps |
| 11 | `cd apps/mobile && pnpm expo prebuild --clean` + run iOS sim build locally to validate. | High — biggest risk surface |
| 12 | Repeat for `apps/business`. | High |
| 13 | Run all CI gates locally; fix any path issues. | Medium |
| 14 | Commit migration as a single atomic commit on `Seth`. Push. | Low |
| 15 | Operator pulls + tests dev builds on sim. Re-runs `eas build --profile development` if needed. | Medium |
| 16 | After 24-48hr soak, run `eas build --profile production` for both apps to confirm production builds work. | High but reversible |
| 17 | Merge to `main`. | Low |

### Rollback plan

The migration is one big commit. Rollback = `git revert <migration-commit>` + `pnpm install` (or fall back to per-app `npm install`). Pre-migration `node_modules` is gone, but `package.json` records pin every version exactly, so reinstall is deterministic. **Worst case: 30-60 minute restore.**

---

## Phase 6 — Specific decisions for SPEC

### Open SPEC questions

1. **Folder rename strategy**: `git mv` preserves history (Git tracks the rename). Should we do one big mv per app or smaller commits per file? Recommendation: one mv per app, three commits (mobile, business, admin), then a fourth for root config additions. Easier to bisect if something breaks.

2. **pnpm version pin**: pin pnpm version in `package.json.packageManager` field (`"packageManager": "pnpm@9.x.x"`)? Strongly recommend yes — prevents drift between operator's machine + CI.

3. **Hoist patterns**: which packages need `public-hoist-pattern[]`? Recommend the standard Expo set (`react-native*`, `expo*`, `metro*`) plus anything that breaks during testing. Iterative.

4. **EAS Build profile names**: keep `development`, `preview`, `production` as today, just point them at the new appRoot. Recommend yes.

5. **Existing `eas update` (OTA) channel mappings**: today the OTAs target `production` branch per app. Migration doesn't change channel mappings, but the EAS update command runs from `apps/mobile` or `apps/business` instead of `app-mobile` / `mingla-business`. Operator workflow change: just `cd apps/mobile && eas update ...` going forward.

6. **`packages/payments/` v1 location vs ORCH-0824-F coordination**: if ORCH-0824-F resumes AFTER this migration lands, it writes payments as `packages/payments/` from the start (skipping the byte-equivalent intermediate). Recommended sequence: ORCH-0826 first, then ORCH-0824-F.

### Native rebuild gate (still applies)

The migration itself doesn't force a native rebuild for *existing* TestFlight users (their installed app keeps working). But the dev-client cycle DOES need fresh builds (`eas build --profile development`) for both apps before the operator can resume sim work. **One-time, ~30 min per platform per app.**

---

## Phase 7 — Risk register

| Risk | Likelihood | Severity | Mitigation |
|---|---|---|---|
| Metro fails to resolve a hoisted native module | Medium | High | Iterative `public-hoist-pattern[]` until clean; can fall back to `node-linker=hoisted` for maximum compatibility |
| Existing dev build breaks for operator mid-migration | High | Medium | Run `eas build --profile development` BEFORE merging migration; operator pulls + rebuilds dev client at the same time |
| Hidden cross-app relative imports break | Low | Medium | Already verified zero today (grep found none) |
| pnpm-specific peer dep warnings flood the build | Medium | Low | Suppress with `auto-install-peers=true` in .npmrc |
| CI workflows fail on path filter updates | Medium | Low | Each workflow has a `paths` array; mechanical search-and-replace |
| EAS Build can't find appRoot | Low | High | Verify with `eas build --dry-run` before first real build |
| iOS native build picks up wrong Pods cache | Medium | Medium | `cd ios && pod deintegrate && pod install` after migration |
| Operator's existing `eas update` muscle memory breaks | Low | Low | Working dir changes; doc + alias if needed |

### Highest-risk surface

**iOS + Android native build resolution after the first `pnpm install` post-migration.** This is the most likely thing to surface issues. Mitigation: have implementor verify `pnpm install + pnpm --filter mobile run ios` (and android) on the migration branch BEFORE merging to `Seth`. If those work, everything else is mechanical.

---

## Phase 8 — What this migration unblocks

Once ORCH-0826 lands, these become trivial 1-line imports instead of duplicate-management:

- ORCH-0824-F (Phase 2): native checkout + calendar — `<PublicEventBody>` becomes `import { PublicEventBody } from "@mingla/event-body"` in both apps. No CI parity gate needed.
- Stripe payment-sheet wrappers — `import { useStripePaymentSheet } from "@mingla/payments"`.
- `eventTaxonomy.ts` — `import { PARTY_TYPES, VIBE_TAGS, MUSIC_GENRES } from "@mingla/event-taxonomy"`.
- Future cross-app types (e.g., `LiveEvent` shape if we ever extract it).
- Future cross-app components (e.g., a `<BrandChip>` if both apps need to render brand identifiers consistently).

The eventTaxonomy parity CI gate (~120 LOC of node script + 1 workflow job entry) is **deleted** after migration. Same for the public-event-body parity gate ORCH-0824-F would otherwise need.

---

## Phase 9 — Confidence

**High** on the audit findings (file system + diff + version grep), **high** on the pnpm + Expo + EAS compatibility (officially-documented pattern), **medium** on the rollout risk (native builds are the main wildcard — but reversible).

Net-net: this is a real but well-bounded piece of work. The 1-day weekend block the operator scoped is realistic if no surprises hit the native build step.

---

## Discoveries for orchestrator

- The "all known duplicates" framing was over-broad. Real duplicates are minimal (`eventTaxonomy.ts` + the upcoming `payments/*`). Most same-named files are per-app implementations that happen to share filenames and shouldn't be collapsed.
- ORCH-0824-F's SPEC needs to be RE-WRITTEN after ORCH-0826 lands to reference the workspace structure instead of byte-equivalent duplicates. Effort: minor — replace the parity-gate sections with `import` statements.
- `mingla-admin` is a different stack (React 19 + Vite, no RN). It can join the workspace too (gains nothing today but symmetric structure), or remain a sibling outside `apps/`. Recommend including for consistency.
- One follow-up ORCH candidate (ORCH-0826-A): convert all currently-divergent same-named files into either (a) genuinely shared packages with per-app overrides, or (b) renamed files that don't pretend to be duplicates. Optional polish.

---

NEXT HANDOFF — paste into operator review (NOT yet for implementor):

Operator: please review `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0826_WORKSPACE_MIGRATION.md`. Decisions for SPEC: (1) confirm one big migration commit per `git mv apps/*` step (recommended — 4 commits total: 3 renames + 1 root config); (2) confirm `packageManager` pnpm version pin in root package.json; (3) confirm `mingla-admin` is included in the workspace structure (recommended — symmetric); (4) confirm `packages/payments/` is created during this ORCH (assumes ORCH-0824-F hasn't started implementing yet); (5) confirm migration timing — when is the weekend block? After your answers, I write the SPEC with the exact migration runbook, file-by-file. Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
