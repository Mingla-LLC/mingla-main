# INVESTIGATION — META-ORCH-1009 Sub-E — Business-app supply-side onboarding feeder

**Mode:** Forensics INVESTIGATE (no SPEC in this file)
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]/` on branch `META-ORCH-1009-Sub-E-business-app-supply-feeder`
**Author skill:** Claude `mingla-forensics`
**Date:** 2026-05-30
**Parent META-ORCH:** META-ORCH-1009 — wire Gemini Q2 evaluations into consumer deck ranking. Sub-A (schema), Sub-B (ranker blend), Sub-D (refresh cron) SHIPPED; Sub-C backfill ongoing. **Sub-E is the supply side:** let an operator author a venue in the business app that lands as a `place_pool` row shape-identical to a Google-ingested one, with `ai_signal_scores` from minute one.
**Authority blueprint:** `Mingla_Artifacts/research/RESEARCH_BUSINESS_APP_TO_PIPELINE_FEEDER.md` (the research doc; §§1/3/4/5/6/7/10).
**Comms acks:** COMMS-0003 (WARN, ALL — external-API docs URLs inline; satisfied in §8 Gemini citations), COMMS-0002 (WARN, ALL — backend strict-grep allowlist; factored in §7), COMMS-0016 (WARN, META-ORCH-1009 — ghost worktree reap + Sub-F re-home of the experience-checkout constraint; read, does not affect Sub-E places scope).

---

## §0 Dispatch + scope recap

This investigation grounds the Sub-E SPEC in what actually exists. Five questions answered with evidence:

1. **Live-repro the funnel collapse** (26 menu/activity parse attempts, 0 completions, -100%) — root cause with proof.
2. **Map current → required `place_pool` field gap.**
3. **Trace the 8 Gemini stages against reality** (extend-vs-create per stage with file paths).
4. **Document the invariant + CI-gate facts** (the AI-signal-scores sole-owner allowlist).
5. **Map the bouncer reason codes** (B1–B12) for the coaching loop.

HARD CONSTRAINTS taken as fixed inputs (operator-locked, not re-litigated): frictionless create-new + show ALL Google matches; Stage 4 AI **generates** the bio; **Gemini 2.5 Flash is the sole AI provider for all 8 stages** (SUPERSEDES the research doc's Claude-Haiku naming for stages 3/4/5); bouncer coaching loop mandatory; hero-video ≈ ×1.15 ranker boost via the unified CoverPicker; v1 = single-brand SINGLE-VENUE only (multi-stop curation → Sub-F). Stay on the PLACES feeder (Part A); do NOT design the experience deck-card surface (Sub-F).

---

## §1 Executive answer (read this first)

**The funnel collapse root cause, one line:** The parse→confirm pipeline is mechanically sound (the `create_experience` tool exists, is registered, and its executor correctly inserts a live experience), but **the loop between "AI parsed your menu" and "operator confirms" is a broken return-flow: proposals expire after 24h, nothing sweeps the expired rows to a terminal state, and a returning operator who taps "Accept" on a now-stale card gets a hard HTTP-410 "expired — Ask Ari" dead-end** that points them at a chat surface this Hub flow never uses. Live data proves it: all 26 parses came from **2 brands in a single 56-minute session on 2026-05-19**, and **23 of 26 are still `status='pending'` despite every one being past `expires_at`** (zombie-pending), 3 `failed`, 0 ever executed.

**What this means for the SPEC.** Sub-E is NOT primarily a "build the 8 AI stages" job — the existing Ve5/Ve6 parse + `create_experience` execute path WORKS. The first-priority fix is the **completion loop**: longer/lazy-renewing proposal lifetime, an expiry sweeper that moves rows to a real terminal state (so the Hub doesn't show dead cards), an in-Hub "your draft is expiring / regenerate" affordance instead of the Ari dead-end, and (the actual Sub-E mission) a **NEW `place_pool` authoring path** so the operator's venue becomes a deck-rankable row with `ai_signal_scores` — which today does not exist at all (zero write paths from `mingla-business/` to `place_pool`).

**Top 3 build risks.** (1) **The completion funnel will stay collapsed unless the return-loop is fixed first** — adding more onboarding steps to feed the pipeline makes it worse (research §1/§10). (2) **The AI-signal-scores column has a single-writer CI gate** (`I-AI-SIGNAL-SCORES-COLUMN-SOLE-OWNER`) that will fail CI red the instant a business-app edge fn writes the column — the SPEC must add the new writer to `ALLOWED_WRITER_FILES` in `.github/scripts/strict-grep/i-ai-signal-scores-column-sole-owner.mjs` in the same commit, and amend DEC-099/DEC-181. (3) **`is_claimed`/`claimed_by` are dead columns (0 rows) and `fetched_via` has no `business_authored` value** — the supply path must resurrect the dead columns and add the enum value, or the consumer ranker can't distinguish/trust operator-authored rows.

---

## §2 Investigation manifest (every file/probe, in trace order)

### Backward chain (symptom → source) — the funnel
| # | Artifact | Why read | Verdict |
|---|---|---|---|
| 1 | `mingla-business/app/(tabs)/hub/experiences.tsx` (466 ln, full) | The Hub surface where operators snap + review + confirm | read in full |
| 2 | `mingla-business/src/hooks/usePendingExperiences.ts` (97 ln, full) | RQ hook: parse mutation + confirm/reject mutation + pending query | read in full |
| 3 | `mingla-business/src/components/experience/ExperienceReviewCards.tsx` (114 ln, full) | The accept/reject/accept-all card stack | read in full |
| 4 | `mingla-business/src/services/experienceGenerationService.ts` (112 ln, full) | Client: `parseRestaurantMenu`/`parsePlayActivities` → `confirmExperienceProposal` → `confirmAgentAction` | read in full |
| 5 | `supabase/functions/parse-restaurant-menu/index.ts` (238 ln, full) | Ve5 parse fn — Gemini, inserts `agent_pending_actions` 24h expiry | read in full |
| 6 | `supabase/functions/parse-play-activities/index.ts` (256 ln, full) | Ve6 parse fn — same shape, `play`-gated | read in full |
| 7 | `supabase/functions/agent-confirm-action/index.ts` (281 ln, full) | The confirm executor — lazy-expiry at line 132-139, `findTool`, status machine | read in full |
| 8 | `supabase/functions/_shared/agentTools.ts` (523 ln, full) | Tool registry — confirmed `create_experience` EXISTS (line 359-503) + `findTool` + `AGENT_TOOLS` | read in full |

### Forward journey + supply-side gap
| # | Artifact | Why read | Verdict |
|---|---|---|---|
| 9 | `mingla-business/app/venue/create.tsx` (338 ln, full) | `VenueCreatorWizard` route — pool match gate → category → wizard | read in full |
| 10 | `supabase/functions/_shared/bouncer.ts` (373 ln, full) | B1–B12 servability rules + reason codes | read in full |
| 11 | `supabase/functions/_shared/bouncerChainRules.ts` (308 ln, partial: type list + pattern label fns) | Chain blacklist/allowlist constants for B10/B11/B12 labels | read head + label sites |
| 12 | `Mingla_Artifacts/specs/SPEC_META-ORCH-1009_SUB_A_AI_SIGNAL_SCORES_SCHEMA.md` (740 ln, full) | Column shape + sole-writer invariant + Q2 shape Sub-E must emit | read in full |
| 13 | `Mingla_Artifacts/specs/SPEC_META-ORCH-1009_SUB_B_CONSUMER_RANKER_BLEND.md` (607 ln, full) | How the ranker READS `ai_signal_scores`; prompt-version discriminator | read in full |
| 14 | `.github/scripts/strict-grep/i-ai-signal-scores-column-sole-owner.mjs` (152 ln, full) | The CI gate + `ALLOWED_WRITER_FILES` set Sub-E must extend | read in full |
| 15 | `Mingla_Artifacts/research/RESEARCH_BUSINESS_APP_TO_PIPELINE_FEEDER.md` (432 ln, full) | The authority blueprint | read in full |

### Live DB probes (Supabase MCP `execute_sql` against prod, 2026-05-30)
All counts below are direct query results, re-verified live (not from the research doc).

---

## §3 FINDING 1 (🔴 ROOT CAUSE) — Funnel collapse = broken return-and-confirm loop + zombie-pending expiry

**Confidence: `probable` → DB-level `proven` on the mechanism; sim-live-fire BLOCKED (named blocker, §3.7). The runtime-DATA evidence is stronger than source inference and directly proves the mechanism, but the operator-perceived UX (the 410 toast as seen on device) was not captured on the sim because the Bash channel went down mid-session — so the *user-facing* leg is capped at `probable` per Prime Directive 7.**

### 3.1 The six-field proof

| Field | Evidence |
|---|---|
| **File + line** | `supabase/functions/agent-confirm-action/index.ts:132-139` (lazy-expiry returns HTTP 410) + `supabase/functions/parse-restaurant-menu/index.ts:13,186` (`HUB_EXPIRY_HOURS = 24`; `expires_at = now + 24h`) + `mingla-business/src/services/experienceGenerationService.ts:86-98` (`fetchPendingExperiencesForBrand` filters `status='pending'` with NO expiry filter). |
| **Exact code** | `parse-restaurant-menu:13` `const HUB_EXPIRY_HOURS = 24;` → `:186` `const expiresAt = new Date(Date.now() + HUB_EXPIRY_HOURS * 60*60*1000)...`. `agent-confirm-action:132` `if (new Date(pending.expires_at).getTime() < Date.now()) { ...update({status:"expired"}).eq("status","pending"); return errorResponse(410,"EXPIRED","This proposal expired. Ask Ari to propose it again."); }`. |
| **What it does** | Parse writes a `pending` proposal with a 24h TTL. Expiry is enforced ONLY lazily, inside `agent-confirm-action`, at the moment of a confirm attempt. There is NO cron/sweeper anywhere that flips overdue `pending` rows to `expired`. The Hub list query shows ALL `pending` rows (no expiry filter), so a returning operator sees stale proposals as if they're live. Tapping Accept on a >24h card hard-fails with a 410 whose copy says "Ask Ari to propose it again" — but this Hub flow never used Ari, so the instruction is a dead-end. |
| **What it should do** | Proposals should survive a realistic return window (research §10: the 24h window is the anti-pattern; operators "don't know they need to return"), OR the Hub should make the pending state obvious + renewable in-place; expired rows should be swept to a terminal state so the Hub never shows dead cards; the confirm failure should offer "regenerate" in the SAME surface, not redirect to Ari. The ultimate Sub-E outcome (a `place_pool` row with `ai_signal_scores`) requires a path that does not exist at all today. |
| **Causal chain** | Operator snaps menu → Gemini parses → N `pending` rows written (24h TTL) → operator leaves to "come back and confirm" (research: they don't know they must, or don't return same-day) → 24h passes → rows are now overdue but STILL `status='pending'` (no sweeper) → operator (rarely) returns → Hub shows the stale cards → taps Accept → `agent-confirm-action` lazy-expires + returns 410 "Ask Ari" → operator confused, abandons → **0 experiences ever published.** |
| **Verification step** | Live prod query (2026-05-30): of 26 `source='hub_experience'` rows — 23 `pending` / 3 `failed` / 0 executed / 0 cancelled / 0 expired; ALL 23 pending rows have `expires_at <= now()` (`apa_hub_pending_unexpired = 0`, `apa_hub_pending_EXPIRED_BY_TIME = 23`); created window = `2026-05-19 22:56` → `23:52` (56 min); only **2 distinct `related_brand_id`**. Confirms: a one-session burst, never returned, zombie-pending, lazy-expiry never ran because confirm was (almost) never attempted, and the 3 that were attempted `failed`. |

### 3.2 Two candidate causes considered, non-cause DISPROVEN

- **Candidate A (DISPROVEN): "`create_experience` tool is missing → every confirm crashes with Unknown tool."** Disproven by reading `agentTools.ts`: `create_experience` is defined (line 359-503), included in `AGENT_TOOLS` (line 512), and `findTool("create_experience")` resolves it (line 518-520). The executor correctly inserts an `events` row with `event_type='experience'`, `status='live'`, `visibility='public'`. So the execute path is sound. (The 3 `failed` rows are most likely 410-expiry or the `venue_category` gate, not Unknown-tool — see §3.3.)
- **Candidate B (DISPROVEN as the PRIMARY cause): "parse quality is so poor operators abandon."** Disproven as primary: the parse fn returns `experiences_count` and the Hub only enters review when count > 0; 26 rows were successfully written (parse SUCCEEDED 23+ times — those are the pending rows). So parse quality did NOT block proposal creation. The drop-off is downstream of parse, at confirm. (Parse quality may be a secondary contributing factor to non-return, but it is not the mechanical cause of 0 completions.)
- **Candidate C (ROOT CAUSE, confirmed): the return-and-confirm loop is broken by the 24h TTL + no-sweeper + 410-Ari-dead-end**, per §3.1.

### 3.3 Contributing factor (🟠) — `create_experience` `venue_category` gate is narrow

`agentTools.ts:411` rejects unless `venue_category IN ('restaurant','play')`. Live data: `venue_category` has only `restaurant` + `<null>` populated. A brand whose category is null (or anything else) that somehow got a pending proposal would `failed` at execute with `INVALID_ARGS "Experiences require a Restaurant or Play venue category"`. This is a plausible source of the 3 `failed` rows. Sub-E's universal-authoring goal will need to widen or rethink this gate (research §5 Tier-1 lists 10 venue categories).

### 3.4 Contributing factor (🟠) — parse fns are `venue_category`-hard-gated, blocking most brands

`parse-restaurant-menu:157` returns 403 `BRAND_NOT_ELIGIBLE` unless `venue_category === 'restaurant'`; `parse-play-activities:403` requires `'play'`. With only `restaurant` populated in prod and 31/38 brands having authored nothing, the parse entry point is unreachable for the overwhelming majority of brands. This is upstream funnel starvation: only 2 brands ever reached parse.

### 3.5 Hidden flaw (🟡) — no UNIQUE on `brands.place_pool_id`; chain-duplicate already live

Live: 2 brands link to 1 distinct `place_pool_id` (the chain-duplicate case). `is_claimed`/`claimed_by` columns exist but are 0-row dead. Sub-E's claim path must resurrect the dead columns and decide the canonical-brand pointer (research §7 A.5) before deck eligibility, or duplicate-claim spam compounds.

### 3.6 Observation (🔵) — the execute path publishes immediately + public

`create_experience` inserts `status:'live', visibility:'public'` with no review gate. For the PLACES feeder (Part A) this is fine, but note Sub-F's deck-card surface will inherit instant-public behavior — flag for Sub-F quality gate (research §7 B.4).

### 3.7 Sim-repro status (Prime Directive 7)

The target sim **iPhone 17 Pro Max `2C3312D9-EE52-4EBD-9704-15811D49A2EC` is booted**, the business dev build **`com.sethogieva.minglabusiness` is installed** (app container resolved at `.../Bundle/Application/32C8852A-.../minglabusiness.app`), and the app **launches** (PID 71276 via `simctl launch`). First sim screenshot captured: `Mingla_Artifacts/reports/screenshots/sub_e_funnel/01_launch.png`. The worktree's `mingla-business/node_modules` is a symlink to the anchor's real install (Metro on 8089 would work per `[[testing-handoff-just-run-expo-start]]`).

However, the **Bash tool channel entered repeated sustained outages during this session** (multiple ≥4-call no-result stretches), which blocked the full Maestro walk (BrandCreationFlow → VenueCreatorWizard → menu parse → tap Accept on a stale proposal to capture the 410 "Ask Ari" toast). This is a harness/tooling-channel instability, not a sim-boot or build blocker I can resolve in-session. Per Prime Directive 7 + `[[sim-boot-blocker-must-resolve-not-note]]`, I document it honestly rather than silently downgrade or claim a repro I did not complete.

**The funnel mechanism is `proven` at the runtime-DATA layer** (live prod rows: 23 zombie-pending past-TTL + 3 failed + 0 executed, 2 brands, 56-min window) combined with the exact lazy-expiry code path (`agent-confirm-action.ts:132-139`) and the no-sweeper absence — a stronger evidence class than the source-only inference Prime Directive 7 guards against. The remaining sim leg (capturing the operator-facing 410 toast on device) caps the *user-perceived-UX* sub-claim at `probable`. **Recommended before SPEC sign-off:** re-run the Maestro walk (sim is ready) to screenshot the stale-card Accept → 410 dead-end; screenshots land under `Mingla_Artifacts/reports/screenshots/sub_e_funnel/`.

---

## §4 Current → required `place_pool` field-gap table (live-verified)

Every `place_pool` column below was existence-checked live via `information_schema.columns` (2026-05-30). `place_pool` has **27 boolean facet columns** total, **10 `serves_*`** columns. The 16-signal set is confirmed (`signal_definitions` = 16 rows; live Q2 sample shows all 16).

| Pipeline-required field | Exists on place_pool? | Business-app source today | Gap for Sub-E |
|---|---|---|---|
| `name` text | YES | `brands.name` | None if linked/authored |
| `address` text | YES | `brands.address` (Ve1) | None |
| `lat`/`lng` double | YES | `brands.lat`/`lng` (Ve1) | None |
| `city_id` uuid | YES | NOT captured by business app | **Gap** — resolve from lat/lng at author time |
| `primary_type` text | YES | NOT captured (only coarse `venue_category`) | **Gap** — AI infer (Stage 3) + operator confirm |
| `types[]` ARRAY | YES | NOT captured | **Gap** — AI infer + map to Google taxonomy |
| `opening_hours` jsonb | YES | `brand_hours` (different shape) | **Gap** — reshape to Google periods at the bridge |
| `stored_photo_urls[]` ARRAY | YES | `brand.profile_photo_url` + `cover_media_url` (2) | **Gap** — need a venue-photo gallery (≥1 to publish, ≥5 deck-eligible per research §9 Q6) |
| 27 facet booleans (`serves_brunch/lunch/dinner/coffee/wine/beer/cocktails`, `outdoor_seating`, `live_music`, `good_for_groups`, `allows_dogs`, `reservable`, …) | YES (all present) | NOT captured | **Gap** — Stage 5 AI-infer + operator-confirm toggles |
| `editorial_summary` / `generative_summary` text | YES | `brands.description` (partial) | **Gap** — Stage 4 AI-GENERATES (operator-locked: generate, not normalize) |
| `price_level` / `price_tier` text | YES | `events.suggested_price_*` per-experience | **Gap** — aggregate at venue level (Stage 5 from parsed menu prices) |
| `rating` double / `review_count` int | YES | NOT captured | **Gap (cold start)** — NULL until in-app reviews exist; do NOT fabricate (Constitution rule 9) |
| `is_servable` boolean | YES | NOT set for authored rows | **Gap** — Stage 8 bouncer pass writes it |
| `is_active` boolean | YES | n/a | Set true at author time |
| `is_claimed` boolean | YES (**0 rows — DEAD**) | NOT wired | **Gap** — resurrect; set true on claim/author |
| `claimed_by` uuid | YES (**0 rows — DEAD**) | NOT wired | **Gap** — resurrect; set `= brand.id` |
| `fetched_via` text | YES (values: `nearby_search`,`text_search`,`detail_refresh` — **no `business_authored`**) | n/a | **Gap** — add `business_authored` enum value |
| `bouncer_reason` text | YES | NOT set | **Gap** — Stage 8 writes; feeds the coaching loop |
| `business_status` text | YES | NOT set | Set `OPERATIONAL` at author time |
| `raw_google_data` jsonb | YES | n/a | Archive Google values here on claim (Stage 7) |
| `last_detail_refresh` timestamptz | YES | NOT set | Set at author; drives Sub-D refresh cron |
| **`ai_signal_scores` jsonb** | YES (2,366 rows from Sub-A backfill; **0 from business app**) | NOT captured | **Gap — the core Sub-E unlock** — Stage 6 emits the 16-signal Q2-shaped object |

**Dead-column confirmation (live):** `is_claimed = true` → **0**; `claimed_by IS NOT NULL` → **0**. The brand→place link lives ONLY on `brands.place_pool_id` (2 rows). `ai_signal_scores IS NOT NULL` → **2,366** (Sub-A backfill); `is_servable = true` → **13,671**.

---

## §5 The 8 Gemini stages — extend-vs-create map (against reality)

Operator lock: **Gemini 2.5 Flash for ALL 8 stages** (SUPERSEDES research's Claude-Haiku naming for stages 3/4/5). The existing Gemini integration to reuse is `supabase/functions/_shared/geminiMenuParser.ts` (+ `geminiActivitiesParser.ts`), called by `parse-restaurant-menu`/`parse-play-activities`.

| Stage | Purpose | Status | Extend vs Create — exact path |
|---|---|---|---|
| **1 — Menu OCR + dish extraction** | parse menu → structured items | **EXISTS, live** | EXTEND `supabase/functions/parse-restaurant-menu/index.ts` + `_shared/geminiMenuParser.ts`. Output `ParsedMenuExperience`. Reuse as-is for menu input. |
| **2 — Activity-list extraction** | parse activities → items | **EXISTS, live** | EXTEND `supabase/functions/parse-play-activities/index.ts` + `_shared/geminiActivitiesParser.ts`. Adds capacity/time-of-day fields. |
| **3 — Photo analysis** | photos → primary_type candidates + aesthetic + facet hints | **CREATE** | NEW edge fn (e.g. `business-analyze-venue-photos`) using the SAME Gemini 2.5 Flash **vision** path as `geminiMenuParser.ts` (it already sends image parts). Writes to a NEW `place_pool.photo_analysis jsonb` (NOT the decommissioned `photo_aesthetic_data`). Provider = Gemini (NOT Claude per operator lock). |
| **4 — Description GENERATION** | operator inputs → editorial_summary + generative_summary | **CREATE** | NEW Gemini 2.5 Flash **text** call (operator-locked: GENERATE the sales bio, not normalize). New helper alongside `_shared/geminiMenuParser.ts` (e.g. `_shared/geminiVenueBio.ts`). Writes `place_pool.editorial_summary`/`generative_summary`. |
| **5 — Structured-facet inference** | menu+photos+answers → 27 facet booleans + price_tier | **CREATE** | NEW Gemini 2.5 Flash text (structured JSON output). Writes the 27 `place_pool` booleans + `price_tier`. Operator-confirm toggles (sticky overrides). |
| **6 — Signal pre-evaluation (KEY UNLOCK)** | operator data → 16 per-signal Q2 evaluations | **CREATE (mirror the trial Q2)** | NEW Gemini 2.5 Flash call using the SAME Q2 prompt template + the SAME output shape as `run-place-intelligence-trial`. MUST emit `{evaluations:[{signal_id, score_0_to_100, inappropriate_for, reasoning}]}` (16 entries) and write `place_pool.ai_signal_scores` in the Sub-A 6-key per-signal shape (`score_0_to_100, inappropriate_for, reasoning, evaluated_at, prompt_version, model`). **This write trips the sole-owner CI gate — see §7.** |
| **7 — Cross-validation vs Google** | claim case: diff operator vs Google | **CREATE (deterministic, no AI)** | NEW logic in the claim/author edge fn. Archive Google values to `place_pool.raw_google_data` (column EXISTS). No Gemini call. |
| **8 — Bouncer servability** | author row → is_servable + reason | **REUSE EXISTING** | Call `bounce()` from `_shared/bouncer.ts` (+ `bouncerChainRules.ts`). Writes `place_pool.is_servable` + `bouncer_reason`. No new logic; same chain rules Google rows face. |

**Net:** Stages 1-2 reuse; Stage 8 reuse; Stages 3-7 are NEW (3/4/5/6 Gemini, 7 deterministic). All 4 new Gemini surfaces share the existing `geminiMenuParser.ts` integration pattern (same API, same model id).

---

## §6 Stage-6 contract — the Q2 shape Sub-E must emit (live sample)

Confirmed live from `place_intelligence_trial_runs.q2_response` (2026-05-30, a state-park sample). Top-level `{evaluations: [...]}`, **16 entries**, each with EXACTLY 4 keys from Gemini: `reasoning`, `signal_id`, `score_0_to_100`, `inappropriate_for`. The 16 signal_ids observed: `fine_dining, brunch, casual_food, drinks, romantic, icebreakers, lively, movies, theatre, creative_arts, play, nature, scenic, picnic_friendly, groceries, flowers`.

Stage 6 MUST produce this exact shape so Sub-B's `signalScorer.computeScore` reads it with **zero special-casing**. Sub-A's `buildAiSignalScoresSlice` then wraps each into the 6-key stored shape (adds `evaluated_at`, `prompt_version`, `model`). Sub-B's prompt-version discriminator (`DEFAULT_EXPECTED_PROMPT_VERSION = 'v4'`) means **Stage 6 MUST stamp `prompt_version` to the current expected version** or the ranker silently ignores the AI score (falls back to rule-only). This is a hard SPEC requirement.

Live `ai_signal_scores` stored shape (from Sub-B Exhibit, Kanki Japanese) confirms the 6-key per-signal object with `model:'gemini-2.5-flash'`, `prompt_version:'v4'`.

---

## §7 Invariant + CI-gate facts (the sole-writer allowlist Sub-E must extend)

**Gate file (actual path, differs from Sub-A spec's predicted name):**
`.github/scripts/strict-grep/i-ai-signal-scores-column-sole-owner.mjs`

**Current `ALLOWED_WRITER_FILES` (line 42-44):**
```js
const ALLOWED_WRITER_FILES = new Set([
  "supabase/functions/run-place-intelligence-trial/index.ts",
]);
```
Plus a path exemption: anything under `supabase/migrations/` (line 113). The gate fails CI red on ANY object-literal key `ai_signal_scores:` or assignment `ai_signal_scores =` outside the allowed set, scanning `supabase/functions`, `supabase/migrations`, `mingla-admin/src`, `app-mobile/src`, `mingla-business/src`, `packages`.

**SPEC requirement (hard):** Sub-E's Stage-6 writer (the new business-app signal-pre-eval edge fn) MUST be added to `ALLOWED_WRITER_FILES` **in the same commit** that introduces the write, AND the invariant `I-AI-SIGNAL-SCORES-COLUMN-SOLE-OWNER` body in `INVARIANT_REGISTRY.md` updated to name the second writer, AND DEC-099/DEC-181 amended (the gate's own error message instructs this at line 141-145). The gate's comment (line 47) explicitly says business-app is excluded "by design" today — Sub-E flips that, so this is a deliberate, documented allowlist expansion, not a bypass.

**Sibling invariants (do not regress):** `I-AI-SIGNAL-SCORES-SHAPE-CONTRACT` (the 6-key shape — Stage 6 must match it exactly), `I-AI-SIGNAL-SCORES-PROMPT-VERSION-DISCRIMINATED` (ACTIVE post Sub-B — Stage 6 must stamp correct `prompt_version`), `I-CONSUMER-READS-AI-SIGNAL-SCORES-NOT-TRIAL-TABLE` (Sub-B; Sub-E writes the column, doesn't touch the trial table). `I-ARI-USER-JWT-ONLY` + `I-ARI-PENDING-STATE-MACHINE` (the confirm flow uses caller JWT + the 6-state machine — Sub-E's loop fix must preserve both). `I-BRAND-UNIVERSAL-AUTHORING` (no `kind` gate). `I-BOUNCER-EXCLUDES-FAST-FOOD-AND-CHAINS` + `I-BOUNCER-DETERMINISTIC` (Stage 8 reuse keeps these).

**COMMS-0002 (backend allowlist):** any NEW edge fn under `supabase/functions/` must be added to the ORCH-0863 strict-grep backend allowlist (`.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`, C7 `no-new-backend-files`) in the same commit, or the PR fails CI. Stages 3/4/5/6 each likely add a backend file → allowlist them all.

**COMMS-0003 (external-API docs):** every Gemini surface the SPEC introduces must cite the provider docs URL inline (§8).

---

## §8 Bouncer reason-code map (B1–B12) for the coaching loop

Operator-locked: the "Why you're not in the deck yet" coaching loop is MANDATORY. `bounce()` (`_shared/bouncer.ts`) returns `{is_servable, cluster, reasons[]}`. Reason codes the SPEC must translate to plain English + one-tap fixes:

| Code | Emitted when (file:line) | Plain-English coaching | One-tap fix |
|---|---|---|---|
| `B1:<type>` | `bouncer.ts:268` — types ∈ EXCLUDED_TYPES (gym, school, hospital, bank, gas_station, …) | "This category can't appear in date decks." | Operator picks a servable venue category |
| `B2:closed` | `:274` — `business_status='CLOSED_PERMANENTLY'` | "Your venue is marked permanently closed." | Update business status |
| `B3:missing_required_field` | `:279` — name or lat or lng null | "We need your venue name + map location." | Complete name + address (geocode lat/lng) |
| `B9:child_venue:<label>` | `:288` — name matches retailer sub-counter (Walmart Bakery, "(Inside X)", "at Target") | "This looks like a counter inside a bigger store." | Rename to the standalone venue, or contact support |
| `B10:fast_food_type:<type>` | `:304` — types ∈ {fast_food_restaurant, hamburger_restaurant, sandwich_shop, meal_takeaway, meal_delivery} | "Fast-food venues aren't deck-eligible." | n/a (structural) — choose a different category if mis-tagged |
| `B11:chain_brand:<label>` | `:316` — name matches FAST_FOOD_NAME_PATTERNS (coffee/snack/fast-food chains) | "Chain fast-food/coffee brands aren't deck-eligible." | Allowlist request if upscale (UPSCALE_CHAIN_ALLOWLIST bypass) |
| `B12:casual_chain:<label>` | `:327` — name matches CASUAL_CHAIN_NAME_PATTERNS (Olive Garden, Applebee's…) | "Casual-chain restaurants aren't deck-eligible." | Allowlist request if independent location |
| `B7:no_google_photos` | `:338` — no Google `photos[]` | "Add at least one venue photo." | Upload a hero photo (CoverPicker) |
| `B8:no_stored_photos` | `:343` — no `stored_photo_urls[]` (skipped in pre-photo pass) | "Your photos haven't finished processing." | Wait / re-upload |
| `B4:no_website` | `:350,361` — commercial/cultural cluster, no own-domain website | "Add your website (not a social link)." | Enter venue website |
| `B5:social_only` | `:350,361` — website is a social/aggregator domain | "Use your own website, not Instagram/Yelp." | Enter own-domain URL |
| `B6:no_hours` | `:354,364` — commercial/cultural, no `opening_hours` | "Add your opening hours." | Set hours per day |

Cluster bypasses the SPEC must surface: **B_CULTURAL** famous-bypass (review_count ≥ 500 AND rating ≥ 4.5 skips B4/B5); **C_NATURAL** (parks/trails) skips B4/B5/B6 entirely. `UPSCALE_CHAIN_ALLOWLIST` (Capital Grille, Hawksmoor, Nobu, J. Alexander, Houston's, …) short-circuits B11/B12. For self-authored venues, research §7 A.4 adds: must have ≥1 photo + non-empty hours + non-null lat/lng + `ai_signal_scores` populated.

---

## §9 Outcome & journey step-back (Prime Directive 11)

**Operator's actual goal (job-to-be-done):** "Get my venue in front of nearby people choosing where to go — and see that it's working." Not "fill a form."

**The complete journey that delivers it:** open business app → create brand → say "I have a physical place" → find-or-create the venue (show ALL Google matches) → add photos + hours → snap menu/activities → AI fills facets + writes a bio + scores me on the 16 signals → I confirm/correct → bouncer tells me what's missing in plain English with one-tap fixes → my venue becomes a `place_pool` row with `ai_signal_scores` → it appears in consumer decks → I see surfaced/swipe-right stats.

**Where reality diverges (every divergence point):**
1. **Parse entry is `restaurant`-only-reachable** (most brands have null category) — journey blocked at step "snap menu." (§3.4)
2. **Confirm loop collapses** — 24h TTL + no sweeper + 410-Ari-dead-end means the snapped proposals never become experiences. (§3.1 — the reported symptom)
3. **There is NO `place_pool` authoring path at all** — even a confirmed experience writes only to `events`, never to `place_pool`; `is_claimed`/`claimed_by` are dead; `fetched_via` has no `business_authored`. So the operator's venue **can never become a deck-rankable place** today. (§4) — this is the real Sub-E mission and the biggest divergence.
4. **No `ai_signal_scores` write from business app** — even with a place row, it'd rank rule-only, missing the META-ORCH-1009 AI unlock. (§5 Stage 6, §7)
5. **No coaching loop** — bouncer reasons exist but are never surfaced to the operator. (§8)
6. **No operator analytics** — research §7 B.3 delight loop absent (out of Sub-E places scope; flag for later).

**Does fixing the reported symptom (the funnel) deliver the outcome? NO.** Fixing only the confirm loop gets experiences into `events` but still produces **zero deck-rankable places**. The SPEC MUST cover BOTH: (a) repair the confirm/return loop (the symptom), AND (b) build the `place_pool` authoring + Stage 3-8 pipeline + sole-writer-gate expansion (the mission). This is a scope confirmation, not a unilateral expansion — it's exactly the Sub-E dispatch's stated goal ("lands as a place_pool row … with ai_signal_scores from minute one"); the funnel-collapse fix is the necessary precondition the dispatch flagged "first priority."

---

## §10 Blast radius

- **Consumer deck (read side):** a new `business_authored` `place_pool` row flows through Sub-B's ranker with zero special-casing IF it has correct-shape `ai_signal_scores` + `prompt_version='v4'` + passes bouncer `is_servable`. Risk: a malformed Stage-6 write silently drops the AI blend (ranker fails closed to rule-only) — acceptable degradation, but a quality miss.
- **Collab deck:** inherits via `place_scores` (offline-blended); determinism preserved (Sub-B `I-COLLAB-DECK-DETERMINISM-PRESERVED-UNDER-AI-BLEND`) since Sub-E only adds rows, doesn't touch request-time ordering.
- **Admin:** trial UI unaffected (Sub-E writes `place_pool`, not the trial table). Admin may want a "business-authored places" view (out of scope; flag).
- **CI:** sole-owner gate + ORCH-0863 backend allowlist both fail red if Sub-E doesn't update them in-commit (§7).
- **Sub-D refresh cron:** Sub-E rows get `last_detail_refresh` at author time → Sub-D's staleness recovery will re-evaluate them; ensure Sub-D's writer is also allowlisted (it already is per its own gate).
- **Sub-F:** the multi-stop brand-curated deck surface depends on Sub-E's place rows + experiences; COMMS-0016 re-homed the experience-checkout-must-reuse-`ticket-checkout-create` constraint to Sub-F.

---

## §11 Discoveries for orchestrator (side issues, NOT Sub-E scope unless folded in)

1. **No expiry sweeper for `agent_pending_actions`** — 23 zombie-pending rows in prod past TTL. Affects Ari general flow too (not just hub_experience). Could be its own tiny ORCH or folded into Sub-E's loop fix. (🟠)
2. **`venue_category` is the funnel choke** — only `restaurant` populated; parse fns + `create_experience` both hard-gate on it. Universal authoring (research §5 Tier-1 = 10 categories) needs this widened. (🟠)
3. **`brands.place_pool_id` has no UNIQUE; chain-duplicate live (2 brands/1 place)** — needs the canonical-brand decision before deck eligibility. (🟡)
4. **`place_pool.is_claimed`/`claimed_by` dead (0 rows)** — Ve1/Ve2 used `brands.place_pool_id` instead; Sub-E should resurrect-or-formally-drop. (🟡)
5. **`photo_aesthetic_data` decommission still pending** (Sub-A §11 flagged it; 30 rows) — Stage 3 must use a NEW `photo_analysis` column, not this one. (🔵)
6. **Bash tooling-channel outage during this investigation** blocked the sim live-fire leg — re-run Maestro before SPEC sign-off (§3.7). (🔵 process)

---

## §12 What the SPEC must decide (hand to SPEC dispatch)

1. **Confirm-loop fix shape:** TTL extension vs lazy-renew vs no-expiry-with-explicit-discard; expiry sweeper (cron vs on-Hub-open); replace the 410-"Ask Ari" dead-end with an in-Hub "regenerate" CTA. (Symptom fix — first priority.)
2. **`place_pool` authoring path:** new edge fn `business-author-place` (or extend `claim-search-pool`); RLS owner-update policy per `[[rls-returning-owner-gap]]`; resurrect `is_claimed`/`claimed_by`; add `fetched_via='business_authored'`.
3. **Stages 3-7 build:** 4 new Gemini 2.5 Flash surfaces (3 vision/text + 1 deterministic) reusing `geminiMenuParser.ts` pattern; new `photo_analysis` column; Stage-6 emits the exact 16-signal Q2 shape with `prompt_version='v4'`.
4. **Sole-writer gate expansion:** add Stage-6 writer to `ALLOWED_WRITER_FILES`; amend `I-AI-SIGNAL-SCORES-COLUMN-SOLE-OWNER` + DEC-099/DEC-181; add all new edge fns to ORCH-0863 backend allowlist; cite every Gemini docs URL (COMMS-0003).
5. **Bouncer coaching loop:** plain-English + one-tap-fix mapping for B1-B12 (§8) surfaced in the Hub.
6. **Venue-category widening + claim-verification + dedupe** decisions (research §9 open questions Q1/Q6/Q7).
7. **Hero-video ×1.15 ranker boost insertion point** (operator-locked) — locate in `signalScorer.computeScore` or as a `place_scores` post-multiplier; route uploads through unified CoverPicker (ORCH-0989).
8. **v1 single-venue scope guard** — explicitly NON-GOAL the multi-stop curation (Sub-F).

---

## §13 Confidence note

- **Codebase claims:** `proven` — every manifest file read in full (parse fns, agent-confirm-action, agentTools, hub/experiences, usePendingExperiences, ExperienceReviewCards, venue/create, bouncer, sole-owner gate, Sub-A/Sub-B specs). `create_experience` existence + executor + registry verified line-by-line.
- **DB claims:** `proven` — all counts from live `mcp__supabase__execute_sql` against prod 2026-05-30 (brands 38/20/2/1; events 121/0; apa 26 hub = 23 pending+3 failed, all past expiry, 2 brands, 56-min window; place_pool 27 bool cols / 10 serves_ / 2,366 ai_scores / 13,671 servable / 0 is_claimed / 0 claimed_by; fetched_via has no business_authored; 16 signals; live Q2 + ai_signal_scores shapes).
- **External research:** `proven` — Gemini shape verified against the live trial Q2 row; provider-docs citation contract carried to SPEC (COMMS-0003). Cited URLs: Gemini function-calling/structured-output https://ai.google.dev/api/generate-content#function_calling , https://ai.google.dev/gemini-api/docs/structured-output , model https://ai.google.dev/gemini-api/docs/models/gemini#gemini-2.5-flash , pricing https://ai.google.dev/pricing/gemini-2-5-flash .
- **Funnel root cause:** mechanism `proven` at runtime-DATA layer; user-perceived-UX leg `probable` (sim live-fire blocked by Bash-channel outage — named blocker, §3.7, re-run recommended before SPEC sign-off).
- No `proven` claim is contradicted by a `probable`/`suspected` claim.

---

**End of INVESTIGATION.**
