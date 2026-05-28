# DESIGN - ORCH-0986 [Paired-profile redesign]

**Date:** 2026-05-28  
**Skill:** `ui-ux-mingla` design pass  
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0986-[paired-profile-holidays-redesign]/`  
**Branch:** `ORCH-0986-paired-profile-holidays-redesign`  
**Surface:** `app-mobile` consumer iOS and Android  
**Output type:** visual and IA design spec only. This is not a technical SPEC and contains no implementation patch.

## 1. Outcome

Redesign `ViewFriendProfileScreen.tsx` and the paired-only `PersonHolidayView.tsx` into one premium friend-profile surface that matches Seth's mockup:

- A full-bleed profile-photo hero for all friend profiles.
- Name, age, verification, location, subscription tier, and level overlaid on the photo.
- Circular translucent back and overflow controls over the photo.
- A rounded-top sheet overlapping the hero.
- A quote-styled bio card with no image and no "Ideal night out" label.
- A dark Message pill directly beneath the bio card.
- Premium interest pills.
- Paired-only birthday and recommendation sections below the top profile content.
- Horizontal recommendation rows retained, with a leading curated combo card that uses a real hero image.
- Loading, empty, error, populated, and friend-GPS-missing states designed as first-class states.

## 2. Source Evidence

### Locked inputs

- `Mingla_Artifacts/prompts/DESIGNER_ORCH-0986_PAIRED_PROFILE_REDESIGN.md`
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0986_PAIRED_PROFILE_HOLIDAYS.md`, especially section 9c.
- Seth's attached mockup, treated as the visual reference for the hero and sheet aesthetic.

### Current implementation shape

- `ViewFriendProfileScreen.tsx` currently renders a gradient header, centered avatar, name, bio text, info chips, interests, then a warm orange Message button. The redesign replaces that top anatomy with a photo hero plus overlapping sheet.
- `ViewFriendProfileScreen.tsx` currently passes viewer location into `PersonHolidayView`. The redesign requires friend last-known physical GPS only, with no fallback to viewer or profile location.
- `PersonHolidayView.tsx` already owns birthday, custom days, upcoming holidays, collapsible sections, calendar actions, saves modal, horizontal card rows, and `CompactCard`.
- `CompactCard` currently has separate curated styling, but curated rows can render broken because the card image is missing. The new curated card design assumes a real `imageUrl` sourced from the combo's first stop and must never substitute a fake image.

### Design-system inputs

Use these Mingla tokens from `app-mobile/src/constants/designSystem.ts`:

| Need | Token |
|---|---|
| Brand accent | `colors.accent` (`#eb7825`) |
| Warm brand range | `colors.primary[50-900]`, `colors.orange[50-900]` |
| Neutrals | `colors.gray[50-900]`, `colors.background.*`, `colors.text.*` |
| Spacing | `spacing.xxs` through `spacing.xxl` |
| Radius | `radius.sm`, `radius.md`, `radius.lg`, `radius.xl`, `radius.full` |
| Type | `typography.*`, `responsiveTypography.*`, `taglineTypography` |
| Touch targets | `touchTargets.minimum`, `touchTargets.comfortable`, `touchTargets.large` |
| Shadows | `shadows.sm/md/lg/xl` plus platform-specific Android elevation |
| Sheet chrome | `glass.notificationsSheet.topRadius`, `glass.notificationsSheet.handle`, `glass.notificationsSheet.cardBorder` |
| Photo chrome | `glass.chrome.button`, `glass.chrome.tint.floor`, `glass.chrome.border.hairline`, `glass.chrome.shadow` |

Color format guard: use only hex and `rgb()`/`rgba()`/`hsl()` values already compatible with React Native. Do not introduce `oklch()`, `lab()`, CSS variables, or web-only color syntax in mobile code.

## 3. Design Principles

1. The person is the first signal. The photo fills the top viewport; name and profile metadata sit over the image, not below it.
2. The sheet is the content surface. Bio, Message, interests, birthday, and recommendations all belong inside one continuous raised sheet.
3. Data remains truthful. No fake ratings, fake prices, fake images, guessed locations, or stock fallback cards.
4. Paired value is location-aware. Recommendations are about what is near the friend, so missing friend GPS gets an honest empty state.
5. Rows stay scannable. Curated combos lead each row, then signal-scored single places continue horizontally.
6. Premium means fewer labels, stronger hierarchy, better imagery, and cleaner states.

## 4. Full Screen Anatomy

### 4.1 Layout Stack

| Layer | Applies to | Anatomy |
|---|---|---|
| Root | all friend profiles | `View` with `colors.background.primary`, full height |
| Scroll | all friend profiles | single vertical `ScrollView`, `showsVerticalScrollIndicator=false`, content bottom padding `insets.bottom + 96` |
| Hero | all friend profiles | full-bleed photo, 60-64 percent of first viewport on normal phones |
| Hero chrome | all friend profiles | top-left back chip, top-right overflow chip |
| Hero identity | all friend profiles | bottom-left name/age/verified, metadata row |
| Overlapping sheet | all friend profiles | raised white rounded-top sheet, starts 44-56pt above hero bottom |
| Profile top content | all friend profiles | handle, bio quote card if present, Message pill if friend, interest pills |
| Paired modules | paired only | birthday card, recommendation sections |
| Terminal spacer | all friend profiles | bottom spacer protects final row from nav/home indicator |

### 4.2 Responsive Measurements

Target reference: 393 x 852 iPhone-style viewport.

| Element | Target measure |
|---|---|
| Hero height on 393 x 852 | 520pt |
| Hero height on 375 x 667 | 420pt |
| Hero height on 360 x 780 Android | 488pt |
| Hero min/max rule | min 410pt, max 560pt, prefer 61 percent of viewport |
| Sheet overlap | -52pt over hero on regular phones, -40pt on compact phones |
| Sheet top radius | `glass.notificationsSheet.topRadius` (28pt) |
| Sheet horizontal padding | `spacing.lg` (24pt) on >=390 width, `spacing.md` (16pt) below 390 |
| Sheet top handle | 36 x 4pt, `glass.notificationsSheet.handle.color`, centered, top margin 12pt |
| Root background behind hero | `colors.background.primary` |

Implementation note for forensics/spec: if the current app has a bottom tab/chrome overlay on this route, the screen must leave at least `insets.bottom + 88` bottom padding.

## 5. Hero Design

### 5.1 Photo

| Requirement | Design |
|---|---|
| Source | `profile.avatar_url` or profile photo source currently available for this friend |
| Crop | full-bleed `cover`; face-centered if image metadata supports it; otherwise center |
| Fallback | warm Mingla initials gradient only when there is no real image; do not show a small avatar circle |
| Edge treatment | image extends under status bar and to both screen edges |
| Overlay | dark vertical gradient from transparent top to `rgba(0,0,0,0.68)` bottom; second subtle top scrim `rgba(0,0,0,0.22)` behind controls |

Fallback gradient if no photo:

- Top: `colors.orange[300]` (`#fdba74`)
- Middle: `colors.accent` (`#eb7825`)
- Bottom: `colors.gray[900]` (`#111827`)
- Large initials in `colors.text.inverse`, `typography.xxxl`, centered above identity zone.

### 5.2 Top Controls

| Element | Position | Size | Visual |
|---|---:|---:|---|
| Back chip | `left: spacing.lg`, `top: insets.top + spacing.sm` | 48 x 48pt | circular translucent dark chip |
| Overflow chip | `right: spacing.lg`, `top: insets.top + spacing.sm` | 48 x 48pt | same as back chip |

Token use:

- Size: `touchTargets.comfortable` (48)
- Radius: `radius.full`
- Background: `glass.chrome.tint.floor`
- Border: `glass.chrome.border.hairline`
- Shadow: `glass.chrome.shadow`
- Icon color: `colors.text.inverse`
- Back icon: `chevron-back`
- Overflow icon: `ellipsis-horizontal`

Accessibility labels:

- Back: `Back to friends`
- Overflow: `Profile actions for {Name}`

### 5.3 Identity Overlay

Identity sits above the sheet overlap so it remains readable before the sheet begins.

| Element | Measure | Token |
|---|---:|---|
| Identity bottom inset | 74pt above hero bottom | `spacing.xl + spacing.lg` equivalent |
| Left/right padding | 24pt | `spacing.lg` |
| Name line | 32pt font, 38pt line | `typography.xxxl.fontSize` adjusted with `s()` |
| Metadata line | 15pt font, 22pt line | `typography.sm/md` |
| Metadata gap | 8pt between icon/text groups | `spacing.sm` |

Name format:

- `{DisplayName}, {age}` when age is available.
- `{DisplayName}` when age is not available.
- Verified badge appears inline after age/name only when the current verified value exists. It is not invented.

Name visual:

- Text color: `colors.text.inverse`
- Weight: `fontWeights.bold`
- Shadow: `rgba(0,0,0,0.35)` text shadow, small radius.
- If name wraps, allow 2 lines and keep metadata below; never shrink below 28pt.

Metadata row:

1. Location icon + `profile.location` short label when available, else `Location not shared`.
2. Dot separator.
3. Diamond icon + `Mingla+` or `Free`, using `TIER_LABEL`.
4. Dot separator.
5. Trophy icon + `Lv. {friendLevel}`.

Metadata colors:

- Text: `rgba(255,255,255,0.92)`
- Icons: `colors.text.inverse`, except tier diamond may use `colors.accent`
- Tier label: `colors.orange[300]` on dark photo, only if contrast remains >=4.5:1; otherwise use white text with orange icon.

## 6. Overlapping Sheet

### 6.1 Sheet Container

Visual:

- White surface: `colors.background.primary`
- Top radius: `glass.notificationsSheet.topRadius` (28)
- Border top: `StyleSheet.hairlineWidth`, `glass.notificationsSheet.cardBorder`
- iOS shadow: `shadowColor #000000`, y -8, opacity 0.10, radius 24
- Android: `elevation: 8`
- Sheet begins over the hero, not below it.

Spacing:

- Top padding: 12pt including handle.
- Content top after handle: 24pt.
- Section spacing: 16pt between bio/Message/interests; 24pt before paired birthday.

### 6.2 Sheet Top Order

The brief says interests are in the top group and also says Message must be directly beneath the bio. This design resolves the conflict in favor of the explicit hard guard:

1. Bio quote card, if `profile.bio` exists.
2. Message pill, if `onMessage && profile.isFriend`.
3. Interest pills, if `profile.categories.length > 0`.
4. Paired-only birthday card.
5. Paired-only recommendation sections.

If bio is empty, hide the bio card and place Message at the top of the sheet, followed by interests.

## 7. Bio Quote Card

### 7.1 Content

The bio card displays only `profile.bio`.

Do not render:

- "Ideal night out"
- any section label above the bio
- any image or thumbnail
- any fabricated quote, prompt, or fallback copy

If `profile.bio` is empty or whitespace-only, hide the entire card.

### 7.2 Visual

| Property | Value |
|---|---|
| Width | full sheet width |
| Padding | top 24, right 20, bottom 22, left 20 |
| Radius | `radius.lg` (16) |
| Background | `colors.orange[50]` (`#fff7ed`) with white inner lift if needed |
| Border | `colors.orange[100]` (`#ffedd5`) |
| Quote glyph | large decorative quotation mark, 32pt, `colors.accent` |
| Bio text | 17pt, 26pt line height, `colors.gray[900]` |
| Max lines | none by default; allow full bio in profile context |

Suggested hierarchy:

- Quote glyph sits at top-left, then bio text begins 36pt from left edge.
- Text uses `taglineTypography` or `responsiveTypography.md` with line height 26.
- No centered paragraph; use left alignment for readability.

Accessibility:

- Card role: text.
- Accessibility label: `Bio: {profile.bio}`.

## 8. Message Pill

### 8.1 Placement

Message is directly beneath the bio card:

- Margin top from bio card: `spacing.md` (16)
- If bio absent: margin top after handle/top content: `spacing.md`
- Margin bottom before interests: `spacing.md`

No heart/save button is designed anywhere on this profile surface.

### 8.2 Visual

| Property | Value |
|---|---|
| Height | `touchTargets.large` (56) |
| Radius | `radius.full` |
| Width | full sheet width on compact; 70 percent centered on >=390 width only if it still feels like mockup |
| Background | `colors.gray[900]` (`#111827`) |
| Text | `colors.text.inverse`, 16pt, semibold |
| Icon | `chatbubble-outline`, 22pt, white |
| Shadow | iOS `rgba(0,0,0,0.20)` y 8 radius 16; Android elevation 6 |

States:

- Pressed: scale 0.98, background `colors.gray[800]`.
- Disabled/not friend: do not render. Do not show a disabled fake button.

Accessibility label:

- `Message {Name}`

## 9. Interest Pills

### 9.1 Content

Source remains `profile.categories`.

- Use localized category labels where available.
- Use existing `getCategoryChipIcon` mapping.
- Cap first visible row naturally by wrapping; do not truncate category text unless a single label exceeds available width.

### 9.2 Visual

| Property | Value |
|---|---|
| Container | flex wrap, left aligned |
| Row gap | `spacing.sm` (8) |
| Column gap | `spacing.sm` (8) |
| Pill min height | 40pt |
| Pill radius | `radius.full` |
| Pill padding | horizontal 14, vertical 9 |
| Background | `colors.gray[50]` or `colors.orange[50]` on selected/brand-relevant interests |
| Border | `colors.gray[200]`, orange pills `colors.orange[100]` |
| Icon color | `colors.accent` |
| Text color | `colors.gray[800]` |

Accessibility:

- Each pill is text/non-interactive unless it truly filters content. If non-interactive, do not make it touchable.

## 10. Paired-Only Birthday Card

### 10.1 Placement

Birthday card appears after interests, only for paired profiles with a valid birthday.

- Top margin: `spacing.lg` (24)
- Bottom margin to first recommendation group: `spacing.lg` (24)

### 10.2 Visual Contract

The birthday module becomes a premium white card, not an orange block.

| Element | Design |
|---|---|
| Card background | `colors.background.primary` |
| Border | `colors.gray[200]` |
| Radius | `radius.xl` (24) |
| Padding | 18 horizontal, 18 vertical |
| Shadow | `shadows.md` softened; Android elevation 3-4 |
| Icon well | 56 x 56pt circle, `colors.orange[50]`, birthday icon in `colors.accent` |
| Main text | `{Name} turns {age} on {date}` |
| Countdown | `{N} days to go` or localized existing countdown string |
| Divider | hairline `colors.gray[200]`, margin vertical 16 |
| Footer row | liked places action left, Add to calendar right |

Text:

- Title: 17pt, 24pt line, semibold, `colors.gray[900]`
- Countdown: 15pt, 22pt line, medium, `colors.gray[500]`
- Footer labels: 15pt, 20pt line, medium
- Add to calendar color: `colors.accent`

Footer actions:

- Liked places: heart-outline icon + `{count} liked places` if count > 0.
- If count is 0, show `No liked places yet` as static muted text, not a broken button.
- Add to calendar: calendar-outline icon + `Add to calendar`, min touch target 44pt.

Accessibility labels:

- Birthday card: `{Name} turns {age} on {date}. {N} days to go.`
- Liked places button: `View {Name}'s liked places`
- Calendar button: `Add {Name}'s birthday to calendar`

## 11. Recommendation IA

### 11.1 Placement And Grouping

Recommendation sections sit below the fold, after birthday.

Section order:

1. Birthday picks, when birthday exists.
2. Custom days.
3. Upcoming holidays.
4. Archived holidays remains a lower-importance management row.

Keep each occasion collapsible. Each expanded occasion contains one horizontal row:

- leading curated combo card
- then signal-scored single place cards
- final shuffle or refresh affordance if still supported

Default expansion:

- Birthday row expanded by default when birthday exists.
- Custom days collapsed by default unless there is only one custom day, then expanded.
- Upcoming holidays: first two may remain auto-expanded, but only after the batched response has settled. Avoid staggered spinner reveals.

### 11.2 Occasion Header

| Element | Design |
|---|---|
| Container | white or `colors.gray[50]` card, radius 18 |
| Padding | 16 horizontal, 14 vertical |
| Border | `colors.gray[200]` |
| Left label | occasion name, 16pt semibold, `colors.gray[900]` |
| Subline | date and context, 13pt, `colors.gray[500]` |
| Right countdown | large number 22pt semibold in `colors.accent`, label 11pt gray |
| Chevron | 20pt, `colors.gray[500]` |
| Archive/delete | icon-only 44pt touch target, gray; confirm destructive deletes separately |

Expanded state:

- Header bottom radius remains 18.
- Row appears below with 10pt top gap.
- No nested card-inside-card visual. The occasion container frames the header; the card row should breathe on the sheet canvas.

Collapsed state:

- Header only.
- Chevron down.
- No hidden row placeholder height.

## 12. Recommendation Cards

### 12.1 Horizontal Row

| Property | Value |
|---|---|
| Scroll type | horizontal `ScrollView` or `FlatList` |
| Left inset | align with sheet padding |
| Card gap | 12pt |
| Bottom padding | 18pt |
| Scroll indicator | hidden |
| Snap | optional, not required |

### 12.2 Curated Combo Card

The curated card is the row leader and must feel like a premium date-plan card.

Data requirements:

- `cardType === "curated"`
- real hero image from combo's first stop
- title
- price tier if present
- stop count, rendered as `· {N} stops`
- optional tagline if present, max 1 line

No-image state:

- A curated card whose first stop has no renderable image must not show a generic gray placeholder on a dark card.
- Design should use a warm image-missing empty tile only as a temporary data-error state, with copy `Plan image unavailable`, and the technical SPEC should prevent this for normal successful data.

Visual:

| Property | Value |
|---|---|
| Width | 224pt on 390+ width; 208pt on compact Android |
| Height | 276pt |
| Radius | `radius.xl` (24) |
| Background | `colors.gray[900]` |
| Image height | 154pt |
| Image crop | cover |
| Image overlay | bottom gradient `rgba(0,0,0,0.00)` to `rgba(0,0,0,0.46)` |
| Top badge | `Curated plan`, glass/dark pill, 12pt text |
| Content padding | 14pt |
| Title | 16pt semibold, 21pt line, white, max 2 lines |
| Meta | price tier + `· {N} stops`, 13pt, `colors.orange[100]` or white at 85 percent |
| CTA affordance | small circular arrow, bottom-right, `colors.accent` fill with white icon |

Tap behavior:

- Tapping opens the expanded curated plan.
- Pressed state: scale 0.98, opacity 0.96.

Accessibility label:

- `Curated plan, {title}, {price tier if present}, {N} stops`

### 12.3 Single Place Card

Data requirements:

- real image if available
- title
- category
- price tier if present
- rating if present

Visual:

| Property | Value |
|---|---|
| Width | 158pt |
| Height | 224pt |
| Radius | `radius.lg` (16) |
| Background | `colors.background.primary` |
| Border | `colors.gray[200]` |
| Image height | 116pt |
| Content padding | 12pt |
| Title | 14pt semibold, `colors.gray[900]`, max 2 lines |
| Category | 12pt medium, `colors.gray[500]`, max 1 line |
| Footer | price tier left, rating right |
| Price | 12pt, `colors.accent` if present |
| Rating | star icon + one decimal, `colors.gray[700]` |

No fabricated values:

- Hide price if null.
- Hide rating if null or <=0.
- Use layout spacers so hidden price/rating do not collapse the card oddly.

Accessibility label:

- `{title}, {category}, {price tier if present}, rating {rating if present}`

## 13. States

### 13.1 Whole Recommendation Loading

Because the future architecture should fetch all sections in one batched/parallel request, use one coherent loading state:

- Birthday card may render immediately if birthday data is local.
- Below birthday, show skeleton section headers and card skeletons for all recommendation groups.
- Avoid separate spinners popping into each row at different times.

Skeleton visual:

- Header skeleton: 100 percent width, height 72, radius 18, background `colors.gray[100]`.
- Curated skeleton: 224 x 276, radius 24.
- Single skeletons: 158 x 224, radius 16.
- Shimmer or pulse allowed only if reduced-motion is not enabled.
- Reduced motion: static blocks with no shimmer.

Copy:

- Optional small muted line above skeletons: `Building picks near {Name}` only if friend GPS exists.

### 13.2 Populated Row

Render:

- Occasion header.
- Horizontal row.
- Curated card first.
- Singles after curated card.
- Shuffle/refresh control at row end if the existing feature remains.

### 13.3 No Cards For Occasion

Use when friend GPS exists and the service returns zero usable cards for that occasion.

Visual:

- Warm outlined card, full width.
- Icon: `sparkles-outline` or relevant occasion icon.
- Title: `No strong picks yet`
- Body: `Mingla could not find enough good matches near {Name} for this day. Try again later.`
- Retry button if request can be retried.

Do not show fallback cards from another city.

### 13.4 Friend-GPS Empty State

Use when no last-known physical GPS exists for the paired friend, or if the location is considered stale by the future SPEC.

This state replaces all recommendation rows, not just one row.

Visual:

- Full-width warm card after birthday.
- Radius: `radius.xl` (24)
- Background: `colors.orange[50]`
- Border: `colors.orange[100]`
- Icon well: 48pt, `colors.background.primary`, location icon in `colors.accent`
- Title: `No recent location for {Name} yet`
- Body: `Mingla will not guess. Once {Name} has a recent location, birthday and holiday picks will appear around where they actually are.`
- Optional secondary line: `Their profile location and your location are not used for these picks.`

No CTA unless there is a real user action that can help. Do not add a fake "Ask for location" CTA unless product explicitly supports it.

Accessibility label:

- `No recent location for {Name}. Recommendations will appear after Mingla has their recent location.`

### 13.5 Error State

Use when the batched recommendation request fails.

Visual:

- Full-width white card, border `colors.gray[200]`, radius 20.
- Icon: `cloud-offline-outline`, color `colors.gray[500]`.
- Title: `Could not load picks`
- Body: `Something interrupted the recommendation refresh.`
- Retry pill: border `colors.orange[200]`, text `colors.accent`, min height 44.

Accessibility:

- Error must be announced via RN accessibility where feasible.
- Retry label: `Retry recommendations for {Name}`.

### 13.6 Partial Data State

Use when some sections succeed and others fail.

- Render successful sections normally.
- Failed sections show the row-level error card inside the occasion body.
- Do not fail the whole profile if the recommendation module fails.

## 14. Motion And Interaction

| Interaction | Motion |
|---|---|
| Screen entry | hero/photo fades in 180-220ms; sheet rises 16pt into place over 220ms |
| Reduced motion | disable rise; use fade only |
| Back/overflow press | opacity 0.86 and scale 0.96 |
| Message press | haptic light impact; scale 0.98 |
| Occasion expand/collapse | 180-220ms height/opacity transition if current RN stack supports it; otherwise instant layout with chevron rotation |
| Card press | scale 0.98; open expanded modal |
| Retry press | haptic light impact; keep skeleton while refetching |

Avoid bouncy spring motion on content rows. This page should feel premium and calm.

## 15. iOS And Android Notes

Parity is the default.

### iOS

- Hero must extend under the status bar using `useSafeAreaInsets`.
- Use iOS shadow props for sheet and cards.
- If blur is used for hero chips, fall back to the existing `glass.chrome` dark tint when blur is unavailable.
- Page sheet modal behavior for saves/expanded card should remain unchanged.

### Android

- Use `elevation` equivalents for chips, sheet, birthday card, and cards.
- Avoid relying on iOS-only blur. Use `rgba()` dark translucent chips with the existing chrome border/shadow treatment.
- Ensure top controls clear notches/status bar with `insets.top`.
- Do not use web-only CSS filters or unsupported color syntaxes.

## 16. Accessibility And Quality Gates

- All touch targets are at least `touchTargets.minimum` (44pt); primary controls should be `touchTargets.comfortable` or larger.
- White text over hero must pass WCAG AA by using the bottom gradient. If a photo is too bright, the gradient opacity wins over preserving the raw image.
- Dark Message pill: white on `colors.gray[900]` passes AA.
- Small orange text on white should avoid `colors.accent` when contrast is too low. Use `colors.orange[700]` (`#c2410c`) for small text when needed.
- Icons that communicate actions need accessibility labels.
- Category pills are not touchable unless they change state.
- Error states must not be visual-only.
- Text must support dynamic type without clipping: allow name, bio, occasion headers, and card titles to wrap within their max lines.
- Keyboard-never-blocks-input rule is N/A because this profile redesign introduces no text inputs.

## 17. Component Inventory

| Existing element | Current role | New design role |
|---|---|---|
| `ViewFriendProfileScreen` root/ScrollView | flat profile page | owns full-bleed hero plus overlapping sheet |
| `renderBack()` | back button on light canvas | circular translucent hero chip |
| Centered avatar block | primary identity | removed from normal photo state; only initials fallback uses large initials |
| `profile.bio` text | centered paragraph under name | quote-styled bio card in sheet |
| Existing info chips | separate row under avatar | hero metadata overlay |
| `TIER_LABEL`/tier style | tier chip | hero metadata tier text/icon |
| `friendLevel` | info chip | hero metadata `Lv. N` |
| Interests section | labeled section | unlabeled premium pill wrap |
| Existing Message button | orange rectangle under interests | dark pill directly beneath bio |
| `PersonHolidayView` | paired module below profile | paired module inside same sheet after top profile content |
| Birthday `heroCard` | orange block | premium white birthday countdown card |
| `CalendarButton` | birthday/holiday add action | footer action in birthday card and expanded occasion body |
| `HolidaySectionView` | white collapsible cards | premium occasion headers with horizontal rows |
| `CustomHolidaySectionView` | same as holiday | same premium occasion header pattern with delete action |
| `CardRow` | per-section loading and row | batched-state-aware horizontal row renderer |
| `CompactCard` curated style | dark card, image can be placeholder | new image-led curated combo card |
| `CompactCard` single style | small white card | refined single place card |
| `ShuffleButton` | end-of-row action | keep as compact end card/button only if product still wants refresh |
| Hidden `PersonTabBar`/`BilateralToggle` | hidden preference UI | keep hidden unless SPEC intentionally removes dead UI |
| `PairedSavesListScreen` modal | liked places/visits modal | keep; birthday footer opens liked places |
| `ExpandedCardModal` | card detail | keep target; SPEC must fix curated stops array mapping if confirmed |

## 18. Technical-SPEC Inputs For Forensics

These are design-dependent requirements for the next technical SPEC, not implementation instructions:

1. Replace viewer-location recommendations with paired friend's last-known physical GPS only.
2. Define stale/missing GPS behavior and use the friend-GPS empty state above.
3. Use one batched/parallel recommendation load across birthday, custom days, and standard holidays.
4. Ensure curated combo cards expose a real top-level hero image from the first stop.
5. Preserve real price, rating, distance, and stop-count truthfulness. Hide missing values.
6. Confirm and fix curated expanded-card stop data shape so tapping the combo does not open an empty plan.
7. Surface summary/empty/error reasons from the recommendation service so UI can distinguish no-GPS, no-cards, and service-error states.
8. Keep recommendations below the fold and keep horizontal rows.
9. Do not write or introduce a heart/save button on the profile hero.
10. Do not introduce an "Ideal night out" feature.

## 19. Manual Design QA Checklist

- On iPhone-sized viewport, the first screen shows full photo, overlaid identity, and the top of the raised sheet.
- Back and overflow chips are readable over bright and dark photos.
- Name/age wraps cleanly and never overlaps metadata or sheet.
- Bio card contains only the user's bio and quote styling.
- Message appears directly beneath bio when bio exists.
- No heart/save profile action appears near Message.
- Interests wrap without horizontal overflow.
- Birthday card looks related to the hero aesthetic but remains readable on white.
- Curated card shows a real hero image and `· N stops`.
- Single cards show image, title, category, price/rating only when present.
- Friend-GPS empty state appears instead of viewer-location recommendations.
- Loading uses coherent skeletons rather than staggered row spinners.
- iOS and Android safe areas keep top chips clear of status bars.
- All interactive controls meet 44pt minimum touch size.
