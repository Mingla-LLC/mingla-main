# SPEC — ORCH-1358 [social-proof-card-spacing]

**Phase:** SPEC (mingla-forensics) · **Investigation:** `investigations/INVESTIGATION_ORCH-1358-1359_GUEST_LIST_POLISH.md` (F-1)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1359-[guest-sheet-polish]` on branch `ORCH-1359-guest-sheet-polish`
**Ships with:** ORCH-1359 as ONE OTA release. **OTA-safe:** pure-JS style change, no native module.

---

## 1. Executive summary

The "See who's going" momentum card renders flush against the vibe/taxonomy pill cluster above it (screenshot "FIFA Grill Night"). Give the card a top margin so there is visible vertical breathing room between the pills and the card. The card is shared presentational code, so a single style change reaches every surface.

## 2. Scope & non-goals

**In scope:** add a `marginTop` to the shared momentum card container style in `OfferingMomentum.tsx` AND its byte-parity sibling `RsvpMomentumDecision.tsx`.
**Non-goals:** NO change to the card's internal layout, copy, colors, meter, cluster, or the pill rows themselves; NO change to any host body's pill logic; NO change to the guest sheet (that is ORCH-1359). Do not alter `marginBottom` or `padding`.
**Assumption:** a symmetric top gap equal to the existing `marginBottom: 16` gives correct vertical rhythm and is appropriate wherever the card renders (it is always a bordered, self-contained unit).

## 3. Cross-Surface Impact Declaration

| # | Surface | Covered | User-visible behavior | Files touched | Parity |
|---|---------|---------|-----------------------|---------------|--------|
| 1 | Consumer iOS | YES | Gap above the momentum card on event/trip/experience/RSVP detail. | shared package (below) | Automatic (shared) |
| 2 | Consumer Android | YES | Same. | shared package | Automatic (shared) |
| 3 | Buyer/anon Web | YES | Same gap on `/e`, `/t`, `/exp`, RSVP public pages. | shared package | **Automatic (shared)** — no web-specific edit |
| 4 | Business iOS | n/a | Business app does not render these consumer offering bodies. | — | not covered |
| 5 | Business Android | n/a | Same. | — | not covered |
| 6 | Admin Web | n/a | Not applicable. | — | not covered |
| 7 | Business Web preview | YES | Preview of an offering shows the same gap (renders the same shared bodies). | shared package | Automatic (shared) |

**Cross-surface answer (dispatch question):** the flush spacing is identical on all surfaces because the card is shared package code; the fix is one shared change and hits consumer iOS/Android + buyer-web + business-preview automatically. There is no per-surface divergence to patch.

## 4. Layered specification (Component layer only)

**File A — `packages/offering-rendering/OfferingMomentum.tsx`**
- In `StyleSheet.create({ momentum: {...} })` (currently `borderRadius:20, borderWidth:1, padding:18, marginBottom:16, overflow:"hidden"`, ~line 164-170), add `marginTop: 16`.
- Illustrative (do not copy verbatim without matching surrounding keys): `momentum: { ..., marginTop: 16, marginBottom: 16, overflow: "hidden" }`.

**File B — `packages/offering-rendering/RsvpMomentumDecision.tsx`**
- In `StyleSheet.create({ momentum: {...} })` (~line 683-688, byte-identical to File A's `momentum`), add the SAME `marginTop: 16`. This preserves the documented byte-parity between the two cards (`OfferingMomentum.tsx:159-162`).

No other layers (DB/edge/service/hook/realtime) are involved.

## 5. Success criteria

- **SC-1:** On a ticketed event detail (e.g. "FIFA Grill Night"), the momentum card has a visible gap (16px) between the bottom of the pill cluster and the top border of the card. Observable on Consumer iOS + Android.
- **SC-2:** The same gap appears on trip and experience detail cards (shared `OfferingMomentum`) and on the RSVP detail card (`RsvpMomentumDecision`).
- **SC-3-Web:** Buyer-web (`mingla-business` `/e/{brandSlug}/{eventSlug}`) and business-preview render the same gap with no additional edit.
- **SC-4:** No regression to the card's internal spacing, the meter, the cluster, or the "See who's going" row; `marginBottom: 16` and `padding: 18` unchanged.

## 6. Invariants

- **Preserve** `I-PROPOSED-1339-CROSS-ENTITY-HONEST-MOMENTUM` (ACTIVE) — no copy/gate change, only outer margin.
- **Preserve** the byte-parity note between `OfferingMomentum.momentum` and `RsvpMomentumDecision.momentum` by applying the identical value to both.
- No new invariant proposed (cosmetic).

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-1 | Card top margin present | render `OfferingMomentum` | `styles.momentum.marginTop === 16` | component (jest, style introspection) |
| T-2 | RSVP card parity | render `RsvpMomentumDecision` | `styles.momentum.marginTop === 16` | component |
| T-3 | No bottom-margin regression | both cards | `marginBottom === 16` unchanged | component |

## 8. Implementation order

1. Edit `OfferingMomentum.tsx` `momentum` style (add `marginTop: 16`).
2. Edit `RsvpMomentumDecision.tsx` `momentum` style (add `marginTop: 16`).
3. Add/extend the regression test (Section 9).

## 9. Regression prevention (fails-on-revert)

Add a jest assertion (in `packages/offering-rendering/__tests__/`, e.g. extend `orch_1339_momentum_cross_entity.test.ts` or a new `orch_1358_card_spacing.test.ts`) that reads the compiled `momentum` style from BOTH components and asserts `marginTop === 16`. It MUST fail if either `marginTop` is removed (revert) and pass when restored. Carry a protective comment: `// ORCH-1358 — momentum card needs top breathing room from the pill cluster; do not remove marginTop.`

## 10. Open questions

None. (Value `16` chosen for symmetry with the existing `marginBottom: 16`; if Seth wants a larger gap, it is a one-number change — flag at review, not a blocker.)

## 11. Downstream routing

Next = **mingla-implementor** (consumer side), same worktree, batched with ORCH-1359. Then mingla-tester (visual check on iOS/Android + one web spot-check), then orchestrator CLOSE (single OTA per-platform + the additive migration from ORCH-1359).

## Allowlist (implementor may touch)

- `packages/offering-rendering/OfferingMomentum.tsx` (momentum style only)
- `packages/offering-rendering/RsvpMomentumDecision.tsx` (momentum style only)
- `packages/offering-rendering/__tests__/orch_1358_card_spacing.test.ts` (new) OR an added assertion block in `orch_1339_momentum_cross_entity.test.ts`

## DO-NOT-TOUCH

- The pill rows / `pillsRow` styles in any body (fix belongs on the card, not the pills).
- Any card copy, meter, cluster, `GuestAvatarCluster`, or gate logic.
- The guest sheet (ORCH-1359 owns it).
- `padding`, `marginBottom`, `borderRadius`, `borderWidth` on the card.
