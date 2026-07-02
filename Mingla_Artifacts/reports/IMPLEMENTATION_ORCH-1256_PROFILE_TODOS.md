# IMPLEMENTATION — ORCH-1256 [brand profile completion to-dos]

**Date:** 2026-07-01
**Worktree:** `~/Desktop/mingla-orchs/orch-1256-[brand-profile-todos]` on branch `orch-1256-brand-profile-todos` (rebased onto `origin/main` head `a207087f2` before work).
**Binding contract:** `Mingla_Artifacts/specs/SPEC_ORCH-1256_PROFILE_TODOS.md` (ratified: socials = ONE aggregated row shown only when ALL 8 networks blank; address row unconditional).
**Status:** implemented and verified (unit/source/gate layers); runtime deep-link scroll + capacity + vanish (T-10/T-11/T-12) are tester-owned per spec §7.
**Comms ledger:** scanned on entry. COMMS-0052 (BLOCK, ALL — business OTA frozen) already ACKNOWLEDGED and honored: NO `eas update`; ship path is Vercel web (`[deploy]` at CLOSE) + next native build. No ledger write (dispatch forbids main pushes from this skill).

---

## 1. Summary

After creating a brand, the Home and Hub to-do lists now grow one row per EMPTY profile field — cover, profile photo, tagline, description, address, contact email, contact phone, and ONE aggregated "Add your social links" row (only when all 8 networks are blank). The rows sit at the tail (below every revenue/liveness row), each tap opens the brand edit page scrolled to the matching section via a new `?section=` deep-link, and each row vanishes the moment its field is filled. Because the list can now hit ~11 rows, the toggle's row list is bounded (maxHeight 320) and scrolls internally so the dashboard stays reachable.

## 2. SPEC success-criteria coverage

Parity automatic (one shared RN codebase) — single row per SC.

| SC | Criterion | Verification | Status | Commit |
|----|-----------|--------------|--------|--------|
| SC-1 | fresh brand → 8 rows, §4.2 order, after structural rows | T-1/T-1b/T-2 unit tests PASS | ✓ | b343fe144 |
| SC-2 | tap → `/brand/{id}/edit?section=<key>` scrolled to section | route strings asserted (T-1); anchor+scroll mechanism source-contract test PASS; live scroll = tester T-10 | ✓ code / runtime UNVERIFIED (tester) | b343fe144 |
| SC-3 | filling a field removes exactly that row | T-3 8-way matrix PASS (derivation); React Query invalidation path untouched; runtime = tester T-12 | ✓ code / runtime tester | b343fe144 |
| SC-4 | whitespace-only counts as EMPTY | isBlank + T-4 unit tests PASS | ✓ | b343fe144 |
| SC-5 | socials aggregation (all-empty → 1 row; any one filled → absent) | T-5 + per-network 8-case matrix + T-6 custom-only PASS | ✓ | b343fe144 |
| SC-6 | no loading flash | T-8 (brandResolving/!hasBrand → `[]`) + hook gates `currentBrand !== null && !isBrandResolving`; structural (band 6 after early-returns) | ✓ | b343fe144 |
| SC-7 | 9+ rows → maxHeight 320 internal scroll, count label true N | `listBounded {maxHeight:320}` + existing `headerCountLabel` untouched; visual = tester T-11 | ✓ code / runtime tester | b343fe144 |
| SC-8 | existing 3 test files pass UNMODIFIED | `git diff origin/main` shows zero changes to them; all 3 suites PASS (see §7) | ✓ | — |
| SC-9 | no changed lines in BrandEditView :501–539 | `git diff -U0` hunk map: changed old-side lines are 24, 33, 78, 247, 256, 259, 451, 463, 499, 542, 573, 634, 656, 688 — none in 501–539; block-intact test + gate assert no anchor inside the block | ✓ | b343fe144 |
| SC-10 | `?section=bogus`/absent → renders at top, no crash | closed-set validator → `undefined` → latch never arms; T-9 source-contract PASS | ✓ | b343fe144 |

## 3. Files changed

| File | Δ | Commit |
|------|---|--------|
| `mingla-business/src/utils/brandProfileCompleteness.ts` | NEW, +92 | b343fe144 |
| `mingla-business/src/utils/businessTodos.ts` | +95/−1 (optional `profile` input + band 6) | b343fe144 |
| `mingla-business/src/hooks/useBusinessTodos.ts` | +19/−0 (derive + pass + deps) | b343fe144 |
| `mingla-business/src/components/home/BusinessTodoToggle.tsx` | +16/−3 (bounded ScrollView list) | b343fe144 |
| `mingla-business/src/components/brand/BrandEditView.tsx` | +112/−7 (type, prop, ref, latch, 6 anchors) | b343fe144 |
| `mingla-business/app/brand/[id]/edit.tsx` | +34/−1 (`?section=` read/validate/pass) | b343fe144 |
| `mingla-business/src/utils/__tests__/brandProfileCompleteness.test.ts` | NEW, +148 | 4ef5d8b1f |
| `mingla-business/src/utils/__tests__/businessTodos.profile.test.ts` | NEW, +203 | 4ef5d8b1f |
| `mingla-business/src/components/brand/__tests__/brandEditView.section.orch1256.test.ts` | NEW, +102 | 4ef5d8b1f |
| `.github/scripts/strict-grep/orch-1256-profile-todos-no-false-positive.mjs` | NEW, +325 | eabc9dd89 |
| `.github/workflows/strict-grep-mingla-business.yml` | +15/−0 (PURE APPEND: 1 registry comment line + 1 job; zero deleted lines; `js-yaml` parse OK) | eabc9dd89 |

Total: 6 product files, 3 new test files, 2 CI files. No other file touched (`git diff origin/main...HEAD --name-only` = exactly these 11 + this report).

## 4. Data-model changes applied

None. No migrations, no RLS, no schema. All data already fetched + mapped (investigation F-1).

## 5. Edge functions touched

None. Nothing to deploy.

## 6. Regression tests added

- `src/utils/__tests__/brandProfileCompleteness.test.ts` — 15 tests (isBlank contract; fresh/filled/hue-only; T-4 whitespace; T-5 + 8-network suppression matrix; T-6 custom-only; key-set lock; F-7 bio-only).
- `src/utils/__tests__/businessTodos.profile.test.ts` — 14 tests (T-1 order+routes, T-1b exact copy + no badge, T-2 tail placement, T-3 8-way no-false-positive matrix, all-false → `[]`, T-7 optional-input, T-8 gating).
- `src/components/brand/__tests__/brandEditView.section.orch1256.test.ts` — 11 tests (BrandEditSection export + prop; ref/latch/scrollTo; exactly-one-anchor per section ×6; 1255-block has NO anchor + markers intact; T-9 route param read/validate/pass).

**fails-on-revert verified at b343fe144.** Procedure (true LINE DELETION, not comment-out): deleted the entire band-6 block from `businessTodos.ts` → `businessTodos.profile.test.ts` FAILED (`Tests: 11 failed, 3 passed, 14 total`) and the strict-grep gate printed violations (`band 6 must emit id "profile_add_cover" …`) → `git checkout --` restore → re-run `Tests: 14 passed, 14 total` + gate PASS. Additional revert coverage encoded in the gate self-test (trim drop, predicate bypass, required-input flip, missing anchor, anchor-in-1255-block, validator bypass, unbounded list — 10/10).

Append-only: all three test files are NEW; `git diff origin/main` contains zero deleted lines in any existing test file — no `[TEST-MOD-APPROVED]` token needed.

## 7. Verbatim gate/test outputs

Full suite (new + the three protected existing suites, UNMODIFIED):

```
PASS src/components/brand/__tests__/brandEditView.section.orch1256.test.ts
PASS src/utils/__tests__/businessTodos.test.ts
PASS src/utils/__tests__/businessTodos.profile.test.ts
PASS src/utils/__tests__/brandProfileCompleteness.test.ts
PASS src/components/home/__tests__/BusinessTodoToggle.test.ts
PASS src/utils/__tests__/businessTodos.invite.test.ts

Test Suites: 6 passed, 6 total
Tests:       87 passed, 87 total
```

Fails-on-revert (band-6 line-deleted):

```
Test Suites: 1 failed, 1 total
Tests:       11 failed, 3 passed, 14 total
```

Strict-grep gate:

```
[ORCH-1256 — orch-1256-profile-todos-no-false-positive] SELF-TEST PASS (10/10)
[ORCH-1256 — orch-1256-profile-todos-no-false-positive] PASS — trim-blank predicates, band-6 rows, section anchors, param validation and the bounded list are all in place.
```

tsc (`npx tsc --noEmit` in mingla-business): 879 error lines, ZERO in any ORCH-1256 file (`grep` over the output for the 6 changed/3 new paths → no hits). All errors pre-exist on origin/main by construction (this branch = origin/main + the commits above, and none of the erroring files are touched by this diff). Corroboration: the anchor `main` checkout produces the same baseline (870 lines; the ±9 delta is another session's uncommitted anchor edits in `buyer.tsx`/`app.config.ts`/`account.tsx`/`packages/offering-rendering` — none of them ORCH-1256 files).

Web sanity: `npx expo export -p web --output-dir web-build --clear` run from the worktree (result appended in §10/Smoke). Mechanism note: on web `SmartScrollView` IS react-native-web `ScrollView` (`src/wrappers/SmartScrollView.tsx:11`), which supports `ref.scrollTo` and `onLayout`; no native-only API was introduced (`LayoutAnimation`/`UIManager` in the toggle predate this ORCH).

## 8. Old → New receipts

### brandProfileCompleteness.ts (NEW)
**Before:** didn't exist; no profile-emptiness derivation anywhere.
**Now:** exports `isBlank` (single trim-based blank test), `SOCIAL_TODO_KEYS` (8 named networks, local mirror of brandMapping's SOCIAL_KEYS with sync comment), `BusinessTodoProfileInput`, `deriveBrandProfileTodoInput(brand)` per the SPEC §4.1 predicate table (coverHue ≠ cover; `links.custom` ignored).
**Why:** SC-4/SC-5 + keeps businessTodos.ts free of Brand coupling. ~92 lines.

### businessTodos.ts
**Before:** bands 0–5 only (invites → brand gate → venue → claim → offering → Stripe → finish_draft); no profile rows.
**Now:** identical bands 0–5 byte-for-byte; new OPTIONAL `profile?: BusinessTodoProfileInput & { editRoute: string }` input; new band 6 appended after `finish_draft`, before `return todos`, emitting the 8 `profile_add_*` rows in fixed order with EXACT spec labels/sublabels, no badge, each `{ kind: "route", route: `${editRoute}?section=<key>` }`.
**Why:** SC-1/SC-3/SC-6 tail placement + F-5 optionality. ~95 lines.

### useBusinessTodos.ts
**Before:** assembled bands 0–5 inputs only.
**Now:** memoized `profile` = `currentBrand !== null && !isBrandResolving ? { ...deriveBrandProfileTodoInput(currentBrand), editRoute: '/brand/{id}/edit' } : undefined`; passed into `buildBusinessTodos`; `profile` added to the outer useMemo deps. No new loading state.
**Why:** SC-6 no-flash gating (spec §4.3). ~19 lines.

### BusinessTodoToggle.tsx
**Before:** expanded rows in an unbounded plain `View` — 11 rows would bury the dashboard (mounted above the screen scroll area).
**Now:** rows render inside RN `ScrollView` `style={[styles.list, styles.listBounded]}` with `nestedScrollEnabled` + visible indicator; `listBounded: { maxHeight: 320 }` (≈6 rows) with ORCH-1256 comment. All contract locks intact: `if (count === 0) return null;`, `useState<boolean>(true)`, `todos.map(`, `onPress={() => onAction(todo)}`, badge rendering, NO `.sort(`/`.filter(`, header label untouched.
**Why:** SC-7 / F-4. ~16 lines.

### BrandEditView.tsx
**Before:** no scroll-to-section: no ref, no anchors, no param awareness.
**Now:** exports `BrandEditSection`; optional `initialSection` prop; `scrollRef` on the populated `<ScrollView>`; `pendingSectionRef` fire-once latch; `handleSectionLayout(section)` onLayout factory → `scrollTo({ y: max(0, layout.y − 8), animated: true })`; six anchors — photo (anchor `View` wrapping the photo GlassCard), ABOUT / BRAND COVER / ADDRESS / CONTACT / SOCIAL LINKS section-label `Text`s. PHYSICAL LOCATION block (old :501–539) has zero changed lines and zero anchors (verified 3 ways: diff hunk map, source-contract test, CI gate).
**Why:** SC-2/SC-9/SC-10. ~112 lines (mostly comments + JSX reflow of 5 labels).

### app/brand/[id]/edit.tsx
**Before:** read only `{ id }` from search params.
**Now:** reads `section` too, normalizes array form (house pattern, listing.tsx), validates via module-level `isBrandEditSection` type-guard (closed 6-value set; anything else → `undefined`), passes `initialSection` into `<BrandEditView>`.
**Why:** SC-2/SC-10 (spec §4.5). ~34 lines.

### .github (gate + workflow)
**Before:** no CI guard for any leg of this feature (business jest suite does not run in CI — investigation D-2).
**Now:** registry-pattern gate `orch-1256-profile-todos-no-false-positive.mjs` (self-tested 10/10, asserts §9(a)–(e)); ONE job appended to `strict-grep-mingla-business.yml` + one registry comment line — zero existing lines modified/deleted.
**Why:** spec §9 / CLOSE hard-must. ~340 lines.

## 9. Cross-surface impact

| # | Surface | Affected | Parity | Note |
|---|---------|----------|--------|------|
| 1 | Consumer iOS (app-mobile) | NO | — | no businessTodos/BrandEditView code there |
| 2 | Consumer Android (app-mobile) | NO | — | same |
| 3 | Buyer/anon Web | NO | — | anon routes never mount (tabs) Home/Hub or /brand/[id]/edit |
| 4 | Business iOS | YES | automatic (shared RN) | rows + deep-link scroll + bounded list |
| 5 | Business Android | YES | automatic (shared RN) | identical |
| 6 | Admin Web | NO | — | separate app |
| 7 | Business Web preview (Vercel) | YES | automatic (SmartScrollView web = RN ScrollView; scrollTo/onLayout supported) | identical |

No manual-parity surface; no dispatcher (`home.tsx`/`hub/_layout.tsx`) change needed — profile rows reuse the existing `route` arm.

## 10. Smoke result

- Unit/source: 87/87 jest (6 suites) in the worktree; strict-grep gate PASS + self-test 10/10; tsc clean for all ORCH-1256 files.
- Web export (`npx expo export -p web --output-dir web-build --clear`) from the worktree: **completed, exit 0** (`Exported: web-build`) — bundling sanity green; only `react-native` core symbols were added (`ScrollView`, `LayoutChangeEvent` type), and on web SmartScrollView IS RN-web ScrollView (scrollTo/onLayout supported).
- Simulator runtime NOT exercised this session (no booted device reserved; T-10/T-11/T-12 are explicitly tester-owned runtime cases per SPEC §7, and biz-web authed runtime caps claims per house memory). Labelled honestly: code-verified, runtime pending TEST phase.

## 11. Known issues / deferred

- None `[TRANSITIONAL]`. maxHeight 320 is a tuneable constant (SPEC OQ-3 — designer eyeball optional).
- OQ-1 (address row for ALL brands, even non-physical) shipped as ratified; flip is a one-line predicate change if Seth reverses.

## 12. Operator action required

- No migration (`db push` N/A). No edge deploy. No OTA (COMMS-0052).
- CLOSE: PR to main with all checks green; `[deploy]` tag for Vercel; flip I-PROPOSED-1256-PROFILE-TODOS-NO-FALSE-POSITIVE → ACTIVE; coordinate merge order with META-ORCH-1255 (shared `BrandEditView.tsx`; whoever lands second rebases — 1256's diff leaves :501–539 context-only).

## 13. Deviations from spec

1. **Photo anchor is a wrapper `View`, not `onLayout` on the GlassCard itself.** Spec §4.6(4) said "Photo GlassCard (:464)", but `GlassCard` (`src/components/ui/GlassCard.tsx`) does not accept/forward `onLayout` (closed prop set, no rest-spread), and extending GlassCard is outside the allowlist. A zero-style anchor `View` wrapping the card is a direct child of the scroll content container, so `layout.y` is in the correct coordinate space (≈0, matching the spec's own "photo scrolls to y≈0" note). Behavior identical to the spec's intent; no visual change (stretch-aligned unstyled View).
2. Nothing else — labels, ids, order, routes, gating, maxHeight, file set and DO-NOT-TOUCH boundaries are exactly per spec.

## 14. Discoveries for Orchestrator

- **D-1 (pre-existing, low):** `mingla-business` tsc baseline is ~870–880 error lines on main (untyped `packages/phone-input`, checkout buyer routes, duplicate keys in `app.config.ts`, missing `@testing-library/react-native` types). None block this ORCH, but a typecheck-debt ORCH would make future "tsc clean" gates meaningful.
- **D-2 (echo of investigation):** business jest suite still not CI-blocking (only featureFlags runs) — this ORCH self-covers via the strict-grep gate, but the program-level gap stands.
- **D-3 (anchor hygiene):** the shared anchor `~/Desktop/mingla-main` carries uncommitted edits (buyer.tsx / app.config.ts / account.tsx / offering-rendering) from another session — the ±9 tsc-baseline delta above. No action taken from this skill; flagged for whoever owns that lane.
