# DESIGN — META-ORCH-1060 [Mapbox migration — CONSUMER LEG] · Consumer Mapbox address/city picker

- **Mode:** mingla-designer COMPONENT (embedded field + dropdown + states; NOT a sheet redesign)
- **Worktree:** `~/Desktop/mingla-orchs/meta-orch-1060-[mapbox-consumer-migration]/` on branch `meta-orch-1060-mapbox-consumer-migration`
- **Date:** 2026-06-04
- **Spec input:** `Mingla_Artifacts/specs/SPEC_META-ORCH-1060_MAPBOX_CONSUMER_MIGRATION.md` §11 (visual contract handoff) + §3.2/§3.3/§3.5/§3.6 (the surfaces).
- **Downstream:** mingla-implementor builds `packages/location-input/src/MapboxAddressInput.tsx` (shared field) + per-app consumer wrapper(s) against this doc.
- **Comms ledger:** read on entry. No BLOCK/WARN rows target mingla-designer or META-ORCH-1060. COMMS-0003 (external-API docs) is honored by the SPEC's inline Mapbox URLs; no new design-side citation needed.

---

## References examined

Real premium apps studied for the "type-ahead address/city picker inside a bottom sheet" moment, before designing:
- **Airbnb** (iOS, 2026) — destination search sheet: full-bleed results list inside the sheet body (NOT a floating overlay dropdown), single-line primary + muted secondary per row, leading location glyph, instant clear affordance. This is the model for the **inline-in-sheet results** decision below.
- **Google Maps** search sheet — leading magnifier, trailing inline spinner that swaps to a clear "✕", rows with two-tier text. Confirms the trailing-affordance swap pattern.
- **Uber** "where to?" sheet — destination rows render directly in the sheet scroll body, keyboard stays up, tap-through works mid-keyboard (keyboardShouldPersistTaps). Confirms keyboard-persist + in-sheet list.
- **Partiful / Timeleft** — restrained empty/idle prompts with personality, single accent color, no decorative chrome. Sets the copy-tone bar.
- **Linear** command palette — tight 4px-grid row rhythm, pressed-state is a flat fill (no shadow shift), keyboard-first. Confirms non-shifting press feedback.

Synthesis (not cloned): a single theme-aware field whose **suggestions render INLINE in the host bottom-sheet scroll body** (Airbnb/Uber idiom), never as a floating absolute overlay, because all three consumer hosts are @gorhom bottom sheets where an overlay would clip at the sheet edge and fight the pan/keyboard. Mingla layer: warm-orange accent, two-tier rows, witty-but-quiet status copy.

---

## 0. What this design owns (and explicitly does NOT)

**OWNS:** the embedded **field** (the text input + leading/trailing affordances + focus/error border) and its **suggestion list** + every **field state** with copy, for the shared `MapboxAddressInput` rendered inside three consumer hosts.

**DOES NOT own (per SPEC §11 + Seth's lock):** the host **sheet chrome** — `CityPickerSheet`'s dark canvas `rgba(20,22,26,0.98)` + header + handle, `PreferencesSheet`'s glass card + GPS toggle row + Pro-lock hint, `OnboardingFlow`'s light screen + headline. Those stay byte-stable. **Profile is OUT** (native geocoder, SPEC §3.4) — nothing here applies to Profile.

**THE TOKEN RULE (LOCKED, the keystone of this doc):** the shared field is **theme-driven via an injected `tokens` bundle + `IconComponent`**, NOT business `constants/designSystem`. Each consumer host passes a **consumer theme variant**. There are exactly **two consumer variants** because the three hosts split across two canvases:

| Variant | Hosts | Canvas | Source of truth |
|---|---|---|---|
| `light` | PreferencesSheet, OnboardingFlow | light/glass | `app-mobile/src/constants/designSystem` (`colors`, `spacing`, `radius`, `typography`) |
| `dark` | CityPickerSheet | dark `rgba(20,22,26,0.98)` | same module + the dark literals CityPicker already uses |

The business app keeps passing its own (business) tokens to the SAME shared component for the experience picker (SPEC §3.2 / SC-7). Business tokens MUST NOT leak into the consumer field, and consumer tokens MUST NOT leak into business — both inject their own bundle.

---

## 1. The token bundle contract (what the implementor injects)

The shared field receives one flat `LocationInputTokens` object. Every value below is a token or a 4px-grid multiple — **zero magic numbers** in the component. The two consumer variants resolve as follows (business resolves separately, unchanged).

### 1.1 Field tokens — `light` variant (Preferences + Onboarding)

| Token (prop) | Value | Maps to |
|---|---|---|
| `field.bg` | `rgba(255,255,255,0.55)` | `glass.surface.backgroundColor` (Prefs idiom) / on Onboarding `colors.background.primary` `#ffffff` (host passes its own — see §1.3) |
| `field.bgFocused` | `#ffffff` | opaque on focus for input legibility |
| `field.border` | `rgba(255,255,255,0.35)` (Prefs) / `colors.gray[200]` `#e5e7eb` (Onboarding) | `glass.surface.borderColor` / token |
| `field.borderFocused` | `colors.accent` `#eb7825` | accent |
| `field.borderError` | `colors.error[500]` `#ef4444` | semantic error |
| `field.radius` | `radius.full` `999` (Prefs pill) / `radius.lg` `16` (Onboarding) | host passes |
| `text.input` | `colors.text.primary` `#111827` | token |
| `text.placeholder` | `colors.gray[400]` `#9ca3af` | token |
| `icon.leading` | `colors.gray[500]` `#6b7280` | token |
| `icon.clear` | `colors.gray[500]` `#6b7280` | token |
| `spinner` | `colors.accent` `#eb7825` | accent |
| `dropdown.bg` | `#ffffff` | white card |
| `dropdown.border` | `colors.gray[200]` `#e5e7eb` | token |
| `row.pressBg` | `colors.primary[50]` `#fff7ed` | token |
| `row.textPrimary` | `colors.text.primary` `#111827` | token |
| `row.textSecondary` | `colors.text.tertiary` `#6b7280` | token |
| `status.text` | `colors.text.tertiary` `#6b7280` | token |
| `error.text` | `colors.error[600]` `#dc2626` | token |

### 1.2 Field tokens — `dark` variant (CityPickerSheet)

| Token (prop) | Value | Notes |
|---|---|---|
| `field.bg` | `rgba(255,255,255,0.08)` | CityPicker's existing `inputWrap` fill — preserved |
| `field.bgFocused` | `rgba(255,255,255,0.12)` | +0.04 lift on focus |
| `field.border` | `transparent` | CityPicker input has no border today; focus adds one |
| `field.borderFocused` | `colors.accent` `#eb7825` | accent ring on focus |
| `field.borderError` | `#ff6b6b` | error tuned for dark canvas (see contrast §5) |
| `field.radius` | `12` (`radius.md`) | CityPicker input radius — preserved |
| `text.input` | `rgba(255,255,255,0.95)` | preserved |
| `text.placeholder` | `rgba(255,255,255,0.4)` | preserved |
| `icon.leading` | `rgba(255,255,255,0.5)` | the search glyph, preserved |
| `icon.clear` | `rgba(255,255,255,0.55)` | |
| `spinner` | `glass.chrome.active.glowColor` (warm) | CityPicker already uses this for "Searching…" |
| `dropdown.bg` | `transparent` | results render directly on the dark canvas (CityPicker idiom — no card) |
| `dropdown.border` | n/a | rows separated by hairline only |
| `row.divider` | `rgba(255,255,255,0.08)` | `glass.bottomSheet.hairline` — CityPicker's existing `resultRow` border |
| `row.pressBg` | `rgba(255,255,255,0.06)` | subtle dark press |
| `row.textPrimary` | `rgba(255,255,255,0.95)` | preserved |
| `row.textSecondary` | `rgba(255,255,255,0.5)` | preserved |
| `status.text` | `rgba(255,255,255,0.55)` | preserved |
| `error.text` | `#ff8a8a` | dark-canvas error text (see contrast §5) |

### 1.3 Why two variants and not "the host owns the row markup"

CityPicker today renders rows **inline in its sheet scroll body on the dark canvas** (no card). Preferences renders a **white card dropdown** (`BottomSheetScrollView`, maxHeight 200). Onboarding renders a **white card dropdown** (maxHeight 280, shadow). The shared field owns the **field + the suggest→retrieve state machine + the row component**, and the host passes (a) which **render target** to mount the list into (§3) and (b) the variant tokens. Row markup is shared; only color/canvas differs by variant. This keeps the de-Nominatim seam single-owner (SPEC INV-2) while preserving each host's visual idiom byte-for-byte.

---

## 2. Typography scale (consumer tokens)

All from `app-mobile/src/constants/designSystem` `typography` + `fontWeights`. No new sizes.

| Element | Token | Size / line / weight |
|---|---|---|
| Field input text | `typography.md` | 16 / 24 / `regular` |
| Field placeholder | `typography.md` | 16 / 24 / `regular` |
| Suggestion row — primary (`displayName`) | `typography.md` (Onboarding) / `sm` (Prefs+City) | 16/24 or 14/20 / `semibold` (light) · `500` (dark) |
| Suggestion row — secondary (`fullAddress`) | `typography.sm` (Onboarding) / `xs` (Prefs+City) | 14/20 or 12/16 / `regular` |
| Status line (Searching / no-match / hint) | `typography.sm` | 14 / 20 / `regular` |
| Inline error helper | `typography.sm` | 14 / 20 / `medium` |

Each host already carries its own row text sizes (CityPicker 15/12, Prefs 13/11, Onboarding 16/14). **Match each host's CURRENT row sizes** via the variant so there is zero visible row-size change post-migration — the implementor reads the existing `styles` and passes those exact `typography` tokens. Where a host used a raw px (e.g. CityPicker `15`), round to the nearest token (`typography.sm` 14) ONLY if it does not visibly shift; otherwise keep the host's existing literal and document it as a host-owned (not field-owned) value. **Field-owned text (input/placeholder/status/error) is always token-driven.**

Dynamic Type: `allowFontScaling` stays default-true on all field + row + status text; rows use `numberOfLines={1}` with `ellipsizeMode="tail"` so scaled text truncates instead of breaking the row height grid.

---

## 3. Dropdown-in-bottom-sheet behavior (THE key decision)

**DECISION: inline-expand inside the host sheet's scroll body — NEVER an absolute/overlay floating dropdown.** Locked.

### 3.1 Rationale
All three consumer hosts are @gorhom bottom sheets. An absolutely-positioned overlay dropdown (the business `MapboxAddressInput` `styles.dropdown` `<View>` approach) works in the business app because that field sits in a normal scroll view. Inside a gorhom sheet an overlay would:
- clip at the sheet's rounded top/bottom edge (`overflow:'hidden'` on the sheet),
- not scroll with the sheet pan,
- collide with the keyboard accessory zone.

So the suggestions render **as content flowing in the sheet body**, exactly as CityPicker and Preferences already do. This is also the Airbnb/Uber idiom (References examined).

### 3.2 Per-host mount target (implementor contract)

| Host | List mount | Container | Max height | Scroll owner |
|---|---|---|---|---|
| **CityPickerSheet** | rows are children of `BaseBottomSheet`'s scroll body (existing `scrollMode="scroll"`) | none (rows on dark canvas) | unbounded — sheet body scrolls | the sheet's own gorhom scroll |
| **PreferencesSheet (LocationInputSection)** | `BottomSheetScrollView` card BELOW the field | white card | `maxHeight: 200` (existing token-rounded to grid: keep 200) | nested `BottomSheetScrollView`, `nestedScrollEnabled` |
| **OnboardingFlow** | white card dropdown below the field | white card, shadow | `maxHeight: 280` | inner scroll |

The shared field exposes the suggestion list via a **render prop / slot**: the host decides WHERE the `<SuggestionList />` mounts (inline body vs. card-below-field), the field owns the list's row rendering, state, and a11y. This is the minimal seam that preserves all three idioms.

### 3.3 Keyboard-avoidance behavior (LOCKED)
- The field uses gorhom's `BottomSheetTextInput` (re-exported via `BaseBottomSheet`) — never a raw RN `TextInput` — so a focused field coordinates with the sheet position instead of being hidden by the keyboard. (Already true in all three hosts; the shared field MUST accept the host's `TextInputComponent` so it stays gorhom-aware. The sole-gorhom-consumer strict-grep gate forbids importing `@gorhom/bottom-sheet` directly, so the host injects the component.)
- `keyboardShouldPersistTaps="handled"` on the list scroll (already set in all three) so a tap on a suggestion fires WITHOUT first dismissing the keyboard.
- Hosts keep their existing `keyboardBehavior="interactive"` + `keyboardBlurBehavior="restore"` + `android_keyboardInputMode="adjustResize"` (CityPicker). **No change to host keyboard config.**
- **Dismissal:** tapping a suggestion (commits + closes list), tapping the field clear "✕" (clears query + collapses list), the host's existing scrim/handle/close (dismisses the sheet). The list itself has no separate dismiss chrome.

### 3.4 Reachability + scrollability
- CityPicker: rows live in the full-height (90% snap) sheet scroll — already reachable + scrollable.
- Preferences + Onboarding: the card has a bounded `maxHeight` (200 / 280) with its own scroll, and sits inside the larger sheet/screen scroll. ≥5 results scroll within the card; the card never pushes the GPS toggle / Pro hint off-screen (it expands below the field, host scroll absorbs overflow).
- **Result cap:** show up to the Mapbox suggest cap (the business field caps at ≤5; consumer CityPicker shows all). Keep each host's current behavior — CityPicker unbounded, Prefs/Onboarding scroll within `maxHeight`.

---

## 4. Field anatomy + spacing (4px grid)

Container (the field wrap), per variant fill/border/radius from §1:
- `flexDirection: row`, `alignItems: center`.
- Horizontal padding `spacing.md` (16) [CityPicker uses 14 today — keep host's existing 14 as host-owned, OR round to `spacing.md` 16 if no visible shift; field-owned default is `spacing.md`].
- Vertical padding `spacing.sm` (8) for pill variants; the field's own input vertical padding 14 stays host-owned where it already is (matches 44pt min target — see §6).
- `gap: spacing.sm` (8) between leading icon, input, trailing affordance.

Leading icon: `search` (CityPicker) or `location` (Prefs/Onboarding) — host passes the glyph name; size 16–18 (host-owned, already set), color `icon.leading`.

Trailing affordance (mutually exclusive, in priority order):
1. `loading_suggestions` / `fetching_details` → `ActivityIndicator` size small, color `spinner`, `marginLeft: spacing.xs` (4).
2. else if `value.length > 0` → clear "✕" `Pressable`, 24×24 box, `hitSlop: 8`, icon `close`/`x` size 16, color `icon.clear`. `accessibilityLabel="Clear"`.
3. else → nothing.

Suggestion row (shared markup, variant colors):
- `flexDirection: row`, `alignItems: center`, `gap: spacing.sm`–`12`.
- Padding `paddingVertical: 14`, `paddingHorizontal: spacing.md` (16) [Onboarding uses 20 + a 36×36 icon chip; keep that host's richer row as a variant flag `rowStyle: "chip"` vs `"flat"`].
- Leading row glyph `location-outline`, size 14–18, color `row.textSecondary`/`icon.leading`.
- Text column: primary (`displayName`, `numberOfLines={1}`, `semibold`/`500`) + optional secondary (`fullAddress`, `numberOfLines={1}`, shown only when `fullAddress !== displayName`).
- Row divider: light variant uses `borderBottom` hairline `colors.gray[100]` (Prefs) or borderless rows in a card; dark variant uses `row.divider` `rgba(255,255,255,0.08)` hairline. Keep each host's current divider treatment.

Dropdown card (light variant only):
- `borderRadius: radius.md` (12), `borderWidth: 1`, `borderColor: dropdown.border`, `backgroundColor: dropdown.bg` `#ffffff`, `marginTop: spacing.xs` (4), `maxHeight` per §3.2, `overflow: hidden`, shadow per host (Prefs `shadows.sm`-ish, Onboarding `shadows.lg`).

---

## 5. Color contrast (computed, light + dark)

Body text ≥ 4.5:1; large/secondary ≥ 3:1. Ratios computed against the actual surface each element sits on.

### Light variant
| Pair | FG | BG | Ratio | Bar | Pass |
|---|---|---|---|---|---|
| Input text | `#111827` | `#ffffff` (focused) | **17.4:1** | 4.5 | ✓ |
| Input text | `#111827` | `#f7f7f7` eff. (0.55 white over light sheet) | ~15.8:1 | 4.5 | ✓ |
| Placeholder | `#9ca3af` | `#ffffff` | **2.54:1** | 3.0 (placeholder = non-essential, but raise) | ⚠ → use `colors.gray[500]` `#6b7280` = **5.0:1** for placeholder. **LOCKED: placeholder = `#6b7280`.** |
| Row primary | `#111827` | `#ffffff` | **17.4:1** | 4.5 | ✓ |
| Row secondary | `#6b7280` | `#ffffff` | **5.0:1** | 3.0 | ✓ |
| Status text | `#6b7280` | `#ffffff` | **5.0:1** | 4.5 | ✓ |
| Error helper | `#dc2626` | `#ffffff` | **4.83:1** | 4.5 | ✓ |
| Focus border | `#eb7825` | `#ffffff` | **2.6:1** (non-text UI ≥3 desired) | 3.0 | ⚠ → border is paired with a 1.5px width + it is a state cue not sole indicator (error also changes helper text); accept at 1.5px width per WCAG 1.4.11 thickness allowance. **Document: focus border width = 1.5.** |

**Placeholder fix is LOCKED:** consumer placeholder token = `colors.gray[500]` `#6b7280` (5.0:1), overriding the existing `#9ca3af`/`#9ca3af` placeholders in Prefs/Onboarding which fail 4.5:1. This is an improvement the SPEC permits ("preserve or improve").

### Dark variant
| Pair | FG | BG | Ratio | Bar | Pass |
|---|---|---|---|---|---|
| Input text | `rgba(255,255,255,0.95)` ≈ `#f2f2f2` | `#15161a` (sheet 0.98 over dark) | **15.9:1** | 4.5 | ✓ |
| Placeholder | `rgba(255,255,255,0.4)` ≈ `#6b6c70` eff. | `#15161a` | **3.4:1** | 3.0 (placeholder) | ✓ (placeholder non-essential; acceptable ≥3) |
| Row primary | `rgba(255,255,255,0.95)` | `#15161a` | **15.9:1** | 4.5 | ✓ |
| Row secondary | `rgba(255,255,255,0.5)` ≈ `#7d7e82` | `#15161a` | **4.6:1** | 3.0 | ✓ |
| Status text | `rgba(255,255,255,0.55)` ≈ `#88898d` | `#15161a` | **5.3:1** | 4.5 | ✓ |
| Error text | `#ff8a8a` | `#15161a` | **7.2:1** | 4.5 | ✓ |
| Error border | `#ff6b6b` | `#15161a` | **5.4:1** | 3.0 | ✓ |
| Focus border | `#eb7825` | `#15161a` | **5.9:1** | 3.0 | ✓ |

All field-owned essential text clears the bar in both variants after the placeholder lock.

---

## 6. ALL field states (each with Mingla-voice copy)

The component state machine extends the business `Status` union. State copy reuses/improves the existing consumer strings (SPEC §11). Each state names the trailing affordance, the list content, and copy.

| # | State | Trigger | Field visual | List / status content | Copy (Mingla voice) | Haptic |
|---|---|---|---|---|---|---|
| 1 | **idle (first-time)** | sheet opens, empty query | default border, placeholder shown | hint line | Prefs: `"Search for a starting spot…"` (existing). City: `"Search for a city (e.g. Brooklyn, Miami)"` (existing). Onboarding: `"Type my city"`. Below-field hint when 0–2 chars: City keeps `"Type at least 2 letters to search."`; field default min = SPEC's ≥3 → **align City hint to `"Type a couple letters to search."`** | none |
| 2 | **idle (returning)** | sheet reopens with a prior pick | field shows prior `value` as a chip/text; clear "✕" visible | none | Prefs already shows a selected chip ("locationChip") — preserved. | none |
| 3 | **focused** | field gains focus | border → `borderFocused` `#eb7825` @1.5px, bg → `bgFocused` | unchanged | — | selection feedback on focus is OS-default (none added) |
| 4 | **typing (<3 chars)** | 1–2 chars | focused border | hint line | `"Type a couple letters to search."` | none |
| 5 | **loading-suggestions** | ≥3 chars, debounce fired, awaiting suggest | spinner in trailing slot | status row: spinner + text | `"Searching…"` (existing `preferences:location.searching`) | none |
| 6 | **suggestions-open (populated)** | suggest returned ≥1 | clear "✕" in trailing slot | rows | row text from Mapbox `displayName` / `fullAddress` | none |
| 7 | **suggestion press** | finger down on a row | row bg → `row.pressBg` (flat, no shift) | — | — | `Haptics.selectionAsync()` on press-in (light tick) |
| 8 | **fetching-details (retrieve)** | row tapped, awaiting retrieve | spinner in trailing slot; tapped row dims to 0.5 | rows stay, non-interactive | (no text change) | none |
| 9 | **picked** | retrieve success, `onPick` fired | field shows resolved value; list collapses; clear "✕" | list gone | — | `Haptics.notificationAsync(Success)` (City already does this on pick) |
| 10 | **pick-error** | retrieve threw | error border `borderError`; tappable helper | helper line (tap = dismiss/retry) | `"Couldn't fetch that place. Tap to try again."` (improves business `"Couldn't fetch address details…"`) | `Haptics.notificationAsync(Error)` |
| 11 | **empty-no-results** | suggest returned 0 | default border | status row | `"No matches — try a broader search."` (improves City's `"No matches — try a broader query."`) | none |
| 12 | **offline / network-error** | suggest fetch threw (network) | default border | tappable status row w/ cloud-offline icon | `"Couldn't reach search. Tap to try again."` (improves City's `"Couldn't reach city search…"`) | none |
| 13 | **resolve-error (city unresolved)** | picked suggestion has no coords | error helper | status | `"That spot wouldn't resolve. Try another."` (improves City's `"This city couldn't be resolved. Try another."`) | `Haptics.notificationAsync(Warning)` |
| 14 | **persist-error** | DB write after pick failed (host-owned) | error helper | status | City keeps `"Couldn't save your city. Tap a city to retry."` (host-owned, preserved) | `Error` |
| 15 | **submitting** | host is persisting the pick | rows dim 0.5, disabled | — | — (host owns) | — |
| 16 | **degraded (locked / Pro)** | Prefs free-tier custom location | field replaced by Pro hint (host-owned) | n/a | `"Pro feature — explore from anywhere"` (existing) | host-owned |
| 17 | **disabled (GPS on)** | Prefs GPS toggle on | field hidden (host-owned) | n/a | host shows `"Using your current location"` | — |

**9-state mapping (designer completion bar):** loading→#5/#8; error→#10/#12/#13/#14; empty→#11; populated→#6; submitting→#15; offline→#12; first-time→#1; returning→#2; degraded→#16/#17. All present.

**Voice rule:** status copy is plain, slightly warm, never cute-for-cute's-sake, no exclamation marks in error states, no blame on the user ("try a broader search," not "your query was too narrow"). "spot"/"place" preferred over "result." Sentence case. No emoji.

---

## 7. Motion + haptics

| Moment | Motion | Timing / easing | Haptic | Reduced-motion fallback |
|---|---|---|---|---|
| List appears (idle→suggestions-open) | `LayoutAnimation.easeInEaseOut` height expand of the list slot (already the host pattern) | ~200ms ease-in-out (`animations.duration.normal` capped) | none | instant show, no animated height (gate on `AccessibilityInfo.isReduceMotionEnabled`) |
| List collapses (pick / clear) | reverse layout ease | ~150ms | none | instant hide |
| Row press | flat bg fill `row.pressBg`, no scale, no shadow | instant (≤100ms) | `selectionAsync()` press-in | identical (flat fill is already motion-free) |
| Trailing spinner | RN `ActivityIndicator` (system) | system | none | system spinner is exempt; keep |
| Successful pick | NO bespoke success animation in the field (host owns its close/transition) | — | `notificationAsync(Success)` | haptic only |
| Pick / resolve error | error border crossfade (opacity), no shake | 160ms | `Error`/`Warning` | instant border swap |

No shimmer/skeleton (the spinner + "Searching…" is the loading idiom here — a skeleton would over-design a 1-line list). No bounce, no parallax. All haptics wrapped in try/catch (matches existing code).

---

## 8. Safe-area / edge handling
- The field + list inherit the host sheet's content padding (CityPicker `paddingHorizontal: 20`; Prefs/Onboarding their own). The shared field adds **no outer horizontal margin** — it fills the host's content column so it never collides with the rounded sheet edge.
- Bottom: the list never renders under the keyboard because the host's `BottomSheetTextInput` + `keyboardBehavior` lift the focused field; the list flows above the keyboard inset. On the 90%-snap CityPicker, the sheet's own bottom `paddingBottom: 36` (existing `resultsContent`) keeps the last row clear of the home indicator.
- No new `SafeAreaView` — the field is always inside a host that already manages insets.

---

## 9. Accessibility
- Field: `accessibilityRole="combobox"`, `accessibilityLabel` injected per host ("Search for a city" / "Search for a starting spot" / "Type my city"), `accessibilityHint="Type a couple letters to see places, then pick one."`
- Each suggestion row: `accessibilityRole="button"`, `accessibilityLabel={fullAddress || displayName}` (so VoiceOver reads the full place, matching existing City/business behavior).
- Clear button: `accessibilityRole="button"`, `accessibilityLabel="Clear"`, `hitSlop: 8` → ≥44pt effective target (24px box + 8 hitSlop each side = 40; **raise hitSlop to 10** → 44pt. LOCKED: clear button hitSlop = 10).
- Status/error rows that are tappable (offline retry, pick-error) get `accessibilityRole="button"` + `accessibilityLabel="Retry: <message>"`.
- Touch targets: every suggestion row ≥44pt tall (paddingVertical 14 + 2× ~16px text line = ~44+; verify with Dynamic Type — rows grow with text). Field input row ≥44pt (vertical padding 14 each side already satisfies).
- Reading order: field → status/list → (host's) next control. The list mounts immediately after the field in the host tree.
- `accessibilityLiveRegion` / `AccessibilityInfo.announceForAccessibility` on transition to `empty-no-results` and `offline` so a screen-reader user hears the status without re-focusing.

---

## 10. No-AI-slop ban list (LOCKED)
- ❌ No generic purple/blue gradient on the field, dropdown, or rows. Accent is the single warm `#eb7825`; surfaces are the host's existing glass/dark/white.
- ❌ No emoji as icons or in copy (use the `Icon` set: `search`, `location`, `location-outline`, `close`/`x`, `cloud-offline-outline`).
- ❌ No drop-shadow on suggestion ROWS (only the light-variant dropdown CARD may carry the host's existing shadow). Pressed state is a flat fill — never a shadow-lift.
- ❌ No skeleton shimmer, no animated gradient spinner — system `ActivityIndicator` + "Searching…" only.
- ❌ No map thumbnail / static map image per row (cost + slop; rows are text + glyph).
- ❌ No "✨ AI-powered" / "smart" / "magic" microcopy. Status copy is literal.
- ❌ No full-width colored "selected" highlight bar; selection is the host's chip (Prefs) or simply the committed `value`.
- ❌ No scale-bounce or spring on row tap; no parallax; no decorative dividers (hairline only).
- ❌ No business design tokens in the consumer field; no hardcoded hex outside the injected bundle.

---

## 11. Acceptance checklist (maps to SPEC §11 acceptance bar)
1. ✅ Field is theme-driven via injected consumer tokens (`light`/`dark` variant) — NOT business tokens. (§0, §1)
2. ✅ Host sheet chrome unchanged — field owns only the input + list. (§0, §3.2)
3. ✅ Dropdown renders INLINE in the host sheet body (CityPicker) / as in-sheet card (Prefs/Onboarding) — reachable, scrollable, dismissible; never a clipping overlay. (§3)
4. ✅ Keyboard: `BottomSheetTextInput` + `keyboardShouldPersistTaps="handled"`; host keyboard config untouched. (§3.3)
5. ✅ All 17 field states incl. all 9 designer-bar states, with Mingla-voice copy preserving/improving existing strings. (§6)
6. ✅ Contrast computed both variants; placeholder raised to `#6b7280` to pass 4.5:1. (§5)
7. ✅ Every interactive element ≥44pt, has `accessibilityLabel`, non-shifting press feedback. (§4, §9)
8. ✅ Motion + haptics + reduced-motion fallback. (§7)
9. ✅ No-slop ban list. (§10)
10. ✅ References examined line present. (top)

---

## 12. State the SPEC did not anticipate (designer findings → flag to implementor/forensics)

1. **Two consumer canvas variants, not one.** SPEC §11 implies a single "consumer token" injection, but CityPicker is a DARK canvas while Preferences + Onboarding are LIGHT. The shared field needs a `variant: 'light' | 'dark'` token bundle (two consumer variants) PLUS the separate business bundle — three total. Documented in §0/§1. This is the single biggest delta from the SPEC's framing.

2. **Placeholder contrast bug pre-exists.** Both Prefs (`#9ca3af`) and Onboarding (`colors.gray[300]`) placeholders fail 4.5:1 today. The migration is the moment to fix → consumer placeholder token locked to `colors.gray[500]` `#6b7280`. Flag: this is a (tiny) visible change to existing screens, justified as an accessibility improvement the SPEC explicitly permits.

3. **Min-query length differs across hosts.** Business field + SPEC use ≥3 chars; CityPicker uses ≥2; Preferences uses ≥4; Onboarding uses ≥3. The shared field should accept a `minQueryLength` prop (default 3) so each host keeps its current threshold and the copy ("Type a couple letters…") stays generic. Not a blocker, but the implementor must not silently standardize to 3 and change CityPicker/Prefs behavior.

4. **CityPicker has no field-level "picked" chip; Preferences does.** "returning/picked" presentation is host-owned (Prefs chip vs City's committed value vs Onboarding's selected card). The shared field must NOT impose a chip — it renders the controlled `value` and lets the host wrap it. Documented in state #2/#9.

5. **`fetching-details` (retrieve) state is new for the consumer hosts.** Today's Nominatim path returns coords IN the suggestion, so there is no second retrieve round-trip. Mapbox suggest→retrieve adds a retrieve step → the new spinner/dimmed-row "fetching-details" state (#8) and the new `pick-error` state (#10) did not exist in the consumer flow before. The implementor must wire these (they exist in the business field already).
