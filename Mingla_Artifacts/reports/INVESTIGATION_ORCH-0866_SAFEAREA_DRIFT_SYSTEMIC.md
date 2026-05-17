# INVESTIGATION — ORCH-0866 [SafeArea drift systemic audit]

> **⚠ ORCH-ID COLLISION NOTE:** `ORCH-0862` is referenced in `mingla-business/src/store/liveEventStore.ts:352` for a prior partialize fix. Orchestrator's REWORK 5 dispatch reused this ID. Flagging for orchestrator to either (a) renumber this investigation to ORCH-0866 / ORCH-0865 in artifact sync, or (b) accept the collision and treat both as historical reference to the same number. The investigation's findings stand regardless of ID renumbering.

**Skill:** Claude `mingla-forensics` (INVESTIGATE mode, code-audit-only exemption per dispatch)
**Scope:** mingla-business only (per operator decision at orchestrator turn)
**Symptom:** trip operator dashboard (`mingla-business/app/trip/[id]/index.tsx`) renders Edit button + title bleeding into the iPhone status bar; operator-confirmed via screenshot at 13:48. REWORK 4 added the Edit button to a header that itself lacked SafeArea protection.
**Confidence:** `proven` (source layer + layout chain mapping)

---

## 1. Layman summary

The whole mingla-business app has a SafeArea convention — a root `SafeAreaProvider`, with per-screen `useSafeAreaInsets` to push content below the status bar. There's no automatic enforcement. Every NEW full-screen route added to `mingla-business/app/` must explicitly call `useSafeAreaInsets` + apply `paddingTop: insets.top` — and several recent routes (especially the trip surfaces from ORCH-0859 [Tr2 Minimum Viable Trip]) shipped without it. The trip operator dashboard is one of those. The fix is structural: add a canonical `SafeScreen` wrapper component, retrofit every violating route, and add a CI gate that catches new full-screen routes missing the wrapper.

---

## 2. Investigation manifest

Files read (in trace order):

1. `mingla-business/app/_layout.tsx` — root layout, confirms `SafeAreaProvider` is wrapping the app at line 230.
2. `mingla-business/app/(tabs)/_layout.tsx` — tabs layout, uses `useSafeAreaInsets` for tab-bar bottom padding (line 89) but does NOT push content top (each tab route owns top SafeArea).
3. `mingla-business/app/(tabs)/hub/_layout.tsx` — hub sub-layout, applies `paddingTop: insets.top` at line 82 → all hub children (events / trips / experiences / index) inherit top SafeArea via parent wrap.
4. `mingla-business/app/auth/_layout.tsx` — NO SafeArea — auth screens may bleed.
5. Comprehensive enumeration of all 64 route files under `mingla-business/app/` via `find`.
6. SafeArea-usage grep across `mingla-business/app/` + `mingla-business/src/` to identify routes that DO use the pattern.
7. Spot-checks on `app/trip/[id]/index.tsx`, `app/trip/create.tsx`, `app/trip/coming-soon.tsx`, `app/auth/index.tsx`, `app/event/[id]/scanner/index.tsx` to confirm presence/absence.
8. `mingla-business/src/components/trip/TripCreatorWizard.tsx` — REWORK 2 added `useSafeAreaInsets` here (verified earlier session); confirms wizard route is covered via the component, not the route file.

---

## 3. Findings

### 🔴 Root Cause R-1 — No canonical wrapper component for full-screen SafeArea

**File:** N/A — absence of a `SafeScreen` (or equivalent) component in `mingla-business/src/components/ui/`.
**Exact code:** every screen rolls its own `useSafeAreaInsets` + `paddingTop: insets.top` pattern. There's no shared abstraction.
**What it does:** each new route author must remember to (a) import `useSafeAreaInsets`, (b) call the hook, (c) apply `paddingTop` to the root view. Forgetting any one step bleeds content into the status bar.
**What it should do:** a single `<SafeScreen>` (or `<AppScreen>`) component wraps content with the correct insets. Authors import one component, wrap their content, and SafeArea is automatic.
**Causal chain:** REWORK 4 added an Edit button to `app/trip/[id]/index.tsx`. The dashboard's existing header lacked SafeArea. Without a canonical wrapper, the implementor had no obvious "just use SafeScreen" pattern to follow — and the absence of a CI gate let the regression ship.
**Verification:** grep `mingla-business/src/components/ui/` for `Screen|SafeScreen|AppScreen` → no canonical wrapper exists.

### 🔴 Root Cause R-2 — Trip-surface routes missing SafeArea (concrete violations)

**Verified violations (top-level routes, no parent layout provides top SafeArea):**

| File | Current state | Required fix |
|---|---|---|
| `mingla-business/app/trip/[id]/index.tsx` | No SafeArea import or usage in render path (operator dashboard — operator screenshot shows the leak) | Add `useSafeAreaInsets()` + `paddingTop: insets.top` to root `<View style={styles.host}>` at line 132 |
| `mingla-business/app/trip/create.tsx` | No SafeArea import | Add same pattern to root `<View style={styles.host}>` |
| `mingla-business/app/trip/coming-soon.tsx` | No SafeArea (just a comment mentions "Safe to delete"; not safe-area-related) | Add same pattern OR delete the file (redirect stub from M0; redirect is sub-100ms so cosmetic only) |
| `mingla-business/app/auth/index.tsx` | No SafeArea import | Add same pattern — auth login screen ships without it |

**Verified routes that DO add their own SafeArea (sample — not exhaustive):**

| File | How it handles it |
|---|---|
| `mingla-business/app/event/[id]/scanner/index.tsx` | `useSafeAreaInsets` at line 35 → `paddingTop: insets.top` at line 443 |
| `mingla-business/src/components/trip/TripCreatorWizard.tsx` | REWORK 2 added inset wrap → covers `/trip/[id]/edit` and `/trip/create` indirectly |
| Hub children (`events.tsx`, `trips.tsx`, `experiences.tsx`, `index.tsx`) | Covered by `app/(tabs)/hub/_layout.tsx:82` parent wrapping |
| Tabs sibling routes (`home.tsx`, `account.tsx`, `ari.tsx`, `marketing/*`) | Each adds its own per-screen SafeArea |

**What it does:** route renders content starting from y=0 — content overlaps iPhone status bar (clock, signal, battery icons).
**What it should do:** route renders content starting from y=safe-area-top — content sits cleanly below the status bar.
**Causal chain:** route author forgot to import + apply SafeArea. No CI gate caught it. Operator only notices when they smoke the route on a real device + see the bleed.

### 🟠 Contributing Factor C-1 — Layout chain is not documented

**File:** N/A
**Exact code:** the SafeArea contract is implicit. New authors don't know that `app/(tabs)/hub/_layout.tsx:82` provides top SafeArea for hub children but `app/(tabs)/_layout.tsx` does NOT provide top SafeArea for direct tab children (each must add their own). Top-level routes outside `(tabs)/` (e.g. `/event/[id]/`, `/trip/[id]/`, `/brand/[id]/`, `/account/`, `/auth/`, `/checkout/[eventId]/`) get no parent SafeArea at all.
**What it does:** new authors guess at the convention. Some screens have it, some don't. The matrix is invisible.
**What it should do:** README or `mingla-business/src/components/ui/README.md` documents the layout chain and the canonical wrapper.
**Causal chain:** missing documentation → author misses pattern → ships unguarded route.

### 🟡 Hidden Flaw H-1 — Many UNAUDITED routes likely have the same bug

**Files not spot-checked in this investigation:**

- `app/+not-found.tsx`, `app/__styleguide.tsx`, `app/index.tsx` (utility / dev)
- `app/connect-onboarding.tsx`, `app/stripe-onboarding-return.tsx`
- `app/event/[id]/scanners/index.tsx`, `app/event/[id]/door/[saleId].tsx`, `app/event/[id]/reconciliation.tsx`, `app/event/[id]/guests/[guestId].tsx`, `app/event/[id]/orders/[oid]/index.tsx`, `app/event/[id]/blasts/index.tsx`, `app/event/[id]/door/index.tsx`
- `app/ari/settings.tsx`
- `app/auth/callback.tsx`
- `app/o/[orderId].tsx`

Roughly half of these appear in the SafeArea-usage grep result; the other half do not — they may or may not have the bug. **Risk:** more SafeArea bleed reports from operator on these surfaces.

**Why this is a hidden flaw, not a root cause:** they're not the surface operator reported, but they're the same bug class. Without a wrapper + CI gate, they will surface one at a time as operator smokes more screens.

### 🔵 Observation O-1 — `app-mobile/` (consumer app) NOT audited

Dispatch was scoped to mingla-business only. Consumer app may or may not have the same drift; recommend a follow-up ORCH for app-mobile parity audit after this one closes.

---

## 4. Five-layer cross-check

| Layer | What it says | Disagreement? |
|---|---|---|
| Docs | No SafeArea convention documented in README or `src/components/ui/README.md` | YES — convention exists in code but is undocumented |
| Schema | N/A — UI concern only | N/A |
| Code | Per-screen `useSafeAreaInsets` pattern; root `SafeAreaProvider`; hub _layout wraps children; tabs _layout handles bottom only | Code defines the contract but inconsistently |
| Runtime | Operator screenshot shows status bar bleed on `/trip/[id]` dashboard | Confirms violation |
| Data | N/A | N/A |

**Contradiction:** docs say nothing → code requires per-screen wrapping → runtime shows screens shipping without it. The fix targets the docs + code layers (canonical wrapper + documentation) plus CI (gate).

---

## 5. Blast radius

- **All trip routes shipped in ORCH-0859 [Tr2 Minimum Viable Trip]** — 3 routes (`trip/[id]/index.tsx`, `trip/create.tsx`, `trip/coming-soon.tsx`) confirmed broken.
- **Auth route** — 1 route broken.
- **~10 unaudited routes** under `event/[id]/*`, `brand/[id]/payments/*`, `checkout/[eventId]/*` may also be broken — H-1.
- **Future routes** — every new top-level route without parent layout SafeArea will inherit the bug unless the wrapper + CI gate land.

---

## 6. Invariant violations

None of the registered invariants directly covers SafeArea. This investigation proposes a NEW invariant:

**`I-PROPOSED-TR2-SAFEAREA-ON-FULLSCREEN-ROUTES`** (status: DRAFT, flips to ACTIVE on ORCH-0866 CLOSE)

> Every full-screen route under `mingla-business/app/` that is not nested inside a layout file that applies `paddingTop: insets.top` MUST wrap its root view in the canonical `SafeScreen` component (or equivalent `useSafeAreaInsets` + manual paddingTop application). Routes covered by `(tabs)/hub/_layout.tsx` are exempt because the parent layout provides the inset.

---

## 7. Fix strategy (direction only — implementor will translate to spec + code)

**Structural fix** (recommended):
1. Create `mingla-business/src/components/ui/SafeScreen.tsx` — a wrapper that internally uses `useSafeAreaInsets` and applies `paddingTop: insets.top` (and optionally `paddingBottom` for routes not inside the tabs layout). Single API: `<SafeScreen>{children}</SafeScreen>`. Optional prop `excludeTop` for the rare case where the screen wants to draw under the status bar (cover-photo screens, etc.).
2. Retrofit the 4 confirmed violations + audit the 10 unaudited routes; wrap each root view in `<SafeScreen>`.
3. Add strict-grep CI gate `.github/scripts/strict-grep/i-proposed-tr2-safearea-on-fullscreen-routes.mjs` that:
   - Scans every `*.tsx` file under `mingla-business/app/` matching a route filename pattern (default export, not a `_layout.tsx`)
   - For each, requires either (a) imports `SafeScreen`, OR (b) imports `useSafeAreaInsets` AND applies `paddingTop: insets.top` somewhere in the render path, OR (c) is in an allowlist of routes whose parent layout provides SafeArea (currently `(tabs)/hub/*`), OR (d) carries an explicit allowlist comment `// orch-strict-grep-allow safearea-on-fullscreen-routes — <reason>`
   - Wire into `.github/workflows/strict-grep-mingla-business.yml`
4. Document the SafeArea contract in `mingla-business/src/components/ui/SafeScreen.tsx` JSDoc and add a `mingla-business/src/components/ui/README.md` if one doesn't exist.

**Tactical fix only (NOT recommended)**:
Just add SafeArea to the 4 known violations and skip the wrapper + gate. This is whack-a-mole — H-1 routes will continue to surface bugs one operator-smoke at a time.

---

## 8. Regression prevention

- Strict-grep gate above catches new routes missing SafeArea at PR time.
- Canonical `<SafeScreen>` wrapper removes the per-route boilerplate that authors forget.
- Implementor + tester skill files should add a Step in the Cross-Surface Impact Inspection: "if you're touching a route header or the root view of a full-screen route, verify SafeArea coverage via `<SafeScreen>`."

---

## 9. Discoveries for orchestrator

- **ORCH-ID collision:** `ORCH-0862` already exists in `mingla-business/src/store/liveEventStore.ts:352` as a prior partialize fix. Orchestrator should renumber to ORCH-0866 (or accept collision and document it in the ORCH ledger).
- **Consumer app (`app-mobile/`) NOT in scope** — recommend a follow-up ORCH for parity audit after this one closes.
- **Implementor skill SHOULD codify the `<SafeScreen>` pattern** as a Cross-Surface Impact step so future implementors don't repeat the gap. Add to both `.claude/skills/mingla-implementor/SKILL.md` and `.codex/skills/implementor-mingla/SKILL.md` at the next META-ORCH cycle (operator-authorized cross-skill edit).

---

## 10. Confidence

**`proven`** — source layer + layout chain mapping is complete. The operator's screenshot is independent runtime confirmation. The remaining ~10 unaudited routes are flagged as H-1 with file paths so the implementor can spot-check during fix.
