# Mingla

Mingla helps people discover experiences, plan with friends, and run the operational surfaces that keep the ecosystem healthy. Both apps are live on the App Store and Google Play.

README is a snapshot front door. The truth system is small and lives in two places: **work** is tracked as issues on the Mingla Avengers board, and **durable knowledge** lives in the four canonical docs plus `docs/`.

## How We Work

All work — bugs, features, ideas, discoveries — is a GitHub issue on the [Mingla Avengers board](https://github.com/orgs/Mingla-LLC/projects/4). The board README is the operating manual. In short:

- **Issue titles are plain English** a user would understand; the issue number is the work ID.
- Branches are named `<issue#>-short-slug`; PRs say `Fixes #<issue#>`.
- **Status** tracks the lifecycle: `Todo` → `In Progress` (being built) → `In Review` (PR open / testing) → `Done` (merged + verified; auto-closes the issue).
- Investigation findings, specs, implementation notes, and test evidence go in **issue comments** — not repo .md files.
- When something ships, one line is appended to [`REPORTS.md`](REPORTS.md).

The pre-2026-07-19 operating system (`Mingla_Artifacts/`, `Mingla_Roadmap/`, per-ORCH docs) is retired; all of it is preserved at git tag `pre-avengers-archive`.

## Source Of Truth

| Need | Where |
|---|---|
| What is being worked on, and its state? | [Mingla Avengers board](https://github.com/orgs/Mingla-LLC/projects/4) and its issues |
| Product, positioning, roadmap, strategy | [`PRODUCT_AND_STRATEGY.md`](PRODUCT_AND_STRATEGY.md) |
| Marketing channels, attribution, motions | [`MARKETING.md`](MARKETING.md) |
| Cross-session coordination | [`COMMS.md`](COMMS.md) |
| What shipped, when | [`REPORTS.md`](REPORTS.md) |
| Engineering invariants that must hold | [`docs/INVARIANT_REGISTRY.md`](docs/INVARIANT_REGISTRY.md) |
| Stack conventions + Constitution detail | [`docs/MINGLA_ENGINEERING_HANDBOOK.md`](docs/MINGLA_ENGINEERING_HANDBOOK.md) |
| Worktree / branch discipline | [`docs/WORKTREE_STRATEGY.md`](docs/WORKTREE_STRATEGY.md) |
| Historical material (pre-migration) | git tag `pre-avengers-archive` |

## Ecosystem Snapshot

| Surface | Path | Role |
|---|---|---|
| Consumer mobile app | [`app-mobile/`](app-mobile/) | React Native Expo app for discovery, saving, planning, collaboration, events, feedback, and user profile flows. |
| Business app | [`mingla-business/`](mingla-business/) | React Native Expo app for organisers, brands, public events, Stripe Connect, orders, QR, guest lists, and business operations. Also serves buyer web. |
| Admin dashboard | [`mingla-admin/`](mingla-admin/) | React 19 + Vite dashboard for operations, moderation, trials, seeding, analytics, support, and backend visibility. |
| Marketing site | [`mingla-marketing/`](mingla-marketing/) | Next.js marketing/public web surface. |
| Backend and tooling | [`supabase/`](supabase/), [`scripts/`](scripts/), [`docs/`](docs/) | Supabase edge functions, migrations, operational scripts, and engineering reference docs. |

## Architecture Constitution

Every change must preserve these rules. If a change violates one, the PR must call it out explicitly.

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
| [`docs/runbooks/ANDROID_SIGNING_AND_DEEP_LINK_REGISTRY.md`](docs/runbooks/ANDROID_SIGNING_AND_DEEP_LINK_REGISTRY.md) | Android signing certificates, where each is registered, and the pre-release check. |

## Repo Map

```text
Mingla/
  app-mobile/          Consumer Expo app
  mingla-business/     Organiser/business Expo app + buyer web
  mingla-admin/        Admin dashboard, React + Vite
  mingla-marketing/    Marketing site, Next.js
  supabase/
    functions/         Edge functions plus _shared utilities
    migrations/        Active migration chain
  packages/            Shared workspace packages
  scripts/             Repo and documentation tooling
  docs/                Engineering references, contracts, runbooks
  tools/               Diagnostic harnesses
  tests/               Repo-level tests (append-only, CI-gated)
```

## App Surfaces

| Surface | Local docs | Common command |
|---|---|---|
| Consumer mobile | [`app-mobile/README.md`](app-mobile/README.md) | `cd app-mobile && npx expo start` |
| Business app | [`mingla-business/README.md`](mingla-business/README.md) | `cd mingla-business && npx expo start` |
| Admin dashboard | [`mingla-admin/README.md`](mingla-admin/README.md) | `cd mingla-admin && npm run dev` |
| Marketing site | `mingla-marketing/` | `cd mingla-marketing && npm run dev` |

## Local Development

Install dependencies in the surface you are working on:

```bash
cd app-mobile && npm install && npx expo start
```

```bash
cd mingla-business && npm install && npx expo start
```

```bash
cd mingla-admin && npm install && npm run dev
```

```bash
cd mingla-marketing && npm install && npm run dev
```

Supabase local function serving and migrations are handled from `supabase/`:

```bash
cd supabase
supabase functions serve
supabase db push
```

Supabase migration application is operator-gated; edge function deploys happen only from merged `main`.

The agent guard is not wired up by a clone. `.claude/` is gitignored, so the hook that runs it is per-machine. Add it once, in `.claude/settings.json`:

```json
{ "hooks": { "PreToolUse": [ { "matcher": "Bash",
  "hooks": [ { "type": "command", "command": "$CLAUDE_PROJECT_DIR/scripts/agent-guard/bash-guard.py" } ] } ] } }
```

Until that line exists, a fresh clone has no guard at all — the script is present and does nothing. See Agent Guards below.

## Store Submissions (EAS Submit)

Both mobile apps are wired for automated store submission via `eas submit`. Submissions are scoped to safe defaults: Android lands as a **draft in the internal testing track**, iOS lands in **TestFlight**. Final production rollout always requires a manual click in Play Console / App Store Connect.

| App | Android command (from app dir) | iOS command (from app dir) |
|---|---|---|
| Mingla Host | `cd mingla-business && eas submit --platform android --latest` | `cd mingla-business && eas submit --platform ios --latest` |
| Mingla Consumer | `cd app-mobile && eas submit --platform android --latest` | `cd app-mobile && eas submit --platform ios --latest` |

Credential layout:

| Credential | Where it lives | Notes |
|---|---|---|
| Google Play service account JSON | `~/.mingla-secrets/playstore-mingla.json` (mode 600) | Account `eas-submit@mingla-dev.iam.gserviceaccount.com`. Scoped to testing tracks on both apps. Has NO production-release permission by design. |
| Apple App Store Connect API key | Stored in EAS (`H46434D7Z9`, Admin role, issuer `ee78d0ff-158c-4326-80ef-aec69745fc2d`) | Managed by EAS internally; no `.p8` file required on disk. |

Safety boundaries baked in:

- Android submissions land as **draft** in the **internal** testing track; promotion to production requires manual Play Console action.
- The Play service account is intentionally scoped without `Release to production` permission.
- iOS submissions land in TestFlight; App Store Review submission still requires manual ASC action.

Android-specific: `mingla-business` ships with an Expo config plugin at `mingla-business/plugins/withAdiRegistration.js` that writes `assets/adi-registration.properties` into Android APK builds to satisfy Play Console package-name verification. A dedicated `production-apk` build profile in `mingla-business/eas.json` produces signed APKs for that verification flow.

## Verification And Maintenance

Use these checks when touching documentation:

```bash
python3 scripts/docs/check_links.py --baseline-file scripts/docs/link_baseline.json
python3 scripts/docs/check_artifact_placement.py
python3 scripts/docs/check_readme_snapshot.py
```

Both apps ship the SAME version — bump `app-mobile` and `mingla-business` together (CI parity gate enforces it).

## Agent Guards

`scripts/agent-guard/bash-guard.py` is a `PreToolUse`/`Bash` hook that refuses command shapes which have destroyed, or nearly destroyed, work in this repo. It blocks four groups:

| Group | Blocked |
|---|---|
| Destroying local work | `git reset --hard`, whole-tree `git checkout .` / `git restore .`, `git clean -fd`, `git add -A` |
| Rewriting shared history | force-push, `git branch -D` |
| Operator-only GitHub state | `gh pr merge`, `gh repo delete/edit/archive`, ruleset / branch-protection / permissions writes, destructive `gh api ... -X DELETE` |
| Cost and production | `--watch` CI polling (one org-wide API quota), `supabase db push` / `db reset` |

It also warns, without blocking, on `git reset origin/<ref>` — resetting against a remote ref that has moved stages the reversal of everything landed since you branched.

Wiring is per-machine (see Local Development). The tracked self-test runs in CI on every pull request as the `issue-2897-agent-guard-selftest` suite in `.github/ci-batch/MANIFEST.json`:

```bash
python3 scripts/agent-guard/guard-selftest.py scripts/agent-guard/bash-guard.py
```

It asserts both directions — what must be blocked and what must stay allowed — and reads the rule table out of the guard's own source, so a rule added without both a must-block and a must-allow case fails the build.

### Limits — read these

- **`MINGLA_ALLOW_DESTRUCTIVE=1` lifts every rule at once.** There is no per-rule override, by design: the same escape hatch as `.githooks/pre-commit`'s `MINGLA_ALLOW_MAIN_COMMIT`, and the reason nobody deletes the guard the first time it blocks legitimate work.
- **The variable must be set in the environment that launches Claude Code, not inside the command being run.** The hook is a separate process spawned before your command executes, so `export MINGLA_ALLOW_DESTRUCTIVE=1 && <cmd>` does *not* lift the block. Relaunch with it set.
- **This stops accidents, not intent.** An agent that decides to override it can, and one that spells a command differently enough will slip past a pattern. It is a seatbelt, not a sandbox.
- **Patterns anchor to the head of a command segment, and segments are split naively** on `&&`, `||`, `;`, `|` and newlines — there is no shell parser. A rule name quoted mid-line is data and passes. The mirror case is the cost: text that *begins a segment* with a blocked command is blocked even when it is plainly data. Writing a file whose body contains the line `cd /tmp && git reset --hard` is refused, because after the split that is indistinguishable from running it. This is deliberate — the same split is what catches the real `cd /tmp && git reset --hard`, and the safe side is the blocking side. Use the Write/Edit tools for that content rather than a heredoc.
