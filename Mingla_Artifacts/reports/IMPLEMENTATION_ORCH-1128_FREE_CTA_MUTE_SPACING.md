# IMPLEMENTATION — ORCH-1128 [public offering-page polish: free-ticket CTA full-width + cover mute-pill bottom clearance]

**Status:** implemented and verified (source-level + fails-on-revert; native runtime UNVERIFIED — UI-only, no device run this pass)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1128-[free-cta-mute-spacing]` on branch `ORCH-1128-free-cta-mute-spacing`
**Base:** origin/main `40ca2da30` (includes ORCH-1117 floating bar + ORCH-1124 mute-pill bottomRight)

---

## 1. Summary

Two follow-up tweaks to the buyer-web public offering page, both reported by Seth:

- **Item 1 — free-ticket CTA full width.** On the floating Buy bar, a PAID ticket shows a price column (flex:1) + a content-width button sharing the row. A FREE / waitlist ticket has no price, but the code still rendered an EMPTY `flex:1` placeholder column, so the sole "Get free ticket" button hugged the right half of the bar instead of spanning it. Fix: render the price column ONLY for `kind === "buy"`; for the non-buy tappable kinds the button gets a new `buttonFull` style (`flex:1`, `marginLeft:0`) so it fills the bar. The paid price-left / button-right split is unchanged. Applied to BOTH the buyer-web bar (`mingla-business`) and the consumer-native bar (`app-mobile`) — they shared the identical empty-placeholder defect.

- **Item 2 — cover mute pill bottom clearance.** The shared `EventCoverMedia` bottom-right Sound/Mute pill sat at `bottom:14`, flush on the cover seam, bleeding into the details section that begins immediately below the public hero (the hero is `radius:0` + `StyleSheet.absoluteFill`, so there is no rounded inset). Raised the single shared `audioControlBottomRight.bottom` from `14` → `22` (8px extra clearance). One shared value → the web public page AND the native consumer gallery both inherit it; the native gallery pill simply moves up 8px, still safely within the cover. The ORCH-1124 bottom-right POSITION is preserved — NOT reverted to topRight.

---

## 2. SPEC success-criteria coverage

| SC | Description | Status | Commit |
|----|-------------|--------|--------|
| SC-1-Web | Free-ticket CTA spans full bar width on buyer web | ✓ | `<C_BIZ>` |
| SC-1-Native | Free-ticket CTA spans full bar width on consumer native | ✓ | `<C_NATIVE>` |
| SC-1-paid | Paid (buy) price-left / button-right layout UNCHANGED | ✓ | `<C_BIZ>` / `<C_NATIVE>` |
| SC-2 | Mute pill bottom offset raised so it clears the details (14 → 22) | ✓ | `<C_ECM>` |
| SC-2-pos | ORCH-1124 bottomRight position preserved (no topRight regression) | ✓ | `<C_ECM>` |
| SC-2-parity | Native gallery inherits the shared value (no separate path) | ✓ (automatic) | `<C_ECM>` |
| SC-G1 | ORCH-1117 state machine (non-tappable unavailable) untouched | ✓ (35/35 sibling tests green) | — |
| SC-G2 | ORCH-1124 mute-pill firing/wiring untouched | ✓ (adversarial test green) | — |

---

## 3. Files changed

| File | +/− | Item |
|------|-----|------|
| `mingla-business/src/components/offering/FloatingOfferingBar.tsx` | +12 −3 | 1 (web) |
| `app-mobile/src/components/offering/FloatingOfferingBar.tsx` | +12 −4 | 1 (native) |
| `packages/event-rendering/EventCoverMedia.tsx` | +3 −1 | 2 (shared) |
| `mingla-business/src/components/ui/__tests__/eventCoverMedia.test.ts` | +7 −4 | 2 test (TEST-MOD-APPROVED) |
| `mingla-business/src/components/offering/__tests__/orch1128FreeCtaMutePill.test.ts` | NEW (+~115) | regression (both items) |

### Exact lines changed

**Item 1 — both `FloatingOfferingBar.tsx`:**
- Removed the `) : ( <View style={styles.priceCol} /> )` empty-placeholder branch → `) : null`.
- Added `cta.kind !== "buy" && styles.buttonFull` to the Pressable's style array.
- Added style `buttonFull: { flex: 1, marginLeft: 0 }`.

**Item 2 — `packages/event-rendering/EventCoverMedia.tsx`, `audioControlBottomRight` style:**
- `bottom: 14` → `bottom: 22` (the only value change; `right: 14` and the `zIndex`/position contract untouched).

---

## 4. Data-model changes applied

None. UI-only.

## 5. Edge functions touched

None.

---

## 6. Regression tests added

**New (implementor happy-path):** `mingla-business/src/components/offering/__tests__/orch1128FreeCtaMutePill.test.ts` — 4 tests, all green:
1. web bar free CTA full-width (priceCol placeholder gone, `buttonFull` flex:1/marginLeft:0, applied for non-buy, paid split preserved)
2. native bar free CTA full-width (same assertions on `app-mobile`)
3. mute pill `bottom: 22` (and NOT `14`, right:14 preserved)
4. public page still inherits `bottomRight` default

**Modified (1 assertion):** `eventCoverMedia.test.ts` line ~360 — updated `bottom: 14` → `bottom: 22` and widened the source slice; carries `[TEST-MOD-APPROVED ORCH-1128]` in the commit body.

**fails-on-revert — verified by TRUE LINE DELETION (not comment-out):**
- Item 1 web — deleted the `buttonFull` style def → web test FAILS (1 failed, 3 passed); restored → 4 passed.
- Item 1 native — deleted the `app-mobile` `buttonFull` style def → native test FAILS; restored → 4 passed.
- Item 2 — restored `bottom: 14` → mute-pill test FAILS; restored `bottom: 22` → 4 passed.

`fails-on-revert verified at HEAD of ORCH-1128-free-cta-mute-spacing` (see commit hashes §11).

---

## 7. Old → New receipts

### `mingla-business/src/components/offering/FloatingOfferingBar.tsx`
- **Before:** non-buy tappable CTA rendered an empty `<View style={styles.priceCol} />` (flex:1) beside a content-width button → free CTA hugged ~half the bar.
- **Now:** non-buy renders no price column; the button carries `buttonFull` (flex:1, marginLeft:0) → spans the full bar (within the 660 maxWidth container).
- **Why:** SC-1 — free CTA must be full-width.
- **Lines:** ~12.

### `app-mobile/src/components/offering/FloatingOfferingBar.tsx`
- Identical defect and identical fix (native parity). **Why:** SC-1-Native. **Lines:** ~12.

### `packages/event-rendering/EventCoverMedia.tsx`
- **Before:** `audioControlBottomRight.bottom = 14` → pill flush on the cover seam, bleeding into details.
- **Now:** `bottom = 22` → clears the seam.
- **Why:** SC-2. **Lines:** 1 value + comment.

---

## 8. Cross-surface impact

| Surface | Affected? | What changes / why not | Parity |
|---------|-----------|------------------------|--------|
| Buyer / anonymous Web | YES | Item 1 (free CTA full-width) + Item 2 (mute pill clearance on public hero) | — |
| Consumer iOS | YES | Item 1 (native bar) + Item 2 (shared cover, gallery pill +8px up) | manual (item 1) / automatic (item 2 shared pkg) |
| Consumer Android | YES | same as iOS (shared RN) | same |
| Business iOS | Item 2 only | shares `EventCoverMedia`; no offering floating bar there | automatic |
| Business Android | Item 2 only | same | automatic |
| Admin Web (adjacent) | NO | does not import these components | — |
| Business Web preview (adjacent) | YES (item 2 in cover preview) | shares `EventCoverMedia`; offering bar is buyer-web | automatic |

Item 1 parity is MANUAL (two separate files: business + app-mobile) — both edited. Item 2 parity is AUTOMATIC (single shared package value).

---

## 9. Smoke result

No device/sim run this pass (UI-only, low-risk style change). Source-level + jest verification:
- New ORCH-1128 suite: 4/4 green.
- ORCH-1124 adversarial + ORCH-1117 cta/dead-tap suites: 35/35 green (no state-machine or mute-firing regression).
- TypeScript: zero errors on any edited line in either FloatingOfferingBar or the EventCoverMedia style (the 29 `EventCoverMedia.tsx` `react`-module-resolution errors are PRE-EXISTING on base `40ca2da30`, a cross-package tsconfig boundary, not introduced here).

**UNVERIFIED (needs runtime/device):** visual confirmation on a physical device that the free CTA renders edge-to-edge and the mute pill no longer touches the details. Recommend the tester drive the live public video-cover page (e.g. `/e/leggothis/a-life-in-vegas`) for item 2 and a free-ticket public event for item 1.

---

## 10. Known issues / deferred

- The 5 pre-existing FAILs in `eventCoverMedia.test.ts` (upload limits / iOS image output / GIF picking / playback gating / render-failure surfacing) are UNRELATED to this ORCH — they fail identically on base `40ca2da30` (verified by `git stash` run). NOT touched. See Discoveries.

## 11. Operator action required

- No migration, no edge deploy. Route to orchestrator REVIEW → tester.
- Edge-fn deploy list: NONE.

## 12. Discoveries for Orchestrator

- **D1 — pre-existing test rot:** `mingla-business/src/components/ui/__tests__/eventCoverMedia.test.ts` has 5 PRE-EXISTING failing tests on origin/main `40ca2da30` (event-creator upload-limits / iOS-compatible image output / image-GIF-vs-video split / playback-gating / render-failure-surfacing). They reference `EventCover`/`CoverPicker` source that no longer matches the asserted tokens in this worktree. Unrelated to ORCH-1128; flagging for a cleanup ORCH.
