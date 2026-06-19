# TEST — ORCH-1145 — Venue listing → Hub "Venue" tab (Phase 1: THE MOVE ONLY)

- **ORCH-ID:** ORCH-1145
- **Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1145-[venue-hub-tab]/` on branch `ORCH-1145-venue-hub-tab`
- **Implementation commit under test:** `1e2a3badcee4d805922d2f422eb5c880c3444562`
- **Tester:** mingla-tester (production gatekeeper). Source-read + jest-runtime methodology. Assumed broken until proven.
- **Date:** 2026-06-15

---

## VERDICT: PASS (jest-runtime + code-trace proven). Device/sim leg DEFERRED to post-merge dev-channel OTA (accepted per ORCH-1139/1140/1142).

No P0/P1/P2 defects. One P4 (transient-frame redirect note, non-blocking, device-verify on OTA). The visibility gate (the core invariant), no-dead-tap wiring, redirect integrity, row removal, nav-lock preservation, and ORCH-1144 disjointness are all PROVEN.

---

## Evidence ledger

### Suites run (this commit, node/ts-jest)
```
PASS app/(tabs)/hub/__tests__/venueTab.contract.test.ts        (T-1..T-10, implementor)
PASS app/(tabs)/hub/__tests__/hub-layout-nav-lock.test.ts      (preserve gate, UNMODIFIED)
PASS app/brand/[id]/__tests__/listing.orch_1040.test.ts        (re-pointed, [TEST-MOD-APPROVED ORCH-1145])
PASS src/hooks/__tests__/useHubTabs.venueGate.adversarial.test.ts  (TESTER-OWNED, runtime)
Test Suites: 4 passed, 4 total ; Tests: 32 passed, 32 total
```
- `tsc --noEmit -p tsconfig.json` → exit 0; ZERO errors in any ORCH-1145 file. (Only pre-existing `packages/phone-input/*` module-resolution noise, unrelated.)

### Pre-existing failures (NOT ORCH-1145 — confirmed independently)
- `orch1004AllowlistIntegrity` (expects `usePublicExperience.ts` in an allowlist — ORCH-1004 drift) and `brandListState` fail on THIS commit. Neither their test files nor `usePublicExperience.ts` appear in the 1145 diff (`git show 1e2a3badc --name-only` → no match). Parent `c30fdfc8c`. Not attributable to this work. ✔

---

## Per-criterion results

| # | Checklist item | Result | Evidence |
|---|----------------|--------|----------|
| 1 | **Visibility gate (I-PROPOSED-1145-VENUE-TAB-CONDITIONAL)** — pill present for `hasPhysicalLocation` OR `placePoolId`, ABSENT for purely-online | **PASS (runtime)** | My adversarial test EXECUTES `deriveHubVisibleTabs`: A1 placePool-only→`["venue"]`, A2 physical-only→`["venue"]`, A3 online-only→`["events","trips","experiences"]` (NO venue), A4 default-arg→no venue. The implementor's T-1..T-3 only string-match the source — I proved the runtime truth (incl. the false case). |
| 2 | **No dead tap** — pill renders real management UI for active brand via `useCurrentBrand()`, no route param | **PASS (code-trace)** | `app/(tabs)/hub/listing.tsx` resolves `useCurrentBrand()` → `brandId`, renders `<VenueListingContent chromeMode="tab">`. `VenueListingContent.tsx` is a verbatim lift of the ORCH-1040 body: status badge, AI match scores, "What you submitted", changes-remaining, feedback sheet/banner, Edit/View-public actions. No placeholder/stub. Runtime mount deferred to OTA. |
| 3 | **Redirect integrity** — `/brand/{id}/listing` lands on Venue tab, correct brand, forwards `?focus=feedback`, no loop | **PASS (code-trace)** | `app/brand/[id]/listing.tsx` is a thin `<Redirect href=".../listing[?focus=feedback]">`; a `useEffect` sets `setCurrentBrandId(id)` ONLY when `id !== currentBrandId` (loop-guarded). Store is Zustand reactive-selector → `useCurrentBrand()` in the tab re-renders to the new brand + React Query refetches. `setCurrentBrandId` API verified on the store. |
| 4 | **Row removal** — "Venue listing" Operations row + `onListing` gone, no dangling refs | **PASS** | Diff removes the `operationsRows` block, the `onListing` prop/destructure/deps, and `showVenueListing`. Grep: zero live `onListing` (only tests/comments). `app/brand/[id]/index.tsx` is the sole `<BrandProfileView>` renderer and no longer passes it (`home.tsx` only has comment mentions). tsc=0 confirms no broken caller. |
| 5 | **nav-lock guard** — `hub-layout-nav-lock.test.ts` passes UNMODIFIED | **PASS** | Test PASSES; its last-touch commit is `b9d272156` (META-ORCH-1059), NOT `1e2a3badc` → unmodified. `_layout.tsx:161` guard `if (!activePath.includes("/hub/")) return;` intact and BEFORE `router.replace` (line 173); the venue branch was added inside the guarded block. |
| 6 | **ORCH-1144 disjointness** — `experiences.tsx` untouched | **PASS** | `experiences.tsx` does NOT appear in `git show 1e2a3badc --name-only` (only commit-message text mentions it). Zero overlap. |
| 7 | **Cross-surface** — web preview parity; Android opaque-glass honored | **PASS (code) / DEFERRED (visual)** | `VenueListingContent` uses only cross-platform RN + shared `GlassCard`/`EventCoverMedia`/`Button`/`Toast` (no native-only API; no `Platform.OS` branch introduced). No new glass surface created — reuses existing `GlassCard` (inherits the opaque Android fallback). Shared file, no `.web.tsx` needed. Visual parity per-surface deferred to OTA. |
| 8 | **Adversarial test (different angle, fails-on-revert)** | **PASS** | See below. |

---

## My adversarial test (DIFFERENT ANGLE — RUNTIME, not source-string)

**Path:** `mingla-business/src/hooks/__tests__/useHubTabs.venueGate.adversarial.test.ts` (immutable / append-only, tester-owned).

**Why it is genuinely adversarial:** the implementor's entire suite is SOURCE-STRING matching (regex on file text) — it never EXECUTES the gate. I attack two boundaries on a different plane:
- **(A) True-OR execution:** I run `deriveHubVisibleTabs` for placePool-ONLY and physical-ONLY brands. A `&&`-typo (instead of `||`) would PASS the implementor's `/hasPhysicalLocation \|\| hasPlacePool/` regex while silently breaking the runtime — my test catches it.
- **(B) Stored-tab STALE-POINTER race (uncovered upstream):** a user last on the Venue tab whose venue flag then flips OFF must NOT be restored onto a now-invisible Venue tab. `pickHubInitialTab("venue", [no venue])` must fall back, never return `"venue"`. The implementor's tests do not exercise `pickHubInitialTab` at all.

**Fails-on-revert proof (cited commit `1e2a3badc`):**
- Revert A (`||`→`&&` at `useHubTabs.ts:49`): tests **A1, A2, A5 FAIL** (3 failed / 7 passed). Restored → all pass.
- Revert B (drop `if (visibleTabs.includes(storedTab))` guard at `useHubTabs.ts:65`): tests **B1, B2 FAIL** (2 failed / 8 passed). Restored → all pass.
- Clean source restored; final run: **10/10 PASS**.

This is NOT a renamed copy of the implementor's test — it executes pure functions and covers a state-staleness race the implementor omitted.

---

## What is runtime-proven vs deferred

**Proven now (jest-runtime + tsc + code-trace):**
- Visibility gate behavior in BOTH directions (true & false), incl. placePool-only edge — RUNTIME.
- `pickHubInitialTab` stale-pointer protection — RUNTIME.
- No-dead-tap wiring, redirect wiring, row removal, nav-lock preservation, disjointness, type-safety, no broken callers.

**Deferred to post-merge dev-channel OTA (accepted pattern, not a blocker):**
- On-device/sim visual render of the Venue tab (SC-3 pixels), brand-switch re-open (SC-4 live), push deep-link land (SC-6 live), feedback auto-open (SC-7 live), nav-lock no-bounce gesture (SC-8 live), Android opaque-glass visual (SC-9), web-preview pixel parity (SC-10). The business jest harness has no RN renderer (documented in the suite header), so component-mount proofs are not runnable here — same constraint accepted on ORCH-1139/1140/1142.

---

## Defects

None at P0–P2. 

**P4 (note, non-blocking):** The redirect (`brand/[id]/listing.tsx`) sets the active brand in a `useEffect` while `<Redirect>` returns during the same render. For a deep-link targeting a NON-active brand, the Venue tab could mount for one frame against the previous brand before the Zustand subscription re-renders to the correct one (React Query then shows its loading state). Analysis says this is transient-frame and self-correcting (no crash, eventual-correct; the SPEC §4.5 anticipated it and the `useCurrentBrand` auto-clear is the safety net). **Recommend the implementor visually confirm "no wrong-brand flash" on the OTA dev build** when opening a `new_review`/`claim_decision` push deep-link for a brand that is not currently active. Not a merge blocker.

---

## Cross-ORCH / hygiene
- Comms Ledger read on entry. No ORCH-1145-relevant BLOCK rows for this skill/ORCH; nothing to ack. No new cross-ORCH discovery to write.
- ORCH-1144 sequencing guard honored: `experiences.tsx` untouched; rebase-onto-origin/main before merge remains the implementor/orchestrator action.

## Routing
NEXT = mingla-orchestrator CLOSE (flip I-PROPOSED-1145-VENUE-TAB-CONDITIONAL → ACTIVE; World Map reconcile; schedule the dev-channel OTA + device leg for the deferred SCs + the P4 visual check).
