# SPEC — ORCH-0863 [Marketing Hub Phase B — Overview + Audiences + Templates tabs]

**Date:** 2026-05-17
**Author:** Claude `mingla-forensics` (SPEC mode)
**Type:** missing-feature (UI + thin read-only hooks + small write surfaces on existing tables; no new tables, no new edge functions, no new migrations)
**Severity:** S2
**Investigation feeder:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0863_MARKETING_HUB_PHASE_B.md`
**Status:** READY FOR IMPLEMENTOR
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Mode:** SPEC (binding contract; no code)

---

## 1. Plain-English summary

Build out the three placeholder tabs (`Overview`, `Audiences`, `Templates`) of the Marketing Hub so the entire 4-pill sub-nav is functional, not just `Campaigns`. All three tabs ship in one parent ORCH because they share `MarketingSubNav`, design tokens, empty-state primitives, and a thin Templates→Composer wiring change. No new DB tables, no new edge functions, no new migrations — every required server primitive already exists from ORCH-0815 [Marketing Hub UI Phase A]. Phase B-SMS / Phase 0 consent foundation / revenue attribution / open-rate tracking remain out of scope.

---

## 2. Scope

### In scope
- **Overview tab** — real funnel metrics (Sent / Delivered / Clicked / Failed) for last-30-day window, 3 most-recent campaigns list, "+ New campaign" FAB.
- **Audiences tab** — unified list of brand-rollup + per-event audiences for every brand the operator manages with ≥1 paid order, with eager-virtual-row discovery + lazy DB create on first tap.
- **Templates tab** — 5 starter-pack templates + user-created templates list; tap → preview; "Duplicate" → user-owned clone; "Edit" → name+subject+body editor (user templates only); "Use this template" → composer with `?template={id}` pre-fill.
- **Composer template pre-fill** — single-line edit to `mingla-business/app/(tabs)/marketing/campaigns/compose.tsx` to parse `?template={id}` query param + pre-fill subject/body from `getTemplate(id)`.
- **Cross-surface QA**: business-iOS + business-Android + business-web-preview parity (automatic via shared RN code).

### Non-goals (NG)
- **NG-1** SMS dispatcher (gated on Twilio toll-free verification — separate ORCH after approval).
- **NG-2** RCS dispatcher (Phase C).
- **NG-3** Phase 0 consent foundation (`marketing_consent` table + `buyer_*_verified` columns + jurisdiction-aware checkout). Bypass inherited from Phase A; flag for operator if Twilio go-live makes this urgent.
- **NG-4** Sub-C polish (event-card hero, brand-color theming, in-composer template picker step). The `?template=id` route param this SPEC adds is a route-level entry point, NOT the in-composer picker.
- **NG-5** Audience detail screen (SPEC ORCH-0815 §5.3). Tap on an audience row in this Phase B navigates to composer, not to a detail view.
- **NG-6** Open-rate tracking (needs Resend webhook ingest path — separate ORCH).
- **NG-7** Revenue attribution to campaigns (needs UTM persistence into orders — Phase F).
- **NG-8** "Opened" funnel metric on Overview tab — replaced by "Clicked" + "Failed" until NG-6 lands.
- **NG-9** Revenue hero card on Overview tab — replaced by a "campaigns sent in 30 days" headline per Constitution #9 (no fabricated data).
- **NG-10** Audience auto-creation cron (lazy-virtual-row at display time covers it).
- **NG-11** Admin Web surface (no admin marketing route exists).
- **NG-12** Brand follower audience type (`brand_followers` kind — Phase D).
- **NG-13** Custom-segment audience type (`custom_segment` kind — Phase A+).
- **NG-14** Realtime subscription on `marketing_messages` for Overview live-update (React Query 30s stale-time is sufficient).

### Assumptions
- ORCH-0815 [Marketing Hub UI Phase A] schema + migrations are live on remote (verified via DB probe — 5 starter-pack templates, 4 audiences, 11 campaigns, 50 messages present).
- `marketing_audiences` table's `query_definition` discriminated-union CHECK constraint is in place (I-PROPOSED-BP).
- `marketing_templates` RLS UPDATE policy blocks writes to `is_starter_pack=true` rows (verified in migration `20260602000003_orch_0815_marketing_hub_phase_a.sql:183-184`).
- `mkt_brand_min_rank(uuid, text)` helper is in place and non-SECURITY-DEFINER.

---

## 3. Cross-Surface Impact (MANDATORY)

| Surface | In scope | User-visible behaviour | File paths touched | Parity model |
|---|---|---|---|---|
| **Consumer iOS** | NO | — | — | Not applicable — no Marketing tab in consumer. |
| **Consumer Android** | NO | — | — | Not applicable. |
| **Buyer/anon Web** (`/checkout/*`, `/e/*`, `/b/*`) | NO | — | — | Anonymous routes do not reach marketing. |
| **Business iOS** | **YES** | Marketing tab's Overview / Audiences / Templates pills now render real data + actions instead of placeholder cards. | `mingla-business/app/(tabs)/marketing/index.tsx`, `audiences/index.tsx`, `templates/*.tsx`, `campaigns/compose.tsx`, new `src/components/marketing/*`, new `src/hooks/marketing/*`, new methods in `src/services/marketing/*`. | Shared RN code — automatic parity. |
| **Business Android** | **YES** | Identical to iOS. | Same paths. | Shared RN code — automatic parity. Tester runs ONE Android-emu live-fire to prove. |
| **Admin Web** | NO | — | — | No admin marketing route. |
| **Business Web preview** (mingla-business dev/web RN-Web build) | YES (adjacent) | Same UI, same data — should render in web build. | Same paths. | Spot-check during QA (RN-Web compatibility risk: any new component using `Modal` or `Sheet` should be verified renders on web — `MarketingSubNav` + `CampaignFilterPills` already work, new TemplateCard / OverviewMetricCard / AudienceCard inherit same primitives.) |

**Parity success criteria** are stated once per behavior (SC-N) because all three primary surfaces share code. Where a manual divergence is unavoidable (none identified for this ORCH), the SC is split into SC-N-iOS / SC-N-Android / SC-N-Web.

---

## 4. Architecture decisions (binding)

| Decision | Choice | Why |
|---|---|---|
| Overview data sourcing | **Live aggregation** in a single `getMarketingOverview(accountId)` service call | At current 50-message scale sub-10ms; matview is premature. Migration path additive — hook can later swap to matview without component churn. |
| Revenue hero on Overview | **Omit entirely** for this ORCH | Constitution #9 — no UTM-to-campaign attribution exists. Replace with "campaigns sent in 30 days" headline. |
| Funnel metrics on Overview | **Sent / Delivered / Clicked / Failed** (4 cards) | "Opened" requires Resend webhook (NG-6). "Preview-skipped" merged into "Sent" for headline accuracy ("Sent" = `sent + delivered + preview_skipped + clicked`; "Failed" = `failed + bounced`; "Delivered" = `delivered + clicked`; "Clicked" = `clicked` distinct or `marketing_clicks WHERE clicked_at IS NOT NULL` distinct by message_id). Final rollup formulas pinned in §6.1.4. |
| Audiences listing | **Eager merged list** = real DB rows + virtual rows (id: null) for missing brand/event combos | Avoids over-creating dormant DB rows while still surfacing every available audience on first paint. |
| Audience row tap | **Navigates to composer** with `?audience={kind}:{id}`, lazy-creating row first if virtual | Reuses composer pre-fill path verbatim (SPEC §3 Doorways A/B/C convergence). |
| Templates duplicate | **Clone-on-duplicate** (INSERT new row with copied fields) | Starter rows are RLS-locked. Duplicate is a single `INSERT` with `is_starter_pack=false, account_id=auth.uid()`. |
| Templates edit | **Name + subject + body only**; `channel` immutable | Phase B is email-only; reassigning channel is a future ORCH. |
| Templates "Use this template" wiring | **`?template={id}` route param** parsed in `compose.tsx`'s `useLocalSearchParams` | Smallest possible composer change. `template_id` already exists as a nullable FK on `marketing_campaigns`. |
| Audience identity dedup | **Per-brand** (no cross-brand consolidation) | Brand-member RLS scoping; cross-brand reveals other-brand membership. |
| Sub-nav | **Reuse `MarketingSubNav` as-is** | Already production-ready; no edit. |
| Empty states | **Reuse existing `EmptyState` primitive** from `src/components/ui/EmptyState.tsx` | Already used by Campaigns tab. |
| New components | **`OverviewMetricCard`, `OverviewRecentCampaignRow`, `AudienceCard`, `TemplateCard`, `TemplateEditorSheet`** (5 new components) | Each has narrow scope; no design-system extension needed. |
| Realtime on Overview counts | **None** (React Query 30s stale-time) | Overkill for a counter dashboard. |

---

## 5. Information Architecture

### 5.1 Routes (4 new + 1 modified)

```
mingla-business/app/(tabs)/marketing/
  index.tsx                            MODIFY — replaces placeholder with Overview
  audiences/
    index.tsx                          MODIFY — replaces placeholder with Audiences list
  templates/
    index.tsx                          MODIFY — replaces placeholder with Templates list
    [id].tsx                           NEW    — Template detail / editor screen
  campaigns/
    compose.tsx                        MODIFY — add `?template={id}` parse + pre-fill (≤30 LOC delta)
```

### 5.2 Sub-nav behaviour

`MarketingSubNav.tsx` requires NO change. It already renders all 4 pills with the correct active-pill detection.

---

## 6. Screen Contracts

### 6.1 Marketing → Overview (`(tabs)/marketing/index.tsx`)

#### 6.1.1 Data
- ONE service call: `getMarketingOverview({ account_id }): Promise<MarketingOverviewSnapshot>`.
- ONE React Query hook: `useMarketingOverview(accountId)` with 30s `staleTime`.

#### 6.1.2 `MarketingOverviewSnapshot` shape (new TS type in `src/types/marketing.ts`)
```typescript
export interface MarketingOverviewSnapshot {
  window_days: 30;
  campaigns_sent_count: number;       // marketing_campaigns WHERE status='sent' AND sent_at > now()-30d
  funnel: {
    sent: number;                     // marketing_messages WHERE status IN ('sent','delivered','clicked','preview_skipped') AND created_at > now()-30d
    delivered: number;                // marketing_messages WHERE status IN ('delivered','clicked') AND created_at > now()-30d
    clicked: number;                  // distinct message_id from marketing_clicks WHERE clicked_at IS NOT NULL AND campaign_id IN (last-30d sent campaigns)
    failed: number;                   // marketing_messages WHERE status IN ('failed','bounced') AND created_at > now()-30d
  };
  recent_campaigns: Array<{
    id: string;
    name: string;
    status: CampaignStatus;
    sent_at: string | null;
    scheduled_for: string | null;
    recipient_count: number | null;
  }>;                                  // top 3 by sent_at DESC NULLS LAST, then created_at DESC
}
```

#### 6.1.3 Layout (top-down)
1. **Sub-nav** (renders automatically via parent layout — already wired).
2. **Headline card** — `{campaigns_sent_count}` campaigns sent in the last 30 days. If 0 → "Your first blast is one tap away. Tap + below." (replaces revenue hero per DEC §4).
3. **Four metric cards in a row** (`OverviewMetricCard` component):
   - "Sent" → `funnel.sent`
   - "Delivered" → `funnel.delivered` (+ `(funnel.delivered / funnel.sent * 100).toFixed(0) + "%"` subtitle when sent > 0)
   - "Clicked" → `funnel.clicked` (+ percentage subtitle)
   - "Failed" → `funnel.failed` (+ percentage subtitle; tone = warning when > 0)
4. **"Recent campaigns" section** — header label "RECENT CAMPAIGNS", then up to 3 `OverviewRecentCampaignRow` rows. Tap row → `/marketing/campaigns/[id]`.
5. **FAB** — "+ New campaign" floating button bottom-right with `bottom: insets.bottom + 96` (mirror Campaigns tab pattern exactly — same component shape, same lift, same styling).

#### 6.1.4 Server-side aggregation SQL (binding — implementor pins these exact predicates in `marketingOverviewService.ts`)

```typescript
// Pseudocode of the 3 PostgREST queries inside getMarketingOverview()
// 1) Campaigns sent count
supabase.from("marketing_campaigns")
  .select("id", { count: "exact", head: true })
  .eq("account_id", accountId)
  .eq("status", "sent")
  .gte("sent_at", new Date(Date.now() - 30*86400000).toISOString());

// 2) Funnel — message status histogram for messages in last 30d FROM this account's campaigns
supabase.from("marketing_messages")
  .select("status", { count: "exact" })
  .in("campaign_id", /* subquery: list of last-30d campaign ids for accountId */)
  .gte("created_at", thirtyDaysAgoIso);
// Reduce client-side into the 4 buckets per §6.1.2.

// 3) Recent 3 campaigns
supabase.from("marketing_campaigns")
  .select("id, name, status, sent_at, scheduled_for, recipient_count")
  .eq("account_id", accountId)
  .order("sent_at", { ascending: false, nullsFirst: false })
  .order("created_at", { ascending: false })
  .limit(3);

// "Clicked" cardinality (distinct message_ids in marketing_clicks WHERE clicked_at NOT NULL)
// requires a 4th call or a server-side RPC. ACCEPTABLE PATTERN: client-side distinct
// over a single .select("message_id").not("clicked_at", "is", null).in("campaign_id", ...)
// bounded by .limit(2000) (same bound as marketingReportService line 110).
```

#### 6.1.5 States
- **Loading:** 4 skeleton metric cards + 3 skeleton recent-campaign rows. No spinner — skeletons signal "rendering data" not "broken".
- **Error:** Single `EmptyState` with `illustration="users"`, title "Couldn't load metrics", description "Pull to retry, or come back in a moment." `refetch` on pull-to-refresh.
- **Empty (0 campaigns in window):** Headline says "Your first blast is one tap away. Tap + below." Funnel cards all show "0" (NOT hidden — operator can see they're real metrics). Recent-campaigns section omitted.
- **Populated:** Per layout above.

#### 6.1.6 Accessibility
- Every metric card has `accessibilityLabel="{count} {label}, {percentage} percent" ` (or just count when percentage is N/A).
- FAB has 44pt minimum touch target (already 48pt per Campaigns FAB precedent).
- Recent-campaign rows have `accessibilityLabel="{campaign_name}, {status}, {recipient_count} recipients"`.

---

### 6.2 Marketing → Audiences (`(tabs)/marketing/audiences/index.tsx`)

#### 6.2.1 Data
- ONE service call: `listAudiencesForAccount({ account_id }): Promise<AudienceListEntry[]>`.
- ONE React Query hook: `useAudienceList(accountId)` with 60s `staleTime`.
- For each visible row's reach count: lazy resolution via existing `resolveBrandBuyers` / `resolveEventBuyers` triggered by intersection observer or batched single-shot per page-render (SEE §6.2.4 for the batching contract).

#### 6.2.2 `AudienceListEntry` shape (new TS type in `src/types/marketing.ts`)
```typescript
export type AudienceListEntryKind = "brand_buyers" | "event_buyers";

export interface AudienceListEntry {
  /** Stable client key: `${kind}:${target_id}`. */
  client_key: string;
  kind: AudienceListEntryKind;
  /** UUID of the marketing_audiences row IF it exists in DB. Null when virtual. */
  audience_id: string | null;
  /** Brand ID (for brand_buyers and event_buyers). */
  brand_id: string;
  brand_name: string;
  /** For event_buyers; null for brand_buyers. */
  event_id: string | null;
  /** Display name — e.g., "All buyers — Sunset Rooftop" or "Buyers — Saturday Sessions Vol. 4". */
  display_name: string;
  /** Most recent campaign created_at using this audience_id; null if never used or virtual. */
  last_used_at: string | null;
}
```

#### 6.2.3 Implementation contract for `listAudiencesForAccount`
1. SELECT `marketing_audiences` rows WHERE `account_id = auth.uid()` AND `query_definition->>'kind' IN ('brand_buyers','event_buyers')`. Map to `AudienceListEntry` with `audience_id` populated.
2. SELECT every brand the operator manages with ≥1 paid order (join `brands` ← `brand_team_members` for caller-membership + `events` + `orders` WHERE `payment_status IN ('paid','partial_refund')`). For each brand: if no existing `brand_buyers` audience row, append a virtual entry with `audience_id: null`.
3. SELECT every event under those brands with ≥1 paid order. For each event: if no existing `event_buyers` audience row, append a virtual entry with `audience_id: null`.
4. Sort: real rows by `last_used_at DESC NULLS LAST`, then virtual rows alphabetically by `brand_name` then `display_name`.
5. RLS gates SELECTs naturally (marketing_audiences RLS already gates; events/orders read via existing RLS).

#### 6.2.4 Reach-count resolution (batched, lazy)
Per-row reach (total + reachable_email) is computed via the existing resolvers. To avoid N parallel `resolveBrandBuyers` calls on first paint:
- Initial render: each row shows "Loading reach…" placeholder.
- ONE `Promise.allSettled([...])` batch fires across all visible rows on mount, returning a `Map<client_key, AudienceReachSummary>`.
- Failures per-row are silent (row shows "—" for counts; not an error overlay — the row is still tappable).
- Subsequent renders read from React Query cache (`marketingKeys.audiences.reach(client_key)` factory entries, 60s stale).

#### 6.2.5 Layout
1. Sub-nav (automatic).
2. Header: "Your audiences" + caption "Auto-updated as people buy tickets." (no add-CTA — saved-query audiences out of scope).
3. List of `AudienceCard` rows (one per `AudienceListEntry`). Each card:
   - Top row: bold `display_name`
   - Sub row: "{total} buyers · {reachable_email} reachable" (or "Loading reach…")
   - Right side: `last_used_at` relative ("Last sent 3d ago" / "Never sent") + chevron
4. Empty state (no brands managed, no paid orders): `EmptyState` "Audiences will appear here once your first ticket sells."

#### 6.2.6 Row tap behaviour
- **Real audience row (`audience_id !== null`):** navigates to composer with `?audience={kind}:{target_id}` (composer already handles).
- **Virtual row (`audience_id === null`):** call the existing `ensureBrandBuyersAudience` / `ensureEventBuyersAudience` to materialize the row, then navigate to composer with same param. Loading state on the row during create.

#### 6.2.7 States
- **Loading:** 3 skeleton AudienceCard rows.
- **Error (top-level service throw):** `EmptyState` "Couldn't load audiences", pull-to-retry.
- **Empty:** per 5.
- **Populated:** per 5.

---

### 6.3 Marketing → Templates (`(tabs)/marketing/templates/index.tsx`)

#### 6.3.1 Data
- TWO service calls in parallel: `listStarterTemplates()` (already exists) + `listUserTemplates({ account_id }): Promise<MarketingTemplateRow[]>` (NEW).
- React Query: `useStarterTemplates()` + `useUserTemplates(accountId)`, both 60s `staleTime`.

#### 6.3.2 New service methods (in `src/services/marketing/marketingTemplateService.ts`)
```typescript
// Existing: listStarterTemplates(), getTemplate(id)
// NEW:
export async function listUserTemplates(input: { account_id: string }): Promise<MarketingTemplateRow[]>
export async function createUserTemplate(input: {
  account_id: string;
  brand_id: string | null;
  name: string;
  subject_template: string | null;
  body_template: string;
}): Promise<MarketingTemplateRow>      // INSERT with is_starter_pack=false, channel='email'
export async function updateUserTemplate(input: {
  template_id: string;
  name: string;
  subject_template: string | null;
  body_template: string;
}): Promise<MarketingTemplateRow>      // UPDATE — RLS blocks starter rows automatically
export async function duplicateTemplate(input: {
  source_template_id: string;
  account_id: string;
  brand_id: string | null;
}): Promise<MarketingTemplateRow>      // Internally: getTemplate(source) → createUserTemplate(copied fields, name="{original} (copy)")
export async function deleteUserTemplate(input: { template_id: string }): Promise<void>
```

All methods validate `template_id` / `account_id` are UUIDs via the existing `UUID_RE` pattern from `marketingReportService.ts`.

#### 6.3.3 Layout
1. Sub-nav (automatic).
2. Section header: "MINGLA STARTER PACK" + caption "Read-only — duplicate to customize."
3. List of starter `TemplateCard` rows (5 cards, ordered by `id` ASC for stable ordering): name + 1-line body preview + "Read-only" pill chip.
4. Section header: "YOUR TEMPLATES" — only rendered when `userTemplates.length > 0`.
5. List of user `TemplateCard` rows: name + 1-line preview + edit/delete affordances revealed on right-swipe (mobile) or right-side hover (web).
6. FAB: "+ New template" → opens `TemplateEditorSheet` in create mode.

#### 6.3.4 Tap behaviour
- **Tap a starter card:** navigates to `/marketing/templates/[id]` in **read-only mode** (displays subject + body verbatim, two CTAs at bottom: "Duplicate" and "Use this template").
- **Tap a user card:** navigates to `/marketing/templates/[id]` in **editable mode** (same screen, with name+subject+body editable).
- **Duplicate from starter detail:** calls `duplicateTemplate({ source_template_id, account_id, brand_id: currentBrandId ?? null })`, then routes to the new template's detail screen in editable mode + invalidates `useUserTemplates`.
- **Use this template:** navigates to `/marketing/campaigns/compose?template={id}`.

#### 6.3.5 Template detail screen (`templates/[id].tsx` — NEW)

| State | UI |
|---|---|
| Loading | Spinner |
| Error | EmptyState "Couldn't load template" + back button |
| Read-only (starter) | Header (back chevron + title) → Subject (text) → Body (multi-line text, preserves `{var}` + `{{event:id}}` tokens verbatim) → Footer with "Duplicate" + "Use this template" CTAs |
| Editable (user) | Header (back + title) → Subject TextInput → Body TextInput (multiline ≥8 rows) → Footer with "Save" + "Delete" (destructive confirm) + "Use this template" |
| Editable + dirty | "Save" CTA enabled; back-listener intercepts with "Save changes?" alert (reuse pattern from compose.tsx:384-420) |

#### 6.3.6 Token preservation contract (CRITICAL)
Starter templates contain TWO interpolation grammars: `{first_name}` (single-brace, server-substituted) and `{{event:{event_id}}}` (double-brace, marketing-send loadEmbeddedEvents path). The Templates UI MUST preserve both verbatim — no regex stripping, no escaping, no "smart" replacement. The body TextInput renders raw text; only display affordance is monospace caption "Use `{first_name}` for personalization · `{{event:abc}}` to embed an event card" below the body.

#### 6.3.7 New components
- `TemplateCard` — name + 1-line body preview (slice first 80 chars, replace `\n` with " "), optional "Read-only" pill chip.
- `TemplateEditorSheet` — modal sheet wrapping the editor for the FAB "New template" flow (alternative to navigating to `templates/[id]?mode=new`). Recommend: use `templates/[id]` route with `id=new` sentinel rather than a separate sheet, to reuse all state logic. Implementor's call between sheet and route — pick whichever is closer to the Campaigns compose pattern.

---

### 6.4 Composer (`(tabs)/marketing/campaigns/compose.tsx`) — modification

Single contract change:

1. Extend `useLocalSearchParams` schema:
   ```typescript
   const params = useLocalSearchParams<{ audience?: string; draft?: string; template?: string }>();
   const templateId = typeof params.template === "string" ? params.template : null;
   ```
2. Add a one-shot hydration effect (mirrors the `draftId` effect at compose.tsx:185-217):
   ```typescript
   useEffect(() => {
     if (templateId === null || draftId !== null) return;  // draft restore wins over template pre-fill
     let cancelled = false;
     (async () => {
       try {
         const tmpl = await getTemplate(templateId);
         if (cancelled || tmpl === null) return;
         setSubject(tmpl.subject_template ?? "");
         setBody(tmpl.body_template);
         setIsDirty(true);
       } catch (err) {
         if (!cancelled) {
           setErrorBanner(err instanceof Error ? err.message : "Couldn't load template.");
         }
       }
     })();
     return () => { cancelled = true; };
   }, [templateId, draftId]);
   ```
3. When `createDraft` fires for the first time and `templateId !== null`, pass `template_id: templateId` so `marketing_campaigns.template_id` is populated. Requires extending `createDraft` input schema in `marketingCampaignService.ts` to accept optional `template_id?: string` (additive, backward-compat).

**LOC delta budget: ≤30 LOC on compose.tsx + ≤10 LOC on marketingCampaignService.ts.**

---

## 7. Schema additions: NONE

No new tables. No new columns. No new constraints. No new RLS policies. No new RPCs. No new edge functions. No new migrations.

The existing `marketing_campaigns.template_id` FK is nullable + `ON DELETE SET NULL` — Phase B writes use it, no schema change.

---

## 8. Component architecture (new)

| File | Purpose |
|---|---|
| `mingla-business/src/components/marketing/OverviewMetricCard.tsx` | Single funnel-metric tile (count + label + optional % subtitle + optional warning tone) |
| `mingla-business/src/components/marketing/OverviewRecentCampaignRow.tsx` | Compact campaign row for Overview's "Recent" section (≠ existing `CampaignCard` which has more affordances) |
| `mingla-business/src/components/marketing/AudienceCard.tsx` | Audiences-tab row: display name + counts + last-sent + chevron |
| `mingla-business/src/components/marketing/TemplateCard.tsx` | Templates-tab row: name + body preview + optional "Read-only" pill |
| `mingla-business/src/components/marketing/TemplateEditor.tsx` | Editor body used by `templates/[id]` route (subject TextInput + body TextInput + token-help caption) |

## 9. Hook architecture (new)

| File | Purpose |
|---|---|
| `mingla-business/src/hooks/marketing/useMarketingOverview.ts` | Reads `getMarketingOverview(accountId)`; 30s stale |
| `mingla-business/src/hooks/marketing/useAudienceList.ts` | Reads `listAudiencesForAccount(accountId)` + batched reach lookup |
| `mingla-business/src/hooks/marketing/useStarterTemplates.ts` | Reads `listStarterTemplates()`; 5min stale (rarely changes) |
| `mingla-business/src/hooks/marketing/useUserTemplates.ts` | Reads `listUserTemplates(accountId)`; 60s stale |
| `mingla-business/src/hooks/marketing/useTemplate.ts` | Reads `getTemplate(id)`; 60s stale |
| `mingla-business/src/hooks/marketing/useTemplateMutations.ts` | `createUserTemplate`, `updateUserTemplate`, `duplicateTemplate`, `deleteUserTemplate` — all with React Query mutations + cache invalidation of `marketingKeys.templates.*` |

`marketingKeys.ts` factory needs new entries: `overview.byAccount(accountId)`, `audiences.list(accountId)`, `audiences.reach(client_key)`, `templates.starter`, `templates.user(accountId)`, `templates.byId(templateId)`.

## 10. Service architecture (new + extended)

| File | New / extended | Purpose |
|---|---|---|
| `mingla-business/src/services/marketing/marketingOverviewService.ts` | NEW | `getMarketingOverview({ account_id })` — 3 PostgREST calls + client-side rollup per §6.1.4 |
| `mingla-business/src/services/marketing/marketingAudienceService.ts` | EXTENDED | Add `listAudiencesForAccount({ account_id })` per §6.2.3 |
| `mingla-business/src/services/marketing/marketingTemplateService.ts` | EXTENDED | Add `listUserTemplates`, `createUserTemplate`, `updateUserTemplate`, `duplicateTemplate`, `deleteUserTemplate` per §6.3.2 |
| `mingla-business/src/services/marketing/marketingCampaignService.ts` | EXTENDED | `createDraft` accepts optional `template_id?: string` (additive) |

## 11. Component rules (Mingla-bespoke — non-negotiable)

- All TextInputs in `TemplateEditor.tsx` MUST implement keyboard-rule per `feedback_keyboard_never_blocks_input.md` (wrap in `KeyboardAvoidingView`, scrollToEnd via requestAnimationFrame).
- All sub-sheets MUST render inside parent Sheet per `feedback_rn_sub_sheet_must_render_inside_parent.md`.
- All inline-style colors hex/rgb/hsl/hwb only per `feedback_rn_color_formats.md`.
- All Toasts wrapped in absolute-positioned wrappers per `feedback_toast_needs_absolute_wrap.md`.
- Anti-back-block disarm-flag pattern for `TemplateEditor` dirty exits per `feedback_back_listener_disarm_pattern.md`.
- All interactive elements ≥44pt touch target (I-38).
- All interactive Pressables have `accessibilityLabel` (I-39).
- Zustand persist holds IDs only, not server records (I-PROPOSED-J) — no Zustand introduced in this ORCH; React Query owns server state.
- Sibling `<ScrollView>` instances in Overview / Audiences / Templates lists MUST set `flexGrow: 0` / `flexShrink: 0` on the non-primary scroller per `feedback_rn_scrollview_flex_grow_default_one_silent_footgun.md`. (Mostly N/A — each tab has at most one ScrollView, but if implementor adds a horizontal pills row above the main list, this rule applies.)

---

## 12. Success Criteria

| ID | Criterion | Verifier |
|---|---|---|
| **SC-1** | Marketing → Overview renders 1 headline + 4 funnel metric cards + up to 3 recent-campaign rows + FAB. Empty state when zero campaigns in window. | Tester live-fire iOS sim |
| **SC-2** | Overview funnel counts match the SQL formulas in §6.1.4 exactly: `sent = COUNT(messages WHERE status IN ('sent','delivered','clicked','preview_skipped'))`; `delivered = COUNT(messages WHERE status IN ('delivered','clicked'))`; `clicked = COUNT(DISTINCT message_id from marketing_clicks WHERE clicked_at NOT NULL)`; `failed = COUNT(messages WHERE status IN ('failed','bounced'))`. | Jest test against fixture + tester DB-probe parity check |
| **SC-3** | Overview is 30-day windowed: all four counts exclude messages whose `marketing_messages.created_at < now() - 30d`. | Jest test |
| **SC-4** | Overview FAB navigates to `/marketing/campaigns/compose`. Recent-campaign row tap navigates to `/marketing/campaigns/{id}`. | Tester live-fire |
| **SC-5** | Overview hides the revenue hero entirely; headline is "campaigns sent" count (Constitution #9 compliance — no fabricated $ value). | Source-grep + tester visual confirm |
| **SC-6** | Audiences tab lists every brand the operator manages with ≥1 paid order (as `brand_buyers` row) + every event under those brands with ≥1 paid order (as `event_buyers` row). Both real-DB rows and virtual rows render identically. | Jest test against fixture + tester DB-probe parity |
| **SC-7** | Audience row tap on a real-DB row navigates to composer with `?audience={kind}:{id}`. Audience row tap on a virtual row creates the underlying DB row first, then navigates. | Tester live-fire (tap a never-blasted event) |
| **SC-8** | Audience row shows "{total} buyers · {reachable_email} reachable" + relative "last sent" timestamp. Loading placeholder while reach resolves; "—" on per-row reach error (silent, row stays tappable). | Tester live-fire |
| **SC-9** | Audiences tab shows empty state "Audiences will appear here once your first ticket sells." when operator has zero paid orders across all brands. | Jest test |
| **SC-10** | Templates tab lists 5 starter templates (read-only pill) + user templates (with edit/delete affordances). Starter section always visible; user section hidden when zero rows. | Tester live-fire |
| **SC-11** | Tap on a starter template opens detail in **read-only mode** with "Duplicate" + "Use this template" CTAs. Tap on a user template opens detail in **editable mode**. | Tester live-fire |
| **SC-12** | "Duplicate" creates a new row with `is_starter_pack=false, account_id=auth.uid(), name="{original} (copy)"` and routes to the new template's editable detail screen. | Jest test against fixture + tester live-fire |
| **SC-13** | "Use this template" navigates to composer with `?template={id}`. Composer parses the param, calls `getTemplate(id)`, pre-fills `subject` and `body`, marks dirty (auto-save triggers), and passes `template_id` to first `createDraft` so `marketing_campaigns.template_id` is populated. | Jest test + tester live-fire (use a starter → check DB row has `template_id` set) |
| **SC-14** | Template "Edit" updates `name`, `subject_template`, `body_template` via `updateUserTemplate`. Channel immutable. RLS rejects any UPDATE attempt on starter rows (tester probes manually). | Jest test + tester RLS-probe |
| **SC-15** | Template "Delete" requires destructive-action confirm + soft-delete-pattern: actually DELETEs the row (template_id FK on marketing_campaigns is ON DELETE SET NULL, so existing campaigns gracefully degrade). | Jest test + tester live-fire |
| **SC-16** | Both `{first_name}` (single-brace) and `{{event:abc}}` (double-brace) tokens are preserved verbatim through Template edit save + load roundtrip. No regex stripping, no escaping. | Jest test (T-04 below) |
| **SC-17** | All three tabs render on business-iOS, business-Android, and business-web-preview with identical functionality. | Tester live-fire across 2 devices + 1 web probe |
| **SC-18** | tsc clean, jest green, Deno green (no edge fn changes — Deno suite unaffected), strict-grep green. | CI |
| **SC-19** | EAS OTA only — no native module added. Implementor verifies with `npx expo prebuild --check` (or equivalent) and notes in implementation report. | Implementor self-verify + tester confirm |
| **SC-20** | All component rules from §11 honored: keyboard-rule, sub-sheet-inside-parent, hex/rgb colors only, toast absolute wrap, back-listener disarm, ≥44pt touch, accessibilityLabel, no Zustand server state. | Source-grep + tester visual |

---

## 13. Invariants (new, all start DRAFT — flip ACTIVE on CLOSE)

| ID | Statement | Enforcement |
|---|---|---|
| **I-PROPOSED-MKT-OVERVIEW-NO-REVENUE-FABRICATION** | The Overview tab MUST NOT render a $ revenue figure until UTM-to-campaign attribution is wired. Phase B headline is campaign-count only. | Strict-grep gate: no `$` or `revenue` literal in `app/(tabs)/marketing/index.tsx` until attribution lands |
| **I-PROPOSED-MKT-AUDIENCE-LAZY-VIRTUAL-ROW** | Audiences tab MUST surface every brand/event audience eligible for the operator, materialized lazily on first tap. No backend auto-creation cron. | Strict-grep gate: `listAudiencesForAccount` exists + handles virtual rows; no `pg_cron` job referencing `marketing_audiences INSERT` |
| **I-PROPOSED-MKT-TEMPLATE-TOKENS-VERBATIM** | Template editor preserves both `{var}` and `{{event:id}}` tokens verbatim through edit roundtrip. No regex transformation. | Jest test (T-04 below) — must FAIL when any token regex strip is introduced |
| **I-PROPOSED-MKT-STARTER-TEMPLATES-READ-ONLY** | Starter-pack template rows (`is_starter_pack=true`) MUST NOT be writable through any service method. UI MUST honor this with read-only mode + "Duplicate" CTA. | Service-layer assertion: `updateUserTemplate` / `deleteUserTemplate` reject when target row's `is_starter_pack=true` (defense in depth — RLS already blocks but service explicitly checks too) |
| **I-PROPOSED-MKT-PHASE-B-NO-NEW-TABLES** | Phase B (this ORCH) does NOT introduce new DB tables, edge functions, or migrations. All work is UI + service-method additions on existing schema. | Source-diff inspection: `git diff --stat HEAD` from base shows zero new files under `supabase/migrations/` or `supabase/functions/` |

---

## 14. Test Matrix

| ID | What | Where | Type | Pass criteria |
|---|---|---|---|---|
| **T-01** (HAPPY) | `getMarketingOverview` 30-day window + funnel rollup formulas | `mingla-business/src/services/marketing/__tests__/marketingOverviewService.test.ts` (NEW) | Jest | Fixture: 50 messages (mix of sent / preview_skipped / failed across 11 campaigns) → service returns counts matching the binding formulas in §6.1.4 exactly |
| **T-02** | `listAudiencesForAccount` virtual-row discovery | `marketingAudienceService.test.ts` (extended) | Jest | Fixture: 2 brands managed × 3 events each × varying paid-order presence + 2 existing audience rows → service returns 8 entries (2 brand + 6 event), 2 real, 6 virtual |
| **T-03** | Templates `duplicateTemplate` preserves both token grammars | `marketingTemplateService.test.ts` (NEW) | Jest | Fixture starter row body contains both `{first_name}` and `{{event:abc}}` → duplicate result body matches source byte-for-byte |
| **T-04** (HAPPY) | Templates token-roundtrip — `updateUserTemplate` does not transform tokens | `marketingTemplateService.test.ts` | Jest | INSERT user template with body `"Hi {first_name}, see {{event:xyz}}"` → UPDATE with same body → SELECT shows identical string. Fails if any regex strip is introduced. **THIS IS THE STEP 0.5 HAPPY-PATH TEST.** |
| **T-05** | Composer parses `?template={id}` and pre-fills subject + body | `app/(tabs)/marketing/campaigns/__tests__/compose.template-prefill.test.tsx` (NEW) | Jest | Mock `getTemplate` to return fixture row, render `<ComposeCampaignRoute />` with `useLocalSearchParams` mocked to `{template:"abc"}` → assert subject + body state reflect template fields |
| **T-06** | Overview hides revenue (Constitution #9) | source-grep test | Jest (strict-grep style) | Assert `app/(tabs)/marketing/index.tsx` source does NOT contain `revenue` substring (case-insensitive) AND does NOT contain `'$'` literal in JSX |
| **T-07** | Audiences row reach silently degrades on per-row resolver failure | `useAudienceList.test.ts` (NEW) | Jest | Mock 1 row's reach to throw → hook returns list with that row having `reach: null`, NO global error state |
| **T-08** (ADVERSARIAL) | Template editor invariant: starter rows cannot be updated via service even if UI permits | `marketingTemplateService.test.ts` | Jest | Call `updateUserTemplate({template_id: starter_uuid, ...})` → service throws `Error("Cannot modify starter-pack template")` BEFORE hitting DB. **DIFFERENT ANGLE THAN T-04** — T-04 verifies happy-path roundtrip; T-08 verifies the security defense-in-depth layer that fails even if the UI is buggy. **THIS IS THE STEP 0.5 ADVERSARIAL TEST.** |
| **T-09** | Cross-surface parity — components render on web | manual / RN-Web preview build smoke | Tester | Templates tab + Overview tab + Audiences tab visible in `mingla-business` web preview without TypeError or layout breakage |
| **T-10** | RLS: brand-member can SELECT marketing_templates but cannot INSERT for another account | Tester Supabase MCP probe | Tester | INSERT attempt with `account_id != auth.uid()` → rejected by RLS |
| **T-11** | RLS: caller cannot UPDATE starter-pack template | Tester Supabase MCP probe | Tester | UPDATE attempt on `is_starter_pack=true` row → rejected (0 rows updated, no error) |

**Step 0.5 regression-test gate satisfied:**
- HAPPY-PATH: **T-04** — implementor authors, runs in implementation report, captures `fails-on-revert verified at <commit>` line.
- ADVERSARIAL (different angle): **T-08** — tester authors, runs in QA report, captures `fails-on-revert verified at <commit>` line.

Both tests live at real paths (`mingla-business/src/services/marketing/__tests__/marketingTemplateService.test.ts`) and ship in the same PR as the product code per the append-only CI gate (ORCH-0840).

---

## 15. Implementation order (binding)

1. **Types** — extend `src/types/marketing.ts` with `MarketingOverviewSnapshot`, `AudienceListEntry`.
2. **Services** — `marketingOverviewService.ts` (NEW), extend `marketingAudienceService.ts` (+`listAudiencesForAccount`), extend `marketingTemplateService.ts` (+5 new methods + defense-in-depth starter-pack guard).
3. **marketingKeys factory** — add new entries.
4. **Hooks** — 6 new hooks per §9.
5. **Components** — 5 new components per §8.
6. **Routes** — modify `marketing/index.tsx`, `audiences/index.tsx`, `templates/index.tsx`; create `templates/[id].tsx`; modify `campaigns/compose.tsx` per §6.4.
7. **Composer service touch** — extend `createDraft` to accept `template_id?` (≤10 LOC).
8. **Jest tests** — T-01..T-08.
9. **Self-verify** — `tsc --noEmit` clean, `jest src/services/marketing src/hooks/marketing app/(tabs)/marketing` green, run `git diff --stat HEAD` to confirm zero new files under `supabase/`.
10. **Designer pre-flight** — per `feedback_implementor_uses_ui_ux_pro_max.md`, implementor invokes `mingla-designer` BEFORE writing Overview / Audiences / Templates list components, producing pixel specs that match Mingla aesthetics.

---

## 16. Regression prevention

- **Class:** UI fabrication of metrics not actually measured (the "$ revenue" hero risk). **Safeguard:** I-PROPOSED-MKT-OVERVIEW-NO-REVENUE-FABRICATION + T-06.
- **Class:** Token-transformation bug in template editor (would silently break email rendering at send time). **Safeguard:** I-PROPOSED-MKT-TEMPLATE-TOKENS-VERBATIM + T-04 (happy) + T-08 (adversarial).
- **Class:** Starter-pack write attempt bypassing RLS via misconfigured service call. **Safeguard:** Service-layer guard (defense-in-depth) tested by T-08 + RLS probe T-11.
- **Class:** Overcounting clicks by reading `marketing_clicks` row count instead of distinct-message clicked. **Safeguard:** SC-2 formula pinning + T-01 fixture.

---

## 17. Hard Guards (Implementor MUST NOT)

- ❌ Add any new table, column, RLS policy, RPC, edge function, or migration. **NG: ZERO files under `supabase/migrations/` or `supabase/functions/`.**
- ❌ Render a `$` symbol or "revenue" string in Overview (I-PROPOSED-MKT-OVERVIEW-NO-REVENUE-FABRICATION).
- ❌ Render "Opened" as a funnel metric on Overview (NG-8).
- ❌ Implement SMS / RCS dispatch logic (NG-1, NG-2).
- ❌ Touch `marketing-send/index.ts`, `marketing-track-click/index.ts`, `marketing-unsubscribe/index.ts`, OR Phase A schema migration file.
- ❌ Implement audience auto-creation cron (NG-10).
- ❌ Build the in-composer template picker step (NG-4 — `?template=id` route-level pre-fill is allowed; in-composer Step 2 template-picker UI is deferred).
- ❌ Build audience detail screen (NG-5 — audience row tap goes straight to composer).
- ❌ Add Resend webhook ingest path (NG-6).
- ❌ Add UTM-to-campaign attribution path (NG-7).
- ❌ Modify the Email `channel_payload.kind='email'` shape (I-PROPOSED-BQ from Phase A).
- ❌ Use `.neq()` on nullable columns per `feedback_supabase_neq_null.md`.
- ❌ Use oklch/lab/lch/color-mix colors per `feedback_rn_color_formats.md`.
- ❌ Render sub-sheets as Fragment siblings per `feedback_rn_sub_sheet_must_render_inside_parent.md`.
- ❌ Use bare `crypto.randomUUID()` — use `randomId` utility per DEC-148.
- ❌ Build Customer or Buyer audience detail navigation (different ORCH).

---

## 18. CI / Strict-Grep Gates (new — register per `feedback_strict_grep_registry_pattern.md`)

New strict-grep script `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` registered as ONE job in `.github/workflows/strict-grep-mingla-business.yml` (single script + single job). Required checks:

1. `mingla-business/app/(tabs)/marketing/index.tsx` does NOT contain `revenue` (case-insensitive) — Overview revenue-hero ban.
2. `mingla-business/app/(tabs)/marketing/index.tsx` does NOT contain `Opened` as a funnel-card label literal.
3. `marketingOverviewService.ts` exists and exports `getMarketingOverview`.
4. `marketingTemplateService.ts` `updateUserTemplate` body contains a starter-pack guard pattern (regex: `is_starter_pack.*true.*throw` OR equivalent).
5. `app/(tabs)/marketing/campaigns/compose.tsx` `useLocalSearchParams` schema includes `template?:` literal.
6. Zero new files under `supabase/migrations/` AND `supabase/functions/` introduced by this ORCH (gate compares against base — diff-aware).
7. Negative-control proof: implementor demonstrates each gate fires on at least one intentional regression during local development.

---

## 19. Failure Modes & Mitigation

| Failure | Mitigation |
|---|---|
| Overview funnel under-counts because `marketing_clicks.clicked_at` is sparse (1 of 64 today) | SC-2 formula uses `clicked_at IS NOT NULL` filter — only counts real clicks, not pre-generated tracking rows |
| Audience reach resolver is slow (resolveBrandBuyers can return hundreds of rows + N+1 unsubscribe joins) | §6.2.4 batches via `Promise.allSettled` + caches per-key in React Query; per-row "Loading reach…" placeholder prevents blocking |
| Operator manages 50+ brands × 100+ events → Audiences tab paint stalls | Acceptable initial-paint perf at current scale (1 brand × ~10 events). Pagination is a future ORCH; flag in implementor report if any operator approaches this. |
| Starter-pack template edit attempt via DevTools | RLS rejects (Phase A invariant) + service-layer guard rejects (this SPEC's defense-in-depth via T-08) |
| Composer `?template=id` and `?draft=id` both present | `draft` wins (existing behaviour from compose.tsx draft restore); template pre-fill is skipped per §6.4 step 2 |
| Template deleted while a draft campaign references it via `template_id` | Draft survives — FK is `ON DELETE SET NULL`; campaign keeps its `subject`/`body` snapshot intact (sent-snapshot pattern from marketing-send) |

---

## 20. Open Questions for Operator (non-blocking)

These can be answered post-implementation but should be confirmed before CLOSE:

1. **Overview headline copy.** Default proposal: "{N} campaigns sent in 30 days." Alternatives: "{N} blasts since {date}" / "{N} emails to {M} people in 30 days." Operator pick?
2. **Audiences "last sent" relative cutoff.** Default: show relative for <30d, absolute date for older. Operator may prefer always-relative.
3. **Template detail "Use this template" placement.** Default: footer CTA next to "Save". Alternative: sticky header action.
4. **Empty-state copy for zero managed brands.** Default: "Audiences will appear here once your first ticket sells." Honest but maybe too dry — operator may want punchier copy.
5. **Templates section ordering on the index tab.** Default: starter pack FIRST, then user templates. Alternative: user templates first (more relevant to power users).

---

## 21. Implementor Deliverables

The implementor PR closing this SPEC must include:

1. ~5 new components per §8.
2. ~6 new hooks + 1 modified `marketingKeys.ts` per §9.
3. ~6 service-method additions across 3 service files + 1 new service file per §10.
4. ~4 modified routes + 1 new route file per §5.1.
5. Composer `?template={id}` parse + pre-fill per §6.4.
6. ~5 new TS types in `src/types/marketing.ts` per §6.1.2 + §6.2.2.
7. Jest tests T-01..T-08 per §14.
8. New strict-grep gate `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` + workflow registration per §18.
9. Implementation report at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0863_MARKETING_HUB_PHASE_B.md` with:
   - Old→new receipts per file.
   - T-04 `fails-on-revert verified at <commit>` line.
   - `git diff --stat HEAD` proving zero `supabase/` files touched.
   - EAS OTA verdict (presumed pure-JS).
   - Negative-control evidence for each strict-grep check.
10. tsc clean + jest green + strict-grep green.

**Before implementor dispatch:** mingla-designer skill MUST run a design pass producing pixel-accurate component specs matching Mingla aesthetics. Output: `Mingla_Artifacts/design/DESIGN_ORCH-0863_MARKETING_HUB_PHASE_B.md`. Per memory `feedback_implementor_uses_ui_ux_pro_max.md`.

---

## 22. Cross-References

- Investigation feeder: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0863_MARKETING_HUB_PHASE_B.md`
- Phase A spec (parent context): `Mingla_Artifacts/specs/SPEC_ORCH-0815_MARKETING_HUB_UI_PHASE_A.md`
- Phase A design: `Mingla_Artifacts/design/DESIGN_ORCH-0815_MARKETING_HUB_PHASE_A.md`
- Phase A QA: `Mingla_Artifacts/reports/QA_ORCH-0815_A2_COMBINED_REPORT.md`
- Strategy: `Mingla_Artifacts/MINGLA_BUSINESS_MARKETING_HUB_STRATEGY.md`
- Infrastructure gap: `Mingla_Artifacts/MARKETING_HUB_INFRASTRUCTURE_GAP_ANALYSIS.md`
- Phase A schema: `supabase/migrations/20260602000003_orch_0815_marketing_hub_phase_a.sql`
- Phase A cron: `supabase/migrations/20260603000000_orch_0815_b_marketing_send_cron.sql`
- Marketing dispatcher: `supabase/functions/marketing-send/index.ts`
- Mingla-bespoke rules: `feedback_keyboard_never_blocks_input.md`, `feedback_rn_sub_sheet_must_render_inside_parent.md`, `feedback_rn_color_formats.md`, `feedback_toast_needs_absolute_wrap.md`, `feedback_back_listener_disarm_pattern.md`, `feedback_rls_returning_owner_gap.md`, `feedback_zustand_persist_no_server_snapshots.md`, `feedback_implementor_uses_ui_ux_pro_max.md`, `feedback_rn_scrollview_flex_grow_default_one_silent_footgun.md`, `feedback_supabase_neq_null.md`, `feedback_strict_grep_registry_pattern.md`
- Process gates: `feedback_one_pr_per_close.md` (single PR per CLOSE), ORCH-0840 [Regression-test enforcement + append-only CI] Step 0.5 (T-04 + T-08 satisfy)

---

## 23. Working Tree

`/Users/sethogieva/Desktop/mingla-main` on branch `Seth`. Per DEC-135 / I-PROPOSED-AC override 2026-05-11, all work runs in shared `Seth` working tree.
