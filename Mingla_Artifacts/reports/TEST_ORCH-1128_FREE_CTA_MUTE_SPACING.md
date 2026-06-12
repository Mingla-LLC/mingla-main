# TEST — ORCH-1128 [public offering-page polish: free-ticket CTA full-width + cover mute-pill bottom clearance]

**Verdict:** PASS — 0 P0 · 0 P1 · 0 P2 · 0 P3 · 2 P4 (praise)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1128-[free-cta-mute-spacing]` on branch `ORCH-1128-free-cta-mute-spacing`
**Tested HEAD:** `8746b8964` (rebased onto origin/main `40ca2da30` — branch was 1 commit behind anchor at dispatch HEAD `a5e5747a5`; rebased clean, no conflicts).
**Mode:** TARGETED. Live-fire: buyer-web Chromium (Playwright + system Chrome, headless) against production `business.usemingla.com` (BEFORE baseline) AND a clean `expo export -p web` static build of the branch (AFTER proof). Native: source + fails-on-revert (sim deferred per dispatch "sim optional for native"; same code-shape as the runtime-proven web bar).

---

## 1. Verdict + counts

PASS. Both fixes are runtime-proven on buyer-web. No P0/P1/P2/P3. The paid layout is byte-identical between prod and branch (unchanged). The mute pill clearance is numerically confirmed at 22px (was 14px), still bottom-right, and still fires (Sound↔Mute toggle) on the branch build. Regression gate satisfied: implementor happy-path test (fails-on-revert independently re-run) + tester adversarial test (different angle, on-branch, in-diff, own fails-on-revert) both present.

---

## 2. SC-by-SC matrix

| SC | Description | Verdict | Evidence |
|----|-------------|---------|----------|
| SC-1-Web | Free-ticket CTA spans full bar width on buyer web | **PASS** (runtime) | Branch export `EXPORT_free_floatingbar.png`: "Get free ticket" spans the full 660px bar (x≈310→970). PROD baseline `free_event_floatingbar.png`: same button hugged right, w≈169px (the bug). |
| SC-1-Native | Free-ticket CTA full-width on consumer native | **PASS** (source + fails-on-revert) | `app-mobile/.../FloatingOfferingBar.tsx` carries identical fix (`buttonFull {flex:1, marginLeft:0}` applied only for `kind!=="buy"`); native happy-path test green; deleting native `buttonFull` → native test FAILS (re-run by tester). Sim deferred per dispatch. |
| SC-1-paid | Paid (buy) price-left / button-right split UNCHANGED | **PASS** (runtime) | `vibes-and-stuff` paid page: PROD vs EXPORT byte-identical — "Buy ticket" button `x:836, w:133.5, right:970`, price "$67.93" left of it, bar row `x:310 w:660` on BOTH. `EXPORT_paid_vibesandstuff.png` shows price-left / orange-button-right. |
| SC-2 | Mute pill bottom raised 14→22 (clears the details) | **PASS** (runtime) | Branch export measured `gapFromCoverBottom: 22` (pill bottom edge 22px above cover seam); PROD measured 14. |
| SC-2-pos | ORCH-1124 bottomRight position preserved (no topRight) | **PASS** (runtime) | Branch export `gapFromCoverRight: 14`, anchored to the cover's bottom edge; `audioControlPosition = "bottomRight"` default intact; no `top:` key in `audioControlBottomRight`. |
| SC-2-parity | Native gallery inherits the shared value | **PASS** (automatic) | Single shared `packages/event-rendering/EventCoverMedia.tsx` value; no per-platform branch. |
| SC-2-fires | Mute pill still FIRES (not a dead tap) | **PASS** (runtime) | Branch export: tap toggled `Sound → Mute` (`FIRED: true`). PROD also fires (Sound→Mute). `onPress` runs `setIsMuted` + `onMutedChange?.(next)` — Constitution #1 satisfied. |
| SC-G1 | ORCH-1117 non-tappable unavailable states untouched | **PASS** | Unavailable branch (`accessibilityRole="text"`, no onPress) is on a separate `cta.tappable === false` path the diff never touches; ORCH-1117 suites green (`offeringCta.orch1117`, `offeringCtaDeadTap.orch1117.adversarial`, `offeringLegibility.orch1117`). |
| SC-G2 | ORCH-1124 mute-pill firing/wiring untouched | **PASS** | Only the `bottom` value changed; onPress/position-switch untouched; firing re-proven at runtime. |

---

## 3. Findings

None at P0–P3.

**P4 (praise):**
- **P4-1** — Root-cause fix, not a patch. The defect was an empty `flex:1` placeholder `<View style={styles.priceCol} />` on the non-buy branch; the fix REMOVES it (`) : null`) and gives the sole CTA `flex:1` rather than hacking a width. Subtract-before-add (Constitution #8).
- **P4-2** — Single shared value for the mute-pill clearance (`packages/event-rendering`) means web public page + native gallery + business cover preview all inherit the 8px raise with zero parity drift. One owner.

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

Re-ran each revert by TRUE line-deletion / value-swap on the tested tree, then restored (tree returned clean each time):

| Fix reverted | Implementor test result | Restored |
|--------------|-------------------------|----------|
| Item 1 web — delete `buttonFull` style block in `mingla-business/.../FloatingOfferingBar.tsx` | `orch1128FreeCtaMutePill.test.ts` "buyer web" → **FAILS** at `expect(src).toMatch(/buttonFull:\s*{[^}]*flex:\s*1/)` (line 73) | 4/4 PASS |
| Item 1 native — delete `buttonFull` in `app-mobile/.../FloatingOfferingBar.tsx` | "consumer native" → **FAILS** at the same `buttonFull` flex:1 assertion | 4/4 PASS |
| Item 2 — `audioControlBottomRight.bottom` 22 → 14 | "mute pill clears" → **FAILS** at `expect(block).toMatch(/bottom:\s*22/)` | 4/4 PASS |

Implementor's claim independently confirmed at tested HEAD `8746b8964`.

---

## 5. Adversarial test added (tester)

**Path:** `mingla-business/src/components/offering/__tests__/orch1128FreeCtaMutePill.adversarial.test.ts` (NEW, append-only).
**Angle (distinct from implementor's existence/application checks):**
- **A1** — the full-width style must be gated STRICTLY behind `kind !== "buy"`; a regression to `=== "free"` (silently drops the waitlist kind) OR an unconditional apply is caught (asserts the guarded-apply count equals the total `styles.buttonFull` reference count). Defends the PAID split.
- **A2** — the empty `priceCol` placeholder (the actual root cause) must NOT reappear in either bar.
- **A3** — mute `bottom` parsed NUMERICALLY and asserted `> 14` (a partial bump like 16 that still bleeds also fails, not just a literal-22 mismatch), with NO `top:` key in the bottomRight block (topRight-regression guard) and `right:14` preserved.

**Result:** 6/6 PASS. **fails-on-revert verified by tester at HEAD `8746b8964`:**
- A1 — guard → `cta.kind === "free" && styles.buttonFull` → web test FAILS; restored → PASS.
- A2 — re-insert `) : ( <View style={styles.priceCol} /> )` → web test FAILS; restored → PASS.
- A3 — `bottom: 22` → `14` → numeric `>14` assertion FAILS; restored → PASS.

Both the implementor happy-path test and the tester adversarial test appear in `git diff origin/main...HEAD --name-only` for the closing branch (adversarial committed this turn). The single MODIFIED existing test (`eventCoverMedia.test.ts`, one assertion 14→22) carries `[TEST-MOD-APPROVED ORCH-1128]` in the implementor commit body AND is re-carried in the tester's HEAD commit body (append-only CI gate reads HEAD only).

---

## 6. Constitution 14-rule matrix

| # | Rule | Verdict | Evidence |
|---|------|---------|----------|
| 1 | No dead taps | PASS | Mute pill fires (Sound↔Mute) at runtime; free CTA fires `onPress`; unavailable strip is intentionally non-tappable (`role="text"`, no onPress) and untouched. |
| 2 | One owner per truth | PASS | Bar is a pure projection of `resolveOfferingCta`; mute clearance is one shared style value. |
| 3 | No silent failures | N/A | No error paths added. |
| 4 | One query key | N/A | No data layer. |
| 5 | Server state server-side | N/A | Pure presentational. |
| 6 | Logout clears | N/A | Anon-tolerant component. |
| 7 | `[TRANSITIONAL]` labels | N/A | No transitional code. |
| 8 | Subtract before adding | PASS | Empty placeholder column REMOVED (not worked around). |
| 9 | No fabricated data | N/A | No data. |
| 10 | Currency-aware | PASS (untouched) | Paid price renders `cta.price` unchanged (`$67.93` verified). |
| 11 | One auth instance | PASS | No `useAuth` in these buyer-web components. |
| 12 | Validate at right time | N/A | No datetime logic. |
| 13 | Exclusion consistency | N/A | — |
| 14 | Persisted-state startup | N/A | — |

No violations.

---

## 7. Device / parity matrix

| Surface | Verdict | Notes |
|---------|---------|-------|
| Buyer / anonymous Web | **PASS (runtime, proven)** | Free full-width + paid-unchanged + mute 22/bottomRight/fires all proven on a clean branch web export driven by Chromium. |
| Consumer iOS | PASS (source + fails-on-revert) | Identical native diff; happy-path + fails-on-revert green. Sim deferred per dispatch ("sim optional for native"); same logic shape as the runtime-proven web bar. |
| Consumer Android | PASS (source + fails-on-revert) | Same shared RN code as iOS. |
| Business iOS / Android | PASS (automatic, item 2 only) | Share `EventCoverMedia`; no offering floating bar there. |
| Admin Web | N/A | Does not import these components. |
| Business Web preview | PASS (automatic, item 2) | Shares `EventCoverMedia` cover value. |

Physical iPhone HITL: not requested by dispatch; web runtime proof obtained autonomously, so no operator-unblock ask raised.

**Environment note (resolved, not blocking):** the local `expo start --web` DEV server redboxed on a dynamic font `import()` whose relative path got mangled by the bracketed worktree dir name (`[free-cta-mute-spacing]`) — a Metro dev-server path quirk, NOT a product defect. Resolved by using a production `expo export -p web` static build instead (no dev-server dynamic-import path resolution), which rendered cleanly and yielded all the AFTER proofs above.

---

## 8. Discoveries for Orchestrator

- **D1 (confirmed, count = 5)** — `mingla-business/src/components/ui/__tests__/eventCoverMedia.test.ts` has **5 pre-existing FAILs** (event-creator upload limits / iOS-compatible image output / image-GIF-vs-video picking / playback-gating / render-failure-surfacing). Verified pre-existing: their test-block titles exist verbatim on origin/main and this ORCH only modified the unrelated bottomRight assertion body (no title changed). OUT OF SCOPE per dispatch — not fixed. Cleanup ORCH candidate.
- **D2 (new this run)** — `mingla-business/src/components/offering/__tests__/OfferingParity.test.ts` has **1 pre-existing FAIL**: "trip + experience Hub lists pass onManageOpen (3-dot opens shared sheet)". File is NOT in the ORCH-1128 diff; asserts trip/experience Hub manage-sheet source untouched by this ORCH → pre-existing. Flagging for the same cleanup ORCH as D1.

---

## 9. Accepted conditions

None — this is a clean PASS, not a CONDITIONAL.
