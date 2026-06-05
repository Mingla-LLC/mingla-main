# SPEC — META-ORCH-1073 Sub-A — Global Search Sheet (Phase 1)

**ORCH:** META-ORCH-1073 Sub-A — "Global search sheet (Phase 1)" — Mingla Business app.
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-1073-Sub-A-[global-search-sheet]/` on branch `META-ORCH-1073-Sub-A-global-search-sheet`.
**Mode:** SPEC (greenfield UI feature — contracts, scope, layers, success criteria, invariants, regression plan). No product code in this document.
**Author:** mingla-forensics (Claude), 2026-06-04.
**Inputs read:** `Mingla_Artifacts/META-ORCH-1073_BUSINESS_SEARCH_SYSTEM_SHARED_UNDERSTANDING.md` (DECIDED section is binding); `mingla-business/src/components/ui/TopBar.tsx`; `CommandPalette.web.tsx` + `useCommandPaletteState.ts`; `businessEvents.ts`, `tripsService.ts`, `experiencesService.ts`; hub list hooks (`useBusinessEvents.ts`, `useTrips.ts`, `useExperiencesByBrand.ts`); the `app/` route tree; `Sheet.tsx`/`Sheet.web.tsx`/`SheetMobile.tsx`; `IconChrome.tsx`, `Icon.tsx`, `Input.variants.ts`, `designSystem.ts`; `useCurrentBrandRole.ts` + `utils/brandRole.ts`.

> **Layman summary.** The magnifying-glass icon already sitting in the Business app's top bar does nothing today. This SPEC defines wiring it up so tapping it opens one search panel that, as you type, instantly finds any of your events, trips, or experiences (by name, description, location, or tags) AND jumps you to any screen or setting by keyword ("refund", "payout", "tax", "invite scanner", "currency", "team"…). Everything searched is data the app already has loaded — no new database work, no network calls. Results are grouped, deep-link straight to the right screen, and respect the user's team role so a scanner never sees an owner-only destination.

---

## 0. COMMS-Ledger acknowledgements

Read `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` on entry. No `BLOCK` + `OPEN` row targets this skill, META-ORCH-1073, or `ALL`. Two `WARN`+`ALL` rows apply but are **N/A for this Phase-1 scope**, recorded here so the implementor/tester inherit the reasoning:

- **COMMS-0002** (strict-grep backend gate on `supabase/functions/**` + migrations): **N/A** — Sub-A is client-only. No edge function, no migration, no `supabase/functions/**` file. No `ORCH_1073_BACKEND_ALLOWLIST` entry needed. If a later sub-ORCH adds backend search, that obligation lands then.
- **COMMS-0003** (external-API integration must cite provider docs URLs inline): **N/A** — no external API/SDK/Postgres-FTS/`pg_trgm`/`tsvector` introduced. The one third-party library leaned on (`cmdk`, web only, already in the tree) is cited in §3.7 / §11. No Stripe/Supabase/OpenAI surface touched.

The implementor and tester MUST append their `skill+side (META-ORCH-1073 Sub-A)` to both rows' `acked_by` with the "N/A — client-only Phase 1" note when they pick up the work.

---

## 1. Scope, Non-Goals, Assumptions

### 1.1 In scope (LOCKED)
1. Wire the existing TopBar search `IconChrome` (`TopBar.tsx:125`, currently `[TRANSITIONAL]`, onPress unwired) to open a **global search sheet**.
2. A **shared client-side search service + index** over the current brand's **cached offerings** — events, trips, experiences — and their text content (title, description, location_text, taxonomy tags).
3. A **static Feature/Settings findability registry** (screens, settings, actions) searchable by label + synonyms.
4. A **single search sheet component** presenting grouped, ranked, deep-linking results, mounted once so it is reachable from every screen rendering the default TopBar cluster.
5. **States:** empty (no query → grouped jump-to suggestions + recent searches), populated, zero-result. Keyboard + a11y + responsive behavior (mobile bottom sheet vs. web dropdown/centred card).
6. **Convergence** of the existing web-only marketing `CommandPalette.web.tsx` onto this surface (verdict + plan in §6).
7. **Role gating** of results via `useCurrentBrandRole().rank` so a result is only shown if the current role can open its destination.
8. **Regression tests** (implementor happy-path + tester adversarial) under `mingla-business/**/__tests__/**`.

### 1.2 Non-Goals (LOCKED — do NOT build)
- **No backend.** No Supabase migration, no edge function, no Postgres FTS / `pg_trgm` / `tsvector` / `biz_global_search` RPC. (Per DECIDED #1. Backend depth is a deferred later sub-ORCH.)
- **No People/PII domain** — buyers, orders' buyer names, comp guests, door sales, team members, scanners, invitations. (Sub-B, later.)
- **No Money domain** — orders, refunds, payouts, amounts, order ids. (Sub-C, later.)
- **No Marketing data domain in the index** — campaigns/audiences/templates as *searchable content rows*. (The marketing **screens** are in the registry as jump-to destinations; their *data rows* are not indexed in Phase 1. The current `CommandPalette` "recent campaigns/audiences/templates" lists are absorbed per §6 convergence verdict.)
- **No per-list search bars** on any list screen. (Sub-D, later.)
- **No new search affordance, no new tab, no ⌘K-only path.** Entry point is the existing TopBar icon only. On web, ⌘K MAY be retained purely as an accelerator that opens the SAME sheet (see §6).
- **No bell-icon wiring** (adjacent, also unwired — explicitly out of scope).
- **No new dependency on native.** `cmdk` stays web-only; native uses RN primitives already present.
- **No recents persistence to a server.** Recent searches are ephemeral client-only state (see §3.5).

### 1.3 Assumptions (stated, not proven beyond cited reads)
- A1. The brand's offerings are small, fully-loaded sets per the DECIDED brief — events via `useBusinessEventsForBrand`, trips via `useTripsByBrand`, experiences via `useExperiencesByBrand`. Search reads these caches; it does **not** fetch. **Risk R-1 (see §12):** local drafts live in Zustand (`draftEventStore`), not React Query — the implementor must decide whether drafts are in Phase-1 index scope (recommended: index server-backed offerings only; drafts deferred).
- A2. `useCurrentBrandRole(brandId).rank` (0/10/20/30/40/50/60 per `utils/brandRole.ts`) is the authoritative client-side role signal and mirrors SQL `biz_role_rank()` (I-32). Role gating is a **UX courtesy layer** — RLS remains the real security boundary; hiding a result is not a security control, it prevents dead-end taps.
- A3. The default TopBar `[search, bell]` cluster renders only on screens passing `leftKind="brand"` (verified: `app/(tabs)/home.tsx`, `app/(tabs)/account.tsx`, `app/(tabs)/hub/_layout.tsx`, `app/(tabs)/marketing/_layout.tsx`, `__styleguide.tsx`, and the two creator wizards). The sheet must be reachable from all of these. **Consequence:** the sheet mounts ONCE at the `(tabs)/_layout.tsx` root and is opened via shared state, NOT mounted per-screen (see §3.4).

---

## 2. Cross-Surface Impact (Phase 2.5 — MANDATORY)

The 5 primary + 2 adjacent shipping surfaces:

| # | Surface | Covered? | Behavior demanded / reason not covered |
|---|---------|----------|----------------------------------------|
| 1 | Consumer iOS (`app-mobile/` iOS) | **NO** | Different app; consumer has its own deck/discovery search. Not in this directive's "mingla business" framing. |
| 2 | Consumer Android (`app-mobile/` Android) | **NO** | Same as #1. |
| 3 | Buyer/anonymous Web (`/b`, `/e`, `/checkout`) | **NO** | Buyer-facing routes don't expose a business owner's private offering index; different concern. |
| 4 | **Business iOS** (`mingla-business/` iOS) | **YES** | TopBar search icon opens a **bottom sheet** (`Sheet` → `SheetMobile`). Full search index + registry. Parity is **manual vs. web** (separate presentation branch) → per-surface SCs. |
| 5 | **Business Android** (`mingla-business/` Android) | **YES** | Identical RN code path to iOS (shared `Sheet`/`SheetMobile`). Parity with iOS is **automatic** (same component); still verified per the tester parity rule. |
| 6 | Admin Web (`mingla-admin/`) | **NO** | Separate app; no operator request; admin doesn't render the business TopBar. |
| 7 | **Business Web preview** (`mingla-business/` web) | **YES (adjacent, in scope)** | TopBar search icon opens a **web dropdown / centred card** (`Sheet.web` → narrow=bottom-sheet, wide-desktop=centred card per ORCH-0885-A). On wide-desktop, ⌘K MAY also open the SAME sheet (convergence, §6). Parity is **manual vs. native** → per-surface SCs. |

**Manual-parity surfaces** (4 native iOS, 5 native Android shared, 7 web separate) → success criteria carry per-surface suffixes `-iOS`, `-Android`, `-Web` where the code path diverges (§4). The **search service + index + registry + ranking + role-gating + result model are 100% shared, platform-agnostic TypeScript** — only the *presentation shell* (sheet vs. dropdown vs. cmdk list) is per-surface. The implementor MUST keep all matching/ranking/gating logic in the shared service so the three shells render identical result sets for identical input.

---

## 3. The Contract — layer by layer

### 3.1 Data model — unified search index & result shape (LOCKED)

A new shared module `mingla-business/src/lib/search/` (or `src/services/search/` — implementor picks one, must be consistent) defines:

**3.1.1 Indexed-item input shapes.** Three adapter functions map cached domain objects → a normalized internal index entry. Adapters live beside the service and are pure.

```
// Normalized index entry (internal — not the rendered result).
interface SearchIndexEntry {
  type: SearchResultType;          // see 3.1.2
  id: string;                      // entity id OR registry key
  title: string;                   // primary display (e.g. event/trip/experience title, or screen label)
  subtitle: string | null;        // secondary display (status • date, location, or registry description)
  route: string;                   // expo-router path the row deep-links to (3.1.4)
  group: SearchGroup;              // section grouping (3.1.3)
  minRank: number;                 // minimum BRAND_ROLE_RANK required to SEE this result (3.6)
  // searchable text — concatenated + normalized at index build; NEVER rendered
  searchText: {
    title: string;                 // weight: highest
    keywords: string[];            // tags / synonyms — weight: high (word-boundary)
    body: string | null;          // description / long text — weight: low (substring)
    location: string | null;       // location_text / address — weight: medium
  };
}
```

**3.1.2 `SearchResultType`** (LOCKED literal union, extensible later):
`"event" | "trip" | "experience" | "screen" | "setting" | "action"`.
(Later phases add `"buyer" | "order" | "campaign" | …` — the union and switch sites MUST be written to fail typecheck when a new member is added, forcing exhaustive handling.)

**3.1.3 `SearchGroup`** (LOCKED — fixed render order):
1. `"offerings"` → heading **"Offerings"** (events + trips + experiences, interleaved, ranked).
2. `"goto"` → heading **"Go to"** (registry `screen` entries — navigable screens).
3. `"settings"` → heading **"Settings & actions"** (registry `setting` + `action` entries).

Group order is fixed: Offerings → Go to → Settings & actions. Within a group, items sort by descending score (§3.3); ties broken by recency for offerings (newest `created_at`/`updatedAt` first), and by registry declaration order for registry items.

**3.1.4 Rendered result shape** (LOCKED — what the row component receives):

```
interface SearchResult {
  type: SearchResultType;
  id: string;
  title: string;
  subtitle: string | null;
  route: string;                   // resolved deep-link
  group: SearchGroup;
  score: number;                   // 0..1, for ordering + (optional) debug
  matchedField: "title" | "keywords" | "location" | "body" | null;
  iconName: IconName;              // leading icon per type (3.6 table)
}
```

**3.1.5 Source caches (read-only; no new fetch).** The index is built from React Query caches already populated by the hub screens:
- Events: `useBusinessEventsForBrand(brandId)` → `LiveEvent[]`. Index `name`→title, `status`+next date→subtitle, `venueName`/`address`→location, `partyTypes`/`vibeTags`/`musicGenres`→keywords, `description`→body. Route `/event/${id}` (read-only/detail; see §3.6 for role-gated edit vs. view).
- Trips: `useTripsByBrand(brandId)` → `Trip[]`. Index `title`, `status`→subtitle, `description`→body. (Trips carry no `location_text` field in the `Trip` interface — location omitted; do NOT fabricate.) Route `/trip/${id}`.
- Experiences: `useExperiencesByBrand(brandId)` → `VenueExperience[]`. Index `title`, `status`→subtitle, `description`→body, intent/tags→keywords if present. Route `/experience/${id}` if such a detail route exists; **R-2 (§12): confirm the experience detail route** — the route tree shows `app/experience/create.tsx` + `coming-soon.tsx` but no `app/experience/[id]/index.tsx`. If no detail route exists, experiences route to the hub experiences tab `/(tabs)/hub/experiences` with the item highlighted, OR are excluded from Phase 1 with an explicit note. Implementor MUST resolve before DESIGN; do not ship a dead tap.

**The search service NEVER calls `supabase` or any service that fetches.** It reads `queryClient.getQueryData(<key>)` via the existing hooks (preferred: call the hooks in the sheet component and pass arrays into the pure index builder, so React Query subscription/refresh semantics are preserved). If a cache is empty (cold start, brand not yet loaded), that domain contributes zero entries — the search still works for whatever is loaded + the registry (which is static and always available).

### 3.2 Matching algorithm (LOCKED)

A single pure function `scoreMatch(query: string, entry: SearchIndexEntry): { score: number; matchedField } | null`.

- **Normalization:** lowercase + diacritic-strip via `String.prototype.normalize("NFD").replace(/[̀-ͯ]/g, "")` applied to BOTH the query and every searchable field, computed once at index build for fields and once per keystroke for the query. (No external search lib for native — pure JS. `cmdk`'s built-in matcher is used ONLY inside the web presentation if convergence keeps cmdk; see §6.)
- **Min query length:** 2 characters (after trim). Below that, the sheet shows the **empty state** (recents + jump-to), NOT zero-result.
- **Debounce:** 120 ms on the query→filter pipeline (the input updates immediately for responsiveness; the expensive filter is debounced). Reduced-motion / test mode may run synchronously.
- **Match tiers + base scores (deterministic):**
  | Tier | Condition (per field, on normalized text) | Base score |
  |------|--------------------------------------------|-----------|
  | Exact | field === query | 1.00 |
  | Prefix | field startsWith query | 0.85 |
  | Word-boundary | a token in field startsWith query (split on `/\s|[-_,/]/`) | 0.70 |
  | Substring | field includes query | 0.50 |
  | Fuzzy (subsequence) | query chars appear in order in field (typo-light) | 0.30 |
  | No match | none | null |
- **Field weights** (multiply the tier base): `title ×1.0`, `keywords ×0.9`, `location ×0.7`, `body ×0.5`. The result's `score` = max over fields; `matchedField` = the field that produced the max.
- **Registry boost:** `screen`/`setting`/`action` entries that match on a **synonym** keyword are treated as word-boundary tier minimum (so "refund" reliably surfaces the orders/refunds screen even though the label is "Orders").
- **Recency tiebreak** (offerings only): when two offering results have equal `score`, the one with the newer `createdAt`/`updatedAt` sorts first.
- **Max results per group:** `offerings` 8, `goto` 6, `settings` 6 (total cap 20). Overflow is dropped silently (no "show more" in Phase 1). The empty state's jump-to suggestions cap at 5 per group.

### 3.3 Service layer (LOCKED)

`mingla-business/src/lib/search/globalSearch.ts` (or chosen dir):
- `buildSearchIndex(args): SearchIndexEntry[]` — pure; args = `{ events, trips, experiences, registry, role }`. Maps each domain via its adapter, concatenates with the static registry, and stamps `minRank`. No I/O, no React.
- `searchIndex(query: string, index: SearchIndexEntry[], opts?): SearchResult[]` — pure; runs `scoreMatch` over the (already role-filtered) index, applies per-group caps + sort, returns grouped-then-flattened results in fixed group order.
- `FEATURE_REGISTRY: SearchRegistryItem[]` — the static array (§3.5).
- All functions fully typed; no `any`, no `@ts-ignore`. Adapters return `[]` for null/empty inputs (never throw).

### 3.4 Hook + state layer (LOCKED)

**3.4.1 Shared open/close + query state.** Reuse the existing Zustand pattern from `useCommandPaletteState.ts`. Create `mingla-business/src/hooks/useGlobalSearchSheet.ts` (Zustand store, ephemeral UI state only — open boolean + query string + recents array). This is the bridge that lets the TopBar icon (rendered inside many sub-trees) open the single sheet mounted at the tabs root.

```
interface GlobalSearchSheetState {
  isOpen: boolean;
  query: string;
  recents: string[];        // last N submitted queries, ephemeral (3.5)
  open: () => void;         // resets query to ""
  close: () => void;        // resets query to ""
  setQuery: (q: string) => void;
  pushRecent: (q: string) => void;  // dedupe + cap at 6, MRU-ordered
}
```
- Allowed under `feedback_zustand_persist_no_server_snapshots` — holds ONLY ephemeral UI state, NOT server data, NOT persisted (same justification as `useCommandPaletteState`). `recents` is in-memory and resets on app restart in Phase 1 (no persistence — see Non-Goal §1.2; persistence is a later sub-ORCH option).

**3.4.2 Index hook.** `useGlobalSearchIndex(): SearchIndexEntry[]` — calls `useCurrentBrand()`, `useCurrentBrandRole(brandId)`, `useBusinessEventsForBrand`, `useTripsByBrand`, `useExperiencesByBrand`, memoizes `buildSearchIndex(...)` on their data + `rank`, and returns the role-filtered index (entries with `minRank > rank` are dropped at this layer so neither presentation shell can leak them). The hook is called ONCE inside the mounted sheet component, not per-TopBar.

### 3.5 Feature/Settings findability registry (LOCKED — deliverable enumeration)

`FEATURE_REGISTRY` — static array of `{ key, type, title, subtitle, route, group, minRank, synonyms[] }`. Routes verified against the `app/` tree. `minRank` uses `BRAND_ROLE_RANK` (scanner 10, marketing_manager 20, finance_manager 30, event_manager 40, brand_admin 50, brand_owner 60). **Brand-scoped routes that need `[id]`** resolve `${brandId}` from `useCurrentBrand()` at index-build time; if no current brand, those entries are dropped (can't deep-link without an id).

**Group `goto` — navigable screens (`type:"screen"`):**

| # | key | title | route | minRank | synonyms |
|---|-----|-------|-------|---------|----------|
| 1 | home | Home | `/(tabs)/home` | 10 | dashboard, start, overview |
| 2 | hub-events | Events | `/(tabs)/hub/events` | 10 | my events, listings, shows |
| 3 | hub-trips | Trips | `/(tabs)/hub/trips` | 10 | tours, getaways, retreats |
| 4 | hub-experiences | Experiences | `/(tabs)/hub/experiences` | 10 | activities, things to do |
| 5 | marketing-overview | Marketing | `/(tabs)/marketing` | 20 | promote, blasts, growth |
| 6 | marketing-campaigns | Campaigns | `/(tabs)/marketing/campaigns` | 20 | email, blast, send |
| 7 | marketing-audiences | Audiences | `/(tabs)/marketing/audiences` | 20 | lists, contacts, segments |
| 8 | marketing-templates | Templates | `/(tabs)/marketing/templates` | 20 | email template, designs |
| 9 | account | Account | `/(tabs)/account` | 10 | profile, me, my account |
| 10 | brand-public-listing | Public page | `/brand/${brandId}/listing` | 20 | public profile, my page, brand page |

**Group `goto` — brand sub-screens (`type:"screen"`):**

| # | key | title | route | minRank | synonyms |
|---|-----|-------|-------|---------|----------|
| 11 | brand-edit | Edit brand | `/brand/${brandId}/edit` | 20 | brand profile, bio, logo, brand name, socials |
| 12 | brand-team | Team | `/brand/${brandId}/team` | 50 | members, staff, invite, roles, permissions |
| 13 | brand-scanners | Scanners | `/brand/${brandId}/scanners` | 40 | invite scanner, door staff, check-in, ticket scanner |
| 14 | brand-audit-log | Audit log | `/brand/${brandId}/audit-log` | 50 | history, activity, changes, log |
| 15 | brand-blasts | Brand blasts | `/brand/${brandId}/blasts` | 20 | brand email, announcements |

**Group `settings` — settings & actions (`type:"setting"` / `type:"action"`):**

| # | key | type | title | route | minRank | synonyms |
|---|-----|------|-------|-------|---------|----------|
| 16 | payments | setting | Payments | `/brand/${brandId}/payments` | 30 | stripe, bank, connect, payout setup, get paid |
| 17 | payments-onboard | action | Set up payouts | `/brand/${brandId}/payments/onboard` | 30 | onboarding, connect stripe, verify bank, payout |
| 18 | payments-reports | setting | Payout reports | `/brand/${brandId}/payments/reports` | 30 | payouts, statements, balance, earnings, reports |
| 19 | pricing-defaults | setting | Pricing defaults | `/brand/${brandId}/pricing-defaults` | 50 | fees, tax, service fee, pass fee, absorb, currency, all-in |
| 20 | tax-registrations | setting | Tax registrations | `/connect-tax-registrations` | 50 | vat, sales tax, tax settings, tax id |
| 21 | account-notifications | setting | Notifications | `/account/notifications` | 10 | push, alerts, email prefs, reminders |
| 22 | account-edit | setting | Edit profile | `/account/edit-profile` | 10 | name, avatar, my profile, photo |
| 23 | account-delete | action | Delete account | `/account/delete` | 60 | close account, remove account, deactivate |
| 24 | create-event | action | Create event | `/event/create` | 40 | new event, add event, build event |
| 25 | create-trip | action | Create trip | `/trip/create` | 40 | new trip, add trip, plan trip |
| 26 | create-experience | action | Create experience | `/experience/create` | 40 | new experience, add experience |
| 27 | connect-account-mgmt | setting | Manage payout account | `/connect-account-management` | 30 | stripe dashboard, update bank, manage account |

**Registry item count: 27** (15 `goto`, 12 `settings`/`actions`). Implementor verifies every `route` resolves against `app/` before merge (the regression test in §10 asserts this). The `subtitle` field for each (one Mingla-voice line, e.g. "Find your refund + tax settings") is authored by the designer in DESIGN; LOCKED requirement = present + accurate, OPEN = exact wording within voice.

> **R-3 (§12):** Synonyms like "refund" map to **Payout reports / Orders area**. In Phase 1 the Money domain (orders/refunds) is out of scope, so "refund" routes to the closest in-scope screen (`payments-reports` or `pricing-defaults`), NOT a per-order view. The orchestrator should rule whether "refund" should instead surface a "(coming in a later update)" affordance vs. routing to payouts. Default: route to `payments-reports` with synonym "refund".

### 3.6 Role gating + per-type icons (LOCKED)

- Every `SearchIndexEntry.minRank` is the minimum `BRAND_ROLE_RANK` to **see** the row. `useGlobalSearchIndex` drops entries where `rank < minRank` BEFORE matching. (Offering entries: `event`/`trip`/`experience` detail-view = `minRank: 10` since any team member who can load the hub can view; the **edit** affordance inside the detail screen remains role-gated by that screen itself — Sub-A routes to the detail/view route, not the edit route, to avoid surfacing edit-only destinations to viewers.)
- A `rank: 0` user (no membership / cold role cache) sees ONLY `minRank: 0` entries — i.e. effectively nothing offering-side and only the universally-safe registry screens explicitly tagged `0` (none are tagged 0 here, so a rank-0 caller sees an empty offerings group + only the lowest-rank registry rows ≥ their rank, which at rank 0 = none). This is the defensive default (§A2). Practically, by the time the TopBar renders, the operator is authenticated with a synthesized `brand_owner` rank 60 for solo operators (`useCurrentBrandRole` fallback), so they see everything they own.

Per-type leading icon (`iconName`, from `Icon.tsx` available names):
| type | iconName |
|------|----------|
| event | `calendar` |
| trip | `calendar` (or a trip-specific glyph if added — OPEN) |
| experience | `sparkle` |
| screen | `arrowR`/`chevR` (navigational) |
| setting | `settings` |
| action | `sparkle` or type-appropriate (OPEN within the existing IconName set) |

### 3.7 Presentation / component layer (LOCKED functional contract; visual contract → DESIGN)

**One new component:** `mingla-business/src/components/ui/GlobalSearchSheet.tsx` (native: iOS/Android) presenting via the canonical `Sheet`/`SheetMobile` bottom-sheet primitive. **Do NOT use `TopSheet`** (restricted consumers per memory `feedback_topsheet_extended_universal_creator.md`). Plus a `.web.tsx` sibling `GlobalSearchSheet.web.tsx` if the web presentation diverges (dropdown/centred card / optional cmdk) — OR a single file that branches on `Platform.OS === "web"` + `useResponsiveLayout().isWideDesktop`. Implementor picks the smaller-surface option; both shells consume the SAME `useGlobalSearchIndex` + `searchIndex` so result sets are identical.

- **Mount point:** ONCE in `app/(tabs)/_layout.tsx` (next to the existing CommandPalette mount), not per-screen. Opening is driven by `useGlobalSearchSheet().isOpen`. This guarantees availability on every screen that renders the default TopBar cluster (§A3) without each screen mounting its own sheet.
- **TopBar wiring:** `DefaultRightSlotInner`'s search `IconChrome` (`TopBar.tsx:125`) gets `onPress={() => useGlobalSearchSheet.getState().open()}` (or a passed handler). The `[TRANSITIONAL]` comment for the search icon is removed; the bell stays `[TRANSITIONAL]` (out of scope). I-37 is honored — this change does NOT add a `rightSlot=` to any `leftKind="brand"` consumer; it edits the shared default cluster internally, so the strict-grep I-37 gate is unaffected.
- **Search input:** reuse `Input` with `variant="search"` (already defines `autoCapitalize:"none"` + `autoCorrect:false` per ORCH-0823). Autofocus on open (native: focus after sheet open animation settles to avoid the keyboard fighting the spring; web: focus immediately). Leading search icon, trailing clear (`close`/`x`) button when query non-empty.
- **Result rows:** `Pressable`, 44pt min height, leading type icon, title (1 line, ellipsized), subtitle (1 line, ellipsized, `text.tertiary`), trailing chevron for navigational rows. `onPress` = close sheet + `pushRecent(query)` + `router.push(result.route)`. Light haptic on native press (`expo-haptics` if already used in the kit — OPEN).
- **Grouping:** section headings in fixed order (§3.1.3) rendered only when the group has ≥1 result. `labelCap` typography, `text.tertiary` (matches existing CommandPalette group heading spec).

**States (all 9 — copy in Mingla voice, finalized by designer; LOCKED = state exists + correct trigger):**
1. **First-time / empty (no query, < 2 chars):** heading "Jump to" + grouped suggestions (top registry screens) + "Recent" (if any recents). NO zero-result text. Copy seed: input placeholder "Search events, trips, settings…".
2. **Loading:** N/A meaningful async (client-side, synchronous after debounce). If any source cache is still fetching on cold start, show a one-line "Loading your stuff…" skeleton row in the Offerings group only; registry is always immediately searchable.
3. **Populated:** grouped results, ranked.
4. **Zero-result (≥ 2 chars, no matches):** "No matches for "<query>"." + up to 3 nearest registry suggestions ("Did you mean: Payments, Pricing defaults?") derived from the fuzzy tier. No dead end.
5. **Submitting:** N/A (no mutation).
6. **Offline:** registry + already-cached offerings still searchable (all client-side); no error. New fetches don't happen, so offline is functionally identical to online for Phase 1.
7. **Returning:** recents shown in empty state.
8. **Degraded (rank 0 / no brand):** offerings empty; registry filtered to caller's rank; sheet still opens and is usable for whatever is permitted; never crashes.
9. **Error:** the pure pipeline cannot throw on valid string input; defensive `try/catch` around `searchIndex` returns `[]` + a single "Something went wrong searching." row rather than crashing the sheet. (Constitution rule 3 — no silent failure: surfaces a visible message.)

**Dismissal:** native = drag-down / scrim tap / hardware back (Android); web = Esc / scrim tap / backdrop. All call `close()` (resets query). `close()` does NOT clear `recents`.

**Visual contract:** This is a UI surface → the granular visual contract (exact tokens for every state in light+dark, typography, spacing on the 4px grid, safe-area/edge rules, page width/containers at 375/390/430pt + web breakpoints, motion+haptics+easing bands, computed contrast ratios, all 9 states' exact copy, no-AI-slop bans, "References examined" line) is produced by a **`mingla-designer` DESIGN pass** that this SPEC REQUIRES before IMPLEMENT. The designer reuses existing `designSystem.ts` tokens (`accent.warm #eb7825`, `accent.tint`, `text.primary/secondary/tertiary`, `canvas.discover #0c0e12`, `radius`, `spacing`, `glass`, `shadows`) and the established CommandPalette + Sheet visual language so the new sheet feels native to the app. **Functional contract above is LOCKED; the granular pixel spec is OPEN to the designer within these tokens and the §4 acceptance bar.**

---

## 4. Success Criteria (observable, testable, unambiguous)

Per-surface suffixes where parity is manual (`-iOS`/`-Android`/`-Web`).

- **SC-1** Tapping the TopBar search icon opens the global search sheet on every screen rendering the default `[search,bell]` cluster.
  - SC-1-iOS / SC-1-Android: bottom sheet animates up, input autofocuses, keyboard shows.
  - SC-1-Web: narrow → bottom sheet; wide-desktop → centred card; input autofocuses.
- **SC-2** Typing an existing event's title (≥2 chars) returns that event in the **Offerings** group; tapping it closes the sheet and routes to `/event/${id}`. (Happy-path regression, §10.)
- **SC-3** Typing an existing trip title returns it under Offerings → routes `/trip/${id}`. Typing an experience title returns it → routes to the resolved experience route (per R-2).
- **SC-4** Typing `"refund"`, `"payout"`, `"tax"`, `"invite scanner"`, `"currency"`, `"team"`, `"notifications"` each returns the correct registry destination (Payout reports / Payments / Tax registrations or Pricing defaults / Scanners / Pricing defaults / Team / Notifications respectively) via synonym match, and routes there.
- **SC-5** Results are grouped in fixed order Offerings → Go to → Settings & actions; empty groups render no heading.
- **SC-6** Ranking is deterministic: exact > prefix > word-boundary > substring > fuzzy; field weight title>keywords>location>body; equal-score offerings break ties by recency. Given a fixed index + query, `searchIndex` output order is stable across runs.
- **SC-7** A query shorter than 2 chars shows the empty state (jump-to + recents), never zero-result.
- **SC-8** A query with no matches (≥2 chars) shows "No matches" + up to 3 nearest suggestions; no dead end, no crash.
- **SC-9** Role gating: a caller with `rank` below an entry's `minRank` does NOT see that entry. Specifically, a `scanner` (rank 10) does not see Team (minRank 50), Audit log (50), Pricing defaults (50), or Delete account (60). (Adversarial regression, §10.)
- **SC-10** Diacritic/case insensitive: querying `"cafe"` matches an offering titled `"Café"` and vice-versa; uppercase query matches lowercase content.
- **SC-11** No new network request fires on open or on any keystroke (search reads caches only). Verifiable: no new `supabase` call in the search path; service module imports no fetch.
- **SC-12** Every rendered result's `route` resolves to a real `app/` route (no dead taps). (Registry-route regression, §10.)
- **SC-13** Convergence: on business-web wide-desktop, ⌘K opens the SAME global search sheet (not the old marketing-only palette), OR the old palette is removed per §6 verdict; there is exactly ONE search surface on web.
- **SC-14** Closing the sheet (Esc/scrim/back/drag) resets the query but preserves recents; reopening shows recents.
- **SC-15** Dark + light token correctness and ≥ WCAG-AA contrast on every text/state (verified against the designer's contrast table).

---

## 5. Invariants

**Preserved:**
- **I-37** (`leftKind="brand"` consumers MUST NOT pass `rightSlot=`): preserved — wiring edits the internal `DefaultRightSlotInner`, adds no `rightSlot` to any consumer. Strict-grep gate stays green. *Test:* existing I-37 strict-grep CI.
- **I-13** (kit overlay primitives portal to screen root): preserved by reusing `Sheet`/`SheetMobile` (already Modal-portaled). The new sheet MUST go through that primitive, not a bare absolute View. *Test:* component renders via `Sheet`.
- **I-DESKTOP-GATE-VIA-HOOK:** any wide-desktop web branch gates via `useResponsiveLayout().isWideDesktop`, never a raw width check. *Test:* code grep + render test.
- **I-RN-COLOR-FORMATS:** all colors via `designSystem.ts` tokens (rgba/hex in `.web.tsx` carve-out per existing pattern). *Test:* lint + review.
- **I-32** (BRAND_ROLE_RANK mirrors SQL): unchanged — Sub-A consumes `BRAND_ROLE_RANK`, does not redefine ranks. *Test:* existing I-32 grep gate.
- **One-owner-per-truth (Const #2) + server-state-server-side (Const #5):** the index reads React Query caches (server state) through hooks; only ephemeral UI (open/query/recents) lives in Zustand — mirrors the approved `useCommandPaletteState` precedent. *Test:* review + the recents-not-persisted assertion.
- **No-dead-taps (Const #1):** every result routes to a real route (SC-12). *Test:* §10 registry-route test.
- **No-silent-failure (Const #3):** the error state surfaces a visible row (state #9). *Test:* §10 adversarial throws-in-pipeline test.

**New (DRAFT → ACTIVE on Sub-A CLOSE):**
- **I-SEARCH-CLIENT-ONLY** — the global search service module imports NO data-fetching dependency (`supabase`, services that fetch); it operates purely on in-memory caches + the static registry. *Test:* a strict-grep / jest static-import assertion that `src/lib/search/**` (or chosen dir) does not import `services/supabase` or any `fetch*` service. (Optional strict-grep — implementor's call; if added it's frontend-only, no backend allowlist needed.)
- **I-SEARCH-ROLE-GATED** — no `SearchResult` with `minRank > caller rank` is ever returned by `useGlobalSearchIndex`. *Test:* §10 SC-9 adversarial.
- **I-SEARCH-SINGLE-SURFACE** — exactly one search surface exists on web (the converged sheet); the marketing-only `CommandPalette` is removed or repurposed (§6). *Test:* §10 convergence test + grep.

---

## 6. CommandPalette convergence verdict — **CONVERGE**

**Verdict: CONVERGE** the existing web-only marketing `CommandPalette.web.tsx` onto the new global search sheet. Rationale:
- The DECIDED brief mandates a single search surface entered from the TopBar icon and explicitly says do NOT add a new ⌘K-only path. Keeping two surfaces (marketing palette + global sheet) on web violates the "one search surface" intent and confuses users (two different result sets for ⌘K vs. the icon).
- The marketing palette's value (jump-to marketing screens + recent campaigns/audiences/templates) is **partially absorbed**: its jump-to screens are already in the §3.5 registry (rows 5–8). Its "recent campaigns/audiences/templates" data rows are Marketing-data domain, which is **out of Phase-1 index scope** (§1.2) — so those recent-data groups are DROPPED in Phase 1, to return in a later Marketing-domain sub-ORCH.

**Convergence plan (LOCKED):**
1. Repurpose the existing `useCommandPaletteState` Zustand store, OR replace it with `useGlobalSearchSheet` (§3.4.1) — implementor picks; keep one store, delete the other to avoid two open-flags.
2. On business-web wide-desktop, the ⌘K keydown listener (currently in `CommandPalette.web.tsx`) is preserved as an accelerator that calls `useGlobalSearchSheet().toggle()` — opening the SAME sheet the TopBar icon opens. (Allowed by the brief: "On web you MAY keep ⌘K as an accelerator that opens the SAME sheet.")
3. `CommandPalette.web.tsx` is either deleted (its listener + dialog replaced by the global sheet's web shell) or reduced to a thin ⌘K-listener that opens the global sheet. The `(tabs)/_layout.tsx` mount of `<CommandPalette />` is replaced by the `<GlobalSearchSheet />` mount (web shell handles ⌘K internally).
4. The marketing palette's `cmdk` dependency MAY be reused inside the web shell (its fuzzy match + a11y dialog are solid) OR dropped in favor of the shared pure matcher — implementor's call, but the SHARED service must remain the source of result data so web/native parity holds (cmdk, if kept, only renders + keyboard-navigates; it does not own the index). **`cmdk` reference (COMMS-0003 courtesy cite):** https://github.com/pacocoursey/cmdk — already in `package.json`, web-only, no new dependency added.

This keeps the merge surface small: one sheet, one store, one service, one registry, TopBar wiring, and the `_layout.tsx` mount swap.

---

## 7. Test Cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-01 | Open sheet | Tap TopBar search icon | `isOpen=true`, sheet renders, input focused | Component + store |
| T-02 | Event title match (happy path) | Query = an indexed event's title | Result row type=event under Offerings; tap → `router.push('/event/<id>')` | Service + hook + component |
| T-03 | Trip + experience match | trip/experience titles | Correct rows, correct routes | Service + component |
| T-04 | Synonym → screen | "refund" / "team" / "tax" / "currency" / "invite scanner" | Maps to payout-reports / team / tax-registrations / pricing-defaults / scanners | Service (registry) |
| T-05 | Ranking determinism | Index with exact+prefix+substring candidates | Order: exact > prefix > word-boundary > substring; stable | Service (pure) |
| T-06 | Recency tiebreak | Two events equal score, different createdAt | Newer first | Service (pure) |
| T-07 | Min length | Query "a" (1 char) | Empty state (jump-to+recents), not zero-result | Component |
| T-08 | Zero result | Query "zzzqxq" | "No matches" + ≤3 suggestions, no crash | Component + service |
| T-09 | Diacritic/case | "cafe" vs title "Café"; "EVENT" vs "event" | Match both directions | Service (pure) |
| T-10 | Role gating (adversarial) | rank=10 (scanner), index built | Team/Audit/Pricing-defaults/Delete-account ABSENT; offerings view present | Hook (role filter) |
| T-11 | No-fetch | Open + type | Zero supabase/fetch calls in search path (mock supabase, assert not called) | Service + hook |
| T-12 | Registry routes resolve | Iterate FEATURE_REGISTRY | Every route string matches a file in `app/` (snapshot/route-map assert) | Service (static) |
| T-13 | Close resets query, keeps recents | Submit "abc", close, reopen | query="" ; recents contains "abc" | Store |
| T-14 | Convergence | Web wide-desktop, ⌘K | Opens global sheet (same store), old marketing palette gone | Component + store |
| T-15 | Error path | Force `searchIndex` to throw (inject) | Visible "Something went wrong" row, sheet alive | Component (try/catch) |

---

## 8. Implementation Order

1. **Service + registry (pure, no React):** `src/lib/search/types.ts`, `globalSearch.ts` (`buildSearchIndex`, `searchIndex`, `scoreMatch`, normalization), `registry.ts` (the 27 entries), domain adapters. Unit-testable in isolation → write T-05/06/09/12 here first.
2. **State store:** `useGlobalSearchSheet.ts` (or repurpose `useCommandPaletteState`).
3. **Index hook:** `useGlobalSearchIndex.ts` wiring the three cache hooks + role filter.
4. **Sheet component(s):** `GlobalSearchSheet.tsx` (+ `.web.tsx` or branch) using `Sheet`/`SheetMobile` + `Input variant="search"`; all 9 states.
5. **Mount swap:** in `app/(tabs)/_layout.tsx`, replace `<CommandPalette />` mount with `<GlobalSearchSheet />` (web shell owns ⌘K). Resolve §6 convergence.
6. **TopBar wiring:** `TopBar.tsx` `DefaultRightSlotInner` search icon `onPress → open()`; remove its `[TRANSITIONAL]` comment (bell stays transitional).
7. **Tests:** all T-01..T-15 under `mingla-business/**/__tests__/**` (§10).
8. **Typecheck + existing gates:** `npx tsc --noEmit`; confirm I-37 + I-32 strict-grep still green; jest suite green.

DB → edge → service → hook → component order is moot (no DB/edge); the above is the client analog (pure logic → state → hook → UI → wiring).

---

## 9. Regression Prevention

- **Bug class: dead taps from drifting routes.** Safeguard = T-12 iterates the registry and asserts each route resolves; a protective comment on `FEATURE_REGISTRY` states "every route MUST exist in app/ — see registry-routes test." If a screen is renamed/removed, the test fails.
- **Bug class: role leak (viewer sees owner-only destination).** Safeguard = I-SEARCH-ROLE-GATED + T-10; comment on `useGlobalSearchIndex` explaining the pre-match role drop.
- **Bug class: accidental fetch on keystroke (perf/cost).** Safeguard = I-SEARCH-CLIENT-ONLY static-import assertion + T-11.
- **Bug class: two search surfaces re-diverging.** Safeguard = I-SEARCH-SINGLE-SURFACE + T-14 + grep that `CommandPalette` dialog is not mounted alongside the global sheet.
- **Bug class: I-37 regression from TopBar edits.** Safeguard = the wiring touches only `DefaultRightSlotInner`; existing I-37 strict-grep gate is the backstop.

---

## 10. Regression-test plan (orchestrator Step 0.5 gate)

**(a) Implementor happy-path test + assertion + fails-on-revert note.**
- File: `mingla-business/src/lib/search/__tests__/globalSearch.test.ts` (pure service) and `mingla-business/src/components/ui/__tests__/GlobalSearchSheet.test.tsx` (wiring).
- Assertion (service): `searchIndex("<exact event title>", buildSearchIndex({events:[<that event>],trips:[],experiences:[],registry:FEATURE_REGISTRY,role:"brand_owner"}))[0]` has `type:"event"`, `id:<that event id>`, `route:"/event/<id>"`, `group:"offerings"`, and `score >= 0.85`.
- Assertion (component): mounting the sheet with a mocked index + typing the title renders a pressable whose press calls `router.push("/event/<id>")` and `close()`.
- **Fails-on-revert note:** if the TopBar `onPress` wiring or the event adapter is reverted, the component test's `router.push` assertion (no row / no nav) and the service test's `route` assertion fail — directly catching a regression of the core feature.

**(b) Tester adversarial angle.**
- File: `mingla-business/src/lib/search/__tests__/globalSearch.adversarial.test.ts` (+ a component adversarial in `__tests__/GlobalSearchSheet.adversarial.test.tsx`).
- Angles asserted: (1) **Role gate** — build index with `role:"scanner"` (rank 10); assert `searchIndex("team", index)` returns NO `brand-team` row and `searchIndex("delete account", index)` returns nothing (minRank 60 > 10). (2) **Diacritic/empty** — `searchIndex("café"…)` matches a "Cafe" title and vice-versa; `searchIndex("a", index)` (1 char) returns `[]` / triggers empty-state, not zero-result. (3) **Synonym** — `searchIndex("refund", index)` resolves to the `payments-reports` route; `searchIndex("currency", index)` resolves to `pricing-defaults`. (4) **No-fetch** — mock `services/supabase`; assert it is never imported/called by the search module. (5) **Throw safety** — inject a malformed entry; assert pipeline returns `[]` and the component shows the error row, not a crash.

Both files live under `mingla-business/**/__tests__/**` per the harness convention (jest config `jest.config.cjs`, existing `*.test.tsx` / `*.adversarial.test.tsx` naming).

---

## 11. References examined / cited
- `cmdk` (web command-menu primitive, already in tree, web-only): https://github.com/pacocoursey/cmdk — convergence reuse only; not a new dependency (COMMS-0003 courtesy cite, though no external API is integrated).
- Existing in-repo precedents studied for pattern fidelity: `CommandPalette.web.tsx` (group order, visual contract, ⌘K listener), `useCommandPaletteState.ts` (ephemeral Zustand justification), `Sheet`/`SheetMobile`/`Sheet.web` (canonical overlay primitive + I-13/I-DESKTOP-GATE), `Input.variants.ts` (`search` variant a11y), `utils/brandRole.ts` (rank source of truth).
- Premium search/command-bar references the designer should examine in DESIGN: Linear command menu, Raycast root search, Notion quick-find, Stripe Dashboard search, Things 3 quick-find (grouped, keyboard-first, instant, no-slop). (To be confirmed + expanded by `mingla-designer` with its "References examined" line.)

---

## 12. Scope risks for the orchestrator to rule on BEFORE DESIGN
- **R-1 — Local drafts in index?** Drafts live in Zustand (`draftEventStore`), not React Query. Recommendation: index server-backed offerings only; defer drafts. **Rule needed:** include drafts in Phase-1 offerings or not.
- **R-2 — Experience detail route missing.** The `app/` tree has `experience/create` + `coming-soon` but no obvious `experience/[id]/index.tsx`. **Rule needed:** route experiences to a detail screen (confirm it exists), to the hub experiences tab, or exclude experiences from Phase 1. Must resolve to avoid a dead tap (SC-12).
- **R-3 — "refund" routing in a Money-out-of-scope phase.** "refund"/"order" synonyms have no Money destination in Phase 1. Default = route to `payments-reports`. **Rule needed:** accept default, or surface a "coming soon" affordance.
- **R-4 — Recents persistence.** Phase 1 = ephemeral (resets on restart). **Rule needed:** acceptable, or persist via the existing AsyncStorage pattern (small add).
- **R-5 — CommandPalette deletion vs. thin-shim.** §6 prefers converge; deleting `CommandPalette.web.tsx` outright vs. reducing it to a ⌘K shim. **Rule needed:** confirm full removal is acceptable (loses the marketing "recent campaigns/audiences/templates" groups until a later Marketing-domain sub-ORCH).

## 12.1 Orchestrator rulings (BINDING — supersede the open questions above; mingla-orchestrator+claude, 2026-06-04)
- **R-1 → INCLUDE DRAFTS.** Index both React-Query-cached server offerings AND `draftEventStore` Zustand drafts. Rationale: the hub already lists drafts (Drafts pill) and findability of WIP offerings is exactly the operator's "every aspect findable" intent. Drafts route via `routeForEventRow` (drafts → `/event/{id}/edit` or `/trip/{id}/edit`). This widens index *sources* only; stays fully client-side.
- **R-2 → RESOLVED. Route ALL offering results through `mingla-business/src/utils/routeForEventRow.ts` — MANDATORY.** This helper is strict-grep-enforced (`.github/scripts/strict-grep/i-proposed-tr2-route-by-event-type.mjs` bans hardcoded `/event/${id}` / `/trip/${id}`), so hardcoding result routes FAILS CI. Experiences resolve to `/experience/coming-soon` exactly as the hub does today → no dead tap (SC-12 satisfied), no new route, no scope creep. The SPEC's result `route` field for offerings MUST be produced by `routeForEventRow`, not string-built.
- **R-3 → STANDALONE-SCREEN-ONLY REGISTRY.** Registry entries are kept ONLY when they deep-link to a real standalone screen. "payouts/payments" → the real brand payments/reports screen. DROP any per-entity action with no standalone destination (e.g. "issue this refund" needs event+order context the global registry can't supply) from Phase 1; those return via the Money sub-ORCH as contextual/per-list actions. Implementor trims the 27 to valid-standalone-route entries and lists any dropped in the implementation report. No "coming soon" stubs in Phase 1.
- **R-4 → EPHEMERAL RECENTS.** In-session recents only for Phase 1 (resets on restart). Persistence deferred to a later polish sub-ORCH. Smallest merge surface.
- **R-5 → COEXIST (OVERRIDES the §6 CONVERGE verdict for Phase 1).** Do NOT delete or modify `CommandPalette.web.tsx`. The new global sheet is the offerings + feature/settings search on ALL platforms via the existing TopBar search icon. The existing web-desktop ⌘K marketing palette stays UNTOUCHED. Rationale: converging now would either regress shipped marketing UX (dropping the recent-campaigns/audiences/templates groups) or pull the Marketing domain into Phase 1 (scope creep) — COEXIST avoids both and keeps the Phase-1 diff purely additive (new service + hook + sheet + TopBar onPress + registry). Two search entry points on web-desktop is acceptable and explicitly transitional; full convergence (fold marketing groups into the global sheet, retire the separate ⌘K palette) is deferred to the Marketing-domain sub-ORCH. **§6, §3.7's "delete CommandPalette" and SC/test items referencing convergence are amended accordingly: no convergence work in Sub-A.**

---

## 13. 🔒 LOCKED vs 🎨 OPEN summary
**🔒 LOCKED:** scope/non-goals (§1); cross-surface coverage (§2); result model + groups + types + index sources (§3.1); matching tiers/weights/min-length/debounce/caps (§3.2); pure service API (§3.3); Zustand state shape + single-mount + role pre-filter (§3.4); the 27-item registry contents + routes + minRanks + synonyms (§3.5); role-gating rule (§3.6); use of `Sheet`/`SheetMobile` (not TopSheet), `Input variant="search"`, single tabs-root mount, TopBar `DefaultRightSlotInner` wiring, all 9 states' triggers (§3.7); CONVERGE verdict + plan (§6); all SCs + invariants + tests (§4/5/10); no backend / no fetch / no new dependency.
**🎨 OPEN (designer + implementor craft within the locked floor):** exact pixel tokens/spacing/typography/motion-easing-band/haptics/contrast-balanced state copy wording (DESIGN pass); whether web reuses `cmdk` or the shared matcher for rendering; single-file-platform-branch vs `.web.tsx` split; exact recents cap glyph/animation; trip/action icon choices within the existing `IconName` set; micro-interaction feel on row press and sheet open.

---

**End of SPEC.** No product code written. Requires a `mingla-designer` DESIGN pass (visual contract) before IMPLEMENT, and resolution of R-1..R-5 by the orchestrator.
