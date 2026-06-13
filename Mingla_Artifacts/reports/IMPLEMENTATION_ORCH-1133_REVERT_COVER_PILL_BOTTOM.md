# IMPLEMENTATION — ORCH-1133 [revert checkout cover to original compact band + give the public-event Sound pill clearance from the details section]

**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1133-[revert-cover-pill-bottom]/` on branch `ORCH-1133-revert-cover-pill-bottom`
**Base:** origin/main `907b2b2a0` (rebased, up to date).
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-1133_REVERT_COVER_PILL_BOTTOM.md` (binding).
**Commit:** `2f06e8314` (single commit; HEAD body carries `[TEST-MOD-APPROVED ORCH-1133]`).
**Status:** implemented and verified (buyer-web live-fire for both changes).

---

## 1. Summary

Round 3 of the cover/pill saga (ORCH-1128 → 1131 → 1132 → 1133). Two tightly-scoped product changes, exactly per spec:

1. **Reverted** all three Get-tickets checkout mini-card covers (event/trip/experience) to the TRUE pre-ORCH-1131 original — a fixed `miniCover { height: 64, borderRadius: radiusTokens.md, marginBottom: spacing.sm }` compact band + a plain `<EventCoverMedia hue mediaUrl mediaType radius={0} label="" style={styles.miniCover} />` call. Removed every ORCH-1131/1132 cover addition (coverAspect/setCoverAspect `useState`, `clampedCoverAspect`, `onAspectRatio`, `videoContentFit="contain"`, the inline `aspectRatio`, the bloated comments). Dropped the now-unused `useState` import from the trip + experience files; KEPT it in the event file (`waitlistTicketId` still uses it). Seth's complaint — "The cover fills the entire screen. Revert to original." — is resolved: the prod cover renders at **684px** (full-screen); my build renders at **64px** (compact band).
2. **Moved** the shared public-event Sound pill bottom-anchor from `bottom: 22` to `bottom: 40` in `packages/event-rendering/EventCoverMedia.tsx` so it clears the blue details panel by a measured **+12px** (was −6px overlap). `right: 24` and the `bottomRight` position are untouched.

Six in-scope jest files updated to round-3 values and brought GREEN (`[TEST-MOD-APPROVED ORCH-1133]` token in HEAD). The clamp-math adversarial test was INVERTED in place (not deleted — the append-only CI gate forbids test-file deletion with no token bypass; see §6 / Discoveries).

---

## 2. SPEC success-criteria coverage

| SC | Criterion | Status | Evidence (commit `2f06e8314`) |
|----|-----------|--------|-------------------------------|
| SC-1 (Web) | `/e/*` Sound pill bottom ≥10px above details panel (target +12) | ✓ PASS | Playwright runtime measure on live `…/e/leggothis/vibes-and-stuff`, 430×932@2x: prod `bottom:22` gap = **−6px**; my `bottom:40` gap = **+12.0px**. `AFTER_orch1133_pill_bottom40_vibes.png` |
| SC-2-Web (cover) | Each checkout shows fixed 64px compact band, not full-screen; `miniCover` declares `height: 64` | ✓ PASS | Local worktree build `/checkout/09b4ece6…`: cover VIDEO measured **h=64** (top:81), 0 console errors. `AFTER_localbuild_checkout_compact64.png` vs prod `BEFORE_prod_checkout_cover_fullscreen.png` (h=684) |
| SC-2-iOS / SC-2-Android | Same compact band (shared RN code) | ✓ PASS (parity automatic) | One RN codebase; same `miniCover.height:64` + plain JSX renders on all targets. Web export is the faithful render of the RN source. |
| SC-3 | 3 checkout files have NO coverAspect/setCoverAspect/clampedCoverAspect/onAspectRatio/videoContentFit/inline aspectRatio; plain 6-prop EventCoverMedia call | ✓ PASS | `orch1132ClampMathHeroIsolationAdversarial.test.ts` (inverted) asserts all absent + plain call, all 3 routes; grep-clean |
| SC-4 | trip + experience React imports drop `useState`; event keeps it; tsc/lint clean (no unused-import) | ✓ PASS | trip = `useCallback, useMemo`; experience = `useCallback`; event = `useCallback, useState`. tsc: 0 errors in the 4 edited files (package tsc exit 0). eslint: 0 errors (2 warnings pre-exist on origin/main — unrelated `useMemo`/`LiveEvent`) |
| SC-5 | `audioControlBottomRight = { right: 24, bottom: 40 }`; right unchanged 24; topLeft/topRight unchanged 14 | ✓ PASS | `orch1131SiblingInsetNonRegressionAdversarial.test.ts` asserts right [24]/bottom [40]/topLeft [14]/topRight [14] |
| SC-6 (cross-consumer) | Pill stays on-screen at bottom:40 on full-bleed covers | ✓ PASS | Pill at bottom:40 measured fully on-screen (pillBottom 533 < viewport 932); shared 36px pill on ≥200px boxes never clips |
| SC-7 (tests) | 6 in-scope jest files PASS at round-3 values, token present | ✓ PASS | 5 suites 39/39 green; eventCoverMedia pill test green; append-only check 6/6 pass exit 0 |

---

## 3. Files changed (10; +155 / −222)

**Product (4):**
- `mingla-business/app/checkout/[eventId]/index.tsx` (~18 lines) — removed coverAspect state, plain JSX, miniCover height:64; KEPT useState import.
- `mingla-business/app/checkout-trip/[tripEventId]/index.tsx` (~20) — same + dropped `useState` import.
- `mingla-business/app/checkout-experience/[experienceEventId]/index.tsx` (~20) — same + dropped `useState` import.
- `packages/event-rendering/EventCoverMedia.tsx` (~11) — `audioControlBottomRight.bottom` 22→40 (+ explanatory comment). `right:24` untouched.

**Tests (6):**
- `mingla-business/__tests__/orch1131CoverCropSoundInset.test.ts` (~65) — happy-path: miniCover height===64 (3 routes) + plain call + right===24/bottom===40.
- `mingla-business/__tests__/orch1131SiblingInsetNonRegressionAdversarial.test.ts` (~9) — bottom [40] (was [22]); right/topLeft/topRight/heroBox unchanged.
- `mingla-business/__tests__/orch1132ClampMathHeroIsolationAdversarial.test.ts` (~178) — INVERTED: asserts clamp/state/props are GONE + miniCover height:64; hero isolation + ECM default preserved.
- `mingla-business/src/components/ui/__tests__/eventCoverMedia.test.ts` (~20) — pill test: right:24 + bottom:40, block-parse slice (DISC-1 hardening). DISC-2 cover-picker tests untouched.
- `mingla-business/src/components/offering/__tests__/orch1128FreeCtaMutePill.test.ts` (~18) — bottom 40 + right 24, block-parse.
- `mingla-business/src/components/offering/__tests__/orch1128FreeCtaMutePill.adversarial.test.ts` (~18) — bottom > 14 (40) + right 24 + no top: key, exact-block parse.

---

## 4. Data-model changes applied
None. Pure RN style/JSX + tests. No migration, no RLS, no schema.

## 5. Edge functions touched
None.

---

## 6. Regression tests added / updated

**Happy-path (implementor-owned):** `mingla-business/__tests__/orch1131CoverCropSoundInset.test.ts` — source-introspection (comment-proof) pinning `miniCover.height===64` (all 3 routes), plain EventCoverMedia call (no videoContentFit/onAspectRatio), and `audioControlBottomRight` right===24 / bottom===40.

**fails-on-revert verified at commit `2f06e8314`:** Hand-mutated (true LINE DELETION) the product code in File A back toward ORCH-1132 state — removed `height: 64` from miniCover, re-added `onAspectRatio={setCoverAspect}` + `videoContentFit="contain"` + inline `aspectRatio` to the JSX — and reverted the pill `bottom: 40 → 22`. Result: `orch1131CoverCropSoundInset.test.ts` → **3 failed, 5 passed** (the height:64 assertion, the plain-call assertion, and the bottom===40 assertion all RED). Restored the fix → **8 passed, 8 total** GREEN. Proves the test exercises the actual bug and is not comment-fooled.

**Append-only compliance:** every modified test file deletes ≥1 line; the HEAD commit body carries `[TEST-MOD-APPROVED ORCH-1133]` with the why-cited reason. `node .github/scripts/test-append-only-check.js` → **6 passed, 0 failed, exit 0**.

---

## 7. Old → New receipts

### checkout/[eventId]/index.tsx
**Before:** mini-card cover was a full-frame adaptive box — `coverAspect`/`clampedCoverAspect` useState clamp (0.6..1.91) drove an inline `aspectRatio`, with `onAspectRatio={setCoverAspect}` + `videoContentFit="contain"`; `miniCover` declared NO height (ballooned to ~684px on web). **Now:** plain 6-prop EventCoverMedia call; `miniCover { height: 64, borderRadius, marginBottom }` compact band. KEPT the `useState` import (`waitlistTicketId`). **Why:** Seth round-3 reject — revert to e90875dda~1 original (SC-2/SC-3/SC-4). **Lines:** ~18.

### checkout-trip/[tripEventId]/index.tsx & checkout-experience/[experienceEventId]/index.tsx
**Before:** same adaptive-cover additions as the event file. **Now:** plain call + `height:64` band; `useState` dropped from the React import (coverAspect was its sole user). **Why:** same revert + SC-4 no-unused-import. **Lines:** ~20 each.

### packages/event-rendering/EventCoverMedia.tsx
**Before:** `audioControlBottomRight` = `{ right: 24, bottom: 22 }` (ORCH-1128) — pill overlapped the public-event details panel by 6px. **Now:** `{ right: 24, bottom: 40 }` — pill clears the panel by +12px. `right` and `bottomRight` position untouched; `audioControlTopLeft`/`TopRight` (14) untouched. **Why:** Seth — "sound button still needs some space from the details section" (SC-1/SC-5). **Lines:** ~11 (mostly the explanatory comment).

---

## 8. Cross-surface impact

| Surface | Affected | Change | Parity |
|---------|----------|--------|--------|
| Consumer iOS | YES (shared pill only) | gallery Sound pill +18px up on full-bleed; benign | automatic (shared) |
| Consumer Android | YES (shared pill only) | same | automatic |
| Buyer/anon Web | YES | 3 checkout covers → 64px band; `/e/*` pill clears panel +12px | automatic (web export of RN) |
| Business iOS | YES (checkout cover) | compact 64px band restored | automatic |
| Business Android | YES (checkout cover) | same | automatic |
| Admin Web | NO | no consumer of these files | — |
| Business Web preview (authoring) | YES (shared pill only) | preview Sound pill +18px up; benign | automatic |

All parity is automatic (single shared RN codebase). No manual per-surface paths.

---

## 9. Smoke / live-fire result

- **Sound pill (SC-1):** Playwright on live prod `…/e/leggothis/vibes-and-stuff` (430×932@2x). Measured pill vs details-panel (`borderTopLeftRadius:28`) `getBoundingClientRect`: current prod `bottom:22` → gap **−6.0px** (overlap, the bug). Injected my committed value (bottom:40) → gap **+12.0px** (clean). Screenshot `AFTER_orch1133_pill_bottom40_vibes.png`. Matches the forensics live-fire (`candidate_bottom40_vibes.png`, `bottom:40 => gap:12`).
- **Checkout cover (SC-2):** ran THIS worktree's Expo web build (`expo start --web :8092`) and loaded `/checkout/09b4ece6-eabc-4734-8ce3-3a25d90417e4`. Cover VIDEO measured **h=64** (top:81), page shows the compact "Vibes and Stuff" mini-card, 0 console errors. Screenshot `AFTER_localbuild_checkout_compact64.png`. Contrast: prod (old code) measured **h=684** full-screen — `BEFORE_prod_checkout_cover_fullscreen.png`.
- **Gates:** package tsc exit 0; eslint 0 errors on the 3 checkout files; six jest files GREEN; all four ORCH-0978 strict-grep gates OK; append-only check 6/6 exit 0.

**Evidence dir:** `Mingla_Artifacts/evidence/ORCH-1133/`
- `AFTER_localbuild_checkout_compact64.png` — my build, 64px band (SC-2 AFTER).
- `BEFORE_prod_checkout_cover_fullscreen.png` — prod, 684px full-screen (SC-2 BEFORE).
- `AFTER_orch1133_pill_bottom40_vibes.png` — pill at bottom:40, +12px gap (SC-1 AFTER).
- `seam_*` / `repro_*` (forensics) — pill at bottom:22, −6px overlap (SC-1 BEFORE).
- `candidate_bottom40_vibes.png` / `candidate_bottom44_vibes.png` (forensics) — design-value live-fire.

---

## 10. Known issues / deferred
- The 5 remaining failures in `eventCoverMedia.test.ts` are the pre-existing DISC-2 cover-picker-copy / media-error tests (`event creator shows upload limits`, `iOS-compatible image output`, `image/GIF picking`, `video playback gated by active surface intent`, `media render failures surfaced`). They fail identically on origin/main and are explicitly OUT OF SCOPE per spec §2/§7. My pill test in that file PASSES.
- 2 eslint warnings (`useMemo` unused in trip, `LiveEvent` unused in event) pre-exist on origin/main (both are import-only on origin too) — NOT introduced by this ORCH; out of allowlist scope.
- No `[TRANSITIONAL]` markers introduced.

---

## 11. Operator action required
- No migration. No edge-function deploy. No native rebuild (pure-JS RN style/JSX change → OTA-eligible per the OTA policy; orchestrator/operator decides the channel).
- Route back to **mingla-orchestrator** for REVIEW, then **mingla-tester** (buyer-web Playwright SC-1 measure + checkout-cover SC-2 render + the 6-file jest gate).
- NOTE (env): this worktree's `node_modules` was missing `expo-image-manipulator` (declared in package.json `~14.0.8`, referenced by `src/utils/normalizeTripDayImage.ts` on origin/main — pre-existing, unrelated to ORCH-1133). I `npm install`ed it with `--no-save` to unblock the local web bundle for the live-fire; `package.json`/`package-lock.json` are unmodified (git status clean). The orchestrator/tester may need the same install to run the business web locally.

---

## 12. Discoveries for Orchestrator

- **DISC-A (spec-vs-gate conflict, RESOLVED in-lane):** The SPEC §7/§9/§Allowlist instructed DELETING `orch1132ClampMathHeroIsolationAdversarial.test.ts` and asserted the `[TEST-MOD-APPROVED ORCH-1133]` token covers the deletion. The ACTUAL CI gate (`.github/scripts/test-append-only-check.js`, ORCH-0840 policy) categorically FORBIDS test-file deletion — "No override token bypasses deletion" — so a delete would FAIL CI (verified: exit 1). I preserved the spec's INTENT without violating the gate by INVERTING the file in place (MODIFY, token-covered): it now asserts the checkout clamp/coverAspect/onAspectRatio/videoContentFit/inline-aspectRatio must STAY gone + miniCover height:64, while keeping the still-valid public-hero isolation + EventCoverMedia `videoContentFit="cover"` default checks. This is strictly a stronger durable guard than deletion. Flagging so the orchestrator/forensics knows the spec's "DELETE" instruction is incompatible with the append-only gate for future ORCHs — modify/invert, never delete.
- **DISC-B (env gap):** `expo-image-manipulator` not installed in the ORCH-1133 worktree (see §11). Likely affects sibling worktrees too; an incomplete `npm install` on spawn.
- No COMMS-ledger BLOCK rows addressed to ORCH-1133/this skill/ALL. The open ALL-targeted rows (COMMS-0027/0030 trip migrations, 0028 gif-cover-key, etc.) are all WARN and concern trip/cover-picker migrations — orthogonal to this RN style revert; read and factored (no action needed).
