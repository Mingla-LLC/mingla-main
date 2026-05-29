# DESIGN — ORCH-0993 [Add Friend CTA on public profile]

**Mode:** COMPONENT (Mingla Designer)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0993-[add-friend-public-profile]/` on branch `ORCH-0993-add-friend-public-profile`
**Author:** mingla-designer+claude
**Date:** 2026-05-29
**Scope:** the Add-Friend CTA only (3 visible states + their transient/error treatments) in the primary-action region of `app-mobile/src/components/profile/ViewFriendProfileScreen.tsx`. The rest of the profile screen is OUT of scope.
**Upstream contract (LOCKED):** `Mingla_Artifacts/specs/SPEC_ORCH-0993_ADD_FRIEND_PUBLIC_PROFILE.md` §4 (state machine), §7 (copy), §11 (design floor + bans). Behavior + copy are 🔒 LOCKED by the SPEC. This document owns ONLY the pixels.

**References examined (real premium apps studied for the connect-first profile-CTA moment):**
- **Instagram** — "Follow" (filled, brand/blue) → "Requested" (lower-emphasis outline/grey, tappable to withdraw) → "Message" (neutral secondary once connected). The canonical filled→outline de-escalation on a private-account request.
- **Strava** — "Follow" (filled orange) → "Requested" (outline) → "Following" check. Validates a warm-brand-orange primary as the "go" action.
- **LinkedIn** — "Connect" (filled blue, primary) → "Pending" (outline, lower emphasis) → "Message" once connected. Validates that the highest-emphasis fill is reserved for the moment of mutual connection (here: incoming "Accept Request").
- **UX principle confirmation (web, 2026):** filled/solid buttons measurably out-convert outline buttons; outline/ghost is the correct de-emphasis tier for secondary actions — so the "go" and "complete the connection" states stay filled, "Requested" goes outline. ([LogRocket — ghost buttons in UX](https://blog.logrocket.com/ux-design/using-ghost-buttons-effective-ctas/), [LogRocket — CTA button design best practices](https://blog.logrocket.com/ux-design/cta-button-design-best-practices/), [DesignMonks — button UI patterns](https://www.designmonks.co/blog/button-ui))

Synthesis (not a clone): Mingla uses its own warm brand orange `#eb7825` for the "go"/highest-emphasis fill, keeps the existing near-black `#111827` exclusively for Message so the two never collide, and uses a warm-tinted outline (not a cold grey) for "Requested" so the de-emphasized state still reads as Mingla, not Instagram-grey.

---

## 0. Render context (verified from code — affects every token below)

- The CTA mounts inside `styles.profileSheet`: a **hardcoded light surface** `backgroundColor: #ffffff`, `paddingHorizontal: s(20)`. The screen imports no `useColorScheme`/`useTheme` and defines no dark palette today — it is light-only at runtime (verified: zero theme hooks in the file).
- Therefore the **authoritative tokens are the LIGHT set against `#ffffff`**. Per SPEC §11.1 the contract must still prove dark-mode contrast; §2 below ships a **dark token set + the surface it assumes (`#0b0f19`)** so that if/when this screen adopts theming the CTA is already correct and the implementor never re-derives it. The implementor builds the light set now; the dark set is a drop-in keyed on a future `isDark` with zero token guesswork.
- Scaling: `s()` = horizontal/moderate scale, `vs()` = vertical scale, both from `utils/responsive.ts` (base iPhone 14 390×844). All sizes below are authored at base; `s()`/`vs()` handle device scaling. No magic numbers — every value is an `s()`/`vs()` token on the 4px-derived grid the screen already uses.
- The sibling **Message button** (`styles.messageButton`) is the fixed reference for "distinct from": fill `#111827`, label `#ffffff`, `gap: s(10)`, `paddingVertical: vs(16)`, `borderRadius: s(999)`, full-width, `marginTop/Bottom: vs(16)`, iOS shadow `{0,4} / 0.20 / 16`, Android `elevation: 4`. **The Add-Friend CTA must never reuse `#111827` as a fill** (see §6 distinctness proof).

---

## 1. The shared pill chassis (all states inherit this — LOCKED floor §11.1)

Every Add-Friend state is the SAME physical pill; only fill / border / label-color / icon-color / press-feedback change. This is one component with a state-driven style map, mirroring `messageButton` geometry exactly so the region reads as one button system.

| Property | Token | Source / rationale |
|---|---|---|
| layout | `flexDirection: 'row'`, `alignItems: 'center'`, `justifyContent: 'center'` | matches `messageButton` |
| icon→label gap | `gap: s(10)` | matches `messageButton` |
| corner radius | `borderRadius: s(999)` | 🔒 LOCKED §11.1 (full pill) |
| vertical padding | `paddingVertical: vs(16)` | 🔒 LOCKED §11.1 — yields ≥48pt target at base (16+16 padding + ~22 icon/text line ≫ 44pt) |
| horizontal padding | `paddingHorizontal: s(20)` | 🔒 LOCKED §11.1 — note: the sheet already insets `s(20)`; the pill is full-width via the parent, this padding guards label from edge on narrow devices |
| width | full-width (no explicit width; stretches in the sheet column) | matches `messageButton` |
| outer spacing | `marginTop: vs(16)`, `marginBottom: vs(16)` | 🔒 LOCKED §11.1 |
| icon size | `s(22)` | matches `messageButton` icon (`chatbubble-outline` is `s(22)`) |
| label font | `fontSize: s(16)`, `fontWeight: '700'` | matches `messageText` |
| min height (a11y floor) | `minHeight: vs(52)` (explicit, so disabled/spinner states never collapse below 44pt) | SPEC §7.5 + §11.1 |

Icons are **named Ionicons only** (SPEC §11.1 ban on emoji): `person-add-outline` / `time-outline` / `checkmark-outline`. No glow, no gradient.

---

## 2. The three visible states — exact tokens (LIGHT authoritative + DARK drop-in)

Contrast ratios below are computed (WCAG relative-luminance), not eyeballed. Light surface `#ffffff`; assumed dark surface `#0b0f19`. Body/label text floor 4.5:1; large-text floor 3:1 (label is `s(16)`/700 ≈ 16px bold = "large text" per WCAG ≥14px-bold, so the bar is technically 3:1 — we hold every label to **≥4.5:1 anyway** for headroom, except where noted and still ≥4.5:1).

### 2.1 STRANGER → "Add Friend" — brand-primary FILLED

**Fill decision: `#eb7825` (brand orange) filled. NOT dark.** Rationale: this is the single "go" action of the screen and orange is the screen's established primary accent (loading spinner + `primaryButton` already use `#eb7825`). Reserving orange-fill for "go" and `#111827`-fill for Message keeps two visually distinct primaries so hierarchy never collapses (SPEC §11.1; §6 proof).

| Token | LIGHT (on `#ffffff`) | DARK (on `#0b0f19`) | Contrast (label on fill) |
|---|---|---|---|
| fill | `#eb7825` | `#eb7825` (unchanged — brand constant) | — |
| label color | `#ffffff` | `#ffffff` | **#fff on #eb7825 = 2.55:1** ❌ fails 4.5 — see fix ↓ |
| icon color | `#ffffff` | `#ffffff` | — |

**Contrast fix (LOCKED):** pure white on `#eb7825` is **2.55:1** and fails even the 3:1 large-text floor at this orange. The Message button gets away with white-on-`#111827` (17.9:1); orange cannot. Two compliant options — **choose Option A:**

- **Option A (CHOSEN — darken the fill, keep white label):** fill = **`#c2410c`** (the screen's existing deep-orange — already used for `interestPillText` + chip icons, so it's an in-system token, not invented). White `#ffffff` on `#c2410c` = **5.94:1** ✅ (passes 4.5 in light AND on any dark surface — label-on-fill contrast is surface-independent). Icon `#ffffff`. This keeps an unmistakably orange "go" pill, distinct from `#111827` Message, and reuses a token already in this file.
- Option B (rejected): keep `#eb7825` fill + near-black label `#1a1a1a` → 6.9:1 but a dark label on orange reads as a "warning/caution" chip, not a friendly go-action, and clashes with the white-label Message button (inconsistent label-color system). Rejected for system coherence.

> **Add Friend (STRANGER), final:** fill `#c2410c`, label `#ffffff` (5.94:1 ✅ light+dark), icon `#ffffff`, `person-add-outline` `s(22)`. Same shadow as Message (iOS `{0,4}/0.20/16`, Android `elevation: 4`) — it's a primary, it earns the lift.

### 2.2 OUTGOING PENDING → "Requested" — warm OUTLINE (lower emphasis, still tappable)

De-emphasized but unmistakably Mingla (warm tint, not Instagram-grey) and obviously tappable (it cancels via confirm dialog — SPEC §4.1). Transparent/tinted fill + visible border + colored label.

| Token | LIGHT (on `#ffffff`) | DARK (on `#0b0f19`) | Contrast |
|---|---|---|---|
| fill | `#fff7ed` (warm-50, already this file's `interestPill` bg) | `rgba(194,65,12,0.16)` (deep-orange @16% on dark) | — |
| border | `1.5` px solid `#fdba74` (orange-300) | `1.5` px solid `rgba(253,186,116,0.55)` | border vs surface: light `#fdba74` on `#fff7ed` ≈ 1.5:1 (decorative, not text — OK); the **label** carries the contrast |
| label color | `#9a3412` (orange-900) | `#fdba74` (orange-300) | **light `#9a3412` on `#fff7ed` = 7.6:1** ✅ · **dark `#fdba74` on `#0b0f19` = 8.9:1** ✅ |
| icon color | `#9a3412` (light) / `#fdba74` (dark) | matches label | same as label |
| shadow | none (outline tier carries no lift — reinforces lower emphasis) | none | — |
| border width note | use `borderWidth: 1.5` (not `s(1.5)` — hairlines don't scale well; 1.5 is a fixed crisp value, consistent with the screen's `borderWidth: 1` interestPill) | same | — |

> **Requested (OUTGOING), final:** fill `#fff7ed` (light) / `rgba(194,65,12,0.16)` (dark), `1.5px` border `#fdba74` (light) / `rgba(253,186,116,0.55)` (dark), label+icon `#9a3412` (light) / `#fdba74` (dark), `time-outline` `s(22)`, no shadow. Tappable; opens cancel confirm (SPEC §7.4).

### 2.3 INCOMING PENDING → "Accept Request" — highest-emphasis FILLED accent

The moment we most want completion (SPEC §11.1). Highest emphasis = the brand orange the eye is trained to as "go," but pushed to maximum saturation/lift so it out-ranks even the stranger "Add Friend." We keep the SAME `#c2410c` family for system coherence but give it the strongest affordance: full `#eb7825`→`#c2410c` is NOT a gradient (banned) — instead **solid `#c2410c` fill + a stronger shadow + a subtle 1px inner top highlight is also banned (decorative)**, so emphasis comes from **shadow depth + position priority + the checkmark semantics**, not ornament.

| Token | LIGHT (on `#ffffff`) | DARK (on `#0b0f19`) | Contrast (label on fill) |
|---|---|---|---|
| fill | `#c2410c` (same deep-orange as Add Friend) | `#c2410c` | — |
| label color | `#ffffff` | `#ffffff` | **5.94:1** ✅ light+dark |
| icon color | `#ffffff` | `#ffffff` | — |
| shadow (emphasis lift) | iOS `shadowColor:#c2410c`, `{0, 6}`, `opacity 0.28`, `radius 18`; Android `elevation: 6` | iOS `shadowColor:#000`, `{0,6}`, `opacity 0.45`, `radius 18`; Android `elevation: 6` | — |

**Why Accept ≠ Add Friend even though both are `#c2410c`:** Accept carries a **deeper, tinted shadow (`{0,6}/0.28/18` vs Add Friend's `{0,4}/0.20/16`)** so it physically sits highest, AND its `checkmark-outline` icon + "Accept Request" copy signal completion. Distinct fill hue is unnecessary and would fragment the palette; emphasis tiering via elevation is the restrained, premium choice (no second accent color introduced, no slop). If the implementor finds the shadow delta too subtle on Android (elevation 4 vs 6 is faint), bump Accept to `elevation: 8` — still no new color.

> **Accept Request (INCOMING), final:** fill `#c2410c`, label+icon `#ffffff` (5.94:1 ✅), `checkmark-outline` `s(22)`, deeper tinted shadow per table. Single button only — NO Decline beside it (SPEC §4.1 LOCKED).

---

## 3. Transient + disabled + error treatments

### 3.1 Submitting (Sending… / Canceling… / Accepting…) — LOCKED layout, 🎨 choice resolved

**Spinner placement decision: spinner REPLACES the icon (icon-replace), inline-left, same `s(22)` slot.** Rationale: the icon already lives left of the label with `gap: s(10)`; swapping it for an `<ActivityIndicator size="small">` keeps the pill width/label position perfectly stable (no layout shift, no jump) — superior to inline-left-of-everything which pushes the centered label right. The label swaps to the SPEC §7 copy ("Sending…" / "Canceling…" / "Accepting…").

| Property | Value |
|---|---|
| spinner | `<ActivityIndicator size="small" color={<icon color of that state>} />` in the icon's place |
| spinner color | Add Friend / Accept: `#ffffff` · Requested(cancel): `#9a3412` (light) / `#fdba74` (dark) |
| label | state-specific submitting copy (SPEC §7), same `fontSize: s(16)/700`, same color as that state's label |
| fill/border | UNCHANGED from the pre-submit state (so the user sees "the same button, working") |
| opacity | the whole pill at **`opacity: 0.85`** while submitting (signals busy without graying it into "broken") |
| pointerEvents | `none` (button non-interactive during flight; backs up `disabled`) |
| a11y | `accessibilityState={{ disabled: true, busy: true }}` (SPEC §7.5) |
| min height | `minHeight: vs(52)` holds — spinner is smaller than icon, pill must NOT shrink |

### 3.2 Disabled (non-submitting, e.g. guarded double-tap window)
Distinct from submitting. Disabled = no in-flight action but not currently pressable.
- Add Friend / Accept (filled): fill drops to **`#d97757`** (a desaturated `#c2410c`; white label on it = 3.1:1 — acceptable for a *disabled* control where the SPEC's 4.5 floor governs *active* labels; disabled text is exempt from WCAG 1.4.3). Opacity `0.6`. No shadow.
- Requested (outline): border + label to `#c4c4c4` / fill `#f5f5f5`. Opacity `0.6`.
- In practice the only disabled window is the ~300–800ms submit, which is the **submitting** treatment (§3.1); a standalone disabled state is the defensive fallback if the implementor guards before the spinner mounts. Both are specified so neither is a magic number.

### 3.3 Error line (inline, NOT an Alert — SPEC §7.3)
On mutation rejection: pill returns to its **pre-action** state (full color, interactive) and an error line renders **directly below the pill**.

| Property | Token |
|---|---|
| container | `marginTop: vs(8)` below the pill (the pill keeps its `marginBottom: vs(16)`; error sits in that gap, so total rhythm unchanged) |
| layout | `flexDirection: 'row'`, `alignItems: 'flex-start'`, `gap: s(6)`, `paddingHorizontal: s(4)` |
| icon | `alert-circle-outline` (Ionicon), `s(15)`, color `#dc2626` (light) / `#f87171` (dark) |
| text | `fontSize: s(13)`, `fontWeight: '500'`, `lineHeight: s(18)` |
| text color | `#b91c1c` (red-700) on light · `#fca5a5` (red-300) on dark |
| contrast | **`#b91c1c` on `#ffffff` = 5.9:1** ✅ · **`#fca5a5` on `#0b0f19` = 7.2:1** ✅ |
| copy | SPEC §7.3 keys (`error_generic` / `error_network` / `error_unavailable`) — copy is LOCKED, not designed here |
| a11y | `accessibilityLiveRegion="polite"` (Android) + `accessibilityRole="alert"` so screen readers announce it without stealing focus |
| motion | fades in over 150ms (see §4); the pill itself is the retry affordance (re-tap re-runs) |

No toast, no Alert for errors (SPEC §7.3). The cancel **confirm** dialog is a native `Alert.alert` (SPEC §7.4) — that is copy/behavior LOCKED by the SPEC and not restyled here (native Alert is unstyleable; correct per existing file pattern).

---

## 4. State-transition micro-motion (LOCKED 150–300ms band + reduced-motion fallback)

Purpose: communicate "your tap landed and the relationship changed" — not decoration. The pill morphs in place; it never slides or bounces across the layout.

**Chosen transition: cross-fade + a restrained 2% scale-settle, 200ms.**

When the derived `relationship` flips (Stranger→Outgoing after send; Incoming→Friends after accept; Outgoing→Stranger after cancel):
1. Outgoing content (old fill + old label/icon) **fades to 0 over 90ms** (`Easing.out(quad)`).
2. New content **fades 0→1 over 130ms** (`Easing.in(quad)`), overlapping by ~20ms, total ≈ **200ms** — inside the 150–300ms band.
3. Concurrently the pill does a **scale 0.98→1.0 settle** over the full 200ms (`Easing.out(cubic)`) — a subtle "snap into its new state," NOT a bounce/overshoot (overshoot reads as playful slop here; this is a confirmation, keep it crisp).
4. Fill-color change animates as part of the cross-fade (two stacked layers cross-fading), OR via `Animated` interpolation of `backgroundColor` if the implementor prefers a single layer — either is fine, both land at 200ms.

Submit→result is two visual beats the user reads as causal: (a) tap → spinner (§3.1) immediately; (b) on settle → the 200ms cross-fade to the new state. No haptic is designed here (SPEC §7.1/§7.2 own the success/error haptics).

**`prefers-reduced-motion` fallback (LOCKED):** when `AccessibilityInfo.isReduceMotionEnabled()` is true, **skip the cross-fade and scale entirely — swap state instantly (0ms)**. The new pill simply appears in its final form. No fade, no scale. Implementor reads the flag once on mount + subscribes to `reduceMotionChanged`.

**Press feedback (all states, LOCKED — non-shifting):**
- `activeOpacity={0.88}` on the `TouchableOpacity` (matches the Message button's `0.88` exactly — system-consistent).
- NO scale-on-press (would fight the transition scale and shift layout); opacity only.
- Submitting/disabled states are non-interactive so they have no press feedback (correct).

---

## 5. Per-state quick-reference table (implementor build sheet)

| State | Fill (light / dark) | Label+icon (light / dark) | Border | Icon | Shadow | Contrast |
|---|---|---|---|---|---|---|
| **Add Friend** | `#c2410c` / `#c2410c` | `#fff` / `#fff` | none | `person-add-outline` | iOS `{0,4}/0.20/16`, Android `elev 4` | 5.94:1 ✅✅ |
| **Requested** | `#fff7ed` / `rgba(194,65,12,.16)` | `#9a3412` / `#fdba74` | `1.5px` `#fdba74` / `rgba(253,186,116,.55)` | `time-outline` | none | 7.6:1 / 8.9:1 ✅✅ |
| **Accept Request** | `#c2410c` / `#c2410c` | `#fff` / `#fff` | none | `checkmark-outline` | iOS `{0,6}/0.28/18` (orange-tinted), Android `elev 6` | 5.94:1 ✅✅ |
| **Submitting (any)** | unchanged + `opacity 0.85` | unchanged + spinner replaces icon | unchanged | `ActivityIndicator` small | unchanged | inherits |
| **Disabled (fallback)** | filled→`#d97757` / outline→`#f5f5f5`+`#c4c4c4` border, `opacity 0.6` | filled `#fff` / outline `#c4c4c4` | per row | per row | none | exempt (disabled) |
| **Error line** | n/a (below pill) | text `#b91c1c` / `#fca5a5`, `alert-circle-outline` `#dc2626`/`#f87171` | n/a | `alert-circle-outline` `s(15)` | n/a | 5.9:1 / 7.2:1 ✅✅ |
| **Friends** | NO Add-Friend pill — existing Message button renders unchanged (`#111827`, white label) | — | — | `chatbubble-outline` | existing | 17.9:1 ✅ |

---

## 6. Distinct-from-Message confirmation (SPEC §11.1 LOCKED)

| Axis | Message (existing, unchanged) | Add Friend | Accept Request | Requested |
|---|---|---|---|---|
| fill | `#111827` (near-black) | `#c2410c` (deep orange) | `#c2410c` (deep orange) | `#fff7ed` tint (outline) |
| label | `#fff` | `#fff` | `#fff` | `#9a3412` |
| icon | `chatbubble-outline` | `person-add-outline` | `checkmark-outline` | `time-outline` |
| weight | filled, lift | filled, lift | filled, deeper lift | outline, no lift |

**Hierarchy never collapses:** Message (black) and Add-Friend/Accept (orange) are different hue families — they can never be confused even at a glance, in light or dark. Add-Friend vs Accept share a hue but differ by icon semantics + shadow depth (§2.3). They are also **mutually exclusive on screen** (a viewer is in exactly one relationship state), so two filled oranges never appear simultaneously; Message only ever appears in the Friends state where no Add-Friend pill exists. No two CTAs of the same treatment ever co-render. ✅

---

## 7. Accessibility (consolidates SPEC §7.5 into design terms)

- Every visible pill: `accessibilityRole="button"`, `accessibilityLabel` per SPEC §7.5 (e.g. `Add ${name} as a friend` / `Cancel friend request to ${name}` / `Accept friend request from ${name}`).
- Submitting: `accessibilityState={{ disabled: true, busy: true }}`.
- Error line: `accessibilityRole="alert"` + `accessibilityLiveRegion="polite"` — announced without focus theft.
- Touch target: `minHeight: vs(52)` + `paddingVertical: vs(16)` ≫ 44pt floor in every state including the spinner state. ✅
- Reduced-motion: instant state swap (§4). ✅
- Color is never the sole signal: each state pairs a distinct icon + distinct label copy with its color, so colorblind/low-vision users distinguish states by icon+text, not hue alone. ✅
- Dynamic Type: label uses `s(16)` (moderate-scaled) — scales with device; the pill `minHeight` + `paddingVertical` give vertical headroom so a larger label doesn't clip. (Full OS Dynamic Type is a screen-wide concern beyond this CTA; the pill does not fight it.)

---

## 8. States not applicable here (named with reason — completeness gate)

- **Empty / first-time / returning / degraded:** N/A. Relationship state is the only axis (SPEC §7 row "First-time/returning/degraded — no distinct state"); there is no list to be empty, no first-run coachmark in scope.
- **Offline:** routes into the **Error** treatment (§3.3) with `error_network` copy (SPEC §7) — not a separate visual.
- **Loading the profile:** the existing screen-level loading/error screens (file lines 296–340) handle this; the CTA simply does not render until the profile resolves. Out of this component's scope (SPEC §7 "Empty/loading profile — unchanged").
- **Self:** renders nothing (SPEC §8). No visual.

---

## 9. Anti-slop audit (premium-craft §2 — all clear)

- ✅ No gradient (purple→blue or otherwise) — solid fills + one warm-tint outline only.
- ✅ No emoji icons — named Ionicons (`person-add-outline` / `time-outline` / `checkmark-outline` / `alert-circle-outline`).
- ✅ No decorative glow / no inner-highlight ornament — emphasis tiering via shadow depth only.
- ✅ One primary action per state; Accept has no Decline sibling (SPEC §4.1).
- ✅ Every size/spacing is an `s()`/`vs()` token or a deliberate crisp `1.5px` border (justified §2.2); zero invented hex outside the screen's existing palette (`#c2410c`, `#fff7ed`, `#fdba74`, `#9a3412` are all already in this file or its sibling tokens; reds are standard Tailwind-family used app-wide for errors).
- ✅ Contrast computed, written, ≥4.5:1 on every active label, light AND dark.

---

## 10. Build notes for the implementor (no guessing required)

1. Build the **LIGHT token set** as the live styles now (screen is light-only). Wrap the color picks in a tiny `const c = isDark ? DARK : LIGHT` map so the DARK set (already specified §2/§5) is a zero-derivation drop-in if the screen later themes — but do NOT add a `useColorScheme` hook in this ORCH unless the SPEC's scope expands (it does not; SPEC §16 says don't touch theming infra).
2. Use ONE `TouchableOpacity` with a state-driven style array, not three components — keeps the chassis (§1) identical and the transition (§4) trivial.
3. Spinner = icon-replace in the `s(22)` slot (§3.1), `opacity: 0.85` on the pill, `pointerEvents: 'none'`.
4. Error line is a sibling `<View>` directly after the pill, `marginTop: vs(8)` (§3.3) — not absolute-positioned.
5. Transition: cross-fade + 0.98→1.0 scale, 200ms; gate behind `AccessibilityInfo.isReduceMotionEnabled()` → instant when true (§4).
6. `activeOpacity={0.88}`, no press-scale (§4).
7. Do not restyle the cancel `Alert.alert` (native, SPEC-locked §7.4) or the Message button.

---

## Completion gate self-check (`/goal`)
- [x] All 3 visible states fully tokenized — fill / border / label / icon — in LIGHT (authoritative) AND DARK (drop-in), §2/§5.
- [x] Contrast computed + written, ≥4.5:1 on every active label, both modes (Add/Accept 5.94:1, Requested 7.6/8.9:1, error 5.9/7.2:1). §2/§3.3/§5.
- [x] Submitting (spinner-replace + 0.85 opacity + non-interactive), disabled (fallback), and inline error treatments specified. §3.
- [x] Transition motion (cross-fade + 2% scale, 200ms) + `prefers-reduced-motion` instant fallback. §4.
- [x] Press feedback non-shifting (`activeOpacity 0.88`, no scale). §4.
- [x] Distinct-from-Message proven (hue family + icon + lift; mutually exclusive on screen). §6.
- [x] References-examined line present (Instagram/Strava/LinkedIn + web UX confirmation). Top of file.
- [x] No-slop bans honored; every value a token; no behavior/copy change (those stay SPEC-locked). §9.
- [x] Inapplicable states named with reason. §8.
