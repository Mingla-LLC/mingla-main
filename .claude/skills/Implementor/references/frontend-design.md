# Frontend Design Reference — Mingla Implementor

Read this file before any component, screen, layout, animation, or design system work.

---

## The Mingla User

Urban adults (22–40) who value taste, convenience, and social currency. They use Instagram,
Spotify, Uber daily. Their quality bar is sky-high. They notice when something feels off.

**Emotional job:** Eliminate "where should we go?" anxiety → replace with insider confidence.
**Core emotion:** Confident discovery.

**Business lens:** Every design decision connects to engagement (DAU), retention (weekly
return), or monetization (bookings, premium, partner revenue).

---

## Design Tokens (Read From Codebase)

Before any UI work, read these files and hold the values in working memory:

```
app-mobile/constants/
├── Colors.ts        # Color palette
├── Spacing.ts       # Spacing scale
├── Typography.ts    # Type scale
└── Shadows.ts       # Shadow definitions
```

For admin: read `mingla-admin/src/globals.css` for CSS custom properties.

**Token-first is non-negotiable.** Every visual property traces to a token. To propose a new
token, provide: name, value, usage context, justification, accessibility check (contrast
≥ 4.5:1 for text, ≥ 3:1 for large text/UI).

---

## Psychology Toolkit

### Behavioral Frameworks

**Fogg (B = MAP):** Behavior = Motivation × Ability × Prompt converging simultaneously.
- Make user want to act (hope, social acceptance, anticipation)
- Make it effortless (reduce steps, thinking, time)
- Place trigger when motivation + ability peak

**Hook Model:** Trigger → Action → Variable Reward → Investment
- External triggers evolve into internal triggers
- Variable reward keeps engagement (discovery, social validation, achievement)
- Investment builds ethical switching costs (preferences, history, connections)

### Cognitive Principles (Constraints, Not Suggestions)

| Principle | Rule | Application |
|-----------|------|-------------|
| Cognitive Load | Working memory ≈ 4 chunks | Max 4 things to hold in mind per screen |
| Hick's Law | Decision time ∝ options | Fewer choices = faster. Progressive disclosure |
| Fitts's Law | Target time = f(distance, size) | Primary CTAs: large (≥48×48pt), thumb-reachable |
| Miller's Law | Chunking ≈ 7±2 | Lists biased toward lower end on mobile |
| Serial Position | First + last items remembered | Important content at top and bottom |
| Von Restorff | Distinct items remembered | One accent element per screen |
| Zeigarnik | Incomplete tasks persist | Progress indicators, partial reveals |
| Peak-End Rule | Judged by peak + ending | Design highest-delight moment + satisfying endings |

### Persuasion (Cialdini) — Use Ethically

- Social proof: "Popular tonight", "23 people saved this"
- Scarcity: real data only — never fake
- Reciprocity: give value before asking
- Commitment: small yeses → big ones (save → plan → book)

### Emotional Design (Norman)

- **Visceral:** Premium within 50ms? First impression.
- **Behavioral:** Effortless? Every interaction predictable and satisfying.
- **Reflective:** Does using Mingla make the user feel smart, tasteful, insider?

---

## Screen Specification Format

```
SCREEN: [Name]
ROUTE STATE: [state value]
ENTRY: [how user arrives]
EXIT: [where they go next]
USER EMOTION: [what they're feeling]
PRIMARY ACTION: [the one thing you want them to do]
```

### Layout Blueprint
```
┌─────────────────────────────────┐
│ Status Bar (system)             │
├─────────────────────────────────┤
│ Header                          │
│   Left: [Back / Menu]          │
│   Center: [Title / Logo]       │
│   Right: [Action icon]         │
├─────────────────────────────────┤
│ Content Area (scrollable)       │
│   [Component A]                │
│   [Component B]                │
├─────────────────────────────────┤
│ Bottom Action (fixed)           │
│   [Primary CTA]                │
│   Safe area padding: bottom    │
└─────────────────────────────────┘
```

### Element Properties (Every Element Gets All Relevant)

Size (exact dp/pt or flex), position (spacing tokens), typography (token, size, weight,
lineHeight, color, maxLines, truncation), color (token only — never raw hex), border
(radius token, width, color), shadow (token), content (exact copy or binding + max chars),
states (default, pressed, disabled, focused, selected, loading, error).

---

## Every State Must Be Designed

**Loading:** Skeleton screens mirroring loaded layout. Shimmer: left-to-right, 1.5s,
ease-in-out. Shown immediately. Never blank.

**Empty:** Warm acknowledgment, explain why, clear action to fill, inviting not broken.

**Error:** Human language, no blame, clear recovery action, maintain layout structure.

**Success:** Celebrate proportionally. Confirm what happened. Show next step. Haptic feedback.

**Partial/Degraded:** Show what you have, indicate what's loading, degrade gracefully.

---

## Animation Rules

| Category | Duration | Easing | Purpose |
|----------|----------|--------|---------|
| Micro-interactions | 100–200ms | ease-out | Feedback |
| Screen transitions | 250–350ms | ease-out enter, ease-in leave | Orientation |
| Celebrations | 400–600ms | ease-in-out | Delight |
| Skeletons/shimmer | 1500ms loop | ease-in-out | Loading |

Never exceed 600ms. Never use linear easing. Every animation serves orientation, feedback,
focus, or delight — if none, remove it.

### Interaction Spec Format
```
INTERACTION: [Element Name]
TRIGGER: [tap / long-press / swipe / scroll threshold]
FEEDBACK:
  Haptic: [none / light / medium / heavy / notificationSuccess / notificationWarning]
  Visual: [opacity / scale / color shift / ripple]
  Timing: [duration ms, easing]
RESULT: [State change / navigation / mutation / modal]
```

---

## Component Specification Format

```
COMPONENT: [Name]
TYPE: New / Modified
LOCATION: components/[path]
REUSES: [existing components it composes]

PROPS:
  - [name]: [type] — [description] — [default]

VARIANTS: [name]: [visual, when to use]
SIZES: [name]: [dimensions, type scale, spacing]

STATES:
  - default, pressed, disabled, loading, error

ACCESSIBILITY:
  - accessibilityLabel: [string or pattern]
  - accessibilityRole: [button / link / image / header]
  - accessibilityHint: [what happens]
  - Touch target: ≥ 44×44pt, ≥ 8pt inter-target spacing

STYLE TOKENS:
  background, text, border, shadow, borderRadius, padding, margin — all token references

PLATFORM BEHAVIOR:
  iOS: [specifics]
  Android: [specifics — safe areas, nav bar, gestures]
```

---

## Platform Behavior

**Safe areas:** Respect on every screen. iPhone notch/Dynamic Island, Android cutouts,
bottom gesture areas. Content immersive but interactive elements properly padded.

**Keyboard handling:** Input fields never blocked. Layout adjusts/scrolls to show field +
label + helper text + CTA. Handle focus progression, dismissal, submit, validation, loading.

**Dynamic type:** Text scales to 200% without breaking layouts.

**Reduced motion:** Alternatives for every animation.

---

## Consistency Checklist (Before Finalizing Any UI Work)

- [ ] Every color → token
- [ ] Every spacing → token
- [ ] Every font size/weight → typography scale
- [ ] Every border radius → defined set
- [ ] Every shadow → shadow token
- [ ] Tap targets ≥ 44×44pt, ≥ 8pt spacing between
- [ ] All states defined for every interactive element
- [ ] Loading, error, empty, success for every async op
- [ ] Haptic feedback on every meaningful interaction
- [ ] Text contrast ≥ WCAG AA (4.5:1 body, 3:1 large/UI)
- [ ] Dynamic type handling specified
- [ ] No inline styles — StyleSheet.create only (mobile) / Tailwind only (admin)
- [ ] Safe areas respected
- [ ] Keyboard handling specified
- [ ] Reduced motion alternatives specified

---

## Admin Dashboard Specifics

- Always-dark sidebar, warm light theme, full dark mode support
- Geist Sans/Mono typeface
- CSS custom properties in `globals.css` (not JS tokens)
- 14 reusable UI components in `src/components/ui/` — scan before creating new ones
- Framer Motion AnimatePresence for page transitions
- Recharts for charts, Leaflet for maps
- Operator voice for all copy (professional, clear, efficient — not playful)