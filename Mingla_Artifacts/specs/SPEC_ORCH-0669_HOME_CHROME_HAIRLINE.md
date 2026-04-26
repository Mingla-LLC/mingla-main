# SPEC — ORCH-0669: Home + Bottom-nav Chrome Hairline Tune

**Status:** READY FOR IMPLEMENTOR DISPATCH
**Author:** mingla-forensics (SPEC mode)
**Date:** 2026-04-25
**Severity:** S2-medium (cosmetic; first-impression damage on every Home render)
**Type:** design-debt / ux

**Investigation input:** [Mingla_Artifacts/reports/INVESTIGATION_ORCH-0669_HOME_HEADER_GLASS_EDGES.md](Mingla_Artifacts/reports/INVESTIGATION_ORCH-0669_HOME_HEADER_GLASS_EDGES.md)
**Spec dispatch:** [Mingla_Artifacts/prompts/SPEC_ORCH-0669_HOME_CHROME_HAIRLINE.md](Mingla_Artifacts/prompts/SPEC_ORCH-0669_HOME_CHROME_HAIRLINE.md) (§0 founder-locked: SCOPE = all 5 consumers, DIRECTION = alpha 0.12 → 0.06)

---

## §1 — Context (V5 history acknowledgment per D-1)

The current `glass.chrome.border.hairline` token at `'rgba(255, 255, 255, 0.12)'` is the L4 layer of the SPEC_ORCH-0589 5-layer glass stack (L1 BlurView · L2 tint floor · ~~L3 top highlight~~ · L4 hairline border · L5 drop shadow). The L3 top-highlight was deleted by ORCH-0589 v4 (V5) per inline comments at [GlassSessionSwitcher.tsx:198-200](app-mobile/src/components/GlassSessionSwitcher.tsx#L198-L200) and [GlassIconButton.tsx:230-231](app-mobile/src/components/ui/GlassIconButton.tsx#L230-L231) because *it* was producing a visible white-line artifact at chrome scale. With L3 gone, L4 became the sole carrier of edge definition — and at 12% white against the dark backdrop (`'rgba(12,14,18,0.34)'` blur tint), it now reads as "white seam on all four sides."

**This spec does NOT revert V5.** Re-introducing L3 is rejected as direction (see investigation §11 / spec dispatch §0.2). This spec **tunes L4 down** so it stays a subtle premium edge rather than a visible seam.

---

## §2 — Scope (REVISED 2026-04-25 post-implementor-halt — Option A locked)

**REVISION HISTORY:**
- v1 (initial spec): scoped to 5 consumers (Home + bottom-nav chrome only) per investigation manifest.
- **v2 (this revision):** implementor pre-flight grep at §13 found **7 consumers** across 4 files. Investigation undercounted by 3 (filed as ORCH-0669.D-7 — forensic grep breadth process improvement). The 3 missed consumers are in `MessageInterface.tsx` (chat input capsule). **Founder selected Option A 2026-04-25** — lower the shared token alpha to 0.06 across all 7 consumers, accept that chat-input separator becomes near-invisible. Constitution #2 preserved (single token, single owner). Aligns with original-author intent at [MessageInterface.tsx:2040-2041](app-mobile/src/components/MessageInterface.tsx#L2040-L2041) inline comment ("matching the home-chrome capsule language").

**IN SCOPE:**
1. Mutate `glass.chrome.border.hairline` from `'rgba(255, 255, 255, 0.12)'` → `'rgba(255, 255, 255, 0.06)'` at [designSystem.ts:386](app-mobile/src/constants/designSystem.ts#L386).
2. Delete the dead `glass.chrome.border.topHighlight` token at [designSystem.ts:387](app-mobile/src/constants/designSystem.ts#L387) (Constitution #8 cleanup — no consumers post-V5; verified via grep — see §10.1).
3. Add a CI grep gate that fails if any chrome consumer file inlines a `borderColor: 'rgba(255, 255, 255, 0.X)'` literal with white alpha ≥ 0.09, forcing consumers to use the design token rather than drift back to inline values. Scope of files checked widened in v2 to include `MessageInterface.tsx` (since it now consumes the same token).
4. Register the new invariant `I-CHROME-HAIRLINE-SUB-PERCEPTIBLE` (see §6 — also revised in v2 to widen scope to include chat-surface chrome consumers).

**7 surfaces affected by §2.1 token mutation (by reference, no per-file edit needed):**

| # | Surface | File | Consumer line | Property | What changes |
|---|---------|------|---------------|----------|--------------|
| 1 | Session pill bar (container) | [GlassSessionSwitcher.tsx](app-mobile/src/components/GlassSessionSwitcher.tsx) | L519 (post-ORCH-0661 commit) | `borderColor` | Reads new token value at runtime — no source edit |
| 2 | Preferences chip | [GlassIconButton.tsx](app-mobile/src/components/ui/GlassIconButton.tsx) | L290 | `borderColor` | Reads new token value — no source edit |
| 3 | Notification bell | [GlassIconButton.tsx](app-mobile/src/components/ui/GlassIconButton.tsx) | L290 (same component as #2) | `borderColor` | Reads new token value — no source edit |
| 4 | Bottom nav capsule | [GlassBottomNav.tsx](app-mobile/src/components/GlassBottomNav.tsx) | L281 | `borderColor` | Reads new token value — no source edit |
| 5 | "+" create pill (in session bar) | [GlassSessionSwitcher.tsx](app-mobile/src/components/GlassSessionSwitcher.tsx) | L630 (post-ORCH-0661 commit) | `borderColor` | Reads new token value — no source edit |
| **6** | **Chat reply preview wrap** ⭐ NEW v2 | [MessageInterface.tsx](app-mobile/src/components/MessageInterface.tsx) | L2054 | `borderColor` | Reads new token value — no source edit. Border becomes softer; reply-preview pill still reads as bounded shape via background tint + radius. |
| **7** | **Chat input capsule** ⭐ NEW v2 | [MessageInterface.tsx](app-mobile/src/components/MessageInterface.tsx) | L2060 | `borderColor` | Reads new token value — no source edit. Capsule perimeter softens; shape remains via shadow + tint floor. |
| **8** | **Chat input separators** ⭐ NEW v2 — accepted-loss surface | [MessageInterface.tsx](app-mobile/src/components/MessageInterface.tsx) | L2077 | **`backgroundColor`** | Reads new token value — no source edit. **At 0.06 alpha, this 1px-wide divider will be near-invisible.** ACCEPTED per founder selection of Option A 2026-04-25. Founder smoke at T-12.1 (new) verifies the separator near-invisibility is acceptable. |

**OUT OF SCOPE:**
- `glass.chrome.pending.borderColor` (`'rgba(255, 255, 255, 0.28)'`) — ORCH-0661 dashed pending-pill border, intentionally higher visibility per dispatch §0.3 D-6. **PRESERVE EXACTLY.**
- `glass.chrome.active.border` — orange active-state border, separate token.
- BlurView intensity, tint, shadow stack, shadow color, shadow radius, elevation — not in scope.
- Card, badge, modal, profile, discover surfaces — different design languages, separate tokens.
- Component-level borderRadius, height, width, padding — geometry is correct (investigation §3 OBS-1).
- Reverting V5 / re-introducing L3 top-highlight — explicitly rejected per §1 + dispatch §0.2.
- Splitting `glass.chrome.border.hairline` into chat-specific vs home-specific tokens (Option B) — explicitly rejected by founder 2026-04-25 in favor of Option A.
- Adding a per-property special-case to preserve the chat separator visibility (Option C) — explicitly rejected by founder 2026-04-25 in favor of Option A.

---

## §3 — Non-Goals

| # | Non-goal | Why |
|---|----------|-----|
| NG-1 | "Make the chrome look like iOS Control Center" | Out of scope — would require redesign (direction d), rejected as first-cut. |
| NG-2 | "Use `StyleSheet.hairlineWidth` for thinner strokes on iOS" | Asymmetric platform behavior, half-fix on Android. Spec dispatch §0.2 evaluated + rejected as first-cut. |
| NG-3 | "Remove the hairline entirely" | V5 author committed to L4 as the sole edge layer; full removal is direction (c), rejected as first-cut due to risk of "floating" chrome with no edge separation. |
| NG-4 | "Fix the BlurView perimeter clipping artifact" | HF-2 from investigation — out of code reach (expo-blur internal), not the primary cause; lower hairline alpha makes its compounding effect imperceptible. |
| NG-5 | "Touch any part of the in-flight ORCH-0661 work" | Pending-pill machinery is independent. Preservation is invariant T-INV-2 below. |

---

## §4 — Direction Lock

**Chosen value: `'rgba(255, 255, 255, 0.06)'`** (50% alpha reduction from current 0.12).

**Rationale (within the dispatch-permitted range [0.04, 0.08]):**
- 0.04 risks disappearing entirely on bright/light card photos (would lose all edge definition during a bright sunset photo card → chrome reads as "floating" with no separation from photo).
- 0.06 = 50% reduction, mathematically the midpoint of 0.04 and 0.08, preserves edge definition at half the visual weight.
- 0.08 still reads as a seam on a fully-dark backdrop (orchestrator's prior visual reasoning).
- 0.06 is the safest first cut. If on-device testing (T-04) reveals it still reads as a seam, file as discovery and re-spec — **do not re-tune within this spec.**

**Locked exact value:** `'rgba(255, 255, 255, 0.06)'`. No tuning band. No "0.05 or 0.07 is fine." The implementor edits exactly this value.

---

## §5 — Layer Specification

### §5.1 — Design-system layer (only layer touched)

**File:** [app-mobile/src/constants/designSystem.ts](app-mobile/src/constants/designSystem.ts)

**Edit 1 — Mutate hairline token (L386):**
```diff
     border: {
-      hairline: 'rgba(255, 255, 255, 0.12)',
-      topHighlight: 'rgba(255, 255, 255, 0.24)',
+      // ORCH-0669 — Lowered from 0.12 to 0.06 (50% reduction).
+      // 0.12 read as a visible white seam against the dark blur backdrop on all 5
+      // chrome surfaces (pill bar container, preferences chip, notification bell,
+      // bottom nav capsule, create pill). 0.06 preserves L4 edge-definition intent
+      // (per SPEC_ORCH-0589 §13) without crossing the perceptibility threshold on
+      // typical card-photo backdrops. See INVESTIGATION_ORCH-0669 §3 + §11.
+      // Invariant: I-CHROME-HAIRLINE-SUB-PERCEPTIBLE.
+      hairline: 'rgba(255, 255, 255, 0.06)',
     },
```

**Edit 2 — Delete dead `topHighlight` (D-2 cleanup):**
The `topHighlight: 'rgba(255, 255, 255, 0.24)'` line is removed in the same diff (already shown above). Constitution #8: subtract before adding.

### §5.2 — Component layer

**No component file edits.** All 5 consumers reference `glass.chrome.border.hairline` by name and pick up the new value at the next build.

If the implementor finds any consumer that *does not* reference the token (i.e., inlines `'rgba(255, 255, 255, 0.12)'` literally), that is a Constitution #2 (one owner per truth) violation discovered mid-implementation. Stop, file as a discovery, return to orchestrator. **Do not silently fix.**

### §5.3 — Schema / Edge function / Service / Hook / Realtime layers

**N/A.** Visual-only change. No DB, no edge fn, no service, no hook, no realtime, no analytics, no copy.

---

## §6 — New Invariant

### I-CHROME-HAIRLINE-SUB-PERCEPTIBLE (REVISED v2 — chat-surface chrome included)

**Statement:** The shared `glass.chrome.border.hairline` token defines the perimeter edge of every Home + bottom-nav chrome surface AND the chat input capsule (which by original-author intent shares the home-chrome design language per [MessageInterface.tsx:2040-2041](app-mobile/src/components/MessageInterface.tsx#L2040-L2041) inline comment). Its white alpha MUST be `≤ 0.08`. Any consumer of chrome edge styling — chrome surface (`Glass*.tsx`, `ui/Glass*.tsx`) OR chat input chrome (`MessageInterface.tsx` capsule + reply preview) — MUST consume this token by reference; inline `rgba(255, 255, 255, X)` literals with white alpha ≥ 0.09 on these files are forbidden.

**Cross-property note:** The token is consumed by both `borderColor` (perimeter strokes — surfaces 1-7 above) and `backgroundColor` (1px-wide chat input separator — surface 8 above). The invariant binds the token VALUE; the property choice is at the consumer's discretion. Future consumers using this token as a `backgroundColor` for a thin filled element should expect that element to be sub-perceptible at the locked alpha — by design.

**Excluded scope (DOES NOT apply to):**
- `glass.chrome.pending.borderColor` — ORCH-0661 dashed pending-pill state, intentionally higher visibility (28%).
- `glass.chrome.active.border` — orange active-state border, separate token (uses `'rgba(235, 120, 37, 0.55)'`, no white-alpha concern).
- Non-chrome surfaces (`Card*.tsx`, `Badge*.tsx`, modals, sheets, profile, discover) — different design languages, separate token systems.
- `glass.badge.border.topHighlight`, `glass.profile.card.topHighlight`, `glass.profile.cardElevated.topHighlight` — sibling tokens in different namespaces (NOT `glass.chrome.border.*`), have their own consumers, governed by their own design specs.

**Why it exists:** Two prior incidents created visible white-line artifacts on Home chrome:
1. ORCH-0589 V5 deleted the L3 top-highlight overlay because it produced a visible white line at chrome scale.
2. ORCH-0669 (this spec) lowered the L4 hairline alpha because at 12% it produced a visible white seam.

The pattern: edge-definition layers on Home chrome must remain *sub-perceptible* — the chrome should feel "edge-defined" without anyone consciously seeing an edge. This invariant locks that bar going forward. Any new chrome element added later (e.g., `GlassFloatingActionButton`) must consume `glass.chrome.border.hairline` and not exceed the alpha cap.

**How preservation is verified:** §10 CI gate (negative-control reproduction).

**Registration target:** [Mingla_Artifacts/INVARIANT_REGISTRY.md](Mingla_Artifacts/INVARIANT_REGISTRY.md) — implementor registers in the same change.

---

## §7 — Test Cases

| Test | Layer | Scenario | Input | Expected | How verified |
|------|-------|----------|-------|----------|--------------|
| **T-01** | design tokens | Hairline alpha cap | Read `glass.chrome.border.hairline` after change | `'rgba(255, 255, 255, 0.06)'` exactly | Mechanical (file content + grep) |
| **T-02** | design tokens | Dead token deleted | Search for `topHighlight` in `glass.chrome.border.*` | NOT PRESENT | Mechanical (grep returns 0 hits in `border:` block) |
| **T-03** | design tokens | Pending-state border PRESERVED at 28% | Read `glass.chrome.pending.borderColor` | `'rgba(255, 255, 255, 0.28)'` UNCHANGED | Mechanical (file content) — proves ORCH-0669 fix did not regress ORCH-0661 |
| **T-04** | device | Visual smoke — pill bar | Founder eyeballs Home pill bar on physical iOS device, post-OTA | No white seam on left/right/top/bottom edges; pill silhouette reads as smooth; container has subtle edge definition (not floating) | Founder-only (subjective). Failure → file discovery for re-spec, do not auto-tune in implementor cycle. |
| **T-05** | device | Visual smoke — preferences chip | Same, on prefs chip | No white circle outline; chip reads as clean dark glass disc | Founder-only |
| **T-06** | device | Visual smoke — notification bell | Same, on bell | No white circle outline; bell reads as clean dark glass disc | Founder-only |
| **T-07** | device | Visual smoke — bottom nav | Same, on bottom nav | No white seam on bottom-nav capsule; nav reads as a single dark glass surface | Founder-only |
| **T-08** | device | Visual smoke — create pill | Same, on "+" pill | No white seam; create pill reads as clean disc | Founder-only |
| **T-09** | device | Cross-surface consistency | Compare all 5 home-chrome surfaces side-by-side at the same time on the same screen | All 5 surfaces present the same edge treatment — no surface stands out as "more / less defined" than the others | Founder-only |
| **T-10** | device | Cross-platform | Repeat T-04..T-09 on Android device (or emulator API ≥ 31) | Same outcomes as iOS — D-5 (no platform divergence) preserved | Founder-only / tester-runnable |
| **T-11** | regression | Pending pill rendering preserved | Render a pending-sent pill (ORCH-0661 in-flight) on Home pill bar | Pill renders with dim opacity 0.6, dashed border at 28% white, time-outline badge — UNCHANGED from ORCH-0661 cycle-2 expected behavior | Founder-only. Failure indicates ORCH-0669 fix accidentally regressed ORCH-0661. |
| **T-12** | regression | Active state preserved | Tap a non-active session pill | Pill transitions to active orange tint + orange border — UNCHANGED | Founder-only |
| **T-12.1** ⭐ NEW v2 | device | Chat input capsule edge softens consistently with home chrome | Open any DM chat thread, observe the chat input capsule at the bottom (the rounded pill containing attach + text + send) | Capsule perimeter reads as a soft glass edge, NOT a visible white outline — same treatment as home chrome (founder visually compares chat capsule vs home pill bar in the same session) | Founder-only |
| **T-12.2** ⭐ NEW v2 | device | Chat reply preview pill edge softens consistently | Long-press any chat message → "Reply" → observe the "replying to" preview pill that appears above the chat input | Preview pill perimeter reads as soft glass edge, same treatment as home chrome | Founder-only |
| **T-12.3** ⭐ NEW v2 (accepted-loss) | device | Chat input separators near-invisible — Option A acceptance | Open any DM chat thread, look INSIDE the chat input capsule between the attachment icon, the text field, and the send button | The thin vertical 1-pixel divider lines between sections will be near-invisible at 0.06 alpha. **Founder confirms this is acceptable** (capsule still reads as clearly bounded sections via spacing + button positioning, even without the visible dividers). If founder finds the loss-of-divider intolerable, file as discovery and re-spec — do NOT auto-tune. | Founder-only — explicit accepted-loss verification per §2 v2 revision |
| **T-13** | CI gate | Negative-control reproduction (forward) | Edit a chrome file to inline `borderColor: 'rgba(255, 255, 255, 0.12)'` | CI gate fails (exit 1) with a clear message identifying the file + line | Run gate locally, observe failure |
| **T-14** | CI gate | Negative-control reproduction (recovery) | Revert the inlined value | CI gate passes (exit 0) | Run gate locally, observe pass |
| **T-15** | static | Constitution #2 audit | Grep all chrome files for `borderColor:` literals NOT matching the token reference | Only the active-state orange border + the ORCH-0661 dashed-pending border + the badge borderColor (`glass.chrome.badge.borderColor`) survive the grep — no inline white-alpha hairlines | Mechanical. Failure → file Constitution #2 discovery for separate fix. |

**Mechanical tests (T-01, T-02, T-03, T-13, T-14, T-15)** are runnable by the tester without device access. **Device tests (T-04..T-12)** require founder smoke post-OTA.

**Bar for tester PASS:** all 6 mechanical tests PASS + founder confirms T-04..T-12 visually. `CONDITIONAL PASS` permitted only if T-04..T-12 are UNVERIFIED (founder smoke pending), with explicit conditions list.

---

## §8 — Success Criteria

1. **Token mutation is exact.** `glass.chrome.border.hairline === 'rgba(255, 255, 255, 0.06)'`. No drift, no rounding, no "0.05 is close enough."
2. **Dead token deleted.** `glass.chrome.border.topHighlight` no longer exists in the codebase. Grep returns 0 hits.
3. **No component-level edits.** All 5 consumers continue to reference the token by name. The diff is bounded to `designSystem.ts` plus the CI gate file plus the invariant registry update.
4. **ORCH-0661 work preserved byte-for-byte.** No file in the in-flight Seth-branch diff (`GlassSessionSwitcher.tsx`, `designSystem.ts` `glass.chrome.pending.*` block) is touched except the targeted hairline + topHighlight lines.
5. **CI gate active.** A grep-based gate is added (location specified in §10.1) that fails if any chrome file inlines `borderColor: 'rgba(255, 255, 255, 0.X)'` with white alpha ≥ 0.09. Negative-control reproduction (T-13 + T-14) verified by implementor before reporting back.
6. **Invariant registered.** `I-CHROME-HAIRLINE-SUB-PERCEPTIBLE` exists in `Mingla_Artifacts/INVARIANT_REGISTRY.md` with the §6 statement above.
7. **Visual founder-PASS on at least iOS.** T-04..T-09 all green via founder smoke. (T-10 Android optional for first cut; if Android shows divergence, file discovery.)
8. **No new TypeScript errors, no new ESLint errors.** Token mutation is value-only; types unchanged.
9. **LOC delta:** -2 (delete topHighlight + comma), +5 (5 lines of justification comment), +1 (new alpha value), +X for CI gate file (small new file or addition to existing CI script), +1 for invariant registry entry. Net positive ~5-10 LOC, well-justified by Constitution #8 + invariant registration.
10. **Implementor report includes** verbatim before/after of the `glass.chrome.border.*` block + verbatim CI gate command + screenshot/log of T-13 + T-14 negative-control reproduction.

---

## §9 — Implementation Order

Strict sequence. Do not parallelize. Do not skip.

1. **Step 1 — Read.** Open [designSystem.ts:382-388](app-mobile/src/constants/designSystem.ts#L382-L388). Confirm current state matches investigation evidence (`hairline: 'rgba(255, 255, 255, 0.12)'`, `topHighlight: 'rgba(255, 255, 255, 0.24)'`).
2. **Step 2 — Verify in-flight diff is intact.** Run `git diff app-mobile/src/constants/designSystem.ts` and confirm the ORCH-0661 `glass.chrome.pending.*` block (lines 418-455 of working tree) is present and unchanged. If it's gone, STOP — that's a different problem.
3. **Step 3 — Audit consumers.** Run `grep -rn "glass.chrome.border.hairline\|glass.chrome.border.topHighlight" app-mobile/src/`. Confirm:
   - `glass.chrome.border.hairline` has 5 consumers across `GlassSessionSwitcher.tsx`, `GlassIconButton.tsx`, `GlassBottomNav.tsx` (matches investigation §2 manifest).
   - `glass.chrome.border.topHighlight` has **0 consumers**. If any consumer exists, STOP — D-2 (Constitution #8 cleanup) was wrong, file discovery, do not delete the token.
4. **Step 4 — Edit `designSystem.ts`.** Apply Edit 1 + Edit 2 from §5.1 exactly as written. Do not reformat surrounding code.
5. **Step 5 — Add CI gate.** See §10.1 for exact gate.
6. **Step 6 — Register invariant.** Add entry to `Mingla_Artifacts/INVARIANT_REGISTRY.md` per §6 statement.
7. **Step 7 — Run CI gate locally.** Confirm it passes on the clean working tree (T-14).
8. **Step 8 — Run CI gate negative-control.** Temporarily edit a chrome file to inline a forbidden `borderColor` (e.g., add `borderColor: 'rgba(255, 255, 255, 0.10)'` somewhere in `GlassIconButton.tsx`). Confirm gate fails with a clear message (T-13). Then revert the test edit. Confirm gate passes again (T-14 recovery).
9. **Step 9 — Type/lint check.** Run `cd app-mobile && npx tsc --noEmit` and ESLint. Both must pass with zero new errors.
10. **Step 10 — Smoke build.** Verify Metro / Expo dev server can build the app without runtime errors. (Visual confirmation of the hairline change is founder/tester job — implementor only confirms the build is healthy.)
11. **Step 11 — Implementation report.** Write `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0669_HOME_CHROME_HAIRLINE_REPORT.md` per `mingla-implementor` skill template, including: verbatim diff, T-13 + T-14 negative-control logs, consumer-audit grep output (Step 3), invariant registry entry, list of any discoveries.

**No DB migration, no edge fn deploy, no OTA-blocking dependencies.** The change is pure source-code; OTA delivers it directly.

---

## §10 — Regression Prevention

### §10.1 — CI Gate

**Goal:** prevent inline `borderColor: 'rgba(255, 255, 255, 0.X)'` literals with white alpha ≥ 0.09 in any chrome file (`Glass*.tsx` in `components/` or `components/ui/`).

**Implementation choice (implementor picks the lighter one):**

**Option A — Standalone shell script** at `app-mobile/scripts/ci/check-chrome-hairline.sh`:
```bash
#!/usr/bin/env bash
# ORCH-0669 — I-CHROME-HAIRLINE-SUB-PERCEPTIBLE invariant CI gate.
# Fails if any Glass* chrome file inlines a borderColor with white alpha >= 0.09.
# See specs/SPEC_ORCH-0669_HOME_CHROME_HAIRLINE.md §6.
set -euo pipefail

# Match: borderColor: 'rgba(255, 255, 255, 0.X...)' where X is 0[9] or 1-9 followed by anything
PATTERN="borderColor:\s*['\"]rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*0\.(0[9]|[1-9])"

# Search chrome consumer files. v2: includes MessageInterface.tsx since it consumes
# glass.chrome.border.hairline for the chat input capsule (per spec §2 v2 surfaces 6-8).
HITS=$(grep -rEn "$PATTERN" \
  app-mobile/src/components/Glass*.tsx \
  app-mobile/src/components/ui/Glass*.tsx \
  app-mobile/src/components/MessageInterface.tsx \
  2>/dev/null || true)

if [ -n "$HITS" ]; then
  echo "❌ I-CHROME-HAIRLINE-SUB-PERCEPTIBLE invariant violated."
  echo "   Inline borderColor with white alpha >= 0.09 detected on a chrome file:"
  echo "$HITS"
  echo ""
  echo "   Chrome perimeter borders MUST consume glass.chrome.border.hairline by reference."
  echo "   See specs/SPEC_ORCH-0669_HOME_CHROME_HAIRLINE.md §6."
  exit 1
fi

echo "✅ I-CHROME-HAIRLINE-SUB-PERCEPTIBLE invariant holds."
exit 0
```

Wired into `app-mobile/package.json` `scripts.ci` (or appended to existing CI runner).

**Option B — `eslint-plugin-no-restricted-syntax` rule** (preferred if the repo already has custom ESLint rules):
```js
{
  'no-restricted-syntax': ['error', {
    selector: "ObjectExpression > Property[key.name='borderColor'][value.value=/^rgba\\(\\s*255\\s*,\\s*255\\s*,\\s*255\\s*,\\s*0\\.(0[9]|[1-9])/]",
    message: 'I-CHROME-HAIRLINE-SUB-PERCEPTIBLE: chrome perimeter borders must consume glass.chrome.border.hairline. See SPEC_ORCH-0669.'
  }]
}
```
Scoped to `Glass*.tsx` files via ESLint `overrides`.

Implementor picks A or B based on existing repo CI infrastructure. Either works for the invariant.

### §10.2 — Protective comment in `designSystem.ts`

The justification comment above the `hairline` value (per §5.1 Edit 1) IS the protective comment. It explains *why* 0.06 is the value, references the investigation, and names the invariant. Future readers tempted to "just bump it back up" will encounter the warning.

### §10.3 — Spec → Invariant Registry

Step 6 of §9 registers `I-CHROME-HAIRLINE-SUB-PERCEPTIBLE` in `INVARIANT_REGISTRY.md`. The CI gate enforces it. Future PRs that touch Home chrome will trip the gate if they drift back.

---

## §11 — Acceptance Checklist

The orchestrator REVIEW gate this spec must pass before implementor dispatch:

- [x] Single chosen direction with single token value: 0.06 (no tuning band)
- [x] Every file to edit listed with line numbers (one file: `designSystem.ts` L386 + L387; one new CI file)
- [x] D-2 dead-token cleanup included in same change
- [x] Mechanical test cases tester can run without device (T-01, T-02, T-03, T-13, T-14, T-15)
- [x] Device test cases founder must run (T-04..T-12)
- [x] In-flight ORCH-0661 pending border preserved (T-03 + T-11 + §2 OUT OF SCOPE clause + §8 SC-4)
- [x] CI gate defined with both forward + recovery negative-control test (§10.1 + T-13 + T-14)
- [x] LOC delta counted (§8 SC-9)
- [x] Scope NOT expanded beyond §0.1 (5 hairline consumers; bottom nav included; create pill auto-included)
- [x] New invariant named (`I-CHROME-HAIRLINE-SUB-PERCEPTIBLE`, §6) — structural prevention warranted because two prior incidents (V5 + this) confirm the recurring pattern

---

## §12 — Estimated Cycle

- **Implementor cycle 1:** ~30 min (single file edit + CI gate + invariant registration + report writing).
- **Tester (mechanical):** ~10 min (run T-01..T-03 + T-13..T-15).
- **Tester / founder (visual):** ~5 min device smoke per surface × 5 surfaces × 2 platforms = ~30 min if Android included, ~15 min iOS-only.
- **Total wall time:** under 1 hour to PASS.

---

## §13 — Discoveries to Re-Confirm at Implementation Time

The implementor MUST verify, before applying the diff, that:

1. **D-2 cleanup is still safe.** `grep -rn "topHighlight" app-mobile/src/` returns 0 hits in production code paths (other usages of the word "topHighlight" in unrelated comments are OK). If any consumer exists post-this-spec-write, STOP — file discovery, do not delete.
2. **ORCH-0661 in-flight diff is still in working tree.** `git status app-mobile/src/components/GlassSessionSwitcher.tsx app-mobile/src/constants/designSystem.ts` should show both as modified (not committed yet, not reverted). If the situation has changed since the investigation read (2026-04-25), re-confirm the diff isn't accidentally being clobbered.
3. **No new chrome consumers added since the investigation.** `grep -rn "glass.chrome.border.hairline" app-mobile/src/` should return exactly 5 consumer locations (matches investigation §2). If a 6th appeared, ensure it follows the token-reference pattern (not inline literal); if inlined, fix it as part of the same change (Constitution #2 enforcement).

---

## §14 — Rollback

If T-04..T-12 founder smoke shows the result is *too* subtle (chrome reads as "floating" without edge definition):

1. Revert the single `designSystem.ts` `hairline` line from `0.06` back to a higher value within `[0.04, 0.08]` (likely 0.08 as the more-conservative retry).
2. Do NOT re-introduce the `topHighlight` token (D-2 cleanup is correct independent of this).
3. Do NOT remove the CI gate or invariant.
4. File this as ORCH-0669.D-1 (re-tune discovery) and re-OTA.

If founder smoke shows "still reads as a seam" at 0.06:

1. Try 0.04 first (range minimum) before escalating to direction (c) or (d).
2. If 0.04 also reads as a seam, this spec's direction (a) is wrong. File discovery and re-spec via dispatch §0.2 alternative — do NOT exceed the [0.04, 0.08] range without re-spec.

Rollback scenarios are not implementor decisions. They require orchestrator dispatch.
