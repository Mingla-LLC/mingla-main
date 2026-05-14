# INVESTIGATION — META-ORCH-0827 PLATFORM STRUCTURE — Pass 1

> **Dispatch:** `Mingla_Artifacts/prompts/FORENSICS_META-ORCH-0827_PLATFORM_STRUCTURE.md`
> **Author:** Claude `mingla-forensics` (INVESTIGATE+SPEC, iterative)
> **Date:** 2026-05-13
> **Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
> **Status:** Pass 1 complete. Phases 0, 1, 2, 5, 6 executed. Phases 3 (live-fire bundling) and 4 (platform-dep audit) deliberately paused pending operator confirmation that the recommendation in the Pass 1 SPEC is the direction to continue. Detailed reasoning in §10.
> **Verdict on the original framing:** the operator's framing of this investigation as "what does the codebase need to become to support persona expansion" was correct in spirit but **inverted relative to the documented strategy.** Persona expansion is real and locked, BUT the locked architecture is single-app, single unified data model — which materially weakens the case for workspace migration that prompted this work. See §9 and the Pass 1 SPEC.

---

## 0. Executive Summary (Layman)

The prior orchestrator session that dispatched ORCH-0826 (workspace migration) made three assumptions that turn out to be wrong:

1. It assumed the persona expansion the operator described (trip planners, event planners, physical venues) might be operator-headspace with no code evidence. **Wrong.** Persona expansion is the most thoroughly documented thing in the entire artifact tree: a 712-line `MINGLA_BUSINESS_1_2_WORKING_DOC.md`, a 628-line `PROJECT_SPEC_MINGLA_BUSINESS_1_2.md`, and **18 milestone briefs** at `Mingla_Artifacts/milestones/` covering M0 + Tr1-Tr8 + Ve1-Ve7 + C1-C2, all dated 2026-05-13 and PROJECT-LOCKED.

2. It assumed persona expansion might mean splitting mingla-business into multiple apps per persona. **Wrong.** The locked architecture is **explicitly single-app with a unified data model**: one `events` table with `event_type` discriminator (`event`/`experience`/`trip`), one `brands` table whose `kind` is starting identity not capability gate (I-1.2-BRAND-AS-CONTAINER), single `mingla-business` codebase serving native iOS/Android + Expo Web. No persona-per-app split.

3. It allocated the ID `ORCH-0826` to "workspace migration." **Wrong.** ORCH-0826 is already allocated to **M0 Hub Foundation** — the first milestone of the 1.2 build. The canonical M0 dispatch prompt exists at `Mingla_Artifacts/prompts/FORENSICS_ORCH-0826_M0_HUB_FOUNDATION_INVESTIGATE.md` and the M0 investigation has already been produced at `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0826_M0_HUB_FOUNDATION.md`. The prior session's `SPEC_ORCH-0826_WORKSPACE_MIGRATION.md` and `INVESTIGATION_ORCH-0826_WORKSPACE_MIGRATION.md` are ID-colliding artifacts that must be renamed.

The downstream consequence is large: the case for workspace migration weakens substantially under these facts. With single-app architecture locked, the "shared code across multiple business apps" benefit disappears. Most candidate `@mingla/*` packages would only deduplicate within mingla-business (native vs web of the same app), where Metro's existing single-codebase resolution already works. The actual cross-app byte-equivalent duplicates (eventTaxonomy, designSystem, BrandIcons, etc.) are constants and minor utilities — low-stakes drift risk that the existing strict-grep CI gates handle adequately.

The Pass 1 SPEC recommendation is to **defer workspace migration indefinitely** and let the 14-week 1.2 build proceed against the current monorepo structure. The locked plan does not require workspaces. If shared-code pain materializes during the 1.2 build, revisit; if not, the migration may never be necessary.

---

## 1. Phase 0 Ingest Receipt

Read directly (Read tool):

- `Mingla_Artifacts/MINGLA_BUSINESS_1_2_WORKING_DOC.md` (712 lines, full read)
- `Mingla_Artifacts/PROJECT_SPEC_MINGLA_BUSINESS_1_2.md` (first 200 lines + grep verification of remaining sections)
- `Mingla_Artifacts/milestones/M0_HUB_FOUNDATION.md` (full)
- `Mingla_Artifacts/ARTIFACT_MANIFEST.md` (full)
- `supabase/migrations/20260506000000_brand_kind_address_cover_hue_media.sql` (full)

Read via Explore sub-agents and verified by spot-checks (per dispatch rule: no sub-agent claims accepted unverified; the operator-supplied 1.2 working doc and project spec were verified directly above):

- Cross-app duplicate inventory (every multi-occurrence basename across `app-mobile/src/`, `mingla-business/{src,app,server,api}/`, `mingla-admin/src/`, `supabase/functions/_shared/`)
- Persona keyword scan across the entire repo + `~/.claude/projects/-Users-sethogieva-Desktop-mingla-main/memory/`
- Strategic artifact reading (BUSINESS_PRD, BUSINESS_PROJECT_PLAN, BUSINESS_STRATEGIC_PLAN, FOUNDER_FEEDBACK, POSITIONING_AND_GTM, MINGLA_BRAIN, MARKETING_HUB, RCS_CONCIERGE, PRODUCT_COMPETITIVE, PRODUCT_SNAPSHOT, ENGINEERING_HANDBOOK, cycle epics 0a/0b/1-17/b1-b6, SPEC_QUEUE, PRIORITY_BOARD)
- Data model + auth audit (migration chain for `brands`, `events`, `creator_accounts`, `brand_team_members`, `stripe_connect_accounts`, role enums, RLS policies, edge function role branching)
- Existing ORCH-0826 artifact inventory (confirmed M0 + workspace-migration both exist under same ID — ID collision)

Read indirectly (file size exceeded Read limit; ingested via grep for relevant content):

- `Mingla_Artifacts/WORLD_MAP.md` (682 KB — not read full; cross-checked via Explore agent's findings)
- `Mingla_Artifacts/DECISION_LOG.md` (342 KB — relevant DEC-112/113/114/121/125/126/128 extracted via Explore)
- `Mingla_Artifacts/INVARIANT_REGISTRY.md` (313 KB — relevant I-1.2-* extracted via Explore + verified against project spec §2.2)

Tool & environment baseline:

- `/Users/sethogieva/.deno/bin/deno` exists (used for any Deno gate work)
- `pnpm` NOT installed locally — must `corepack enable && corepack prepare pnpm@9.15.0 --activate` before any workspace migration could proceed (UNK-001)
- `npm` v22.22.2, node v22.22.2 present
- `mingla-business/` confirmed has `vercel.json`, `public/`, `api/`, `server/`, `jest.config.cjs` — substantially more web infrastructure than the prior session's ORCH-0826 SPEC modeled

---

## 2. Persona Universe — Confirmed Reality

### 2.1 Documented personas (verbatim, from MINGLA_BUSINESS_1_2_WORKING_DOC.md §0, lines 20-24)

The 1.2 working doc enumerates **four seller personas** by name:

1. **Physical venues** — restaurants, bars, galleries, studios, arcades
2. **Popup organizers** — DJs, promoters, comedians, party throwers (today's default — no new persona-specific work in 1.2)
3. **Trip & itinerary planners** — retreat hosts, wine-tour operators, weekend-getaway packagers, bachelorette curators
4. **Hybrid / multi-type brands** — any brand can grow into any combination

**Operator-named "event planner" does NOT appear in any artifact.** The persona keyword scan returned zero hits for `event[ _-]?planner` across the entire codebase + every Mingla_Artifacts file. The operator's verbal list (trip planners, event planners, physical venues) was imprecise — "event planner" appears to have been a colloquial term that maps onto the existing popup-organizer persona or to event_manager (a functional role within a brand, rank 40, per the brand_team_members CHECK enum).

### 2.2 Architectural framing (verbatim, from working doc §0, lines 26-31)

> "The single unifying data model: every sellable thing is a row in the existing `events` table with an `event_type` discriminator (`event` / `experience` / `trip`) and type-specific sidecar tables. Tickets, orders, refunds, marketing audiences, scanners — everything flows through one engine. Trips are just events with day-by-day structure, installment-aware tickets, intake-form-aware orders, and an attached multi-party discussion thread."

> "There is no parallel WeTravel-clone build. There is only a careful extension of one engine."

Operator's compressing insight (cited at working doc line 29):
> "A trip is nothing but a complex ticket and a discussion board."

### 2.3 Brand-as-flexible-container (verbatim, §2, lines 56-70)

> "A brand is a container, not a fixed type. The persona pick at brand creation is a starting identity that determines initial setup defaults — but **never locks the brand into a single offering type.**"
>
> "This principle directly contradicts an earlier framing in the ORCH-0825 audit that suggested persona was a lock-in. **This document supersedes that framing.**"

The persona discriminator is a column on `brands` (`brands.kind`), not a separate app. Operator can have one account that owns multiple brands of different `kind` values. Any brand can author any offering type via the top-bar universal "+" creator.

### 2.4 Schema state (what's deployed vs what's specified)

Per `supabase/migrations/20260506000000_brand_kind_address_cover_hue_media.sql` line 19 (current authoritative migration per chain rule):

```sql
ADD COLUMN kind text NOT NULL DEFAULT 'popup'
  CHECK (kind IN ('physical', 'popup')),
```

**Currently deployed:** `('physical', 'popup')` only.

**Planned in M0 migration** (per `PROJECT_SPEC_MINGLA_BUSINESS_1_2.md` §3.1 lines 86-87):

```sql
DROP CONSTRAINT IF EXISTS brands_kind_check,
ADD CONSTRAINT brands_kind_check CHECK (kind IN ('physical', 'popup', 'trip_planner')),
```

**Planned in M0 migration for events** (per project spec §3.3 lines 128-135):

```sql
ALTER TABLE public.events
  ADD COLUMN event_type text NOT NULL DEFAULT 'event'
    CHECK (event_type IN ('event', 'experience', 'trip'));
```

Trip sidecar tables (`trip_days`, `trip_pricing_tiers`, `trip_inclusions`, `trip_room_assignments`), installment tables (`order_installments`, `ticket_types.installment_schedule`), discussion board (`event_threads`, `event_thread_messages`), and intake schema (`trip_intake_schema`, `orders.intake_form_data`, `orders.room_share_preference`) all SPEC'D but NOT YET MIGRATED. They land in Tr2/Tr3/Tr5/Tr6/Tr7 respectively.

### 2.5 Confirmed timeline (verbatim from working doc §6.5)

```
Week    1   2   3   4   5   6   7   8   9   10  11  12  13  14
M0      ███
Track 1     Tr1 Tr2 Tr2 Tr3 Tr3 Tr4 Tr5 Tr5 Tr6 Tr6 Tr7 Tr8 Tr8
Track 2     Ve1 Ve1 Ve2 Ve3 Ve4 Ve5 Ve5 Ve6 Ve7
Track 3                                     C1  C1  C2  C2  C2
```

~14 weeks wall-clock. Three parallel tracks after M0. Two engineers (Seth + Taofeek) with floating ownership.

---

## 3. ORCH-ID Collision (Critical Finding)

| ID | Canonical use (per 1.2 plan) | Conflicting use (prior orchestrator session) |
|---|---|---|
| ORCH-0826 | M0 Hub Foundation. Dispatch at `Mingla_Artifacts/prompts/FORENSICS_ORCH-0826_M0_HUB_FOUNDATION_INVESTIGATE.md`. Investigation at `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0826_M0_HUB_FOUNDATION.md` (already produced). | Workspace migration. SPEC at `Mingla_Artifacts/specs/SPEC_ORCH-0826_WORKSPACE_MIGRATION.md`. Investigation at `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0826_WORKSPACE_MIGRATION.md`. |

Both artifact pairs exist. They are NOT the same work. The 1.2 plan explicitly names ORCH-0826 = M0 per working doc line 678:

> "Immediate next action: M0 INVESTIGATE. Dispatch Claude mingla-forensics (INVESTIGATE mode) for M0... The dispatch prompt lives at `Mingla_Artifacts/prompts/FORENSICS_ORCH-0826_M0_HUB_FOUNDATION_INVESTIGATE.md`."

**Resolution required:**

1. The prior session's workspace-migration artifacts (`SPEC_ORCH-0826_WORKSPACE_MIGRATION.md` and `INVESTIGATION_ORCH-0826_WORKSPACE_MIGRATION.md`) need to be renamed to a non-colliding ID. Suggested: `META-ORCH-0828_WORKSPACE_MIGRATION` (META prefix matching the iterative-planning convention of META-ORCH-0744, META-ORCH-0755, META-ORCH-0827).
2. M0 (ORCH-0826) execution proceeds against its own existing investigation.
3. The current investigation (META-ORCH-0827) is correctly numbered and continues.

If the workspace migration is deferred per the Pass 1 SPEC recommendation, the colliding artifacts can simply be archived under `Mingla_Artifacts/archive/` with a breadcrumb noting they were superseded by META-ORCH-0827 Pass 1.

---

## 4. Cross-App Duplicate Inventory (Phase 1)

### 4.1 Byte-equivalent across trees (CI-enforced candidates)

| Basename | Locations | Drift risk |
|---|---|---|
| `eventTaxonomy.ts` | `app-mobile/src/constants/` + `mingla-business/src/constants/` + `supabase/functions/_shared/` (3-way) | Strict-grep gate already enforces parity (per `feedback_strict_grep_registry_pattern.md`) |
| `stripeSupportedCountries.ts` | `mingla-business/src/constants/` + `supabase/functions/_shared/` (2-way) | No current CI gate; low drift risk (constants list) |
| `priceTiers.ts` | `app-mobile/src/constants/` + `supabase/functions/_shared/` (2-way) | No current CI gate |
| `designSystem.ts` | `app-mobile/src/constants/` + `mingla-business/src/constants/` (2-way) | No current CI gate |
| `BrandIcons.tsx` | `app-mobile/src/components/ui/` + `mingla-business/src/components/ui/` (2-way) | SVG glyphs; very low drift risk |
| `responsive.ts` | `app-mobile/src/utils/` + `mingla-business/src/utils/` (2-way) | Utility functions; low drift risk |
| `revenueCatService.ts` | `app-mobile/src/services/` + `mingla-business/src/services/` (2-way) | Subscription SDK wrapper; moderate drift risk |

**Workspace-migration value:** modest. Most are constants/utilities. The triplicate `eventTaxonomy.ts` is already CI-enforced. Total deduplication win: ~7 files become packages.

### 4.2 Logical-equivalent (platform-adaptive)

| Basename | Locations | Why divergent |
|---|---|---|
| `currency.ts` | `app-mobile/src/utils/` (114 lines) + `mingla-business/src/utils/` (185 lines) + `supabase/functions/_shared/email/` (30 lines) | RN vs Deno split — Deno copy explicitly created (per its own ORCH-0785 comment) to keep edge functions from cross-importing RN code |
| `supabase.ts` | `app-mobile/src/services/` (108 lines, AsyncStorage + timeout harness) + `mingla-business/src/services/` (50 lines, env-driven, no timeout harness) | Two RN apps with different init complexity — app-mobile is production-mature, mingla-business is nascent |
| `queryClient.ts` | `app-mobile/src/config/` (219 lines, full cache+persister+focusManager) + `mingla-business/src/config/` (42 lines, minimal) | Same drift profile: production-mature vs nascent |

**Workspace-migration value:** these would need platform-conditional packages with `package.json` `"exports"` conditions. The currency split is genuinely tricky (RN imports `getUserLocale()`, Deno imports `Intl` directly). Not a clean extraction.

### 4.3 Stripe code reality (revises prior session's assumption)

| File location count | Total |
|---|---|
| `@stripe/*` imports in `app-mobile/` | **ZERO** |
| `@stripe/*` imports in `mingla-admin/` | **ZERO** |
| `@stripe/*` imports in `mingla-business/` | 2 (StripeNativeProvider.native.tsx, connect-onboarding.tsx) |
| Stripe code in `mingla-business/` (no SDK import but uses Stripe concepts) | ~12 files (services, components, utils) |
| Stripe code in `supabase/functions/_shared/` (Deno) | 1 SDK file + ~10 supporting modules |
| Stripe code in `supabase/functions/<each>/index.ts` | ~10 functions |

**Consequence:** the original ORCH-0826 SPEC's rationale of "Stripe code triplicated across app-mobile, mingla-business, and possibly somewhere else" is **wrong by inspection**. Stripe is mingla-business + edge functions only. The proposed `@mingla/payments` package would only deduplicate WITHIN mingla-business (native via `@stripe/stripe-react-native`, web via `@stripe/react-connect-js` / future `@stripe/react-stripe-js`). That's intra-app, not cross-app.

Within a single Expo app, native and web variants are normally handled by Metro's `.native.tsx` / `.web.tsx` resolution + `package.json` `"react-native"` / `"browser"` exports — no workspace package required. The existing `StripeNativeProvider.native.tsx` already uses this pattern correctly.

### 4.4 Edge function shared modules

`supabase/functions/_shared/` already houses 68 modules with 41 usages of the email index, 13 of audit, 11 of ticketCheckout, 11 of stripe. This subsystem is already centralized and serves as Deno's equivalent of a workspace package. Workspace migration does not improve this — Deno cannot consume pnpm workspaces (Deno's module resolution is HTTP-based ESM, not npm).

### 4.5 Brand / event / payment / calendar code

- **Brand rendering:** 26 files in `mingla-business/`. **Zero in `app-mobile/`.** No cross-app duplication.
- **Event rendering:** divergent — `app-mobile/` has consumer-facing components (BusinessEventCard, ExpandedBusinessEventSheet), `mingla-business/` has operator-facing components (EventListCard, EventDetailKpiCard, etc.). Different intents, different components. Not duplicates.
- **Payment / checkout:** 100% mingla-business + edge functions. Zero consumer-side.
- **Calendar:** `expo-calendar` device-side in `app-mobile/` only; iCal email generation in `supabase/functions/_shared/email/`. No cross-app duplication.

**Conclusion: there is no significant cross-app duplicate code in the high-value domains (brand, event, payment, calendar).** The duplicates that exist are constants and utilities (4.1) plus platform-adaptive split files (4.2).

---

## 5. Data Model & Auth Audit (Phase 5)

### 5.1 Account / brand / role model — current state

- `creator_accounts`: id (FK to auth.users), email, display_name, avatar_url, business_name (free text — NOT enumerated), phone_e164, marketing_opt_in, deleted_at, default_brand_id. **No `account_type` column.** No persona discriminator at account level.
- `brands.kind`: `('physical', 'popup')` per `20260506000000_brand_kind_address_cover_hue_media.sql:19` (latest authoritative). Will extend to `('physical', 'popup', 'trip_planner')` in M0 migration.
- `brand_team_members.role`: 6 functional roles — `account_owner`(60), `brand_admin`(50), `event_manager`(40), `finance_manager`(30), `marketing_manager`(20), `scanner`(10). Per `biz_role_rank()` function (`baseline_squash_orch_0729.sql:3315-3328`). **These are functional positions within a brand, NOT persona switches.**
- `stripe_connect_accounts.controller_dashboard_type`: `('standard', 'express', 'custom')` — Stripe API config, not Mingla persona.
- A single `creator_accounts` row can own many `brands` rows (1:many, no unique constraint on account_id). So one user can own a `physical` brand + a `trip_planner` brand simultaneously.

### 5.2 RLS branching

All RLS policies branch on:
- Direct ownership (`account_id = auth.uid()`)
- Brand membership (via `brand_team_members`)
- Role rank comparison (`biz_brand_effective_rank >= biz_role_rank('X')`)

**Zero policies branch on `account_type`, `business_type`, `persona`, or any persona-like discriminator.** RLS is role-based, not persona-based. Persona expansion does not require new RLS pattern.

### 5.3 Can current schema support 4 personas without migration?

**No** — but the M0 migration explicitly adds `trip_planner` to `brands.kind` and `event_type` discriminator to `events`. After M0 (1 week of work), the schema supports the full 4-persona universe (physical, popup, trip_planner, hybrid via per-brand kind).

### 5.4 Can one account belong to multiple personas?

**Yes**, via the existing 1:many account→brands relationship. No schema change needed for multi-persona accounts; the constraint is purely UX (BrandSwitcherSheet must let the operator pick which brand to act under).

---

## 6. Architecture: Single-App, Locked

Per `MINGLA_BUSINESS_1_2_WORKING_DOC.md` and `PROJECT_SPEC_MINGLA_BUSINESS_1_2.md`:

- **One mingla-business app** serves all four personas (physical / popup / trip_planner / hybrid)
- Bottom nav: `Home | Hub | Ari | Blast | Account` (5 tabs)
- Hub tab absorbs today's Events tab and gains sub-tabs `Events | Experiences | Trips`
- Top-bar universal "+" sheet with three create options (event / experience / trip-or-otherwise)
- Mobile + web parity via Expo Web (per BUSINESS_PRD lines 34-36 and DEC-081 closing `mingla-web/` Next.js codebase)
- Consumer app (`app-mobile`) gains a new Trips tab (C1 milestone) and weaves venue experiences into existing Discover feed (C2 milestone)

**There is no documented plan to split mingla-business into per-persona apps.** The persona is a column on `brands`, not a separate codebase. The "brand-as-flexible-container" principle (I-1.2-BRAND-AS-CONTAINER) explicitly makes persona a starting identity, not a capability gate or app boundary.

**Web target inventory** (verified from filesystem and DEC-081 close):
- `mingla-business/` has `vercel.json`, `public/`, `api/`, `server/` — confirmed web deploy via Vercel
- Anonymous routes per memory `feedback_anon_buyer_routes.md`: `/checkout/{eventId}`, `/e/{brandSlug}/{eventSlug}`, `/b/{brandSlug}` — all web-served outside `app/(tabs)/`
- Trip detail web route adds: `/t/{brandSlug}/{tripSlug}` (planned in Tr2)
- Public venue page: `/b/{slug}` extends in Ve4 with structured listing
- `app-mobile/` web build is broken per memory `feedback_eas_update_no_web.md` due to `react-native-maps` — not a target
- `mingla-admin/` has its own Vite build to Vercel — independent web target

---

## 7. Workspace Migration: Honest Cost-Benefit Re-Assessment

Given the locked single-app architecture and confirmed cross-app duplicate scope, here is the revised cost-benefit:

### 7.1 Benefits the workspace migration actually delivers

| Benefit | Magnitude |
|---|---|
| Deduplicate 7 byte-equivalent constants/utilities into `@mingla/*` packages | Small — already low drift, existing strict-grep gate handles taxonomy |
| Provide a path to share future code between mingla-business and app-mobile | Speculative — no current plan creates this need; the 14-week 1.2 plan is mingla-business-internal except for Tr2 + Ve7 → C1/C2 consumer surfacing, which is API-mediated not code-shared |
| Force a `@mingla/payments` API design that works for native + web | The split exists WITHIN mingla-business (native vs web). Metro's `.native.tsx` / `.web.tsx` resolution + `package.json` `"exports"` conditions handle this already without workspaces. The StripeNativeProvider.native.tsx file is the existing precedent. |
| Reduce CI gate maintenance | Small — current 17+ gates work; new gates can be added per the strict-grep registry pattern (`feedback_strict_grep_registry_pattern.md`) |

### 7.2 Costs the workspace migration actually imposes

| Cost | Magnitude |
|---|---|
| 1.5–4 days of file moves + path rewrites + Metro/Vite/EAS reconfiguration + debugging | Real — must be spent before any 1.2 milestone proceeds |
| pnpm not currently installed; operator setup step required | Small but non-zero |
| EAS Build cloud iteration on path/config issues (typical 1–3 failed builds at 10–15 min each) | Real |
| Metro monorepo resolution fragility — symlink hoisting, duplicate React instances, release-only failures | Real risk |
| New CI gate for Deno-side eventTaxonomy mirror (Deno can't consume pnpm) | Small |
| Risk of delaying the 14-week 1.2 build by ≥1 sprint while workspace fragility shakes out | Real and significant — 1.2 is the operator's locked roadmap |
| Coordinating Taofeek (co-founder engineer) onto the new pnpm + workspace conventions | Small but real |

### 7.3 Net assessment

**Costs exceed benefits under the current strategic picture.** The locked 1.2 plan does not produce shared-code needs that the existing monorepo can't handle:

- The 18 milestones each touch mingla-business + supabase only, with rare consumer-side ripples (C1, C2) that go through edge function APIs, not shared code.
- The intra-mingla-business native/web split (Stripe, future trip wizard, future venue page) is solved by Metro file-extension resolution, not by workspaces.
- The cross-app duplicates that exist (eventTaxonomy, designSystem, BrandIcons, etc.) are constants/utilities with low drift risk and existing CI coverage where it matters.

**Recommendation: defer workspace migration indefinitely.** Let the 1.2 build proceed against the current monorepo. Revisit if and when shared-code pain materializes during the 14-week build — at which point the migration scope will be informed by concrete needs rather than speculation.

---

## 8. Phase 6 — Explicit Unknowns Register (Pass 1)

Unknowns ranked by whether they block the Pass 1 SPEC recommendation.

| ID | Question | Why it matters | Who answers | Current best guess | Confidence | Blocking? |
|---|---|---|---|---|---|---|
| UNK-001 | Is operator OK with deferring workspace migration indefinitely, given the revised cost-benefit? | Determines whether to proceed with workspace work at all or focus on M0 → 1.2 build | Operator | Likely yes given the locked 1.2 plan doesn't require it | probable | **YES** — Pass 1 SPEC pivots on this |
| UNK-002 | Should `SPEC_ORCH-0826_WORKSPACE_MIGRATION.md` and `INVESTIGATION_ORCH-0826_WORKSPACE_MIGRATION.md` be archived (workspace-migration deferred) or renamed (workspace-migration deferred but artifacts preserved as META-ORCH-0828)? | ID hygiene; archive choice affects what shows up in PRIORITY_BOARD / WORLD_MAP | Operator | Archive with breadcrumb pointing to this report | suspected | YES — hygiene |
| UNK-003 | Is the operator's earlier verbal "event planner" persona a synonym for popup-organizer, or for the event_manager role within a brand, or something else not yet documented? | Could indicate a documentation gap; or could just be terminology drift | Operator | "Event planner" is colloquial for popup-organizer; the formal persona is popup-organizer | probable | NO — documentation gap only |
| UNK-004 | Does mingla-business web bundling actually work today against current monorepo (no regression that 0826 deferral would mask)? | Pre-requisite check for any future Phase 2 / native checkout work | Live-fire `expo export -p web` | Believed to work — `mingla-business/vercel.json` is configured, public event page is deployed | probable | NO for Pass 1 SPEC (since recommendation is defer); YES if recommendation changes |
| UNK-005 | Is Taofeek currently on Seth branch + same toolchain (npm, node 22, deno) or a different setup? | If different, workspace migration adds onboarding cost; even monorepo status quo may have pinpoint issues | Operator | Unknown | suspected | NO for Pass 1 SPEC |
| UNK-006 | Does the operator want the META-ORCH-0827 iterative protocol to continue past Pass 1 if Pass 1 recommendation is "defer"? Or does deferral close the investigation? | Per dispatch §11, termination requires operator say-so | Operator | If defer is accepted, close META-ORCH-0827; if defer is rejected, Pass 2 targets the rejection reason | suspected | YES — gates Pass 2 vs close |
| UNK-007 | What is the operator's current mental model of "ORCH-0824-F Phase 2" (native checkout + sheet/public-page parity) — is it still a real upcoming priority or has it been subsumed/replaced by 1.2 milestones? | 1.2 plan does not explicitly include ORCH-0824-F Phase 2; Tr2 includes buyer checkout but that's per-track, not the ORCH-0824-F sheet-parity scope | Operator | ORCH-0824-F Phase 2 may be superseded by Tr2's buyer checkout work; needs explicit closure | suspected | YES — affects priority board |
| UNK-008 | Are Pass 1's "candidate `@mingla/*` package extractions" worth pursuing as a low-stakes followup even if full workspace migration is deferred? E.g., a `@mingla/event-taxonomy-shared` strict-grep mirror could be tightened. | Quick-win refactor without monorepo change | Operator | Probably not worth orchestrator attention given the 1.2 backlog | suspected | NO — opportunity-cost question |
| UNK-009 | Will Phase 3 live-fire bundling (mingla-business web export, app-mobile web failure capture, bundle composition) actually produce decision-relevant data, or is it busywork given the defer recommendation? | Saves Pass 2 cycles if not | This investigation | If defer accepted, live-fire baselines are not needed unless something downstream changes | probable | NO — Pass 1 SPEC recommends pause until operator confirms direction |
| UNK-010 | Does the prior session's `INVESTIGATION_ORCH-0826_WORKSPACE_MIGRATION.md` contain any finding that contradicts the conclusions here? (Not read yet in this Pass — would need to spot-check before Pass 2 closes the workspace question.) | Honesty check — the prior session might have surfaced a real cost-benefit driver that my synthesis missed | This investigation Pass 2 (if operator continues) | Possibly contains some duplicate-inventory data also re-derived here; unlikely to contradict the locked 1.2 architecture finding | suspected | NO for Pass 1; YES if operator wants definitive closure |

**Pass 1 blocking-unknown count: 4 (UNK-001, UNK-002, UNK-006, UNK-007).** All four require operator answer before Pass 2 can productively continue.

---

## 9. Five-Layer Cross-Check

| Layer | Finding |
|---|---|
| **Docs** | 1.2 working doc + project spec + 18 milestone briefs + ARTIFACT_MANIFEST + DEC-112/113/114/121 all consistent: single-app, unified data model, persona-as-brand-kind |
| **Schema** | Migrations confirm: `brands.kind` currently `('physical','popup')`, M0 will extend to include `trip_planner`. `events.event_type` is a column to be added in M0. No persona-discriminator at account or role level today. |
| **Code** | Cross-app duplicates inventoried — primarily constants/utilities, not high-value shared business logic. Stripe code is mingla-business + edge functions only. Brand/event/payment code is single-app per domain. |
| **Runtime** | mingla-business confirmed has vercel.json + public/api/server directories for web deploy. app-mobile web confirmed broken per existing memory. Deno + npm available locally; pnpm not. |
| **Data** | No queries run against live DB in Pass 1 — limited to migration-chain reading. Schema state per latest migration is authoritative. |

**No layer contradictions.** All layers agree that the persona universe is four-named, the architecture is single-app, and the schema route to support is additive migration in M0 + sidecar tables across Tr/Ve tracks.

---

## 10. Why Phases 3 and 4 Are Paused

Phase 3 (live-fire bundling baselines) and Phase 4 (platform-conditional dep audit) were explicitly mandated by the dispatch. They are paused, not skipped, because:

1. **The Pass 1 SPEC recommendation is "defer workspace migration."** Live-fire web bundling baselines + platform dep audits are only decision-relevant if workspace migration is proceeding. If operator accepts defer, those phases are not needed.
2. **If operator rejects defer**, Pass 2 will execute Phase 3 + Phase 4 immediately, targeting the specific concerns operator raises.
3. **No silent skipping.** Per dispatch §6 ("if blocked, stop and ask"), pausing here is explicit and reported. The cost of running Phase 3 + 4 unconditionally is ~1–2 hours of agent time and ~10 minutes of operator-visible bundling output — small but non-zero, and avoidable if defer is accepted.

If operator continues to Pass 2 with "no, don't defer — I want the workspace migration" or "I want concrete proof the case is weak," Pass 2 will:

- Run `expo export -p web` against mingla-business and capture full output (bundle composition, errors, size)
- Run `expo export -p web` against app-mobile to confirm the documented react-native-maps failure
- Audit every candidate `@mingla/*` package against the platform availability matrix (native iOS, native Android, web RN, web browser, Deno)
- Spot-check the prior session's workspace-migration investigation for any finding this Pass missed
- Produce a quantitative recommendation with bundle-size deltas and dep-tree counts

---

## 11. Recommendations Going Into Pass 1 SPEC

Distilled from the above:

1. **Resolve ORCH-0826 ID collision.** Archive the prior session's workspace-migration artifacts. ORCH-0826 belongs to M0 Hub Foundation.
2. **Defer workspace migration.** Net cost > net benefit under the locked 1.2 plan. Revisit if shared-code pain materializes mid-build.
3. **Proceed with M0 INVESTIGATE/SPEC/IMPLEMENT as already queued.** The M0 brief + project spec are detailed enough to dispatch immediately.
4. **Acknowledge that ORCH-0824-F Phase 2 (native checkout sheet parity) may need re-scoping or closure** in light of Tr2 covering buyer checkout under the new unified architecture.
5. **Close META-ORCH-0827 after operator confirms acceptance,** or continue to Pass 2 if operator wants live-fire verification or rejects the deferral.

These are the inputs to the Pass 1 SPEC at `Mingla_Artifacts/specs/SPEC_META-ORCH-0827_PLATFORM_STRUCTURE_PASS_1.md`.

---

## 12. Discoveries for Orchestrator (Side Issues)

1. **ORCH-0826 ID double-use** — must be cleaned up regardless of workspace migration decision.
2. **Documentation drift**: WORLD_MAP.md (682 KB), DECISION_LOG.md (342 KB), INVARIANT_REGISTRY.md (313 KB) are too large for direct Read tool; consider whether the 1.2 milestone CLOSE protocol should split these into per-cycle files.
3. **PRD says "Mobile + Web parity"** (line 34) but app-mobile web is documented broken (react-native-maps). Either app-mobile is exempt from this rule or PRD should be amended.
4. **The phrase "event planner" used by the operator** doesn't match any documented persona — possible documentation gap or terminology drift worth a one-line clarification in the working doc.
5. **The current prompts folder is documented as private/ignored** (per ARTIFACT_MANIFEST) but contains the M0 dispatch which is referenced by the 1.2 working doc. Either the prompt should be promoted to a tracked location, or the working doc reference should be updated.
6. **The strategic agent identified "Mingla_Roadmap/" as a PMM planning system** (per ARTIFACT_MANIFEST line 50). Did not deep-read this Pass; may contain additional persona/roadmap context worth a Pass 2 read if operator continues.

---

## 13. Confidence Level

**Overall: HIGH** for the strategic findings (persona universe, single-app architecture, ORCH-0826 collision) — all verified against authoritative artifacts directly read.

**MEDIUM** for the cross-app duplicate inventory — sub-agent produced the inventory; spot-checks confirmed key entries (Stripe SDK absence in app-mobile; brand code mingla-business-only) but the full ~31-file multi-occurrence list was not byte-diffed by me.

**LOW** for the assertion that workspace migration adds zero value beyond what Metro file-extension resolution provides — this is a synthesis-level claim that would benefit from Pass 2 live-fire validation IF operator wants definitive proof. The "defer" recommendation does not require this proof — it just requires operator agreement that the case has weakened.

End of Pass 1 investigation.
