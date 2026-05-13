# Mingla Business 1.2 — Project Spec (Operating Manual)

> **Companion documents:**
> - Strategic overview: `Mingla_Artifacts/MINGLA_BUSINESS_1_2_WORKING_DOC.md`
> - Engineering handbook: `Mingla_Artifacts/MINGLA_ENGINEERING_HANDBOOK.md`
> - Per-milestone briefs: `Mingla_Artifacts/milestones/M0_*.md` … `C2_*.md`
> - Source audit: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0825_BUSINESS_APP_VENUE_CLAIM_INTEGRATION_AUDIT.md`
>
> **Status:** Locked, 2026-05-13. Living document — operator amends as architecture evolves.
> **Owner of this doc:** Claude `mingla-orchestrator` (per-milestone updates via SYNC mode).
> **Last revision:** 2026-05-13 (project lock-in pass).

---

## 1. Purpose

This document is the canonical operating manual for Mingla Business 1.2. It defines how the project executes — not what the features are. (For features and timeline, read the working doc. For per-milestone deliverables, read the milestone briefs.)

Read this when:
- You're about to start a new milestone and need to understand the pipeline
- You're an engineer not in the Claude/agent loop and want to know what conventions apply
- You're trying to figure out where an artifact goes
- You're at "close" for a milestone and need the protocol
- You're trying to resolve an architectural question and want decision-log references

---

## 2. Architectural Principles (Non-Negotiable)

These are inherited from the larger Mingla codebase and apply to every milestone in 1.2.

### 2.1 The Mingla Constitution (14 rules — automatic P0 on violation)

1. **No dead taps** — every interactive element responds
2. **One owner per truth** — no duplicate state authorities
3. **No silent failures** — every error surfaces
4. **One query key per entity** — React Query factory pattern, no hardcoded keys
5. **Server state stays server-side** — Zustand for client state only
6. **Logout clears everything** — no private data survives sign-out
7. **Label temporary code** — `[TRANSITIONAL]` comments with exit conditions
8. **Subtract before adding** — don't layer on broken code
9. **No fabricated data** — missing data is hidden, never faked
10. **Currency-aware** — user's locale everywhere
11. **One auth instance** — centralized session authority
12. **Validate at the right time** — user's datetime, not `new Date()`
13. **Exclusion consistency** — same rules in generation and serving
14. **Persisted-state startup** — `_hasHydrated` gate on Zustand-persisted reads

### 2.2 1.2-Specific Invariants

In addition to the constitution, Mingla Business 1.2 establishes:

- **I-1.2-UNIFIED-EVENT-TYPE:** every sellable thing is a row in `public.events` with `event_type` discriminator (`event` / `experience` / `trip`). No parallel offering tables.
- **I-1.2-BRAND-AS-CONTAINER:** `brands.kind` is starting identity, not capability gate. Any brand can author any offering type via the universal "+" creator.
- **I-1.2-AI-CONFIRMATION-AUTHORITY:** every AI-generated artifact (menu experiences, activities experiences, schedule experiences, trip itineraries) ships through the `agent_pending_actions` state machine with operator accept/edit/reject before publish. No auto-publish.
- **I-1.2-VENUE-CLAIM-VALIDATION:** physical venues are validated by admin phone callback to the Google-listed number. Trip planners are validated by Stripe Connect completion. Popup organizers inherit today's no-validation flow.
- **I-1.2-INSTALLMENT-LEDGER:** every installment-bearing order has a corresponding `order_installments` ledger row per installment. Refund engine reads the ledger; never recomputes from scratch.
- **I-1.2-DISCUSSION-RLS:** `event_threads` and `event_thread_messages` RLS scopes to confirmed buyers of the event (status `confirmed` or beyond on the order) plus brand members. No exceptions.

### 2.3 Hard Anti-Patterns (Automatic Reject at PR Review)

- Hardcoded React Query keys (use the factory)
- Direct Stripe API calls from mobile code (always edge function intermediary)
- New tables without RLS policies
- New columns referenced in mobile code without the migration file
- `console.log` in shipped paths (use the existing logger or remove)
- Inline styles using `oklch`, `lab`, `lch`, `color-mix` — only `hex` / `rgb` / `hsl` / `hwb` per `feedback_rn_color_formats.md`
- Zustand `partialize` including server-fetched records (only IDs + client-only state) per `feedback_zustand_persist_no_server_snapshots.md`
- `useAuth` calls inside anon-tolerant buyer routes per `feedback_anon_buyer_routes.md`
- `crypto.randomUUID()` in mingla-business app code (Hermes lacks `crypto`; use `mingla-business/src/utils/randomId.ts`)
- `.neq()` filters on nullable columns (silently filters NULLs) per `feedback_supabase_neq_null.md`
- Selecting `orders.brand_id` (does not exist; source brand transitively via `events.brand_id`) per DEC-145

---

## 3. Data Model Master Plan

This is the full schema delta from today's state to 1.2-complete. Each milestone's brief specifies which subset of these changes lands in that milestone; this section is the global reference.

### 3.1 Migrations to `public.brands`

```sql
-- Lands in M0 (foundation) and Ve1 (venue onboarding)
ALTER TABLE public.brands
  -- M0: extend kind enum to support trip planners
  DROP CONSTRAINT IF EXISTS brands_kind_check,
  ADD CONSTRAINT brands_kind_check CHECK (kind IN ('physical', 'popup', 'trip_planner')),

  -- Ve1: structured place data for physical venues
  ADD COLUMN place_pool_id uuid REFERENCES public.place_pool(id),
  ADD COLUMN google_place_id text,
  ADD COLUMN lat numeric(10, 7),
  ADD COLUMN lng numeric(10, 7),
  ADD COLUMN city text,
  ADD COLUMN country_code char(2),
  ADD COLUMN claim_status text NOT NULL DEFAULT 'unclaimed'
    CHECK (claim_status IN ('unclaimed', 'pending_review', 'verified', 'rejected')),
  ADD COLUMN verified_at timestamptz,
  ADD COLUMN verified_by uuid REFERENCES auth.users(id);

CREATE INDEX idx_brands_place_pool_id ON public.brands(place_pool_id) WHERE place_pool_id IS NOT NULL;
CREATE INDEX idx_brands_claim_status_verified ON public.brands(claim_status) WHERE claim_status = 'verified';
```

### 3.2 New table `public.brand_hours`

```sql
-- Lands in Ve1
CREATE TABLE public.brand_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6), -- 0=Sun
  open_time time, -- NULL = closed all day
  close_time time, -- NULL = closed all day
  is_24h boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, weekday)
);
ALTER TABLE public.brand_hours ENABLE ROW LEVEL SECURITY;
-- Read: anon for verified physical brands; auth for owner/members
-- Write: brand owners + members only
```

### 3.3 Migration to `public.events`

```sql
-- Lands in M0 (just discriminator + backfill)
ALTER TABLE public.events
  ADD COLUMN event_type text NOT NULL DEFAULT 'event'
    CHECK (event_type IN ('event', 'experience', 'trip'));

UPDATE public.events SET event_type = 'event' WHERE event_type IS NULL;
CREATE INDEX idx_events_event_type ON public.events(event_type);
```

### 3.4 Trip sidecar tables

```sql
-- Lands in Tr2 (foundation: trip_days, trip_pricing_tiers, trip_inclusions)
CREATE TABLE public.trip_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  ordinal smallint NOT NULL CHECK (ordinal > 0),
  title text NOT NULL,
  narrative text,
  date date,
  -- Optional: structured stops within a day
  stops jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, ordinal)
);

CREATE TABLE public.trip_pricing_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  ticket_type_id uuid NOT NULL REFERENCES public.ticket_types(id) ON DELETE CASCADE,
  tier_name text NOT NULL,
  tier_metadata jsonb NOT NULL DEFAULT '{}', -- single_occupancy, double, single_supplement, etc.
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.trip_inclusions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('included', 'excluded')),
  item text NOT NULL,
  ordinal smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Lands in Tr5 (intake forms)
ALTER TABLE public.events
  ADD COLUMN trip_intake_schema jsonb;
ALTER TABLE public.orders
  ADD COLUMN intake_form_data jsonb;

-- Lands in Tr7 (room-share)
ALTER TABLE public.orders
  ADD COLUMN room_share_preference jsonb;
CREATE TABLE public.trip_room_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  order_id_a uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  order_id_b uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  assigned_by uuid REFERENCES auth.users(id),
  UNIQUE (order_id_a),
  UNIQUE (order_id_b),
  CHECK (order_id_a < order_id_b) -- canonical ordering for dedup
);
```

### 3.5 Installments

```sql
-- Lands in Tr3
ALTER TABLE public.ticket_types
  ADD COLUMN installment_schedule jsonb;

CREATE TABLE public.order_installments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  ordinal smallint NOT NULL CHECK (ordinal > 0),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  currency char(3) NOT NULL,
  due_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'collected', 'failed', 'refunded', 'cancelled')),
  stripe_payment_intent_id text,
  collected_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  retry_count smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, ordinal)
);
```

### 3.6 Refund tiers

```sql
-- Lands in Tr4
ALTER TABLE public.events
  ADD COLUMN refund_policy jsonb, -- {tiers: [{before_days: 60, refund_pct: 100}, ...]}
  ADD COLUMN booking_deadline timestamptz;
```

### 3.7 Discussion board

```sql
-- Lands in Tr6
CREATE TABLE public.event_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  is_broadcast_only boolean NOT NULL DEFAULT false,
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id)
);

CREATE TABLE public.event_thread_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.event_threads(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id),
  body text NOT NULL,
  attachments jsonb NOT NULL DEFAULT '[]', -- {kind, storage_path, mime, size}
  posted_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz
);
CREATE INDEX idx_event_thread_messages_thread_posted ON public.event_thread_messages(thread_id, posted_at DESC);
```

### 3.8 Storage buckets

- `trip_documents` (Tr6) — RLS-scoped to confirmed buyers + brand members of the event
- Reuses existing `brand_avatars`, `brand_covers`, `event_covers`

### 3.9 Views

```sql
-- Lands in Ve4
CREATE OR REPLACE VIEW public.claimed_venues_public_view WITH (security_invoker=true) AS
SELECT id, account_id, name, slug, description, profile_photo_url, contact_email, contact_phone,
       social_links, custom_links, default_currency, address, city, country_code, lat, lng,
       cover_hue, cover_media_url, cover_media_type, created_at, updated_at
FROM public.brands
WHERE deleted_at IS NULL
  AND kind = 'physical'
  AND claim_status = 'verified';
```

### 3.10 Marketing audience extension

```sql
-- Lands in Tr8 or later (when needed)
ALTER TABLE public.marketing_audiences
  DROP CONSTRAINT marketing_audiences_query_kind_valid,
  ADD CONSTRAINT marketing_audiences_query_kind_valid CHECK (
    jsonb_typeof(query_definition) = 'object'
    AND (query_definition->>'kind') IN ('brand_buyers', 'event_buyers', 'brand_followers', 'custom_segment', 'trip_alumni')
  );
```

---

## 4. The Per-Milestone Pipeline (Full Forensics Loop)

Every milestone runs through the full 5-phase lifecycle. This is the rigor bar.

```
INVESTIGATE  →  SPEC  →  IMPLEMENT  →  TEST  →  CLOSE
   ↓             ↓          ↓           ↓        ↓
  audit       contract    code +     verdict   docs +
  report      report      report     report    commit +
                                                deploy
```

### 4.1 Phase 1 — INVESTIGATE (1-2 days)

**Owner:** Claude `mingla-forensics` (INVESTIGATE mode) when run by Seth. Taofeek runs his own equivalent investigation using his preferred tools.

**Trigger:** New milestone is starting. Operator dispatches via orchestrator.

**Input:** The milestone brief at `Mingla_Artifacts/milestones/<MILESTONE_ID>.md`.

**Output:** `Mingla_Artifacts/reports/INVESTIGATION_<ORCH_ID>_<MILESTONE_NAME>.md`

**Purpose:** Verify that today's codebase state matches the assumptions in the milestone brief. Surface contradictions, hidden flaws, blast-radius concerns. Identify which existing files will be touched, which patterns to follow, which to avoid.

**Mandatory ingest:**
- The milestone brief
- The companion working doc + this project spec
- `Mingla_Artifacts/MEMORY.md` references
- Relevant prior CLOSE notes for adjacent ORCHs
- Migration chain for any tables the milestone touches

**Done when:** investigation report written with 🔴🟠🟡🔵 findings, blast-radius map, and a clear "fix strategy" pointer at the upcoming SPEC.

### 4.2 Phase 2 — SPEC (1-2 days)

**Owner:** Claude `mingla-forensics` (SPEC mode). Taofeek uses the milestone brief directly as his spec.

**Input:** Investigation report + milestone brief.

**Output:** `Mingla_Artifacts/specs/SPEC_<ORCH_ID>_<MILESTONE_NAME>.md`

**Purpose:** Translate the milestone brief + investigation findings into a binding implementation contract. Every layer specified (DB, edge functions, services, hooks, components). Every success criterion testable. Every invariant named.

**Done when:** SPEC includes scope + non-goals + per-layer specification + numbered success criteria + named invariants + test matrix + implementation order + regression prevention.

### 4.3 Phase 3 — IMPLEMENT (1-2 weeks per milestone duration)

**Owner:** Codex `implementor-mingla` when run by Seth. Taofeek implements directly from the brief using his preferred tools (Cursor, Copilot, vanilla coding, etc.).

**Input:** SPEC (Seth) or milestone brief (Taofeek) + the codebase.

**Output:** Code changes on the `Seth` branch + `Mingla_Artifacts/reports/IMPLEMENTATION_<ORCH_ID>_<MILESTONE_NAME>.md`.

**Purpose:** Write the code. Do not redesign; the SPEC/brief is the contract. If the SPEC is wrong, return to forensics for amendment rather than going off-piste.

**Done when:** all SPEC success criteria are met, regression tests are written, implementation report cites file-by-file what changed.

### 4.4 Phase 4 — TEST (1-2 days)

**Owner:** Claude `mingla-forensics` (TEST mode). Taofeek runs the milestone's smoke + regression tests himself; Seth runs an independent QA pass on Taofeek's milestones once delivered.

**Input:** Implementation report + SPEC + milestone brief.

**Output:** `Mingla_Artifacts/reports/QA_<ORCH_ID>_<MILESTONE_NAME>.md` with verdict `PASS` / `CONDITIONAL PASS` / `FAIL`.

**Purpose:** Independent verification. Implementor claims are worthless until tested.

**Test coverage required per milestone:**
- All numbered SPEC success criteria mapped to test results
- The milestone's smoke test (per the brief) run end-to-end by a human
- Regression tests for adjacent functionality (constitutional sweep on touched flows)
- Cross-domain blast radius checked (other surfaces that consume the touched data)
- Security review (RLS, auth gates, input validation)
- Constitutional compliance (all 14 rules per §2.1)

**Done when:** verdict is `PASS` or `CONDITIONAL PASS` with operator-accepted carryovers.

### 4.5 Phase 5 — CLOSE (1 day)

**Owner:** Claude `mingla-orchestrator`. Taofeek's milestones get closed by Seth + the orchestrator.

**Input:** Investigation + SPEC + implementation + QA reports.

**Output:**
- Updated artifacts (WORLD_MAP, MASTER_BUG_LIST, COVERAGE_MAP, PRODUCT_SNAPSHOT, PRIORITY_BOARD, AGENT_HANDOFFS)
- `Mingla_Artifacts/CLOSE_NOTE_<ORCH_ID>.md`
- Commit on `Seth` branch (and merge to `main` via PR with pre-merge gate)
- EAS Update published to TestFlight (`eas update --branch production --platform ios` + `--platform android`)
- DECISION_LOG entries for any architectural decisions surfaced during the milestone
- Updates to the milestone brief if scope evolved during execution

**Done when:** all 7 canonical CLOSE artifacts updated, DIAG marker grep returns zero matches, commit + EAS OTA published, operator confirmation of next dispatch.

---

## 5. Artifact System

### 5.1 Directory map

```
Mingla_Artifacts/
├── PROJECT_SPEC_MINGLA_BUSINESS_1_2.md   ← this file (operating manual)
├── MINGLA_BUSINESS_1_2_WORKING_DOC.md    ← strategic overview + timeline
├── MINGLA_ENGINEERING_HANDBOOK.md        ← Taofeek's onboarding guide
├── milestones/
│   ├── M0_HUB_FOUNDATION.md
│   ├── Tr1_TRIP_PLANNER_ONBOARDING.md
│   ├── Tr2_MINIMUM_VIABLE_TRIP.md
│   ├── ... (16 more)
│   └── C2_MULTI_STOP_COMPOSER.md
├── reports/
│   ├── INVESTIGATION_ORCH-XXXX_<NAME>.md  ← Phase 1 output per milestone
│   ├── IMPLEMENTATION_ORCH-XXXX_<NAME>.md ← Phase 3 output
│   ├── QA_ORCH-XXXX_<NAME>.md             ← Phase 4 output
│   └── RESEARCH_ORCH-0825_WETRAVEL_*.md   ← competitive research
├── specs/
│   └── SPEC_ORCH-XXXX_<NAME>.md           ← Phase 2 output per milestone
├── prompts/
│   └── (per-phase agent dispatch prompts when applicable)
├── CLOSE_NOTE_ORCH-XXXX.md                ← Phase 5 output per milestone
├── WORLD_MAP.md                           ← canonical issue registry
├── MASTER_BUG_LIST.md                     ← every tracked issue
├── PRIORITY_BOARD.md                      ← ranked top items
├── DECISION_LOG.md                        ← architectural decisions
├── INVARIANT_REGISTRY.md                  ← rules that must hold
├── COVERAGE_MAP.md                        ← what's audited, what's stale
├── AGENT_HANDOFFS.md                      ← active + completed dispatches
└── PRODUCT_SNAPSHOT.md                    ← PM-facing engineering truth
```

### 5.2 Naming conventions

- ORCH-IDs are sequential (`ORCH-0825`, `ORCH-0826`, …). Each milestone gets one ORCH-ID at INVESTIGATE phase.
- Milestone briefs use their milestone code (`M0`, `Tr1`, `Ve1`, `C1`) as a prefix.
- Investigation / SPEC / Implementation / QA reports for a milestone all share its ORCH-ID.
- CLOSE notes are one per milestone.

### 5.3 Working tree + branch

- **Always:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
- No worktrees per milestone. No long-running feature branches.
- All scoped artifacts (investigation/spec/implementation/QA/close-note for a milestone) live in the same `Seth` branch alongside product code.
- Promotion to `main` happens via GitHub PR with the pre-merge gate (§7).

### 5.4 Versioning of milestone briefs

Milestone briefs are living documents. If scope shifts mid-execution (rare, but real), the orchestrator:
1. Edits the brief in place with a `> **Revision <date>:**` note at the top
2. Logs the change in `DECISION_LOG.md`
3. Notifies the engineer working the milestone

Briefs are never "frozen" at SPEC time — they're the canonical contract throughout the milestone.

---

## 6. Close Protocol (Mandatory Checklist)

Triggered when QA returns `PASS` or `CONDITIONAL PASS`. Every step must complete before announcing the next milestone dispatch.

### Step 1 — Update all artifacts (mandatory)

| Document | What to update |
|----------|---------------|
| `WORLD_MAP.md` | Milestone status → closed, grade A, verified date, evidence link |
| `MASTER_BUG_LIST.md` | Move milestone to "Recently Closed," update header totals |
| `COVERAGE_MAP.md` | Recalculate surface grade distribution |
| `PRODUCT_SNAPSHOT.md` | Update grade counts, launch blockers, "What's Strong/Fragile" |
| `PRIORITY_BOARD.md` | Remove closed milestone, renumber, update next recommended action |
| `AGENT_HANDOFFS.md` | Move dispatches to Completed |
| Per-milestone brief | Add "Closed <date>" header note + link to CLOSE_NOTE |

### Step 1.5 — DIAG marker reap (mandatory)

```bash
grep -rn "\[ORCH-${CLOSING_ORCH_ID}-DIAG\]" \
  mingla-business/src/ mingla-business/app/ \
  app-mobile/src/ supabase/functions/ \
  mingla-admin/src/ 2>/dev/null
```

Required outcome: **zero matches**. If matches exist, either remove in the close commit or register as cleanup follow-up ORCH with operator approval.

### Step 2 — Commit message

Format (always pass via HEREDOC):

```bash
git commit -m "$(cat <<'EOF'
Close ORCH-XXXX (Milestone <code>): <one-line summary>

Plain-English what changed:
- <bullet>
- <bullet>

QA verdict: PASS | CONDITIONAL PASS (carryovers: <list or "none">)
Migration: <name or "none">
Edge functions deployed: <list or "none">
EOF
)"
```

No `Co-Authored-By:` lines per memory `feedback_no_coauthored_by.md`.

### Step 3 — Edge function deploys (orchestrator-owned)

If the milestone touched edge functions:
```bash
supabase functions deploy <name> --project-ref gqnoajqerqhnvulmnyvv
```

Verify version bumps via `mcp__supabase__list_edge_functions`. Preserve each function's `verify_jwt` setting.

Operator runs `supabase db push --linked` for migrations BEFORE orchestrator deploys edge functions.

### Step 4 — EAS OTA (mobile changes only)

```bash
cd mingla-business && eas update --branch production --platform ios --message "ORCH-XXXX: <summary>"
cd mingla-business && eas update --branch production --platform android --message "ORCH-XXXX: <summary>"
```

Two separate commands. `--platform ios,android` is invalid; `--platform all` fails on web bundle per `feedback_eas_update_no_web.md`.

If consumer-app (`app-mobile/`) changes too, run from that directory separately.

### Step 5 — Pre-merge gate to main (when promoting)

When the milestone is ready to merge `Seth` → `main`:

1. All required GitHub checks GREEN — `gh pr checks <PR#> --watch`
2. `gh pr view <PR#> --json mergeable,mergeStateStatus` → `MERGEABLE` + `CLEAN`
3. Required reviews satisfied
4. Branch not BEHIND main
5. Explicit operator confirmation in chat "checks green + conflicts clean — proceeding to merge"

If any condition fails, fix root cause first. Do not merge despite a failure. Per memory `feedback_pr_merge_pregate.md`.

### Step 6 — Decision log entries

For each architectural decision surfaced during the milestone (not every milestone produces one), add a DEC-XXX entry to `DECISION_LOG.md`. Each entry: date, decision, rationale, evidence (file paths), enforcement (CI gate / invariant / strict-grep).

### Step 7 — Next dispatch

State the next available milestone from the priority queue. If multiple tracks have ready milestones, surface them all and let the operator pick.

---

## 7. Risk Register (Project-Level)

Risks specific to the 1.2 project. Per-milestone risks live in each milestone brief.

| # | Risk | Severity | Likelihood | Mitigation |
|---|------|---------:|-----------:|------------|
| 1 | Stripe Subscription Schedule integration is more complex than expected, blocking Tr3 | S1 | M | Build a thin abstraction layer; consider scheduled PaymentIntents fallback |
| 2 | Gemini parser hallucinates unrealistic experiences (especially edge-case menus) | S1 | M | Operator review-and-confirm is the safety net; never auto-publish |
| 3 | `place_pool` schema changes during 1.2 break `claim-search-pool` edge function | S2 | L | `place_pool` post-ORCH-0700/0734 is stable; coordinate with consumer-app work |
| 4 | Discussion board RLS gap allows cross-trip read | S0 | L | Mandatory RLS test in Tr6 QA: attempt cross-trip read, must fail |
| 5 | Installment failures stack up without operator awareness | S1 | M | Dunning email + "at-risk" status flag + operator-dashboard alert |
| 6 | Refund cascading math has off-by-one on tier boundaries | S1 | M | Test matrix in Tr4 QA includes exact boundary cases |
| 7 | AI parser output schemas drift from operator review UI | S2 | M | Single source-of-truth schema file; UI imports the same types |
| 8 | Consumer-side multi-stop composer surfaces empty when no venue experiences exist | S2 | M | Empty-state UX; revert to existing card stream when no compositions available |
| 9 | Hub tab restructure breaks deep-links from existing users | S1 | M | Maintain `/events` → `/hub/events` redirect indefinitely |
| 10 | Solo engineer (one of Seth/Taofeek) drops out mid-project | S1 | L | Fluid ownership absorbs; timeline reverts to ~22w sequential, no redesign |
| 11 | Off-pool venue signups get abused by imposters | S2 | M | Admin Google-Maps lookup before calling; soft check on operator-provided phone |
| 12 | Stripe Connect KYC stall blocks trip planner from publishing | S2 | M | Detect stall via existing `stripe-kyc-stall-reminder` (ORCH-0785); surface in onboarding UI |

---

## 8. Decision Log References

Architectural decisions inherited from the 1.2 brainstorm. Full text lives in `DECISION_LOG.md` once formalized. Decision IDs assigned at META-ORCH-0825 registration.

1. **Unified data model** — all sellable offerings via `events.event_type` discriminator; no parallel trips/experiences tables.
2. **Brand-as-flexible-container** — `brands.kind` is starting identity, never capability gate.
3. **AI confirmation authority** — no auto-publish of AI artifacts; operator accept/edit/reject required.
4. **Trip planner Stripe Connect = identity proof** — no admin phone callback for trip-planner kind.
5. **Physical venue phone callback validation** — 4-hour SLA, business-hours-aware.
6. **Three category pills for physical venues** — Restaurant / Play / Creative & Arts copied from consumer prefs sheet.
7. **Three AI parsers** — menu (Restaurant) / activities (Play) / schedule (Creative & Arts), all Gemini structured output.
8. **Trip itinerary AI parser** — fourth Gemini parser, brochure-to-day-by-day.
9. **Hub tab replaces Events tab** with sub-navigation for Events / Experiences / Trips.
10. **Top-bar "+" universal creator** with three options.
11. **Discussion board = multi-party Ari pattern** — `event_threads` + `event_thread_messages` tables, scoped to confirmed buyers + brand members.
12. **Multi-stop curated experiences are Mingla-composed**, not operator-authored. No partner-invite UI.
13. **Trips in consumer Discover via dedicated Trips tab**, separate from main feed.
14. **Full WeTravel parity from day 1** — installments + intake + chat + documents + room-share + refund tiers — sub-phased across Tr3-Tr7 for safety.
15. **Small-group focus** — 8-30 typical, hard cap 100. Not enterprise.
16. **Popup events excluded as a track** — today's flow is sufficient for 1.2.
17. **Three parallel tracks model** — M0 shared foundation, then Tr + Ve concurrent, then C joins mid-cycle when dependencies land.
18. **Fluid milestone ownership** — both engineers float across milestones based on weekly capacity, no personal track lock.
19. **Every milestone is full-pipeline** — INVESTIGATE → SPEC → IMPLEMENT → TEST → CLOSE.
20. **TestFlight per milestone** — no long-running feature branches; EAS OTA at end of every milestone.

---

## 9. Quick Reference — Where Do I Go?

| I want to … | Read |
|---|---|
| Understand the overall project | `MINGLA_BUSINESS_1_2_WORKING_DOC.md` |
| Understand how the project executes | this file |
| Onboard as a developer | `MINGLA_ENGINEERING_HANDBOOK.md` |
| Pick up a milestone | `Mingla_Artifacts/milestones/<MILESTONE_ID>.md` |
| Find the canonical issue list | `WORLD_MAP.md` |
| See architectural decisions | `DECISION_LOG.md` |
| See rules that must always hold | `INVARIANT_REGISTRY.md` |
| See what's currently in flight | `AGENT_HANDOFFS.md` + `PRIORITY_BOARD.md` |
| Look up an existing CLOSE | `CLOSE_NOTE_ORCH-XXXX.md` |
| Look up the audit that started 1.2 | `reports/INVESTIGATION_ORCH-0825_BUSINESS_APP_VENUE_CLAIM_INTEGRATION_AUDIT.md` |

---

## 10. Conventions

### 10.1 Markdown

VS-Code-rendering-safe CommonMark only. No emoji-only headings. Tables use `|` separators. Code blocks fenced with triple backticks + language hint.

### 10.2 Code references

Inline file references use markdown link syntax with relative paths:
- File: `[brandsService.ts](mingla-business/src/services/brandsService.ts)`
- Line: `[brandsService.ts:108](mingla-business/src/services/brandsService.ts#L108)`
- Range: `[brandsService.ts:108-151](mingla-business/src/services/brandsService.ts#L108-L151)`

### 10.3 Date format

ISO-8601 absolute dates throughout: `2026-05-13`. Never "Thursday" or "next week" in artifacts; convert at write time per `feedback_universal_skill_output_format.md`.

### 10.4 Severity levels

- **P0 — CRITICAL:** crash, data loss, security breach, store rejection, constitutional violation. Blocks release.
- **P1 — HIGH:** feature broken, data incorrect, UX misleading. Must fix before production.
- **P2 — MEDIUM:** pattern deviation, missing edge case. Fix this sprint.
- **P3 — LOW:** style, minor inconsistency.
- **P4 — NOTE:** observation, praise for good work.

---

*End of project spec. Update header timestamp on revision.*
