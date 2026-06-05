# META-ORCH-1073 — Mingla Business Search/Find System — Shared Understanding Brief

**Status:** REGISTERED (INTAKE) 2026-06-04 — awaiting operator steering before sub-ORCH spawn.
**Owner orchestrator:** Claude `mingla-orchestrator`.
**Operator directive (verbatim):** "comprehensively build out the search system for mingla business. I want EVERY SINGLE aspect of the app to be searchable and findable for users. I want it robust and deep so users can actually find what they are looking for."

## ID provenance
Next-free above max observed. Scanned WORLD_MAP / MASTER_BUG_LIST / OPEN_INVESTIGATIONS / COMMS_LEDGER / active worktrees per COMMS-0004 on 2026-06-04. Max ORCH-ID hit = 1072 (double-booked between a `META-ORCH-1072` Paystack-Africa brief and an `ORCH-1072-experience-detail-cover-availability` branch — flagged, not owned here). ORCH-1071 = venue-card-experiences. Therefore next free = **1073**.

## Affected Surfaces
- business-iOS (`mingla-business/` on iOS)
- business-Android (`mingla-business/` on Android)
- business-web preview (`mingla-business/` dev/web) — adjacent

Surfaces explicitly NOT in scope:
- consumer-iOS / consumer-Android (`app-mobile/`) — separate app with its own discovery/deck search; out of this directive's "mingla business" framing.
- admin-web (`mingla-admin/`) — separate app; no operator request.
- buyer/anonymous web (`/b`, `/e`, `/checkout`) — buyer discovery is a different concern from a business owner finding their own data.

## Comms-ledger constraints to honor downstream
- **COMMS-0002** (strict-grep backend gate): any new `supabase/functions/**` file or migration must land its `ORCH_1073_BACKEND_ALLOWLIST` entry in `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` in the SAME commit.
- **COMMS-0003** (external-API docs): any Postgres FTS / `pg_trgm` / `tsvector` / Supabase RPC work must cite Supabase + PostgreSQL docs URLs inline at SPEC for every function, index type, and operator introduced.
- **COMMS-0015 / COMMS-0018** (deploy discipline): edge functions deploy FROM merged main, never from a worktree as the durable source; CLOSE verifies origin/main contains the squash commit + a content probe before deploy/reap.

---

## Current state (forensic INTAKE, 2026-06-04)

Search in mingla-business today is **functional but fragmented** — a patchwork of one-off implementations with no shared infrastructure, no full-text search, and no cross-entity/global search on most surfaces.

### What exists today
1. **Address/place autocomplete (two parallel impls):**
   - Google Places via `AddressAutocompleteInput.tsx` → `places-autocomplete` edge fn (event creator, Step 3).
   - Mapbox via `MapboxAddressInput.tsx` → `autocompleteMapbox()` (experience stops). META-ORCH-1060 already wants these unified on Mapbox.
2. **Venue pool search:** `poolSearchService.ts` + `usePoolMatchSearch.ts` → `claim-search-pool` edge fn → `biz_search_place_pool_for_claim` RPC (ILIKE substring, rate-limited 10/min, top-5). The closest thing to a real backend search primitive.
3. **Command palette (⌘K) — WEB DESKTOP ONLY:** `CommandPalette.web.tsx` (cmdk). Scope is **marketing-only** (jump to Overview/Audiences/Campaigns/Templates + recent campaigns/audiences/templates). Not on mobile. Not cross-domain.
4. **Per-list client-side `.filter()` search (capped at loaded page):** event guest list (name/email/phone), event orders (buyer name + order id), with status filter pills.
5. **Filter pills (categorical, not text):** campaigns status, events pipeline, trips pipeline, trip money, audit-log category. Mix of server-side and client-side.
6. **Searchable pickers:** Stripe country picker (client filter on 34-country allowlist), checkout country/dial-code picker (3rd-party).

### Gaps (why users currently can't "find what they're looking for")
- **No global/omnisearch on mobile** — ⌘K is web-desktop only and marketing-scoped.
- **No cross-entity search** — can't type a name and find the matching event AND trip AND campaign AND buyer.
- **No full-text search** — no `tsvector`/`pg_trgm`; descriptions, bios, campaign bodies, notes are unsearchable; no typo tolerance, no ranking.
- **Client-side filters cap at the loaded page** — searching orders/buyers/guests only matches what's already fetched, not the full set.
- **Many lists have NO search at all** — experiences, audiences, templates, team members, scanners, brand switcher, payouts/refunds.
- **No feature/settings findability** — a user can't type "refund", "payout", "tax", "invite scanner", "currency" to jump to the right screen.
- **No shared search component/hook** — every screen reinvents filter logic; UX is inconsistent.

### The five searchable domains (target surface area)
1. **Offerings** — events, trips, experiences (+ ticket types). Title, description, location_text, status, taxonomy tags (party_types, vibe_tags, music_genres), dates.
2. **People** — buyers/orders, comp guests, door sales, team members, scanners, invitations. Name, email, phone, role, status.
3. **Marketing** — campaigns, audiences, templates, messages. Name, subject/body, channel, status.
4. **Org metadata** — brand profile, settings, payments/Stripe, pricing defaults, venue claim, audit log. Brand name/slug/bio/address/socials, settings labels.
5. **Money** — orders, refunds, payouts. Order id, amount, status, reason, dates.

---

## Recommended architecture — "Mingla Business Find System" (4 layers)

**Layer 1 — Backend search foundation (the "robust and deep" core).**
Postgres-native: `pg_trgm` GIN indexes for fuzzy/typo-tolerant matching + `tsvector` / `websearch_to_tsquery` ranked full-text on long fields (descriptions, bios, campaign bodies). One `SECURITY DEFINER` RPC `biz_global_search(p_brand_id, p_query, p_types[], p_limit)` returning a unified ranked shape `{type, id, title, subtitle, route, score, matched_field}`, scoped to the current brand AND the caller's team role, RLS-gated. Per-entity generated `search_document` columns or a denormalized search view. Optionally wrapped by a rate-limited `business-search` edge fn (mirrors `claim-search-pool`).

**Layer 2 — Global omnisearch surface (headline UX, ALL platforms).**
A shared search command-bar on iOS/Android/web (not web-desktop-only). Mobile: a top-bar search affordance opening a full-screen search sheet; web: keep ⌘K but expand scope from marketing-only to everything. Results grouped by domain, each row deep-links to the right screen. Includes "jump to action/setting" results (find features, not just data). Recent searches + suggestions.

**Layer 3 — Deep per-list search (fill every gap).**
Add real search to every list lacking one (experiences, audiences, templates, team, scanners, brand switcher, payouts/refunds); upgrade large client-side lists (orders/buyers/guests) to server-backed search so results aren't capped at the loaded page. Standardize on ONE shared `<SearchInput>` + ONE `useGlobalSearch`/`useEntitySearch` hook to kill fragmentation.

**Layer 4 — Feature & settings findability.**
A static route/action/setting registry with searchable labels + synonyms, fed into the omnisearch, so "every aspect of the app" (screens, toggles, actions) is findable by typing.

### Proposed sub-ORCH decomposition (phased)
- **Sub-A** — Backend search foundation: trgm/tsvector indexes + `biz_global_search` RPC + role/RLS scoping + regression tests + strict-grep allowlist. [backend-only]
- **Sub-B** — Shared search primitives: one `<SearchInput>`, one search hook, unified result-row + routing map. [design + implement]
- **Sub-C** — Global omnisearch surface across iOS/Android/web (replaces web-only marketing palette; adds mobile entry). [design + implement]
- **Sub-D** — Deep per-list search rollout + server-backing large lists. [implement]
- **Sub-E** — Feature/settings findability index. [implement]
- **Sub-F** — Search empty/zero-result UX, "did you mean", recent/suggestions, optional search analytics. [design + implement]

Each sub-ORCH runs the standard pipeline (INVESTIGATE/SPEC → [DESIGN if UI] → IMPLEMENT → TEST → CLOSE) in its own per-ORCH worktree.

---

## Product decisions (DECIDED by operator 2026-06-04)
1. **Backend depth → CLIENT-SIDE FILTERING.** No Postgres FTS in Phase 1. Search runs over data already cached client-side (a single brand's offerings/campaigns/templates/team are small, fully-loaded sets) plus a static feature/settings registry. Layer 1 (backend FTS RPC/edge fn) is DEFERRED — revisit only if/when large unloaded datasets (full buyer/order history) enter scope. **Consequence:** the architecture below drops the backend RPC; "foundation" = a shared client-side search index/service, not a DB layer.
2. **Entry point → EXISTING TOP-BAR SEARCH ICON → DROPDOWN SHEET.** Do NOT add a new affordance or a ⌘K palette. The headline UX is wiring the already-present (but currently unwired/transitional) top-bar search icon at `mingla-business/src/components/ui/TopBar.tsx:125` to open a dropdown search sheet showing grouped, deep-linking results. Per-list search is secondary/later.
3. **Scope → OFFERINGS + CONTENT + FEATURES FIRST.** Phase 1 indexes events/trips/experiences (+ their text content) and a feature/settings findability registry. People/PII (buyers/team/guests) and Money (orders/refunds/payouts) are LATER phases.
4. **Sequencing → FOUNDATION + GLOBAL SHELL FIRST.** Build the shared client-side search index + the global search sheet (wired to the top-bar icon) for the Phase-1 scope, then fan out to additional domains and per-list search.

## TopBar anchor (verified 2026-06-04)
`mingla-business/src/components/ui/TopBar.tsx` renders a default right-slot cluster `[search, bell]`. The search `IconChrome` (line 125) is marked `[TRANSITIONAL]` with onPress **unwired** ("Cycle 1+ wires search + notifications navigation"). Sub-A wires this icon's onPress to open the global search dropdown sheet. Note the bell icon is similarly unwired — out of scope here, but adjacent.

## Revised decomposition (post-decision)
- **Sub-A** — Global search sheet (Phase 1): wire TopBar search icon → dropdown sheet; shared client-side search index/service over the brand's cached offerings (events/trips/experiences) + a static feature/settings registry; grouped, ranked, deep-linking results; empty/zero-result UX. [design + implement; client-only, no migration]
- **Sub-B** — Add People domain (buyers/team/guests) to the index — likely needs server-backed search for large lists; revisits decision 1 for that domain only. [later]
- **Sub-C** — Add Money domain (orders/refunds/payouts), role-gated. [later]
- **Sub-D** — Deep per-list search rollout where lists still lack it. [later]

Brief promotes to a WORLD_MAP registration + Sub-A worktree spawn next.
