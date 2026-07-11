# IMPLEMENTATION — ORCH-1332 [partner-brand-fixes] + ORCH-1333 [partner-pages reskin]

- **Skill:** mingla-implementor
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1332-[partner-brand-fixes]/` on branch `ORCH-1332-partner-brand-fixes`
- **Surfaces:** business-iOS + business-Android only (`mingla-business`). Dark-only.
- **Specs built:** `Mingla_Artifacts/investigations/INVESTIGATION_ORCH-1332_PARTNER_BRAND_DEAD_ROUTE.md` (§10 + §13) · `Mingla_Artifacts/specs/DESIGN_ORCH-1333_PARTNER_PAGES_RESKIN.md` (§4–§13, §7)
- **Fix commit (fails-on-revert verified):** `b6765d2609dd979a5bc8da76917f70581dcb5ade`
- **Status:** implemented and verified (source/type/gate level). Runtime device verification is the tester's phase (business dev build; OTA is FROZEN — COMMS-0052 RESOLVED-but-superseded / COMMS-0063 — this is pure-JS and ships on the next business NATIVE build, NOT `eas update`).

---

## 1. Summary (plain English)

ORCH-1332: tapping "Set up your first partner brand" on the partner Brands empty state or the partner Earnings nudge used to dead-end on a "Brand not found" screen. It now opens the real brand-creation wizard, pre-flagged for a client (partner) setup, ending in the "Invite the owner" step. Fixed by adding the missing `/brand/new` route file (which was being swallowed by the dynamic `/brand/[id]` route) plus a small race-hardening so the client mode still applies if the partner flag loads a beat late.

ORCH-1333: the two partner pages now look like the rest of the business app — the close button is the correct thin ✕ (was a filled letterform "X"), the header is the standard close-left centred-title chrome (the orange "MINGLA PARTNER" eyebrow is gone), the canvas matches the app's cool near-black, and every button is the shared pill `<Button>`. Two unrelated screens that also used the wrong ✕ glyph (trip Cancel row, venue-wizard close) were corrected in the same pass.

---

## 2. SPEC success-criteria coverage

### ORCH-1332 (INVESTIGATION §11)
| SC | Criterion | Verified how | Result |
|----|-----------|--------------|--------|
| SC-1 | `app/brand/new.tsx` exists, renders BrandCreationFlow (not the profile view) | New file + jest `orch1332…` SC-1 (readFileSync contains `BrandCreationFlow`, not `BrandProfileView`) | ✓ `b6765d26` |
| SC-2 iOS/Android | Brands empty-state CTA opens client-mode wizard | Route now resolves; CTA target string bound (jest SC-2/SC-3). Runtime tap = tester | ✓ source; runtime UNVERIFIED (tester) |
| SC-3 iOS/Android | Earnings nudge CTA opens client-mode wizard | Same route; `router.push` target preserved verbatim | ✓ source; runtime UNVERIFIED (tester) |
| SC-4 | `/brand/new` resolves to the new static route (wins over dynamic `[id]`); never "Brand not found" | Static file added; expo-router static>dynamic precedence (deterministic). Runtime = tester (SC-4) | ✓ source; runtime UNVERIFIED (tester) |
| SC-5 | Completing client path creates one `partner_brand_links` row + ORCH-1329 email | Backend path unchanged (F-4); no code change. Live-fire = tester | UNVERIFIED (tester, live-fire) |
| SC-6 | Cold/direct open still lands `mode='client'` once `isPartner` resolves | F-2 `else if` re-apply branch (jest SC-6) | ✓ `b6765d26` |
| SC-7 | No-silent-failure preserved (inline Retry / error Toast intact) | BrandCreationFlow error paths untouched | ✓ |

### ORCH-1333 (DESIGN §2 D1–D5, §7)
| Item | Criterion | Result |
|------|-----------|--------|
| D1 | Close glyph `icon="x"` → `icon="close"`, `size={36}`, label+testID preserved | ✓ both partner files |
| D2 | Canonical ChromeRow header (close-left, centred title, right spacer); `MINGLA PARTNER` eyebrow removed; brands keeps count sub-line | ✓ (full match built as approved) |
| D3 | `canvas.profile` → `canvas.discover` on `safe` (both) | ✓ |
| D4 | Bespoke `primaryBtn`/`secondaryBtn` Pressables → shared `<Button>`; CTA handlers preserved verbatim | ✓ |
| D5 | `radius="md"` on every elevated GlassCard (both) | ✓ (12 cards in earnings, 3 in brands) |
| §5.4 | brands `thumbFallback` → `accent.tint` bg + `accent.warm` initials (removes raw `#FFFFFF`) | ✓ |
| §7A | `TripManageMenu.tsx` Cancel-trip Row `icon="x"`→`"close"` (only) | ✓ |
| §7B | `VenueCreatorWizard.tsx` header close `icon="x"`→`"close"` (only) | ✓ |

---

## 3. Files changed (per-file diff intent)

**NEW `mingla-business/app/brand/new.tsx`** (+61)
- **Before:** no file → `/brand/new` fell through to `app/brand/[id]` with `id="new"` → null brand → "Brand not found".
- **Now:** default-export `BrandNewRoute` mounts `<BrandCreationFlow onComplete onCancel />` inside a top-safe `View` (`paddingTop: insets.top`, `canvas.discover`, mirroring `app/brand/[id]/index.tsx`). `partner_mode` is read by the flow itself via `useLocalSearchParams` (route does not forward it). complete/cancel pop the route (`router.back()` else `replace("/(tabs)/account")`) — the sheet's `onComplete={() => onClose()}` semantics.
- **Why:** F-1 root cause (add the missing static route ahead of the dynamic segment). Investigation §10.1.

**`mingla-business/src/components/brand/BrandCreationFlow.tsx`** (+20 / -0)
- **Before:** the post-mount promote-effect only promoted a late partner to step 0 when `partnerModeParam !== "client"`; a late `isPartner` did NOT re-apply client mode when the param WAS `"client"` → cold/deep-link opens could stick in self-mode (no invite step).
- **Now:** added an `else if` branch: `isPartner && partnerModeParam === "client" && step===1 && mode==="self" && name==="" && bio===""` → `setState(prev => ({ ...prev, mode: "client" }))`. Existing branch unchanged; both gated on "user hasn't typed." No copy/steps/reducer change.
- **Why:** F-2 hardening. Investigation §10.2.

**`mingla-business/app/partner/brands.tsx`** (reskin)
- Import: **+`Button`**, **−`glass`, −`radius`** (both became unused after the bespoke-button-style deletion).
- Header (§4.1): eyebrow+h1+right-X → close-left ChromeRow (`icon="close"`), centred `headerMid` title "Brands" + `headerSub` count, empty `headerRightSlot`. `handleClose`/label/testID preserved.
- Error card: `radius="md"`; Retry Pressable → `<Button variant="secondary" size="md">`.
- Empty card: `radius="md"`; CTA Pressable → `<Button variant="primary" size="md" fullWidth trailingIcon="chevR">`, **`onPress={handleSetUpFirst}` preserved verbatim** (forensics-owned target).
- `BrandLinkRow` GlassCard: `radius="md"`.
- `safe.backgroundColor`: `canvas.profile` → `canvas.discover`.
- Styles: deleted `eyebrow`/`h1`/`headerMeta`/`headerTextCol`/`primaryBtn`/`primaryBtnText`/`secondaryBtn`/`secondaryBtnText`; added `headerMid`/`headerTitle`/`headerSub`/`headerRightSlot`; `thumbFallback` bg → `accent.tint`, `thumbFallbackText` → `accent.warm`.

**`mingla-business/app/partner/earnings.tsx`** (reskin)
- Import: **+`Button`**, **−`shadows`** (unused after `primaryBtn` deletion; `radius`/`glass` KEPT — still used by inlineError/filter/badge/split/welcome/currency styles).
- Header (§4.2): → close-left ChromeRow (`icon="close"`), centred title "Earnings", right spacer. Label/testID preserved.
- All 12 elevated GlassCards: `radius="md"`.
- Status-error Retry Pressable → `<Button variant="secondary">`.
- `ReadyToEarnNudge` CTA Pressable → `<Button variant="primary" fullWidth trailingIcon="chevR">`, **`router.push("/brand/new?partner_mode=client")` preserved verbatim**.
- `StatusBlock` (§6.5): active → primary "Manage Stripe account" `<Button loading={managing}>` + secondary "Disconnect Stripe" `<Button labelStyle={{color: semantic.error}} loading={disconnecting}>`; restricted+onboarding → primary "Resume onboarding" `<Button loading={starting}>`; not_connected → primary ternary label `<Button loading={starting} disabled={connectDisabled}>`. All gating logic (`connectDisabled`/`managing`/`disconnecting`) fed into `disabled` unchanged. `BrandStripeCountryPicker` + `inlineError` pill untouched.
- `safe.backgroundColor`: `canvas.profile` → `canvas.discover`.
- Styles: deleted `eyebrow`/`h1`/`headerTextCol`/`primaryBtn`/`primaryBtnDisabled`/`primaryBtnText`/`secondaryBtn`/`secondaryBtnText`/`secondaryBtnTextDanger`; added `headerMid`/`headerTitle`/`headerRightSlot`; kept `countryPickerWrap` + all splits/filter/badge/nudge/welcome styles. `ORCH-1054`/`usePartnerSplits`/`usePartnerEarningsSummary`/`PartnerSplitsSection` tokens preserved (ORCH-1054 gate).

**`mingla-business/src/components/trip/TripManageMenu.tsx`** (1 line): Cancel-trip Row `icon="x"` → `icon="close"`.
**`mingla-business/src/components/venue/VenueCreatorWizard.tsx`** (1 line): header IconChrome `icon="x"` → `icon="close"`.

**NEW `mingla-business/__tests__/routes/orch1332PartnerBrandNewRoute.test.ts`** — ORCH-1332 regression (4 assertions).
**NEW `mingla-business/__tests__/partner/orch1333PartnerReskin.test.ts`** — ORCH-1333 regression (4 assertions).

---

## 4. Data-model / edge-function changes
**None.** No migration, no edge deploy, no schema change. `inviteBrandMember` → `invite-brand-member` → `partner_brand_links` are complete and untouched (Investigation F-4). No DO-NOT-TOUCH file was modified.

---

## 5. Gate results (actual output)

- **New jest suites:** `Test Suites: 2 passed, 2 total · Tests: 8 passed, 8 total` (post-restore final run).
- **TypeScript (`npx tsc --noEmit`):** ZERO errors in any of the 8 touched files (verified by filtering tsc output for each path → "NONE — all my files are type-clean"). The worktree's overall tsc baseline is environmentally red (~756 pre-existing errors, all in files I never touched — unresolved `react`/`react-dom` module types resolving against the anchor `node_modules`, `packages/phone-input/*`, checkout implicit-anys, etc. — a known worktree node_modules condition, not this diff).
  - Two errors were genuinely introduced by the reskin and FIXED before commit: the Button primitive's `onPress` is typed `void | Promise<void>` (stricter than the old `Pressable`'s `void`), so `() => linksQuery.refetch()` / `() => statusQuery.refetch()` (each returns `Promise<QueryObserverResult>`) failed TS2322. Wrapped as `() => { void linksQuery.refetch(); }` — the codebase's canonical Button idiom (identical to `app/brand/[id]/index.tsx` `onRetry`). See §7 deviation D-1.
- **strict-grep partner gates:** `ORCH-1052 strict-grep PASS` · `ORCH-1054 strict-grep PASS` · `ORCH-1117 R1 PASSED` (only scans `PublicEventPage.tsx`, irrelevant).
- **I-38 IconChrome touch-target gate:** `I-38 gate: scanned 523 .tsx files · 0 violations · 0 warnings · 0 parse failures` (ran with `npm install --no-save @babel/parser @babel/traverse`, mirroring the CI job's install step; the close-glyph swaps keep `size={36}` + baked hitSlop = 44pt).
- **Lint (`eslint` on changed files):** the only errors are 6 pre-existing `react/no-unescaped-entities` on apostrophes in JSX text (2 in brands, 4 in earnings) + 1 pre-existing `react-hooks/exhaustive-deps` warning in VenueCreatorWizard (line 487, far from my line-579 change). Baseline counts on origin/main are IDENTICAL (verified via `git show HEAD:… | eslint --stdin`: brands 2, earnings 4) → my diff introduces ZERO new lint findings. `expo lint`/eslint is NOT a blocking CI gate (no workflow runs it).
- **App-wide `icon="x"`:** now `0` (was 4). No consumer-app (`app-mobile`) file touched.

---

## 6. Regression tests + fails-on-revert proofs

**ORCH-1332 — `mingla-business/__tests__/routes/orch1332PartnerBrandNewRoute.test.ts`** (append-only, new)
Revert proof (true deletion): `rm app/brand/new.tsx` + `git checkout HEAD~1 -- BrandCreationFlow.tsx` (removes the F-2 branch) → `Tests: 2 failed, 2 passed` (SC-1 route-exists RED — readFileSync throws; SC-6 F-2 branch RED). Restore → `2 passed`.
**`fails-on-revert verified at b6765d26`.**

**ORCH-1333 — `mingla-business/__tests__/partner/orch1333PartnerReskin.test.ts`** (append-only, new)
Revert proof (true deletion): `git checkout HEAD~1 -- brands.tsx earnings.tsx TripManageMenu.tsx VenueCreatorWizard.tsx` (restores `icon="x"`, `MINGLA PARTNER`, `canvas.profile`, `primaryBtnText`) → `Tests: 4 failed, 4 total`. Restore → `4 passed`.
**`fails-on-revert verified at b6765d26`.**

Both new test files appear in `git diff origin/main...HEAD --name-only` (shipped in the same branch as the fix).

---

## 7. Spec deviations (with justification)

**D-1 (ORCH-1332 non-issue / ORCH-1333 §5.2 & §6.3 literal):** the DESIGN spec wrote the Retry buttons as `onPress={() => linksQuery.refetch()}` / `onPress={() => statusQuery.refetch()}`. Rendered on the shared `<Button>` (whose `onPress` return type is `void | Promise<void>`, stricter than the old `Pressable`'s `void`), those forms fail TS2322 because `refetch()` returns `Promise<QueryObserverResult>`. Adapted to `onPress={() => { void linksQuery.refetch(); }}` — behavior-identical (refetch on press), zero copy/UX change, and the exact idiom already used for the same primitive at `app/brand/[id]/index.tsx` `onRetry`. Minimal, type-clean, in-spirit.

**No other deviations.** D2 built as the approved FULL match (eyebrow + hero title removed, no partner marker retained). All CTA `onPress` handler references preserved verbatim (§12 merge-safety). No file outside the combined allowlist was touched.

---

## 8. Cross-surface impact

| Surface | Affected | Behavior | Parity |
|---------|----------|----------|--------|
| Consumer iOS | No | different app (`app-mobile`) | — |
| Consumer Android | No | different app | — |
| Buyer/anon Web | No | not a partner surface | — |
| **Business iOS** | **Yes** | route fix + partner-pages reskin + 2 close-glyph swaps | shared code → auto with Android |
| **Business Android** | **Yes** | same | shared code → auto with iOS |
| Admin Web | No | not involved | — |
| Business Web preview | Incidental | same RN code renders on business web (secondary; GlassCard opaque fallback + Button hover already handled by shared primitives) | shared |

Parity across business iOS/Android is automatic (one RN codebase). No manual parity split.

---

## 9. Smoke result
No sim/device run this phase (business app is OTA-FROZEN; a device repro needs an EAS cloud dev build — tester's phase). Verification is source-contract + type + gate level, all green. Runtime SCs (SC-2/3/4/5) are UNVERIFIED pending the tester's business dev build (iOS + Android), per Investigation §11/§17.

## 10. Known issues / deferred
- **OQ-1 (Investigation §16) — left AS-IS per spec.** Client-mode step 5 sets a success toast inside BrandCreationFlow then `onComplete` pops the route, so the toast may not render on the destination (identical to the pre-existing sheet behavior, ORCH-1081). Surfacing a post-return confirmation on `/partner/brands` is partner-page UX = out of ORCH-1332/1333 scope. Not changed. Flagged for the orchestrator.
- No `[TRANSITIONAL]` code introduced.

## 11. Operator action required
- **No migration, no edge deploy.**
- **Delivery:** pure-JS `mingla-business` change; business OTA is FROZEN (COMMS-0063). Ships on the **next business NATIVE build** (`eas build` iOS+Android → TestFlight/Play), NOT `eas update`. Orchestrator's CLOSE concern.
- Route back to orchestrator for REVIEW → tester (business dev build, adversarial §11 + §7 latent-swap visual check).

## 12. Discoveries for Orchestrator
- **Pre-existing red test on main:** `src/components/venue/__tests__/VenueCreatorWizard.ve2.test.ts` asserts `expect(src).toContain("CoverPickerSheet")`, but `CoverPickerSheet` has **0 occurrences** in `VenueCreatorWizard.tsx` on BOTH the current file and origin/main HEAD — so this suite is already RED on main, independent of my one-line icon swap (which is nowhere near CoverPickerSheet). Append-only rules forbid me editing it; needs its own follow-up (a `[TEST-MOD-APPROVED ORCH-…]` or a source fix).
- **Pre-existing lint debt:** `react/no-unescaped-entities` on JSX-text apostrophes in both partner pages (2 brands / 4 earnings) predates this ORCH; not fixed (scope). Candidate cleanup.
- **Worktree tsc baseline is environmentally red** (~756 errors from unresolved `react`/`react-dom` types + `packages/phone-input`); a clean `npm ci` in this worktree would likely clear most. Not blocking (my files are clean).
- **COMMS status honored:** COMMS-0052 is RESOLVED (superseded); COMMS-0063 (business OTA brick, `to: ORCH-1254`) and COMMS-0087 (TS pin, RESOLVED) noted — no OPEN BLOCK addressed to ORCH-1332/1333/implementor/ALL required action; I deploy nothing.
