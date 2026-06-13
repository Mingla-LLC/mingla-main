# SPEC — ORCH-1133 [revert checkout cover to original compact band + give the public-event Sound pill clearance from the details section]

**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1133-[revert-cover-pill-bottom]/` on branch `ORCH-1133-revert-cover-pill-bottom`
**Base:** origin/main `907b2b2a0`.
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1133_REVERT_COVER_PILL_BOTTOM.md` (PROVEN, buyer-web live-fire).
**Round 3** of the cover/pill saga (ORCH-1128 → 1131 → 1132 → 1133).

---

## 1. Executive summary

Two tightly-scoped changes:

1. **REVERT** the three Get-tickets checkout mini-card covers to the TRUE pre-ORCH-1131 original — a fixed `height: 64` compact band with the component's default cover-fill — undoing ORCH-1131 (64→120) AND ORCH-1132 (adaptive full-frame). Seth: "The get tickets page now looks awful, revert. The cover fills the entire screen. Revert to original."
2. **MOVE** the shared public-event Sound pill DOWN-anchor from `bottom: 22` to `bottom: 40` so it clears the blue details panel by a visible +12px (measured), while KEEPING `right: 24`. Seth: "The sound button still needs some space or padding from the details section."

This is NOT a `git revert` of ORCH-1131/1132 — only the cover/miniCover code reverts; the pill's `right: 24` is preserved.

---

## 2. Scope & non-goals

**In scope (product code):**
- `miniCover` style + `<EventCoverMedia>` JSX + cover-aspect state in the 3 checkout files → restored to `e90875dda~1` original.
- `audioControlBottomRight.bottom` in `packages/event-rendering/EventCoverMedia.tsx`: `22 → 40`.

**In scope (tests):** update the 6 jest files that pin the changed values to the round-3 values, with `[TEST-MOD-APPROVED ORCH-1133]` in the LATEST commit body (see §9).

**Non-goals / DO-NOT-TOUCH:**
- `audioControlBottomRight.right` stays `24` (Seth satisfied with right-edge clearance).
- The public-event HERO cover rendering (`PublicEventPage.tsx` `heroBox`, the hero `aspectRatio` clamp, `bodyContent.marginTop`) — UNCHANGED.
- The consumer deck card (`SwipeableCards.tsx`, `showAudioControl={false}`) — UNCHANGED.
- `audioControlTopLeft` / `audioControlTopRight` insets — UNCHANGED.
- The unrelated `eventCoverMedia.test.ts` cover-picker-copy failures (DISC-2) — NOT addressed here.

**Assumptions:** `radiusTokens` + `spacing` imports remain present in all 3 checkout files post-revert (verified: each still has 2 `radiusTokens` refs via `miniCover.borderRadius` + elsewhere).

---

## 3. Cross-Surface Impact Declaration

| # | Surface | Covered | User-visible behavior | Files touched here | Parity |
|---|---------|---------|------------------------|--------------------|--------|
| 1 | Consumer iOS | YES (shared pill only) | gallery Sound pill moves +18px up on full-bleed slide; benign | `EventCoverMedia.tsx` (shared) | automatic (shared) |
| 2 | Consumer Android | YES (shared pill only) | same | same | automatic |
| 3 | Buyer/anon Web | YES | 3 checkout covers → compact 64px band; `/e/*` Sound pill clears details panel by +12px | 3 checkout files + `EventCoverMedia.tsx` | automatic (web export of same RN) |
| 4 | Business iOS | YES (checkout cover) | compact 64px cover band restored | 3 checkout files | automatic |
| 5 | Business Android | YES (checkout cover) | same | same | automatic |
| 6 | Admin Web | NO — no consumer of these files | — | — | — |
| 7 | Business Web preview (authoring) | YES (shared pill only) | preview Sound pill +18px up on full-bleed preview; benign | `EventCoverMedia.tsx` (shared) | automatic |

Cross-consumer safety: PROVEN benign (investigation F-6). A 36px pill at `bottom:40` only clips off a cover box < 76px tall; every consumer renders a full-bleed cover ≥ ~200px tall, and only the public hero has a bottom panel (the surface being fixed).

---

## 4. Layered specification (Component layer only — pure RN style/JSX)

### 4.1 CHANGE 1 — revert all 3 checkout covers to the `e90875dda~1` original

For EACH of the three files, apply the per-file before/after below. All three end in the IDENTICAL `miniCover` block and a plain `<EventCoverMedia … style={styles.miniCover} />` (no aspect props).

#### File A — `mingla-business/app/checkout/[eventId]/index.tsx`

**(A1) Remove the cover-aspect state (current lines ~83–88):**
```
BEFORE:
  // ORCH-1132 — full-frame (no-crop) checkout cover. Drive the mini-card box's
  // aspectRatio to the cover media's real shape via onAspectRatio, paired with
  // videoContentFit="contain", so the WHOLE frame shows (a portrait subject's
  // head is never cropped). 0.75 = portrait-ish first paint; clamp 0.6..1.91.
  const [coverAspect, setCoverAspect] = useState(0.75);
  const clampedCoverAspect = Math.min(Math.max(coverAspect, 0.6), 1.91);

AFTER:
  (delete all six lines)
```
**(A2) KEEP the React import as-is** — `import React, { useCallback, useState } from "react";` (the event file's `waitlistTicketId` still uses `useState`, line 81). DO NOT remove `useState` here.

**(A3) Restore the plain EventCoverMedia JSX (current lines ~248–257):**
```
BEFORE:
          <EventCoverMedia
            hue={event.coverHue}
            mediaUrl={event.coverMediaUrl}
            mediaType={event.coverMediaType}
            radius={0}
            label=""
            onAspectRatio={setCoverAspect}
            videoContentFit="contain"
            style={[styles.miniCover, { aspectRatio: clampedCoverAspect }]}
          />

AFTER:
          <EventCoverMedia
            hue={event.coverHue}
            mediaUrl={event.coverMediaUrl}
            mediaType={event.coverMediaType}
            radius={0}
            label=""
            style={styles.miniCover}
          />
```
**(A4) Restore the miniCover style (current lines ~353–362):**
```
BEFORE:
  miniCover: {
    // ORCH-1132 — full-frame, no crop. … (6 comment lines) …
    borderRadius: radiusTokens.md,
    marginBottom: spacing.sm,
  },

AFTER:
  miniCover: {
    height: 64,
    borderRadius: radiusTokens.md,
    marginBottom: spacing.sm,
  },
```

#### File B — `mingla-business/app/checkout-trip/[tripEventId]/index.tsx`

**(B1)** Delete the cover-aspect state (current ~135–139, same 4-comment + 2 const lines).
**(B2) Drop `useState` from the React import** — original was `import React, { useCallback, useMemo } from "react";`. Change current `import React, { useCallback, useMemo, useState } from "react";` → `import React, { useCallback, useMemo } from "react";` (coverAspect is the sole `useState` user here).
**(B3)** Restore the JSX (current ~310–321) to the plain form — same as A3 but with the trip's props:
```
AFTER:
          <EventCoverMedia
            hue={0}
            mediaUrl={trip.coverMediaUrl}
            mediaType={
              trip.coverMediaType as "image" | "video" | "gif" | null
            }
            radius={0}
            label=""
            style={styles.miniCover}
          />
```
**(B4)** Restore `miniCover` (current ~438–447) to `{ height: 64, borderRadius: radiusTokens.md, marginBottom: spacing.sm }`.

#### File C — `mingla-business/app/checkout-experience/[experienceEventId]/index.tsx`

**(C1)** Delete the cover-aspect state (current ~99–103).
**(C2) Drop `useState` from the React import** — original was `import React, { useCallback } from "react";`. Change current `import React, { useCallback, useState } from "react";` → `import React, { useCallback } from "react";`.
**(C3)** Restore the JSX (current ~252–261) to the plain form with the experience's props:
```
AFTER:
          <EventCoverMedia
            hue={0}
            mediaUrl={experience.coverMediaUrl}
            mediaType={experience.coverMediaType}
            radius={0}
            label=""
            style={styles.miniCover}
          />
```
**(C4)** Restore `miniCover` (current ~339–348) to `{ height: 64, borderRadius: radiusTokens.md, marginBottom: spacing.sm }`.

> The implementor MAY equivalently `git show 'e90875dda~1:<file>'` and copy the exact original `miniCover` block + JSX call verbatim, then re-apply only the import deltas above. The end state MUST equal `e90875dda~1` for these regions.

### 4.2 CHANGE 2 — Sound pill bottom inset `22 → 40`

`packages/event-rendering/EventCoverMedia.tsx`, `audioControlBottomRight` (current lines ~606–620):
```
BEFORE:
    right: 24,
    // ORCH-1128 — 14 → 22: clears the cover seam …
    bottom: 22,

AFTER:
    right: 24,
    // ORCH-1133 — 22 → 40: round-3 clearance from the public-event details panel.
    // The blue details panel (PublicEventPage `bodyContent`, marginTop:-28) sits
    // 28px above the hero bottom; at bottom:22 the pill overlapped the panel top
    // by 6px (measured on buyer web). bottom:40 = 28 + 12px visible gap (live-
    // verified +12.0px on /e/leggothis/vibes-and-stuff & /a-life-in-vegas).
    // Shared style → also lifts the consumer gallery + authoring-preview pills
    // +18px on their full-bleed covers (benign; ≥200px boxes, no panel below).
    bottom: 40,
```
KEEP `right: 24`. KEEP `minHeight: 36`. Do NOT add a `top:` key. Do NOT touch `audioControlTopLeft` / `audioControlTopRight`.

---

## 5. Success criteria

- **SC-1 (Web):** On `/e/{brandSlug}/{eventSlug}` with a video cover, the Sound pill's bottom edge sits ≥ 10px ABOVE the blue details panel top edge (target +12px). Verify by Playwright measure on `…/e/leggothis/vibes-and-stuff`: `panelTop − pillBottom ≥ 10`.
- **SC-2-iOS / SC-2-Android / SC-2-Web (checkout cover):** Each of `/checkout/{eventId}`, `/checkout-trip/{tripEventId}`, `/checkout-experience/{experienceEventId}` shows a fixed 64px-tall compact cover band (NOT a full-screen/ballooned cover) for a portrait video cover. The `miniCover` block declares `height: 64`.
- **SC-3:** The 3 checkout files contain NO `coverAspect`, `setCoverAspect`, `clampedCoverAspect`, `onAspectRatio`, `videoContentFit`, or inline `aspectRatio` in the cover path; the `<EventCoverMedia>` cover call is the plain 6-prop form (`hue`, `mediaUrl`, `mediaType`, `radius`, `label`, `style`).
- **SC-4:** `trip` + `experience` React imports no longer include `useState`; the `event` import still does. `tsc`/lint clean (no unused-import).
- **SC-5:** `audioControlBottomRight` = `{ right: 24, bottom: 40 }`; `right` unchanged at 24; `audioControlTopLeft`/`audioControlTopRight` unchanged at 14.
- **SC-6 (cross-consumer):** On a full-bleed consumer/authoring cover the pill remains fully on-screen, not behind top chrome (no regression). Verified by render (no off-screen pill at `bottom:40`).
- **SC-7 (tests):** The 6 in-scope jest files PASS against the round-3 values (see §7), with the append-only override token present (§9).

---

## 6. Invariants
- **I-1128 (Sound pill clears the cover seam):** PRESERVED + strengthened (22→40 widens clearance). The updated regression test (`bottom: 40`) is the durable guard.
- No new invariant proposed.

---

## 7. Test cases / regression-test update plan

The implementor MUST end with all 6 files GREEN. Three are RED on current main (pre-existing ORCH-1132 drift — investigation DISC-1); fixing them is part of this update.

| File | Current assertion | New assertion | Action |
|------|-------------------|---------------|--------|
| `mingla-business/__tests__/orch1131CoverCropSoundInset.test.ts` | FIX1: miniCover NO height + `videoContentFit="contain"` + `onAspectRatio=`; FIX2 `right===24`, `bottom===22` | revert FIX1 → assert miniCover `height===64` AND the call has NO `videoContentFit`/`onAspectRatio`; FIX2 `right===24` (keep), `bottom===40` | MODIFY (deletes lines) → token required |
| `mingla-business/__tests__/orch1131SiblingInsetNonRegressionAdversarial.test.ts` | `bottomRight` `right [24]` / `bottom [22]`; topLeft/topRight [14]; heroBox no height | `right [24]` keep, `bottom [40]`; topLeft/topRight/heroBox UNCHANGED | MODIFY (deletes line) → token required |
| `mingla-business/__tests__/orch1132ClampMathHeroIsolationAdversarial.test.ts` | extracts + executes the checkout `Math.min(Math.max(...))` clamp; SC-6 isolation; SC-7 default | subject (checkout clamp) is REMOVED → `extractClamp` throws → file invalid | **DELETE the file** → token required (deletion) |
| `mingla-business/src/components/ui/__tests__/eventCoverMedia.test.ts` (pill test only, lines 362–372) | slice asserts `right: 14` + `bottom: 22` (both stale; currently RED) | assert `right: 24` + `bottom: 40`; WIDEN the slice (parse the `audioControlBottomRight` block, not a fixed 400-char window) | MODIFY (deletes lines) → token required. DO NOT touch the unrelated cover-picker-copy tests (DISC-2). |
| `mingla-business/src/components/offering/__tests__/orch1128FreeCtaMutePill.test.ts` (line 91–97) | `/bottom:\s*22/` (currently RED — comment bloat) | `/bottom:\s*40/`; widen the slice so `bottom:` is in window | MODIFY (deletes line) → token required |
| `mingla-business/src/components/offering/__tests__/orch1128FreeCtaMutePill.adversarial.test.ts` (line 115–134) | numeric `bottom > 14` (currently NULL → RED) + `right:\s*14` (stale) | parse the full `audioControlBottomRight` block (widen window), assert `bottom > 14` (40 passes) + `right:\s*24`; keep "no `top:` key" | MODIFY (deletes line) → token required |

**Token requirement:** because every modified test file deletes ≥1 line (and one is deleted outright), the LATEST commit body that lands these test changes MUST contain `[TEST-MOD-APPROVED ORCH-1133]` (regex `/\[TEST-MOD-APPROVED (?:META-)?ORCH-\d{4}(?:-[A-Z])?\]/`, checked by `.github/scripts/test-append-only-check.js`). One token in the final commit body covers all of them. Cite WHY in the body: "ORCH-1131/1132 cover+pill values reverted/superseded per Seth round-3 reject; the prior assertions are now wrong."

**fails-on-revert (required):** the updated `orch1131CoverCropSoundInset.test.ts` MUST FAIL if a future change re-adds `height: 120` / adds back `videoContentFit="contain"` / reverts `bottom` to 22, and PASS at `height:64`/`bottom:40`. The implementor proves this by hand-mutating the product code and showing red→green (record in the implementation report).

**Recommended hardening (DISC-1):** replace the brittle fixed-`400`-char slices in `eventCoverMedia.test.ts` + both `orch1128` files with a proper `audioControlBottomRight: { … }` block extraction (same helper the 1131 tests use), so future comment-length changes can't re-NULL the parse.

---

## 8. Implementation order
1. CHANGE 1 — revert the 3 checkout covers (File A, B, C: state delete → import delta → JSX → miniCover).
2. CHANGE 2 — `EventCoverMedia.tsx` `bottom: 22 → 40`.
3. Update the 6 test files to the §7 round-3 values (incl. deleting `orch1132ClampMathHeroIsolationAdversarial.test.ts`).
4. Run `tsc`/lint on the 3 checkout files + `npx jest` on the 6 files → all GREEN.
5. Prove fails-on-revert; record in implementation report.
6. Commit with `[TEST-MOD-APPROVED ORCH-1133]` in the body.

---

## 9. Regression prevention
- Structural safeguard: `orch1131CoverCropSoundInset.test.ts` (source-introspection, comment-proof) pins `miniCover.height===64` + `audioControlBottomRight.bottom===40` + `right===24` — re-introducing the ORCH-1131/1132 cover or reverting the pill makes it FAIL.
- Protective comment in `audioControlBottomRight` explains the 28px panel overlap + the 12px target gap (the "why") so a future "tidy" doesn't drop it back.
- Append-only gate forces an explicit, ORCH-cited override for any future change to these pinned values.

---

## 10. Open questions
- **OQ-1:** `bottom: 40` (+12px gap) is recommended. If Seth wants MORE air, `bottom: 44` (+16px = `spacing.md` gap) is the live-verified alternative. Default to 40 unless Seth says otherwise.

---

## 11. Downstream routing
Next = **mingla-implementor** (worktree `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1133-[revert-cover-pill-bottom]/`, branch `ORCH-1133-revert-cover-pill-bottom`). Then **mingla-tester** (buyer-web Playwright measure of SC-1 + checkout-cover render SC-2 + the 6-file jest gate). Then **mingla-orchestrator** CLOSE.

### Allowlist (implementor MAY change ONLY these)
- `mingla-business/app/checkout/[eventId]/index.tsx`
- `mingla-business/app/checkout-trip/[tripEventId]/index.tsx`
- `mingla-business/app/checkout-experience/[experienceEventId]/index.tsx`
- `packages/event-rendering/EventCoverMedia.tsx` (ONLY `audioControlBottomRight.bottom`)
- `mingla-business/__tests__/orch1131CoverCropSoundInset.test.ts`
- `mingla-business/__tests__/orch1131SiblingInsetNonRegressionAdversarial.test.ts`
- `mingla-business/__tests__/orch1132ClampMathHeroIsolationAdversarial.test.ts` (DELETE)
- `mingla-business/src/components/ui/__tests__/eventCoverMedia.test.ts` (pill test only)
- `mingla-business/src/components/offering/__tests__/orch1128FreeCtaMutePill.test.ts`
- `mingla-business/src/components/offering/__tests__/orch1128FreeCtaMutePill.adversarial.test.ts`

### DO-NOT-TOUCH
- `audioControlBottomRight.right` (stays 24), `audioControlTopLeft`/`audioControlTopRight`.
- `packages/event-rendering/PublicEventPage.tsx` (hero `heroBox`, hero clamp, `bodyContent.marginTop`).
- `app-mobile/src/components/SwipeableCards.tsx` (consumer deck card).
- The unrelated `eventCoverMedia.test.ts` cover-picker-copy tests (DISC-2) and any other test file.
- Any product file outside the 4 allowlisted product files.

Stop-and-amend before touching anything outside the allowlist.
