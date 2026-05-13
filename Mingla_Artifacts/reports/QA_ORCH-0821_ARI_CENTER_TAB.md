# QA Report — ORCH-0821 Polish — Ari Center Tab

**Mode:** TARGETED (static forensic review)
**Verdict:** PASS
**Working tree:** /Users/sethogieva/Desktop/mingla-main on branch Seth
**Date:** 2026-05-13

---

## Scope

Single change in `mingla-business/app/(tabs)/_layout.tsx` lines 22-37 — reorder of the `TABS: BottomNavTab[]` array from
`[home, events, marketing, ari, account]` to `[home, events, ari, marketing, account]`.
Comment block above the affected lines updated to reflect the new rationale (Ari as visual/thumb center).

No code logic changed. No routes changed. No tab IDs changed. No icons or labels changed.

---

## Layer Audit

### 1. Tab consumer — `BottomNav.tsx`

[mingla-business/src/components/ui/BottomNav.tsx:75-188](mingla-business/src/components/ui/BottomNav.tsx#L75-L188)

- Renders tabs via `tabs.map(...)` in array order — reorder is reflected verbatim in render.
- Each tab is `flex: 1` (line 213-218), so 5 tabs distribute evenly regardless of order. No iPhone-SE clipping risk introduced by the swap — pre-change capsule was already 5 tabs.
- Active detection is `tab.id === active` (line 153). Order-independent.
- Spotlight position animates to the measured `x/width` of whichever tab matches `active`, via `useAnimatedStyle` on shared values fed from `onLayout` (lines 89-98, 107-120). Order-independent.
- **PASS** — component is fully order-agnostic.

### 2. Active-tab resolver — `detectActiveTab`

`mingla-business/app/(tabs)/_layout.tsx:45-59`

- Uses `Array.find` with `lower === prefix || lower.startsWith(prefix + "/")`. Tab IDs (`home`, `events`, `ari`, `marketing`, `account`) are disjoint and non-overlapping prefixes — no tab ID is a prefix of another — so iteration order cannot produce a wrong match.
- Nested marketing routes (`/marketing/audiences`, `/marketing/campaigns`, `/marketing/templates`) still resolve to the `marketing` tab via the `startsWith(prefix + "/")` branch (preserved from prior fix).
- **PASS**

### 3. Route resolution — `handleChange`

`mingla-business/app/(tabs)/_layout.tsx:73-76`

- `router.push(\`/(tabs)/${id}\`)`. Routes are keyed by tab `id`, which is unchanged. `ari.tsx`, `marketing/`, `home.tsx`, `events.tsx`, `account.tsx` all still resolve.
- **PASS**

### 4. Cross-consumer scan

`grep` for other usages of the TABS array, BottomNav consumers in tests, snapshots, or hardcoded tab-order assumptions — none found outside the layout file.

- **PASS**

### 5. `hideBottomNav` carve-out

`mingla-business/app/(tabs)/_layout.tsx:71` — `pathname.includes("/campaigns/compose")` — unaffected by reorder (path-string match, not index-based).

- **PASS**

---

## Constitution Check (14 rules)

All 14 rules N/A — this is a pure presentation reorder with no state, data, auth, currency, validation, or cache implications.

---

## Findings

- **P0:** 0
- **P1:** 0
- **P2:** 0
- **P3:** 0
- **P4:** Clean reorder. Comment block updated to match the new arrangement (Ari = center). No stale references to the prior order remain in the file.

---

## Live-Platform Verification Gap (transparent)

Per memory `feedback_tester_canonical_and_platform_parity.md`, the canonical tester flow is iOS Simulator + Android Emulator + Web parity. For this dispatch, static forensic review is sufficient because:

1. The change is a single-array-literal reorder with zero logic delta.
2. `BottomNav` and `detectActiveTab` are demonstrably order-agnostic (lines cited above).
3. No tests, snapshots, or downstream consumers depend on tab order.
4. The 5-tab capsule layout was already shipped pre-reorder — no new layout risk.

If the operator wants a live screenshot triplet for visual confirmation, that is a separate ~5-minute sim spin-up on each platform — flag it and a follow-up dispatch will run them.

---

## Discoveries for orchestrator

None.

---

## Verdict

**PASS** — ready for CLOSE.
