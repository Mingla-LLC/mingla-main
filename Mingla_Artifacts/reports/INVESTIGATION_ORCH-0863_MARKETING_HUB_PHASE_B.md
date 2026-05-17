# INVESTIGATION — ORCH-0863 [Marketing Hub Phase B — Overview + Audiences + Templates tabs]

**Date:** 2026-05-17
**Author:** Claude `mingla-forensics` (INVESTIGATE+SPEC dispatch from `mingla-orchestrator`)
**Status:** COMPLETE — feeds `Mingla_Artifacts/specs/SPEC_ORCH-0863_MARKETING_HUB_PHASE_B.md`
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Mode:** INVESTIGATE (no fix proposed here — SPEC sibling carries the fix contract)
**Confidence:** HIGH on infrastructure proof (live DB probe + full code read of every Phase-A and Phase-B file). MEDIUM on Overview-tab design specifics until designer pass.

---

## 1. Layman summary of the report

- The Marketing tab today has 4 pills (Overview / Audiences / Campaigns / Templates). Only **Campaigns is fully built** — the other three are honest "coming soon" placeholders.
- The infrastructure for all three missing tabs **already exists** server-side: 5 starter-pack email templates are seeded in the DB, the buyer-resolver functions work, the `marketing_messages`/`marketing_clicks` tables have real production data from 10 sent campaigns. **The missing work is purely UI + thin read-only hooks on top of what's already in the DB.**
- Recommendation: **one parent SPEC** covering all three tabs (rationale §5 below). Implementation is ~1 medium dispatch — no new DB tables, no new edge functions, no new migrations.
- The Twilio toll-free / Phase B-SMS work is **NOT** in this ORCH (separately gated). Phase 0 consent foundation is still bypassed in current code; this ORCH inherits that bypass and flags it for operator awareness.

---

## 2. Investigation Manifest

Files read in trace order (every file under `mingla-business/src/components/marketing/`, `hooks/marketing/`, `services/marketing/`, `app/(tabs)/marketing/`, and the two Phase-A/B migrations + the marketing-send edge function — full ingestion, no skim):

| Layer | Files |
|---|---|
| Spec / strategy | `specs/SPEC_ORCH-0815_MARKETING_HUB_UI_PHASE_A.md` (§5 tab-by-tab + §10 SC), `MINGLA_BUSINESS_MARKETING_HUB_STRATEGY.md` (§3.1–3.9, §6 phasing), `MARKETING_HUB_INFRASTRUCTURE_GAP_ANALYSIS.md` (§1–§8) |
| QA prior | `reports/QA_ORCH-0815_A2_COMBINED_REPORT.md` |
| Migrations (Phase A schema + cron) | `supabase/migrations/20260602000003_orch_0815_marketing_hub_phase_a.sql`, `20260603000000_orch_0815_b_marketing_send_cron.sql` |
| Edge fn | `supabase/functions/marketing-send/index.ts` |
| Existing placeholders | `mingla-business/app/(tabs)/marketing/index.tsx` (Overview), `audiences/index.tsx`, `templates/index.tsx` |
| Existing Campaigns reference | `campaigns/index.tsx`, `campaigns/[id].tsx`, `campaigns/compose.tsx` (~750 LOC composer) |
| Sub-nav | `src/components/marketing/MarketingSubNav.tsx` |
| Hooks dir (existing) | `useCampaigns`, `useCampaignReport`, `useBrandCustomers`, `useEventBuyers`, `useResolveAudience`, `useScheduleCampaign`, `useSendNow`, `useComposerDraft`, `parseAudienceParam`, `marketingKeys` |
| Services dir (existing) | `marketingAudienceService`, `marketingCampaignService`, `marketingTemplateService` (read-only `listStarterTemplates` + `getTemplate`), `marketingRenderingService`, `marketingReportService` |
| Components dir (existing) | 18 components incl. CampaignCard, CampaignFilterPills, ChannelTabs, Composer steps |
| Types | `src/types/marketing.ts` (full discriminated-union types for the 6 marketing tables) |
| Live DB | 4 separate Supabase Management API probes (see §3) |

---

## 3. Live DB Probe — Production State (Supabase MCP, project `gqnoajqerqhnvulmnyvv`, 2026-05-17)

| Table | Count | Notes |
|---|---:|---|
| `marketing_templates` (starter-pack) | **5** | All `is_starter_pack=true`, `account_id IS NULL`, `brand_id IS NULL`, `channel='email'`. IDs `00000815-0001-0000-0000-00000000000{1..5}`. Schema fully populated. |
| `marketing_templates` (user-created) | **0** | No user has authored a template yet (no UI exists). |
| `marketing_audiences` | **4** | All `is_system_generated=true`, all under one brand (`22a18413-bfbf-4087-9ba7-45f70deba0f3`), one account. 3 `event_buyers` rows + 1 `brand_buyers` row. Lazy-created by `ensureBrandBuyersAudience` / `ensureEventBuyersAudience` at composer pre-fill. |
| `marketing_campaigns` | **11** | 10 `sent`, 1 `draft`, 0 `scheduled`, 0 `failed`, 0 `sending`. |
| `marketing_messages` | **50** | 35 `sent`, 14 `preview_skipped`, 0 `failed`, 0 `unsubscribed`, 0 `bounced`. Earliest test campaign (`Testing marketing`) was 7 `preview_skipped` (LIVE flag was off then); subsequent 10 campaigns went out for real (LIVE flag flipped mid-testing). |
| `marketing_clicks` | **64** | 1 has `clicked_at` populated (recorded click). 63 are pre-generated tracking rows waiting on first click. |
| `marketing_unsubscribes` | **0** | Nobody has unsubscribed yet. |

**Implication:** the dataset is small enough that live aggregation queries on `marketing_messages` per page-load will be ~milliseconds for the Overview tab. No matview needed at this scale.

---

## 4. Truth-layer reconciliation — three tabs

### 4.1 Overview tab
| Layer | Current state |
|---|---|
| Docs | SPEC §5.1: Revenue hero + 4 funnel cards + 3 recent campaigns + FAB. Phase-A spec marked this "Phase A" but operator-shipped deferred to "ORCH-0815-B foundation" (placeholder lives at `app/(tabs)/marketing/index.tsx`). |
| Schema | `marketing_messages.status` enum has every value Overview needs (`sent`, `delivered`, `opened`, `clicked`, `bounced`, `failed`, `unsubscribed`, `preview_skipped`). Click data joinable via `marketing_clicks.message_id`. |
| Code | Placeholder route renders Icon + "Phase A foundation" body + "What's coming" list. No data fetch. |
| Runtime | N/A — placeholder only. |
| Data | Real data exists (50 messages, 11 campaigns, 64 clicks) — Overview can render meaningful counts immediately. |

**No layer disagreement.** Gap is execution.

### 4.2 Audiences tab
| Layer | Current state |
|---|---|
| Docs | SPEC §5.2: list of system audiences "All buyers — {Brand}" + per-event audiences with reach + reachable counts. |
| Schema | `marketing_audiences` table with `query_definition jsonb` discriminated union (`brand_buyers` / `event_buyers` / `brand_followers` / `custom_segment`). RLS gates SELECT by `account_id = auth.uid()` OR brand member. |
| Code | Placeholder + `resolveBrandBuyers` / `resolveEventBuyers` resolvers exist + lazy-creation via `ensureBrandBuyersAudience` / `ensureEventBuyersAudience` is wired in composer (`compose.tsx:147-182`). |
| Runtime | Composer creates audience rows lazily on first pre-fill. No standalone listing UI today. |
| Data | 4 system-generated rows in prod, all under one brand. |

**Contradiction:** spec implies audiences are auto-created server-side when a brand has ≥1 paid order or an event has ≥1 paid order; current implementation creates them **only when the composer is opened with a pre-filled audience param**. So the Audiences tab today would list 4 rows for this operator — not "every brand × every paid event." See §6 for the fix decision.

### 4.3 Templates tab
| Layer | Current state |
|---|---|
| Docs | SPEC §5.9: 5 starter-pack rows + user templates + duplicate + edit + "Use this template" → composer pre-fill. |
| Schema | `marketing_templates` table with strict authorship CHECK (starter-pack: `account_id IS NULL`, user: `account_id IS NOT NULL`). RLS: SELECT for all-can-read (starter + own + brand member); INSERT/UPDATE/DELETE only on `is_starter_pack = false AND account_id = auth.uid()`. |
| Code | `marketingTemplateService.ts` has `listStarterTemplates()` + `getTemplate(id)` (READ-only — no `createTemplate`/`updateTemplate`/`deleteTemplate`). Composer does NOT read `?template=id` query param yet (the `useLocalSearchParams` schema only includes `audience` and `draft`). |
| Runtime | Templates are inert in DB; nothing reads them. |
| Data | 5 starter rows present, 0 user rows. |

**Contradictions:**
1. SPEC promises "Use this template" CTA → composer pre-fill via `?template=id` — composer code does NOT parse this param today.
2. SPEC §5.9 mentions starter "Templates" can be **duplicated** but the RLS UPDATE policy explicitly blocks any write to starter rows. The correct implementation is **clone-on-duplicate**: copy fields into a new INSERT with `is_starter_pack=false, account_id=auth.uid()`.
3. The starter-pack body templates use **two distinct interpolation grammars** in the same string — single-brace `{first_name}` (rendered server-side by `substituteString` in marketing-send) AND double-brace `{{event:{event_id}}}` (event-card token). Phase B Templates UI must preserve both verbatim or the dispatcher silently breaks event-card embedding.

---

## 5. Overview-tab data sourcing — recommendation

Three options were evaluated:

| Option | Pros | Cons |
|---|---|---|
| **A. Live aggregation** (SELECT count(*), GROUP BY status WHERE campaign_id IN (...) FROM marketing_messages each page-load) | Zero new infra. Always fresh. At current scale (50 messages, 11 campaigns) each query is sub-10ms. | Scales linearly with message volume. At 1M messages this would need optimization. |
| B. Materialized view refreshed on cron | Fast reads at any scale. | New migration + cron + cache-staleness UX ("Updated 14 min ago"). Premature for current scale. |
| C. Cached counters maintained by marketing-send writes | Eventually-consistent, zero query cost. | Bookkeeping logic in two places (cron and edge fn). Drift risk. |

**RECOMMENDED: Option A (live aggregation).** Rationale:
- Current scale is 50 messages total; at 100x growth (5000 messages) Option A is still sub-100ms.
- Mirrors the precedent set by `marketingReportService.getCampaignReport` (also live aggregation, also bounded by per-campaign LIMIT 500).
- Use a single hook `useMarketingOverview(accountId, brandId)` that runs ONE service call returning all three rollups (last-30-day funnel + 3 most-recent campaigns + revenue placeholder).
- If/when scale warrants Option B, the migration is additive — Overview hook can pivot to the matview without changing component code. **The Phase B implementation must NOT bake the data-source choice into the component layer** (`MetricCard` should consume a typed `OverviewSnapshot` object, not raw SQL rows).

**Revenue hero — honest stance.** Per SPEC §5.1 the hero shows "$ revenue from blasts." Today there is NO order-to-campaign attribution wired (UTM persistence into `orders.utm_campaign_id` is Phase F per gap-analysis §6). Phase B Overview MUST either:
- (a) Hide the revenue hero entirely and ship without it (replace with a "campaigns sent" headline), OR
- (b) Show the hero with a "Revenue attribution coming with ads in Phase F" honest caption (Constitution #9 — no fabricated data).

RECOMMENDED: option (a) — hide revenue hero. Ship the funnel + recent-campaigns list. Revenue is a separate ORCH gated on UTM persistence. The hero placeholder lies less if it isn't there at all.

---

## 6. Audiences-tab unified-list contract

### 6.1 What the tab should list

Two row kinds, server-derived, no new schema:

1. **"All buyers — {Brand Name}"** — one row per brand the operator manages with ≥1 paid/partial_refund order. Sourced from `marketing_audiences` WHERE `query_definition->>'kind' = 'brand_buyers' AND account_id = auth.uid()`.
2. **"{Event Name} buyers"** — one row per event under those brands with ≥1 paid/partial_refund order. Sourced from `marketing_audiences` WHERE `query_definition->>'kind' = 'event_buyers' AND account_id = auth.uid()`.

### 6.2 Lazy-create vs eager-create

**Current code only creates audience rows when the composer is opened with `?audience={kind}:{id}`.** That means if a brand has 10 events but the operator has only blasted 2 of them, only 2 `event_buyers` rows exist. The Audiences tab would under-list.

**Recommended fix in this Phase B SPEC:** add an eager-list service `listAudiencesForAccount(accountId)` that:
1. Reads `marketing_audiences` for this account (the lazy-created rows so far).
2. **Discovers missing audiences** by querying `events` joined with `orders` for any brand/event the operator manages that has ≥1 paid order AND has NO corresponding `marketing_audiences` row.
3. Returns a merged list — the actual rows are real DB rows where they exist; the missing ones are returned as **virtual rows with `id: null`** that the UI displays identically and, when tapped, lazy-creates the underlying row via `ensureBrandBuyersAudience` / `ensureEventBuyersAudience` (same path the composer already uses).

This avoids a backend "audience auto-creation" cron (which would create many empty/dormant rows) while still surfacing every available audience to the operator on first paint.

### 6.3 Per-row data

For each audience row, the Audiences tab shows:
- Audience name + brand badge (icon)
- Total buyer count (resolved via `resolveBrandBuyers` / `resolveEventBuyers`)
- Reachable email count (also from resolver, already computed)
- Last-used date (most recent `marketing_campaigns.created_at` where `audience_id` matches; null if never used)
- Right chevron — tap navigates to **audience detail** (SPEC §5.3) — that detail screen is OUT OF SCOPE for this ORCH per §8.

### 6.4 Cross-brand deduplication

Same person buying from two brands → **two audience rows** (one per brand). NOT deduped into a single "person across brands" view. Rationale: brand member RLS scopes everything; cross-brand consolidation would leak which other brands this account manages to the row, and brand operators conceptually own their own audience independently.

### 6.5 "Blast this audience" CTA

Each row has a primary action "Blast" that navigates to the composer with `?audience={kind}:{id}` (existing composer parse path works verbatim). For virtual rows (id: null), the navigation creates the underlying row first then navigates.

---

## 7. Templates-tab — editable fields proof + UX contract

### 7.1 What's editable on a starter-pack row
**Nothing** — RLS UPDATE policy explicitly blocks any write to `is_starter_pack=true` rows. The UX must reflect this honestly.

### 7.2 "Duplicate" semantics
`duplicateTemplate(sourceId)` creates a NEW row with:
- `account_id = auth.uid()`
- `brand_id` = caller's current brand context (or NULL if at marketing tab top-level)
- `is_starter_pack = false` (enforced by INSERT policy regardless)
- `name = "{originalName} (copy)"`
- `subject_template`, `body_template`, `channel` copied verbatim — preserving both `{var}` and `{{event:id}}` token grammars

### 7.3 "Edit" semantics
Only valid on rows owned by the caller (`account_id = auth.uid() AND is_starter_pack = false`). Two editable fields: `name`, `subject_template`, `body_template`. `channel` is immutable post-create (Phase B is email-only anyway). `brand_id` is mutable (operator can reassign to a different brand they manage).

### 7.4 "Use this template" semantics
Navigates to composer with `?template={id}`. Composer must:
1. Parse `params.template` (NEW — does not exist today; small edit to `useLocalSearchParams` schema).
2. Call `getTemplate(id)`.
3. Pre-fill `subject` state with `template.subject_template ?? ""`.
4. Pre-fill `body` state with `template.body_template`.
5. Set `template_id` in the campaign create path so `marketing_campaigns.template_id` is populated (already a nullable FK, no schema change).
6. Mark composer as dirty so auto-save kicks in.

### 7.5 marketing-send consumes by snapshot
Critical confirmation from `marketing-send/index.ts:259, 342-344`: the dispatcher reads `campaign.channel_payload.subject` and `campaign.channel_payload.body_html` directly. **It does NOT join `marketing_templates` at send time.** So editing a template AFTER a campaign was saved does NOT change what was sent. This is the correct behaviour (immutable-snapshot) — Phase B Templates UI does not need to warn operators about "this template is in use" when editing.

### 7.6 Delete semantics
`deleteTemplate(id)` — RLS-gated on `is_starter_pack = false AND account_id = auth.uid()`. Starter rows cannot be deleted. Campaigns referencing a deleted template gracefully degrade: `marketing_campaigns.template_id` is `ON DELETE SET NULL`. Operator-confirm-destructive UX required.

---

## 8. Out-of-scope confirmations

| Item | Status | Why out |
|---|---|---|
| SMS dispatcher (Phase B-SMS) | OUT | Twilio toll-free in verification; separate ORCH after approval. Dispatcher already has `throw new Error("sms_not_yet_enabled")` at marketing-send line 261. |
| RCS dispatcher (Phase C) | OUT | Same — Twilio RBM verification + separate ORCH. |
| Phase 0 consent foundation (`marketing_consent` table + `buyer_*_verified` columns) | OUT | Per `project_marketing_hub_strategy.md` Phase A intentionally bypassed this. Phase B inherits the bypass. **Flagged for operator awareness — if Resend complaints rise post-Twilio-go-live, this becomes the next blocker.** |
| Sub-C polish (event-card hero, brand-color theming, template picker in composer Step-2) | OUT | Per `project_orch_0815_b_polish_deferred.md` — waits for 5–10 real-campaign feedback. The `?template=id` composer pre-fill in this ORCH does NOT count as the "template picker" UI in step 2; that polish remains deferred. |
| Audience detail screen (SPEC §5.3) | OUT | Tap-into-audience-detail is a deferred follow-up — Phase B Audiences tab navigates to composer on row tap, not to a detail view. |
| Open-rate tracking | OUT | Needs Resend webhook ingest path — separate ORCH. Marketing-report screen already hides open-rate honestly (`reports/QA_ORCH-0815_A2_COMBINED_REPORT.md` confirms). Overview tab funnel must use the same honest set: Sent / Delivered / Clicked / Failed. Drop "Opened" from the funnel until the webhook lands. |
| Revenue attribution to campaigns | OUT | Needs UTM persistence into `orders.utm_campaign_id` (Phase F). Overview tab hides revenue per §5 recommendation. |
| Audience auto-creation cron / matview | OUT | Lazy-on-first-display covers it per §6.2. |

---

## 9. One-SPEC vs three-SPECs — RECOMMENDED: ONE PARENT SPEC

Factors:

| Factor | One SPEC | Three SPECs |
|---|---|---|
| Total LOC delta | ~800 LOC across 3 hooks + 3 services + 5–7 components + 4 routes | Same | 
| Shared sub-nav, design tokens, empty states | ✓ trivial coordination | ✗ risk of drift (e.g., 3-way deduplication of `EmptyState` props) |
| Step 0.5 regression-test gate (1 happy-path + 1 adversarial per ORCH) | ONE pair covering "all three tabs render + read live data correctly + tap CTAs route correctly" | THREE pairs (3× implementor work, 3× tester work) for marginal independent value |
| Ship cadence | Single dispatch, single QA, single CLOSE, single PR | Three dispatches, convoy merge-conflict risk on `MarketingSubNav` / `marketingKeys.ts` |
| Reuse audit | Single pass — easy to see "Overview reuses CampaignCard, Audiences reuses BuyerRow, Templates needs new TemplateCard" | Each SPEC redoes the audit |
| Failure isolation | If one tab fails QA, the other two land cleanly via the CONDITIONAL-PASS pattern | Slight advantage but the deferred-tab risk is small |
| Templates ↔ Composer coupling | Templates "Use this template" CTA edits `compose.tsx` — same SPEC owns both ends | Two SPECs share the same file → coordination burden |

**Verdict: ONE SPEC.** Bundle is cleaner and faster.

---

## 10. Cross-surface impact — declared

Per `feedback_cross_surface_impact_inspection.md`, the SPEC enumerates 7 surfaces:

| Surface | In scope? | Notes |
|---|---|---|
| Consumer iOS (`app-mobile/` iOS) | **NO** | No consumer marketing UI; consumer app has no Marketing tab. |
| Consumer Android (`app-mobile/` Android) | **NO** | Same as iOS. |
| Buyer/anon Web (`mingla-business/` `/checkout/*`, `/e/*`, `/b/*`) | **NO** | Anonymous buyer flows do not reach marketing. |
| Business iOS (`mingla-business/` iOS) | **YES** | Primary surface — every change ships here. |
| Business Android (`mingla-business/` Android) | **YES** | Mandatory parity with iOS — all code is shared RN. |
| Admin Web (`mingla-admin/`) | **NO** | No admin marketing surface exists yet — if needed, separate ORCH. |
| Business Web preview (`mingla-business/` dev/web) | **YES** | Adjacent surface — same React Native Web build, must render. Spot-check during QA, not a primary device-fire target. |

**Parity model:** shared code, automatic parity. The three tabs use the same `MarketingSubNav`, same design tokens, same React Query hooks. No separate iOS vs Android code paths. Tester needs ONE iOS sim + ONE Android emu live-fire to prove parity (per `feedback_tester_canonical_and_platform_parity.md`).

---

## 11. Discoveries for orchestrator (side issues)

1. **DISC-1 [Composer template-param wiring missing].** `compose.tsx:92` `useLocalSearchParams<{ audience?: string; draft?: string }>()` does not include `template?: string`. SPEC must add the param + pre-fill path. P1 in this ORCH's scope; not a separate ORCH.
2. **DISC-2 [Audience lazy-creation does not eagerly surface every brand/event].** Operator sees 4 audiences today only because they touched 4 events via composer pre-fill; they have 1 brand × multiple events × every paid event SHOULD have a discoverable audience. Phase B fixes this in the Audiences tab via virtual rows (§6.2) — no separate ORCH needed.
3. **DISC-3 [Overview revenue hero is fabrication risk].** Spec §5.1 hero was always going to lie until UTM-to-campaign attribution lands. Phase B SPEC ships without the hero (replace with funnel headline). Flag for product to confirm acceptable.
4. **DISC-4 [Phase 0 consent foundation still bypassed].** Memory `project_marketing_hub_strategy.md` documents this. Phase B inherits the bypass; no `marketing_consent` table read on any send. Operator should book a Phase 0 ORCH BEFORE the Twilio toll-free SMS goes live — TCPA fines are $500–$1500 per text. Email is on softer ground (CAN-SPAM) but the unsubscribe path is already wired.
5. **DISC-5 [Marketing-send sender domain hardcoded].** marketing-send line 331 uses `usemingla.com` as the From domain — fine for now (Resend domain verified) but if operator wants per-brand custom domains later, that's a separate ORCH.
6. **DISC-6 [No realtime on marketing_messages].** Overview tab will show counts that lag by up to the React Query stale-time (30s) after a send. Phase B SPEC notes this as acceptable (real-time on a counter dashboard is overkill); flag if operator disagrees.
7. **DISC-7 [Click data is undercounted].** Of 64 click rows only 1 has `clicked_at` populated. That's because email recipients haven't clicked yet — NOT a bug. But Overview "Click rate" presentation should compute `clicks_clicked / messages_sent` (not `total_click_rows / messages_sent`) or it will under-report by 64x. SPEC pins the correct formula.

---

## 12. Confidence

- **HIGH** on infrastructure proof (every relevant file read, live DB probe confirms seed data, RLS policies cited from migration source, dispatcher logic traced end-to-end).
- **MEDIUM** on Overview-tab final layout (designer pass needed per `feedback_implementor_uses_ui_ux_pro_max.md` — Phase B implementor invokes `mingla-designer` before writing components).
- **HIGH** on one-vs-three SPEC decision (Step 0.5 gate math + convoy-merge risk are concrete).
- **HIGH** on out-of-scope list (cross-checked against `project_marketing_hub_strategy.md` + `project_orch_0815_b_polish_deferred.md` memories).
