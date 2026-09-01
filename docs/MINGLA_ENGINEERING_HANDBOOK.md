# Mingla Engineering Handbook

> **Audience:** Any developer working on the Mingla codebase. Especially: co-founders, contractors, anyone outside the Claude/agent pipeline. You can use any tools you like (Cursor, Copilot, vanilla coding, your own AI) — this handbook covers the rules of the road regardless.
>
> **Companion documents:**
> - Strategic overview: `Mingla_Artifacts/MINGLA_BUSINESS_1_2_WORKING_DOC.md`
> - Operating manual: `Mingla_Artifacts/PROJECT_SPEC_MINGLA_BUSINESS_1_2.md`
> - Per-milestone work: `Mingla_Artifacts/milestones/<MILESTONE_ID>.md`
>
> **Last updated:** 2026-05-13.

---

## 1. Welcome

Mingla is a date-planning and social-experiences app. Not a dating app. The business side (the app this handbook is for) is the seller surface — brands, events, ticketing, payments, and (in 1.2) physical venues, trip planners, and AI-generated experiences.

If you're picking up a milestone in Mingla Host 1.2, you'll be working from a milestone brief in `Mingla_Artifacts/milestones/`. Read your brief first. Read this handbook second. Then code.

This handbook tells you:
1. How the codebase is structured
2. The conventions you must follow
3. The hard rules you can't violate
4. How to verify your work
5. How to commit, push, deploy

---

## 2. Codebase Structure

It's a monorepo with four domains sharing a Supabase backend.

| Domain | Path | Stack |
|--------|------|-------|
| **Business app** (your 1.2 focus) | `mingla-business/` | React Native (Expo), TypeScript strict, React Query, Zustand, custom navigation |
| Consumer app | `app-mobile/` | Same stack |
| Admin dashboard | `mingla-admin/` | React 19 + Vite, JSX (no TS), Tailwind v4, Framer Motion |
| Backend | `supabase/` | PostgreSQL, Deno Edge Functions, RLS everywhere |

Inside `mingla-business/`:

```
mingla-business/
├── app/                        ← Expo Router routes (file-based)
│   ├── (tabs)/                 ← bottom-nav tabs
│   │   ├── home.tsx
│   │   ├── events.tsx          ← becomes Hub in M0
│   │   ├── ari.tsx
│   │   ├── marketing/          ← Blast tab + sub-routes
│   │   └── account.tsx
│   ├── brand/[id]/             ← brand management routes
│   ├── event/[id]/             ← event management routes
│   ├── trip/[id]/              ← (NEW in 1.2) trip management routes
│   ├── checkout/[eventId]/     ← buyer checkout (anon-tolerant)
│   ├── e/[brandSlug]/          ← public event pages (anon)
│   ├── b/[brandSlug]/          ← public brand pages (anon)
│   ├── t/[brandSlug]/          ← (NEW in 1.2) public trip pages (anon)
│   ├── connect-onboarding.tsx  ← Stripe Connect entry
│   └── auth/                   ← sign-in flow
└── src/
    ├── components/             ← reusable React components organized by domain
    ├── services/               ← Supabase + edge function clients (one file per domain)
    ├── hooks/                  ← React Query hooks + Zustand wrappers
    ├── store/                  ← Zustand stores (client-only state)
    ├── context/                ← React Context (auth, cart)
    ├── constants/              ← design tokens (designSystem.ts)
    ├── payments/               ← Stripe React Native abstraction (platform-gated)
    ├── utils/                  ← helpers (randomId, edgeFunctionError, etc.)
    ├── types/                  ← shared TypeScript types
    └── config/                 ← env-driven config
```

Inside `supabase/`:

```
supabase/
├── migrations/                 ← *.sql files, timestamp-prefixed
├── functions/                  ← edge functions (Deno)
│   ├── <function-name>/        ← one folder per function with index.ts
│   └── _shared/                ← shared modules across functions
└── config.toml                 ← per-function settings (verify_jwt etc.)
```

---

## 3. Stack Conventions

### 3.1 TypeScript

- **Strict mode is on.** No `any`. No `@ts-ignore`. No `as unknown as X`.
- Always provide return types on exported functions.
- Use the existing `types/` folder for shared types; don't re-declare types per file.

### 3.2 React Query (server state)

- **One query key per entity.** Use the factory at `mingla-business/src/hooks/queryKeys.ts` (or create one if it doesn't exist for your domain). Hardcoded keys in `useQuery` calls are a hard reject.
- **Invalidation goes through the factory too** — mutations call `queryClient.invalidateQueries({ queryKey: keys.x() })`.
- Set `staleTime` deliberately. For mostly-static reads (brand profile), 5+ minutes is fine. For high-churn reads (live event counts), keep it low.
- Handle all four states in components: `isLoading` / `isError` / `data === null` / `data.length === 0`. No silent "if data, render; else null."

### 3.3 Zustand (client state ONLY)

- Zustand stores hold **client-only state** — what's selected, what's drafted locally, ephemeral UI state.
- **Server records do NOT belong in Zustand persist.** Per memory `feedback_zustand_persist_no_server_snapshots.md`, `partialize` must only include IDs + local UI state, never fetched server objects.
- Read patterns: `useStore((s) => s.field)` for selectors; never `useStore.getState()` inside React render paths.
- Cold-start: any persisted store needs a `_hasHydrated` flag gate to avoid reading from disk on first render before rehydration completes.

### 3.4 Supabase access

- **Mobile code uses the user-scoped client.** Located at `mingla-business/src/services/supabase.ts`. Never use service-role in mobile.
- **Service-role calls happen in edge functions only.** And only when necessary; prefer user-scoped client even in edge functions for RLS to do the gating.
- **Edge functions that call SECURITY DEFINER RPCs reading `auth.uid()` must use `userClient(req)`** (anon key + caller's Authorization header), NOT service-role. Per memory `feedback_orchestrator_deploys_edge_functions.md` and DEC-148. Service-role JWTs carry no `sub` claim; `auth.uid()` returns NULL and gates fail closed.

### 3.5 Stripe

- **Mobile code does NOT call Stripe APIs directly.** Always through an edge function intermediary.
- `@stripe/stripe-react-native` is allowed only inside the `.native` payment boundary modules at `mingla-business/src/payments/StripeNativeProvider.native.tsx` and `mingla-business/src/payments/stripePaymentSheet.native.ts`. Their `.web` counterparts return pass-through behavior so Expo web export doesn't bundle native-only internals (per ORCH-0778 / DEC-137).
- Test mode keys + live mode keys both exist. Use test mode for development.

### 3.6 Edge function error handling

- Use the shared `edgeFunctionError.ts` utility at `mingla-business/src/utils/edgeFunctionError.ts` to parse errors.
- `instanceof Response` fails in React Native due to polyfill realm mismatch — use duck-typing. Read body via `.text()` first, then `JSON.parse()`, never `.json()` directly.

### 3.7 Storage paths

- E.164 phone numbers (`+14155551234`) in storage paths cause RLS failures. Sanitize keys: `key.replace(/[^a-zA-Z0-9_-]/g, '_')`. Pattern used in `personAudioService.ts:uploadOnboardingAudio`.

### 3.8 IDs in mobile

- **Do NOT use `crypto.randomUUID()`** — Hermes engine on iOS/Android has no global `crypto`; it's a ReferenceError. Use `mingla-business/src/utils/randomId.ts`.

### 3.9 Inline-style colors

- React Native's `@react-native/normalize-colors` rejects `oklch`, `lab`, `lch`, `color-mix` silently — renders transparent on iOS/Android and dims invisibly on web Chrome under dark overlays.
- **Use `hex`, `rgb`, `hsl`, `hwb` only.** For hue-driven dynamic colors, use `hsl(hue, 60%, 45%)`. Mirror the pattern in `EventCover.tsx`. Per memory `feedback_rn_color_formats.md`.

### 3.10 Toast notifications

- The Mingla `Toast` primitive has no built-in absolute positioning. Wrap in an absolute-positioned `<View>` per the pattern in `events.tsx` / `home.tsx`. Per memory `feedback_toast_needs_absolute_wrap.md`.

### 3.11 RN sub-sheets

- Sub-sheet JSX must render **inside** the parent `<Sheet>` children, NOT as a Fragment sibling. Native Modal sibling-mounts compete at the OS root layer; the second mounted gets visually blocked. Pattern reference: `CreatorStep5Tickets.tsx:1368-1386`. Per memory `feedback_rn_sub_sheet_must_render_inside_parent.md`.

### 3.12 Navigation guards

- `navigation.addListener("beforeRemove", e => e.preventDefault())` blocks your own sanctioned `router.replace` from exit CTAs. Use a `useRef<boolean>` flag that the exit CTA flips before navigating; the listener reads the flag and lets sanctioned exits pass. Same pattern for web `popstate`. Per memory `feedback_back_listener_disarm_pattern.md`.

---

## 4. The Mingla Constitution (14 Rules — Automatic Rejection If Violated)

These apply to every line of code you write.

1. **No dead taps** — every interactive element responds visually + functionally
2. **One owner per truth** — no duplicate state authorities (don't keep server data in two places)
3. **No silent failures** — every error surfaces to the user (Toast, error UI, retry affordance)
4. **One query key per entity** — use the factory, no hardcoded strings
5. **Server state stays server-side** — Zustand only for client state
6. **Logout clears everything** — no private data survives sign-out (check stores, AsyncStorage, React Query cache)
7. **Label temporary code** — `[TRANSITIONAL]` comments with exit conditions, otherwise don't write temporary code
8. **Subtract before adding** — remove broken code before writing new code (don't layer)
9. **No fabricated data** — missing is hidden, never faked ratings/prices/times
10. **Currency-aware** — use the brand's `default_currency`, format per locale
11. **One auth instance** — single session authority via the existing context
12. **Validate at the right time** — use the user's datetime, not `new Date()` (timezone-correct)
13. **Exclusion consistency** — if you filter X out of one query, filter X out of all related queries (cache key must include the filter)
14. **Persisted-state startup** — `_hasHydrated` gate on any persisted-store read

Detail + examples in `Mingla_Artifacts/INVARIANT_REGISTRY.md`.

---

## 5. Hard Rules Specific to Mingla Host 1.2

These are inherited from the 1.2 architecture. Read the project spec for context.

| Rule | Why |
|------|-----|
| Every sellable thing is `public.events` with `event_type` discriminator | Unified data model — no parallel tables for trips/experiences |
| `brands.kind` is starting identity, never capability gate | Any brand can author any offering type |
| AI-generated artifacts ship through `agent_pending_actions` with operator review | No auto-publish; operator accept/edit/reject required |
| Physical venues validated by admin phone callback | 4-hour SLA, business-hours-aware |
| Trip planners validated by Stripe Connect completion | Stripe = identity proof for trip kind |
| `event_threads` RLS scopes to confirmed buyers + brand members | Test by attempting cross-trip read; must fail |
| `order_installments` ledger is authoritative for refund math | Never recompute installments from scratch |
| `claimed_venues_public_view` is the public surface for verified venues | The existing `brands_public_view` requires an active event; the new view surfaces claimed venues without one |
| `events.location_text` can drift from `events.city` | Treat `city` as canonical for surfacing; `location_text` is display freeform |
| Buyer routes (`/checkout/`, `/e/`, `/b/`, `/t/`) are anon-tolerant | Never call `useAuth` from these routes |

---

## 6. Working with a Milestone Brief

Every 1.2 milestone has a brief at `Mingla_Artifacts/milestones/<MILESTONE_ID>.md`. The brief is your contract. It contains:

1. **Scope (in and out)** — what's in scope, what's explicitly NOT
2. **User outcome** — what a real user can do after the milestone ships
3. **Smoke test** — the exact end-to-end test a human runs to verify the milestone
4. **Acceptance criteria** — numbered list, each one observable + testable
5. **Files touched** — best estimate of which files you'll create or modify
6. **Data model changes** — exact migration SQL (or reference to project spec §3)
7. **Dependencies** — which milestones must be in TestFlight first
8. **Regression tests** — what existing functionality you verify still works
9. **Hard guards** — things you must NOT do during this milestone

### How to work a milestone (your loop)

1. **Read the brief end to end.** Then read the companion working doc and project spec sections referenced.
2. **Run your own investigation.** Open the files the brief lists. Read the migrations for any tables you'll touch. Read adjacent code that consumes the data you're changing. Note any contradictions.
3. **Plan before coding.** Sketch the migration SQL. Sketch the edge function. Sketch the React component hierarchy. Validate the plan against the acceptance criteria.
4. **Code in order: database → edge function → service → hook → component.** Top of the stack last. This way each layer is testable independently.
5. **Run the smoke test before declaring done.** If the smoke test doesn't pass, you're not done — even if everything compiles.
6. **Write the regression tests.** The brief lists what to cover. Place tests in the appropriate `__tests__/` folder next to the file under test.
7. **Write an implementation report.** Format below.

### Implementation report format

Create `Mingla_Artifacts/reports/IMPLEMENTATION_<ORCH_ID>_<MILESTONE_NAME>.md`:

```markdown
# Implementation Report — <Milestone Name>

**Milestone:** <code> (e.g., Tr3)
**ORCH-ID:** ORCH-XXXX
**Implementor:** <your name>
**Date:** <YYYY-MM-DD>

## Summary
<2-3 sentences plain English: what shipped, what user can now do>

## Acceptance criteria status
| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| 1 | <from brief> | PASS / FAIL / PARTIAL | <any caveats> |
| 2 | ... | ... | ... |

## Files changed
<list every file modified or created, one per line, with a one-sentence reason>

## Data model changes applied
<list migration files added, columns changed, indexes created>

## Edge functions deployed
<list functions touched + new version numbers if known>

## Regression tests added
<list test files + brief description of what each covers>

## Smoke test result
<paste the smoke test from the brief + your result for each step>

## Known issues / deferred
<anything you noticed during implementation that's out of scope>

## Operator action required
<things only the operator can do — DB push, EAS OTA, Stripe key rotation, etc.>
```

---

## 7. Branch, Commit, Push, Deploy

### 7.1 Branch

- **Always work on `Seth` branch.** Never create per-milestone branches.
- Always pull before starting: `git pull --ff-only origin Seth`
- Always check status before committing: `git status --short`

### 7.2 Commit

Commit when each layer is complete + tested locally:
- After database migration applied + verified
- After edge function deployed + tested
- After service/hook landed + unit tests pass
- After component landed + smoke test partial-pass
- After full smoke test passes (final commit for milestone)

Commit message format:

```bash
git commit -m "$(cat <<'EOF'
<Milestone code>: <one-line summary>

<2-3 bullets of what changed>
- ...
- ...

ORCH-XXXX milestone <code>.
EOF
)"
```

Examples:
- `Tr3 M3.1: add order_installments ledger + Stripe scheduled payments`
- `Ve1 M9.2: brand kind=physical schema migration + structured place columns`

**No `Co-Authored-By:` lines.** Per memory.

### 7.3 Push

Push frequently — every commit on `Seth`:

```bash
git push origin Seth
```

If push is rejected because remote has new commits, pull with rebase:

```bash
git pull --rebase origin Seth
```

Resolve any conflicts, then push.

### 7.4 Database migrations

You do NOT run `supabase db push` yourself. **Only the operator (Seth) does this.**

When you add a migration:
1. Add the file to `supabase/migrations/<timestamp>_<name>.sql`
2. Test the migration against your local Supabase first (`supabase db reset` rebuilds from migrations)
3. Commit + push
4. **Notify Seth** that the milestone has a new migration. The approved operator lane must first
   pass the production-authority verifier, then apply the reviewed migration through the verified
   surgical lane in `docs/runbooks/PRODUCTION_SUPABASE_AUTHORITY.md`.
5. Wait for confirmation before deploying edge functions that depend on the migration

### 7.5 Edge function deploys

Seth handles deploys. After Seth confirms the migration is applied, he or the orchestrator uses the
guarded repository wrapper from the repository root:

> **#2948 — there is no deploy-all.** Since #2886 the wrapper refuses a bare
> invocation (`FAIL deploy: explicit --function selection required; deploy-all is
> forbidden`) and requires `--merged-commit`. Name the functions you mean, from
> MERGED `main`. In CI the selection is computed for you by
> `scripts/ci/select-changed-edge-functions.mjs`; by hand, pass them.

```bash
SUPABASE_PROJECT_ID=gqnoajqerqhnvulmnyvv scripts/deploy-supabase-functions.sh \
  --merged-commit "$(git rev-parse HEAD)" \
  --function <name> \
  --function <another-name>
```

An issue-approved single-function surgical deployment must first pass the exact-target verifier and
follow `docs/runbooks/PRODUCTION_SUPABASE_AUTHORITY.md`; never run a bare production deploy command.

You do NOT run this yourself. If you need to test an edge function locally:

```bash
supabase functions serve <name>
```

### 7.5b Reading app config — `expo config --json` hides config errors

**If `npx expo config --json` exits non-zero with NO output on either stream, re-run it without
`--json`.** With `--json` the Expo CLI prints nothing when `app.config.js` throws — empty stdout,
empty stderr, exit 1. Drop the flag and the config's own error appears on stderr, naming exactly
what is wrong:

```bash
npx expo config --type public          # error message on stderr
npx expo config --json --type public   # exit 1, complete silence
```

This matters because both apps carry **release-bound fail-loud guards** — AppsFlyer (ORCH-1313),
GIPHY (ORCH-1116), and the payment key (#1732/#1733) — that throw only when `EAS_BUILD_PROFILE` is
a release profile (`production`, `production-apk`, `preview`, `preview-sim`). Evaluating the config
under one of those profiles therefore needs the **full** env for every guard, not just the one you
are testing. `hasAppsFlyerEnv()` requires all **three** AppsFlyer variables; one is not enough.

**A silent exit 1 looks identical to a guard firing correctly.** That cost real time in #1748: an
incomplete env produced a non-zero exit that was read as proof a newly-added guard worked, when a
different guard had thrown. Confirm WHICH guard spoke before drawing a conclusion — the #994 S-5
assertion does exactly this by requiring the failure to NAME the key under test
(`.github/scripts/strict-grep/issue-994-ota-env-resolution-smoke.mjs`).

### 7.6 EAS OTA

Production OTA is ENABLED for pure-JS / zero-native-module-delta changes (the old "business is
native-build-only / OTA bricks" freeze is RETIRED — the brick was a native-module delta + a wrong-key
handshake, both solved: #990 + ORCH-1384 on-device GO). The orchestrator (or Seth) publishes on close;
only a change that adds/bumps a native module or edits native config needs a full `eas build`.

**`--environment production` is MANDATORY on EVERY production OTA, both apps.** Without it the CLI
inlines `process.env` from the LOCAL `.env`, which lacks the EAS-only `EXPO_PUBLIC_*` values. This has
shipped five production incidents and fails two different ways:

- **Wrong key (loud).** `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` falls back to `pk_test_`; the live-mode
  handshake throws at boot and the business app sticks on the splash screen (#990).
- **Missing key (silent, worse).** The consumer app carries no Stripe key in `extra` at all, so there is
  no mismatch to throw on — `resolvePublishableKey()` ends in `?? ""`, checkout is dead, and the app
  boots and looks completely normal. Shipped 2026-08-06, live ~40 minutes, nothing in Sentry or the
  funnel. Same silent-default shape for `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` / `EXPO_PUBLIC_POSTHOG_KEY` /
  `EXPO_PUBLIC_MIXPANEL_TOKEN`.

**BOTH apps publish through their canonical wrapper script — never a bare `eas update`.** Each wrapper
always passes the flag, pre-flights every key that app silently defaults on (presence FIRST, then
prefix), and — after publishing — downloads the manifest the CDN will actually serve and fails loudly
if a key is missing. #994 added the consumer wrapper and the post-publish check; a strict-grep gate
keeps this page, both wrappers and both `app.config.js` tripwires honest.

```bash
mingla-business/scripts/ota/publish-production-ota.sh ios     "<summary>"
mingla-business/scripts/ota/publish-production-ota.sh android "<summary>"

app-mobile/scripts/ota/publish-production-ota.sh ios     "<summary>"
app-mobile/scripts/ota/publish-production-ota.sh android "<summary>"
```

Two separate commands per app — `--platform ios,android` is invalid; the combined-platform form fails
on the web bundle.

Reference only — what the consumer wrapper runs underneath. `app-mobile` must use `npx -y
eas-cli@latest` (the globally-installed eas-cli crashes app-mobile's config spawn). **Do not run these
by hand**: they publish with no pre-flight and no post-publish verification, which is exactly how the
five incidents happened.

```bash
cd app-mobile && npx -y eas-cli@latest update --branch production --environment production --platform ios     --message "<summary>"
cd app-mobile && npx -y eas-cli@latest update --branch production --environment production --platform android  --message "<summary>"
```

**Verify the SERVED MANIFEST after every publish — the CLI exit code is green on a broken publish.**
The wrapper now does this for you (`scripts/ota/verify-published-manifest.mjs`, run automatically after
the publish): it fetches what users will actually receive and confirms the expected `EXPO_PUBLIC_*` keys
carry real values. Read its output before you walk away. An unset var serializes as `{}` (not `null`,
not absent), which is easy to skim past:

```
"EXPO_PUBLIC_POSTHOG_KEY":{}     <- unset. The publish was blind. Republish with --environment production.
```

If that check fails, roll back first (`eas update:roll-back-to-embedded --branch production --platform
<ios|android>`), then re-run the wrapper from the same commit. Devices that already fetched the bad
update need TWO cold starts to escape it (#990).

**Release-mode boot smoke — run this BEFORE a production OTA that touches boot-path code.**

This is a HUMAN step, deliberately not a CI gate, and here is why: doing it in CI needs a macOS runner,
an EAS-built dev-client `.app` that is not a repo artifact (~30–60 min to build), production Stripe and
Supabase secrets available to CI, and live outbound network to the production backend — on every PR.
That produces either a check everyone skips or a check that is green because it silently failed to
launch, which is the same defect class this whole section exists to prevent (#994 SPEC §6.1).

1. At the exact commit you are about to publish: `npx expo start --no-dev --minify` in the app dir.
2. Launch the EAS dev client on a booted simulator **with network to the production backend**, and cold
   start it (terminate first — a hot-reloaded app is not evidence).
3. The app must reach Home.
4. The simulator syslog must contain zero `StripeModeMismatchError`, `Render Error` or `FATAL`.

Dev mode does NOT substitute. In dev, the same boot-path throw renders as a dismissible LogBox overlay
while the app keeps running; in release it is the stuck splash screen (#990 §3).

### 7.7 Pull requests

For merging `Seth` → `main`, Seth handles via GitHub PR with a pre-merge gate. You don't open PRs directly.

---

## 8. Testing

### 8.1 Unit tests

Place tests next to the code under test in `__tests__/` folders:

```
mingla-business/src/services/__tests__/brandsService.test.ts
mingla-business/src/utils/__tests__/randomId.test.ts
mingla-business/src/components/event/__tests__/CreatorStep1Basics.test.tsx
```

Run all tests: `cd mingla-business && npm test`

Run specific test: `cd mingla-business && npm test -- brandsService`

### 8.2 Type checks

```bash
cd mingla-business && npx tsc --noEmit
```

Must exit 0 before commit.

### 8.3 Smoke test (the milestone's end-to-end test)

Every milestone brief includes a smoke test. Run it as the last step before declaring the milestone done. The smoke test always involves running the app on at least one real device (iOS Simulator or Android Emulator or physical).

```bash
# Start Metro
cd mingla-business && npx expo start

# In a separate terminal, iOS simulator:
cd mingla-business && npx expo run:ios

# Android emulator:
cd mingla-business && npx expo run:android
```

Walk through the smoke test as written. If any step fails, do not commit the milestone-final commit. Fix and re-run.

### 8.4 Regression tests

Per milestone brief — verify adjacent functionality still works. If you touched a hook, check every screen that uses it. If you touched a service, check every hook that calls it. If you touched a migration, check every query that reads the touched table.

### 8.5 RLS verification

For any new table or RLS policy: test the negative case. Sign in as User A. Attempt to read/write data owned by User B. **Confirm the read returns empty, the write errors.** If you can read another user's data, the RLS is broken.

### 8.6 The mingla-business jest suite — required PR context (issues #1047 / #1062)

`cd mingla-business && npm test` runs the whole default jest suite (`jest --ci`, the `test` script added by #1047). For years this suite was run by NO workflow: it had ~245 failing tests, and the CLOSE regression gate had been depositing tests into a dark file (the #1038-shape "safety net that looks present but isn't running"). #1047 made it honest:

- **It is a required PR context.** Since the Seth-gated #1062 flip on 2026-07-22, `.github/workflows/mingla-business-jest-suite.yml` runs on every pull request to `main` with no paths filter, as well as nightly and on manual dispatch. The live ruleset requires the exact job context `mingla-business jest (full suite)`, so a red suite blocks merge. It installs `react-test-renderer --no-save` so the bare-RTR `*.orch0976.*` suites pass under the stock config.
- **The brittle source-text pins are QUARANTINED, not deleted.** `tests-append-only.yml` makes whole-test-file deletion absolute, so #1047 excludes the pins via `jest.config.cjs` `testPathIgnorePatterns` (files retained, grep-able). Regenerate/review the exact list with `node mingla-business/scripts/ci/select-source-text-pins.mjs`.
- **Load-bearing invariants that had been pinned by source-text tests were re-homed to additive strict-grep gates** (`.github/scripts/strict-grep/i-1047-biz-*.mjs`, registered in `MANIFEST.json`) that actually run — never dropped.

The required flip is complete; do not remove the all-PR trigger, add a paths filter, rename the exact job context, or remove its required-rule binding without a separately reviewed add-before-remove transition. The #1047 invariants protect the whole-suite wire and forbid reintroducing source-only pins as regression proofs.

---

## 9. Working with Existing Patterns

When in doubt, find the closest existing precedent and copy the pattern. Mingla has strong consistency conventions; deviating costs reviewer time.

| Need to do this | Look at this precedent |
|----------------|------------------------|
| Brand creation flow | `mingla-business/src/components/brand/BrandSwitcherSheet.tsx` |
| Event creation wizard | `mingla-business/src/components/event/CreatorStep*.tsx` |
| Stripe Connect onboarding | `mingla-business/app/connect-onboarding.tsx` + `brand/[id]/payments/onboard.tsx` |
| Stripe payment integration | `mingla-business/src/payments/StripeNativeProvider.native.tsx` |
| Edge function pattern | `supabase/functions/ticket-checkout-create/index.ts` |
| RLS policy | Latest migration touching the table family |
| Image upload + storage | `mingla-business/src/services/brandCoverService.ts` (ORCH-0805 pattern) |
| Toast notification | `mingla-business/app/(tabs)/events.tsx` pattern |
| Anon-tolerant route | `mingla-business/app/checkout/[eventId]/index.tsx` |
| AI generation + confirmation card | `supabase/functions/_shared/agentTools.ts` + Ari chat pattern (ORCH-0821) |
| Refund flow | `supabase/functions/refund-order/index.ts` (ORCH-0787) |
| Email template via Resend | `supabase/functions/_shared/email/` (ORCH-0785) |

---

## 10. Communication Discipline

### 10.1 When you start a milestone

Drop a quick note: "Starting <milestone code>. Estimated <X> days. Will surface blockers within 24h if anything stops me."

### 10.2 When you hit a blocker

Don't sit on it. Within 24 hours of being blocked, surface it:
- What you're trying to do
- What's blocking
- What you've tried
- What you need (a decision, a credential, a schema change, etc.)

### 10.3 When the brief is wrong

Briefs are written ahead of execution. If you discover during implementation that the brief contains a contradiction or makes an assumption that's wrong, **stop and surface it** — don't silently work around it. Either:
- The brief gets amended (orchestrator updates it + logs the change)
- The brief is right and your interpretation is wrong (clarify and proceed)

Either way, don't go off-piste from the contract.

### 10.4 When you finish a milestone

1. Push final commit
2. Write the implementation report (template in §6)
3. Notify Seth: "Milestone <code> implementation complete. Smoke test passed. Report at <path>. Migration needs `db push`. Edge functions need deploy."
4. Wait for Seth's QA pass before claiming closed.

---

## 11. Tools You Use vs. Tools Seth Uses

You're outside the Claude/agent pipeline. That's fine. You can use:

- **Any IDE / editor** (Cursor, VS Code, Zed, Vim, etc.)
- **Any AI assistant** (Cursor's built-in, Copilot, Claude, GPT, whatever)
- **Standard git / supabase CLI / npm / Expo CLI**

Seth uses:
- **Claude Code with custom skills** (mingla-orchestrator, mingla-forensics, mingla-implementor, mingla-tester) — when he takes a milestone, the milestone goes through INVESTIGATE → SPEC → IMPLEMENT → TEST → CLOSE phases run by agents
- **Codex implementor-mingla** — Codex-side parallel implementor

You don't need any of that. **Your work product is the same regardless of tools — code on `Seth` branch that meets the milestone brief's acceptance criteria.**

The agent pipeline is a methodology layer for rigor; the underlying code is identical. Seth's milestones go through forensics audit + SPEC + automated review; your milestones go through your own equivalent (your own investigation + plan + smoke test + regression sweep) — both sides converge at the milestone brief as the shared contract.

---

## 12. Quick Reference

| Action | Command |
|--------|---------|
| Pull latest | `git pull --ff-only origin Seth` |
| Status | `git status --short` |
| Run business app on iOS sim | `cd mingla-business && npx expo run:ios` |
| Run business app on Android | `cd mingla-business && npx expo run:android` |
| Type check | `cd mingla-business && npx tsc --noEmit` |
| Run tests | `cd mingla-business && npm test` |
| Local Supabase reset | `supabase db reset` (rebuilds from migrations) |
| Local edge function | `supabase functions serve <name>` |
| Find an existing pattern | `grep -rn "<pattern>" mingla-business/src/` |
| Find table migration | `grep -ln "<table>" supabase/migrations/` |
| Check current branch | `git branch --show-current` |

| Question | Answer |
|----------|--------|
| What branch do I work on? | `Seth` always |
| Can I create a feature branch? | No |
| Can I run `supabase db push`? | No — Seth runs it |
| Can I deploy an edge function? | No — Seth/orchestrator runs it |
| Can I publish an EAS OTA? | No — Seth runs it |
| Can I merge to main? | No — Seth merges via PR with pre-merge gate |
| Where do I save reports? | `Mingla_Artifacts/reports/` |
| What's the milestone code I'm on? | Top of your milestone brief |
| What's my ORCH-ID? | Assigned at milestone start; in the brief or ask Seth |
| Where do I see what's next? | `Mingla_Artifacts/PRIORITY_BOARD.md` and `MINGLA_BUSINESS_1_2_WORKING_DOC.md` §6 |

---

## 13. The Five Things That Will Cost You Time If You Skip Them

1. **Reading the milestone brief end-to-end before coding.** Skipping = building the wrong thing.
2. **Verifying you're following the closest existing pattern.** Skipping = code that doesn't fit and gets rejected at review.
3. **Running the smoke test before claiming done.** Skipping = a failed end-to-end that has to be re-done.
4. **Writing the implementation report.** Skipping = Seth's QA pass takes longer because he has to re-derive what you did.
5. **Surfacing blockers within 24h.** Skipping = a milestone that's "almost done" for 3 days and isn't.

---

*End of handbook. Ask questions early; ask questions often.*
