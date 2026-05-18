# DESIGN — ORCH-0864 [Marketing Composer V2 — inline chip rich-text editor]

> Design exploration only — NOT a spec. Produces concepts + tradeoffs so Seth can pick one direction before `mingla-forensics` writes SPEC. Surfaces in scope: business-iOS, business-Android, business-web-preview.

## 0 — Layman summary of this artifact (read this first)

This file shows three different ways the campaign composer could feel. All three solve the same problem: today it reads like a settings form with `{first_name}` shown as raw text, events embedded via a separate sheet, and templates that "just dump text into the box." Seth wants a writing surface where events appear inline as tappable chips and personalization gets inserted from a toolbar inside the editor.

The three concepts trade off in different directions:

- **Concept A — "Notion-style slash menu"** — Most familiar mental model. Type `/` to summon a palette of insertable things (events, personalization tokens, links). Toolbar floats only on selection. Templates open as an overlay; tap one to replace current content. Lowest friction for power users, highest "I don't see the buttons" risk for first-timers.
- **Concept B — "Floating insertion bar" (Recommended for Seth)** — Sleek persistent bar above the keyboard with three taps: `[+ Event]  [{ } Personalize]  [📎 Template]` (icons not emoji in real build). Tap reveals the right inline palette. Subject row has its own mini-bar above it. Templates "melt in" via a side-slide preview drawer — you swipe through templates and see live preview before commit. Highest discoverability, slight extra screen weight.
- **Concept C — "Inline `@`-mention everything"** — Type `@` anywhere → autocomplete dropdown filters across events, personalization tokens, and templates in one unified picker. Single mental model ("everything is an @-mention"), zero visible toolbar in the resting state. Very minimal aesthetic, but discoverability is the worst of the three — operators won't know `@` exists without onboarding.

The renderer choice (WebView-based rich text vs custom RN segment renderer) is independent of concept. **Recommendation: TenTap (React-Native + ProseMirror via WebView bridge) for renderer + Concept B for UX.** Reasoning at §6.

---

## 1 — What's wrong with V1 today (anchors the redesign)

Read `mingla-business/app/(tabs)/marketing/campaigns/compose.tsx` and the operator's verbatim feedback:

> "right now it seems confusing and a lot with a lot of slugs and the way it is composed, even the way templates show up in the composer."

Concrete V1 failures, in plain English:

| # | What an operator sees today | Why it feels wrong |
|---|---|---|
| 1 | Body shows `Hi {first_name},` as literal text | Looks like a programmer's placeholder, not a personalization |
| 2 | Event embed is a multi-line block `{{event:abc-123}}` mid-body | Operator can't tell what event it is without scrolling to the chip row below |
| 3 | Embedded event chips render in a SEPARATE row below the body | Disconnect between "where the card appears in the email" and "what the chip row says" |
| 4 | Personalization tokens only have 2 insertable: `first_name` + `brand_name` (despite renderer supporting 11) | Operators don't know `event_name`, `spots_left`, etc. exist |
| 5 | Templates: tap one in Templates tab → composer opens with text pasted → no preview, no melt-in | Feels like a paste-buffer, not a starting point |
| 6 | Stacked sections (Who → What → When) make a single email feel like a form wizard | Writing is interrupted by sections; subject and body should be one continuous canvas |
| 7 | Variable-insert toolbar (2 chips) is INSIDE `ComposerStepWhat` card, far from cursor | Insertion lands far from where the cursor was; no inline `@` or `/` affordance |
| 8 | No subject-line personalization affordance — operator must type `{first_name}` by hand | Forces operators to memorize slug syntax |
| 9 | No template-while-composing — operator must back out to Templates tab | Loss of context, drafts can be lost mid-swap |
| 10 | No rich text (bold / italic / link) — emails look flat | Modern marketing emails have at least minimal formatting |

The redesign must fix 1, 2, 3, 4, 5, 7, 8 at minimum; 6 is concept-level; 9 is concept-level; 10 is renderer-level.

---

## 2 — Shared design system (binds all three concepts)

No new tokens. All three concepts compose from `mingla-business/src/constants/designSystem.ts`:

| Token | Use in composer |
|---|---|
| `canvas.discover` | Composer background |
| `text.primary / .secondary / .tertiary` | Body / subject / placeholder text |
| `accent.warm` (#EB7825) | Insertion-bar primary action chip (matches Overview + Campaigns FAB philosophy) |
| `spacing.xs / sm / md / lg` | Vertical rhythm |
| `radius.full / .lg / .md` | Chip pills (full), card containers (lg), toolbar (md) |
| `typography.bodyLg` (subject) | Slightly larger than body |
| `typography.body` | Body text |
| `typography.bodySm` | Chip labels, captions |
| `typography.caption` | Compliance footer |

**Chip visual contract (concepts A/B/C all share this):**

- **Event chip:** rounded-rect pill, 28pt tall, leading 12pt event-cover thumbnail (or calendar-icon fallback), then event title (truncate at ~18 chars), then date short-format ("Sat Jun 7"); background `rgba(235,120,37,0.16)` with `border: 1px solid accent.border`; tap → inline popover with chip-editor (see §3).
- **Personalization chip:** small rounded-rect pill, 24pt tall, monospace label like `first_name`, leading `{`/`}` glyph in muted color; background `rgba(255,255,255,0.06)`; tap → popover with token preview ("→ Sarah" for the first audience member).
- **Link chip (renderer permitting):** inline underline + small chain-link icon trailing; long-press → edit URL.

Underlying string contract is unchanged from ORCH-0815: body stores `{first_name}` and `{{event:<uuid>}}` verbatim. Chips are a render-time concept. This preserves I-PROPOSED-MKT-TEMPLATE-TOKENS-VERBATIM.

---

## 3 — Concept A — "Notion-style slash menu"

### 3.1 Essence

Type `/` anywhere in subject or body → palette appears at cursor. Toolbar only appears on text selection (bold, italic, link, color). Templates accessed via `/template`. Subject and body are one continuous canvas separated by a thin divider — no "Step 2" framing.

### 3.2 Mockup — empty state

```
┌──────────────────────────────────────────┐
│  ←  New campaign           Save  Review  │  ← header (existing pattern)
├──────────────────────────────────────────┤
│                                          │
│  To: All brand buyers · 142 reachable ▾  │  ← inline audience picker
│  ─────────────────────────────────────   │
│                                          │
│  Subject                                 │  ← placeholder label
│  │                                       │  ← cursor; type / to insert
│                                          │
│  ─────────────────────────────────────   │
│                                          │
│  │                                       │  ← body cursor; type / to insert
│                                          │
│                                          │
│                                          │
├──────────────────────────────────────────┤
│  From <Brand> · Unsubscribe auto · …     │  ← compliance footer (existing)
└──────────────────────────────────────────┘
```

### 3.3 Mockup — mid-compose with slash-menu open

```
│  Subject                                 │
│  Save your seat, ⎡first_name⎤! ▮         │  ← chip in subject, cursor after
│  ─────────────────────────────────────   │
│                                          │
│  Hey ⎡first_name⎤,                       │
│                                          │
│  /                                       │  ← user typed `/`
│  ┌─────────────────────────────────┐     │  ← slash palette
│  │  ↳ Insert                       │     │
│  │  ▢ Event card                ▶  │     │
│  │  { } Personalization        ▶   │     │  ← nested submenu
│  │  🔗 Link                        │     │
│  │  ✂  From template            ▶  │     │
│  │  ━  Divider                     │     │
│  └─────────────────────────────────┘     │
│                                          │
```

After selecting "Event card" → searchable list of brand events with cover thumbnails. After selecting an event → chip lands at cursor:

```
│  Hey ⎡first_name⎤,                       │
│                                          │
│  We're doing it again — ⎡▣ Sunset Mixer  │
│   · Sat Jun 7⎤ — and I want you there.   │
│                                          │
│  ▮                                       │
```

### 3.4 Chip taxonomy (Concept A)

- Event chip tap → inline popover (140pt wide × 200pt tall, anchored below chip): `[Cover preview] [Title row, editable] [Date+time row] [CTA label dropdown: "RSVP" / "Get tickets" / "See details"] [Remove event] [Open full event editor →]`. Only the CTA label is per-chip editable; title/date come from event, edits send the operator to the actual event page.
- Personalization chip tap → tiny popover: `[Preview: "Sarah"] [Replace with another token →]`. No edit — it's a token.
- Link chip → standard rich-text link editor (existing pattern).

### 3.5 Toolbar — selection-only

When user selects text → floating tooltip toolbar appears above selection: `[B] [I] [Link] [Color]`. No persistent toolbar in resting state — keeps the canvas clean.

### 3.6 Template-into-editor pattern

Slash menu → "From template" → opens a horizontal scroller across the top of the editor showing template cards (cover preview, title). Tap a template → confirmation sheet: `"Replace current draft with 'Welcome series #1'?"  [Cancel]  [Replace]`. If body is empty, no confirmation — direct insert. Replace = full subject + body swap (template tokens preserved verbatim).

### 3.7 Accessibility model (A)

- Slash menu: VoiceOver announces "Insert menu open, 5 items, swipe right to navigate." Each item has `accessibilityHint`.
- Chips: VoiceOver reads "Event chip, Sunset Mixer, June 7, double-tap to edit." Web: chips are `<button>` with `aria-label`.
- Keyboard nav on web: arrow keys move between chips inside body; Enter opens chip popover.

### 3.8 Cross-surface notes (A)

- iOS: slash-menu anchor positioning must avoid keyboard collision (use `KeyboardAvoidingView` + manual offset when caret near bottom).
- Android: slash-menu position drifts under keyboard rotation — anchor to viewport, not caret.
- Web: slash-menu uses native CSS popover; arrow-key nav.

### 3.9 Risk

Discoverability — operator who never types `/` won't find anything. Mitigated by an inline "Tip: type `/` to insert events and personalization" caption that fades in once on first-use.

### 3.10 Implementation cost signal (A)

Requires a true editor with token/slash hook. Custom segment renderer over RN `TextInput` can't do slash-menus reliably (text-selection events fire late). WebView-bridged editor (TenTap or pell) handles this natively. Renderer pick: WebView-based, mandatory.

---

## 4 — Concept B — "Floating insertion bar" (Recommended for Seth)

### 4.1 Essence

A persistent insertion bar floats above the keyboard with three pills: `[+ Event]  [{ } Personalize]  [Templates]`. Subject row has its own thin mini-bar with only `{ } Personalize` (events make no sense in subject). On selection → secondary formatting tooltip appears (B, I, Link). Templates open as a side-slide preview drawer — operator swipes through templates and sees a live preview rendered with their current audience before tap-to-apply.

### 4.2 Mockup — empty state

```
┌──────────────────────────────────────────┐
│  ←  New campaign           Save  Review  │
├──────────────────────────────────────────┤
│                                          │
│  To: All brand buyers · 142 reachable ▾  │
│  ─────────────────────────────────────   │
│                                          │
│  Subject     [ { } Personalize ]          │  ← subject mini-bar (right-aligned)
│  ╔════════════════════════════════════╗  │
│  ║ ▮                                  ║  │  ← subject input, big
│  ╚════════════════════════════════════╝  │
│                                          │
│  Body                                    │
│  ┌────────────────────────────────────┐  │
│  │ ▮                                  │  │
│  │                                    │  │
│  │                                    │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ════════════════════════════════════    │
│  [ + Event ]  [ { } Personalize ]  [ ⋮ ] │  ← floating insertion bar (above kb)
├──────────────────────────────────────────┤
│  From <Brand> · Unsubscribe auto · …     │
└──────────────────────────────────────────┘
```

The `[ ⋮ ]` overflow contains: Insert link, Insert divider, **From template…**, Insert image.

### 4.3 Mockup — mid-compose with event chip + personalization chip

```
│  Subject     [ { } Personalize ]         │
│  ╔════════════════════════════════════╗  │
│  ║ Save your seat, ⎡first_name⎤!     ║  │  ← chip in subject
│  ╚════════════════════════════════════╝  │
│                                          │
│  Body                                    │
│  ┌────────────────────────────────────┐  │
│  │ Hey ⎡first_name⎤,                  │  │
│  │                                    │  │
│  │ We're back at it. Doors open at    │  │
│  │ 8pm and last call is 1am — same    │  │
│  │ rules, better drinks.              │  │
│  │                                    │  │
│  │ ┌──────────────────────────────┐   │  │  ← event chip BLOCK form
│  │ │ [cover] Sunset Mixer         │   │  │     (inline within paragraph
│  │ │         Sat Jun 7 · 8pm       │   │  │      flow; tap to edit)
│  │ │         [Get tickets ▾]      │   │  │
│  │ └──────────────────────────────┘   │  │
│  │                                    │  │
│  │ See you there,                     │  │
│  │ ⎡brand_name⎤                       │  │
│  └────────────────────────────────────┘  │
│  ════════════════════════════════════    │
│  [ + Event ]  [ { } Personalize ]  [ ⋮ ] │
```

Note: event chip in body is a BLOCK chip (renders like the email recipient sees it). Personalization chips are INLINE pills. This dual-mode is the key UX move.

### 4.4 Mockup — `+ Event` tap → inline picker

Tapping `+ Event` does NOT open a modal sheet. It opens an inline horizontal scroller WITHIN the insertion bar:

```
│  ════════════════════════════════════    │
│  ◀ [▣ Sunset Mixer] [▣ Wine + Cheese]   │  ← horizontal scroller of cards
│    [▣ Live Jazz] [▣ Brunch Pop-up] ▶    │     of upcoming brand events
│  ════════════════════════════════════    │
```

Tap a card → chip inserts at cursor. Long-tap → "Pin to top" so frequently-used events surface first. Search field appears if scroll past 6 items.

### 4.5 Mockup — `{ } Personalize` tap → inline palette

```
│  ════════════════════════════════════    │
│  ⎡first_name⎤  ⎡brand_name⎤             │  ← always-visible row
│  ⎡event_name⎤  ⎡event_date⎤             │
│  ⎡event_time⎤  ⎡event_url⎤              │
│  ⎡spots_left⎤  ⎡doors_open⎤             │
│  ⎡previous_event_name⎤  ⎡next_event_n⎤  │
│  ════════════════════════════════════    │
│  [ + Event ]  [ { } Personalize ]  [ ⋮ ] │
```

Tap any chip → inserts at cursor; palette stays open for chained inserts; tap outside or backspace twice → palette closes. Each chip has a long-press preview ("Sarah" for `first_name` based on first audience row).

### 4.6 Mockup — `Templates` (in overflow) → side-slide preview drawer

```
│                                          │
│  Body                                    │
│  ┌──────────────────┬─────────────────┐  │
│  │ Hey ⎡first_name⎤ │  Template       │  │  ← drawer slides in from right
│  │                  │  ▣ Welcome #1   │  │     showing template preview
│  │ ⎡event chip⎤     │  ─────────────  │  │     RENDERED with operator's
│  │                  │  ┌───────────┐  │  │     audience variables
│  │                  │  │ live      │  │  │
│  │                  │  │ preview…  │  │  │
│  │                  │  └───────────┘  │  │
│  │                  │  [Apply]        │  │
│  │                  │  ◀ 1 of 5 ▶    │  │  ← swipe through templates
│  └──────────────────┴─────────────────┘  │
```

"Apply" replaces current draft (with confirmation if dirty). "Apply at cursor" alternate option inserts template body fragment at caret without replacing subject. Swipe drawer right or tap outside → closes without applying.

### 4.7 Chip taxonomy (Concept B)

- Event chip is **BLOCK** in body (renders like the rendered email card preview, 80pt tall, full-width minus padding). Inline edit via tap → expand-in-place to reveal `[Title (read-only, links to event page)] [Date (read-only)] [CTA label: dropdown] [Remove from email]`. No event-edit-from-here — operator goes to events surface for that.
- Event chip is **INLINE** in subject (small pill, since subject is single-line). Same chip-editor popover.
- Personalization chip is **INLINE** everywhere — small pill, monospace label, long-press preview.
- Link chip — standard rich-text inline link.

### 4.8 Toolbar — dual (persistent insertion bar + selection-only formatting tooltip)

- **Persistent insertion bar** (above keyboard) — `[+ Event] [{ } Personalize] [⋮]`. Stays visible the whole compose session. Collapses to a single `[+]` button if keyboard closed on iPad / web wide layout.
- **Selection formatting tooltip** — appears above text selection: `[B] [I] [Link]`.

### 4.9 Template-into-editor pattern

Side-slide preview drawer (§4.6). Live preview rendered server-side via existing `marketingRenderingService.renderEmail()` with the operator's actual first-audience-row variables substituted. Operator sees what their recipient sees BEFORE committing.

### 4.10 Accessibility model (B)

- Insertion bar: `accessibilityRole="toolbar"`, each pill has explicit `accessibilityLabel`.
- Block event chip: `accessibilityRole="button"`, label "Event card, Sunset Mixer, June 7, double-tap to edit, swipe up for remove."
- Drawer: focus trap when open, Escape / swipe-right dismisses on web, screen-reader announcement "Template preview open, swipe to navigate."
- Color contrast on `accent.warm` pill background already meets 4.5:1 per ORCH-0815 audit.

### 4.11 Cross-surface notes (B)

- iOS: insertion bar uses `InputAccessoryView` so it's natively pinned above keyboard with zero jank.
- Android: `softInputMode="adjustResize"` + keyboard event listener — bar follows keyboard with a 16pt margin.
- Web preview: insertion bar is a sticky-bottom div; on desktop wide layouts it can become a sticky-right vertical rail instead (responsive at >1024px).
- Drawer: 320pt wide on iPad / web; full-screen overlay on phone (slide-up from bottom on phone, slide-in-from-right on tablet).

### 4.12 Risk

Slight extra screen weight (the persistent bar costs ~56pt at bottom). Mitigated by auto-hide on scroll-down (reveals on scroll-up or tap). Operators familiar with WhatsApp / iMessage toolbars will read this pattern instantly.

### 4.13 Implementation cost signal (B)

Persistent bar + inline palettes work with any renderer (custom segment OR WebView). Block event chip rendering inside body benefits from WebView (true block elements in flow). Selection formatting tooltip requires editor-level selection events. Renderer pick: WebView-based preferred; custom segment workable with explicit "tap chip to expand inline below" instead of true inline block.

---

## 5 — Concept C — "Inline `@`-mention everything"

### 5.1 Essence

Single unified mental model: `@` summons everything insertable. Type `@s` → autocomplete shows events whose title starts with S, personalization tokens starting with S, templates starting with S. Resting state: zero toolbar, zero chrome, just a writing surface. Minimal aesthetic of Stripe Docs / Linear / Things.

### 5.2 Mockup — empty + mid-compose

```
┌──────────────────────────────────────────┐
│  ←  New campaign           Save  Review  │
├──────────────────────────────────────────┤
│                                          │
│  To: All brand buyers · 142 reachable ▾  │
│  ─────────────────────────────────────   │
│                                          │
│  Save your seat, @first_name!            │  ← inline chip after autocomplete
│  ─────────────────────────────────────   │
│                                          │
│  Hey @first_name,                        │
│                                          │
│  Doors open at @event_time. Last         │  ← chained chip insertion
│  call's at 1am.                          │
│                                          │
│  @sun▮                                   │  ← typing autocomplete
│  ┌─────────────────────────────────┐     │
│  │  ▣ Sunset Mixer (event)         │     │
│  │  ▣ Sunday Brunch Pop-up (event) │     │
│  │  ✂  Sunset welcome (template)   │     │
│  └─────────────────────────────────┘     │
│                                          │
```

### 5.3 Chip taxonomy (Concept C)

Same chip visual contract as A/B (event = pill or block, personalization = small pill). Difference: source of insertion is unified into one `@` flow. Sectioned autocomplete (Events / Personalization / Templates), with selectable section headers for keyboard nav.

### 5.4 Toolbar

None visible in resting state. On selection → same `[B] [I] [Link]` floating tooltip as concepts A/B. Templates inserted via `@templ` autocomplete trigger → full preview overlay before apply.

### 5.5 Template-into-editor pattern

Templates appear in `@` autocomplete results when prefix matches "templ" or template name. Tap → modal preview with `[Insert at cursor] [Replace entire draft]` options.

### 5.6 Accessibility model (C)

- Autocomplete: `aria-autocomplete="list"`, results have `aria-selected`.
- Same chip a11y as A/B.

### 5.7 Cross-surface notes (C)

- All three platforms: `@`-trigger requires native text-change listener that triggers within ~16ms of keystroke. WebView editor handles this; custom segment renderer over `TextInput` has measurable lag on Android (~80ms keystroke-to-callback) that makes autocomplete feel laggy.

### 5.8 Risk

**Highest discoverability risk of the three.** No visible affordance means new operators won't know `@` exists. Mitigations: empty-state caption ("Type `@` to insert events, personalization, or templates"), keyboard `@` glyph hint near subject, first-use coachmark. Even with these, will likely cause "where do I add an event?" support questions.

### 5.9 Implementation cost signal (C)

Mandatory WebView-bridged editor (custom segment renderer can't deliver `@`-autocomplete responsively). Same renderer cost as A/B.

---

## 6 — Comparison matrix

| Dimension | A — Slash menu | B — Floating bar | C — @-mention |
|---|---|---|---|
| Modernity | High (Notion / Linear feel) | High (Substack / Beehiiv feel) | Highest (Stripe Docs / Things feel) |
| Intuitiveness (first-time) | Medium — `/` discoverable via inline hint | **High — buttons are right there** | Low — no visible affordance |
| Intuitiveness (returning) | High | **High** | High once learned |
| Cross-surface effort | Same on all 3 | Same on all 3 (insertion bar is responsive) | Same on all 3 |
| RN implementation difficulty | Medium-high (slash-anchor positioning is finicky) | **Medium (persistent bar is straightforward)** | High (autocomplete-anchor + chip-replace state machine) |
| Risk of feeling janky | Medium (anchor drift under kb) | **Low (InputAccessoryView is rock solid)** | Medium (anchor + keystroke latency) |
| Bundle size impact | All identical (renderer-driven) | All identical | All identical |
| Best for | Heavy editors / power users | **Marketing operators with mixed skill** | Minimalist aesthetic / sophisticated audience |
| Worst for | Operators who never type `/` | Aesthetic minimalists who want zero chrome | First-time users |
| Mingla operator profile fit | OK | **Best** | Risky |

**Concept B wins on the Mingla operator profile** — small-business operators who don't write a lot of email, who benefit from seeing buttons rather than memorizing trigger characters. The persistent bar makes "where do I add an event" answerable in zero seconds.

---

## 7 — Renderer tradeoff (independent of concept)

Three candidates evaluated against the Mingla constraints (Expo SDK 54, Hermes, EAS OTA-eligibility, `feedback_rn_color_formats.md`, `feedback_keyboard_never_blocks_input.md`).

| Dimension | Custom segment renderer (RN `TextInput` + token spans) | `react-native-pell-rich-editor` (WebView + pell.js) | TenTap (WebView + ProseMirror/Tiptap bridge) |
|---|---|---|---|
| Native dep | None | `react-native-webview` (already in tree) | `react-native-webview` |
| Bundle size | Negligible | +~80KB JS (pell minified) | +~250KB JS (Tiptap + extensions) |
| Cold-start latency | ~0ms | ~150-300ms (WebView spin-up) | ~200-400ms (WebView + ProseMirror init) |
| Rich text (bold/italic/link) | ❌ Not feasible — `TextInput` is plaintext | ✅ Full | ✅ Full + extensible |
| Block-level chip rendering | Tap-to-expand-below workaround only | ⚠️ Possible via HTML `<div contenteditable="false">` | ✅ First-class block nodes |
| Inline chip rendering | ✅ Span-based, native fast | ✅ HTML span | ✅ ProseMirror inline node |
| Slash menu / @ autocomplete | ❌ Lag on Android | ✅ Manual DOM event handling | ✅ Tiptap Suggestion extension |
| Selection formatting tooltip | ❌ Selection events fire late | ✅ pell selection API | ✅ ProseMirror selection plugin |
| Subject + body share editor | N/A | Two WebViews (heavier) OR one HTML doc with two regions | One ProseMirror doc with two regions |
| Token preservation (byte-for-byte) | Native (raw string) | Requires escape/unescape discipline | First-class via custom nodes |
| Keyboard avoidance | Native — RN handles | Manual — WebView reports keyboard via JS bridge | Manual but well-documented |
| Accessibility | Native VoiceOver / TalkBack | Limited — WebView a11y bridge is weak on iOS | Better than pell but still WebView-limited |
| Web preview parity | Different code path (RN Web) | ✅ Same WebView/HTML | ✅ Same Tiptap |
| EAS OTA eligibility | ✅ Pure JS | ✅ Pure JS | ✅ Pure JS |
| Maturity in RN ecosystem | High (RN primitives) | Medium — popular but stagnating | Growing — Tiptap is the de-facto web standard |
| Maintenance risk | None (we own it) | Pell is unmaintained-ish | Tiptap actively maintained, RN bridge community-maintained |
| Test surface | Easy (Jest + RN testing-library) | Hard (need WebView mocking) | Hard (same WebView mocking, plus ProseMirror state) |
| Token-roundtrip guarantee (I-PROPOSED-MKT-TEMPLATE-TOKENS-VERBATIM) | Trivial (token IS the string) | Requires sanitization tests | First-class via node attrs |

### Renderer recommendation: **TenTap (Tiptap-in-WebView)**

Why:

- Rich text is mandatory per operator ask ("true rich-text editor"); custom segment renderer rules itself out.
- Between pell and TenTap: TenTap's ProseMirror nodes give us first-class block chip nodes (Concept B's block event card lands cleanly) and its Suggestion extension makes slash-menu / `@`-mention trivial — pell would require hand-rolled DOM event glue.
- Bundle cost (+~250KB JS) is acceptable for a feature surface only loaded inside the marketing composer (not in cold-start path of the rest of the app).
- WebView keyboard avoidance is solved by `react-native-keyboard-controller` (which we should add anyway per `feedback_keyboard_never_blocks_input.md`).
- Accessibility limitations of WebView are real — Concept B's inline-bar a11y mitigates because the chrome (bar, drawer) is NATIVE RN, only the editor canvas itself is WebView. Operators using VoiceOver get native semantics on every action button; the canvas is a single content area with chip-as-button semantics.

Fallback if TenTap proves problematic during SPEC: pell with a wrapper that exposes the same JS bridge. Custom segment renderer is OFF the table — it cannot deliver "true rich text."

---

## 8 — Final recommendation

**Build Concept B + TenTap renderer.**

Plain-English reasoning for Seth (3-5 sentences):

> Concept B feels like the writing surface you described — your event becomes a chip you can tap, your personalization tokens become chips you tap from a tiny bar above the keyboard, and templates "melt in" via a side preview where you actually see what the email looks like before you commit. The Notion-style slash menu is sexier but hides everything behind a character you have to remember; the `@`-mention version is even prettier but worst for discoverability. Concept B keeps the buttons visible without making the screen feel like a settings form. TenTap is the renderer because it's the only option that gives true rich text AND first-class block-node chips AND a maintained Tiptap foundation we won't have to rip out in a year.

---

## 9 — What forensics needs to pin down in SPEC (downstream)

If Seth picks Concept B + TenTap, forensics SPEC must define:

1. Exact JSON document schema TenTap stores (so we can round-trip to / from `{first_name}` + `{{event:uuid}}` strings — I-PROPOSED-MKT-TEMPLATE-TOKENS-VERBATIM)
2. Block-event-chip node attributes (event_id, event_title, event_date, cta_label) — and which are stored vs derived
3. Personalization-chip node attributes (token name only — value is render-time)
4. Subject ↔ body — single Tiptap editor with two regions vs two editors with shared toolbar
5. Insertion-bar state machine: closed / inline-events-open / inline-personalize-open / overflow-open
6. Template drawer: swipe gesture model + live-preview render budget (debounce, cancel)
7. WebView bridge: events list (insertEventChip, insertPersonalizationChip, openSelectionFormat, getDocumentAsTokenString, setDocumentFromTokenString)
8. Cross-surface parity criteria (SC-N-iOS / SC-N-Android / SC-N-Web)
9. EAS OTA-eligibility check — TenTap is JS-only ✅; only `react-native-keyboard-controller` adds a native module if we adopt it (decide in SPEC)
10. Performance budget — first-paint ≤ 500ms on iPhone 13, ≤ 800ms on Pixel 6, keystroke latency ≤ 50ms p95
11. Strict-grep gate ideas: no raw `{first_name}` in JSX (must be chip), no `<TextInput>` directly in composer body (must go via TenTap bridge)
12. Test surface: WebView mocking strategy, snapshot tests for token round-trip
13. Migration path from V1 composer drafts (existing `channel_payload.body_html` as plain string with `{{event:uuid}}` tokens — round-trip parser must handle it on first open)
14. Audience picker, footer, send/schedule flow — all OUT of scope for V2 (carried over from V1 unchanged)

---

## 10 — Out of scope for ORCH-0864

- Phase 0 marketing consent foundation (still deferred per DISC-4 / ORCH-0863)
- SMS / RCS composer affordances (separate channel work)
- Image upload to body (Phase C — flag as ORCH-0865 candidate)
- A/B testing two subject lines (separate ORCH)
- Send-time optimization (Phase G)
- AI-assisted copy generation (Phase H — Brain)
