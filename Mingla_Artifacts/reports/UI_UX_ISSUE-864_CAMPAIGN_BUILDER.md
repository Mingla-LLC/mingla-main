# UI/UX Design Contract — Campaign Builder (mingla-admin)

**Issue:** #864 (child of #852) · **Surface:** Admin Web only (React 19 + Vite 7, Tailwind v4, hash router) · **Depends on:** #862 (endpoints + connection + data model)
**Author:** mingla-designer (invoked inline by mingla-forensics) · **Date:** 2026-07-14
**Platform note:** web-only — RN conventions and the Android glass opaque-fallback policy do **not** apply. No glass; solid surfaces on the existing token system.

Every token below is an existing `mingla-admin` CSS custom property (from `src/globals.css`); dark mode comes free because each var already has a `[data-theme="dark"]` value. **Do not hand-roll colors — reference the vars.**

---

## 1. IA & flow

**The moment:** an admin wants to spend money to drive people to ONE specific live Mingla page. The whole job is: *which page, what it looks like as an ad, how much, to whom* — then a safe, reversible "create paused." The design's job is to make an unfamiliar 4-noun task (channel · destination · creative · budget/audience) feel like filling one short form, and to make the money-spending step feel deliberate, not accidental.

**Flow (6 linear steps, back-navigable, no forward-skip):**
```
Channel → Destination → Media → Budget & Audience → Ad Copy → Review → [Create paused] → Campaign detail (#862 surface, PAUSED + Launch)
```
- **Progressive disclosure:** one decision cluster per step; the running **live ad preview** (right rail) assembles as you go, so the end is never a surprise.
- **Branches / failure paths:** Meta not connected (Step 1 hard stop → link to Connect); no live pages (Step 2 empty state); upload failure (Step 3 retry); below-min budget / age min>max (Step 4 inline invalid); destination went non-public between pick and submit (Step 6 → server 422 surfaced); Meta create error (Step 6 → AlertCard with fbtrace_id, form state preserved).
- **Escape hatch:** "Save & exit" is **out of scope** (no draft persistence in this story — see SPEC non-goals); closing the page discards. A "Discard campaign?" confirm (existing `HighRiskActionModal`) guards accidental navigation once past Step 1.

---

## 2. Layout & spacing grid (4/8pt system — matches admin `--space-*`)

- **Route:** dedicated full page `#/campaign-builder` inside `AppShell` (not a modal — too much content; modal reserved for the discard/edit-jump confirms).
- **Page container:** admin content max-width 1280, `px-16`. Builder body is a **two-column grid** at ≥1024px: left **step column** `max-w-[720px]`, right **sticky preview rail** `w-[380px]`, gap `--space-xl (32)`. Below 1024px: single column, preview collapses into a sticky bottom accordion ("Preview ad ▸").
- **Page header block** (reuse the standard admin header pattern): 40×40 rounded-full `bg-[var(--color-brand-50)]` with a `Rocket` lucide icon `text-[var(--color-brand-500)]`; `h1` "Campaign Builder" (`text-2xl font-bold text-[var(--color-text-primary)]`); subtitle "Run a paid campaign to a live Mingla page" (`text-sm text-[var(--color-text-secondary)]`).
- **Stepper** sits directly under the header, full width, margin-bottom `--space-xl`.
- **Step content card:** `SectionCard` wrapper, padding `--space-lg (24)`, internal field gap `--space-md (16)`, section gap `--space-lg`.
- **Sticky footer nav** inside the step column: top border `1px var(--color-border)`, padding-block `--space-md`, `Back` (ghost) left, primary action right.
- **Touch/click targets:** every control min-height **44px** (`h-11`).

---

## 3. Type scale (existing tokens; Geist Sans)

| Element | Class / token | Notes |
|---|---|---|
| Page title | `text-2xl font-bold` | primary text color |
| Step heading | `text-lg font-semibold` | e.g. "Where should the ad send people?" |
| Step helper | `text-sm text-[var(--color-text-secondary)]` | one-line intent |
| Field label | `text-sm font-medium` | from `Input` label prop |
| Field help / counter | `text-xs text-[var(--color-text-tertiary)]` | char counters, hints |
| Card title (destination/channel) | `text-sm font-semibold` | |
| Card meta | `text-xs text-[var(--color-text-tertiary)]` | brand · city · date |
| Preview primary text | `text-sm` (14) | line-clamp-4 |
| Preview headline | `text-[15px] font-semibold` | line-clamp-2 |
| Preview display URL | `text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]` | |

Line-height ≥1.5 on all body/help text. Respect browser zoom to 200% (no fixed px on containers that would clip).

---

## 4. Color & token mapping

- **Primary action / selection accent:** `--color-brand-500 #f97316` (fills, rings, active stepper); hover `--color-brand-600`. **Button text/fill contrast is owned by the existing `Button` primary variant — reuse it; do NOT hand-roll an orange button** (raw white-on-#f97316 ≈ 2.9:1 fails AA for text; the shipped `Button` already resolves this).
- **Surfaces:** card `--color-bg-primary #fff`; page `--color-bg-secondary #faf8f6`; inset/preview link-card `--gray-50 #f9fafb`.
- **Status badges (destination + campaign):** Live → `success` (#22c55e), Scheduled → `info` (#3b82f6), Ended/Cancelled → `gray-500`. Reuse `Badge` variants; **status always carries a text label, never color alone.**
- **Validation:** error text/border `--color-error-500 #ef4444`; success toast `--color-success-500`.
- **Selected state** = brand ring (`ring-2 ring-[var(--color-brand-500)]`) **plus** a check icon — never ring-color alone (colorblind-safe).
- Dark mode: all of the above are vars with dark values → verify contrast in both themes (body text on `--color-bg-primary` passes AA in light and dark per the existing token set).

---

## 5. Steps — fields + every state

### Step 1 — Channel
- **Two selectable cards** (role="radio" in a `radiogroup`): **Meta** (Facebook + Instagram glyphs, selected by default) and **TikTok** (`disabled`, opacity-50, cursor-not-allowed, `Badge` "Coming soon"). Card = bordered `SectionCard`, selected → brand ring + top-right check.
- **Connection gate (fail-close in UI):** on mount, read the #862 connection (`admin-meta-connect` `action:'status'`). If not connected/invalid → amber `AlertCard` "Meta isn't connected yet" + link "Connect Meta →" (routes to the #862 connect surface); **Next disabled**. If connected but `account_status=UNSETTLED`/no payment method → amber `AlertCard` "Add billing before you can launch (you can still build now)" — Next **enabled** (build is fine; launch is the blocked step, per #862).
- **States:** loading (Spinner while status resolves), connected (Next enabled), disconnected (Next disabled + CTA), TikTok-hover (tooltip "TikTok channel ships in #863").

### Step 2 — Destination (pick a live public page)
- **`SearchInput`** top ("Search live pages by title, brand, or city") + **filter chips** (type: Event/Trip/Experience/RSVP; status: Live/Scheduled). Debounce 250ms.
- **Results = card grid** (2‑up ≥1024, 1‑up below), each card a radio option:
  - 16:9 cover (`cover_media_url`, `object-cover rounded-md`; fallback = branded placeholder tile with `ImageOff` icon when null).
  - Title (`text-sm font-semibold`, line-clamp-1), brand_name (secondary), row: `city` · formatted `master_start_at` (e.g. "Sat, Aug 9"), status `Badge`.
  - Selected → brand ring + check; click anywhere selects.
- **Resolved URL preview** (below grid, appears on select): read-only pill "Ad links to: `{BUSINESS_WEB_ORIGIN}/e/{brand_slug}/{slug}`" with a copy icon. Built client-side from the row's `brand_slug` + `slug` (event → `/e/…`, trip → `/t/…`, brand → `/b/…`).
- **States:** loading (6 skeleton cards), empty ("No live pages match that search. Only public, scheduled/live pages can be targeted." + clear-filters link), error (`AlertCard` + Retry), selected, paginated (Load more).
- **Data:** query `business_public_events_view` via a `services/metaAdsDestinations.js` reader (columns: `id, title, slug, brand_slug, brand_name, cover_media_url, city, master_start_at, status, event_type, visibility`), admin-read (RLS: view grants `authenticated`).

### Step 3 — Media (upload one ad image) — **NEW component `ImageUploader`**
- **Dropzone:** `border-2 border-dashed border-[var(--color-border)] rounded-lg min-h-[240px]`, centered `ImagePlus` icon (32) + "Drag an image here, or click to browse" + constraint line (`text-xs`): "JPG or PNG · ≥1080×1080 · 1:1 or 1.91:1 · max 30 MB" (Meta creative guidance). Keyboard: the zone is a `<button>` wrapping a visually-hidden `<input type=file accept="image/png,image/jpeg">`.
- **On select → client validation** (type, dimensions via `Image()` onload, size). Fail → inline error, no upload.
- **Upload → Supabase Storage** bucket `meta-ad-creatives` (public-read) via the `supabase` client; show a determinate progress bar (animate `scaleX`, not width). On done → store the public URL; show a thumbnail (`aspect-[1.91/1] object-cover rounded-md`) + filename + **Replace**/**Remove**.
- **States:** idle (dropzone), dragover (brand ring + `bg-[var(--color-brand-50)]`), validating, uploading (progress + Cancel), uploaded (preview + Replace), error (message + Retry). Aspect hint tells which placements it best fits (1:1 feed / 1.91:1 link).

### Step 4 — Budget & audience
- **Objective** (native styled `<select>`): **Traffic** (default → `OUTCOME_TRAFFIC`), Awareness, Engagement. Help: "Traffic sends people to your page."
- **Optimization goal** (visible when Traffic): **Landing page views** (default) / Link clicks.
- **Budget:** segmented **Daily | Lifetime** `Toggle`; **CurrencyInput** ($ prefix, cents under the hood) with inline min from the connection ("Minimum $1.00/day"); Lifetime also reveals an **end date** picker. Invalid < min → red border + message, Next disabled.
- **Audience:**
  - **Countries** — **NEW `MultiSelect`** (chips + typeahead; no combobox primitive exists). Default `["US","GB","NG"]` (live markets), editable; at least one required.
  - **Age** — two `<select>`s `age_min`/`age_max` (18…65+); default 18–65; invalid if min>max. Info tooltip: "Advantage+ Audience is on, so age is a suggestion, not a hard cap."
- **States:** default, invalid (budget below min, age min>max, zero countries) with per-field messaging, valid.

### Step 5 — Ad copy
- **Primary text** (`Textarea`, live counter, ~125 char recommended soft-cap with amber hint past it).
- **Headline** (`Input`, ~40 char counter).
- **Description** (`Input`, optional).
- **CTA** (`<select>`): Learn more (default), Book now, Get tickets, Sign up → Meta CTA enums. Every keystroke updates the live preview.

### Step 6 — Review & submit
- **Left = summary**: Channel, Destination (+ URL), Objective/goal, Budget, Audience, Creative (thumb + filename). Each row has an **Edit** link → jumps back to that step (stepper state preserved).
- **Right = the live ad preview** (finalized — see §6a).
- **Primary action:** `Button` "Create campaign (paused)" → submitting (spinner, disabled, other controls locked) → `invokeWithRefresh('admin-meta-create-campaign', …)`.
- **Success:** success `Toast` + inline success panel "Created — **Paused**. Review in Meta, then Launch." + "Go to campaign →" (routes to #862 campaign detail with the Launch control). 
- **Error:** `AlertCard` with the normalized Meta message + `fbtrace_id`; form state preserved for retry; a 422 `destination_not_public` deep-links back to Step 2.

### 6a. Live Ad Preview — **NEW component `AdPreview`** (visible Step 3→6)
Facebook-feed mock, `w-[380px]` white card, `rounded-md shadow-sm`:
- Header: 40px circle avatar (Mingla page profile) + page name `font-semibold text-sm` + line "Sponsored · 🌐" (`text-xs text-muted`, globe = lucide `Globe`).
- Primary text `text-sm` line-clamp-4 (placeholder "Your primary text will show here" in muted when empty).
- Image: full-width at the uploaded aspect (skeleton shimmer until uploaded).
- Link card: `bg-[var(--gray-50)] p-[--space-md]` → display URL (`{brandSlug}.…` uppercase muted), headline `font-semibold text-[15px]` line-clamp-2, CTA button pill (label = chosen CTA).
Reflects live form values; every empty field shows a muted placeholder so the frame never collapses.

---

## 6. Motion (Framer Motion — already a dep)

| Trigger | Property | Curve | Duration | Reduced-motion |
|---|---|---|---|---|
| Step forward | slide-in from right +24px + fade | easeInOut | 250ms | cross-fade only, 150ms, no translate |
| Step back | slide-in from left −24px + fade | easeInOut | 250ms | cross-fade 150ms |
| Stepper pill → active/complete | fill + check draw | easeOut | 200ms | instant color swap |
| Card select | ring fade-in + scale 1→1.01 | easeOut | 150ms | ring appears, no scale |
| Upload progress | `scaleX` 0→1 | linear | live | same (functional) |
| Submit success | preview scale 1→1.02→1 + check | spring (stiffness 300, damping 20) | ~400ms | check fades in, no bounce |

All wrapped so `@media (prefers-reduced-motion: reduce)` (and the admin `ThemeContext`/OS setting) drops transforms to opacity-only.

---

## 7. Accessibility (WCAG AA)

- Stepper: `<ol>` with `aria-current="step"` on active; completed steps are real buttons (keyboard-navigable back).
- Channel & destination cards: `role="radio"` inside `role="radiogroup"` with `aria-checked`; Space/Enter selects; visible focus ring (`--color-brand-500`, ≥2px). Selection conveyed by check icon + ring **and** `aria-checked` (never color alone).
- Uploader: keyboard-operable button + hidden input; `aria-describedby` the constraints; upload progress `role="progressbar"` with `aria-valuenow`.
- All inputs use `Input`/`Textarea` label props (no placeholder-as-label); counters + errors linked via `aria-describedby`; error text is text, not just red.
- Contrast: body/help text AA in both themes; status via icon+label+color; disabled controls keep ≥3:1 non-text contrast.
- Targets ≥44px; focus order = visual order; the sticky footer nav is reachable and not obscured.
- Preview is decorative-of-form → `aria-hidden="false"` but labeled "Live ad preview" region; not a focus trap.

---

## 8. Per-platform deltas
None — single surface (admin web). No iOS/Android/glass variants. Verify at admin breakpoints: **≥1280** (two-column + rail), **1024–1279** (two-column, narrower rail), **<1024** (single column + bottom preview accordion), **<640** (rare for admin; stack all, full-width controls).

---

## 9. Build-ready handoff — component inventory

**Reuse (exist in `src/components/ui/` + `entity/`):** `Button`, `Input`, `Textarea`, `Toggle`, `SearchInput`, `Badge`, `Spinner`/`PageLoader`, `Card`/`SectionCard`/`AlertCard`, `Modal`/`HighRiskActionModal` (discard + edit-jump confirms), `Toast`/`useToast`, `DataTable` (optional), all `globals.css` tokens, `framer-motion`.

**Build new (no precedent):**
1. `CampaignBuilderPage.jsx` (`src/pages/`) + register in `App.jsx` `PAGES` and `constants.js` `NAV_GROUPS` (+ `Rocket` in `Sidebar.jsx` `ICON_MAP` — documented footgun).
2. `WizardShell` + `Stepper` (step state machine, header stepper, sticky footer nav, back-nav gating).
3. `ChannelCard` (selectable radio card).
4. `DestinationPicker` (searchable card grid over `business_public_events_view`).
5. `ImageUploader` (dropzone + Supabase Storage upload + client validation).
6. `MultiSelect` (country chips + typeahead).
7. `AdPreview` (FB-style live preview).
8. `CurrencyInput` (compose `Input` + cents handling).

**New token:** none required — the existing palette/space/radius/type tokens fully cover this. **New shared infra (backend, one item):** a public-read Supabase Storage bucket `meta-ad-creatives` (admin-write policy) so uploaded images have a URL Meta can fetch — specified in the SPEC, not here.

**Quality bar:** SVG/lucide icons only (no emoji-as-icon); both themes contrast-pass; transitions 150–300ms; ≥44px targets; every input labeled; color never the sole signal; reduced-motion honored; no horizontal scroll at any admin breakpoint.
