# Root Cause Register

> Last updated: 2026-05-09
> Proven root causes with causal clusters.

## Root Causes

### RC-PR69: Admin Vercel deployment payload excluded the admin package
- **Discovery date:** 2026-05-09
- **Proof:** Failed admin Vercel deployment logged `ENOENT: no such file or directory, open '/vercel/path0/mingla-admin/package.json'` while running `npm run build`. PR 69 final status then showed `Vercel - mingla-admin` SUCCESS after commit `466d98f2`, and PR 69 merged at `89e107340920e39f9546d7947419d014d6a9d517` with all checks successful. Close report: `reports/CLOSE_PR-69_ADMIN_VERCEL_AND_CI_CHECKS.md`.
- **Symptoms caused:** Admin preview deployment failed before build compilation because npm could not find `mingla-admin/package.json` inside the Vercel deployment root.
- **Causal chain:**
  1. Vercel configured the admin project to build from `/vercel/path0/mingla-admin`.
  2. The repo-level `.vercelignore` excluded `mingla-admin/` from the uploaded deployment payload.
  3. Vercel still entered the configured admin root and ran `npm run build`.
  4. npm failed before dependency resolution or compilation because `package.json` was absent.
- **Structural fix:** `.vercelignore` now allows `mingla-admin/` into the deployment payload while continuing to exclude admin `.env`, `dist/`, and `node_modules/`. Related PR checks also repaired strict invariant gates and made the event-cover storage migration compatible with the CI storage schema.
- **Status:** **CLOSED PASS 2026-05-09**. Evidence: final PR head `291de92684a3b770d9776b25aa75f96350a6f551` had successful admin/business/marketing Vercel contexts, Supabase Preview, migration baseline, Deno Stripe tests, docs-artifact-regression, GitGuardian, and strict grep gates before merge.
- **Invariant / regression guard:** Vercel deployment ignore rules must never exclude a configured project root that Vercel is expected to build. Ignore project-local generated outputs and secrets, not the package directory itself.
- **Causal cluster:** Cluster 6: deployment packaging/config drift can masquerade as an application build failure.
- **Follow-ups not part of RC:** ORCH-0764B/0764C Stripe runtime gates, ORCH-0763 event/share runtime gates, and product QA remain separate.

### RC-0764B: Stripe onboarding UI used split status truths and treated actionable KYC as terminal failure
- **Discovery date:** 2026-05-09
- **Proof:** `reports/INVESTIGATION_ORCH-0764B_STRIPE_ONBOARDING_STATE_RECONCILIATION.md` proved Payments could render cached `brand.stripeStatus=onboarding` while live `useBrandStripeStatus().requirements.disabled_reason=requirements.past_due` rendered restricted remediation. `reports/IMPLEMENTATION_ORCH-0764B_STRIPE_ONBOARDING_STATE_RECONCILIATION.md` reports implementation of the primary repair contract. `reports/RETEST_ORCH-0764B_STRIPE_ONBOARDING_STATE_RECONCILIATION.md` then proved two remaining P1 gaps: production return route `https://business.usemingla.com/stripe-onboarding-return` returns Vercel `404_NOT_FOUND`, and `BrandOnboardView` still has a cached `brand.stripeStatus === "active"` terminal-success bypass.
- **Symptoms caused:** Users saw contradictory "Onboarding submitted — verifying" and "Verification overdue" states, remediation could leave the app through bare `connect.stripe.com/express_login`, and ordinary past-due KYC could end in "Stripe couldn't verify."
- **Causal chain:**
  1. Payments used cached `brand.stripeStatus` for the main banner while live Stripe requirements powered remediation cards.
  2. Restricted remediation used a generic Express login URL instead of Mingla's controlled Account Link creation path.
  3. The onboarding modal treated every `restricted` status as terminal failure rather than distinguishing actionable requirements from true Stripe rejection.
  4. Browser return performed one refresh only, so Stripe propagation lag could produce false final states.
  5. SQL status derivation checked `charges_enabled` before `requirements.disabled_reason`, while TS/product expectation already treated disabled requirements as `restricted`.
  6. Business web export contained the onboarding return screen locally, but production routing did not serve the clean `/stripe-onboarding-return` URL used by Stripe.
  7. `BrandOnboardView` retained an older cached-active shortcut, so one onboarding surface could still terminally trust stale brand status before live Stripe requirements loaded.
- **Structural fix:** Primary repair is implemented: Payments now prefers live Stripe status over cached brand status; all actionable remediation CTAs route through Mingla's Account Link continuation; onboarding shell distinguishes `needs-information` from terminal `failed-stripe`; status settlement polls briefly after browser return; SQL parity migration `20260515000007_orch_0764b_stripe_status_derivation_parity.sql` makes `requirements.disabled_reason` win over `charges_enabled`. Rework `reports/IMPLEMENTATION_REWORK_ORCH-0764B_STRIPE_ONBOARDING_RETURN_AND_ACTIVE_BYPASS.md` adds the return-route rewrite and makes cached `active` wait for live status in `checking-status`.
- **Status:** **OPEN - VERCEL DEPLOY GATE THEN TESTER 2026-05-09**. Next prompt after deploy: `prompts/TESTER_RETEST_REWORK_ORCH-0764B_STRIPE_ONBOARDING_RETURN_AND_ACTIVE_BYPASS.md`.
- **Invariant / regression guard:** Stripe Connect account state has one effective UI truth per surface: live server status first, cached brand status only as loading fallback; actionable KYC requirements must be resumable through fresh Account Links, not terminal failure or generic Express login.
- **Causal cluster:** Cluster 1/6 crossover: duplicate state authority plus external payment-provider hosted-flow semantics.
- **Follow-ups not part of RC:** Checkout/destination charges, webhook fulfillment, Stripe live-mode review, and Vercel production route deployment remain separate gates.

### RC-0764A: Stripe Accounts v2 onboarding is gated by Stripe key permission/context after versioning repair
- **Discovery date:** 2026-05-08
- **Proof:** `reports/RETEST_ORCH-0764A_STRIPE_API_V2_VERSION_HEADER_RUNTIME.md` proves the deployed version-header fix advanced runtime past the earlier missing `Stripe-Version` error. Fresh authenticated `Stripe Wise 2` runtime accepted Mingla ToS, repeated ToS safely, and then failed in `brand-stripe-onboard` with Stripe's permission/context error before account creation.
- **Symptoms caused:** Organisers can accept Mingla ToS but cannot start Stripe payout onboarding; no `stripe_connect_accounts` row, no `account_id`, no `client_secret: null` success contract, and no Stripe-hosted onboarding URL are produced.
- **Causal chain:**
  1. ORCH-0764A moved from stale Connect onboarding/session behavior to raw Accounts v2 hosted onboarding.
  2. Runtime first failed because raw `/v2` calls lacked `Stripe-Version`; ORCH-0764A version-header rework fixed that enough to reach Stripe's next gate.
  3. The live deployed call now fails with Stripe permission/context wording, implicating key scope, key selection, required `Stripe-Context`, payload configuration, or platform/preview access.
  4. The exact root cause is not yet proven; implementation would be premature without a key/context investigation and spec.
- **Structural fix:** Pending forensics/spec with `prompts/FORENSICS_SPEC_ORCH-0764A_STRIPE_ACCOUNTS_V2_KEY_CONTEXT.md`.
- **Status:** **OPEN - FORENSICS SPEC DISPATCH READY 2026-05-08**. Orchestrator review: `reports/REVIEW_RETEST_ORCH-0764A_STRIPE_ACCOUNTS_V2_KEY_CONTEXT_GATE.md`.
- **Invariant / regression guard:** Stripe onboarding cannot be marked payout-ready until runtime proves HTTP `200`, `client_secret: null`, `account_id: acct_...`, Stripe-hosted `onboarding_url`, and a created/reused `stripe_connect_accounts` row.
- **Causal cluster:** Cluster 6: external payment-provider capability/key configuration can masquerade as app integration failure.
- **Follow-ups not part of RC:** ORCH-0764B checkout remains paused; webhook fulfillment and destination-charge checkout should not proceed until ORCH-0764A hosted onboarding is live-proven.

### RC-0763: Business event truth split between server drafts/public reads and local organiser published events
- **Discovery date:** 2026-05-08
- **Proof:** `reports/INVESTIGATION_ORCH-0763_BUSINESS_EVENT_SYSTEM_REGRESSION_AUDIT.md` proves organiser Home/Events/Event Detail/Edit Published still resolve published events from local `liveEventStore`, while drafts and buyer public reads have moved toward server-backed paths. It also proves publish is client-side multi-table work without atomic event-promotion proof, and wizard autosave can overwrite dirty editor state with stale server/list responses.
- **Symptoms caused:** A free event can appear published locally, then disappear after a new build/local storage loss; published-event edit/detail routes cannot recover from server; wizard typing glitches under autosave; current durable server evidence does not contain the user's reported published free event.
- **Causal chain:**
  1. ORCH-0756B introduced server-backed drafts but left organiser published events as persisted local `LiveEvent` rows.
  2. ORCH-0759 made buyer public routes more server-backed, but organiser management routes still rely on local state.
  3. Publish promotes tickets/event through client-side sequential writes and then creates a local `LiveEvent` from the draft.
  4. The final event update does not prove one row was promoted, so false-local publication remains possible.
  5. A new build, sign-out cleanup, app deletion, or local storage reset removes the local published event, leaving no organiser server hydration path.
  6. Immediate full-object autosave and server/list upserts can also race active typing and destabilize the wizard.
- **Structural fix:** Pending spec under `prompts/SPEC_ORCH-0763_BUSINESS_EVENT_SYSTEM_REGRESSION_REPAIR.md`. Required direction: atomic server-side publish RPC/transaction, server-backed organiser management event reads, local published-event store as cache only, edit-published server hydration, autosave debounce/revisioning/stale-response protection, and free-event regression coverage.
- **Status:** **OPEN - SPEC DISPATCH READY 2026-05-08**. Orchestrator review: `reports/REVIEW_ORCH-0763_BUSINESS_EVENT_SYSTEM_REGRESSION_AUDIT.md`.
- **Invariant / regression guard:** Proposed: organiser published-event source of truth must be server-backed; local stores may cache but cannot be the only authority for published/scheduled events. Publish must be atomic and must fail loudly if one durable server event is not promoted.
- **Causal cluster:** Cluster 1/4 crossover: duplicate state authority plus non-atomic mutation/RETURNING-proof gap.
- **Follow-ups not part of RC:** Giphy/Pexels provider integration, brand/profile media expansion, full paid checkout, and native cover-media runtime proof remain separate; they are blocked behind this event-integrity repair.

### RC-0754: Transitional Home event stubs survived after their retirement cycle excluded Home
- **Discovery date:** 2026-05-08
- **Proof:** `reports/INVESTIGATION_ORCH-0754_BUSINESS_HOME_UPCOMING_STUB_DATA.md` proves `mingla-business/app/(tabs)/home.tsx` still defines and renders `STUB_UPCOMING_ROWS` (`Sunday Languor Brunch`, `The Long Lunch (Series)`), hardcodes `"1 live · 2 upcoming"`, and uses fictional live-event values, while `mingla-business/app/(tabs)/events.tsx` already derives brand-scoped event rows from `useDraftsForBrand`, `useLiveEventsForBrand`, and lifecycle helpers.
- **Symptoms caused:** The business app Home tab's Upcoming section and adjacent event summary can show fabricated upcoming/live operational data instead of the organiser's actual event pipeline.
- **Causal chain:**
  1. Cycle 1 introduced Home's live row plus two stub upcoming rows.
  2. Cycle 3 intentionally preserved `STUB_UPCOMING_ROWS` while adding real draft rows and documented that Cycle 9 would retire the stubs when the real event list existed.
  3. Cycle 9 shipped the full Events tab pipeline but explicitly declared "Live tonight on Home tab: NO TOUCH in Cycle 9."
  4. No later cycle moved Home to the Events tab event derivation path, so the transitional rows and hardcoded summary copy remained.
- **Structural fix:** Home fake-data signatures were removed, Home now derives event truth from brand-scoped draft/live/order stores, `I-PROPOSED-Z` strict fake-signature guard was added, and implementation rework aligned empty-state copy, live hero date line, all-unlimited capacity label, and KPI zero-bucket subcopy with the approved spec.
- **Status:** **CLOSED CONDITIONAL PASS 2026-05-08** via DEC-132. Evidence: `reports/IMPLEMENTATION_ORCH-0754_BUSINESS_HOME_UPCOMING_STUB_DATA.md`, `reports/IMPLEMENTATION_REWORK_ORCH-0754_BUSINESS_HOME_UPCOMING_SPEC_ALIGNMENT.md`, and tester conditional PASS `reports/TEST_REPORT_ORCH-0754_BUSINESS_HOME_UPCOMING_STUB_DATA.md`. Accepted condition: full business-app lint remains red due unrelated repo-wide lint debt; no ORCH-0754 file appears in lint output.
- **Invariant / regression guard:** `I-PROPOSED-Z HOME-NO-FABRICATED-EVENTS` ratified ACTIVE at close. Business Home must not contain fabricated event rows or hardcoded event metrics; Home event truth derives from brand-scoped draft/live/order sources.
- **Causal cluster:** Cluster 3: transitional/demo data retirement drift after scope split.
- **Follow-ups not part of RC:** Brand Profile fake `STUB_PAST_EVENTS`, Finance Reports Brand-level `events` stub dependency, and Supabase/client event status vocabulary drift are separate discoveries from ORCH-0754.

### RC-0752: Android billing failure came from test-install eligibility plus stale cached app state, not app product-ID drift
- **Discovery date:** 2026-05-07
- **Proof:** `reports/INVESTIGATION_ORCH-0752_REVENUECAT_PRODUCT_OFFERING_CONFIGURATION.md` proved app code fetches RevenueCat `offerings.current` and buys returned packages rather than hardcoding store product IDs. `reports/INVESTIGATION_ORCH-0752B_ANDROID_PLAY_BILLING_PURCHASE_VERSION_GATE.md` captured the screenshot-era failure against a local/debug/sideload install. Close evidence in `reports/CLOSE_ORCH-0752_REVENUECAT_ANDROID_BILLING_CONFIG.md` shows the later tested app was the Play/internal build (`versionCode=12`, installer `com.android.vending`, no debug flag), app data was cleared successfully, and the user confirmed Billing works.
- **Symptoms caused:** Android purchase/package QA showed Google Play "This version of the application is not configured for billing through Google Play" during the screenshot-era install, then later the Billing/paywall sheet appeared stuck loading packages.
- **Causal chain:**
  1. The screenshot-era app instance was not the Play/internal eligible install, so Google Play Billing rejected purchase launch.
  2. The operator then installed the proper Play/internal build.
  3. Stale local app data/cache preserved a bad offering/session state, so packages still appeared stuck.
  4. Clearing app data forced a clean RevenueCat/offering/session path, and Billing worked after restart/sign-in.
- **Structural fix:** External/test-state correction only: use the Play/internal build for billing QA and clear stale app data when switching from debug/sideload or broken offering states. No product-code product-ID fix was required.
- **Status:** **CLOSED PASS 2026-05-07** via DEC-131 and user runtime confirmation after ADB install proof + `pm clear`.
- **Invariant / regression guard:** Android purchase QA must record the installed package source/version/debug state before interpreting Play Billing errors. If packages are empty after known dashboard changes, clear app data or invalidate RevenueCat/query cached null state before escalating to code.
- **Causal cluster:** Cluster 6: external billing/config/tester state can masquerade as app paywall failure.
- **Follow-ups not part of RC:** ORCH-0752A Billing sheet plan-pricing UX redesign remains open; iOS App Store product approval remains external release readiness if production iOS purchases are launch scope.

### RC-0753: Remote-applied Supabase migration was not versioned in Git
- **Discovery date:** 2026-05-07
- **Proof:** `reports/INVESTIGATION_ORCH-0753_MAIN_SUPABASE_MIGRATION_DRIFT.md` proved the linked remote had applied migration version `20260507000003` while `origin/main` lacked `supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql`. `reports/SPEC_ORCH-0753_MAIN_SUPABASE_MIGRATION_DRIFT.md` locked the safe repair to versioning the exact already-applied file. Tester PASS in `reports/TEST_REPORT_ORCH-0753_MAIN_SUPABASE_MIGRATION_DRIFT.md` proved commit `54553cb8` contains the migration, exact SQL matches the spec, and GitHub `Migrations apply cleanly from baseline` is green.
- **Symptoms caused:** Supabase Preview/main database-release checks reported `Remote migration versions not found in local migrations directory`, so the repository could not reproduce the linked remote migration ledger from Git.
- **Causal chain:**
  1. ORCH-0737 v8 timing diagnostics migration `20260507000003` was applied to the linked remote.
  2. The matching migration file stayed outside tracked Git history.
  3. GitHub's Supabase migration check compared remote-applied versions against local migrations on main.
  4. The remote version had no local tracked file, so the check failed even though app/docs checks were otherwise healthy.
- **Structural fix:** Versioned `supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql` with the exact already-applied SQL. No live DB mutation, migration repair, `supabase db push`, edge deploy, or product runtime change was part of the repair.
- **Status:** **CLOSED PASS 2026-05-07** via DEC-130, tester PASS, Git tree proof on `54553cb8`, GitHub migration baseline check success, and final Vercel commit statuses success.
- **Invariant / regression guard:** Every remote-applied Supabase migration version must be present in tracked Git history; intentional historical/backfill versioning must be documented as provenance repair and must not be paired with live DB mutation unless separately authorized.
- **Causal cluster:** Cluster 5: release provenance drift between live Supabase ledger and repository migration history.
- **Follow-ups not part of RC:** ORCH-0737 remains open for timing diagnostics/full-city baseline analysis.

### RC-0751: Duplicate auth cleanup callers raced RevenueCat logout after the first logout made the SDK anonymous
- **Discovery date:** 2026-05-07
- **Proof:** `reports/INVESTIGATION_ORCH-0751_REVENUECAT_ANONYMOUS_LOGOUT.md` proved the red Metro line was not a purchase failure but duplicate cleanup against RevenueCat's strict `logOut()` semantics. Runtime failure evidence in `reports/RUNTIME_QA_ORCH-0751_REVENUECAT_ANONYMOUS_LOGOUT.md` showed explicit sign-out logging `Logged out successfully` followed by native `Called logOut but the current user is anonymous`. Final proof in `reports/RETEST_ORCH-0751_REVENUECAT_LOGOUT_SERIALIZATION.md` showed the same Android sign-in -> sign-out -> sign-in path without the anonymous logout line.
- **Symptoms caused:** Healthy auth cleanup could emit a scary RevenueCat error during no-session/sign-out paths, making normal teardown look broken and making it harder to spot real purchase/auth failures.
- **Causal chain:**
  1. Auth cleanup had more than one caller capable of reaching RevenueCat logout during the same transition.
  2. RevenueCat `Purchases.logOut()` succeeds once and leaves the SDK anonymous.
  3. A second concurrent cleanup call can then hit native `logOut()` while anonymous.
  4. RevenueCat treats anonymous logout as an error, so Metro prints a red error even though user sign-out is otherwise healthy.
- **Structural fix:** `logoutRevenueCatIfIdentified()` now checks configuration and anonymity before native logout, treats only the exact anonymous-logout condition as a quiet no-op, keeps unknown errors visible, and serializes concurrent cleanup through one shared `guardedLogoutInFlight` promise. `loginRevenueCat(user.id)` remains untouched so anonymous-to-identified purchase identity merge still works.
- **Status:** **CLOSED PASS 2026-05-07** via Android runtime retest, `cd app-mobile && npm run test:orch-0751` PASS 11/11 including the T11 serialization guard, `cd app-mobile && npm run test:orch-0749` PASS, and `git diff --check` PASS.
- **Invariant / regression guard:** RevenueCat cleanup logout must be idempotent and serialized; duplicate cleanup callers cannot issue duplicate native `Purchases.logOut()` calls during one auth transition.
- **Causal cluster:** Cluster 2: noisy expected teardown versus real failures, with a concurrency/idempotency edge.
- **Follow-ups not part of RC:** ORCH-0752 RevenueCat product/offering/store approval configuration remains separate.

### RC-0749: Mobile auth cleanup allowed stale private query/cache state to outlive its user
- **Discovery date:** 2026-05-07
- **Proof:** `reports/INVESTIGATION_ORCH-0749_MOBILE_AUTH_CACHE_RLS_LOG_STORM.md` proved the startup log storm was not one bug but an auth-boundary failure across query persistence, auth cleanup, private fetchers, and noisy SDK/error classification. Runtime proof closed in `reports/RUNTIME_QA_ORCH-0749_MOBILE_AUTH_CACHE_RLS_LOG_STORM.md`.
- **Symptoms caused:** Fresh no-session startup could repeatedly log `A query that was dehydrated as pending ended up rejecting` for `userPreferences.<oldUserId>`; stale old-user query keys could continue after sign-out/reload; blocked-users fetch could log `Not authenticated` and still return/cached `[]`; Apple cancel and expected cancellation surfaced as app errors; AppsFlyer/engagement paths could fire after auth moved underneath them; Profile scroll/tabScroll updates produced repeated no-op store writes.
- **Causal chain:**
  1. React Query persistence allowed pending/non-idle private queries into hydration.
  2. Query keys containing a previous user id were not consistently removed on no-session, sign-out, or user-switch transitions.
  3. Some private service paths did not verify "the user I expected is still the user who owns this response" before returning fallback empty data.
  4. Expected auth teardown/cancellation paths were logged as errors, making normal lifecycle churn look like production failures.
  5. Profile tabScroll state updates lacked a no-op guard, amplifying noise after navigation.
- **Structural fix:** ORCH-0749 implementation added `queryPersistence` and `authCleanup` utilities, blocked pending/non-idle dehydration, removed auth-mismatched private cache, wired cleanup through no-session/SIGNED_OUT/user-switch/AppState/onboarding paths, made cancellation non-noisy, guarded blocked-users/preferences/Appsflyer/engagement paths, changed profile interests to tolerate missing rows, narrowed Profile subscriptions, added tabScroll no-op behavior, and locked the contracts with `app-mobile/scripts/ci/orch-0749-regression-check.mjs`.
- **Status:** **CLOSED PASS 2026-05-07** via static QA, runtime QA, operator smoke, and `cd app-mobile && npm run test:orch-0749` PASS at 2026-05-07 17:45 EDT.
- **Invariant:** `I-AUTH-PRIVATE-CACHE-CANNOT-OUTLIVE-AUTH-OWNER`.
- **Causal cluster:** Cluster 1/2 crossover: stale cache ownership + silent/noisy error classification. Future auth/query work must prove both data ownership and log behavior, not just "no crash."
- **Follow-ups not part of RC:** ORCH-0751 was closed separately under RC-0751/DEC-129; ORCH-0752 RevenueCat product/offering configuration remains open.

### RC-0728: RLS-RETURNING-OWNER-GAP — supabase-js mutations fail because no SELECT policy admits the post-mutation row
- **Discovery date:** 2026-05-06 (proven after 13 forensic passes ORCH-0728/0729/0731 + H39/H40/H41/H42)
- **Proof:** [reports/INVESTIGATION_ORCH_0731_B1_HISTORICAL_FORENSICS.md](reports/INVESTIGATION_ORCH_0731_B1_HISTORICAL_FORENSICS.md) (PASS-10) + H39 (DISABLE/ENABLE RLS toggle confirmed RLS as denier) + H40 (JWT decode showed `sub === user.id` exactly — JWT not the bug) + H41 (pg_policies enumeration showed 5 policies on brands; only INSERT and UPDATE/DELETE policies for owners, NO owner-SELECT policy) + H42 (operator dashboard SQL: pure INSERT *without* RETURNING succeeded under simulated auth, while INSERT *with* RETURNING returned 42501 — definitive disambiguator). Brands-table relpages = 0 confirmed bug latent since B1 phase 2 cycle.
- **Symptoms caused:** Brand-create from `BrandSwitcherSheet` returns 42501 (operator-reported "create-brand glitch"). Brand-delete from `BrandDeleteSheet` exhibits identical 42501 (operator-confirmed 2026-05-06). Likely also blocks every other operator-facing mutation across mingla-business B1 tables (events, tickets, orders, brand_members, team_invitations) that hits an RLS-gated INSERT/UPDATE/DELETE — full audit pending under ORCH-0734.
- **Causal chain:**
  1. supabase-js `.insert(...).select()` / `.update(...).select()` / `.delete().select()` defaults to `Prefer: return=representation`.
  2. Postgres performs the mutation. WITH CHECK / USING predicates pass for the actor.
  3. Postgres processes the implicit RETURNING by evaluating SELECT policies on the post-mutation row state.
  4. For brands INSERT: no SELECT policy admits an owner of a fresh brand (brand_members policy fails — no membership row, no AFTER INSERT trigger creates one — and public-events policy fails — fresh brand has zero events).
  5. For brands UPDATE soft-delete: every SELECT policy gates on `deleted_at IS NULL`; the post-update row has `deleted_at IS NOT NULL`; no SELECT policy admits.
  6. With no SELECT policy passing, Postgres rolls back the entire mutation and returns 42501 with the misleading message "new row violates row-level security policy" — although the INSERT/UPDATE WITH CHECK actually passed.
- **Structural fix (in dispatch — ORCH-0734 forensics IA):** prompts/INVESTIGATION_ORCH_0734_RLS_RETURNING_OWNER_GAP_AUDIT.md (PRIVATE_PROMPT_NOT_VERSIONED: `Mingla_Artifacts/prompts/INVESTIGATION_ORCH_0734_RLS_RETURNING_OWNER_GAP_AUDIT.md`) — comprehensive audit of every authenticated INSERT/UPDATE/DELETE policy on every mingla-business B1 table for matching post-mutation SELECT-policy coverage, followed by single fix migration. Canonical fix archetype: add permissive SELECT policy `(account_id = auth.uid()) AND (deleted_at IS NULL OR <admin/owner branch>)` for owners, and broaden any soft-delete-affected SELECT policies to admit `deleted_at IS NOT NULL` for admins/owners as appropriate.
- **Status:** **CLOSED 2026-05-06** — fix shipped via ORCH-0734 (DB owner-SELECT + owner-UPDATE policies on brands) + ORCH-0734-RW (rowcount verification + trash-icon parent-prop wiring) + ORCH-0740 Cycle 1 Foundation (focusManager + queryClient.clear + role TTL tighten + brandRoleKeys.allForBrand factory). Operator-attested CONDITIONAL PASS via 3 successful UI smoke tests across all 3 dispatch cycles. Wave commit `f6692198` shipped ORCH-0734 + ORCH-0734-RW; ORCH-0740 ships under follow-up commit. I-PROPOSED-H + I-PROPOSED-I flipped DRAFT→ACTIVE.
- **Invariants:** NEW (DRAFT until ORCH-0734 CLOSE) **I-PROPOSED-H RLS-RETURNING-OWNER-GAP-PREVENTED** — every authenticated mutation policy on `public.*` schema tables MUST be paired with at least one SELECT policy that admits the actor for the post-mutation row state. Enforced by a SQL-aware CI gate plugged into `.github/workflows/strict-grep-mingla-business.yml`.
- **Causal cluster:** Cluster 4 (NEW): "RLS-RETURNING bug class" — distinct from RC-001 (state ownership), RC-002 (silent errors), RC-003 (fabricated data). Architectural pitfall: spec authors who design RLS by thinking about "who can write/edit/delete" forget that supabase-js's RETURNING means "who can write" implies "who can read it back." Brand-create + brand-delete are two confirmed instances; ORCH-0734 audit will surface every other latent instance in mingla-business.
- **Lesson codified:** Every mutation policy needs a paired SELECT policy that admits the post-mutation row state. Soft-delete UPDATEs in particular need owner/admin-broadened SELECT policies because every "active row" SELECT policy excludes the freshly-tombstoned row. Future B-cycle backend work must use this as a checklist item before tester PASS. ORCH-0734 ships an invariant + CI gate + permanent memory file (`feedback_rls_returning_owner_gap.md`) so this pattern never re-emerges.

### RC-0686: TypeScript enum rename without SQL CHECK constraint update (`photo_backfill_runs.mode`)
- **Discovery date:** 2026-04-26
- **Proof:** reports/INVESTIGATION_ORCH-0686_PHOTO_BACKFILL_CREATE_RUN_500.md (missing reference: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0686_PHOTO_BACKFILL_CREATE_RUN_500.md`) — live-fire supabase MCP probe confirmed constraint def `CHECK ((mode = ANY (ARRAY['initial'::text, 'refresh_servable'::text])))`; data layer shows zero rows with new mode value `'pre_photo_passed'` (latest insert 2026-04-20, before ORCH-0678 deploy on 2026-04-25).
- **Symptoms caused:** Admin UI "Create photo download run" returns "Failed to create run / Edge Function returned a non-2xx status code" for every city. 14,401 pre-bouncer-approved places stranded. ORCH-0682 (Lagos+8-city operational recovery) Steps 2+3 cannot complete via the post-ORCH-0678 admin three-button flow.
- **Causal chain:** ORCH-0678 spec specified the `BackfillMode` TypeScript union rename `'initial'` → `'pre_photo_passed'` in `backfill-place-photos/index.ts` and admin UI call sites, but did NOT specify an `ALTER TABLE … DROP CONSTRAINT … ADD CONSTRAINT …` migration. Implementor faithfully followed spec; tester PASSed without live-fire of `create_run` end-to-end. Post-deploy, every `INSERT INTO photo_backfill_runs (..., mode='pre_photo_passed', ...)` raises Postgres SQLSTATE 23514 against the stale constraint. Edge fn returns 500. Supabase JS admin client surfaces generic message (body not unwrapped — Constitution #3 sub-finding F-4).
- **Structural fix (specced, not yet shipped):** prompts/SPEC_ORCH-0686_PHOTO_BACKFILL_MODE_CONSTRAINT.md (PRIVATE_PROMPT_NOT_VERSIONED: `Mingla_Artifacts/prompts/SPEC_ORCH-0686_PHOTO_BACKFILL_MODE_CONSTRAINT.md`) — migration amends constraint to `('initial','pre_photo_passed','refresh_servable')` (legacy `'initial'` retained for 18 historical rows, all terminal-state); flips DEFAULT to `'pre_photo_passed'`; adds CI gate `I-DB-ENUM-CODE-PARITY` requiring TS union and SQL CHECK to stay in sync; bundles admin error-body unwrapper helper to surface real Postgres errors in toast.
- **Status:** Investigated, specced, awaiting SPEC mode return → IMPL → TEST.
- **Invariants:** `I-PHOTO-FILTER-EXPLICIT` (text rewrite required — currently stale); new `I-DB-ENUM-CODE-PARITY` (registers structural prevention of this exact pattern).
- **Causal cluster:** Same shape as ORCH-0540 (PL/pgSQL type-resolution drift after flag flip — code change without schema/RPC alignment, missed by headless QA). Lesson: any rename of a persisted-value union or enum REQUIRES a migration step in the same spec, plus mandatory live-fire of an end-to-end write through the constrained column before tester PASS.

### RC-0664: DM Realtime Receive Silently Dropped (Pre-emptive Dedup)
- **Discovery date:** 2026-04-25
- **Proof:** `reports/INVESTIGATION_ORCH-0663_0664_0665_CHAT_TRIPLE.md` (3 RCs proven HIGH, 9 hidden flaws); confirmed live on 2026-04-25 via working-tree grep at `useBroadcastReceiver.ts:51`.
- **Symptoms caused:** Every friend's incoming DM silently dropped from receiver's UI until close+reopen. Both delivery paths (broadcast `chat:${id}` and postgres_changes `conversation:${id}`) successfully received the message but neither updated `setMessages`. Side effects (cache, conversation list, mark-as-read) DID run — purely a UI state miss.
- **Causal chain:** `useBroadcastReceiver.ts:51` marked `broadcastSeenIds.current.add(msg.id)` BEFORE invoking `onBroadcastMessageRef.current(msg)`. The delegate (`MessageInterface.handleBroadcastMessage`) was a no-op stub that did nothing. Then `subscribeToConversation`'s postgres_changes backup at `ConnectionsPage:1513` checked `broadcastSeenIds.current.has(newMessage.id)` → returned TRUE → skipped the `setMessages` add. Two delivery paths, both falsely thinking the other had handled it.
- **Structural fix:** Extracted `addIncomingMessageToUI` helper in `ConnectionsPage` as the SINGLE OWNER of message-add logic. Both paths funnel through it. Seen-set add is now INSIDE the helper, AFTER `setMessages` succeeds. `MessageInterface.onBroadcastReceive` is REQUIRED (non-optional) so TypeScript catches missing wiring at compile time. CI grep gate forbids any seen-set mutation calls inside `useBroadcastReceiver.ts`.
- **Status:** Fixed — ORCH-0664 cycle-2 (2026-04-25). Cycle-1 was lost when parallel ORCH-0666/0667/0668 work overwrote the working tree; cycle-2 re-applied the same contract surgically.
- **Invariant:** I-DEDUP-AFTER-DELIVERY (registered in INVARIANT_REGISTRY.md)
- **Recurrence vector:** Any future code using a "seen-set" or "idempotency cache" must populate it AFTER the handled work, not before delegation. The CI gate catches the canonical pattern in this file; pattern-equivalents in other files require code review discipline (no automated coverage). Sender-side at L1936-area is the documented legitimate exception (sender already mutated UI via optimistic-replace).

### RC-001: Duplicate State Authorities
- **Discovery date:** 2026-03-23
- **Proof:** Query key consolidation audit, Zustand field removal
- **Symptoms caused:** ORCH-0205 (query key drift), stale cache after mutations, ghost data
- **Causal chain:** Multiple query keys for same entity → invalidation misses one → stale data displayed
- **Structural fix:** One factory per entity, dead Zustand fields removed
- **Status:** Fixed
- **Invariant:** INV-S02, INV-S07

### RC-002: Silent Error Swallowing
- **Discovery date:** 2026-03-23
- **Proof:** 16 mutations without onError, 7 silent catches
- **Symptoms caused:** ORCH-0206, user actions appearing to succeed but failing silently
- **Causal chain:** try/catch without throw or toast → user sees no feedback → data inconsistency
- **Structural fix:** onError on all mutations, withTimeout wrappers, mutation error toast utility
- **Status:** Partially fixed (50+ remaining non-state-changing silent catches documented)
- **Invariant:** Constitutional #3 (no silent failures)

### RC-003: Fabricated Data on Card Surfaces
- **Discovery date:** 2026-03-24
- **Proof:** INVESTIGATION_FULL_CARD_PIPELINE_AUDIT.md Pass 1
- **Symptoms caused:** Fake ratings, hardcoded travel times, wrong currency symbols
- **Causal chain:** Fallback defaults used instead of real data → user sees plausible but false information
- **Structural fix:** All fallbacks removed, real data or nothing shown
- **Status:** Fixed
- **Invariant:** INV-D08, Constitutional #9

### RC-004: Race Condition in Preferences-to-Deck Pipeline
- **Discovery date:** 2026-03-24
- **Proof:** Commit 79d0905b, TEST_PASS2.md
- **Symptoms caused:** ORCH-0064, stale deck after preference change, cards from old preferences appearing
- **Causal chain:** invalidateQueries after preference save → batch fetch starts before cache clear → old params used
- **Structural fix:** invalidateQueries removed, prefsHash matching gates batch acceptance
- **Status:** Fixed
- **Invariant:** INV-S06

### RC-005: Error-Swallowing Multi-Step Operations
- **Discovery date:** 2026-03-22
- **Proof:** Commit 23f3a0dd (unpair flow)
- **Symptoms caused:** ORCH-0177, partial unpair leaving orphaned data
- **Causal chain:** 3-step sequential code with try/catch per step → step 2 fails → steps 1 and 3 succeed → inconsistent state
- **Structural fix:** Atomic RPC replaces multi-step client code
- **Status:** Fixed for unpair. Pattern likely exists elsewhere (unaudited).

## Recurring Patterns

| Pattern | Occurrences | Examples | Structural Fix | Status |
|---------|------------|----------|----------------|--------|
| Query-key drift | 8+ | ORCH-0205 (3 saved, 2 person, 2 blocked) | Key factory discipline | Fixed |
| Silent catch swallowing | 50+ | ORCH-0206 (16 mutations fixed) | onError + mutationErrorToast | Partially fixed |
| Fabricated fallback data | 10 surfaces | ORCH-0061 (ratings, prices, times) | Remove all fallbacks | Fixed |
| Duplicate state owners | 3 | Zustand prefs, Zustand blocked, old query keys | Single authority map | Fixed |
| Multi-step client mutation | Unknown | Unpair (fixed), other flows unaudited | Atomic RPCs | Partially fixed |

## Causal Clusters

### Cluster 1: "Card Data Truthfulness" (RESOLVED)
Root cause: RC-003. 10+ symptoms across card rendering, pricing, ratings, travel times.
All resolved in Card Pipeline Audit Passes 1-5.

### Cluster 2: "State Consistency" (PARTIALLY RESOLVED)
Root causes: RC-001 + RC-002 + RC-004. Query key drift + silent failures + race conditions.
Key factory fixed. Mutation errors partially addressed. Unknown extent in unaudited surfaces.

### Cluster 3: "Security Layer" (UNAUDITED)
Potential root cause: Missing or inconsistent RLS policies, unvalidated edge functions.
No investigation started. ORCH-0223, 0224, 0225, 0226 all at F.

### Cluster 4: "RLS-RETURNING bug class" (PROVEN, AUDIT IN FLIGHT)
Root cause: RC-0728. supabase-js `.insert/.update/.delete(...).select()` triggers `Prefer: return=representation`, which makes Postgres evaluate SELECT policies for RETURNING. If no SELECT policy admits the post-mutation row, the entire mutation rolls back with 42501 even though WITH CHECK passed. Two confirmed instances in mingla-business: brand-create (owner has no SELECT policy for fresh brands) and brand-delete (every SELECT policy excludes soft-deleted rows). ORCH-0734 audits the remaining surface area to enumerate and patch all latent instances. Lesson: every mutation policy needs a matching SELECT policy that admits post-state.
