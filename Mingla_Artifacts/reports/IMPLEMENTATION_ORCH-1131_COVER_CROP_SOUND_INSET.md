# IMPLEMENTATION — ORCH-1131 — Get-tickets cover crop + public-event Sound-pill edge clearance

- **ORCH-ID:** ORCH-1131
- **Class:** S3 · ux + design-debt
- **Working tree:** `~/Desktop/mingla-orchs/ORCH-1131-[cover-crop-sound-inset]/` on branch `ORCH-1131-cover-crop-sound-inset`
- **Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-1131_COVER_CROP_SOUND_INSET.md` (binding contract)
- **Commit:** `116603b66`
- **Status:** implemented and verified (web live-fire on the faithful render path; native parity automatic via the shared package)

---

## 1. Summary

Two value-only, low-risk buyer-facing polish fixes, exactly per spec, no scope widening:

- **FIX 1 — checkout mini-card cover crop.** The Get-tickets "mini-card" cover renders into a 64pt band via `EventCoverMedia` (fills `contentFit:"cover"`). A portrait (1080×1920) cover video was sliced to an unrecognizable mid-frame strip. Raised the band to **120pt** (kept `"cover"`, kept rounded corners + bottom margin) on **all three** checkout routes (event / trip / experience — OQ-1 all-three scope, Seth-confirmed 2026-06-12).
- **FIX 2 — public-event Sound-pill edge clearance.** The shared `EventCoverMedia` `audioControlBottomRight` pill sat at `right:14`, protruding ~2px past the public-event floating X/share chrome column (`right: spacing.md = 16`). Set the pill to **`right:16`** so its right edge aligns to the chrome column. `bottom:22` (ORCH-1128) preserved verbatim.

---

## 2. SPEC success-criteria coverage

| SC | Description | Status | Satisfied by (commit `116603b66`) |
|----|-------------|--------|-----------------------------------|
| SC-1-Web | FIX 1 event checkout: 120pt band, portrait cover recognizable, rounded corners, no letterbox | ✓ | `mingla-business/app/checkout/[eventId]/index.tsx` `miniCover.height=120`; evidence `04-fix1-after-committed.png` |
| SC-2-Web | FIX 1 landscape regression: clean cover fill, no distortion | ✓ (kept `contentFit:"cover"`, no `contain`) | unchanged fill mode; only band height raised |
| SC-3 | FIX 1 OQ-1: trip + experience checkout 120pt band | ✓ | `checkout-trip/[tripEventId]/index.tsx` + `checkout-experience/[experienceEventId]/index.tsx` `miniCover.height=120` |
| SC-4-Web | FIX 2 public hero: pill right edge aligns to chrome column (both 16px from hero edge); clearance to screen edge | ✓ | `packages/event-rendering/EventCoverMedia.tsx` `audioControlBottomRight.right=16`; measured `chromeRightGap=16 == pillRightGap=16` (`aligned:true`); evidence `06-fix2-after-committed.png` |
| SC-5-iOS / SC-5-Android | FIX 2 parity: consumer native + expandedCard + business authoring previews render pill at `right:16`, no clipping | ✓ (automatic — shared package, single `bottomRight` style) | same shared style change; no per-surface code |
| SC-6 | No global regression: list/grid/deck still crop-to-fill (`videoContentFit:"cover"` unchanged); hero still aspect-adaptive | ✓ | `videoContentFit = "cover"` default untouched (line 382); PublicEventPage hero untouched |

---

## 3. Files changed

| File | Change | Δ lines |
|------|--------|---------|
| `packages/event-rendering/EventCoverMedia.tsx` | `audioControlBottomRight.right` 14→16 + protective comment | +9 / −1 |
| `mingla-business/app/checkout/[eventId]/index.tsx` | `miniCover.height` 64→120 + comment | +7 / −1 |
| `mingla-business/app/checkout-trip/[tripEventId]/index.tsx` | `miniCover.height` 64→120 + comment | +7 / −1 |
| `mingla-business/app/checkout-experience/[experienceEventId]/index.tsx` | `miniCover.height` 64→120 + comment | +7 / −1 |
| `mingla-business/__tests__/orch1131CoverCropSoundInset.test.ts` | NEW happy-path regression test (5 assertions) | +80 |

Net: 5 files, +106 / −4. Only allowlisted values changed (per spec §11 scoped allowlist). No DO-NOT-TOUCH file touched.

Evidence (untracked → staged with report): `Mingla_Artifacts/evidence/ORCH-1131/{03,04,05,06}-*.png` + `livefire.cjs` (new before/after harness), alongside the forensics repro `01/02-*.png` + `repro.html` + `shoot.cjs`.

---

## 4. Data-model changes applied

None. Component-layer only. No DB / RLS / migration / edge / service / hook / realtime change.

## 5. Edge functions touched

None.

---

## 6. Regression tests added

- **Path:** `mingla-business/__tests__/orch1131CoverCropSoundInset.test.ts` (5 assertions; source-introspection following the `BusinessWelcomeScreenLogoAdversarial.test.tsx` precedent — extracts the live `property: value` from the StyleSheet block, comment-proof).
  - FIX 1: `miniCover.height === 120` for all three checkout routes (event / trip / experience).
  - FIX 2: `audioControlBottomRight.right === 16` and `bottom === 22` (the latter guards ORCH-1128 from collateral regression).
- **Passing run (committed state `116603b66`):**
  ```
  Test Suites: 1 passed, 1 total
  Tests:       5 passed, 5 total
  ```
- **fails-on-revert verified at `116603b66`** via TRUE LINE DELETION (not comment-out): deleted `height: 120` from all three checkout `miniCover` blocks and `right: 16` from `audioControlBottomRight`, re-ran →
  ```
  Tests:       4 failed, 1 passed, 5 total
  ✕ checkout/[eventId] miniCover.height === 120     (extracted null)
  ✕ checkout-trip miniCover.height === 120          (extracted null)
  ✕ checkout-experience miniCover.height === 120    (extracted null)
  ✕ right === 16                                     (extracted null)
  ✓ bottom === 22  (correctly still passes — bottom:22 was NOT deleted)
  ```
  Restored the fix lines via `git checkout -- <files>` → 5/5 PASS again. The `bottom:22` assertion staying green while the four fix-guarding assertions fail proves the test exercises exactly the changed values.
- **Append-only:** new file only; no existing test modified or deleted. Ships in the same branch/commit as the fix (`git show --stat HEAD` lists all 5 files).

---

## 7. Old → New receipts

### packages/event-rendering/EventCoverMedia.tsx
- **Before:** `audioControlBottomRight { right: 14, bottom: 22 }` — Sound pill protruded ~2px past the public-event floating chrome column (`right:16`).
- **Now:** `right: 16` (`=== spacing.md`, raw literal matching the file's convention), `bottom: 22` preserved. Pill right edge aligns to the chrome column.
- **Why:** SC-4 / FIX 2. Shared style → parity is automatic across consumer native event view, expandedCard ImageGallery, and business authoring previews.
- **Lines:** +9 / −1 (comment heavy; one functional value).

### mingla-business/app/checkout/[eventId]/index.tsx (and -trip, -experience, byte-identical)
- **Before:** `miniCover { height: 64, … }` — a 64pt band sliced a portrait cover video to an unrecognizable mid-frame strip.
- **Now:** `height: 120` (kept `contentFit:"cover"`, `borderRadius`, `marginBottom`).
- **Why:** SC-1 / SC-3 / FIX 1. Did NOT switch to `contain` (spec §4 / §10: pillarbox bars read as broken on the dark card).
- **Lines:** +7 / −1 each.

---

## 8. Cross-surface impact table

| # | Surface | Affected | What changes | Parity |
|---|---------|----------|--------------|--------|
| 1 | Consumer iOS (`app-mobile/`) | FIX 2 only | Sound pill on native event view + expandedCard ImageGallery +2px right inset (cosmetic) | Automatic (shared package) |
| 2 | Consumer Android | FIX 2 only | Same as iOS | Automatic |
| 3 | Buyer/anon Web (`mingla-business/`) | **FIX 1 + FIX 2** | Checkout cover recognizable; public Sound pill clears edge | FIX 1 manual per-route (3 routes done); FIX 2 automatic |
| 4 | Business iOS (`mingla-business/`) | FIX 2 incidental | Authoring cover previews pill +2px right (improves alignment) | Automatic |
| 5 | Business Android | FIX 2 incidental | Same | Automatic |
| 6 | Admin Web (`mingla-admin/`, adjacent) | Not affected | Admin renders neither the pill nor the checkout mini-card | n/a |
| 7 | Business Web preview (adjacent) | FIX 2 incidental | Same shared shift | Automatic |

FIX 2 lands on every `bottomRight` `EventCoverMedia` consumer at once; in every case it is +2px of right inset that improves edge clearance (no consumer relies on `right:14`). Safe.

---

## 9. Smoke / live-fire result

Web live-fire on the faithful `EventCoverMedia` web render path (container `overflow:hidden` + media `absoluteFill` `objectFit:cover` — identical render primitives to the buyer web build, per spec Appendix). The new harness `Mingla_Artifacts/evidence/ORCH-1131/livefire.cjs` (Playwright chromium, DPR 2) parses the **actual committed source values** from `index.tsx`/`EventCoverMedia.tsx` and renders before/after for both fixes:

```
parsedFromCommittedSource: { miniCoverHeight: 120, pillRight: 16, pillBottom: 22 }
measuredAfter: { chromeRightGap: 16, pillRightGap_after: 16, pillToScreenEdgeClearance_px: 16 }
aligned: true
```

- **FIX 1** `03-fix1-before-64.png` (sliver — only "DAYS" mid-band) vs `04-fix1-after-committed.png` (120pt — "DAYS / of summer" + more of the portrait visible, rounded corners, no letterbox). Recognizable. SC-1/SC-2/SC-3 confirmed.
- **FIX 2** `05-fix2-before-right14.png` (pill right edge protrudes ~2px past the red chrome guide) vs `06-fix2-after-committed.png` (pill right edge flush on the chrome column at 16px). `aligned: true`. SC-4 confirmed.

Rationale for the render-harness live-fire over booting the full `expo start --web` authenticated buyer funnel: this is a pure layout/CSS value contract; the render primitives (`overflow:hidden` clip + `objectFit:cover` media + absolute-positioned pill) are identical, and the harness renders the EXACT committed source values (parsed at runtime), so the screenshot proves the shipped code. Spec Appendix explicitly states the full funnel "adds no information for a pure layout/CSS contract."

**Evidence paths:**
- `Mingla_Artifacts/evidence/ORCH-1131/03-fix1-before-64.png`
- `Mingla_Artifacts/evidence/ORCH-1131/04-fix1-after-committed.png`
- `Mingla_Artifacts/evidence/ORCH-1131/05-fix2-before-right14.png`
- `Mingla_Artifacts/evidence/ORCH-1131/06-fix2-after-committed.png`
- `Mingla_Artifacts/evidence/ORCH-1131/livefire.cjs` (harness)
- (forensics repro) `01-repro-full.png`, `02-fix1-current-crop.png`, `repro.html`, `shoot.cjs`

---

## 10. Gate results

| Gate | Result |
|------|--------|
| `node .github/scripts/strict-grep/orch-0978-video-autoplay-muted-contract.mjs` | **PASS** (exit 0) — muted/autoplay contract + package export intact |
| Package isolation (I-MOR-0827) | **PASS** — `import` count unchanged (7→7) in EventCoverMedia; raw literal `16`, no new token import |
| ESLint (3 checkout routes + test) | **0 errors** (2 pre-existing unused-import warnings: `useMemo` in -trip, `LiveEvent` in event — neither introduced by ORCH-1131) |
| `npx tsc --noEmit` (mingla-business) | 263 errors — **identical count on the clean base (origin/main)**, all `Cannot find module 'react'` cascade from running standalone `tsc` against `packages/` (pre-existing workspace resolution quirk; CI uses scoped jest, not full-workspace tsc). **Zero new errors introduced by ORCH-1131.** |
| jest `orch1131CoverCropSoundInset.test` | **5/5 PASS** at `116603b66`; **4 FAIL on line-deletion revert** |

---

## 11. Invariant preservation

| Invariant | Preserved? | Evidence |
|-----------|-----------|----------|
| `orch-0978-video-autoplay-muted-contract` | Y | strict-grep PASS; no change to muted default / web video branch / export |
| I-MOR-0827-PACKAGE-ISOLATION | Y | no new import; raw literal `16` |
| ORCH-1128 pill `bottom:22` | Y | preserved verbatim; test asserts `bottom===22` |
| ORCH-1124 pill `bottomRight` position | Y | position prop + style selection unchanged |
| `videoContentFit:"cover"` default (SC-6) | Y | line 382 `videoContentFit = "cover"` untouched |
| `audioControlTopLeft`/`TopRight` insets | Y | both still `14` (left:14/top:14, right:14/top:14) |

No new invariants proposed (per spec §6 — values, not structural contracts; the jest assertion covers recurrence).

---

## 12. Known issues / deferred

- None. No `[TRANSITIONAL]` code. No deferred scope.
- Native FIX-2 parity (consumer iOS/Android + business authoring previews) is automatic via the shared package; not separately device-captured this turn (cosmetic +2px, no logic path). Tester may device-spot-check per spec §7 adversarial angles.

---

## 13. Operator action required

- **Migration `db push`:** none (no migration).
- **Edge-function deploy:** none.
- **OTA:** FIX 2 is a shared-package change reaching `app-mobile/` consumers; an OTA is needed to ship the +2px native pill nudge to consumer/business apps (per `project_ota_deferred_until_new_build` this is pure-JS → `eas update`, not a native build). Orchestrator/operator decides at CLOSE; deploy from MERGED main, not this worktree.
- **Route next:** mingla-orchestrator REVIEW → mingla-tester (SC-1..SC-6 + adversarial angles §7) → CLOSE.

---

## 14. Discoveries for Orchestrator

- **Comms ledger:** ORCH-1131 touches zero `supabase/functions/`, zero migrations, zero deploy → COMMS-0002 (backend strict-grep allowlist) and COMMS-0018 (merged-main-source) are FYI-only for this ORCH (no allowlist entry needed; nothing to deploy). COMMS-0029 (biz_update_live_trip migration clobber) is N/A. None require an ack action from this ORCH.
- **zsh glob hazard (process note):** `git add` / `git checkout` of the bracketed expo-router paths (`app/checkout/[eventId]/index.tsx`) silently no-op under zsh glob expansion unless single-quoted with `--`. The initial commit captured only the test file; caught via `git show --stat` and corrected with `git add -- '…'`. No impact on the final commit (all 5 files verified present in `116603b66`). Flagging for any future implementor editing bracketed route files in this monorepo.
- No unrelated bugs found in the touched files.
