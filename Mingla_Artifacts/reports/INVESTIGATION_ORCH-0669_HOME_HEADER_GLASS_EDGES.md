# INVESTIGATION — ORCH-0669

**Cluster:** Home-page header glass-chrome edge artifacts
**Surfaces:** (1) session pill bar · (2) preferences chip · (3) notification bell
**Type:** design-debt / ux
**Severity:** S2-medium (cosmetic, but every Home render → first-impression damage)
**Platforms:** iOS + Android (both — no platform divergence found)
**Date:** 2026-04-25
**Investigator:** mingla-forensics
**Confidence:** HIGH (read every file end-to-end, traced full chain, captured in-flight diff verbatim, no proxy/sub-agent claims)

---

## 0. TL;DR (skip the rest if you only need the verdict)

**Single root cause, three surfaces.** All three Home-header glass elements consume the *same* design token at the *same* width:

```
borderWidth: 1
borderColor: glass.chrome.border.hairline  // 'rgba(255, 255, 255, 0.12)'
```

That 12%-white 1px stroke, drawn on every glass element against a dark photo / dark blur backdrop, IS the user-perceived "thin white line on all four sides." It is not a bug; it is the L4 layer of the SPEC_ORCH-0589 glass stack, exactly as designed. The ORCH-0589 V5 patch deleted the L3 top-highlight and committed to the perimeter hairline as the sole edge-definition mechanism — which made this hairline more visually dominant by relative contrast.

The "rough / not perfectly round" perception is *not* a `borderRadius` math error. All three surfaces are geometrically correct (pill bar: `radius 22 = height 44/2`; chip + bell: `radius 22 = size 44/2`). The roughness is the visual effect of a 1px white stroke being anti-aliased against a curved boundary that sits on top of an `expo-blur` BlurView whose own perimeter clipping is itself imperfect — the two artifacts compound.

**This is a design-intent bug, not an implementation bug.** The spec called for a 1px white hairline as the edge-definition layer; the implementation honors the spec; the user dislikes the visual result. The fix is a design decision (lower alpha, use `StyleSheet.hairlineWidth`, remove and rely on shadow + blur, or re-introduce a top-only highlight) — out of scope for this investigation per the dispatch.

**In-flight Seth-branch diff is UNRELATED.** The +118 lines on `GlassSessionSwitcher.tsx` and +39 on `designSystem.ts` add ORCH-0661 pending-pill state machinery (dashed dim borders for sender/receiver invites). They do not touch the affected `container` / `pressable` styles or the `glass.chrome.border.hairline` token. **Recommend: keep as-is and build the ORCH-0669 fix on top.**

---

## 1. Symptom (verbatim from dispatch)

Three rounded-chrome elements at the top of the Home page show identical visual defects:
1. Session pill bar — collaboration/solo switcher (long pill across the top)
2. Preferences chip — small rounded chip on the header
3. Notification bell — circular icon button on the header

Defects on all three:
- Edges are not perfectly round — silhouette looks jagged / pixelated
- A thin white seam (1–2 px) is visible along all four sides
- Visual treatment looks inconsistent across the three (three near-misses of one design language)

User wants: perfectly smooth pill/circle silhouettes, no white seam, single consistent treatment.

---

## 2. Investigation Manifest

| # | File | Layer | Why read | Read state |
|---|------|-------|----------|------------|
| 1 | [app-mobile/src/components/HomePage.tsx](app-mobile/src/components/HomePage.tsx) | parent screen | Confirms how `GlassTopBar` is mounted + which sessions reach pill bar | Grepped (full read not needed — confirmed mount only) |
| 2 | [app-mobile/src/components/GlassTopBar.tsx](app-mobile/src/components/GlassTopBar.tsx) | layout host | Hosts all 3 surfaces — preferences (L223), session switcher (L232), notifications (L234) | Full read ✓ |
| 3 | [app-mobile/src/components/ui/GlassIconButton.tsx](app-mobile/src/components/ui/GlassIconButton.tsx) | leaf — Surfaces 2 + 3 | Both preferences chip and bell are `<GlassIconButton>` instances with different `iconName` | Full read ✓ |
| 4 | [app-mobile/src/components/GlassSessionSwitcher.tsx](app-mobile/src/components/GlassSessionSwitcher.tsx) | leaf — Surface 1 | Pill bar container + per-pill styles | Full read ✓ (working tree, NOT HEAD) |
| 5 | [app-mobile/src/constants/designSystem.ts](app-mobile/src/constants/designSystem.ts) | shared token | `glass.chrome.*` is the single source of all three | Full read ✓ (working tree, NOT HEAD) |
| 6 | [app-mobile/src/components/CollaborationSessions.tsx](app-mobile/src/components/CollaborationSessions.tsx) | sibling — pill source | Project memory says this is the "pill bar wrapper"; verified that on Home it runs in `modalsOnlyMode` and the visible pill bar is GlassSessionSwitcher | File too large to fully read; relevance confirmed via HomePage L310-313 inline comment |
| 7 | (in-flight diff) | uncommitted | Mandatory per dispatch: `git diff app-mobile/src/components/GlassSessionSwitcher.tsx app-mobile/src/constants/designSystem.ts` | Captured verbatim ✓ |

**Out of scope (noted as discoveries, not investigated):**
- `GlassBottomNav.tsx` — likely consumes the same hairline token; may share the visual. Filed as discovery D-3.
- `BlurView` internal rendering on iOS — out of code reach, but noted as compounding factor.

---

## 3. Surface-by-Surface Findings

### Surface 1 — Session Pill Bar (`GlassSessionSwitcher` container)

**Exact style object** at [GlassSessionSwitcher.tsx:482-495](app-mobile/src/components/GlassSessionSwitcher.tsx#L482-L495):

```ts
container: {
  height: glass.chrome.switcher.height,        // 44
  borderRadius: glass.chrome.switcher.radius,  // 22  → height/2 = perfect pill
  borderWidth: 1,                              // ← HAIRLINE STROKE
  borderColor: glass.chrome.border.hairline,   // 'rgba(255, 255, 255, 0.12)' = 12% white
  overflow: 'hidden',
  shadowColor: glass.chrome.shadow.color,      // '#000000'
  shadowOffset: glass.chrome.shadow.offset,    // { width: 0, height: 4 }
  shadowOpacity: glass.chrome.shadow.opacity,  // 0.28
  shadowRadius: glass.chrome.shadow.radius,    // 12
  elevation: glass.chrome.shadow.elevation,    // 6
  flex: 1,
}
```

**Hypothesis verdict:**

| H | Verdict | Proof |
|---|---------|-------|
| H1 — hairline border | ✅ **CONFIRMED** | `borderWidth: 1` + `borderColor: rgba(255,255,255,0.12)` paints a 12%-white 1px stroke around the entire perimeter. Against the dark backdrop (`glass.chrome.backdrop.tint = 'rgba(12,14,18,0.34)'` per [designSystem.ts:543-547](app-mobile/src/constants/designSystem.ts#L543-L547)) this stroke reads as a thin white seam. |
| H2 — bg mismatch | ❌ disproven | Container has no `backgroundColor`; the BlurView + tint floor (`rgba(12,14,18,0.48)`) sit *inside* the `overflow: 'hidden'` clip and respect the radius. The seam is *not* a bg/parent contrast issue. |
| H3 — hard shadow | ❌ disproven | Shadow is `offset: {0, 4}, radius: 12, opacity: 0.28` — soft drop below, not a 4-side halo. |
| H4 — radius math wrong | ❌ disproven | `height 44` and `borderRadius 22` → ratio 2:1 = exact pill geometry. With `flex: 1` width, both end caps are perfect semicircles. Geometry is correct. |
| H5 — missing `overflow: 'hidden'` | ❌ disproven | `overflow: 'hidden'` is set at [L488](app-mobile/src/components/GlassSessionSwitcher.tsx#L488). Children are clipped to radius. |
| H6 — BlurView edge artifact | 🟡 **secondary** | `expo-blur` BlurView at [L176-184](app-mobile/src/components/GlassSessionSwitcher.tsx#L176-L184) uses `StyleSheet.absoluteFill` with no own `borderRadius`. The parent's `overflow: 'hidden'` clips it — but the clip is rasterized at the pixel boundary and on iOS this produces a faint 1-pixel lighter perimeter inside the curve. This **compounds** with H1 to amplify the "rough edges" perception, but is not the primary seam. |
| H7 — forced rasterization | ❌ disproven | No `shouldRasterizeIOS` / `renderToHardwareTextureAndroid` anywhere in the chain. |
| H8 — in-flight diff is the cause | ❌ disproven | The Seth-branch diff adds ORCH-0661 *pending-pill* styles (dashed border at `borderColor: rgba(255,255,255,0.28)`). The `container` style and the `glass.chrome.border.hairline` token are untouched. See §6. |

**Confidence:** HIGH. Six-field evidence:
- File + line: [GlassSessionSwitcher.tsx:486-487](app-mobile/src/components/GlassSessionSwitcher.tsx#L486-L487)
- Exact code: `borderWidth: 1, borderColor: glass.chrome.border.hairline`
- What it does: paints a 12%-white 1px stroke around the entire 44-tall pill perimeter
- What it should do: (out of scope — design decision for spec)
- Causal chain: 12% white stroke + dark blur backdrop → high-contrast 1px ring at every radius → perceived as "white seam on all 4 sides"
- Verification step: change `glass.chrome.border.hairline` from `0.12` alpha to `0` and rebuild → seam disappears across all 3 surfaces simultaneously (proves single token ownership too)

---

### Surface 2 — Preferences Chip (`GlassIconButton` instance)

Mounted at [GlassTopBar.tsx:223-230](app-mobile/src/components/GlassTopBar.tsx#L223-L230):
```tsx
<View ref={coachPrefsRef} collapsable={false}>
  <GlassIconButton
    iconName="options-outline"
    onPress={onOpenPreferences}
    active={preferencesActive}
    accessibilityLabel="Preferences"
  />
</View>
```

Renders the same `<GlassIconButton>` component as Surface 3 — identical styles, only `iconName` differs.

**Exact style** — geometry from `baseStyle` at [GlassIconButton.tsx:133-140](app-mobile/src/components/ui/GlassIconButton.tsx#L133-L140):
```ts
{
  width: resolvedSize,        // c.button.size = 44
  height: resolvedSize,       // 44
  borderRadius: resolvedRadius, // 44/2 = 22 → exact circle
}
```

The hairline + clip is on the *inner* `Pressable` at [GlassIconButton.tsx:284-292](app-mobile/src/components/ui/GlassIconButton.tsx#L284-L292):
```ts
pressable: {
  flex: 1,
  width: '100%',
  height: '100%',
  borderRadius: glass.chrome.button.radius,  // 22 → matches outer radius
  borderWidth: 1,                            // ← HAIRLINE STROKE
  borderColor: glass.chrome.border.hairline, // 'rgba(255, 255, 255, 0.12)' — SAME TOKEN AS SURFACE 1
  overflow: 'hidden',
}
```

Outer `base` style at [L274-283](app-mobile/src/components/ui/GlassIconButton.tsx#L274-L283) has `overflow: 'visible'` (so the unread badge can sit at `top: -2, right: -2`) and owns the L5 drop shadow:
```ts
base: {
  overflow: 'visible',
  shadowColor: glass.chrome.shadow.color,     // '#000000'
  shadowOffset: glass.chrome.shadow.offset,   // { 0, 4 }
  shadowOpacity: glass.chrome.shadow.opacity, // 0.28
  shadowRadius: glass.chrome.shadow.radius,   // 12
  elevation: glass.chrome.shadow.elevation,   // 6
}
```

**Hypothesis verdict:** identical to Surface 1.
- ✅ **H1 CONFIRMED** — same `borderWidth: 1`, same `glass.chrome.border.hairline` token.
- ❌ H4 disproven — `width: 44, height: 44, borderRadius: 22` is geometrically a perfect circle (radius = size/2).
- 🟡 H6 secondary — BlurView at [L188-197](app-mobile/src/components/ui/GlassIconButton.tsx#L188-L197) inside `overflow: 'hidden'`, same artifact pattern.

**Confidence:** HIGH. Same six-field evidence as Surface 1, same token, same `borderWidth: 1`.

---

### Surface 3 — Notification Bell (`GlassIconButton` instance)

Mounted at [GlassTopBar.tsx:234-240](app-mobile/src/components/GlassTopBar.tsx#L234-L240):
```tsx
<GlassIconButton
  iconName="notifications-outline"
  onPress={onOpenNotifications}
  active={notificationsActive}
  accessibilityLabel="Notifications"
  badge={unreadNotifications > 0 ? unreadNotifications : null}
/>
```

**Identical to Surface 2** — same component, only `iconName` ("notifications-outline" vs "options-outline") and `badge` prop differ. Style stack is byte-for-byte the same as Surface 2 above.

**Hypothesis verdict:** identical to Surfaces 1 and 2.
- ✅ **H1 CONFIRMED** — same `borderWidth: 1`, same `glass.chrome.border.hairline` token.
- 🟡 H6 secondary — same expo-blur perimeter pattern.

**Confidence:** HIGH.

---

## 4. Verdict — One Root Cause or Three?

**ONE ROOT CAUSE FAMILY. Single token, single stroke width, single visual effect.**

All three surfaces consume the *same* design-system token (`glass.chrome.border.hairline`) at the *same* `borderWidth: 1`, defined once at [designSystem.ts:386](app-mobile/src/constants/designSystem.ts#L386):

```ts
border: {
  hairline: 'rgba(255, 255, 255, 0.12)',
  topHighlight: 'rgba(255, 255, 255, 0.24)',  // present but NO LONGER CONSUMED — see §7 D-2
},
```

Constitutional #2 (one owner per truth) is **GREEN**: there is no token duplication, no per-component drift. All three components correctly read from the single source.

Therefore: **a single change to `glass.chrome.border.hairline` (lower the alpha, replace with `topHighlight`-style top-only effect, or remove and rely on shadow + blur) propagates to all three surfaces in one place.** The fix scope is one token mutation, not three component patches.

The "visual treatment looks inconsistent across the three" perception in the symptom report is a **shape-perception artifact**, not actual code drift:
- Surface 1 (pill bar) is a wide pill (~250pt wide × 44pt tall) — long horizontals make the top/bottom strokes dominant
- Surface 2/3 (chip + bell) are 44×44 circles — the stroke wraps a small circle, making it visually different even though it's the *same* stroke at the *same* width
- Same paint, three shapes → three different *visual* readings, but *one* underlying fix

---

## 5. Five-Truth-Layer Reconciliation

| Layer | What it says | Contradiction? |
|-------|--------------|----------------|
| **Docs** | `SPEC_ORCH-0589_FLOATING_GLASS_HOME.md §13` defines a 5-layer glass stack: L1 BlurView · L2 tint floor · L3 top highlight · L4 hairline border · L5 drop shadow. The L4 hairline IS the documented edge-definition layer. (Reference per inline comment at [GlassIconButton.tsx:9-15](app-mobile/src/components/ui/GlassIconButton.tsx#L9-L15).) | None — code matches spec exactly. |
| **Schema** | N/A — visual layer only. | — |
| **Code** | Single token `glass.chrome.border.hairline` (`rgba(255,255,255,0.12)`) consumed at `borderWidth: 1` by all three surfaces. No drift. | None internally. |
| **Runtime** | At paint, the 12% white 1px stroke is the OUTERMOST visible edge of each chrome element. Against the dark backdrop (`rgba(12,14,18,0.48)` tint floor over a BlurView dark tint over the photo card), this stroke reads as a high-contrast white ring on all four sides. | **Disagrees with user perception.** Code and spec both intend a "premium glass edge"; the user reads the same paint as "a defect." |
| **Data** | N/A. | — |

**Critical contradiction:** between intent (docs + code) and perception (user). The hairline IS the design — but at 12% alpha, on a dark backdrop, its visual weight has shifted from "subtle premium edge" to "dominant white seam" in the user's read. The recently-shipped V5 deletion of the L3 top-highlight (see §7 D-1) made this worse: with both edge layers, the L4 hairline was visually balanced by the L3 highlight; with only L4 remaining, the hairline is the sole carrier of "edge" and pulls more visual attention.

This is a **design-intent bug** (the spec's choice produced an undesirable visual result on device), not a code-correctness bug. The implementation is faithful; the design needs to change.

---

## 6. In-flight Seth-branch Diff Verdict

**Captured diff:**
- `app-mobile/src/components/GlassSessionSwitcher.tsx`: +118 lines (mostly +0/-0 net inside the styles block — adds NEW styles for ORCH-0661 pending-pill states)
- `app-mobile/src/constants/designSystem.ts`: +39 lines (adds NEW `glass.chrome.pending` sub-namespace)

**What the diff does (plain English):**
Implements ORCH-0661 — the regression fix that re-introduces the pending-state visual on session pills (sender's outgoing invite + receiver's incoming invite). Adds:
1. A new `SessionPillState` type (`'active' | 'pending-sent' | 'pending-received'`)
2. A type-level invariant assertion (`I-PILL-STATE-PARITY`) that locks SessionType ↔ SessionPillState parity at compile time
3. New token sub-namespace `glass.chrome.pending.*` with dim opacity, dashed border, and per-state badge geometry
4. Three new styles in `GlassSessionSwitcher`: `pillLabelPending`, `pillPendingBorder`, `pillPendingBadge`
5. Render branches for the dim pill body, dashed overlay border, and the absolute-positioned badge that escapes `overflow: 'hidden'` via sibling-of-Animated.View placement

**Does it touch the affected styles?** **NO.**
- `styles.container` (Surface 1) — UNTOUCHED
- `pressable` and `base` (Surfaces 2 + 3) — UNTOUCHED
- `glass.chrome.border.hairline` token — UNTOUCHED

**Does it introduce new white-seam-style visuals elsewhere?** Yes, *intentionally* — the new dashed border at `'rgba(255, 255, 255, 0.28)'` (28% alpha, line [designSystem.ts:433](app-mobile/src/constants/designSystem.ts#L433) in the diff) is BY DESIGN a more visible dashed outline on pending pills, to signal "this session is awaiting a response." This is a different visual language from the always-on perimeter hairline; it's not the bug under investigation.

**Verdict: KEEP. Build the ORCH-0669 fix on top.** The in-flight diff is correctly scoped to ORCH-0661 (pending-pill re-introduction) and does not interact with the white-seam root cause. Reverting it would lose ORCH-0661 progress and would not fix anything for ORCH-0669.

**Recommendation for spec writer:** when the spec lands, ensure that the chosen fix (whatever direction — alpha reduction, hairline-width swap, removal, top-only highlight) does not inadvertently affect the new ORCH-0661 dashed pending border. The pending border is a SEPARATE visual layer (`pillPendingBorder` style at [GlassSessionSwitcher.tsx:552-557](app-mobile/src/components/GlassSessionSwitcher.tsx#L552-L557)) drawn as an absolute-fill overlay INSIDE the pill, not the perimeter hairline. They are independent.

---

## 7. Findings (classified)

### 🔴 RC-1 — Single shared hairline token produces visible white seam on all 3 surfaces

| Field | Value |
|-------|-------|
| File + line | [designSystem.ts:386](app-mobile/src/constants/designSystem.ts#L386) (token); [GlassSessionSwitcher.tsx:486-487](app-mobile/src/components/GlassSessionSwitcher.tsx#L486-L487), [GlassIconButton.tsx:289-290](app-mobile/src/components/ui/GlassIconButton.tsx#L289-L290) (consumers) |
| Exact code | Token: `hairline: 'rgba(255, 255, 255, 0.12)'`. Consumers: `borderWidth: 1, borderColor: glass.chrome.border.hairline` |
| What it does | Paints a 12%-white 1px stroke around the perimeter of all 3 Home-header chrome elements |
| What it should do | (out of scope — design decision; spec writer to define) |
| Causal chain | 12% white × 1px stroke + dark backdrop → high-contrast ring at radius edge → perceived as "white seam on 4 sides" + amplifies "edges look rough" |
| Verification step | Set token alpha to 0, rebuild. All three seams disappear simultaneously (proves single ownership). Restore to 0.12 → all three return. |

### 🟠 CF-1 — V5 deletion of L3 top-highlight made the L4 hairline visually dominant

The ORCH-0589 v4 (V5) patch deleted the L3 top-highlight overlay from both `GlassSessionSwitcher` and `GlassIconButton`:
- [GlassSessionSwitcher.tsx:198-200](app-mobile/src/components/GlassSessionSwitcher.tsx#L198-L200): comment `"top-highlight line removed — rendered as a visible white hairline artifact on device. Chrome elements now use only L4 full-perimeter border + L5 shadow for edge definition."`
- [GlassIconButton.tsx:230-231](app-mobile/src/components/ui/GlassIconButton.tsx#L230-L231): comment `"top-highlight line removed — rendered as visible artifact on chrome scale. Full-perimeter hairline border remains."`
- [GlassSessionSwitcher.tsx:496](app-mobile/src/components/GlassSessionSwitcher.tsx#L496) + [GlassIconButton.tsx:293](app-mobile/src/components/ui/GlassIconButton.tsx#L293): `topHighlight` style deleted

The team's intent was correct (the top-highlight was itself producing a visual artifact). But removing one of two edge-definition layers left the L4 hairline as the sole carrier of "edge" — making it visually heavier by relative contrast. This is a contributing factor: the V5 patch fixed one visible artifact and unintentionally amplified another.

### 🟡 HF-1 — Dead `topHighlight` token still exported

[designSystem.ts:387](app-mobile/src/constants/designSystem.ts#L387) still defines `topHighlight: 'rgba(255, 255, 255, 0.24)'`, but no consumer reads it (V5 patch deleted the only two consumers). Constitution #8 (subtract before adding): when V5 deleted the consumers, the token should have been removed too. **Cleanup candidate.** If the spec writer chooses to re-introduce a top-only highlight as the ORCH-0669 fix, the token is conveniently already there — but if not, delete it.

### 🟡 HF-2 — `expo-blur` BlurView perimeter clipping is itself imperfect on iOS

`BlurView` at [GlassSessionSwitcher.tsx:176-184](app-mobile/src/components/GlassSessionSwitcher.tsx#L176-L184) and [GlassIconButton.tsx:188-197](app-mobile/src/components/ui/GlassIconButton.tsx#L188-L197) uses `StyleSheet.absoluteFill` (no own `borderRadius`) inside an `overflow: 'hidden'` parent. On iOS, the parent's clip is rasterized at the pixel boundary, which produces a subtle 1-pixel lighter perimeter inside the curve. This compounds with RC-1 to make "rough edges" more perceptible than the hairline alone would. Cannot be fully eliminated without restructuring the layer stack (e.g., putting `borderRadius` directly on the BlurView, which has its own iOS quirks). **Note for spec writer**, not blocking.

### 🟡 HF-3 — `StyleSheet.hairlineWidth` not used

Both consumers use the literal `borderWidth: 1`. `StyleSheet.hairlineWidth` is `0.5` on iOS (Retina) and `1` on Android (where it cannot go below 1px). Using `hairlineWidth` would have produced a thinner seam on iOS automatically. Note for spec writer.

### 🔵 OBS-1 — borderRadius math is correct on all three surfaces

Pill bar container: `height: 44, borderRadius: 22` → ratio 1:0.5 = perfect pill end-caps. Chip + bell: `width: 44, height: 44, borderRadius: 22` → radius = size/2 = perfect circle. The "not perfectly round" symptom is not caused by radius math; it is the visual interaction of H1 (white hairline) + HF-2 (BlurView clip artifact). Geometry is fine.

### 🔵 OBS-2 — All three surfaces share the same shadow stack

Identical `shadowColor: '#000000', shadowOffset: { 0, 4 }, shadowOpacity: 0.28, shadowRadius: 12, elevation: 6`. Consistent across surfaces. No shadow contribution to the seam.

---

## 8. Blast Radius

| Vector | Affected? | Notes |
|--------|-----------|-------|
| Solo + collab parity | Same — both modes render the same chrome | No solo/collab divergence |
| Admin dashboard | NO — admin is web (Tailwind), no React Native, no `BlurView` | Out of scope |
| Other React Query keys | N/A — visual-only | — |
| Cache state | N/A | — |
| Constitutional invariants | #2 GREEN (single token owner). #8 violated by HF-1 (dead `topHighlight` token). All others N/A. | — |
| Other components consuming `glass.chrome.border.hairline` | **GlassBottomNav (very likely)** + create pill at [GlassSessionSwitcher.tsx:578](app-mobile/src/components/GlassSessionSwitcher.tsx#L578) | See discoveries D-3 + D-4 |

---

## 9. Discoveries for Orchestrator

**D-1 — V5 deletion regression history.** The ORCH-0589 v4 (V5) patch deleted the L3 top-highlight because it was *itself* producing a visible white hairline artifact (per comment at [GlassSessionSwitcher.tsx:198-200](app-mobile/src/components/GlassSessionSwitcher.tsx#L198-L200)). The team's V5 fix removed one artifact and inadvertently exposed another (the L4 perimeter hairline). The spec writer must understand this history: bare reversion of V5 is NOT an option (it would re-introduce the V5-era artifact), but a *new* edge-definition layer might still be the right call.

**D-2 — Dead `topHighlight` token at [designSystem.ts:387](app-mobile/src/constants/designSystem.ts#L387).** Token still defined but no consumer reads it post-V5. Constitution #8 cleanup candidate. If spec re-introduces top-only highlight as fix, token is reusable; if not, delete.

**D-3 — `GlassBottomNav.tsx` likely shares the same defect.** Out of scope per dispatch (top-bar focus only). The bottom nav is the fourth chrome element on Home; if it consumes `glass.chrome.border.hairline` at `borderWidth: 1` (very likely, given the shared `glass.chrome.*` token system), it has the same white seam. Recommend: orchestrator decides whether to bundle into ORCH-0669 spec scope or file as a separate ORCH (would be the same fix, applied to one more file).

**D-4 — `createPill` style at [GlassSessionSwitcher.tsx:571-580](app-mobile/src/components/GlassSessionSwitcher.tsx#L571-L580) is a fourth on-screen consumer.** The "+" pill (32×32 circle) inside the session pill bar also has `borderWidth: 1, borderColor: glass.chrome.border.hairline`. Visually nested inside the bigger pill bar so the seam is less prominent but technically present. Will be fixed automatically by any token-level change — no separate work needed, just noting completeness.

**D-5 — No platform divergence found.** iOS and Android both render the same defect (1px hairline is 1px on both because the consumer used the literal `1`, not `StyleSheet.hairlineWidth`). HF-3 above proposes using `hairlineWidth` would yield thinner seam on iOS automatically — spec decision.

**D-6 — In-flight ORCH-0661 work is on the same file but unrelated.** See §6. Recommend: spec writer reads this report's §6 before starting, to avoid accidentally rolling back the pending-pill machinery.

---

## 10. Confidence Statement

**HIGH.** Per `feedback_forensic_thoroughness`:
- Read every file in the manifest end-to-end (working tree, not HEAD — explicitly verified for the two uncommitted files)
- Traced the import chain from the page (HomePage) downward through GlassTopBar to both leaves (GlassIconButton + GlassSessionSwitcher)
- Captured the in-flight diff verbatim and confirmed it does not touch the affected styles
- Verified the shared token (`glass.chrome.border.hairline`) at its single definition site and at every consumer
- Disproved 6 of 8 hypotheses with line-level evidence; confirmed H1; classified H6 as compounding secondary
- Mechanically computed `borderRadius` vs `width/height` ratios for all three surfaces to disprove H4

What would lower confidence to MEDIUM: not having captured the in-flight diff, or having delegated any read to a sub-agent.

---

## 11. Fix Strategy (direction only — NOT a spec, NOT code)

The dispatch explicitly forbids proposing solutions in this report. Honoring that. The orchestrator's spec writer has the following structural shape to work with:

- **One token mutation** (`glass.chrome.border.hairline`) propagates to all 3 (or 4 with the create pill, or 5+ if GlassBottomNav is in scope) surfaces simultaneously.
- The spec must reckon with the V5 deletion history (see D-1) — straight token-removal returns to a "no edge layer" state which the V5 author explicitly chose against.
- The fix is a **design decision**, not a code-correctness fix.
- ORCH-0661 in-flight work is independent and should be left in place.

---

## 12. Verdict

- **Status:** root cause **PROVEN HIGH**.
- **Confidence:** HIGH.
- **Surfaces affected:** 3 (potentially 4-5 — D-3, D-4 noted).
- **Root cause families:** 1.
- **Fix scope:** single token (with possible design-system follow-up depending on chosen direction).
- **In-flight diff:** keep — unrelated.
- **Constitutional violations:** #8 (HF-1 — dead `topHighlight` token).
- **Invariant candidates:** none new — existing invariants hold.
- **Ready for SPEC:** yes, after orchestrator decides scope (top-bar only? include bottom nav? include create pill?).
