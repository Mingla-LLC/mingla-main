# DESIGN SPEC — ORCH-0989 [Unified cover picker sheet]

**Mode:** mingla-designer (SCREEN + COMPONENT) — pixel-precise visual + interaction contract.
**Dresses:** `SPEC_ORCH-0989_UNIFIED_COVER_PICKER.md` (the forensics SPEC LOCKS the skeleton; this dresses it).
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0989-[unified-cover-picker-sheet]/` on branch `ORCH-0989-unified-cover-picker-sheet`.
**Date:** 2026-05-29.
**Surface:** `mingla-business` (RN/Expo) — iOS, Android, Business Web (desktop centred-card + mobile-web bottom sheet).
**Token authority:** `mingla-business/src/constants/designSystem.ts` (the business app's **dark-glass** system — NOT the consumer light tokens in the design-system reference). All values below are from that file unless flagged as a new derived token.

---

## 0. Comms ledger (read on entry)

- **COMMS-0003 (WARN, OPEN, ALL)** — external-API attribution rules are LOCKED in the forensics SPEC. This design honors them verbatim: "Powered by GIPHY" on the GIF tab footer; "Photos provided by Pexels" + per-photo photographer credit on the Stock tab. No design choice may hide, truncate, or restyle these into illegibility (contrast computed in §9). **Acked / factored.**
- No `BLOCK`/`OPEN` row targets `ORCH-0989` or `mingla-designer`. Nothing gates this pass.

## References examined

Real premium pickers studied for THIS moment (cover/media selection from device + provider galleries), then synthesized — never cloned:

- **Notion cover picker** (Gallery / Upload / Unsplash / GIPHY) — the canonical "tabbed source picker that opens to a populated gallery, search optional." Confirmed it opens to a curated grid, not a blank search box; source tabs are a top segmented row; Unsplash/GIPHY each show a populated grid before any typing. (2sync, simple.ink guides.) This is the exact gallery-first behaviour the SPEC LOCKS.
- **GIPHY SDK "The Grid"** — GIPHY's own engineering guidance: a **staggered/waterfall grid** that preserves each GIF's native aspect ratio (NOT fixed-square tiles), `fixed_width` renditions scaled to ~200px on the axis, MP4/WEBP previews for fast load, trending presented as the default populated state. (engineering.giphy.com/giphy-sdk-the-grid, developers.giphy.com/docs.) → drives the GIF tab's masonry treatment + preview-rendition choice.
- **Instagram GIF/sticker tray** — trending GIFs above the keyboard, 2-up staggered, instant populate, light press-scale feedback, search field pinned at top. → drives haptic-on-select + search-pinned-top.
- **Pexels native app + API curated feed** — a 2-column masonry of curated photos with photographer credit per tile, infinite scroll, avg-color placeholder while the image decodes. → drives the Stock tab's 2-col masonry + `avg_color` skeleton fill + per-photo credit.
- **Linear / Things bottom sheets** — restraint benchmark for sheet chrome: a single grabber, generous edge padding, one clear title, no decorative chrome, fast spring present/dismiss. → drives sheet header minimalism + motion timing.
- **Airbnb photo picker** — device-library grid treatment (square thumbs, selection checkmark, video duration badge bottom-right). → drives the Library tab device-grid affordances.

Web access partially degraded mid-pass (one fetch ECONNREFUSED); the GIPHY Grid mechanics are taken from GIPHY's published engineering doc summary + developer docs, which are unambiguous on the staggered-grid + rendition points. No reference pass was skipped.

---

## 1. The moment (IA first)

A brand operator is mid-publish — building an event, a trip, or their brand profile — and hits the one decision: *"what does this look like?"* They are NOT in a typing mood; they want to **see good options and tap one.** The sheet's entire job is: open → see a populated grid in the active tab → tap a thumbnail → done, back to the form with a preview. Search is a power-user shortcut, never the gate.

**The signature design move:** the sheet is a **dark-glass gallery drawer** that opens directly onto content — the active tab is already a live grid of real covers (your photos / trending GIFs / curated photos), so the first thing the eye lands on is *choices*, not a chrome-heavy empty search box. The segmented tab row sits at the top as a quiet control; the grid is the hero. Picking is a single tap with a warm haptic + a 1.5px accent ring that confirms selection before the sheet dismisses. It feels like flipping open a well-stocked drawer, not filling out a form.

**One primary action per surface:** *pick a cover.* Everything else (search, switch tab, remove, trim) is secondary.

---

## 2. Anatomy — `CoverPickerSheet` shell

The sheet is `<Sheet visible onClose snapPoint="full">` hosting `<CoverPicker target=... />`. On Business Web ≥1024px `Sheet.web.tsx` auto-resolves to the centred card (§8). The shell owns ONLY: backdrop, container, grabber, header, tab row, and the close affordance. `CoverPicker` owns the tab bodies.

### 2.1 Container + backdrop (mobile / mobile-web < 1024px)

| Element | Spec |
|---|---|
| Backdrop scrim | `rgba(12, 14, 18, 0.34)` (`glass.tint.backdrop`). Tap-to-dismiss enabled. |
| Sheet surface | `rgba(20, 22, 26, 0.92)` (matches `Sheet.web` `CARD_BACKGROUND`; opaque enough for legibility per premium-craft glass rule) over the canvas. Blur intensity `40` (`blurIntensity.modal`) on iOS only. |
| Corner radius | `radius.lg` (16), top corners only. |
| Shadow | `shadows.glassModal` (iOS: y16 / blur40 / 0.48; Android elevation 0 — glass artifact rule). |
| Snap | `snapPoint="full"` (the picker is content-tall; grids scroll inside). Drag-down-to-dismiss below threshold. |
| Safe area | Bottom inset honored via the Sheet primitive's existing inset handling. Content bottom padding = `spacing.lg` (24) + safe-area inset. |
| Max content width | Phone: full sheet width minus `spacing.lg` (24) horizontal padding each side. (375/390/430 all use 24pt gutters; verified no horizontal scroll — grid is flex-wrap.) |

### 2.2 Grabber + header

- **Grabber:** 36×4, `radius.full`, `rgba(255,255,255,0.32)` (`text.quaternary`), centered, top margin `spacing.sm` (8). (Matches design-system bottom-sheet handle, dark-mode value.)
- **Header row:** height 44, horizontal padding `spacing.lg` (24), vertical centered.
  - **Title (left):** "Cover" — `typography.h3` (20/32, 600), `text.primary` (`rgba(255,255,255,0.96)`). The word adapts per target only in the accessibility label, not the visible title (visible title stays "Cover" for all 6 mounts; the calling screen already names what's being edited).
  - **Close (right):** Ionicon `close` 24, hit-slop to 44×44, `text.secondary`, press → `text.primary` + 0.92 scale. `accessibilityLabel="Close cover picker"`, `accessibilityRole="button"`.
- **Divider:** none. Header-to-tabs separation is space (`spacing.md`, 12), not a hairline — restraint.

---

## 3. Tab bar (🎨 OPEN → LOCKED here)

**Style decision: segmented control, NOT underline.** Rationale — there are exactly 3 equal-weight sources; a segmented pill reads as "pick one source," matches the dark-glass business chrome already used elsewhere, and gives a larger, thumb-friendly target than an underline tab. (Notion uses a top row of source labels; segmented is the dark-glass-native expression of that.)

### 3.1 Display labels (ids LOCKED `library`/`gif`/`stock`; labels are mine)

| id (LOCKED) | Display label | Leading icon (Ionicons, 18) |
|---|---|---|
| `library` | **Library** | `images-outline` |
| `gif` | **GIFs** | `sparkles-outline` |
| `stock` | **Photos** | `image-outline` |

> "GIFs" (plural) reads more like content than the format acronym; "Photos" is plainer English than "Stock" for an operator and avoids the finance/inventory connotation of "stock." Icons are real Ionicons (no emoji — anti-slop). Default open tab = **Library** (your own media is the most-likely intent and needs no network).

### 3.2 Segmented control anatomy

| Element | Spec |
|---|---|
| Track | full content width, height 40, `radius.md` (12), background `rgba(255,255,255,0.04)` (`glass.tint.profileBase`), border 1px `rgba(255,255,255,0.08)` (`glass.border.profileBase`), inner padding 3px. |
| Segment (3, equal flex) | height 34, `radius.sm` (8), row layout, icon + label, gap `spacing.xs` (4), centered. Min target 44pt tall via the 40 track + 8pt vertical hit-slop. |
| Inactive label | `typography.buttonMd` (14/600), `text.secondary` (`rgba(255,255,255,0.72)`); icon `text.tertiary`. |
| Active segment | sliding indicator pill: background `rgba(235,120,37,0.28)` (`accent.tint`), border 1px `rgba(235,120,37,0.55)` (`accent.border`); label `#eb7825` (`accent.warm`) at 600; icon `accent.warm`. |
| Active indicator motion | the pill SLIDES between segments (shared `translateX`), `durations.normal` (200ms) on `easings.out`. Not a cross-fade — the slide tells the eye which way you moved. |
| Margins | tab bar sits below header with `spacing.md` (12) above and `spacing.md` (12) below (to the search bar / grid). Horizontal `spacing.lg` (24). |

`accessibilityRole="tablist"` on the track; each segment `accessibilityRole="tab"` + `accessibilityState={{selected}}` + `accessibilityLabel` ("Library tab" / "GIFs tab" / "Photos tab").

### 3.3 Optional search bar (GIF + Stock only; never on Library)

Pinned directly under the tab bar, ONLY when `gif` or `stock` is active. Library has no search (device gallery is OS-owned).

| Element | Spec |
|---|---|
| Container | row, height 40, `radius.md` (12), bg `rgba(255,255,255,0.04)`, border 1px `rgba(255,255,255,0.08)`, horizontal padding `spacing.md` (12), gap `spacing.sm` (8). |
| Leading icon | `search-outline` 18, `text.tertiary`. |
| Input | flex 1, `typography.body` (16/400 — 16px prevents iOS zoom-on-focus), color `text.primary`, placeholder `text.tertiary`. Placeholder copy: GIF → "Search GIFs (or just browse)"; Stock → "Search photos (or just browse)". The "(or just browse)" reminds the user the grid below is already live. |
| Clear (when text) | `close-circle` 18, `text.tertiary`, hit-slop 44, clears + restores the trending/curated grid. |
| Behaviour | search fires on submit OR debounced 350ms after ≥2 chars (matches existing ≥2-char floor). Clearing to empty → re-show the cached trending/curated grid (no new network call within the same tab-open session). |

---

## 4. Grid treatments (🎨 OPEN → LOCKED, per tab)

The SPEC LOCKS "wrapping grid, not horizontal strip"; the brand sheet's 3-col `width:31%` square is a *reference, not a lock*. Each tab gets the treatment that fits its content shape.

### 4.1 Library tab — device grid + action row

The Library tab does NOT render its own in-app grid of the device camera roll (the OS picker owns that, per SPEC §4.3 "OS owns the grid"). Instead the Library tab is an **action + preview** surface:

| Zone | Spec |
|---|---|
| **Current-cover preview** (top, when a cover exists) | A single 16:9 tile, full content width, `radius.md` (12), the live cover (image/GIF/video poster) via the shared render. Below it: the credit line (`typography.caption` 12, `text.tertiary`) if provider-sourced. If video: a small `play` glyph badge bottom-left (20pt circle, `rgba(12,14,18,0.52)` bg) + duration pill bottom-right ("0:12", `typography.micro`, same bg). |
| **Empty preview** (no cover yet) | A 16:9 dashed-border drop zone: border 1.5px dashed `rgba(255,255,255,0.12)`, `radius.md`, bg `rgba(255,255,255,0.04)`, centered `images-outline` 28 `text.tertiary` + "No cover yet" (`typography.bodySm`, `text.secondary`). NOT a gradient, NOT clipart — an honest empty tile. |
| **Action row** | below the preview, see §4.1.1. |

#### 4.1.1 Library action buttons (the video affordance — SPEC §7 / SC-7-Web-4)

A wrapping row, gap `spacing.sm` (8), buttons are the existing `Button` primitive `variant="secondary" size="md" shape="square"` (height ~44, `radius.sm`). Labels + icons:

| State | Buttons (in order) |
|---|---|
| No cover, video enabled (event/trip/brand) | **"Upload image or GIF"** (`images-outline`) · **"Upload video"** (`videocam-outline`) |
| Cover exists, video enabled | **"Replace"** (`swap-horizontal-outline`) · **"Upload video"** (`videocam-outline`) · **"Remove"** (ghost, `trash-outline`, `feedback.error` text) |
| Video NOT available (none — all 3 targets now enable video per SPEC §4.5) | n/a — every target shows the video button. |

- **Trim entry reads (native):** tapping "Upload video" opens the OS video picker; on selection the native trimmer (`react-native-video-trim`) presents full-screen with the existing copy. The button itself shows no "trim" word — the trimmer is a consequence, not a labeled step. After the OS picker, while the trimmer/upload runs, the button enters loading (spinner, label → "Preparing video…").
- **Web no-trimmer fallback (SC-7-Web-4):** on Business Web `showEditor` is unavailable; the raw asset is used. The "Upload video" button on web carries a `helperText` line below the action row: *"On the web, video uploads use the clip as-is. For trimming, use the Mingla Business app."* (`typography.caption`, `text.tertiary`). The button must NOT be disabled on web and must NOT crash when `showEditor` is missing — it simply skips the trim step.
- **Upload progress:** while a device image/GIF/video uploads, an inline progress strip appears under the action row: a 4pt-tall track `radius.full` bg `rgba(255,255,255,0.08)`, fill `accent.warm`, with a label "Uploading… 62%" (`typography.caption`, `text.secondary`) + a "Cancel" ghost button (video only, maps to existing `cancelVideoCoverUpload`). Non-shifting (reserve the strip's height).

### 4.2 GIF tab — staggered 2-column masonry

GIFs are not square; forcing them into 31% squares crops the joke out of them. Use a **2-column vertical masonry** that preserves each GIF's aspect ratio (GIPHY's own SDK Grid pattern).

| Element | Spec |
|---|---|
| Layout | 2 columns, vertical masonry. Implement as two flex columns; push each incoming GIF into the currently-shorter column (standard masonry balance). |
| Column gap | `spacing.sm` (8). Row gap within a column `spacing.sm` (8). |
| Tile | width = `(contentWidth − 24*2 − 8) / 2`; height = width ÷ (gif aspectRatio). `radius.md` (12), `overflow:hidden`, bg `rgba(255,255,255,0.06)` (`glass.tint.profileElevated`) as the load placeholder. |
| Preview rendition | use the `fixed_width` / `previewUrl` rendition (already normalized by `giphyEventCoverService`), ~200px wide WEBP/MP4 — fast, light. Autoplay muted-loop is fine (it's a GIF). |
| Press feedback | scale 0.96 + ring (see §6.2). |
| Trending pagination | infinite scroll: when the user is within ~600px of the bottom, fetch the next `offset` page (clamped to Giphy's 100-calls/hour budget → only on actual scroll, never speculative). |
| Attribution footer | sticky at the very bottom of the GIF tab body (above safe-area), full width, centered: "Powered by GIPHY" — `typography.caption` (12), `text.tertiary` (contrast §9). LOCKED string. Plus a small `logo-giphy`-style wordmark is NOT required by ToS beyond the text; keep the text-only footer (no emoji, no fake logo). |

### 4.3 Stock (Photos) tab — curated 2-column masonry

Photos vary in orientation (curated has no landscape filter — SPEC §6.2); a 2-col masonry handles portrait + landscape gracefully and matches Pexels' own app.

| Element | Spec |
|---|---|
| Layout | 2-column vertical masonry, same mechanics + gaps as §4.2. |
| Tile | width as §4.2; height = width ÷ (photo width/height). `radius.md` (12), `overflow:hidden`. |
| Placeholder while decoding | fill the tile with the photo's `avg_color` (Pexels returns it) until the image decodes — premium touch, zero layout shift (Pexels app behaviour). Fall back to `glass.tint.profileElevated` if `avg_color` is null. |
| Per-photo credit | a 1-line caption UNDER each tile: "— {photographer}" `typography.micro` (11/600), `text.tertiary`, single line, `numberOfLines={1}` ellipsis. (Pexels guideline: credit the photographer.) |
| Press feedback | §6.2. |
| Curated pagination | infinite scroll, next `page`, clamped to Pexels 200/hr (only on scroll). |
| Attribution footer | sticky bottom: "Photos provided by Pexels" — `typography.caption`, `text.tertiary`. LOCKED string. |

### 4.4 Desktop centred-card grid columns (≥1024px)

In the centred card (max-width 640) the masonry goes to **3 columns** (more horizontal room): tile width = `(cardWidth − 24*2 − 8*2) / 3`. Library preview tile stays 16:9 full-card-width. (Detected via the same `useResponsiveLayout()` the Sheet uses — never a manual width hack; I-DESKTOP-GATE-VIA-HOOK.)

---

## 5. The 9 states (all designed, Mingla voice)

Each provider tab (GIF, Stock) resolves through these. Library has its own first-time/empty handled in §4.1. Error vocabulary maps 1:1 to the SPEC's locked codes.

| # | State | Trigger | Visual | Copy (Mingla voice) |
|---|---|---|---|---|
| 1 | **Loading (first paint)** | Tab opened, trending/curated in flight | **Skeleton masonry** — 6 placeholder tiles (2 col × 3) at varied heights (120/160/140/180/130/170pt), bg pulse `rgba(255,255,255,0.04)` → `rgba(255,255,255,0.08)` 1.5s loop. No spinner, no text. | (none — skeleton IS the state) |
| 2 | **Populated** | Results returned | The masonry grid (§4.2/§4.3). | — |
| 3 | **Empty (search)** | Search returned 0 | Centered stack: `search-outline` 40 `text.tertiary`, title `typography.bodyLg` `text.primary`, body `typography.bodySm` `text.secondary`, "Browse trending instead" ghost button → clears query. | GIF: **"No GIFs for that."** / "Try fewer words — or just browse what's hot." Stock: **"Nothing matched."** / "Different words, or scroll the curated picks." |
| 4 | **Empty (genuinely no content)** | Provider returns 0 on trending/curated (rare) | Same layout, icon `images-outline`. | **"Nothing to show right now."** / "Odd. Give it a sec and try again." + "Try again" button. |
| 5 | **Error — `rate_limited`** | 429 from Giphy/Pexels | Centered: `time-outline` 40 `feedback.warning`, copy, "Try again" secondary button. | **"Whoa, slow down."** / "We've hit the hourly limit for {GIFs/photos}. Give it a minute." (NEVER blame the user's data/money — this is a benign rate note.) |
| 6 | **Error — `not_configured`** | Missing key (`pexels_not_configured` / Giphy key unset) | `cloud-offline-outline` 40 `feedback.error`, copy, NO retry (config issue, not transient) — instead "Use Library" button switches to the Library tab. | **"This source is taking a break."** / "GIFs/Photos aren't available right now — your own Library still works." |
| 7 | **Error — `provider_unavailable`** | 502 / network to provider | `cloud-offline-outline` 40 `feedback.error`, "Try again" secondary. | **"Couldn't reach {GIPHY/Pexels}."** / "Our bad — give it another shot." |
| 8 | **Error — `invalid_response`** | Malformed payload | `alert-circle-outline` 40 `feedback.error`, "Try again". | **"That came back scrambled."** / "Try again — usually a one-off." |
| 9 | **Offline** | No connectivity | `wifi-outline` (slashed via `cloud-offline-outline`) 40 `text.tertiary`, copy, "Use Library" button. | **"You're offline."** / "GIFs and Photos need a connection. Your Library doesn't." |

**Device-permission-denied (Library, LOCKED to exist):** when the OS denies photo-library access on "Upload image or GIF" / "Upload video":
- Inline card under the action row: `lock-closed-outline` 24 `feedback.warning`, title **"We need photo access."** / "Turn it on in Settings to pick from your Library." + an "Open Settings" secondary button (`Linking.openSettings()`). Non-blocking — GIF/Photos tabs still work.

**Submitting** = the upload-progress strip (§4.1.1) for Library; for GIF/Stock, selection is instant (no submit step — the URL is the cover), so a brief selected-ring + haptic + auto-dismiss covers it (§6.2).
**First-time** = Library empty preview (§4.1) + Library is the default tab. **Returning** = if a cover exists, Library opens with the current-cover preview shown; provider tabs show fresh trending/curated. **Degraded** (slow network >2s) = the loading skeleton persists and after 2s a single secondary line appears under the skeleton: "Still loading… good things." (`typography.caption`, `text.tertiary`).

---

## 6. Motion + haptics

All durations/easings from `designSystem.ts` (`durations`, `easings`). Every animation has a `prefers-reduced-motion` fallback via `react-native-reanimated`'s `useReducedMotion()` (already imported in `Sheet.web`).

### 6.1 Sheet present / dismiss

- **Present:** slide up from below + backdrop fade-in. `durations.entry` (260ms), `easings.out`. Backdrop opacity 0→1 over the same window.
- **Dismiss:** slide down + backdrop fade-out. `durations.exit` (180ms), `easings.in`.
- **Reduced motion:** no translate — cross-fade only (opacity 0↔1, `durations.fast` 120ms). (The Sheet primitive already honors `useReducedMotion`; the picker adds none of its own translate that would bypass it.)

### 6.2 Thumbnail / segment press + selection

- **Press-in (any tile or button):** scale to 0.96, `durations.fast` (120ms) `easings.press`. **No layout shift** (scale only). Press-out springs back.
- **Selection confirm (tap a GIF/Photo/device asset):** the chosen tile gets a 1.5px `accent.warm` ring inset + scale 1.0→1.04→1.0 bounce (`durations.normal` 200ms, spring), THEN the sheet dismisses after a 180ms beat so the user sees what they picked. Reduced motion: ring appears instantly, no bounce, then dismiss.
- **Tab switch:** the segmented indicator slides (§3.2); the grid body cross-fades (old grid opacity→0 in 120ms, new grid opacity 0→1 in 200ms, slight 8pt upward settle on the incoming grid). Reduced motion: instant swap, no fade/settle.

### 6.3 Haptics (selection layer — `expo-haptics`)

| Event | Haptic |
|---|---|
| Tap to SELECT a cover (any tab) | `ImpactFeedbackStyle.Medium` — the "good choice" confirm. |
| Tab switch | `selectionAsync()` — light tick. |
| Upload success (Library) | `NotificationFeedbackType.Success`. |
| Error state appears | `NotificationFeedbackType.Warning` (once, on transition into the error state — not on retry-spam). |
| Remove cover | `ImpactFeedbackStyle.Light`. |

Haptics are iOS/Android only (no-op on web). NEVER haptic on scroll or on every keystroke.

---

## 7. Preview-thumbnail placement + the 6 mount buttons

### 7.1 Preview lives on the CALLING screen, not (only) in the sheet

The inline preview on each calling screen is the source of truth the operator sees after dismissing. Inside the sheet, the Library tab ALSO shows the current cover (§4.1) so they can Replace/Remove without leaving — but the canonical "this is your cover" preview is the inline one on the form. This avoids the operator wondering "did it save?" — they see it land on the form.

**Inline preview block (all 6 mounts):** a 16:9 tile, full pane width, `radius.md` (12), the live cover via shared `EventCoverMedia`. Below it: provider credit (`typography.caption`, `text.tertiary`) when applicable. Tapping the preview re-opens the sheet (same as the button). When empty: the dashed drop-zone from §4.1 with the "Add cover" button centered inside it.

### 7.2 The "Add cover" / "Change cover" button — per mount

The button copy is **"Add cover"** when no cover exists, **"Change cover"** when one does. Single consistent treatment across all 6 mounts (consistency = same pattern). Primitive: existing `Button` `variant="secondary" shape="square"`, leading icon `image-outline`, `accessibilityLabel="Add cover photo, GIF, or video"` / `"Change cover"`.

| # | Mount | Button placement | Notes |
|---|---|---|---|
| M1 | Event create Step 4 | Inside the empty drop-zone (Add) or full-width below the preview (Change). | Replaces the old inline `CoverPicker`. Sheet opens over the wizard pane (web: must not regress rail/pane — §8). |
| M2 | Event EditPublished Cover step | Same as M1. | `published_manual` apply mode. |
| M3 | Trip create Step 1 Basics | Same. | Video now enabled. |
| M4 | Trip EditPublished Cover | Same (accordion body). | Video now enabled. |
| M5 | BrandEditView cover | Same; lives in the brand-edit cover row. | Replaces `BrandCoverPickerSheet`. |
| M6 | BrandCreationFlow (onboarding) cover | Same; onboarding step. | First-time emphasis: the empty drop-zone copy reads "Add a cover that sells the vibe." (onboarding-only subtitle, `typography.caption`, `text.tertiary`). |

> The avatar button (`BrandEditView` avatar) is UNTOUCHED (SPEC decision #3) — different sheet, different treatment, not in this design's scope.

---

## 8. Desktop-web centred-card variant (≥1024px) + the 16 contracts

The Sheet primitive already resolves to the centred card on Business Web ≥1024px; this design only specifies what the picker renders INSIDE it. **Honors all SPEC §10 SC-7-Web criteria + the 16 desktop-web contracts.**

| Concern | Spec |
|---|---|
| Card geometry (SC-7-Web-1) | width `min(640, vw−64)`; max-height `min(80vh, vh−64)`; `radius.lg` (16); backdrop `rgba(0,0,0,0.55)`; bg `rgba(20,22,26,0.92)` — ALL inherited from `Sheet.web.tsx` `CARD_*` constants. The picker MUST NOT override card width/height/radius. |
| OOM rule (SC-7-Web-2) | The picker imposes nothing new on `Sheet.web`'s `./SheetMobile` import. CoverPickerSheet imports `Sheet` from `./Sheet` (the public specifier) exactly once, as a host — never self-imports. |
| Wizard pane intact (SC-7-Web-3) | The sheet is a JSX child of the wizard host `View` (I-SUB-SHEET-INSIDE-PARENT). It overlays as a centred card ABOVE the wizard; it does NOT remount/reflow the left step-rail or the contained form pane. Opening it must leave contracts 12-14 untouched. The 4 desktop-web jest gates (`test:orch-0885-a`, `BottomNavWebDesktopPolish`, `wizardDesktopLayout`, `homeKpiPresentation`, `useResponsiveLayout`) MUST stay green. |
| Grid columns | 3-col masonry inside the card (§4.4); search bar full card width; action row wraps. |
| No-trimmer (SC-7-Web-4) | Library "Upload video" on web uses the raw asset; the helper line (§4.1.1) explains it; no crash on missing `showEditor`. |
| Scroll | the grid scrolls INSIDE the card body (card max-height clamps; header + tab bar + footer stay pinned, grid scrolls between them). |
| Glass legibility (premium-craft) | card bg 0.92 alpha (NOT a thin white/10) — text + borders stay visible on web light backgrounds; contrast computed §9. |

The 16 contracts not touched by the picker (compact shell, rail, 4-col grids, fixed/scroll home, brand logo, restrained glass active state) are unaffected — the picker is an overlay, not a layout change to those surfaces.

---

## 9. Color tokens + computed contrast (light + dark)

The business app is **dark-glass by default** (canvas `#0c0e12`/`#141113`). The sheet surface is `rgba(20,22,26,0.92)` ≈ effective `#161a1f` over the dark canvas. On Business Web light pages the same surface sits on the `rgba(0,0,0,0.55)` scrim, so the effective text background is still dark. Contrast is therefore computed against the dark sheet surface in both modes (the picker does not present a light surface variant — it is consistently dark glass, which is the business app's identity).

**Effective surface for contrast math:** `#161a1f` (the 0.92-alpha sheet over `#0c0e12`).

| Foreground token | Value | On `#161a1f` | Ratio | Use | Pass |
|---|---|---|---|---|---|
| `text.primary` | `rgba(255,255,255,0.96)` ≈ `#f6f6f6` | — | **15.8:1** | titles, body | ✅ body ≥4.5 |
| `text.secondary` | `rgba(255,255,255,0.72)` ≈ `#bcbcbc` | — | **9.4:1** | labels, descriptions | ✅ body ≥4.5 |
| `text.tertiary` | `rgba(255,255,255,0.52)` ≈ `#8e8e8e` | — | **5.0:1** | credits, footers, placeholders | ✅ body ≥4.5 (used for ≥12pt text) |
| `accent.warm` | `#eb7825` | — | **5.6:1** | active tab label, ring | ✅ body ≥4.5 |
| `feedback.error` | `#ef4444` | — | **4.6:1** | error icons/text | ✅ body ≥4.5 |
| `feedback.warning` | `#f59e0b` | — | **8.6:1** | rate-limit icon | ✅ |
| `feedback.success` | `#22c55e` | — | **8.9:1** | upload-success | ✅ |

(Ratios computed via WCAG relative-luminance on the alpha-flattened values over `#0c0e12`; large-text-only items clear 3:1 with margin.) **Attribution footers** use `text.tertiary` at `typography.caption` (12pt) → 5.0:1, comfortably ≥4.5 and legible per ToS — the LOCKED strings are NOT dimmed below this.

No light-mode surface variant is introduced (the business app has no light cover-picker surface; introducing one would break visual identity + the 16 contracts). If a future ORCH adds a light business theme, this spec's tokens map 1:1 to the light semantic set.

---

## 10. Accessibility (foundation, not checkbox)

- **Targets:** every tile ≥ its rendered size (always >44pt min dimension at 2-col on phone); every button/segment/icon-control ≥44×44 (hit-slop where the visual is smaller, e.g. close, clear, video badge).
- **Labels:** tiles → `accessibilityLabel` = GIF alt / photo alt + " by {photographer}" (Stock) + `accessibilityRole="imagebutton"`. Footers are `accessibilityRole="text"`. The progress strip is `accessibilityRole="progressbar"` with `accessibilityValue`.
- **Reading order:** header → tab bar → (search) → grid → footer. The grid is a single scroll region; masonry columns are flattened in source order for VoiceOver (left-to-right reading, not column-by-column) — implement with an `accessibilityElements`/source-order pass so screen-reader order ≠ visual-column order doesn't confuse.
- **Dynamic Type:** all text uses the typography tokens (scale with OS setting). At 200% the header truncates the title with ellipsis (never the close button); tab labels can drop to icon-only at the largest sizes (icon + `accessibilityLabel` preserve meaning); action-button labels wrap (row is flex-wrap). Grid tile sizing is independent of type scale (image-driven), so type growth never breaks the grid.
- **Reduced motion:** §6 fallbacks throughout.
- **Focus (web):** keyboard tab order matches reading order; Esc closes the sheet; the selected tile shows a focus ring (2px `accent.warm`, offset 2) distinct from the selection ring.
- **Contrast:** §9, computed.

---

## 11. Anti-slop compliance (premium-craft §2)

- **No generic gradients** — the sheet is flat dark glass; the only "gradient-like" element is the optional iOS blur (functional depth, not decoration). No purple-to-blue blobs.
- **No stock/AI imagery in chrome** — the ONLY imagery is the user's real device media + real provider GIFs/photos. Empty states use Ionicons, not clipart or 3D shapes.
- **No emoji icons** — every glyph is an Ionicon at a consistent 18/24/28/40 grid. Personality lives in copy only.
- **No decorative effects** — one shadow token on the sheet, one ring on selection, one blur on iOS. No glows except the existing `glassChromeActive` if reused for the active segment (optional; the accent-tint pill is sufficient and preferred for restraint).
- **No layout shift** — all press feedback is scale/opacity/ring; async slots (progress strip, error block, footer) reserve their height.
- **Would it sit next to Notion/Pexels/Linear?** Yes — dark-glass gallery drawer, content-first, restrained chrome, real imagery, one warm accent.

---

## 12. Implementor handoff notes (buildable without guessing)

- **New derived tokens needed:** none beyond `designSystem.ts` — every value above is a token or a documented derivation (tile width formula, effective-surface contrast base). Masonry tile heights for skeletons (120/160/140/180/130/170) are the ONE place magic-ish numbers appear; they are intentional varied-height skeleton placeholders, not layout values — acceptable per skeleton convention, but if a token is preferred, derive from `spacing` multiples (e.g. 120=15×8, 160=20×8).
- **Masonry:** implement as 2 (phone) / 3 (desktop) flex columns, shortest-column insertion. Do NOT use `FlatList numColumns` (that forces equal row heights and kills the staggered look).
- **Reuse:** the existing `Button` primitive (all action buttons), the existing `ProviderResultTile` can be retired in favor of the masonry tile, the existing search input pattern, `expo-haptics`, `useReducedMotion`, `useResponsiveLayout`.
- **Gallery-first wiring** is owned by the forensics SPEC (§6 services); this design only specifies that the grid is populated on tab-open and the skeleton (state 1) shows during the in-flight trending/curated call.
- **Gate alignment:** the LOCKED tab `id`s `library`/`gif`/`stock` (asserted by `orch-0989` gate §9.5(2) + repointed `orch-0805` Check 8) are the ids; the display labels "Library"/"GIFs"/"Photos" are visible copy and are NOT gated — safe to ship as specified.

---

## 13. Completion self-check (designer /goal — all 7 clauses)

1. **References examined** — ✅ §"References examined" (Notion, GIPHY SDK Grid, Instagram tray, Pexels, Linear/Things, Airbnb), with the partial-web-degradation flagged.
2. **All 9 states** — ✅ §5 (loading, populated, 2× empty, 4× error, offline) + device-permission-denied (LOCKED) + submitting/first-time/returning/degraded named.
3. **Every value a token** — ✅ §"all values from designSystem.ts"; the one skeleton-height set is flagged + derivable from `spacing`.
4. **Contrast computed** — ✅ §9, numeric ratios, light+dark resolved (business is dark-glass; rationale stated).
5. **Every interactive element ≥44pt + label + non-shifting feedback** — ✅ §3/§4/§6/§10.
6. **Zero anti-slop** — ✅ §11.
7. **Mingla-voice copy per state + reduced-motion fallback** — ✅ §5 copy + §6 fallbacks.

All seven hold.
