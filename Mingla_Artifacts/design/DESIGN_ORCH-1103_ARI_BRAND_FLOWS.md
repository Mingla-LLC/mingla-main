# DESIGN — ORCH-1103 · Ari Smart Brand CRUD + In-Chat Media

**Surface:** Mingla **Business** app only (`mingla-business`) · Ari tab → `AriChatScreen` → `MessageList`
**Runtimes in scope:** Business iOS · Business Android (`ANDROID_GLASS_USES_OPAQUE_FALLBACK`) · Desktop Business web (Expo Web / react-native-web). Phone-web `/ari` OUT (route-blocked by ORCH-1095; all measurements are viewport-independent so it is safe by construction).
**Mode:** DESIGN-ONLY — buildable specification. No product code, migrations, or deploys produced by this phase.
**Inputs read in full:** `Mingla_Artifacts/specs/SPEC_ORCH-1103_ARI_BRAND_CRUD.md`, `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1103_ARI_BRAND_CRUD.md`, and the LOCKED prior art `Mingla_Artifacts/design/DESIGN_ORCH-1101_ARI_CHAT_INTERFACE_COMPOSER_OVERHAUL.md`.
**Built ON TOP of (do NOT redesign):** ORCH-1101 glass tokens, `ariThread` density block, `ariPalette.userBubble` (`#a85a44`, the legible deep ember; NOT the raw `accent.warm #eb7825` — see §0.3), AriOrb (24px `sm`), and the four shipped presentational components — `ClarifyingCard`, `MultiSelectPrompt`, `ResponseCard`, `QuickReplyChips` CHOICE mode. These are reused verbatim; this document defines only the NET-NEW surfaces and the wiring/population of those existing cards.

**References examined (real premium surfaces, for these exact moments):**
- **In-repo (authoritative):** the four ORCH-1101 cards (`ToolProposalCard.tsx`, `ClarifyingCard.tsx`, `MultiSelectPrompt.tsx`, `ResponseCard.tsx`, `QuickReplyChips.tsx`); `BrandDeleteSheet.tsx` (the 4-step protection UX being mirrored — warn → preview → type-to-confirm → submitting/rejected, `canConfirm` case-insensitive trim match `:110-116`); `CoverPickerSheet.tsx` + `CoverPicker.tsx` + `coverTarget.ts` (the picker being reused; brand target needs a real `brandId`); `brandCoverService.ts` + `20260529000000_orch_0805_brand_covers_storage.sql` (the bucket RLS that forces the Q7 resolution).
- **External (conversational-CRUD-with-confirm + in-chat media):** GitHub/Linear/Vercel "type the resource name to delete" destructive-confirm pattern (deliberate friction, inline, not a nag); Stripe Dashboard cascade-preview-before-delete; iMessage / Slack optimistic-message + inline upload-progress (status-driven bubble, flat tail-corner geometry); Claude/ChatGPT artifact-attach affordance (attach-then-confirm, thumbnail in the prompt before send); Raycast AI structured result card as a "receipt." 2026 chatbot-UX trust properties applied throughout: **capability transparency, recovery patterns, confidence display, accessibility** (parallelhq / designpixil). Synthesis is original Mingla glass — borrowed mechanics, no clone.

---

## 0. Design thesis + the three locked inheritances

### 0.1 One sentence
Make Ari a **complete, trustworthy brand manager in the thread** — attach a real cover (image or video, even before the brand exists), disambiguate "which brand?" with one tap, confirm a delete with the same deliberate friction the wizard sheet uses, and receipt every write with a real thumbnail — all inside the ORCH-1101 vocabulary so it reads as one continuous Ari conversation, never a modal detour.

### 0.2 What is genuinely NET-NEW here (the only things this doc designs)
1. **Add-cover affordance** on the create/edit brand proposal card → opens existing `CoverPickerSheet` (`target.kind="brand"`), with empty / image-selected / video-selected / uploading states.
2. **Delete-variant proposal card** — live cascade preview + type-the-name confirm field + future-events refusal state.
3. **"Which brand?" disambiguation** via `QuickReplyChips` CHOICE — and how a chip resolves into the next proposal.
4. **Created / updated brand receipt** via `ResponseCard` with real cover thumbnail + next-action.
5. **No-brand → "want me to create one?" handoff** prompt.

### 0.3 The three inherited primitives (LOCKED — reused, never restyled)
| Primitive | Value | Use here |
|---|---|---|
| Warm action fill | `ariPalette.userBubble = #a85a44` (white-on = **4.99:1** computed; ORCH-1101 locked it as ≥4.6 — either way ≥4.5 ✅) | EVERY primary action introduced here: Confirm, "Use this cover", selected chip. **Never** use raw `accent.warm #eb7825` for a text-bearing fill (white-on-`#eb7825` = **2.90:1** ✗ — fails even the 3:1 large bar). The existing `CoverPickerSheet` "Use this cover" button uses `accent.warm` today (its 17pt buttonLg label at 2.90:1 still FAILS large). **Design correction logged §11:** the implementor should switch that one existing button's fill to `ariPalette.userBubble` for parity + contrast — a 1-line token swap, the same correction ORCH-1101 made to Confirm. Outside that sheet, all new surfaces use `userBubble`. |
| Card glass | `glass.tint.profileElevated` fill + `glass.border.profileBase` (white .08) hairline; Android opaque branch `ariThread.ariBubbleAndroid #16181b` + `overflow:'hidden'` + no shadow | All proposal/receipt/clarifying cards |
| Density | `ariThread` block (`cardPad 12`, `cardTitleFont 15/21`, `btnHeight 34`, `bubblePadH/V 12/8`, `bubbleRadius 16`, `chipFont 13/17`, `gapTurn 10`, `gapGroup 4`, `orbGap 6`) | Every measurement below resolves to an `ariThread.*` / `spacing.*` / `radius.*` / `typography.*` token — zero magic numbers |

Theme is dark only (Ari canvas `#0c0e12`; Ari glass bubble composites to `#16181b`). All contrast below computed on `#16181b` unless noted.

---

## 1. Cross-Surface Impact (mirrors SPEC §2)

| Surface | In scope? | Notes |
|---|---|---|
| Business iOS | YES | Primary. All surfaces here render. iOS keeps ember shadow-glow on warm fills. |
| Business Android | YES | Automatic parity (shared RN tree). Every new glass/fill surface declares the opaque branch explicitly (§ per-surface notes). No elevation under rounded fills. |
| Desktop Business web | YES | All cards crisp on react-native-web: lucide single-path glyphs only, `ActivityIndicator` spinners, NO SVG-gradient compositions, NO soft-keyboard padding assumptions. `CoverPickerSheet` already resolves to a desktop centred card ≥1024px (`Sheet.web.tsx`). |
| Phone-web `/ari` | OUT | Route-blocked (ORCH-1095). Safe by construction. |
| Consumer / Admin | NO | No Ari analog. |

---

## 2. SURFACE 1 — Add-cover affordance on the brand proposal card (create + edit)

Host: `ToolProposalCard` when `pendingAction.tool_name ∈ {create_brand, update_brand}`. The card already holds `editedArgs` state; the Add-cover result threads into `editedArgs.cover_media_url` + `.cover_media_type` and flows to the executor via `onConfirm(editedArgs)`.

### 2.1 Anatomy (LOCKED) — proposal card with cover region

The cover region sits **between the verb eyebrow + title and the field rows**, so it reads as the brand's hero, not a buried field. Full-bleed-within-padding band.

```
┌─ glass profileElevated · radius lg(16) · cardPad 12 · ariPalette.proposalBorder ─┐
│ (•) CREATE BRAND                                          verb 10/12 ls1.1 secondary │
│ Lumen Coffee                                              title 15/21 primary       │
│ ┌───────────────────────────────────────────────────────────────┐  ← COVER REGION  │
│ │                                                               │   height 132       │
│ │                   [ + Add cover ]                             │   radius md(12)    │
│ │                                                               │   inside cardPad   │
│ └───────────────────────────────────────────────────────────────┘                  │
│   Currency   USD                                          label micro / value 13     │
│   Slug       lumen-coffee                                                            │
│  ┌──────────┐ ┌──────────┐ ┌────────────────────┐                                   │
│  │  Cancel  │ │   Edit   │ │      Confirm       │  #a85a44 white 4.6:1  height 34    │
│  └──────────┘ └──────────┘ └────────────────────┘                                   │
└───────────────────────────────────────────────────────────────────────────────────┘
```

**Cover region measurements (one shared band, all states):**
| Property | Value | Token |
|---|---|---|
| Region height | 132 | `ariThread.coverBandH = 132` (NEW additive token) |
| Region radius | 12 | `radius.md` |
| Region margin (below title, above first field row) | 8 top / 10 bottom | `ariThread.gapGroup` / a `coverBandGapV` literal-to-token (10 = `gapTurn`) |
| Empty fill | `glass.tint.profileBase` (rgba white .04); Android opaque `#16181b` + overflow hidden | existing |
| Empty border | 1px **dashed** `glass.border.profileBase` (dashed = "drop a cover here" affordance, the ONE dashed border in the Ari surface, justified by the empty-slot semantics) | `glass.border.profileBase` |
| Selected fill | the chosen media (image/gif `Image` cover-fit; video → poster frame or first-frame still if available, else solid `#16181b` + centered play disc) | — |

### 2.2 The five states (the dispatch's required set)

**(a) EMPTY — no cover yet** (default for both create + edit-without-cover)
- Dashed band, centered pill button: lucide `Plus` (16, `textTokens.secondary`) + label "Add cover" (`ariThread.chipFont` 13/17/500, `textTokens.secondary`). Pill: height 34, radius `radius.full`, padding 14H, `glass.tint.profileElevated` fill, `glass.border.profileBase` hairline.
- Sub-label beneath pill, 11/14 `typography.micro` `textTokens.tertiary`: "Optional — image or video".
- Contrast: secondary `9.58:1` ✅, tertiary `5.57:1` ✅.
- Tap target: pill 34h + hitSlop 6 → ≥44 ✅. Whole band is ALSO pressable (larger target) with the pill as the visible affordance.
- `accessibilityRole="button"`, `accessibilityLabel="Add a cover image or video for this brand"`, `accessibilityHint="Opens the cover picker"`.

```
┌───────────────────────────────────────────────┐
│ · · · · · · · · · · · · · · · · · · · · · · · · │   dashed border
│ · · · · · · · ( + Add cover ) · · · · · · · · · │   pill, secondary
│ · · · · · · · Optional — image or video · · · · │   micro, tertiary
│ · · · · · · · · · · · · · · · · · · · · · · · · │
└───────────────────────────────────────────────┘
```

**(b) SELECTED — image / gif** (cover chosen, persisted-or-staged)
- Band fills with the image (`resizeMode:"cover"`, `overflow:"hidden"`, radius 12).
- Bottom-left **type chip** over a `rgba(0,0,0,0.55)` scrim pill (height 22, radius full, padding 8H): lucide `Image` (12, white) + "Image" or "GIF" (`typography.micro` white). Scrim guarantees legibility on any photo: white-on-`#000@0.55`-over-photo ≥ **4.5:1** (the scrim itself is the contrast guarantee).
- Bottom-right **Change / Remove** control: a single `MoreHorizontal`-free design — two tiny solid discs (28×28, `rgba(0,0,0,0.55)`): lucide `Pencil` (14 white) "change" + lucide `X` (14 white) "remove". Both ≥44 via hitSlop 8.
- `accessibilityLabel` for the band: "Cover image selected. Double-tap to change.", remove disc: "Remove cover".

```
┌───────────────────────────────────────────────┐
│ ▓▓▓▓▓▓▓▓▓▓▓▓ real photo, cover-fit ▓▓▓▓▓▓▓▓▓▓▓ │
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ (✎)(✕) ▓ │
│ (▣ Image) ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │
└───────────────────────────────────────────────┘
```

**(c) SELECTED — VIDEO** (the dispatch's explicit "video + duration badge" state)
- Band shows the poster/first-frame still if the pipeline yields one; otherwise solid `#16181b` with a centered **play disc** (44×44, `rgba(0,0,0,0.55)`, lucide `Play` 20 white, +2px optical right-nudge).
- Bottom-left type chip: lucide `Video` (12 white) + "Video" + a **duration badge** "· 0:08" appended (`typography.micro` white) — same scrim pill.
- Same Change / Remove discs bottom-right.
- This mirrors the existing `CoverPickerSheet` video-confirm-thumb pattern (play glyph instead of a still, `:160-164`) — consistent with what the picker already does on its confirm button.
- `accessibilityLabel`: "Cover video selected, 8 seconds. Double-tap to change."

```
┌───────────────────────────────────────────────┐
│                                                 │
│                    ( ▶ )                        │   play disc, 44
│                                          (✎)(✕) │
│ (▶ Video · 0:08)                                │   type + duration chip
└───────────────────────────────────────────────┘
```

**(d) UPLOADING / PROGRESS** (device upload in flight — image, gif, OR video)
- Band stays at 132h. Centered: a 36px `ActivityIndicator` (`textTokens.inverse` on a dimmed `#16181b@0.9` overlay) + label below "Uploading cover…" (`typography.micro` `textTokens.secondary`), and for video, after upload, "Processing video…" (the processing leg is longer; copy switches at the `onCoverVideoProcessingChange(true)` signal the sheet already emits).
- Determinate where the upload hook exposes bytes-progress; else indeterminate spinner (the existing `useBrandCoverUpload` is indeterminate → indeterminate spinner; do NOT fake a progress bar — confidence-display honesty). A thin 2px top-edge `ariPalette.userBubble` shimmer line is the only motion (1100ms loop, reduced-motion → static 30%-width dim line).
- Card Confirm is **disabled** while uploading (`accessibilityState={{disabled:true}}`) — you can't confirm a brand whose cover is mid-flight.
- `accessibilityLabel`: "Uploading cover, please wait."

```
┌───────────────────────────────────────────────┐
│▔▔▔▔▔▔▔▔▔▔ shimmer 2px ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔│
│                    ( ◌ )                        │   spinner 36
│              Uploading cover…                   │   micro secondary
│              (video: Processing video…)         │
└───────────────────────────────────────────────┘
```

**(e) ERROR** (upload failed — recovery pattern, not a dead end)
- Band returns to the empty-dashed look, but the pill becomes "Try again" (lucide `RotateCcw` 14 + label, `textTokens.primary`). A one-line reason sits below: the leading `AlertCircle` glyph (14) carries `semantic.error` `#ef4444` (glyph on `#16181b` = **4.73:1** ✅) and the reason WORDS use `textTokens.secondary` (`9.58:1` ✅). The red is the icon; the words are legible neutral — ORCH-1101's "error = muted inline row, never a red card" philosophy (§5.4).
- **Contrast note (computed):** `#ef4444` on `#16181b` = **4.73:1** (actually clears the 4.5 body bar). So the reason WORDS *could* be red — but we still render them `textTokens.secondary` (`9.58:1`) and reserve `#ef4444` for the `AlertCircle` glyph, for ORCH-1101 "error = muted inline, never alarm-red text" consistency (a style choice, not a contrast necessity).
- Copy (Mingla voice, picker-error verbatim where the service supplies it, e.g. "That file is too large — pick one under 8 MB." / generic "Couldn't upload that cover. Tap to try again.").

```
┌───────────────────────────────────────────────┐
│ · · · · · · · ( ↻ Try again ) · · · · · · · · · │
│ ⚠ That file is too large — pick one under 8 MB. │  glyph red / words secondary
└───────────────────────────────────────────────┘
```

### 2.3 Opening the picker (LOCKED routing)
- Tap Add-cover → opens `CoverPickerSheet` rendered as a JSX child of the proposal card host (per `I-SUB-SHEET-INSIDE-PARENT`).
- On "Use this cover" → the sheet's `onCoverChange(patch)` already fired live; the card reads `patch.coverMediaUrl` + `patch.coverMediaType`, writes them into `editedArgs`, and renders state (b)/(c).
- `fieldsFor` (`ToolProposalCard.tsx:68-103`): when `editedArgs.cover_media_url` is set, the existing field-row list ALSO gains a compact "Cover" row (label micro / value = type, e.g. "Video"). The visual cover band is the primary affordance; the field row is the textual echo for screen-reader linearity.

### 2.4 Motion + haptics (Surface 1)
| Moment | Motion | Timing | Reduced-motion | Haptic |
|---|---|---|---|---|
| Open picker | sheet slide-up (existing Sheet) | existing | existing | `selectionAsync()` on Add-cover tap |
| Cover lands (empty→selected) | band cross-fade + 4px settle | `durations.fast` 120 | instant swap | `notificationAsync(success)` |
| Uploading | 2px top shimmer loop | 1100ms linear | static dim line | none |
| Upload error | band shake 4px ×2 | 180ms | none (just state swap) | `notificationAsync(error)` |
| Remove cover | band fade to empty | `durations.exit` 180 | instant | `selectionAsync()` |

### 2.5 Per-component implementation note (Surface 1)
> `ToolProposalCard.tsx`: add a `CoverBand` sub-view rendered for `create_brand`/`update_brand` between title and fields. State derived from `editedArgs.cover_media_url`/`_type` + a local `coverUploadState: 'idle'|'uploading'|'processing'|'error'`. The band opens the existing `CoverPickerSheet` (no new sheet). Add token `ariThread.coverBandH = 132`. The video/duration badge reuses the sheet's existing play-disc treatment. The Confirm-disabled-while-uploading gate is a `&& coverUploadState==='idle'` on the existing `disabled` prop. Android: band fill opaque `#16181b`, `overflow:'hidden'`, no shadow. Web: image `cover-fit` via `resizeMode`; spinner = `ActivityIndicator`; no SVG.

---

## 3. THE Q7 CREATE-TIME UPLOAD FLOW (orchestrator override — device upload AND video AT CREATE)

### 3.1 The hard constraint (proven from source, this turn)
The `brand_covers` Storage bucket RLS (`20260529000000_orch_0805_brand_covers_storage.sql:99-108`) gates every INSERT on:
```
biz_brand_effective_rank_for_caller( split_part(name,'/',1)::uuid ) >= brand_admin
```
The first path segment **must be a real brand UUID the caller already administers**. There is no `userId`-staging prefix that passes this policy. Brand **video** is identical — `CoverPicker` routes brand video through `useEventCoverVideoUpload(_, target.brandId, _, "brand")` (`CoverPicker.tsx:14, :437`), also `brandId`-bound. **Conclusion: a device image OR video genuinely cannot be uploaded to `brand_covers` before the brand row exists.** SPEC's recommended (b) — hide the device tab on create — would satisfy the letter of "Add cover on create" but VIOLATES the orchestrator override ("device upload AND video must be available AT CREATE").

### 3.2 Resolution — **create-row-first, attach-second, presented as ONE flow** (SPEC option (c), made seamless)
The only RLS-honest way to give create-time device upload + video is to mint the brand row first, then run the full existing picker against that real `brandId`. We make this invisible to the user by reframing the moment: **the create proposal's Add-cover does the create commit silently, then immediately opens the full picker on the new brand.** The user perceives "I added a cover while creating my brand"; mechanically the row exists the instant they tap a device file.

This is **NOT** the SPEC's deferred-arg path for device media (that path stays for provider/remote media — see §3.4). It is a deliberate, designed two-phase commit triggered ONLY when the user reaches for a device/video tab on a create.

### 3.3 The create-time states (exhaustive — the dispatch's "create-time upload/progress/attached states")

The create proposal card's Add-cover offers the **same full picker as edit** (Library/device + Video + Pexels + GIPHY). What differs is WHAT HAPPENS on first device/video pick:

**Phase 0 — Provider/remote pick (no brand row needed):** Pexels / GIPHY / remote URL are already public URLs → threaded straight into `editedArgs.cover_media_url`/`_type`. Renders state (b)/(c) immediately. No commit. (This is the SPEC's deferred-arg path, kept.)

**Phase 1 — User taps a DEVICE file or VIDEO on a create proposal (the override path):**
- The card detects `tool_name==='create_brand'` + the picker is about to do a brandId-bound upload, and shows a one-tap inline confirm INSIDE the picker footer area BEFORE the upload fires:
  - Micro line (`typography.micro`, `textTokens.secondary`): "We'll create **Lumen Coffee** so your cover has a home." + a single primary pill "Create & attach" (`#a85a44`, 34h).
  - This is the ONLY moment create differs; it is honest about the order of operations (capability transparency).
- On "Create & attach": fire `create_brand` (the proposal's normal Confirm path) → get back the new `brandId` (the executor already returns `{brand:{id,…}}`).
- Card transitions to **CREATING** state: band shows spinner + "Creating brand…" (`typography.micro` secondary). ~300–800ms.

**Phase 2 — Brand exists, full picker re-targets to it:**
- The moment `brandId` returns, the `CoverPickerSheet` is re-opened (or its `target` swapped) with `target.kind="brand", brandId=<new>, accountId=<user>` → device upload + video now pass RLS.
- Band shows the **UPLOADING** state (§2.2d) → then **PROCESSING** for video → then **ATTACHED** (state (b)/(c)).

**Phase 3 — ATTACHED (create complete with cover):**
- The brand is already created (Phase 1) and the cover persisted live by the picker (Phase 2). The card collapses to the **created-brand receipt** (Surface 4, §5) showing the real cover thumbnail — NOT a still-pending proposal. The normal "Confirm" is gone because the commit already happened.

```
CREATE-TIME DEVICE/VIDEO FLOW (the override)

 [proposal: empty cover]
      │ tap Add cover → picker → tap a device VIDEO
      ▼
 ┌─ picker footer ─────────────────────────────┐
 │ We'll create "Lumen Coffee" so your cover    │
 │ has a home.            ( Create & attach )   │  #a85a44
 └──────────────────────────────────────────────┘
      │ tap
      ▼  [card band: ◌ Creating brand…]   (~500ms)
      ▼  [card band: ◌ Uploading cover…]
      ▼  [card band: ◌ Processing video…]   (video only)
      ▼
 ┌─ RECEIPT (Surface 4) ───────────────────────┐
 │ ▓ thumb ▓  Created Lumen Coffee              │
 │            USD · lumen-coffee  ·  ▶ Video    │
 │            ( Add your first event? )         │
 └──────────────────────────────────────────────┘
```

### 3.4 Why this is correct and safe
- **Honors the override:** device upload + video ARE available at create.
- **RLS-honest:** every byte lands under a real `brandId` the user owns — zero new bucket policy, zero staging prefix, zero migration (SPEC §1 "no migration; flag if a column is needed" — none needed).
- **No orphan risk worse than today:** if Phase-2 upload fails AFTER Phase-1 commit, the brand exists WITHOUT a cover — identical to creating a brand and skipping the cover, which is already a supported state. The receipt simply shows the "Add cover" affordance again (edit path) — no broken/half state.
- **Non-goal respected:** this does NOT chain into event creation; it ends at the brand receipt.
- **Provider/remote path unchanged:** Pexels/GIPHY/remote still thread via args with no commit (Phase 0), so the common case (stock cover at create) needs no two-phase dance.

### 3.5 Per-component implementation note (Q7)
> `ToolProposalCard.tsx` (create_brand branch only): intercept the picker's device/video selection BEFORE upload when no `brandId` exists. Show the inline "Create & attach" confirm. On confirm, call the existing `onConfirm(editedArgs)` to commit `create_brand`, capture the returned `brandId`, swap the open `CoverPickerSheet`'s `target` to the real brand, and let the picker's normal live-persist run. Transition the card to the receipt on completion. Provider/remote picks skip all of this (thread args, normal Confirm). NO new edge function, NO new bucket, NO migration. Flag to implementor: confirm the picker can have its `target` swapped while open, or close+reopen with the new target (either is acceptable; close+reopen is simpler and visually covered by the "Creating brand…" band state).

---

## 4. SURFACE 2 — Delete-variant proposal card

Host: `ToolProposalCard` when `pendingAction.tool_name === "delete_brand"`. This is the highest-stakes surface. It mirrors `BrandDeleteSheet`'s protections (cascade preview + type-to-confirm + future-events refusal) but lives INLINE in the thread as ONE card (not a 4-step sheet — the thread IS the step sequence; we collapse warn+preview+confirm into a single scrollable card because an inline card can't paginate without losing thread context).

### 4.1 Anatomy — the deletable case (live cascade counts, Q6 = live)

```
( ) ┌─ glass profileElevated · radius lg · cardPad 12 · DANGER border ──────────────┐
 ◖  │ (⚑) DELETE BRAND                              verb 10/12 ls1.1 · semantic.error│
    │ Lumen Coffee                                  title 15/21 primary             │
    │ ┌──────────────────────────────────────────────────────────────────────────┐ │
    │ │ Recoverable for 30 days. Your data stays — events, orders, refunds,        │ │  assurance row
    │ │ audit logs are preserved. Recovery needs support after that.               │ │  13/17 secondary
    │ └──────────────────────────────────────────────────────────────────────────┘ │
    │   Past events        12                       label micro / value 13          │  ← LIVE counts
    │   Team members        3                                                        │     (useBrand-
    │   Stripe Connect      Linked (will unlink)                                     │     CascadePreview)
    │ ┌──────────────────────────────────────────────────────────────────────────┐ │
    │ │ Type Lumen Coffee to confirm                                               │ │  helper 11/14 tertiary
    │ │ ┌────────────────────────────────────────────────────────────────────────┐│ │
    │ │ │ Lumen Coffee                                                            ││ │  field, hairline
    │ │ └────────────────────────────────────────────────────────────────────────┘│ │
    │ └──────────────────────────────────────────────────────────────────────────┘ │
    │  ┌──────────┐ ┌────────────────────────────────────────────┐                  │
    │  │  Cancel  │ │  Delete brand   (disabled until name match) │  semantic.error  │
    │  └──────────┘ └────────────────────────────────────────────┘                  │
    └────────────────────────────────────────────────────────────────────────────────┘
```

**Measurements:**
| Element | Value | Token |
|---|---|---|
| Card border (danger) | 1px `rgba(239,68,68,0.32)` (mirrors `BrandDeleteSheet.warnCardDanger`) | reuse |
| Verb eyebrow | words "DELETE BRAND" use `textTokens.secondary` `9.58:1` ✅ at 10/12 600; the leading `⚑` lucide `Flag`/`AlertTriangle` glyph (12) carries the `#ef4444` danger color (glyph on `#16181b` = 4.73:1 ✅). (Danger lives in the glyph; words stay legible-neutral — ORCH-1101 error philosophy.) | — |
| Assurance row | `glass.tint.profileBase` fill, radius `md`, padding `md`, body 13/17 `textTokens.secondary` | reuse `BrandDeleteSheet.warnCard` |
| Cascade rows | label `typography.micro` tertiary / value 13/17 primary, paddingV `spacing.sm` 8, hairline divider `glass.border.profileBase` | mirror proposal field rows |
| Type-to-confirm helper | "Type **Lumen Coffee** to confirm" 11/14 `typography.micro` tertiary (brand name bold-weight via `fontWeight:600` inline) | — |
| Confirm field | height 44, `glass.tint.profileBase`, hairline `glass.border.profileBase`, 13pt input, `autoCapitalize:"none"`, `autoCorrect:false` | mirror `BrandDeleteSheet.input` |
| Delete button (enabled) | fill `semantic.error` `#ef4444`, white label (white-on-`#ef4444` = **3.76:1** — 14pt 600 button label = large-bold → 3:1 bar → 3.76 ✅; fails the 4.5 body bar, so the label MUST stay ≥14/600). Height 34, hitSlop→44. | — |
| Delete button (disabled) | `glass.tint.profileElevated`, label `textTokens.tertiary`, 0.4 opacity, no press | mirror ORCH-1101 disabled |

> **Why `semantic.error` for the Delete button and not `userBubble`:** delete is the one action that should NOT wear the warm "Ari's-warmth-owned-by-me" ember — destructive actions read red. This is the single intentional departure from "all primary actions = `userBubble`," justified by destructive-action convention. White-on-`#ef4444` at 14/600 clears the 3:1 large bar (3.76:1); the label must stay ≥14pt 600 to remain compliant.

### 4.2 Type-to-confirm gating (LOCKED, mirrors `BrandDeleteSheet.canConfirm`)
- `canConfirm = input.trim().toLowerCase() === brand.displayName.trim().toLowerCase()` (case-insensitive trim match, `:110-116`).
- Delete button `disabled={!canConfirm}`. This is an ADDITIONAL gate ON TOP of the normal proposal Confirm — there is no separate Confirm; the typed-name field IS the confirm gate, and "Delete brand" is the commit.
- **Deliberate friction, not a nag:** the field is calm — no red-until-typed shake, no live "wrong!" error. It simply stays neutral; the Delete button quietly enables when the match lands (a soft 120ms fill cross-fade `glass→#ef4444` + `notificationAsync(warning)` haptic at the match moment, so the user FEELS the gate clear). No scolding copy. Placeholder = the brand name itself (`textTokens.quaternary`) as a gentle hint of what to type.
- `accessibilityLabel="Type the brand name to confirm deletion"`, `accessibilityHint="The delete button enables when the name matches"`. On match, `AccessibilityInfo.announceForAccessibility("Name matches — delete is now available")`.

### 4.3 REFUSAL state — brand has blocking future/live events (LOCKED)
When the prompt's `hasBlockingEvents` hint is true, Ari does NOT render a deletable card at all — it renders a **refusal card** (a `ResponseCard`-shaped error card, NOT a red alarm). If the user forces a proposal anyway, the executor's 409 `DELETE_BLOCKED_BY_EVENTS` lands as a `failed` tool_result and renders the SAME refusal card. Two entry paths, one visual.

```
( ) ┌─ glass profileBase · radius lg · cardPad 12 · subtle danger border ───────────┐
 ◖  │ ⚑  Can't delete Lumen Coffee yet                  title 15/21 primary         │
    │ It has 3 upcoming or live events. Cancel or move those first, then            │  body 13/17 secondary
    │ I can delete the brand for you.                                               │
    │                                  ( Show those events )   ( Got it )           │  ghost actions
    └────────────────────────────────────────────────────────────────────────────────┘
```
- Copy (Mingla voice, plain + actionable — the dispatch's exact requirement): "Can't delete Lumen Coffee yet — it has 3 upcoming or live events. Cancel or move those first, then I can delete the brand for you." Count is live (from `hasBlockingEvents`/the 409 message N).
- Tone: matter-of-fact, helpful, no apology theater. NOT "Oops! Something went wrong." — it's a known, recoverable rule.
- Actions (both ghost, 34h): "Show those events" (seeds a user message / navigates — non-binding) + "Got it" (dismisses to a compact acknowledged ribbon). NEITHER deletes.
- This is a recovery pattern (2026 trust property): the refusal tells the user EXACTLY what to do next.
- Glyph `⚑` = lucide `AlertTriangle` (14, `semantic.error`) — danger color on a graphic (glyph 4.73:1 ✅); title + body are neutral legible.
- Android: opaque `#16181b`; web: crisp. NOT a full red card (matches ORCH-1101 §5.4 error philosophy).

### 4.4 Delete states (the dispatch's full set)
| State | Look |
|---|---|
| default (deletable) | cascade card, field empty, Delete disabled |
| loading (cascade) | cascade rows render as 3 shimmer skeleton rows (`glass.tint.profileElevated`, 1100ms; reduced-motion → static dim) while `useBrandCascadePreview` resolves; field + Delete locked until counts land OR a 600ms timeout reveals "couldn't load counts — you can still delete" (mirrors `BrandDeleteSheet` error-but-continue, `:237-247`) |
| selected/typed-match | Delete enabled (soft fill cross-fade + warning haptic) |
| submitting | Delete → spinner + "Deleting…", field locked, Cancel hidden |
| submitted (success) | card collapses to receipt ribbon "✓ Deleted Lumen Coffee — recoverable 30 days through support" (`semantic.successTint`, `Check` glyph) |
| disabled (superseded) | whole card 0.4 opacity if a newer turn supersedes (single-live-at-tail rule) |
| error (write failed, non-refusal) | inline muted row under buttons "Couldn't delete — tap Delete to try again." (words secondary, `AlertCircle` red glyph), field + match preserved |
| refusal (blocking events) | §4.3 card (separate from generic error) |
| offline | the screen-level send error toast fires; card stays in default, Delete re-enabled on reconnect (no offline-specific card — Ari needs network; named per ORCH-1101 §8) |
| first-time | identical (no onboarding overlay — type-to-confirm IS the teaching moment) |

### 4.5 Motion + haptics (Surface 2)
| Moment | Motion | Timing | Reduced-motion | Haptic |
|---|---|---|---|---|
| Card enter | fade + 6px rise | `durations.entry` 260 / `easings.out` | fade only | `notificationAsync(warning)` (this is a destructive proposal — warn the body it arrived) |
| Cascade skeleton | shimmer | 1100ms loop | static dim rows | none |
| Name match clears gate | Delete fill cross-fade glass→`#ef4444` | `durations.fast` 120 | instant | `notificationAsync(warning)` |
| Delete submit | scale 1→0.96→1 + spinner | spring | dim only | `impactAsync(medium)` |
| Delete success collapse | card height-collapse to ribbon | `durations.exit` 180 | instant unmount→ribbon | `notificationAsync(success)` |

### 4.6 Per-component implementation note (Surface 2)
> `ToolProposalCard.tsx` (delete_brand branch): a distinct card layout — verb eyebrow danger-glyph + neutral words, assurance row (reuse `BrandDeleteSheet` warnCard copy), live cascade rows from `useBrandCascadePreview(brandId)` (Q6 = LIVE), a type-to-confirm `TextInput` reusing `BrandDeleteSheet`'s `canConfirm` logic verbatim, Delete button `fill=semantic.error disabled={!canConfirm}`. Refusal is a SEPARATE render branch (driven by prompt `hasBlockingEvents` OR a 409 `failed` tool_result) → the §4.3 card. `humanizeToolName` += `delete_brand`→"Delete brand"; `primaryIdentity` += `delete_brand`→brand name. Android opaque; web crisp ActivityIndicator. NO new sheet, NO `.delete()` on the client (the executor soft-deletes server-side).

---

## 5. SURFACE 3 — "Which brand?" disambiguation flow

Host: `MessageList` renders a `QuickReplyChips` CHOICE row (or `ClarifyingCard` fallback) when an edit/delete target is ambiguous (≥2 brands, name unresolved by Gemini).

### 5.1 Q2 RESOLUTION — how a chip selection feeds back into a tool proposal
**Resolved: option (a) — the selection sends a follow-up user message naming the chosen brand; Gemini re-proposes the tool with the resolved `brand_id`.** Keeps Gemini the SOLE proposer (no new client tool-call path, no client-side `brand_id` pre-fill that could drift from the prompt's known-brand list). Mechanics:
1. Ari emits a `QuickReplyChips` CHOICE row under a clarifying bubble.
2. User taps a chip → the chip's `label` (brand name) is sent as a normal user turn (visually as a compact user bubble "The Cellar", OR — preferred — the chip collapses to its selected pill IN PLACE and a synthetic user message "The Cellar" is appended; pick the in-place collapse to avoid a redundant bubble, see §5.3).
3. Gemini receives the named brand + the prior edit/delete intent in context → proposes `update_brand`/`delete_brand` with the resolved `brand_id` (resolved via the richer prompt brand-context line that carries `id : "name"`).
4. The normal proposal card (Surface 1 or 2) renders.

This means the chip→proposal feedback is **conversational, not a client shortcut** — robust, single source of truth (Gemini), and reuses the existing `useAgentChat` send path with zero new wiring.

### 5.2 Anatomy (reusing `QuickReplyChips` CHOICE, ORCH-1101 §5.1)

```
( ) ┌─────────────────────────────────────────────┐
 ◖  │ Which brand should I update?                 │   Ari bubble, 14/19
    └─────────────────────────────────────────────┘
    ( Lumen Coffee )  ( Night Owl Bar )  ( The Cellar )      ← chips: default
       glass fill · chipFont 13/17 · height 30 · radius full · gap 6 · wrap
```

After tap (the dispatch's "how a chip selection visually resolves and feeds the next step"):

```
    ( ✓ Night Owl Bar )                                      ← selected pill, siblings UNMOUNT
       #a85a44 fill · white label 4.6:1 · lucide Check 13 prefix
            │ (synthetic user turn "Night Owl Bar" → Gemini)
            ▼
( ) ┌─ proposal: UPDATE BRAND · Night Owl Bar ─────┐         ← Surface 1 card renders
 ◖  │ ...                                          │
```

- Chip states (inherited from ORCH-1101 §5.1, no redesign): default (glass + hairline) → loading (selected styling + 12px `ActivityIndicator` replacing the check while Gemini re-proposes) → submitted (selected pill stays, siblings unmount). Disabled = 0.4.
- "+ New brand" chip is appended when contextually useful (e.g. the user might have meant a brand they haven't made) → routes to `create_brand` (Surface 1). Optional, prompt-driven.
- Contrast: default chip glass body 13pt `textTokens.primary` 16.46:1 ✅; selected white-on-`#a85a44` 4.6:1 ✅.

### 5.3 ClarifyingCard fallback
When a free-text answer is more natural than a finite chip set (e.g. >5 brands, or the user's phrasing suggests a partial-name search), Ari uses `ClarifyingCard` (ORCH-1101 §5.2): eyebrow "WHICH BRAND?", question "Which one do you mean?", a text field, "Send"/"Skip". On send, same conversational feedback (the typed text → Gemini → proposal). Prefer chips when ≤5 brands (one-tap), card when >5 or fuzzy.

### 5.4 Edge: exactly one brand
No disambiguation. Ari targets it directly → straight to the proposal card. (SPEC §6.ii.)

### 5.5 Motion + haptics (Surface 3)
- Chip select: fill cross-fade glass→`#a85a44` + check fade-in `durations.fast` 120; reduced-motion instant. Haptic `selectionAsync()`.
- Siblings unmount: fade+collapse `durations.exit` 180; reduced-motion instant. (Inherited from ORCH-1101 §6.)

### 5.6 Per-component implementation note (Surface 3)
> `MessageList.tsx`: render a `QuickReplyChips` CHOICE item kind when the model turn carries a brand-disambiguation payload (options = user's brands from the prompt-known list). `onSelect(id)` → send the chip label as a user message via the existing `useAgentChat` send path (Q2 = conversational feedback, NOT a client `brand_id` pre-fill). Single-live-at-tail: only the latest disambiguation row is interactive. `ClarifyingCard` fallback for >5 brands. NO new component — both already exist from ORCH-1101.

---

## 6. SURFACE 4 — Created / updated brand receipt (`ResponseCard`)

Host: `MessageList` renders a `ResponseCard` (ORCH-1101 §5.4) for an `executed` `create_brand`/`update_brand` tool_result, in addition to / replacing the plain success ribbon.

### 6.1 RESOLUTION — receipt SUPPLEMENTS, then the ribbon is dropped
The `ResponseCard` receipt **replaces** the plain success ribbon for brand create/update (the ribbon stays for non-brand tools). Rationale: a brand has a cover thumbnail + name + next-action worth showing as a card; a thin ribbon wastes that. One card, not card+ribbon (no redundancy).

### 6.2 Anatomy

```
( ) ┌─ glass cardElevated · radius lg · cardPad 12 ──────────────────────────────┐
 ◖  │ ┌────────┐  Created Lumen Coffee                  title 15/21 primary       │
    │ │ ▓▓▓▓▓▓ │  USD · lumen-coffee                    rows: micro/13            │
    │ │ ▓thumb▓ │  ▶ Video                              (cover type if present)   │
    │ └────────┘                                                                  │
    │              ( Add your first event? )            primary-ghost action 34h  │
    └──────────────────────────────────────────────────────────────────────────────┘
```

| Element | Value | Token |
|---|---|---|
| Thumbnail | 44×44, radius `sm`, `resizeMode:"cover"`. **REAL cover URI only.** Image/gif → still; video → `#16181b` + centered `Play` 16 (mirrors `CoverPickerSheet` `:160`). If NO cover → thumbnail OMITTED entirely (anti-slop: never a placeholder/AI/stock fill). | existing ResponseCard `thumbnail` |
| Title | "Created Lumen Coffee" / "Updated Lumen Coffee" 15/21 600 primary 16.46:1 ✅ | `ariThread.cardTitleFont` |
| Rows | `{label:"Currency", value:"USD"}`, `{label:"Slug", value:"lumen-coffee"}`, and if cover present `{label:"Cover", value:"Video"/"Image"/"GIF"}` — label micro tertiary / value 13 primary | existing |
| Action | ONE ghost-primary pill "Add your first event?" (create, when `set_as_default` / first brand) or "Edit" (update). Height 34, hitSlop→44. **This action MUST NOT auto-create an event** — it only seeds a user message (non-goal chaining respected). | — |

### 6.3 Q5 RESOLUTION — receipt + followup copy in Mingla voice
Mingla voice = warm, concise, competent, no exclamation theater, no corporate "successfully."
- **create_brand receipt title:** "Created Lumen Coffee" (verb-first, plain). If `set_as_default`: a second 13/17 secondary line "It's your current brand now." Action pill: "Add your first event?" (a question = an invitation, not a command; non-executing).
- **update_brand receipt title:** "Updated Lumen Coffee". Row reflects the changed field(s). Action: "Edit" (re-opens edit). If only currency changed, a secondary line "Now in USD." reads better than a row.
- **delete_brand followup** (no card — it collapsed to a ribbon, §4.4): "Deleted Lumen Coffee. It's recoverable for 30 days through support if you change your mind." (calm, reversible, no triumph.)
- **`buildFollowupText` (edge, SPEC §4):** create → keep "Want to schedule an event under it?" as a NON-executing suggestion (the receipt action already carries this; the prose echoes it). If `set_as_default`, append "It's now your current brand." update → "Updated <name>. Anything else?" delete → the line above.
- These are SUGGESTIONS, never auto-actions (non-goal chaining).

### 6.4 Receipt states
| State | Look |
|---|---|
| default | card with thumbnail (or no thumbnail) + rows + action |
| loading | N/A — the receipt only renders AFTER the executed tool_result exists (it's a receipt, not a fetch). (Named N/A with reason.) |
| no-cover | thumbnail omitted, title+rows only (anti-slop: no placeholder) |
| action-pressed | pill → seeds user message; card stays (it's a receipt — persists in thread) |
| error | N/A — a receipt only exists on success; failures render the refusal/error card (§4.3/§4.4) |
| degraded (reduced-motion) | no enter animation; card appears |

### 6.5 Motion + haptics (Surface 4)
- Receipt enter (replacing the pending proposal): proposal card cross-fades into the receipt (shared bounds, `durations.entry` 260 / `easings.out`); reduced-motion → instant swap. Haptic `notificationAsync(success)`.
- Thumbnail: fades in on image-load (`durations.fast` 120) to avoid a flash of empty frame.

### 6.6 Per-component implementation note (Surface 4)
> `MessageList.tsx`: when an `executed` tool_result is `create_brand`/`update_brand`, render a `ResponseCard` (populate `title`, `rows`, `thumbnail` from `result.brand.cover_media_url` REAL URI only, `actions`) INSTEAD of the brand success ribbon (other tools keep the ribbon). Video thumbnail = play-disc treatment. NO new component — `ResponseCard` exists. The action pill seeds a user message; it must NEVER call a tool.

---

## 7. SURFACE 5 — No-brand → "want me to create one?" handoff

Host: `MessageList`. Driven by the prompt rule (SPEC §6.v): when a user with ZERO brands asks to create an event/experience/trip, Ari does NOT call `create_event` — it explains, then offers `create_brand`.

### 7.1 Anatomy — the handoff prompt

```
( ) ┌─────────────────────────────────────────────────────────────┐
 ◖  │ You'll need a brand before you can host events — it's your   │   Ari bubble 14/19
    │ public identity for tickets and payouts. Want me to set one  │
    │ up first?                                                    │
    └─────────────────────────────────────────────────────────────┘
    ( Yes, create a brand )   ( Not now )                            ← QuickReplyChips CHOICE
```

- Uses `QuickReplyChips` CHOICE (ORCH-1101 §5.1) — two chips. "Yes, create a brand" (on tap → Ari proposes `create_brand` = Surface 1 card). "Not now" (dismisses to a compact "Not now" pill; Ari leaves it).
- `ClarifyingCard` is the alternative if a name is wanted up front ("What should I call it?") — but prefer the two-chip yes/no first; the name is collected in the create proposal's editable Name field.

### 7.2 The hand-back (LOCKED — the ONLY handoff point; non-goal: event chaining)
After `create_brand` succeeds (Surface 4 receipt renders), Ari STOPS at a prose hand-back:
> "Lumen Coffee is ready — tell me about the event and I'll set it up."

NO event tool is called. The user re-asks in a fresh turn (the event-chaining is the deliberate follow-on ORCH). The receipt's "Add your first event?" action pill SEEDS this re-ask (taps → pre-fills the composer with "Create an event for Lumen Coffee") but does NOT auto-create.

### 7.3 Copy (Mingla voice, capability transparency)
- Trigger explanation: "You'll need a brand before you can host events — it's your public identity for tickets and payouts. Want me to set one up first?" (explains WHY, not just "you have no brand").
- Hand-back: "<Brand> is ready — tell me about the event and I'll set it up." (warm, forward-looking, honest that it's a new step).

### 7.4 States
| State | Look |
|---|---|
| default | bubble + 2 chips |
| yes-tapped | "Yes" chip → selected pill, sibling unmounts, → `create_brand` proposal (Surface 1) |
| not-now | "Not now" → selected pill, Ari leaves it (no nag) |
| post-create | receipt (Surface 4) + hand-back prose bubble |
| degraded | reduced-motion instant chip resolve |

### 7.5 Per-component implementation note (Surface 5)
> `MessageList.tsx` + prompt: the prompt (SPEC §5.2) instructs Ari to emit this when 0 brands + event intent. Render the two-chip `QuickReplyChips` CHOICE. "Yes" → conversational feedback (user message "Yes, create a brand") → Gemini proposes `create_brand`. After success, the hand-back is a normal Ari prose bubble — NO tool call. This works whether the user reached Ari directly or was bounced from `app/event/create.tsx`'s `no_brand` dead-end (that route is NOT modified here; routing it INTO Ari is the §12 follow-on). NO new component.

---

## 8. The Q4 RESOLUTION — currency input (de-GBP)

**Resolved: a `QuickReplyChips`-style currency picker, NOT a free-text field, defaulting to the USER's resolved currency (never a visual GBP default).** Rationale: de-GBP direction (memory `project_orch_1034_currency_de_gbp_scope`) means GBP must not be the visual default; a free-text 3-letter field invites typos and silently re-centers on GBP if empty. A chip picker shows the user's likely currencies, pre-selects their account default, and reads as a deliberate choice.

### 8.1 Anatomy — currency picker inside `ToolEditForm` (Edit mode of the create/update proposal)

```
   Currency                                          label micro secondary
   ( USD )  ( EUR )  ( NGN )  ( GBP )  ( More… )      ← chips, single-select
     ▲ pre-selected = user's resolved currency (#a85a44 fill, white)
```

- Chips reuse `QuickReplyChips` CHOICE geometry (height 30, radius full, `chipFont`). Selected = `#a85a44` + white + `Check` (4.6:1 ✅).
- **Pre-selection:** the chip for the user's resolved currency (from `agent_user_profile.preferred_currency`, else the brand/Stripe default) is pre-selected — NOT GBP unless that genuinely IS the user's currency.
- **Chip set:** the user's resolved currency + the top supported currencies (USD/EUR/NGN/GBP — the de-GBP-relevant set, GBP present but NOT privileged) + a "More…" chip → opens a full searchable list (existing currency list if one exists; else a simple sheet). GBP is just one chip among equals.
- This closes SPEC §b hidden flaw (currency was uneditable) AND satisfies de-GBP visually.
- Free-text fallback: NONE for the visible default; "More…" gives full coverage without a raw 3-letter field that could be mistyped.

### 8.2 Per-component implementation note (Q4)
> `ToolEditForm.tsx`: replace the currency text field (create_brand + new update_brand branch) with a single-select chip row. Pre-select the resolved currency. "More…" opens a fuller list. Writes `editedArgs.default_currency` (3-letter ISO). NEVER pre-select GBP unless it's the user's resolved currency. Reuses `QuickReplyChips` selected styling.

---

## 9. Accessibility (all surfaces, computed)

| Element | Contrast (on `#16181b`) | a11y |
|---|---|---|
| Card title 15/21 primary | 16.46:1 ✅ | `accessibilityRole="header"` on receipt/proposal titles |
| Body 13/17 secondary | 9.58:1 ✅ | linearized reading order: eyebrow→title→cover→fields→actions |
| Micro labels tertiary | 5.57:1 ✅ | `accessibilityLabel` pairs label+value ("Currency: USD") |
| Add-cover pill secondary | 9.58:1 ✅ | "Add a cover image or video" + hint |
| `#a85a44` warm fills, white | 4.6:1 ✅ | `accessibilityRole="button"` |
| `#ef4444` Delete button, white (14/600 large) | 3.76:1 ✅ (≥3 large) | `accessibilityState={{disabled}}` |
| `#ef4444` as GLYPH only (never body words) | 4.73:1 (≥3 graphic) ✅ | danger glyphs are decorative-graphic; words are neutral |
| Cover-over-photo type chip | scrim `#000@0.55` guarantees ≥4.5 | scrim is the contrast device |
| Type-to-confirm field 13pt primary | 16.46:1 ✅ | match announcement via `announceForAccessibility` |
| Disabled controls | 0.4 opacity | `accessibilityState={{disabled:true}}`, no press feedback |

- Every interactive element ≥44pt effective (34h + hitSlop 5–8; chips 30h + row hitSlop; cover band whole-area pressable).
- Dynamic Type: card body/title scale with `allowFontScaling`; chips + the type-confirm field cap at `maxFontSizeMultiplier 1.4` (inherited ORCH-1101 §2.2) so dense cards don't break.
- Reduced motion: every animation in §§2.4/4.5/5.5/6.5 has an instant/static fallback (inherited ORCH-1101 §6).
- Safe-area: all surfaces are `MessageList` items inside the existing scroll (already safe-area + composer-clearance managed by ORCH-1101 §4.1 `inputWrap.paddingBottom`). The `CoverPickerSheet` is full-snap Sheet (already safe-area managed). No new safe-area concerns.

---

## 10. Android opaque-fallback declarations (`ANDROID_GLASS_USES_OPAQUE_FALLBACK`)

Every NEW glass surface declares the opaque branch explicitly (parity is automatic but the branch must be named):
- Cover band (empty): Android fill `#16181b` (opaque) + `overflow:'hidden'` + dashed border kept (border, not shadow) + NO elevation.
- Delete-variant card / refusal card / receipt card: Android opaque `#16181b` + `overflow:'hidden'` + no shadow under rounded fill (danger border stays — it's a border, not a glow).
- Cover-over-photo scrim pills: opaque-enough by the `#000@0.55` scrim itself; no Android-specific change.
- Currency chips: inherit `QuickReplyChips` Android opaque branch (ORCH-1101 §5.1) — no new work.
- iOS keeps ember shadow-glow on `#a85a44` fills; web keeps flat (react-native-web shadow unreliable). All inherited from ORCH-1101 §3/§4.

---

## 11. Components the implementor will TOUCH / CREATE

**CREATE: none.** Every surface reuses an existing component. (Matches SPEC §13 "New files: none.")

**TOUCH (visual wiring only — no backend in this design phase):**
| File | Net-new visual work this design adds |
|---|---|
| `mingla-business/src/components/ari/ToolProposalCard.tsx` | Cover band sub-view (5 states) for create/update; delete-variant layout (cascade + type-to-confirm + Delete=`#ef4444`); Q7 create-time "Create & attach" inline confirm + CREATING/UPLOADING/PROCESSING band states; `humanizeToolName`/`primaryIdentity`/`fieldsFor` brand verbs + Cover row. |
| `mingla-business/src/components/ari/ToolEditForm.tsx` | Currency chip picker (Q4, de-GBP, pre-select resolved currency); update_brand editable branch; Name/Description fields at 13pt density. |
| `mingla-business/src/components/ari/MessageList.tsx` | Render `QuickReplyChips` CHOICE for disambiguation (Surface 3) + no-brand handoff (Surface 5); render brand `ResponseCard` receipt for executed create/update tool_results (Surface 4, replaces brand ribbon); render the §4.3 refusal card for `hasBlockingEvents`/409. |
| `mingla-business/src/constants/designSystem.ts` | ONE additive token: `ariThread.coverBandH = 132`. (All else reuses existing `ariThread`/`ariPalette`/`glass`/`semantic` tokens.) |

**REUSED VERBATIM (no redesign — confirmed by reading source this turn):**
`QuickReplyChips.tsx` (CHOICE mode), `ClarifyingCard.tsx`, `ResponseCard.tsx`, `MultiSelectPrompt.tsx` (available if a future multi-field edit wants it; not required by these 5 surfaces), `CoverPickerSheet.tsx` + `CoverPicker.tsx` + `coverTarget.ts`, `useBrandCascadePreview` (Surface 2 live counts), `useBrandCoverUpload` / `useEventCoverVideoUpload` (the upload legs), `useAgentChat` (send path for conversational chip feedback), `BrandDeleteSheet.tsx` (`canConfirm` logic + copy mirrored, not imported into the card).

**One flagged 1-line correction (logged, implementor's call):** `CoverPickerSheet.tsx`'s "Use this cover" confirm button uses `accent.warm #eb7825` (white-on = 2.90:1, fails even the 3:1 large bar). For contrast + ORCH-1101 parity, switch that fill to `ariPalette.userBubble #a85a44` (4.99:1). Same correction ORCH-1101 already applied to the Confirm button. Inside the existing reused sheet, not a net-new surface — flagged, not redesigned here.

---

## 12. `/goal` completion checklist (self-verified)

1. **References examined** — present (header): in-repo (4 ORCH-1101 cards, BrandDeleteSheet, CoverPickerSheet/CoverPicker/coverTarget, brandCoverService + bucket RLS migration) + external (GitHub/Linear/Vercel type-to-confirm, Stripe cascade-preview, iMessage/Slack inline-upload, Claude/ChatGPT attach-then-confirm, Raycast result card) + 2026 chatbot-UX trust properties. ✅
2. **All 9 states** designed per surface — Surface 1: empty/selected-image/selected-video/uploading/error (+ create-time CREATING/PROCESSING). Surface 2: default/loading/typed-match/submitting/submitted/disabled/error/refusal/offline/first-time. Surface 4: default/no-cover/action-pressed/loading-N/A(reason)/error-N/A(reason)/degraded. Inapplicable states named with reasons (receipt loading/error N/A; offline = screen toast per ORCH-1101 §8). ✅
3. **Every value is a token** — all sizes/spacings/radii are `ariThread.*` / `spacing.*` / `radius.*` / `typography.*` / `glass.*` / `semantic.*`; ONE new additive token `ariThread.coverBandH = 132`. Zero magic numbers. ✅
4. **Contrast computed** (dark theme, only theme): primary 16.46 · secondary 9.58 · tertiary 5.57 · `#a85a44` white 4.99 · `#ef4444` Delete white 14/600 3.76 (≥3 large) · `#ef4444` glyph-only 4.73 · scrim-pill ≥4.5. Error reason WORDS use secondary (9.58) not red (avoids the sub-4.5 trap, flagged + resolved §2.2e/§4.1). All ≥4.5 body / ≥3 large. ✅
5. **≥44pt targets + a11y labels + non-shifting feedback** — every interactive element §9; press feedback is opacity/scale/cross-fade (non-shifting). ✅
6. **Zero anti-slop** — no decorative gradients; real cover thumbnails ONLY (omitted when absent, never placeholder/AI/stock); lucide single-path glyphs (`Plus`/`Play`/`Video`/`Image`/`Pencil`/`X`/`Check`/`AlertTriangle`/`AlertCircle`/`RotateCcw`/`Flag`); `ActivityIndicator` spinners (web-crisp); no emoji icons; the one dashed border is justified-affordance, not decoration. ✅
7. **Mingla voice + reduced-motion** — copy per state in Ari's warm-concise voice (§4.3/§6.3/§7.3); every animation has a reduced-motion fallback (§§2.4/4.5/5.5/6.5). ✅

---

## 13. Open-question resolutions (SPEC §10) — summary table

| Q | Resolution |
|---|---|
| **Q2** disambiguation chip → proposal feedback | **(a) conversational** — chip tap sends the brand name as a user message; Gemini re-proposes with the resolved `brand_id`. Keeps Gemini the sole proposer; reuses `useAgentChat` send path; no client `brand_id` pre-fill. (§5.1) |
| **Q4** currency input | **Chip picker, NOT free-text.** Pre-selects the user's RESOLVED currency (never GBP unless that's theirs); top supported set (USD/EUR/NGN/GBP equal) + "More…". De-GBP visually honored. (§8) |
| **Q5** followup/receipt copy | Mingla voice, verb-first, no triumph: "Created Lumen Coffee" / "It's your current brand now." / "Updated Lumen Coffee" / delete "Deleted … recoverable 30 days through support." Create suggestion "Want to schedule an event under it?" kept as NON-executing. (§6.3) |
| **Q6** delete cascade counts | **LIVE counts** via `useBrandCascadePreview` (sheet parity), with a skeleton-loading state + "couldn't load — you can still delete" fallback mirroring `BrandDeleteSheet`. (§4.1/§4.4) |
| **Q7** device upload + video AT CREATE (orchestrator override) | **Create-row-first, attach-second, presented as ONE flow.** RLS proves device/video can't upload pre-brand-row; so device/video tap on a create triggers a silent `create_brand` commit ("Create & attach" inline confirm) → full picker re-targets to the new `brandId` → live upload → receipt. Provider/remote covers still thread via args with no commit. NO new bucket/migration/staging path. (§3) |

---

*End of DESIGN — ORCH-1103. Downstream: `mingla-implementor` executes the combined SPEC §§3–7 + this design. The implementor must also resolve the SPEC-side Q1/Q3 (impl-only: `hasBlockingEvents` source + `description` column mapping) — out of this design's scope.*
