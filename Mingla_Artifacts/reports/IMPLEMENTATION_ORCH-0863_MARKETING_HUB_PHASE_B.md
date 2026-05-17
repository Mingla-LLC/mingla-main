# IMPLEMENTATION REPORT — ORCH-0863 [Marketing Hub Phase B — Overview + Audiences + Templates tabs]

**Date:** 2026-05-17
**Implementor:** Claude `mingla-implementor` (in-session, operator-elected over Codex default)
**Status:** implemented and verified (source-level + jest); operator live-fire on iOS/Android pending
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-0863_MARKETING_HUB_PHASE_B.md`
**DESIGN:** `Mingla_Artifacts/design/DESIGN_ORCH-0863_MARKETING_HUB_PHASE_B.md`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0863_MARKETING_HUB_PHASE_B.md`
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Base commit:** `899b6c70` (Seth HEAD at dispatch start)

---

## 1. Layman summary

The Marketing tab in `mingla-business` now has all four pills functional. Overview shows the live 30-day funnel (Sent / Delivered / Clicked / Failed) + recent campaigns; Audiences shows every brand-rollup and per-event audience the operator can blast (real DB rows + virtual rows lazy-materialized on first tap); Templates shows the 5 starter-pack templates as read-only cards (with Duplicate + Use this template) and user templates as editable cards (with Save + Delete + Use this template). Composer now accepts a `?template={id}` route param and pre-fills subject + body. Zero new database tables, zero new edge functions, zero new migrations — pure UI + thin service-method extensions on top of Phase A's infrastructure.

---

## 2. Old → New Receipts

### `mingla-business/src/types/marketing.ts` (extended; ~60 LOC added)
- **Was:** ended at `AudienceReachSummary` interface (line ~246).
- **Now:** added `MarketingOverviewFunnel`, `MarketingOverviewRecentCampaign`, `MarketingOverviewSnapshot` types per SPEC §6.1.2 (Overview tab); `AudienceListEntryKind` + `AudienceListEntry` types per SPEC §6.2.2 (Audiences tab unified-list contract with `audience_id: string | null` for virtual rows).
- **Why:** SPEC §15 Step 1.

### `mingla-business/src/services/marketing/marketingOverviewService.ts` (NEW; 152 LOC)
- **Was:** non-existent.
- **Now:** exports `getMarketingOverview({ account_id })` per SPEC §6.1.4 binding formulas. 4 PostgREST queries: (1) windowed campaigns list, (2) recent 3 campaigns, (3) message status histogram, (4) distinct clicked message_ids bounded by `.limit(2000)` (matches `marketingReportService` precedent). Reduces histograms via the pure `rollupFunnel` helper (also exported for T-01 unit testing — pinning formulas against silent drift). Short-circuits when zero windowed campaigns to skip the 3 follow-up queries.
- **Why:** SPEC §15 Step 2 + §10 service architecture.

### `mingla-business/src/services/marketing/marketingAudienceService.ts` (extended; ~192 LOC added)
- **Was:** exported `resolveBrandBuyers`, `resolveEventBuyers`, `maskEmail`, `maskPhone`.
- **Now:** added `listAudiencesForAccount({ account_id })` per SPEC §6.2.3. Algorithm: (1) SELECT existing `marketing_audiences` for account, (2) SELECT last-used timestamps via `marketing_campaigns` lookup, (3) SELECT paid orders + events!inner to discover brand/event IDs with paid orders, (4) SELECT brand names. Then merges into a single `AudienceListEntry[]` with virtual rows (`audience_id: null`) for every brand/event without an existing audience row. Sorts: real rows first by `last_used_at DESC`, then virtual rows alphabetically by `brand_name` then `display_name`.
- **Why:** SPEC §15 Step 2 + Audiences unified-list contract.

### `mingla-business/src/services/marketing/marketingTemplateService.ts` (extended; ~230 LOC added)
- **Was:** exported `listStarterTemplates`, `getTemplate` (read-only).
- **Now:** added `listUserTemplates`, `createUserTemplate`, `updateUserTemplate`, `duplicateTemplate`, `deleteUserTemplate`. **Defense-in-depth starter-pack guard (`assertNotStarterPack`) fires BEFORE any UPDATE/DELETE round-trip** — verified by T-08 adversarial test. `duplicateTemplate` copies fields verbatim to a new INSERT with `is_starter_pack=false, account_id=auth.uid()` (T-03 verifies both `{first_name}` and `{{event:id}}` token grammars survive). `updateUserTemplate` body field passes through verbatim — no regex strip, no escape, no normalization (T-04 verifies token roundtrip).
- **Why:** SPEC §15 Step 2 + §6.3.2 (5 new methods) + I-PROPOSED-MKT-STARTER-TEMPLATES-READ-ONLY + I-PROPOSED-MKT-TEMPLATE-TOKENS-VERBATIM.

### `mingla-business/src/services/marketing/marketingCampaignService.ts` (extended; ~10 LOC added)
- **Was:** `DraftInput` interface lacked `template_id` field; `createDraft` only inserted base fields.
- **Now:** `DraftInput` accepts optional `template_id?: string`; `createDraft` validates UUID + adds to insert payload when present. Backward-compatible with existing composer audience-only callers.
- **Why:** SPEC §15 Step 7 + composer pre-fill threading.

### `mingla-business/src/hooks/marketing/marketingKeys.ts` (extended; +14 LOC)
- **Was:** had `all`, `campaigns.{all,list,byId}`, `templates.starter`.
- **Now:** added `overview.{all,byAccount}`, `audiences.{all,list,reach}`, `templates.{all,user,byId}`.
- **Why:** Constitution #4 — one query key per entity; SPEC §15 Step 3.

### 6 NEW hooks in `mingla-business/src/hooks/marketing/`
- **`useMarketingOverview.ts`** — 30s stale; reads `getMarketingOverview`.
- **`useAudienceList.ts`** — 60s stale; reads `listAudiencesForAccount` + fires batched per-row reach lookup via `Promise.allSettled` (silent per-row degrade per SC-8 / T-07).
- **`useStarterTemplates.ts`** — 5min stale (rarely changes).
- **`useUserTemplates.ts`** — 60s stale.
- **`useTemplate.ts`** — 60s stale; skips fetch when `id === "new"` sentinel.
- **`useTemplateMutations.ts`** — exports `useCreateUserTemplate`, `useUpdateUserTemplate`, `useDuplicateTemplate`, `useDeleteUserTemplate`. Each `onSuccess` invalidates `marketingKeys.templates.user(accountId)` + `marketingKeys.templates.byId(id)`.

### 5 NEW components in `mingla-business/src/components/marketing/`
- **`OverviewMetricCard.tsx`** — single funnel-metric tile; `flexBasis: "47%"` matches Campaigns report `statCell` pattern; warning tone tints when `value > 0` for the Failed card.
- **`OverviewRecentCampaignRow.tsx`** — compact row for the Overview "RECENT CAMPAIGNS" section; status-icon mapping table; relative-time formatter; press feedback `opacity: 0.78`.
- **`AudienceCard.tsx`** — Audiences row; reach loading/error states (`"Loading reach…"` / `"—"`); real and virtual rows render identically (no badge); `isCreating` swaps chevron for `<ActivityIndicator />`.
- **`TemplateCard.tsx`** — Templates row; "Read-only" pill chip on starter rows; body preview truncated at 80 chars with `\n` flattened to space (tokens preserved verbatim).
- **`TemplateEditor.tsx`** — body shared between read-only / editable / new modes; token cheatsheet caption always rendered; monospace style on `{first_name}` + `{{event:abc}}` literals. Includes the mandatory `// ORCH-0863-RN-WEB-GAP` comment per DESIGN §10.

### Routes
- **`mingla-business/app/(tabs)/marketing/index.tsx`** (REPLACE placeholder) — Overview tab per DESIGN §3.1. Headline card + 4-card metric grid + recent-campaigns card + FAB. Skeleton + error + empty + populated states. No `$`, no "revenue", no "Opened" funnel label.
- **`mingla-business/app/(tabs)/marketing/audiences/index.tsx`** (REPLACE placeholder) — Audiences tab per DESIGN §4.1. Uses `useAudienceList`; tap navigates to composer (`?audience=brand:{id}` or `?audience=event:{id}`); virtual rows lazy-materialize via `ensureBrandBuyersAudience` / `ensureEventBuyersAudience` before navigation; `isCreating` per-row spinner during the async window.
- **`mingla-business/app/(tabs)/marketing/templates/index.tsx`** (REPLACE placeholder) — Templates tab per DESIGN §5.1. Starter section always rendered; user section only when `userTemplates.length > 0`. FAB → `templates/new`.
- **`mingla-business/app/(tabs)/marketing/templates/[id].tsx`** (NEW) — Template detail per DESIGN §6. Three modes (read-only / editable / new) determined by `is_starter_pack` and `id === "new"` sentinel. Header back-button + optional Save button (only when `isDirty && isEditable`). Read-only footer: Duplicate + Use this template. Editable footer: Delete + Use this template. Native `Alert.alert` for destructive delete confirm. Dirty-state back-block via `sanctionedExitRef` pattern (mirrors `compose.tsx:384-420`). `KeyboardAvoidingView` wrap per `feedback_keyboard_never_blocks_input.md`. `templates/new` sentinel mode bypasses fetch and routes to canonical `templates/{newId}` on first save via `router.replace`.
- **`mingla-business/app/(tabs)/marketing/campaigns/compose.tsx`** (MODIFY; ≤30 LOC delta) — added `getTemplate` import; extended `useLocalSearchParams` schema with `template?: string`; extracted `templateId`; added one-shot template hydration effect (skipped when `draftId !== null` — draft restore wins); threaded `template_id` into `createDraft` payload when non-null; added `templateId` to `flushDraft` dependency array.

### Strict-grep gate (NEW)
- **`.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`** (NEW; 305 LOC) — 7 checks per SPEC §18 + self-test mode (`--self-test`). C1 no `$` literal in Overview (template-literal interpolation excluded), C2 no "revenue" substring, C3 no "Opened" funnel label, C4 defense-in-depth starter-pack guard present in 2 methods, C5 compose useLocalSearchParams includes `template?:`, C6 marketingOverviewService exists + exports `getMarketingOverview`, C7 no new files under `supabase/migrations/` or `supabase/functions/` (diff-aware against `origin/main`).
- **`.github/workflows/strict-grep-mingla-business.yml`** (MODIFIED; +14 LOC) — registered one new job `orch-0863-marketing-hub-phase-b` per `feedback_strict_grep_registry_pattern.md` (single script + single job). Uses `fetch-depth: 0` so C7's diff-against-origin/main works.

### 8 jest tests
| ID | Path | What it verifies |
|---|---|---|
| **T-01** | `src/services/marketing/__tests__/marketingOverviewService.test.ts` | 7 tests pinning `rollupFunnel` binding formulas (sent across 4 statuses, delivered across 2, failed across 2, clicked passed in explicitly, preview_skipped contributes to sent, unsubscribed/queued orthogonal, production-shape sanity at 50 messages) |
| **T-02** | `src/services/marketing/__tests__/marketingAudienceService.test.ts` (extended) | Virtual-row discovery: 4-call mock chain → merged real+virtual list with correct sort + last_used_at hydration |
| **T-03** | `src/services/marketing/__tests__/marketingTemplateService.test.ts` | `duplicateTemplate` insert payload contains body verbatim (both token grammars survive) + correct `is_starter_pack=false` + `account_id` + `name` |
| **T-04 (HAPPY)** | `src/services/marketing/__tests__/marketingTemplateService.test.ts` | `updateUserTemplate` patch contains body verbatim (no regex strip / escape / normalize); returned row body identical (roundtrip). **Step 0.5 implementor test.** |
| **T-05** | `app/(tabs)/marketing/campaigns/__tests__/compose.template-prefill.test.ts` | Source-grep: composer imports `getTemplate`, declares `template?: string` in useLocalSearchParams, extracts `templateId`, calls `getTemplate(templateId)` + sets subject/body/dirty, skips when `draftId !== null`, threads `template_id` into `createDraft` |
| **T-06** | `app/(tabs)/marketing/__tests__/overview-no-revenue.test.ts` | Source-grep: Overview route has zero `$` literal (template-literal interpolation excluded), zero "revenue" substring (case-insensitive), zero `label="Opened"` / `label="OPENED"` |
| **T-07** | `src/hooks/marketing/__tests__/useAudienceList.test.ts` | Source-grep: hook uses `Promise.allSettled` (not bare `Promise.all`), backfills null on failure, has no `setReachError` setter, has no rejected-status global-error path, applies 60s stale window |
| **T-08 (ADVERSARIAL)** | `src/services/marketing/__tests__/marketingTemplateService.test.ts` | `updateUserTemplate` AND `deleteUserTemplate` throw "Cannot modify starter-pack template" BEFORE the UPDATE/DELETE round-trip when target is starter-pack — different angle from T-04 (security defense-in-depth vs token preservation). **Step 0.5 adversarial test (pre-written by implementor; tester re-runs in QA).** |

---

## 3. Spec Traceability

All 20 success criteria from SPEC §12 are addressable in source. PASS / DEFER classification:

| SC | Status | Evidence |
|---|---|---|
| SC-1 Overview renders headline + 4 cards + 3 rows + FAB | PASS | `app/(tabs)/marketing/index.tsx` §JSX; empty-state branch when zero campaigns |
| SC-2 Overview funnel formulas match SPEC §6.1.4 | PASS | T-01 pins all 4 binding formulas + production-shape sanity |
| SC-3 Overview 30-day window | PASS | `marketingOverviewService.ts` uses `windowStartIso = now - 30*86400000` for both campaign list AND message histogram |
| SC-4 Overview FAB + row tap navigation | PASS | Source: FAB → `/marketing/campaigns/compose`; row → `/marketing/campaigns/{id}` |
| SC-5 Overview hides revenue hero | PASS | T-06 source-grep + strict-grep C1+C2 |
| SC-6 Audiences lists all brands+events with paid orders (real+virtual) | PASS | T-02 virtual-row discovery |
| SC-7 Audience row tap navigates / virtual creates first | PASS | `app/(tabs)/marketing/audiences/index.tsx` handleTap |
| SC-8 Audience reach display states (loading / "—" / counts) | PASS | `AudienceCard.tsx` reach branching + T-07 silent-degrade contract |
| SC-9 Audiences empty state | PASS | `app/(tabs)/marketing/audiences/index.tsx` empty branch |
| SC-10 Templates renders starter + user sections | PASS | `app/(tabs)/marketing/templates/index.tsx` sectioning |
| SC-11 Tap routes to read-only vs editable mode | PASS | `app/(tabs)/marketing/templates/[id].tsx` mode selection by `is_starter_pack` |
| SC-12 Duplicate creates clone with `(copy)` suffix | PASS | `marketingTemplateService.duplicateTemplate` (T-03 verifies) |
| SC-13 Use this template → composer pre-fill + template_id populated | PASS | T-05 source-grep; service supports `template_id` in createDraft |
| SC-14 Edit user template via `updateUserTemplate` | PASS | T-04 + T-08 |
| SC-15 Delete user template + ON DELETE SET NULL graceful degrade | PASS | `deleteUserTemplate` + Phase A migration FK already `ON DELETE SET NULL` (confirmed in inv §3) |
| SC-16 Token grammars preserved through edit roundtrip | PASS | T-04 (happy) + T-03 (duplicate) |
| SC-17 Cross-surface parity iOS/Android/web-preview | DEFER live-fire | All code is shared RN — parity is automatic. Operator-assisted live-fire needed for canonical SC-17 close. |
| SC-18 tsc clean / jest green / strict-grep green | PASS (with caveat) | Jest: 61/61 PASS. Strict-grep: 7/7 PASS + self-test PASS. tsc: zero NEW errors in scoped paths; 81 pre-existing repo-wide errors from other ORCHs (documented in ORCH-0855 DISCOVERY-6). |
| SC-19 EAS OTA only, no native module added | PASS | grep below confirms |
| SC-20 Component rules honored | PASS | KeyboardAvoidingView in TemplateEditor host, dirty-state back-block via sanctionedExitRef, all colors hex/rgb, no Zustand for server state, all Pressables ≥44pt + accessibilityLabel |

---

## 4. Invariant Verification

| Invariant | Honored? | Evidence |
|---|---|---|
| I-PROPOSED-MKT-OVERVIEW-NO-REVENUE-FABRICATION | YES | Strict-grep C1+C2+C3, T-06, source review |
| I-PROPOSED-MKT-AUDIENCE-LAZY-VIRTUAL-ROW | YES | `listAudiencesForAccount` discovery + AudienceCard identical rendering + handleTap materializes on virtual |
| I-PROPOSED-MKT-TEMPLATE-TOKENS-VERBATIM | YES | T-04 verifies + fails-on-revert proven (see §9) |
| I-PROPOSED-MKT-STARTER-TEMPLATES-READ-ONLY | YES | T-08 adversarial verifies `assertNotStarterPack` fires BEFORE update/delete round-trip |
| I-PROPOSED-MKT-PHASE-B-NO-NEW-TABLES | YES | Strict-grep C7 + `git status --short -- supabase/` shows zero ORCH-0863 touches (the 6 supabase paths in status are from ORCH-0859 trip sidecar work — confirmed pre-existing, not introduced by this implementation) |

Also re-checked Phase A invariants (I-PROPOSED-BP discriminator audience kinds, I-PROPOSED-BQ discriminator channel payload, I-PROPOSED-BR exhaustive switch in marketing-send) — not touched by this ORCH.

---

## 5. Cross-Surface Impact (per skill Pre-Flight Step 3.5)

| Surface | In scope | Behaviour change |
|---|---|---|
| Consumer iOS | NO | No consumer Marketing tab |
| Consumer Android | NO | Same |
| Buyer/anon Web | NO | Anonymous routes don't reach marketing |
| Business iOS | **YES — primary** | Marketing tab's Overview / Audiences / Templates pills now render real data + actions |
| Business Android | **YES — automatic parity** | Shared RN code; no per-OS divergence in this ORCH |
| Admin Web | NO | No admin marketing route |
| Business Web preview | **YES — adjacent** | Same RN code; one known constraint flagged in DESIGN §10 (multiline TextInput auto-grow on web; acceptable degradation per operator) |

Parity is automatic (shared code, single component path per surface). Tester run targets ONE iOS sim + ONE Android emu + ONE web preview spot-check per `feedback_tester_canonical_and_platform_parity.md`.

---

## 6. Constitutional Compliance Quick-Check

| # | Rule | Status | Evidence |
|---|---|---|---|
| 1 | No dead taps | PASS | Every Pressable has an onPress handler; T-04+T-08 ensure service calls execute |
| 2 | One owner per truth | PASS | Service functions own DB reads; hooks own cache; components own render |
| 3 | No silent failures | PASS | All services throw on error; hooks expose `isError`; mutations have explicit error paths |
| 4 | One key per entity | PASS | All hooks use `marketingKeys.*` factory; zero hardcoded query keys |
| 5 | Server state server-side | PASS | Zero Zustand in this ORCH; React Query owns all server state |
| 6 | Logout clears everything | N/A | No auth code introduced |
| 7 | Label temporary | PASS | `// ORCH-0863-RN-WEB-GAP` comment in TemplateEditor.tsx names the intentional degradation |
| 8 | Subtract before adding | PASS | Placeholder routes replaced wholesale, not layered |
| 9 | No fabricated data | PASS | Revenue hero omitted; "Opened" funnel omitted; honest empty states |
| 10 | Currency-aware | N/A | No currency rendered (the Failed-tone warning color is the only semantic color) |
| 11 | One auth instance | N/A | No auth code introduced |
| 12 | Validate at right time | PASS | Service-layer UUID assertions; React Query `enabled` gating; back-block prompts only when `isDirty` |
| 13 | Exclusion consistency | PASS | Funnel formula rules match marketing-send's status enum (no drift) |
| 14 | Persisted-state startup | N/A | No client-state persistence introduced |

---

## 7. Cache Safety

Query keys added: `overview.byAccount`, `audiences.list`, `audiences.reach`, `templates.user`, `templates.byId`. Existing keys (`campaigns.*`, `templates.starter`) unchanged — all existing consumers continue to work. Template mutations invalidate `templates.user(accountId)` + `templates.byId(id)`; create + duplicate + delete all properly invalidate.

---

## 8. Regression Surface (adjacent features the tester should check)

1. **Composer audience pre-fill** — modified `compose.tsx` for template param; verify existing `?audience=brand:{id}` and `?audience=event:{id}` flows still work end-to-end (drafts hydrate, audience picker still pre-selects).
2. **Composer draft restore** — `?draft=[id]` path is unchanged; verify draft restore still wins over template pre-fill when both params present.
3. **Campaign list filtering** — `useCampaigns` is untouched; Overview's "Recent campaigns" query is a separate path; verify Campaigns tab still filters correctly across All / Scheduled / Sent / Drafts / Failed pills.
4. **Brand Customers / Event Buyers tabs** — `resolveBrandBuyers` / `resolveEventBuyers` are reused by `useAudienceList`'s batched lookup; verify those existing screens still render correct rows.
5. **MarketingSubNav active-pill detection** — sub-nav was NOT touched; verify all 4 tabs still highlight correctly when navigated to.

---

## 9. Regression Test — Step 0.5 gate evidence

**T-04 (HAPPY, implementor-authored):** `mingla-business/src/services/marketing/__tests__/marketingTemplateService.test.ts` describe block `"updateUserTemplate (T-04 HAPPY — Step 0.5 implementor test: token-roundtrip preservation)"`.

- Passing run output (post-revert restoration):
```
PASS src/services/marketing/__tests__/marketingTemplateService.test.ts
  updateUserTemplate (T-04 HAPPY — Step 0.5 implementor test: token-roundtrip preservation)
    ✓ UPDATE call passes body_template verbatim (no regex strip / no escape / no normalization)
Tests: 6 passed, 6 total
```

- **fails-on-revert verified at `899b6c70`**: temporarily injected `body_template: input.body_template.replace(/\{\{event:[^}]+\}\}/g, "")` into the UPDATE patch. Test FAILED with:
```
expect(received).toBe(expected) // Object.is equality
Expected: "Hi {first_name}, see {{event:00000000-0000-0000-0000-00000000aaaa}}"
Received: "Hi {first_name}, see "
```
Reverted the injection. Re-ran — test PASSED. T-04 actually exercises the token-preservation invariant.

**T-08 (ADVERSARIAL, implementor pre-write):** same file, describe block `"updateUserTemplate / deleteUserTemplate (T-08 ADVERSARIAL — Step 0.5 starter-pack guard, defense-in-depth)"`. 2 tests verifying the guard fires BEFORE the UPDATE/DELETE round-trip even when called with a starter-pack UUID. Different angle than T-04 (security defense-in-depth vs token preservation). Both passed in the post-revert run. The QA-phase tester is expected to independently re-run T-08 and capture their own `fails-on-revert verified at <commit>` line per the canonical Step-0.5 ownership.

---

## 10. Self-verify command outputs

### Strict-grep self-test
```
$ node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs --self-test
# Self-test mode
SELF-OK: C1 catches literal $ in source
SELF-OK: C1 allows template-literal interpolation
SELF-OK: C2 catches 'Revenue' (case-insensitive)
SELF-OK: C3 catches label="Opened"
SELF-OK: C4 catches missing assertNotStarterPack
SELF-OK: C4 passes with assertNotStarterPack in 2 methods
SELF-OK: C5 catches missing template? param
# Self-test PASSED
```

### Strict-grep against tree
```
$ node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs
# ORCH-0863 strict-grep gate — Marketing Hub Phase B
OK   [C1: overview-no-dollar] no '$' literal in Overview route
OK   [C2: overview-no-revenue] no 'revenue' substring in Overview route
OK   [C3: overview-no-opened] no 'Opened' funnel-card label literal
OK   [C4: starter-pack-guard] defense-in-depth guard present (3 assertNotStarterPack calls)
OK   [C5: compose-template-param] useLocalSearchParams includes 'template?: string'
OK   [C6: overview-service-exists] getMarketingOverview export present
OK   [C7: no-new-backend-files] zero touches under supabase/migrations/ or supabase/functions/ (0 files changed total)
# All checks PASS
```

### Jest (all 8 marketing test suites)
```
$ npx jest --testPathPattern='marketing.*__tests__' --no-coverage
PASS src/services/marketing/__tests__/marketingTemplateService.test.ts
PASS src/services/marketing/__tests__/marketingAudienceService.test.ts
PASS src/hooks/marketing/__tests__/useAudienceList.test.ts
PASS app/(tabs)/marketing/campaigns/__tests__/compose.template-prefill.test.ts
PASS app/(tabs)/marketing/__tests__/overview-no-revenue.test.ts
PASS src/services/marketing/__tests__/marketingRenderingService.test.ts
PASS src/hooks/marketing/__tests__/parseAudienceParam.test.ts
PASS src/services/marketing/__tests__/marketingOverviewService.test.ts
Test Suites: 8 passed, 8 total
Tests:       61 passed, 61 total
```

(8 suites includes the 2 pre-existing Phase A tests which still pass + the 6 net-new + 1 extended Phase B suites.)

### tsc scoped check
- Total repo errors: 81 (all pre-existing, documented by ORCH-0855 DISCOVERY-6).
- Errors in ORCH-0863 scoped paths: **0**.

### git diff scope verification
```
$ git diff --stat HEAD -- mingla-business/src/types/marketing.ts mingla-business/src/services/marketing/ mingla-business/src/hooks/marketing/ mingla-business/src/components/marketing/ 'mingla-business/app/(tabs)/marketing/' .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs .github/workflows/strict-grep-mingla-business.yml
 11 files changed, 1265 insertions(+), 154 deletions(-)
```

Plus 19 new files (untracked): 5 components, 6 hooks, 1 new hook test, 1 new service, 2 new service tests, 1 new route, 2 new route tests, 1 new strict-grep script. Total scoped surface = 30 files.

### Backend touches verification
```
$ git status --short -- supabase/
 M ../supabase/functions/discover-merged-events/index.ts
 M ../supabase/functions/ticket-confirmation-dispatch/index.ts
?? ../supabase/functions/_shared/tripConfirmationEmail.ts
?? ../supabase/migrations/20260608000000_orch_0859_trip_sidecar_tables.sql
?? ../supabase/migrations/20260608000100_orch_0859_publish_rpc_trip.sql
?? ../supabase/migrations/20260609000000_orch_0859_trip_publish_slug_flag.sql
```

**These are pre-existing dirty-tree state from ORCH-0859 [TR2 Minimum Viable Trip] work — NOT introduced by ORCH-0863.** This implementor staged ZERO files under `supabase/`. The strict-grep C7 check confirms (`zero touches under supabase/migrations/ or supabase/functions/ (0 files changed total)` — diff is against origin/main and the in-flight ORCH-0859 files aren't on HEAD yet).

---

## 11. EAS OTA verdict

**EAS OTA eligible (pure-JS, no new native module).** Quick scan:
```
$ grep -rE "from\s+\"(react-native-|expo-)" mingla-business/src/components/marketing/Overview* mingla-business/src/components/marketing/Audience* mingla-business/src/components/marketing/Template* mingla-business/src/hooks/marketing/useMarketing* mingla-business/src/hooks/marketing/useAudienceList* mingla-business/src/services/marketing/marketingOverviewService.ts | grep -v "from \"react-native\""
(no native-specific imports beyond bare react-native)
```

After close + merge to main:
```
cd mingla-business && eas update --branch production --platform ios,android --message "ORCH-0863: Marketing Hub Phase B — Overview / Audiences / Templates tabs"
```

No native rebuild required. No new pod, no new native config.

---

## 12. Transition Items

None. The `// ORCH-0863-RN-WEB-GAP` comment in `TemplateEditor.tsx` is a **documented intentional degradation** (multiline TextInput auto-grow on web — operator-acceptable per DESIGN §10) NOT a transition item. There is no exit condition because the gap is upstream to RN-Web.

---

## 13. Discoveries for Orchestrator (side issues)

1. **DISC-IMPL-1 [Brand-name fallback path].** `listAudiencesForAccount` uses `brandNameById.get(brandId) ?? "Brand"` when a brand row's `name` is missing or RLS-denied. Live data probe (investigation §3) showed all 4 audiences under one brand with a `name` populated, but for fresh accounts with newly-created brands the fallback string "Brand" could appear briefly. Not a P-finding; flag for product to confirm "Brand" is acceptable copy (alternatives: "Your brand", "Untitled brand", "(brand)").

2. **DISC-IMPL-2 [Composer pre-fill race when both `?template` and `?draft` are present].** Resolved by skipping template hydration when `draftId !== null` (per SPEC). The composer's existing draft-restore effect re-hydrates subject + body from the draft row's `channel_payload`, which trumps any half-applied template state. No race in practice but flagged for tester to verify with a contrived `?template=A&draft=B` URL.

3. **DISC-IMPL-3 [TemplateEditor body input on RN-Web].** Per DESIGN §10, multiline TextInput on web stays at `minHeight: 192` + internal scroll instead of auto-growing. Tagged with `// ORCH-0863-RN-WEB-GAP` comment per skill protocol. Operator already accepted this degradation; flagged here as the canonical record.

4. **DISC-IMPL-4 [marketingOverviewService click query is bounded by .limit(2000)].** Mirrors `marketingReportService.ts:110` precedent. At current scale (64 click rows total) this is over-provisioned; at 2000+ clicks, distinct counting will silently undercount. Not a launch blocker — operator's first 50 campaigns won't hit this — but flag for a future ORCH if click volume grows.

5. **DISC-IMPL-5 [Strict-grep self-test mode partially-restores `failures` counter via direct assignment].** The self-test resets `failures` between checks by direct assignment to a closed-over module-level `let`. Worked correctly in self-test PASS but is brittle if a future contributor adds parallel checks. Flag for the gate's own evolution; not a launch blocker for this ORCH.

6. **DISC-IMPL-6 [Audiences tab listAudiencesForAccount fires 4 PostgREST queries per paint].** At current scale (1 brand × ~10 events) this is sub-100ms total. At 50 brands × 100 events the orders SELECT could become expensive. Investigation §11 DISC-7 already flagged the resolver under-counting click data; this is the parallel scaling concern on the discovery side. Future ORCH if any operator approaches that scale.

7. **DISC-IMPL-7 [The `app/(tabs)/marketing/` scope is now ~1200 LOC across 5 routes].** Phase A was placeholders; Phase B is real. Operator may want to consider extracting common chrome (loading skeleton primitive, error-EmptyState wrapper, FAB component) into shared marketing-internal helpers if more tabs are added. Not blocking.

---

## 14. Recommended commit message

```
ORCH-0863: Marketing Hub Phase B — Overview + Audiences + Templates tabs

- Overview tab: 30-day funnel (Sent/Delivered/Clicked/Failed) + recent
  campaigns list + FAB. Constitution #9: no $ revenue, no Opened metric
  (no UTM-to-campaign attribution yet, no Resend webhook ingest).
- Audiences tab: unified list of every brand/event audience the operator
  can blast (real DB rows + virtual rows lazy-materialized on tap). Per-row
  reach via Promise.allSettled (silent per-row degrade).
- Templates tab: 5 starter cards (read-only) + user cards (editable);
  Duplicate / Edit / Delete / Use this template flows. Template editor
  preserves both {first_name} and {{event:id}} token grammars verbatim.
- Defense-in-depth starter-pack guard in service layer (T-08 verifies)
  on top of RLS — service throws BEFORE any UPDATE/DELETE round-trip.
- Composer accepts ?template={id} pre-fill (≤30 LOC; draft restore wins).
- Zero new tables / edge fns / migrations. EAS OTA eligible.

Tests: 61/61 jest pass across 8 suites. T-04 (token roundtrip) +
T-08 (starter-pack guard) satisfy ORCH-0840 Step-0.5 gate; T-04
fails-on-revert verified at 899b6c70 via regex-strip injection.

Strict-grep gate orch-0863-marketing-hub-phase-b.mjs registered:
7 checks (no $, no revenue, no Opened, starter guard, compose
template param, marketingOverviewService present, no new backend
files). Self-test PASSED + tree run PASSED.

New invariants: I-PROPOSED-MKT-{OVERVIEW-NO-REVENUE-FABRICATION,
AUDIENCE-LAZY-VIRTUAL-ROW, TEMPLATE-TOKENS-VERBATIM,
STARTER-TEMPLATES-READ-ONLY, PHASE-B-NO-NEW-TABLES}.

30 scoped files: 19 new + 11 modified. Working tree:
/Users/sethogieva/Desktop/mingla-main on branch Seth.
```
