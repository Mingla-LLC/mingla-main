# DESIGN — META-ORCH-1337 [social-proof-guest-list] · Guest Social Proof

**Phase:** DESIGN (pixel-precise contract; NO product code)
**Serves:** ORCH-1340 [card-real-avatars] · ORCH-1341 [guest-list-sheet-consumer] · ORCH-1342 [web-see-whos-going-funnel] (light leg)
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-1337-[social-proof-guest-list]`
**Date:** 2026-07-10
**Investigation:** `Mingla_Artifacts/investigations/INVESTIGATION_META-ORCH-1337_SOCIAL_PROOF_GUEST_LIST.md` (Q7/Q8/Q11, F-7, F-10, F-11 binding)
**Components read (verbatim source):** `packages/offering-rendering/RsvpMomentumDecision.tsx` (744 lines) · `packages/offering-rendering/rsvpMomentum.ts` · `packages/offering-rendering/themePalette.ts` · `app-mobile/src/components/ui/BaseBottomSheet.tsx` · `MessageInterface.tsx:2215-2299` + `:3510-3623` (EventAudienceSheet + styles) · `app-mobile/src/components/connections/FriendsActionChooserSheet.tsx` · `mingla-marketing/app/download/page.tsx` · `mingla-marketing/lib/store-links.ts`
**Comms:** COMMS-0084 (BaseBottomSheet overlay slot + sheet-regression history — binding, designed-for in §2.9/§5) and COMMS-0083 (AppsFlyer go-live gates — binding on §3 sequencing) read and factored. Ledger acks/writes are the orchestrator's (sub-agent, one-artifact contract).

---

## 0 · Design intent — the moment

A guest lands on an event page deciding "is this MY night?". The single strongest answer is *who else is going*. Today the card says "4 going" with three identical orange silhouettes that do nothing. This design turns that row into real faces where privacy allows, an honest silhouette where it doesn't, and one tap into a warm, name-by-name guest list where friendships start — without ever fabricating a face, leaking a private guest, or promising the web what only the app delivers.

**Product reality this design is built around (not edge-cased):**
- ~15% avatar fill (F-11) → **the mixed photo+glyph cluster is the PERMANENT normal state.** The system must look *designed* at 0, 1, 2, or 3 photos — never "broken avatars".
- 60/61 profiles are `visibility_mode='friends'` → per sealed D1, `public|friends` guests show identity, `private` shows glyph + anonymous row. Most rows WILL be identified.
- Anonymous and identified rows coexist in one list; blocked users are simply absent (server-side; nothing to design).
- Web-anon sees the card cluster; the full list is app-gated — the web tap sells the app, honestly.

**One-system rule:** the disk is the atom. The same disk grammar (photo-in-disk, glyph-in-disk, +N-in-disk) renders on the card at 30px and in the sheet at 46px. A user who taps through sees the same people get bigger and gain names — continuity, not two designs.

Spacing grid: 4/8pt (existing card uses 14/16/18 rhythm — respected, not re-gridded). All card colors from `palette.*` (THEME-DIAL gate, test `orch_1157_rsvp_momentum.test.ts:132-145` stays green). All sheet colors from `app-mobile` design-system values matched to the EventAudienceSheet exemplar family.

---

## 1 · The momentum-card cluster with real avatars (ORCH-1340)

### 1.1 Anatomy — what changes and what does not

Inside the existing momentum unit (`styles.momentum`: radius 20, borderWidth 1, padding 18, `opaqueCardFill(palette)` fill, `palette.panelBorder` border — **unchanged**), the cluster block becomes:

```
momentum unit
├── count row        (unchanged: 40/900 count + "going")
├── sub-line         (unchanged: derived subLabel)
├── meter            (unchanged: 8px track, accent fill)
└── clusterBlock     ← ONE <Pressable>, replaces the plain cluster <View>
    ├── clusterRow   (disks + "+N" chip + "are pulling up" note)   ← row 1
    └── seeRow       ("See who's going" + chevron glyph)           ← row 2
```

**Why one Pressable around both rows:** two stacked pressables double the a11y surface and create a dead strip between them; one target is ~60pt tall (30 + 10 + 20), comfortably ≥44pt with zero hitSlop, and the visible link label is the affordance for the whole group. **Rule: the tap surface never exists without the visible link** — no invisible tap zones.

| Element | Value | Why |
|---|---|---|
| `clusterBlock` marginTop | 14 (moves off the old `cluster.marginTop`) | keeps the meter→cluster rhythm byte-identical |
| `clusterRow` | `flexDirection:'row', alignItems:'center'` | today's cluster row, minus its own margin |
| disk | 30×30, radius 999, borderWidth 2, borderColor `palette.page`, overlap `marginLeft:-8` (first disk 0), `overflow:'hidden'` | **existing geometry — photos load INTO it**, zero layout change |
| `+N` chip | same disk geometry; fill `opaqueCardFill(palette)`; text 11/800 `palette.secondaryText` | **unchanged (my call).** It is already the correct overflow affordance; making it independently tappable would duplicate the link below at a sub-44pt size |
| note "are pulling up" | 12/600 `palette.tertiaryText`, marginLeft 12 | kept — it is the personality of the row and now doubles as the plain-language cue for the anonymous disks |
| `seeRow` | `flexDirection:'row', alignItems:'center', gap:4, marginTop:10, minHeight:20` | the discoverable entry to the sheet |
| link label | "See who's going" — 13px, `boldFontFamily(theme)`, letterSpacing 0.2, color **`palette.primaryText`** | see 1.4 for why NOT accent |
| chevron | new `ChevronGlyph` SVG 12×12 (viewBox 24, `M9 6l6 6-6 6`, strokeWidth 2.4, strokeLinecap round), stroke **`palette.accent`** | accent carries the "go" energy as a ≥3:1 UI-component mark, exempt from the 4.5:1 text rule |

Disk count math is **unchanged**: `momentum.shownAvatars = min(3, goingCount)` disks + `+N` when `goingCount > 3` (`rsvpMomentum.ts:52-54`). Real avatars change what fills a disk, never how many disks exist — the cluster remains an honest COUNT motif first.

### 1.2 The disk system — photo, glyph, +N, and every state

**Payload contract (for the 1338/1340 SPEC):** the card receives `guestSample?: ReadonlyArray<{ id: string; avatarUrl: string }>` — an ordered array of **only** guests whose identity is publicly showable (per D1: `visibility_mode public|friends`) AND who have an avatar, length ≤ 3, server-ordered. Disk `i` (0-based, of `shownAvatars` disks) renders the photo `guestSample[i]` if it exists, else the glyph. **The card never receives names, usernames, or private/blocked guests** — the payload IS the privacy boundary, and the card's props stay identity-light (narrows the F-10 invariant rewrite: photos yes, names never on the card).

**Disk states (each fully specified):**

1. **Glyph disk (default / fallback / anonymous)** — exactly today's: fill `palette.accent`, 15px `PersonGlyph` stroked `palette.accentText`, 2px `palette.page` border. This is the resting state of every disk.
2. **Photo loading** — the glyph disk IS the loading state. The `<Image>` (absolute, inset 0, radius inherited via the disk's `overflow:'hidden'`, `resizeMode:'cover'`) mounts at opacity 0 above the glyph. No skeleton, no shimmer — at 30px a shimmer is noise, and the glyph is already a designed, honest placeholder. Zero layout shift by construction.
3. **Photo loaded** — `onLoad` → animate opacity 0→1, 160ms, `Easing.out(Easing.ease)`, `useNativeDriver:true`, **`isInteraction:false`** (ORCH-1303 gate binds every `Animated.timing` in this file). After load, a photo disk ALSO renders an inner hairline: absolute View, inset 0, radius 999, borderWidth 1, borderColor `palette.panelBorder` — photo content is uncontrolled, and this accent-tinted hairline guarantees edge definition against any page tone without creating a "premium ring" class system.
4. **Photo failed** — `onError` → unmount the Image; the disk stays a glyph disk permanently. **Indistinguishable from no-photo. Deliberate** (next point).
5. **Private guest / no photo — indistinguishable, by design.** A distinct "private" treatment (dim, lock badge, different fill) would leak the one bit the guest chose to hide: *that someone is hiding*. Uniform glyphs make privacy free — an observer cannot tell "private guest" from "hasn't added a photo yet" from "photo failed to load". This is the visual half of the D1 privacy decision and MUST be stated in the successor invariant (F-10 rewrite).

**Ordering:** photos occupy the leading disks, glyphs trail (a consequence of the payload contract, not a client sort). Why: the faces are the payload of the row; a photo sandwiched between glyphs reads as an error. Honest: every disk still represents a real confirmed guest; only *which* guests fill the visible sample is ordered.

**Android opaque rule:** photo disks are opaque by nature; glyph disks use solid `palette.accent`; the `+N` chip already routes through `opaqueCardFill` (= raw `palette.page` on Android per the component's existing `Platform.OS` switch). No new translucency introduced; no Android shadow under any rounded fill. Nothing new to fall back.

### 1.3 Color/token map + contrast (card)

| Element | Token | On | Contrast note |
|---|---|---|---|
| glyph disk fill | `palette.accent` | card fill | ≥3.15:1 vs page guaranteed by `contrastAdjustedAccent` — UI component ✓ |
| glyph stroke | `palette.accentText` (#ffffff) | accent | ≥4.5:1 guaranteed by `contrastAdjustedForWhiteText` ✓ |
| disk border | `palette.page` (2px) | — | separation ring; matches today |
| photo hairline | `palette.panelBorder` (1px) | photo edge | decorative edge definition |
| `+N` text | `palette.secondaryText` | `opaqueCardFill(palette)` | existing pairing, unchanged ✓ |
| note text | `palette.tertiaryText` | card fill | existing pairing, unchanged ✓ |
| link label | `palette.primaryText` | card fill | `readableTextFor(page)` → ≥~15:1 ✓ AA at any size |
| chevron | `palette.accent` | card fill | non-text UI mark, ≥3:1 ✓ |
| pressed feedback | opacity 0.7 on `clusterBlock` children | — | no new color token needed |

**NO hex literals anywhere** — every value above is a `palette.*` read or an existing helper (`opaqueCardFill`, `boldFontFamily`). The THEME-DIAL test block (`:132-145`) must stay green over the new code.

### 1.4 The link — and why it is NOT accent-colored

`palette.accent` guarantees only ≥3.15:1 against the page (its 4.5:1 guarantee is vs *white*, for text sitting ON accent). At 13px — below the WCAG large-text threshold (18.66px bold) — accent-colored link text would fail AA on an unknowable subset of brand themes. This card renders under *every* brand's dial; a link that is readable on the demo theme and illegible on a real host's theme is a broken design.

So the affordance is built from **weight + glyph + position + feedback**, not hue: `palette.primaryText` at 13px in the theme's true bold face, a `palette.accent` chevron (UI component — 3:1 rule, guaranteed), trailing placement in the card (the universal "view all ›" slot), and a 0.7-opacity press state. This passes AA on every theme by construction. (WCAG kit invariants I-38/I-39.)

- **Default:** as specced in 1.1.
- **Pressed:** children opacity 0.7 (Pressable style function). No scale — the card already animates a meter and a pulsing dot; a third motion would jitter.
- **Hover (web / rn-web):** same 0.7 opacity on hover; cursor pointer comes free from Pressable on rn-web.
- **Hit area:** the combined Pressable ≈ 60pt tall × full card width ≥44pt ✓. No hitSlop needed.
- **a11y:** `accessibilityRole="button"`, label `` `${goingCount} going. See who's going` ``; inner disks + note `importantForAccessibility="no-hide-descendants"` / `accessibilityElementsHidden` (the group label carries everything; 3 unlabeled disks would be screen-reader noise).

### 1.5 Gated + zero states

- **`privateGuestList` ON (leg 1339 wires the gate):** `clusterRow` AND `seeRow` are absent — the whole `clusterBlock` does not render. **Nothing replaces it.** The count + sub-line + meter stand alone (aggregate momentum is not identity; the meter's marginTop 14 + card padding 18 close the card cleanly). No "guest list is private" caption — a privacy feature that announces "there is a hidden list here" is advertising the thing it hides. Absence IS the design.
- **`goingCount === 0`:** unchanged honest zero — "Be the first to RSVP", empty meter, no cluster, and **no link** (a "See who's going" into an empty sheet is a dead end; the link earns its place only when there is someone to see).
- **`onSeeWhosGoing` prop absent** (business preview, any surface that hasn't wired the sheet): `clusterRow` renders as today (non-pressable View), `seeRow` absent. The package component stays pure and never emits a dead tap (Constitution rule 1; I-MOR-0827 — no fetch, no navigation knowledge in the package).

### 1.6 Proposed props delta (for the SPEC — final naming is the SPEC's)

```ts
/** Ordered, privacy-filtered avatar sample; ≤ RSVP_CLUSTER_SHOWN entries. */
guestSample?: ReadonlyArray<{ id: string; avatarUrl: string }>;
/** Present ⇒ cluster is pressable + "See who's going" renders. Absent ⇒ today's inert cluster. */
onSeeWhosGoing?: () => void;
```

F-10 rewrite reminder (1340's CLOSE, not this file): `orch_1157_rsvp_momentum.test.ts:120-130` (no-Image/no-uri/no-guest-prop assertions) must be rewritten under the tests-append-only token; the doc-contract at `RsvpMomentumDecision.tsx:21-27` gets the new contract; the successor invariant preserves the ADDRESS-privacy half verbatim and adds the "private ≡ no-photo indistinguishability" clause from 1.2.5.

### 1.7 Motion (card)

| Animation | Trigger | Curve | Duration | Property | Reduced-motion |
|---|---|---|---|---|---|
| photo fade-in | Image `onLoad` | `Easing.out(ease)` | 160ms | opacity 0→1 | instant (opacity 1, no timing) |
| press feedback | Pressable pressed | n/a (state style) | instant | opacity 1→0.7 | same (state, not motion) |

Both `useNativeDriver:true`; anything routed through `Animated.timing` in this file carries `isInteraction:false` (strict-grep `orch-1303-rsvp-loop-interaction-handle` binds the whole file). Existing dot-pulse + meter animations untouched.

### 1.8 Accessibility (card) — summary

- One button: `"{n} going. See who's going"`; disks/note hidden from the tree (1.4).
- Link text AA-safe on every theme (1.4); all other pairings are existing, unchanged pairings.
- Target ≥44pt (≈60pt); Dynamic Type: label scales (`allowFontScaling` default), `seeRow` minHeight grows with content — no `numberOfLines` cap needed on a 3-word label; disks fixed-size (images, exempt).

### 1.9 Per-platform deltas (card)

- **iOS:** as specced; translucent tokens already routed through `opaqueSurfaceColor` composites where fills matter.
- **Android:** `opaqueCardFill` → raw `palette.page` (existing switch); no elevation/shadow under rounded fills; photo disks opaque.
- **Web (rn-web, buyer-web + business preview):** identical render; `<Image>` is RN core (no new dep — respects the biz-web bundle-budget gate); hover = 0.7 opacity; the same `onSeeWhosGoing` prop drives the §3 web gate instead of the §2 sheet.

---

## 2 · The consumer guest-list sheet (ORCH-1341) — `EventGuestListSheet`

### 2.1 The moment + IA

The user just tapped a row of faces — they are curious and warm, not task-driven. The sheet answers three questions in order: *who* (rows), *can I connect* (add-friend / message per row), *how many really* (count in the header, "+N more" at the tail). One flat list — sections would bureaucratize a party guest list; at prod scale (≤ tens of rows, RPC-capped) the identified→anonymous gradient is self-evident from the rows themselves.

### 2.2 BaseBottomSheet configuration (exact)

```tsx
<BaseBottomSheet
  visible={visible}
  onClose={onClose}                    // ALL dismiss analytics here (SPEC §3.1 rule)
  snapPoints={GUEST_LIST_SNAP}         // module-level const ['70%'] — see below
  wrapInRNModal                        // z-stack over the event page (EventAudienceSheet posture)
  theme="dark"
  scrollMode="flatlist"                // homogeneous rows; gorhom container (never a raw RN list)
  backgroundStyle={styles.guestSheetBackground}
  accessibilityLabel="Who's going"
  header={<GuestSheetHeader/>}         // intrinsic-height SIBLING (ORCH-1043)
  scrollProps={{ data, renderItem, keyExtractor, contentContainerStyle, ListFooterComponent }}
/>
```

- **Snap: fixed `['70%']`, single detent, `initialIndex 0`.** Proven inside a wrapInRNModal window by EventAudienceSheet with the same shape (roster list); FriendsActionChooserSheet's comment documents why content-height sizing mis-measures inside the RN-Modal wrap — fixed percentage is the reliable pattern. Long lists scroll inside; no second detent (nothing above 70% earns the reach).
- `tabBarAware={false}` + `hidesBottomNav={false}` — wrapInRNModal sheets z-stack above the nav behind the backdrop (BaseBottomSheet doc, Bug 4); mutually exclusive with tabBarAware by contract.
- `enablePanDownToClose` default true; backdrop default dark 0.55; open/close motion = stock gorhom default spring (LOCKED — do not re-litigate, primitive header §105-114).
- **No search field in v1** — the payload is row-capped (~≤100) and the list is one flick long; a search field would drag in the full ORCH-1171 keyboard-in-modal apparatus for zero user value at this scale. If the cap is ever raised, add search THEN, with `BottomSheetTextInput` + `keyboardBehavior="interactive"` + the Done bar. Keyboard behavior is therefore N/A in this design.
- **App-chrome surface, not brand-themed.** The sheet uses the consumer app's dark sheet family (exemplar values below), NOT `palette.*`. Brand theming ends at the event page; the sheet is Mingla's room. This matches EventAudienceSheet exactly and keeps the palette out of app-mobile plumbing.

`guestSheetBackground` (exemplar parity, `MessageInterface.tsx:3512-3518`): `backgroundColor '#111418'`, top radii 26, borderTopWidth 1, borderColor `rgba(255,255,255,0.10)`.

### 2.3 Header (slot content)

Geometry = EventAudienceSheet header verbatim (`:3522-3555`): row, gap 12, paddingHorizontal 20, paddingTop 4, paddingBottom 18, bottom hairline `rgba(255,255,255,0.08)`.

| Element | Spec |
|---|---|
| icon shell | 42×42, radius 21, fill `colors.primary[500]` (#f97316), Ionicon `people` 18px #ffffff |
| title | "Who's going" — 20/800 #ffffff |
| subtitle | `"{goingCount} going"` — 13/600 `rgba(255,255,255,0.58)`, marginTop 3 |

Subtitle carries the count, not the event title — the user just came FROM the event page; repeating its title is noise, and long titles truncate ugly. The count in the header also keeps the list honest when rows are capped (header says 120, list shows 100 + "and 20 more").

### 2.4 Row anatomy

Base row (all variants): `flexDirection:'row', alignItems:'center', minHeight 64, paddingVertical 8`, bottom hairline `rgba(255,255,255,0.06)`; list `contentContainerStyle: paddingTop 10, paddingBottom 24`; horizontal inset paddingHorizontal 20. Row body = avatar (46) + 12 gap + text column (flex 1, minWidth 0, marginRight 10) + action zone.

**Avatar: 46×46, radius 23** — exemplar parity beats the dispatch's "44px?" suggestion; the ROW is the ≥44pt target, and matching EventAudienceSheet keeps the app's roster-sheet family one system.

| Variant | Avatar | Line 1 (16/700 `#f8fafc`, 1 line, ellipsize tail) | Line 2 (12/600 `rgba(255,255,255,0.48)`, marginTop 3) | Actions |
|---|---|---|---|---|
| Identified, photo | `ImageWithFallback` photo, border 1px `rgba(255,255,255,0.32)` | `display_name` | `@username` · fallback "On Mingla" when username null | per 2.5 |
| Identified, no photo | initials disk: fill `#eb7825`, initials 15/800 #ffffff (decorative — name adjacent carries the info; exemplar parity) | `display_name` | same | per 2.5 |
| Plus-one / unlinked guest (`is_mingla_user=false`) | glyph disk: fill `rgba(255,255,255,0.10)`, `PersonGlyph`-style icon 20px stroked `rgba(255,255,255,0.55)` | guest name if the payload carries one, else "Guest" | "Guest of {host-side name}"? NO — payload doesn't carry linkage; just "Guest" | none (not reachable on Mingla) |
| Anonymous (private profile) | same glyph disk as unlinked | "Someone" | "Keeping it low-key" | none — actions on an anonymous row would deanonymize |
| You (viewer's own row) | own avatar/initials | own display_name | "You" | none |

Photo `onError` → initials fallback (identified) / glyph (others). Rows are **NOT pressable** — only the action buttons are. Opening the full profile from inside a wrapInRNModal sheet is a modal-over-modal footgun (COMMS-0084) and out of 1341's scope; a non-pressable row with visible per-row actions has no dead tap. (Explicit non-goal — flag for a future ORCH if profile-peek is wanted; it must use the `overlay` slot, never a second RN Modal.)

### 2.5 Row actions — inline icon buttons (the ONE chosen idiom)

**Chosen: two trailing inline icon buttons.** Rejected: swipe actions (undiscoverable + fight the sheet's pan/scroll gestures inside gorhom); per-row chooser sheet (a second sheet for a two-action space = a tap tax, plus another layering surface to police). Inline buttons are visible, one-tap, and every state has a place to live.

Button geometry: 40×40 circle, `hitSlop 4` (→48pt effective), icon 20px, 10px gap between the two buttons. Pressed: scale 0.96 + opacity 0.85 (Pressable style fn). Haptic `HapticFeedback.medium()` on action fire (chooser-sheet idiom).

**Add-friend button states:**

| State | Visual | Interactive |
|---|---|---|
| default (not friends, no pending) | Ionicon `person-add-outline` `#f97316`, fill `rgba(249,115,22,0.14)`, border 1px `rgba(249,115,22,0.35)` | tap → in-flight |
| in-flight | 16px ActivityIndicator `#f97316` replaces icon; disabled | — |
| sent (success) → **"Requested" chip** | replaces the button: pill paddingH 10, paddingV 5, radius 999, fill `rgba(255,255,255,0.08)`, text "Requested" 12/700 `rgba(255,255,255,0.55)` | disabled (`accessibilityState={{disabled:true}}`). Cancel-request exists in plumbing (`cancelFriendRequest`) but is deliberately NOT here in v1 — destructive affordances don't belong in a party list; flag as optional follow-up |
| pending already (from cross-ref at open) | same "Requested" chip from first render | disabled |
| failed | revert to default + transient line-2 hint "Couldn't send — try again" (2.5s, see below) | tap again |
| already friends | button absent entirely — friendship is expressed by the live Message button | — |
| incoming request exists (they asked YOU) | same as default v1 (accepting from here is scope creep); SPEC may upgrade to an "Accept" chip via `accept_friend_request_atomic` — flagged, not required | — |

**Message button states (D4 / ORCH-0993 friend-gate — the gate is KEPT):**

| State | Visual | Interactive |
|---|---|---|
| friends | Ionicon `chatbubble-outline` `#f97316`, fill `rgba(249,115,22,0.14)`, border `rgba(249,115,22,0.35)` | tap → **close sheet first, then** `ensureConversation` → navigate to the conversation. Sequencing kills the sheet-under-navigation z-mess and honors "no second modal" by never needing one |
| locked (not friends) | same icon at `rgba(255,255,255,0.28)`, fill `rgba(255,255,255,0.06)`, no border | tap → transient hint (below). Visible-but-locked beats hidden: it TEACHES that messaging exists and how to unlock it. Disabled-contrast exemption applies (WCAG), and the a11y hint carries the rule |
| blocked pair | row absent entirely (server exclusion) — nothing to design | — |

**Transient line-2 hint (the microcopy mechanism):** pressing a locked/failed control swaps the row's line 2 to the hint text — same 12px slot, color `rgba(255,255,255,0.72)` for emphasis — fade in 120ms, hold 2500ms, fade out 200ms, then restore. In-window, in-flow, zero toast plumbing (the Toast absolute-wrapper class and the RN-Modal window problem never arise). Locked-message hint: **"Add them as a friend to message"**. Reduced-motion: instant swap/restore, same hold.

### 2.6 Order, cap, and the tail

**Sort (display sort, applied to the payload):** ① You → ② identified with photo → ③ identified without photo → ④ unlinked guests → ⑤ anonymous. Within a band, payload order (server recency). Why "You" first: instant confirmation your RSVP registered — the list greets you. Why anonymous last: glyph rows are texture, not payload; leading with them reads broken.

**Cap tail:** when `goingCount > rows.length`, `ListFooterComponent` renders "and {goingCount − rows.length} more" — 13/600 `rgba(255,255,255,0.48)`, centered, paddingVertical 16. Honest count reconciliation, no "load more" in v1 (cap is a privacy/scrape guard, not a pagination seam — F-8).

**Pull-to-refresh: NO.** Pull-down at scroll-top IS the dismiss gesture in a gorhom sheet — a RefreshControl would fight it (the exact gesture-conflict class the primitive exists to prevent). Fresh fetch on every open + error-retry covers staleness for a sheet-lifetime surface.

### 2.7 Loading / empty / error states

- **Loading skeleton:** 6 placeholder rows (avatar circle 46 fill `rgba(255,255,255,0.06)`; name bar 120×12 radius 6 fill `rgba(255,255,255,0.08)`; sub bar 80×10 radius 5 fill `rgba(255,255,255,0.05)`). One shared opacity pulse 0.5↔1.0, 1000ms/leg, `Easing.inOut(ease)`, `isInteraction:false` (ORCH-1303 discipline — a loop must never hold an InteractionManager handle). Reduced-motion: static opacity 0.7. 6 rows ≈ fills the 70% sheet without implying a count.
- **Empty — gated mid-view** (`privateGuestList` flipped ON between card render and RPC): centered block paddingVertical 28: Ionicon `lock-closed-outline` 28 `rgba(255,255,255,0.35)`; title "This guest list is private" 15/700 #ffffff; body "The host keeps it just for the guests." 13/500/18lh `rgba(255,255,255,0.56)`, marginTop 6. No action — closing the sheet is the action.
- **Empty — zero guests** (race: last guest withdrew): title "No one yet"; body "Someone has to be first." Same geometry. Warm, zero pressure.
- **Error + retry:** title "Couldn't load the guest list"; body "Give it another go."; Retry button: pill 44pt min-height, paddingH 20, fill `colors.primary[500]`, text "Retry" 14/700 #ffffff, marginTop 14. Retry re-fires the fetch → skeleton.
- **State transitions:** skeleton→content/empty/error cross-fade 150ms ease-out (reduced-motion: instant). **No entrance stagger on rows** — cheap-motion rule; the sheet's own spring is the entrance.

### 2.8 Accessibility (sheet)

- Sheet label "Who's going". Header title `accessibilityRole="header"`.
- Row = one accessible group: "Amara Okafor, at-amara, on Mingla" / "Someone, keeping it low-key" / "{name}, you". Reading order: header → rows top-down → footer.
- Buttons: "Add {name} as a friend" / "Message {name}"; locked: + `accessibilityHint "Available once you're friends"`; "Requested" chip: "Friend request sent to {name}", disabled state set.
- Targets: rows 64pt; buttons 48pt effective; retry ≥44pt. Dynamic Type: `minHeight` (never fixed height) on rows lets text scale; name/username stay 1-line ellipsized.
- Contrast (on #111418): name #f8fafc ≈15:1 ✓; 0.58-white subtitle ≈7:1 ✓; 0.48-white sub-lines ≈5.4:1 ✓; accent #f97316 icons ≈6.5:1 (UI ≥3:1 ✓); locked icons are disabled-exempt; initials-on-#eb7825 decorative (name adjacent) — noted, not relied on.

### 2.9 Regression-class compliance (Q7 map — how this design dodges each)

| Class | This design |
|---|---|
| META-0991 (raw RN Modal sheets / sole-gorhom) | BaseBottomSheet consumer; GHRV owned by the primitive; strict-grep `meta-orch-0991-…-sole-consumer` stays green |
| ORCH-0908/1315/COMMS-0084 (modal-over-modal) | ONE wrapInRNModal sheet; nothing layers above it — Message navigates AFTER close; profile-open excluded; if anything ever must layer, it is the `overlay` slot (render `null` when hidden) — NEVER a second RN Modal |
| ORCH-1016 (nav painted over CTA) | wrapInRNModal z-stacks above nav; `hidesBottomNav` false, `tabBarAware` false |
| ORCH-1040/1043 (header/body wrapping) | header is the intrinsic-height sibling slot; body is the primitive's own flatlist container; CI `orch-1043-sheet-scroll-viewport-check` green |
| ORCH-1064 (half-open stall) | stock primitive motion, no `animationConfigs` |
| ORCH-1138 (dynamic-size mismeasure) | fixed `['70%']`, no dynamic sizing (chooser-sheet lesson applied) |
| ORCH-1157 R8/R9 (Android bottom gap) | primitive-owned under wrapInRNModal; list bottom padding 24 |
| ORCH-1171 (keyboard in RN-Modal window) | N/A — no text input in v1 (2.2); if search is added later, it ships with the 1171 apparatus |
| ORCH-1190/1191 (bottom fill) | primitive-owned; opaque #111418 canvas to the physical bottom |

Android delta: canvas + all fills above are opaque values (#111418, rgba-on-opaque) — no backdrop-filter, no translucent card over content, no shadow under rounded fills. Light theme: **none** — consumer roster sheets are dark by exemplar contract regardless of app theme; `theme="dark"` always.

Suggested testIDs: `orch-1341-guest-sheet`, `-row-{id}`, `-add-friend`, `-message`, `-requested`, `-skeleton`, `-empty`, `-error-retry`, `-footer-more`. Card: `orch-1340-cluster-press`, `-see-whos-going`, `-avatar-img-{i}`.

---

## 3 · Web "See who's going" (ORCH-1342 light) — `SeeWhosGoingGate`

The shared card renders the identical cluster + link on buyer-web (automatic — §1 is the same component). `onSeeWhosGoing` on web opens the **gate**, never a web guest list: web-anon gets faces-in-the-cluster and the count; names live in the app (F-7 pre-auth). The gate's job is to make that feel like an invitation, not a wall.

Both variants live in `mingla-business` (rn-web), so they are specced in RN primitives and **`palette.*` tokens** (they float over the brand-themed page; palette keeps them native to it — and biz-web strict-grep hygiene keeps hex out).

### 3.1 Mobile-web: bottom-sheet-style interstitial (chosen over direct redirect)

A direct store-redirect punts the user off the event page with zero explanation — hostile, and it loses the purchase context. The interstitial keeps the page, says why, and offers ONE action.

- **Scrim:** absolute inset 0, `rgba(0,0,0,0.55)`, fade 120ms; tap = dismiss.
- **Panel:** absolute bottom, full-width, `opaqueSurfaceColor(palette)` fill, top radii 26, borderTopWidth 1 `palette.panelBorder`, padding 20/24 (sides/bottom + safe-area), handle bar 36×4 radius 999 `palette.panelBorder` centered top (marginBottom 14). Slide-up: translateY 100%→0, 240ms, cubic-bezier(0.32,0.72,0,1) (RN `Easing.bezier`). Reduced-motion: 120ms fade, no slide.
- **Content:** mini-cluster echo (the same 30px disk row rendered from `guestSample`, non-pressable — continuity: "these people are in there"); title "See who's going" 22/`boldFontFamily` `palette.primaryText` marginTop 14; body "Guest faces, names, and the group chat live in the Mingla app." 14/500/20lh `palette.secondaryText` marginTop 6.
- **Primary action:** "Get the app" — full-width pill, height 52, radius 16, fill `palette.accent`, text 16/800 `palette.accentText`. Handler = the **ORCH-1328 client-side pattern**: resolve UA → open `APP_STORE_URL` / `PLAY_STORE_URL` (consumer SSOT, `mingla-marketing/lib/store-links.ts:6-8` values — 1342 must give mingla-business an SSOT import/copy and retire the F-12 stale URL) client-side while STAYING on the page. This URL is the seam that later becomes the OneLink with the guest-sheet payload (F-9; dark until native builds + S2S token ship — COMMS-0083).
- **Secondary:** "Not now" — text button, 44pt row, 14/600 `palette.secondaryText`, centered, marginTop 4. Pressed: 0.7 opacity (both actions).

### 3.2 Desktop: QR dialog (reuses the `/download` visual language — ORCH-1319, `mingla-marketing/app/download/page.tsx:52-80`)

Centered dialog over the same scrim: max-width 420, radius 28, fill `opaqueSurfaceColor(palette)`, border 1px `palette.panelBorder`, padding 36, scale 0.96→1 + fade 160ms ease-out (reduced-motion: fade only). Close: 44×44 ✕ button top-right (icon 20 `palette.secondaryText`); Esc + scrim-click also dismiss.

Content, top-down (the /download page's kicker→title→body→white-QR-card→"or"→badges rhythm, brand-toned):
1. Kicker "MINGLA" — 12/700, uppercase, letterSpacing 3, `palette.accent`.
2. Title "See who's going" — 30/`boldFontFamily` `palette.primaryText`, marginTop 10.
3. Body "Scan with your phone — the full guest list lives in the app." — 15/500/22lh `palette.secondaryText`, marginTop 8.
4. QR card: solid **#ffffff** card (the ONE deliberate non-palette fill — scanner contrast is a hardware requirement, matching /download's white QR card exactly), radius 22, padding 20, marginTop 24, centered; QR 180×180 encoding the smart-download URL (→ OneLink later, same seam).
5. Divider row "or" — hairlines `palette.panelBorder`, label 12/600 uppercase letterSpacing 2 `palette.tertiaryText`, marginTop 24.
6. Store badges row (App Store + Google Play, 40pt height, the DownloadMinglaCta badge assets with corrected URLs), marginTop 20, centered, gap 12.

a11y: dialog role, labelled by the title; focus trapped in-dialog, returned to the link on close; QR gets `accessibilityLabel "QR code — scan to get the Mingla app"`; badges are links with store names.

### 3.3 Web behavioral notes

- Breakpoint: reuse PublicEventPage's existing desktop/phone split (the same one that picks sticky-panel vs floating-dock) — one system, no new breakpoint.
- The gate NEVER shows names/usernames — cluster faces + count only (already-public card data). App-gating is the point, stated warmly, sold once.
- `privateGuestList` ON removes the card affordance on web exactly as in §1.5 — the gate is unreachable, nothing to design.

---

## 4 · Copy block (canonical voice: warm, experience-first, zero hype-scarcity)

**Card (§1):** "are pulling up" (kept) · "See who's going" · "Be the first to RSVP" (kept).
**Sheet (§2):** "Who's going" · "{n} going" · "@{username}" · "On Mingla" · "Guest" · "You" · "Someone" · "Keeping it low-key" · "Requested" · "Add them as a friend to message" · "Couldn't send — try again" · "and {n} more" · "This guest list is private" / "The host keeps it just for the guests." · "No one yet" / "Someone has to be first." · "Couldn't load the guest list" / "Give it another go." · "Retry".
**Web (§3):** "See who's going" · "Guest faces, names, and the group chat live in the Mingla app." · "Get the app" · "Not now" · "MINGLA" · "Scan with your phone — the full guest list lives in the app."
**a11y strings:** "{n} going. See who's going" · "Add {name} as a friend" · "Message {name}" (+hint "Available once you're friends") · "Friend request sent to {name}" · "QR code — scan to get the Mingla app".

**Recommendation only — the 1339 SPEC owns final momentum copy:** keep the big-number label "going" for ALL entities (one system; tickets are people going); for ticketed hard-full, sub-line "Sold out" (not "Full · waitlist open" — no waitlist on ticketed); trips/experiences keep "N spots left · filling up / filling fast" unchanged. Flagged, not binding.

---

## 5 · Consolidated guard notes + build-ready handoff

**Binding gates the new code must keep green:** THEME-DIAL no-hex (card) · `orch-1303-…-interaction-handle` (`isInteraction:false` on every timing/loop in the card; applied by discipline in the sheet) · `meta-orch-0991-base-bottom-sheet-sole-consumer` · `orch-1043-sheet-scroll-viewport-check` · NO-CHECKOUT + DECISION-IS-HERO (nothing here adds checkout affordances or displaces the decision) · `orch-1292` taxonomy labels untouched · I-MOR-0827 (avatar data via props; no fetch in the package) · Constitution #9 (glyph fallback is honest; nothing fabricated) · address-privacy half of the 1157 invariant survives the F-10 rewrite verbatim.

**New tokens/components required:** none in the palette (all 14 existing tokens suffice — deliberate). New SVG: `ChevronGlyph` (card). New components: `EventGuestListSheet` (app-mobile), `SeeWhosGoingGate` (mingla-business). New card props per §1.6.

**Decisions the SPEC/implementor could get wrong without this file:** link label is `primaryText` NOT accent (1.4 — AA on arbitrary brand themes); private ≡ no-photo indistinguishability is deliberate and invariant-bound (1.2.5); one Pressable wraps cluster+link, no affordance without the visible link (1.1); `privateGuestList`-ON renders NOTHING in the cluster's place (1.5); sheet is app-chrome dark, never palette-themed (2.2); fixed `['70%']` single snap (2.2); rows non-pressable, actions only (2.4); Message keeps the ORCH-0993 friend-gate, locked state visible with the transient line-2 hint — no toasts (2.5); Message navigation closes the sheet FIRST (2.5); no pull-to-refresh (2.6); no search in v1 (2.2); web gate = interstitial, never a redirect, never names (3.1/3.3); QR card is solid white by scanner requirement (3.2).
