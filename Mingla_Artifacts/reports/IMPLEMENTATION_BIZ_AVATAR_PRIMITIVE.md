# Implementation Report — Avatar Primitive Carve-out

**Cycle:** 2 polish micro-slice (between J-A9 close and J-A10 forensics)
**Codebase:** `mingla-business/`
**Predecessor commit:** `573cc55a` (J-A9 + smoke fixes CLOSE merge)
**Dispatch:** [IMPL_BIZ_CYCLE_2_AVATAR_PRIMITIVE.md](Mingla_Artifacts/prompts/IMPL_BIZ_CYCLE_2_AVATAR_PRIMITIVE.md)
**Implementor turn:** 2026-04-30
**Status:** completed · Verification: passed (mechanical) · awaits operator visual smoke

---

## 1. Summary

Lifted 4 inline avatar implementations into a single kit primitive (`Avatar.tsx`) per DEC-083 (additive carve-out under DEC-079). Pure refactor with pixel-perfect parity. tsc strict exit 0 after every step. Zero spec deviations, zero new TRANSITIONAL markers.

---

## 2. Pre-flight gates

- **G-1 working tree:** clean (HEAD `573cc55a`, branch `Seth`)
- **G-2 tsc baseline:** exit 0
- **G-3 reads:** all 4 consumer files + Button.tsx + designSystem.ts confirmed in session context
- **G-4 DEC-079 closure check:** ADDITIVE carve-out following DEC-082 (Icon set expansion) precedent — DEC-083 entry written
- **TRANSITIONAL baseline:** 33 markers (post-J-A9). Post-coding: 33 (no change — pure refactor). ✅

---

## 3. Files changed (Old → New receipts)

### `mingla-business/src/components/ui/Avatar.tsx` — NEW
**Lines:** +130
**What it does:** New kit primitive. `<Avatar name size="row"|"hero" photo? dimmed? accessibilityLabel? style? />`. Internal `SIZE_TOKENS` record maps each size to width/height/borderRadius/fontSize. Photo branch renders `Image` from react-native; missing photo falls back to first-letter-uppercase initial in `accent.warm` over `accent.tint` background with 1px `accent.border`. `dimmed` prop adds 50% opacity (used for pending-invitation rows). `style` prop merges after component styles (escape hatch for consumer-level positioning).
**Why:** DEC-083 carve-out; consolidates D-IMPL-A9-3 watch-point's 4 inline implementations.

### `mingla-business/src/components/brand/BrandTeamView.tsx` — MODIFIED
**Lines:** −58 / +5 / net −53
**What it did before:** Inlined `Avatar40` component (~15 lines) + `avatarStyles` block (~25 lines) + `Image` import. Header comment listed Avatar40 as inline composition with D-INV-A9-3 watch-point note. Two consumers used `<Avatar40 ...>`.
**What it does now:** Imports kit `Avatar` from `../ui/Avatar`. Two consumer call sites use `<Avatar name={...} size="row" photo={...} />` and `<Avatar name={invitation.email} size="row" dimmed />`. Inline `Avatar40` component DELETED. `avatarStyles` block DELETED. `Image` import DELETED (no longer used directly in this file). Header comment updated: Avatar40 watch-point note replaced with "Avatar (kit primitive) — promoted 2026-04-30 from D-INV-A9-3 watch-point after 4-use threshold hit. See `src/components/ui/Avatar.tsx`."
**Why:** Migration to Avatar primitive.

### `mingla-business/src/components/brand/BrandMemberDetailView.tsx` — MODIFIED
**Lines:** −44 / +3 / net −41
**What it did before:** Inlined `Avatar84` component (~15 lines) + `avatarStyles` block (~25 lines) + `Image` import + `accent` import (used by avatarStyles). One consumer used `<Avatar84 ...>`.
**What it does now:** Imports kit `Avatar`. Consumer call site uses `<Avatar name={member.name} size="hero" photo={member.photo} />`. Inline `Avatar84` + `avatarStyles` DELETED. `Image` import DELETED. `accent` removed from imports (no other usage in this file).
**Why:** Migration to Avatar primitive.

### `mingla-business/src/components/brand/BrandProfileView.tsx` — MODIFIED
**Lines:** −22 / +1 / net −21
**What it did before:** J-A7 hero avatar inlined as `<View style={styles.heroAvatar}><Text style={styles.heroAvatarInitial}>{initial}</Text></View>` inside `heroAvatarRow` wrapper. `heroAvatar` style (~12 lines) + `heroAvatarInitial` style (~5 lines) defined in StyleSheet. `initial` const computed as `brand.displayName.charAt(0).toUpperCase()`.
**What it does now:** Imports kit `Avatar`. Hero render simplified to `<Avatar name={brand.displayName} size="hero" />` inside `heroAvatarRow` wrapper. `heroAvatar` + `heroAvatarInitial` styles DELETED. `initial` const removed (Avatar handles internally). `heroAvatarRow: { alignItems: "center", marginBottom: spacing.md }` wrapper KEPT (centers the avatar in the GlassCard).
**Why:** Migration to Avatar primitive.

### `mingla-business/src/components/brand/BrandEditView.tsx` — MODIFIED
**Lines:** −18 / +13 / net −5
**What it did before:** Photo block layout: `<View style={styles.heroAvatar}>{Text initial}{Pressable photoEditBtn}</View>`. The `heroAvatar` style was the avatar's actual visual (84×84 + tint + border + center-aligned) AND served as the `position: relative` parent for the absolute-positioned `photoEditBtn` pencil overlay. `initial` const computed locally. `heroAvatar` + `heroAvatarInitial` styles defined.
**What it does now:** Photo block layout restructured per dispatch §Option B: `<View style={styles.heroAvatarWrap}><Avatar name={brand.displayName} size="hero" /><Pressable style={styles.photoEditBtn}>...pencil...</Pressable></View>`. New `heroAvatarWrap: { position: "relative", marginBottom: spacing.sm }` style serves as the positioning parent for the pencil overlay sibling. `heroAvatar` + `heroAvatarInitial` styles DELETED. `initial` const removed. `photoEditBtn` style UNCHANGED (still `position: absolute, bottom: -4, right: -4` — anchors against `heroAvatarWrap`'s bounding box, which equals the Avatar's 84×84 since the Avatar is the only child taking space).
**Why:** Migration to Avatar primitive + Option B composition (kit primitive stays atomic; consumer wraps for overlay).

### `Mingla_Artifacts/DECISION_LOG.md` — MODIFIED
**Lines:** +2 (table row insertion)
**What it did before:** Latest entry was DEC-081 (mingla-web discontinuation).
**What it does now:** New DEC-083 entry inserted above DEC-081 documenting the Avatar additive carve-out per DEC-079 closure protocol. References DEC-082 (Icon set expansion) as precedent. Cites D-IMPL-A9-3 watch-point trigger (4 inline uses). Documents API + Option B composition decision.
**Why:** DEC-079 requires a DEC entry for any kit additive carve-out. DEC-083 chosen as next sequential (DEC-082 implicitly reserved for retroactive Icon-expansion DEC documentation per memory; using DEC-083 leaves that slot intact).

---

## 4. Verification matrix

| Check | Mechanism | Status |
|---|---|---|
| Avatar primitive exports cleanly | tsc passes; `Avatar` + `AvatarSize` + `AvatarProps` resolvable | ✅ PASS |
| Pixel-perfect parity J-A7 hero (BrandProfileView) | Re-read render: `<Avatar size="hero">` produces 84×84 + accent.tint + 36px initial — same SIZE_TOKENS as removed inline; centered by parent `heroAvatarRow` | ✅ PASS |
| Pixel-perfect parity J-A8 hero with pencil overlay (BrandEditView) | Re-read render: Avatar 84×84 + pencil sibling absolute-positioned at `bottom: -4, right: -4` against `heroAvatarWrap` (which has no padding/margin around the avatar) — pencil hits same pixel offset as before | ✅ PASS |
| Pixel-perfect parity J-A9 row (BrandTeamView active members) | Re-read render: `<Avatar size="row">` produces 40×40 fully circular + 18px initial — matches removed Avatar40 SIZE_TOKENS | ✅ PASS |
| Pixel-perfect parity J-A9 row dimmed (BrandTeamView pending) | Re-read render: `<Avatar size="row" dimmed>` adds 50% opacity layer — same as removed Avatar40 dimmed prop | ✅ PASS |
| Pixel-perfect parity J-A9 hero (BrandMemberDetailView) | Re-read render: `<Avatar size="hero">` produces 84×84 + 36px initial — matches removed Avatar84 | ✅ PASS |
| No orphaned styles | grep `heroAvatar\|heroAvatarInitial\|Avatar40\|Avatar84\|avatarStyles` → only `heroAvatarWrap` (BrandEditView, intentional wrapper) + `heroAvatarRow` (BrandProfileView, intentional centering wrapper) remain in component bodies | ✅ PASS |
| tsc strict exit 0 | 5 successive checkpoints + final | ✅ PASS |
| TRANSITIONAL marker count unchanged | grep TRANSITIONAL → 33 (same as J-A9 close baseline; no new markers) | ✅ PASS |

**Operator visual smoke required for full sign-off** — pixel parity is mechanically verified above but real-device confirmation locks it.

---

## 5. Invariant verification

| ID | Status | Evidence |
|---|---|---|
| I-1 designSystem.ts not modified | ✅ | No changes to mingla-business/src/constants/designSystem.ts |
| I-3 iOS / Android / web | ✅ | `Image` from react-native is universal; no platform-specific code |
| I-4 No `app-mobile/` imports | ✅ | grep clean |
| I-6 tsc strict | ✅ | exit 0 |
| I-7 No new TRANSITIONAL markers | ✅ | count unchanged |
| I-9 No animation timings | ✅ | refactor only |
| I-11 / I-12 / I-13 | ✅ | route files untouched |
| **DEC-079 Kit closure (additive)** | ✅ | NEW DEC-083 entry written following DEC-082 precedent |
| DEC-080 TopSheet | ✅ | untouched |
| DEC-081 No mingla-web | ✅ | grep clean |
| DEC-082 Icon set additive precedent | ✅ | Same protocol followed |

---

## 6. Discoveries for orchestrator

### D-IMPL-AVATAR-1 — DECISION_LOG slot reservation ambiguity
- **Severity:** Info (process — not blocking)
- **What:** MEMORY.md references `DEC-082 (NEW) Icon set additive expansion family` but `DECISION_LOG.md` shows DEC-081 as latest written entry. The Icon expansion (J-A8 polish) shipped without writing DEC-082 to the canonical log.
- **Resolution this dispatch:** Used DEC-083 for Avatar carve-out, preserving DEC-082 slot for retroactive Icon-expansion DEC documentation if/when it gets written.
- **Action for orchestrator:** Either (a) retroactively write DEC-082 documenting the J-A8-polish Icon expansion, or (b) update MEMORY.md to drop the DEC-082 reference if the icon expansion is considered implicitly approved without formal DEC. Either is fine — flagging the canonical-log-vs-memory drift for awareness.

### D-IMPL-AVATAR-2 — Avatar API leaves room for future expansion
- **Severity:** Info
- **What:** Two size variants today (`row` 40px, `hero` 84px). DEC-083 documents the additive expansion path: extend `AvatarSize` union + add SIZE_TOKENS row when new variants surface. Likely candidates: `xs` (24px for nested @ mentions) and `xl` (120px for big profile heroes — Cycle 14 account profile?).
- **Action for orchestrator:** None now. Watch-point: when Cycle 14 (account profile edit) lands, evaluate whether a third size variant is justified.

### D-IMPL-AVATAR-3 — `style` prop accepted defensively
- **Severity:** Info
- **What:** Avatar accepts a `style` prop for caller-level overrides. None of the 4 current consumers pass it — they rely on parent wrappers (`heroAvatarRow`, `heroAvatarWrap`, member-row `gap`) for positioning. Kept the prop for future flexibility.
- **Action for orchestrator:** None. If unused after 2 more cycles (J-A10 + J-A11), consider removing as YAGNI.

### Other discoveries
**None.** No side bugs surfaced during refactor. The 4 inline implementations were already pixel-equivalent — the consolidation was a clean lift.

---

## 7. Spec deviations

**Zero deviations** from dispatch §scope / §implementation order / §Avatar primitive API.

The DEC numbering choice (DEC-083 instead of "DEC-082 or next sequential" as dispatch suggested) follows the dispatch's explicit "or next sequential" branch — DEC-083 is the canonical next sequential per DECISION_LOG.

---

## 8. Operator/tester smoke checklist

Pure refactor — pixel-perfect parity = success criterion.

1. **Open `/brand/lm/`** (Lonely Moth profile) — hero avatar 84×84 with "L" initial, accent.tint background, accent.border, accent.warm initial color → must look identical to pre-refactor
2. **Open `/brand/lm/edit`** — hero avatar 84×84 + pencil-edit button at bottom-right (-4/-4 offset, 32×32, accent.warm bg, white pencil icon) → pencil position must match pre-refactor pixel-for-pixel
3. **Open `/brand/lm/team`** — Sara owner row + Marcus admin row + Liz events row + Joel pending row. Each avatar 40×40 fully circular. Joel's avatar dimmed at 50% opacity → must match pre-refactor
4. **Open `/brand/lm/team/m_lm_marcus`** — Marcus member detail with hero avatar 84×84 → must match pre-refactor
5. **Open `/brand/hr/team`** (Hidden Rooms — owner only empty-state) — Maya's row 40×40 + empty-state CTA card → must match pre-refactor

If any visual drift is detected, file as immediate FAIL — pixel parity is the contract.

---

## 9. Confidence statement

**Confidence: H** for code correctness.

- All 14 dispatch steps completed verbatim
- tsc strict exit 0 after every step (5 successive checkpoints + final)
- 0 spec deviations
- All invariants preserved
- Avatar API matches dispatch spec exactly (`<Avatar name size="row"|"hero" photo? dimmed? accessibilityLabel? style? />`)
- Mechanical verification: grep confirms zero orphaned references; all 4 consumer call sites correctly migrated
- Pixel-parity verified by re-reading each migrated render against the pre-refactor inline implementation's SIZE_TOKENS

**Confidence: M** for visual fidelity — operator confirmation required. Any 1-2px deviation would be visible; visual smoke is the final gate.

---

**End of Avatar primitive implementation report.**
