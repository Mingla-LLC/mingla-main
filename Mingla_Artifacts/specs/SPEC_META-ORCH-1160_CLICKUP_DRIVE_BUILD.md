# SPEC — META-ORCH-1160 · ClickUp + Google Drive build (for Codex)

**Phase:** IMPLEMENT · **Owner:** Codex (`implementor-mingla`) · **Orchestrator:** mingla-orchestrator (specs/reviews; does not build by hand).
**Goal:** stand up the Mingla Growth ClickUp workspace AND the Google Drive structure exactly as designed, via API,
idempotently. Codex builds; orchestrator specs/designs/instructs and reviews the result.

## Sources of truth (read these first — do NOT re-derive)
- `Mingla_Roadmap/living/GROWTH_TEAM_CLICKUP_SYSTEM.md` — the full structure: 1 Space · 7 Folders · **16 Lists** · **9 Docs** · 4 Goals · 1 Dashboard · 10 global fields (Channel = 22 extensible options) · §9B additions · §7 automation-worker model.
- `Mingla_Roadmap/living/GROWTH_90DAY_ACQUISITION_PLAN.md` — the GTM motion (Supply CRM reframe, Creator Onboarding, City Launches, Product Growth Requests, AI Playbooks, Drive needs).
- `Mingla_Roadmap/living/GROWTH_OS.md` — north-star/targets that seed Goals.

## Verified API constraints (Seth tested the token, 2026-06-18 — DESIGN AROUND THESE)
1. **CAN via API:** read user/workspace/spaces; create/update/delete Spaces, Folders, Lists, Tasks, Comments, **Webhooks**; create Custom Fields; set custom-field values on tasks.
2. **CANNOT via API:** fully control native **Automations**. Free Forever caps them at **5 active / 100 actions/mo**.
   → **Build ZERO native automations.** All automation logic lives in the external **Automation Worker** (separate spec);
   this build only **registers the webhooks** it will consume.
3. **Statuses must match each list's exact configured strings** when creating/moving tasks. Define statuses at list-creation; reference them verbatim.
4. **Custom-field deletion by API is unreliable** (only cleaned by deleting the parent list). → **Get the field schema right the FIRST time; never iterate fields in place.** If a field is wrong, delete+recreate the list.

## Hard guards
- **Idempotent.** Before creating anything, list existing Spaces/Folders/Lists by name; skip-or-update, never duplicate.
- **Never delete or mutate ClickUp content the build doesn't own** (other spaces/workspaces untouched).
- **No secrets in the repo.** Read the ClickUp token + Drive creds from the environment / `~/Desktop/Key Details For Mingla/MINGLA_MASTER_KEYS.md`; never write values into code or the manifest.
- **Persist every created ID** to `Mingla_Artifacts/clickup/BUILD_MANIFEST.json` (space, folders, lists, field ids, view ids, webhook ids) so re-runs and the worker are deterministic. This file is the contract between this build and the worker.

## Build order (each step idempotent; record IDs as you go)
1. **Auth + context** — verify token; GET the team/workspace id; confirm write scope.
2. **Space** — create `Mingla Growth` (skip if exists).
3. **Custom fields (the 10 global)** — create the field set per `GROWTH_TEAM_CLICKUP_SYSTEM.md §2` (Role, Funnel Stage, Channel [22 options], Geo [Raleigh·Cary·Durham·DC·New York·Lagos], Hypothesis [relationship], Spend $, Outcome #, Proof, Feedback, Feedback Status). If the API can't share a field across lists, replicate the identical definition on each task list. **Dropdown options must match the doc exactly.**
4. **Folders (7)** — 00 Command · 01 Sprint Board · 02 Supply Pipeline · 03 Demand & Outreach · 04 Content Engine · 05 Ops · 06 Feedback & Re-direct.
5. **Lists — LEAN v1 = 10 lists** (Seth-confirmed 2026-06-18). Create each with its **exact statuses + fields** per the doc (§2, §3, §9B):
   1. **Sprint Board** · 2. **Supply CRM** (ex-Venue CRM, +`Lead Type`) · 3. **Creator Onboarding** · 4. **Experiments** · 5. **Influencer CRM** · 6. **Activity Log** (merge of Cold Outreach + Channel Activity; `Activity Type` field splits cold-outreach vs social/community) · 7. **Content Production** · 8. **Product Growth Requests** · 9. **Standups** · 10. **Spend Ledger** (the one place ads + influencer spend are logged).
   - **Spend Ledger schema** — one row = one spend entry. Statuses: `Planned → Committed → Paid`. Fields: `Type` (Ads / Influencer), `Channel` (the 22-option global field), `Amount $`, `Period/Date`, `Linked To` (relationship → an Experiment card for ads, or an Influencer card for influencers), `Promo Code`, `Owner`, `Notes`. Views: **By Channel** (sum), **By Type** (Ads vs Influencer), **This Month**, **Planned vs Paid**, **Daily Ad Spend** (Calendar/table by date). CPL/CAC = Spend-Ledger totals ÷ outcomes (computed in the dashboard/worker later). Influencer card's own `Deal Terms/$` mirrors its ledger entry for context; the **ledger is the source of truth** for totals.
   - **Ad-spend cadence + cap (Seth-confirmed 2026-06-18):** ads are logged **DAILY** — one ledger row per active ad campaign per day. **Budget cap = $5/day per active ad campaign/channel** (this is also the typical platform minimum; interpret as per-campaign, not a single global $5 — flag to Seth if he meant one total $5/day pool). Each active ad campaign gets a `Planned` $5 row per day; the **Planned vs Paid** view makes any overspend immediately visible. (When the warehouse lands at Stage 5, ad-platform APIs auto-fill these daily rows.)
   - **As saved VIEWS, not their own lists:** `City Launches` (Supply CRM filtered by Geo, one view per market), `Activity Rollup` (Activity Log grouped by person), `Asset Library` (Content Production "Published" filter).
   - **DEFERRED (do NOT build now):** Planning & Decisions (→ a Decision Log Doc instead), Automation Health. Add when automating actually starts.
6. **Docs (9)** — create the ClickUp Docs as stubs with their section headings: GROWTH_OS mirror · Channel Playbooks (22 sections) · Sales Script + Venue Onboarding SOP · Messaging Baseline · Brand Voice + Asset Guidelines · Link-Builder & UTM Standard · Weekly Sprint Notes · "How the System Works" onboarding · **Mingla Growth AI Playbooks** (seed the reusable prompts from the 90-day plan §8).
7. **Goals (4)** — create 6-mo / 3-mo / 1-mo / Weekly with numeric targets from `GROWTH_OS.md §1` + the 90-day scorecard. (If Goals API is limited on the plan, create as a pinned Doc + note it.)
8. **Webhooks** — register `taskCreated`, `taskUpdated`, `taskStatusUpdated`, `taskCommentPosted` on the Space, pointing at the Automation Worker endpoint (placeholder URL in the manifest; worker spec wires the handler). **Do NOT build native automations.**
9. **Seed examples** — 1–2 sample tasks per key list (Supply CRM, Creator Onboarding, Experiments) using the task templates from the 90-day plan, so the team sees the shape. Mark them `[SAMPLE]`.

## Google Drive structure (Codex builds in parallel)
Top level `Mingla Growth/`:
- `Brand Assets/` (← ingest Seth's existing Drive folder: logos, guidelines, fonts, color)
- `City Launches/` → `Lagos/ · Raleigh/ · Cary/ · Durham/ · DC/ · New York/`
- `Creator Onboarding/` → one subfolder per creator, each: `Event Assets/ · Copy/ · Design/ · Videos/ · Published Links/ · Results/` (provide a generator script/template)
- `Campaigns/` (per-campaign assets)
- `Reports/` (weekly war-room + case studies)
Wire each `Creator Onboarding/<creator>/` to be linkable from that creator's Creator-Onboarding ClickUp task.

## Out of scope (follow-on specs — do NOT build here)
- The **Automation Worker** logic (the §7 rules + the 30-min loop) → separate spec; this build only registers webhooks + emits the manifest it consumes.
- The **analytics warehouse** (RudderStack/BigQuery/Metabase) + web instrumentation → META-ORCH-1160 Sub-A/B (deferred).

## Report back (what Codex returns to the orchestrator)
- `BUILD_MANIFEST.json` (all created IDs) committed under `Mingla_Artifacts/clickup/`.
- A short report: what was created vs skipped-because-existing, any API limit hit (esp. Goals/fields on the current plan), the Drive folder root link, and the webhook endpoint placeholder to be filled by the worker spec. Flag anything the plan tier blocked so the orchestrator can decide on the $7 Unlimited upgrade.
