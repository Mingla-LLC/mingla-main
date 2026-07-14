# SPEC — Campaign Builder UI: pick media, target a live public page

**Issue:** GitHub #864 (child of initiative #852 "[Full Rooms] Internal Ad & Reservation Engine")
**Mode:** SPEC · **Design contract:** `Mingla_Artifacts/reports/UI_UX_ISSUE-864_CAMPAIGN_BUILDER.md` (embedded/referenced below)
**Worktree:** `~/Desktop/mingla-orchs/issue-864-campaign-builder-ui/` on branch `issue-864-campaign-builder-ui` (branched off `issue-862-meta-ads-api`)
**Hard dependency:** **#862** (Meta connection + `admin-meta-*` edge functions + `meta_campaigns` data model). #864 is the UI layer over #862's engine; it does **not** re-spec the backend.
**Downstream routing:** this SPEC → `mingla-implementor` → `mingla-tester` → orchestrator CLOSE
**Author:** mingla-forensics (design by mingla-designer, inline) · **Date:** 2026-07-14

> **User story (verbatim):** "As a Mingla admin, I can build a campaign in-app: choose creative media and target a specific live public page (venue/event/trip) as the destination." AC: media picker; public-page selector; channel/budget/audience form; review & submit to Meta/TikTok.

---

## 1. Executive summary

Build the **Campaign Builder** — a dedicated multi-step admin screen (`#/campaign-builder` in `mingla-admin`) that lets an admin assemble a Meta ad campaign visually: pick the **channel**, pick a **live public page** as the destination, **upload the ad image**, set **budget & audience**, write **ad copy**, then **review** against a live Facebook-style preview and **create it (paused)**. Submit calls #862's `admin-meta-create-campaign` endpoint; the created campaign lands PAUSED in #862's campaign surface with the Launch control.

This is the **UX half** of the Meta ad engine. #862 built the plumbing (connect, create/launch/pause, persist); #864 gives an admin a builder that doesn't require touching Meta Ads Manager or the raw API. Channel selection is **forward‑compatible** (Meta active now; TikTok visible‑but‑disabled, wired in #863).

---

## 2. Scope & non‑goals

### In scope
1. `#/campaign-builder` route + left‑nav entry, gated to active admins (existing `AuthContext`).
2. **Step 1 Channel** — Meta (active) / TikTok (disabled, "Coming soon"); surfaces #862's connection state (fail‑close: can't build if Meta not connected).
3. **Step 2 Destination** — searchable picker of **live public pages** from `business_public_events_view` (+ brands for brand pages); resolves and previews the public URL.
4. **Step 3 Media** — upload ONE ad image to a new Storage bucket; client‑side validation; preview.
5. **Step 4 Budget & audience** — objective (Traffic default), daily/lifetime budget (min enforced from the connection), country multiselect + age.
6. **Step 5 Ad copy** — primary text, headline, description, CTA.
7. **Step 6 Review** — summary + live ad preview + "Create campaign (paused)" → #862 create endpoint.
8. One **backend addition**: a public‑read Supabase Storage bucket `meta-ad-creatives` + admin‑write policy (so uploaded images have a URL Meta can fetch).

### Non‑goals (explicit)
- **All Meta API plumbing, the data model, launch/pause, connection** → **#862** (consumed, not rebuilt).
- **TikTok submit** → **#863** (channel shown but disabled here).
- **Attribution / conversion reporting** → **#865**.
- **Reusable creative library / browse‑and‑reuse venue media** → **#866**. #864 uploads a **single** image per campaign; it does not build a library. (The `meta-ad-creatives` bucket introduced here is the shared substrate #866 will extend.)
- **Draft persistence / "save & resume"** — not in this story; an in‑progress build is client‑state only, guarded by a discard confirm. (Open Decision OD‑3.)
- **Editing an existing campaign's creative/budget after creation** — out; create‑only here.
- **Consumer/business apps, public web** — untouched (public web read‑only as the destination source).

### Assumptions
- #862 is merged (or co‑developed on the stacked branch) before #864 ships; the create endpoint contract is exactly as in `SPEC_ISSUE-862_META_ADS_CAMPAIGN_ENGINE.md` §4.4(b).

---

## 3. Cross‑Surface Impact Declaration (MANDATORY)

| # | Surface | Covered? | User‑visible behavior | Files touched | Parity |
|---|---------|----------|-----------------------|---------------|--------|
| 1 | Consumer iOS | No | none | none | n/a |
| 2 | Consumer Android | No | none | none | n/a |
| 3 | Buyer/anon Web (`mingla-business`) | **Reference only** | its live public pages are the selectable destinations + the ad's link target (read‑only) | none (reads `business_public_events_view`) | n/a |
| 4 | Business iOS | No | none | none | n/a |
| 5 | Business Android | No | none | none | n/a |
| 6 | **Admin Web** (`mingla-admin`) | **YES — primary & only** | the entire Campaign Builder screen | `mingla-admin/src/**` | single surface — no cross‑platform parity |
| 7 | Business Web preview | No | none | none | n/a |
| — | **Backend** (`supabase/`) | **YES — minimal** | one Storage bucket + policy | `supabase/migrations/**` (bucket + RLS) | server‑authoritative |

**Not‑covered reasons:** the builder is an internal admin tool; it only *reads* the existing public‑page contract and *calls* #862's endpoints. No consumer/business/public‑web behavior changes.

---

## 4. Layered specification

### 4.1 Design contract (embedded — full pixel detail in `UI_UX_ISSUE-864_CAMPAIGN_BUILDER.md`)

The design artifact is binding. Key contract points the implementor MUST honor (see the UI_UX file for exact tokens, states, motion, a11y):
- **Layout:** dedicated page in `AppShell`; two‑column at ≥1024px (step column `max-w-720` + sticky `AdPreview` rail `w-380`); single column + bottom preview accordion below 1024px. 6‑step **Stepper** (back‑navigable, no forward‑skip). Sticky footer nav (Back / primary).
- **Tokens:** reuse `globals.css` vars only (brand `#f97316`, `--space-*`, `--radius-*`, Geist Sans); dark mode free via `[data-theme]`. **Reuse the `Button` primary variant — never hand‑roll an orange button** (contrast is owned there).
- **States:** every step specifies loading / empty / error / invalid / submitting (UI_UX §5). Selection = ring **+ check** (never color alone). Motion 150–300ms with `prefers-reduced-motion` fallbacks (UI_UX §6). WCAG AA per UI_UX §7 (radio‑group cards, labeled inputs, keyboard‑operable uploader, ≥44px targets).
- **New components to build:** `CampaignBuilderPage`, `WizardShell`+`Stepper`, `ChannelCard`, `DestinationPicker`, `ImageUploader`, `MultiSelect`, `AdPreview`, `CurrencyInput` (UI_UX §9). **Reuse:** `Button`, `Input`, `Textarea`, `Toggle`, `SearchInput`, `Badge`, `Spinner`, `Card`/`SectionCard`/`AlertCard`, `Modal`/`HighRiskActionModal`, `Toast`/`useToast`, `framer-motion`.

### 4.2 Routing & nav (hash router — matches admin convention)
- Add `"campaign-builder": CampaignBuilderPage` to the `PAGES` map in `mingla-admin/src/App.jsx`.
- Add a nav item `{ id: "campaign-builder", label: "Campaigns", icon: "Rocket" }` to a group in `mingla-admin/src/lib/constants.js` `NAV_GROUPS`.
- Add `Rocket` to the `ICON_MAP` in `mingla-admin/src/components/layout/Sidebar.jsx` (documented footgun — omission silently falls back to `LayoutDashboard`).
- Edit‑jump/step deep‑links use the existing hash‑query pattern (`#/campaign-builder?step=2`), parsed with `URLSearchParams`.

### 4.3 Data access (services layer — no React Query; `useState/useEffect`)
- **New reader** `mingla-admin/src/services/metaAdsDestinations.js` → `listDestinations({ search, type, status, page })` querying `business_public_events_view` for `id, title, slug, brand_slug, brand_name, cover_media_url, city, master_start_at, status, event_type, visibility` (admin‑read; the view already grants `authenticated`). Returns `{ rows, total }`, throws on error (house pattern). Brand‑page option list from `brands` (`id, name, slug, profile_photo_url`).
- **New service** `mingla-admin/src/services/metaAdsCampaigns.js` → `createCampaign(payload)` calling `invokeWithRefresh('admin-meta-create-campaign', { body })`; `getConnectionStatus()` calling `admin-meta-connect` `{action:'status'}`. (Both endpoints are #862's.)
- **Media upload helper** `mingla-admin/src/services/mediaUpload.js` → uploads a `File` to Storage bucket `meta-ad-creatives` via the `supabase` client, returns `{ publicUrl, path }`. First upload helper in `mingla-admin` (none existed — build it).

### 4.4 Payload contract to #862 (`admin-meta-create-campaign`)
The builder assembles exactly #862's request body:
```
{ name, objective:'OUTCOME_TRAFFIC', optimization_goal:'LANDING_PAGE_VIEWS'|'LINK_CLICKS',
  billing_event:'IMPRESSIONS',
  budget:{ type:'daily'|'lifetime', amount_cents, end_time? },
  targeting:{ countries:[…], age_min, age_max, genders? },
  destination:{ page_type, brand_slug, entity_slug?, event_id? },
  creative:{ message, headline?, description?, image_url:<meta-ad-creatives public URL>, call_to_action_type },
  special_ad_categories:[] }
```
Name auto‑suggested as `"{brand_name} — {title} — {YYYY-MM-DD}"`, editable. `amount_cents` derived from the `CurrencyInput`. `image_url` is the uploaded bucket URL. The **server** re‑validates destination‑is‑public, budget‑min, and connection (fail‑close) — the client validates for UX but never bypasses the server gate.

### 4.5 Backend addition (the ONLY backend change here)
New migration `supabase/migrations/<ts>_issue_864_meta_ad_creatives_bucket.sql` (timestamp after the latest existing migration):
- Create Storage bucket `meta-ad-creatives`, `public = true` (Meta must fetch the image by URL), file‑size limit 30 MB, `allowed_mime_types = {image/png,image/jpeg}`.
- RLS on `storage.objects` for this bucket: **INSERT/UPDATE/DELETE** `USING (bucket_id='meta-ad-creatives' AND public.is_admin_user())`; **SELECT** public (bucket is public‑read). Mirrors the admin‑gate convention (recon: `is_admin_user()`).

---

## 5. Success criteria (single surface → no per‑platform split; testable)

- **SC‑1:** Navigating to `#/campaign-builder` as an active admin renders the builder at Step 1; a non‑admin never reaches it (existing auth gate).
- **SC‑2 (fail‑close):** If #862 reports Meta not connected/invalid, Step 1 shows the "Connect Meta" AlertCard and **Next is disabled** — the builder cannot proceed to create.
- **SC‑3:** Step 2 lists only **public + live/scheduled** pages from `business_public_events_view`; search/filter narrow results; selecting one shows the correct resolved URL (`/e/{brand_slug}/{slug}` etc.). Loading→skeletons, none→empty state, failure→retry.
- **SC‑4:** Step 3 uploads one JPG/PNG to `meta-ad-creatives`, rejects wrong type/oversize/undersize **client‑side** with an inline message, and yields a public URL; the preview thumbnail renders.
- **SC‑5:** Step 4 blocks Next when budget `< min_daily_budget_cents` (from the live connection), when `age_min > age_max`, or when zero countries — each with a specific inline message; otherwise Next enabled.
- **SC‑6:** Step 5 fields update the **live `AdPreview`** on each keystroke; empty fields show muted placeholders (frame never collapses).
- **SC‑7:** Step 6 summary matches every entered value; "Create campaign (paused)" calls `admin-meta-create-campaign`, shows submitting state, and on success shows the "Created — Paused" panel + a route to the #862 campaign detail. The created campaign is **PAUSED** (never auto‑launched).
- **SC‑8 (error surfacing):** A server 4xx/5xx (e.g. `destination_not_public`, `budget_below_minimum`, `meta_create_failed`) renders the normalized Meta message + `fbtrace_id` in an AlertCard, preserves form state, and (for `destination_not_public`) deep‑links back to Step 2. No silent failure.
- **SC‑9 (a11y):** Keyboard‑only completion of all 6 steps is possible; stepper exposes `aria-current`; cards are a keyboard radio‑group; uploader is keyboard‑operable; contrast passes AA in light and dark (UI_UX §7).
- **SC‑10 (no auto‑spend):** No path in the builder sets a campaign ACTIVE — launching remains the explicit, separate #862 action.

---

## 6. Invariants + regression prevention

### Invariants
- **Preserve I‑ADMIN‑GATE:** builder route + the Storage write policy are admin‑only.
- **Preserve #862's fail‑close** (`I-PROPOSED-META-FAIL-CLOSE`): the UI must not offer "create" when disconnected; and it relies on the **server** re‑checking (client checks are UX‑only).
- **Preserve immutable‑slug contract:** the resolved `dest_url` is built from immutable `brand_slug`/`slug`; the builder only reads them.
- **I‑PROPOSED‑864‑CREATE‑PAUSED (DRAFT):** the builder always creates PAUSED; it never activates. (Flips ACTIVE at CLOSE — orchestrator owns the flip.)
- **I‑PROPOSED‑864‑CREATIVE‑BUCKET‑ADMIN‑WRITE (DRAFT):** writes to `meta-ad-creatives` require `is_admin_user()`.

### Regression contract (fails‑on‑revert)
- **RT‑1:** a UI/unit test asserts Step 1 renders the disabled‑Next + Connect CTA when `getConnectionStatus()` returns not‑connected. Reverting the fail‑close gate makes it fail.
- **RT‑2:** a test asserts the create payload carries the resolved `image_url` from `meta-ad-creatives` and `objective='OUTCOME_TRAFFIC'` with a PAUSED‑expected outcome (no `activate` call). Reverting to an auto‑launch would fail it.
- **RT‑3 (strict‑grep CI gate):** assert `mingla-admin/src/**` never references `META_SYSTEM_USER_TOKEN` or calls `graph.facebook.com` directly — all Meta calls go through #862's edge functions (defends the token‑isolation invariant from the UI side).
- No `app.json`/store‑submit change → release‑parity gates (COMMS‑0096/0097) untouched.

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T1 | happy path | valid page + image + $5/day + US + copy | 4 Meta entities + 1 `meta_campaigns` row, PAUSED; success panel | e2e |
| T2 | not connected | connection status invalid | Step 1 blocks; Next disabled; Connect CTA | component |
| T3 | empty destinations | search matches nothing | empty state, no crash | component |
| T4 | bad image | 5 MB GIF / 400×400 PNG | client reject + inline message; no upload | component |
| T5 | below‑min budget | $0.50/day (min $1.00) | Next disabled + "Minimum $1.00/day" | component |
| T6 | age inversion | min 45 / max 25 | inline error, Next disabled | component |
| T7 | server 422 | destination went private post‑pick | AlertCard + jump to Step 2 | e2e |
| T8 | server 502 | Meta create fails mid‑chain (#862 rolls back) | AlertCard + fbtrace_id; form preserved; no orphan | e2e |
| T9 | a11y | keyboard‑only run | all 6 steps completable; focus visible | manual/axe |
| T10 | storage RLS | non‑admin attempts bucket write | denied | SQL |

**Live‑fire (mingla‑tester, after #862 prereqs incl. billing):** drive the full builder on the admin web against a real live event page, upload a real image, create a $1/day Traffic campaign, confirm it appears PAUSED in Meta + `meta_campaigns`, then launch/pause from the #862 surface. Capture screenshots.

---

## 8. Implementation order

1. **Migration** — `meta-ad-creatives` bucket + RLS (§4.5).
2. **Services** — `mediaUpload.js`, `metaAdsDestinations.js`, `metaAdsCampaigns.js`.
3. **Primitives (new)** — `MultiSelect`, `CurrencyInput`, `ImageUploader`, `AdPreview`, `WizardShell`+`Stepper`, `ChannelCard`, `DestinationPicker`.
4. **`CampaignBuilderPage`** — compose steps + state machine + submit.
5. **Wire routing** — `App.jsx` PAGES, `constants.js` NAV_GROUPS, `Sidebar.jsx` ICON_MAP.
6. **CI** — RT‑3 strict‑grep gate; component tests T2–T6.

## 9. Regression prevention
See §6 (RT‑1/2/3). Protective comment on the Step‑1 connection gate explaining the fail‑close "why". The RT‑3 grep gate is the structural guard that the admin client never touches the Meta token or Graph directly.

## 10. Open questions (with recommendation)
- **OD‑1 — Picker UI:** rich **card grid** with cover images **[RECOMMEND — the cover is the point of "pick a page"]** vs. reuse the plain `DataTable`. → card grid.
- **OD‑2 — Image handling:** upload to `meta-ad-creatives` and pass **`image_url`** to #862 **[RECOMMEND for MVP]** vs. have #862 pre‑upload to Meta for a stable `image_hash` (defer to #866). → `image_url` now.
- **OD‑3 — Draft persistence:** client‑state only, discard‑guarded **[RECOMMEND for this story]** vs. persist drafts server‑side (own story). → no drafts now.
- **OD‑4 — Objectives exposed:** default **Traffic** only, with Awareness/Engagement selectable **[RECOMMEND]** vs. Traffic‑locked. → Traffic default, others available.
- **OD‑5 — Country default:** prefill `US/GB/NG` (live markets) editable **[RECOMMEND]** vs. empty. → prefill.
- **OD‑6 — Nav label:** "Campaigns" **[RECOMMEND]** vs. "Ad Engine". → "Campaigns" (with #862's connect living under the same section).

## 11. Scoped allowlist + DO‑NOT‑TOUCH

**Allowlist (implementor MAY create/modify ONLY):**
- `mingla-admin/src/pages/CampaignBuilderPage.jsx` (new) + step subcomponents under `mingla-admin/src/components/campaign-builder/**` (new)
- new primitives under `mingla-admin/src/components/ui/**` (`MultiSelect`, `CurrencyInput`, `ImageUploader`, `AdPreview`, `Stepper`/`WizardShell`) — additive only
- `mingla-admin/src/services/{mediaUpload,metaAdsDestinations,metaAdsCampaigns}.js` (new)
- `mingla-admin/src/App.jsx` (add one PAGES entry), `mingla-admin/src/lib/constants.js` (add one NAV item), `mingla-admin/src/components/layout/Sidebar.jsx` (add one ICON_MAP entry)
- `supabase/migrations/<ts>_issue_864_meta_ad_creatives_bucket.sql` (new)
- CI workflow (append the RT‑3 grep job)

**DO‑NOT‑TOUCH (stop‑and‑amend first):**
- Any `supabase/functions/**` including the #862 `admin-meta-*` functions and `_shared/meta.ts` (call them, don't edit them).
- The #862 tables/migrations (`meta_ad_connections`, `meta_campaigns`, `meta_campaign_status_events`) — read via #862's endpoints; add no columns here.
- Existing `mingla-admin/src/components/ui/**` primitives (reuse; don't rewrite `Button`/`Input`/`Modal`/etc.).
- `app-mobile/**`, `mingla-business/**`, `mingla-marketing/**`, any `app.json`/`eas.json`.
Anything outside the allowlist → `SPEC_AMENDMENT_ISSUE-864_*` before touching.

---

## Downstream routing
**Next:** `mingla-implementor` (build from this SPEC + the embedded design contract; requires #862's endpoints to exist on the branch). → `mingla-tester` (component tests + a11y + live‑fire once #862 billing prereqs are met) → orchestrator CLOSE.
**Working tree:** `~/Desktop/mingla-orchs/issue-864-campaign-builder-ui/` on branch `issue-864-campaign-builder-ui` (stacked on `issue-862-meta-ads-api`).
