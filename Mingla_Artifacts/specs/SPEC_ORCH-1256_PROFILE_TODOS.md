# SPEC — ORCH-1256 [brand profile completion to-dos]

**Binding contract.** Investigation basis: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1256_PROFILE_TODOS.md` (same worktree, findings F-1…F-7 all addressed below).
**Worktree:** `~/Desktop/mingla-orchs/orch-1256-[brand-profile-todos]` on branch `orch-1256-brand-profile-todos`.
**Ship path:** business web via Vercel (`[deploy]` commit tag at CLOSE); native rides the NEXT business build. **NO `eas update`** (COMMS-0052 BLOCK).

---

## 1. Executive summary

After a user creates a brand in mingla-business, the Home/Hub to-do list gains one row per EMPTY brand-profile field — cover, profile photo, tagline, description, address, contact email, contact phone, and ONE aggregated "Add your social links" row when all eight social networks are empty. Each row deep-links into the matching section of the existing brand edit page via a new `?section=` query param that scrolls the page to that section. Rows vanish the moment the field is filled (the list's existing "vanish when done" contract). Because the list can now reach ~11 rows, the toggle's row list gets a minimal bounded height with internal scrolling so it never buries the dashboard.

**Interpretation confirmed as part of this contract (per dispatch):** social links are ONE aggregated row shown only when ALL of `links.{website,instagram,tiktok,x,facebook,youtube,linkedin,threads}` are empty — eight per-network rows would be absurd; a single filled network suppresses the row. `links.custom` is ignored by the predicate (no UI can author it — custom-links UI is deferred per `BrandEditView.tsx:19`).

## 2. Scope & non-goals

**In scope**
- New priority band 6 (tail) in `buildBusinessTodos` emitting up to 8 `profile_*` rows.
- Pure predicate util deriving the 8 booleans from a `Brand` record (trim-empty = empty).
- Hook wiring in `useBusinessTodos` (full brand record already available — investigation F-1).
- `?section=` deep-link param on `/brand/[id]/edit` + scroll-to-section mechanism in `BrandEditView` (minimal: onLayout anchor map + fire-once `scrollTo`).
- Bounded-height, internally-scrollable row list in `BusinessTodoToggle` (capacity fix, F-4).
- New test files + strict-grep CI gate.

**Non-goals (explicitly out)**
- **The venue/physical-location toggle in BrandEditView — belongs to META-ORCH-1255.** 1255 edits `BrandEditView.tsx` lines ~501–539. This ORCH MUST NOT touch that region (F-6). Anchors are placed only at :464 (Photo card), :542 (ABOUT), :573 (BRAND COVER), :634 (ADDRESS), :656 (CONTACT), :688 (SOCIAL LINKS) — all outside :501–539. No reformatting, no whitespace churn inside :501–539.
- No edit-page redesign: no section reordering, no new fields, no copy changes to existing sections.
- No per-row icons: `BusinessTodo` has no icon field and the renderer renders none (F-7) — do NOT add one.
- No new `BusinessTodoAction` kinds; profile rows use the existing `{ kind: "route" }` arm — dispatchers in `home.tsx` / `hub/_layout.tsx` are untouched.
- No changes to `brandMapping.ts`, no migrations, no edge functions, no consumer/admin code.
- No changes to existing test files (append-only gate, F-5).

**Assumptions:** `currentBrand` from `useCurrentBrand()` is the full mapped record (proven F-1); the SmartScrollView ref forwards to a scrollable on both platforms (proven F-3).

## 3. Cross-Surface Impact Declaration

| # | Surface | Covered? | Behavior demanded | Files | Parity |
|---|---------|----------|-------------------|-------|--------|
| 1 | Consumer iOS (`app-mobile`) | NOT covered | — | — | no businessTodos/BrandEditView code exists there |
| 2 | Consumer Android (`app-mobile`) | NOT covered | — | — | same |
| 3 | Buyer/anonymous Web (`/checkout/*`, `/e/*`, `/b/*`, `/t/*`) | NOT covered | — | — | anon routes never mount (tabs) Home/Hub or `/brand/[id]/edit` |
| 4 | Business iOS | COVERED | profile rows on Home+Hub; tap → edit page scrolled to section; rows vanish when filled | all files in §12 allowlist | automatic (shared RN) |
| 5 | Business Android | COVERED | identical | same | automatic (shared RN) |
| 6 | Admin Web (`mingla-admin`) | NOT covered | — | — | separate app, no shared to-do code |
| 7 | Business Web preview (Vercel) | COVERED | identical; `scrollTo` works on react-native-web ScrollView | same | automatic (shared RN; SmartScrollView web = RN ScrollView) |

## 4. Layered specification

Database / edge / service / realtime: **untouched** (all data already fetched + mapped; F-1).

### 4.1 NEW pure util — `mingla-business/src/utils/brandProfileCompleteness.ts`

Keeps `businessTodos.ts` free of `Brand` type coupling (its documented file contract, `businessTodos.ts:7-8`). Exports:

- `isBlank(value: string | null | undefined): boolean` — `value == null || value.trim().length === 0`. **Trim-empty and whitespace-only count as EMPTY. This predicate is used for EVERY field below, no exceptions** (load-bearing for `address`/`photo`/`coverMediaUrl`, which map untrimmed — F-2; belt-and-braces for the pre-trimmed rest).
- `SOCIAL_TODO_KEYS` — the 8 named network keys `["website","instagram","tiktok","x","facebook","youtube","linkedin","threads"]` (mirror `SOCIAL_KEYS` in `brandMapping.ts:134-143`; do NOT import from brandMapping — that file is DO-NOT-TOUCH — declare locally with a sync comment).
- `deriveBrandProfileTodoInput(brand: Brand): BusinessTodoProfileInput` returning exactly:

| Field | Predicate (true = row shows) |
|-------|------------------------------|
| `needsCover` | `isBlank(brand.coverMediaUrl)` — coverHue fallback gradient is NOT a cover; hue-only brands still need a cover |
| `needsPhoto` | `isBlank(brand.photo)` |
| `needsTagline` | `isBlank(brand.tagline)` — note: a single-paragraph description maps to bio only (F-7), so such brands correctly still get this row |
| `needsDescription` | `isBlank(brand.bio)` |
| `needsAddress` | `isBlank(brand.address)` |
| `needsEmail` | `isBlank(brand.contact?.email)` |
| `needsPhone` | `isBlank(brand.contact?.phone)` |
| `needsSocials` | every key in `SOCIAL_TODO_KEYS` satisfies `isBlank(brand.links?.[key])` (i.e. ALL empty; ONE filled network suppresses the row; `links.custom` ignored) |

### 4.2 `mingla-business/src/utils/businessTodos.ts`

- Extend `BusinessTodoInput` with an **OPTIONAL** key (REQUIRED to be optional — F-5; absent ⇒ zero profile rows ⇒ every existing test passes unmodified):

```
profile?: BusinessTodoProfileInput & { editRoute: string }
```

(`BusinessTodoProfileInput` = the 8 booleans; type may live in `brandProfileCompleteness.ts` and be imported — type-only import keeps the no-runtime-coupling contract.)
- New band **6 — Brand profile**, appended AFTER the `finish_draft` block (:259-271) and BEFORE `return todos;` (:273). Emits, in this fixed order, one row per true predicate, each `action: { kind: "route", route: \`${input.profile.editRoute}?section=<key>\` }`:

| # | id | label | sublabel | section |
|---|----|-------|----------|---------|
| 1 | `profile_add_cover` | `Add a cover` | `Make your public page pop` | `cover` |
| 2 | `profile_add_photo` | `Add a profile photo` | `Put a face on your brand` | `photo` |
| 3 | `profile_add_tagline` | `Add a tagline` | `One line that says what you do` | `about` |
| 4 | `profile_add_description` | `Describe your brand` | `Tell people what you're about` | `about` |
| 5 | `profile_add_address` | `Add your address` | `Help people find you` | `address` |
| 6 | `profile_add_email` | `Add a contact email` | `So customers can reach you` | `contact` |
| 7 | `profile_add_phone` | `Add a phone number` | `Another way to reach you` | `contact` |
| 8 | `profile_add_socials` | `Add your social links` | `Instagram, TikTok, your website and more` | `social` |

Labels/sublabels are EXACT strings (canonical voice: warm, plain, no jargon — no "URL", no "field", no "profile completion"). No `badge` on any profile row. No icons (F-7).
- Band comment must state the ordering rationale (polish ranks below every revenue/liveness gate) and the ORCH-1256 tag, mirroring sibling band comments.
- Priority-band placement decision (Q6): **tail — after `finish_draft`**. Do not interleave.

### 4.3 Hook — `mingla-business/src/hooks/useBusinessTodos.ts`

- Compute (memoized on `currentBrand`):

```
profile: currentBrand !== null && !isBrandResolving
  ? { ...deriveBrandProfileTodoInput(currentBrand), editRoute: `/brand/${currentBrand.id}/edit` }
  : undefined
```

- Pass `profile` into `buildBusinessTodos` and add it to the `useMemo` dep list.
- **Gating / no-flicker contract:** rows may appear only when a brand is selected AND its record has loaded. This is structurally satisfied: `currentBrand` is `null` until `useBrand`'s fetch resolves (`useCurrentBrand.ts:74` `return brand ?? null`), and `buildBusinessTodos` early-returns before band 6 while `brandResolving || !hasBrand` (:162-165). The extra `!isBrandResolving` guard above is belt-and-braces (covers the `_hasHydrated` window per ORCH-1100 RC-1). No new loading state may be introduced; no profile row may ever render for a null/resolving brand.

### 4.4 Renderer — `mingla-business/src/components/home/BusinessTodoToggle.tsx` (capacity bound ONLY)

- Wrap the expanded row list (currently `<View style={styles.list}>`, :97) so rows scroll internally when they exceed a bounded height:
  - Replace the list `View` with RN `ScrollView` (imported from `react-native`): `style={[styles.list, styles.listBounded]}`, `nestedScrollEnabled`, `showsVerticalScrollIndicator={true}`.
  - `listBounded: { maxHeight: 320 }` (≈6 rows visible; tuneable constant with a comment naming ORCH-1256 + the reason: the toggle mounts ABOVE the screen scroll area on Home/Hub, F-4).
- HARD constraints (locked by the existing source-contract test, F-5/Q4): keep `if (count === 0) return null;`, `useState<boolean>(true)`, `todos.map(`, `onPress={() => onAction(todo)}`, the badge rendering, and introduce NO `.sort(` / NO `.filter(`. Header count label (`headerCountLabel`) is untouched — it auto-adapts.
- No other visual change. Collapse behavior unchanged (default open, not persisted).

### 4.5 Route wrapper — `mingla-business/app/brand/[id]/edit.tsx`

- Extend the params read (:42) to `useLocalSearchParams<{ id: string | string[]; section?: string | string[] }>()`; normalize array form (house pattern, `listing.tsx:32`).
- Validate against the closed set `"photo" | "about" | "cover" | "address" | "contact" | "social"` (export type `BrandEditSection` from `BrandEditView.tsx`); anything else → `undefined`.
- Pass `initialSection={section}` to `<BrandEditView …>` (:113-120).

### 4.6 Edit view — `mingla-business/src/components/brand/BrandEditView.tsx` (additive anchors ONLY; **DO NOT TOUCH lines 501–539** — META-ORCH-1255 territory, F-6)

- New optional prop `initialSection?: BrandEditSection` (`export type BrandEditSection = "photo" | "about" | "cover" | "address" | "contact" | "social"`).
- Mechanism (minimal, no new deps):
  1. `scrollRef = useRef<RNScrollView>(null)` attached to the existing `<ScrollView>` (:451) — SmartScrollView already forwards the ref on native (`SmartScrollView.native.tsx:33-39`) and IS RN ScrollView on web (F-3).
  2. `pendingSectionRef = useRef<BrandEditSection | null>(initialSection ?? null)` — fire-once latch (never re-scrolls on later layouts/keyboard moves; does not react to param changes after mount).
  3. A `handleSectionLayout(section)` factory returning an `onLayout` handler: when `pendingSectionRef.current === section`, clear the latch and `scrollRef.current?.scrollTo({ y: Math.max(0, e.nativeEvent.layout.y - 8), animated: true })`. (`layout.y` is relative to the ScrollView content because labels/cards are direct children of the content container.)
  4. Attach `onLayout` to exactly six anchor nodes: Photo `GlassCard` (:464 → `"photo"`), `ABOUT` label Text (:542 → `"about"`), `BRAND COVER` label (:573 → `"cover"`), `ADDRESS` label (:634 → `"address"`), `CONTACT` label (:656 → `"contact"`), `SOCIAL LINKS` label (:688 → `"social"`).
- `"photo"` scrolls to y≈0 — acceptable and correct (section is at top).
- NOTHING else changes: no section reordering, no copy edits, no styling changes, no touch inside :501–539 (the PHYSICAL LOCATION block gets NO anchor — no to-do row targets it, and 1255 owns it).

## 5. Success criteria (parity automatic — single criteria set for Business iOS/Android/Web)

1. **SC-1:** Fresh brand (name+slug only): Home AND Hub to-do lists show all 8 profile rows, in the §4.2 order, positioned after every structural row (venue/claim/offering/Stripe/finish_draft when present).
2. **SC-2:** Tap `profile_add_cover` → app navigates to `/brand/{id}/edit?section=cover` and the page is scrolled so the `BRAND COVER` label is at/near the top of the viewport. Equivalent for the other 7 rows and their sections (tagline+description → ABOUT; email+phone → CONTACT).
3. **SC-3:** Filling a field and saving removes exactly that row on return to Home/Hub (React Query invalidation from `useUpdateBrand` — no new plumbing). A filled field NEVER shows its row (invariant §6).
4. **SC-4:** Whitespace-only values count as EMPTY: brand with `address: "   "` (or any field trim-empty) still shows that row.
5. **SC-5:** Socials aggregation: all 8 networks empty → exactly one `profile_add_socials` row; any ONE network filled (e.g. only `tiktok`) → row absent.
6. **SC-6:** No loading flash: while the brand list/record resolves (cold start, brand switch), zero profile rows render at any frame (same gate class as the existing ORCH-1100/1111 guarantees).
7. **SC-7:** With 9+ rows expanded, the row list caps at maxHeight 320 and scrolls internally; the Home dashboard content below the toggle remains reachable; header shows "N things to do" with the true N.
8. **SC-8:** Every existing test in `businessTodos.test.ts`, `businessTodos.invite.test.ts`, `BusinessTodoToggle.test.ts` passes UNMODIFIED (zero deleted lines — append-only gate needs no token).
9. **SC-9:** `git diff` of `BrandEditView.tsx` contains no hunk whose changed lines fall within the :501–539 PHYSICAL LOCATION block.
10. **SC-10:** Invalid `?section=bogus` (or absent param) → edit page renders normally at top, no crash, no scroll.

## 6. Invariants

- **NEW — `I-PROPOSED-1256-PROFILE-TODOS-NO-FALSE-POSITIVE` (DRAFT):** a filled (non-blank after trim) profile field NEVER shows its profile to-do row. Preserved by: single shared `isBlank` predicate consumed by all 8 derivations; verified by the per-field filled→absent test matrix (§7 T-3/T-4) and the strict-grep gate (§9). Flips ACTIVE at CLOSE (orchestrator owns the flip).
- Preserved existing guards: renderer source-contract (no sort/filter, hides at 0, collapsible — existing test file); ordering-owned-by-builder (renderer renders `todos` verbatim); ORCH-1100 RC-1 no-flash gating (untouched resolution logic); I-17 slug immutability (edit view slug UI untouched); I-38/I-39 a11y (new rows reuse the existing Pressable+accessibilityLabel row template unchanged); append-only test gate (new files only).

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-1 happy | fresh brand, all fields empty | `profile` all-true + `editRoute:"/brand/b1/edit"` | 8 rows, exact ids in §4.2 order, each route `…?section=<key>` | unit (businessTodos) |
| T-2 tail order | profile + structural rows together | needs_fix venue + no stripe + draft + all-true profile | `[get_venue_live, connect_stripe, finish_draft, profile_add_cover, …, profile_add_socials]` | unit |
| T-3 no-false-positive | each field filled one at a time | e.g. `needsTagline:false`, rest true | that row absent, other 7 present (8-way matrix) | unit |
| T-4 whitespace | Brand with `address:"  "`, `contact:{email:" "}`, `links:{instagram:"  "}` | `deriveBrandProfileTodoInput` | `needsAddress/needsEmail` true; instagram blank ⇒ counts empty ⇒ `needsSocials` true | unit (completeness) |
| T-5 partial socials | only `links.threads = "https://…"` | derive | `needsSocials:false` | unit (completeness) |
| T-6 custom-only links | `links:{custom:[{label,url}]}` | derive | `needsSocials:true` (custom ignored) | unit (completeness) |
| T-7 absent input | `profile` key omitted (legacy callers/tests) | base input | zero `profile_*` rows; healthy brand still `[]` | unit |
| T-8 gating | `brandResolving:true` + all-true profile | build | `[]` (or invites only) — no flash | unit |
| T-9 section param | `?section=bogus` / missing | route wrapper validation | `initialSection` undefined; page renders top | unit (source-contract) / sim |
| T-10 deep-link runtime | tap each row on sim | booted business app, fresh brand | scrolled to matching section (SC-2) | runtime (tester, Maestro) |
| T-11 capacity | 11 rows expanded on phone-size sim | fresh physical brand | internal scroll, dashboard reachable (SC-7) | runtime (tester) |
| T-12 vanish runtime | fill tagline, save, back | sim | `profile_add_tagline` gone, others intact (SC-3) | runtime (tester) |

## 8. Implementation order

1. `src/utils/brandProfileCompleteness.ts` (NEW — predicates + type).
2. `src/utils/businessTodos.ts` (optional `profile` input + band 6).
3. `src/hooks/useBusinessTodos.ts` (derive + pass + deps).
4. `src/components/home/BusinessTodoToggle.tsx` (bounded list).
5. `src/components/brand/BrandEditView.tsx` (`BrandEditSection` type, `initialSection` prop, ref + 6 anchors + fire-once scroll).
6. `app/brand/[id]/edit.tsx` (read/validate/pass `section`).
7. NEW tests: `src/utils/__tests__/brandProfileCompleteness.test.ts` + `src/utils/__tests__/businessTodos.profile.test.ts` (+ optional source-contract additions in a NEW file `src/components/brand/__tests__/brandEditView.section.orch1256.test.ts` asserting anchor markers + no :501–539 markers changed).
8. CI gate: `.github/scripts/strict-grep/orch-1256-profile-todos-no-false-positive.mjs` + append one job to `.github/workflows/strict-grep-mingla-business.yml` (registry pattern, DEC-101 D-17b-5; model on `orch-1253-biz-location-purpose-string.mjs`, incl. `--self-test`).
9. Run: `npx tsc --noEmit`, full `npx jest` in mingla-business, gate self-test, fails-on-revert proof (§9).

## 9. Regression prevention (fails-on-revert contract)

- **Structural safeguard:** strict-grep gate `orch-1256-profile-todos-no-false-positive.mjs` asserts (a) `brandProfileCompleteness.ts` exists and every predicate routes through a single `isBlank` containing `.trim()`; (b) `businessTodos.ts` contains all 8 `profile_add_*` ids gated behind `input.profile`; (c) `BrandEditView.tsx` contains the six section anchors + `initialSection`; (d) `edit.tsx` reads the `section` param; (e) `BusinessTodoToggle.tsx` retains the bounded-list marker. Any revert of any leg fails the PR.
- **Fails-on-revert tests:** T-1/T-3 fail if band 6 is reverted; T-4 fails if `.trim()` is dropped; T-7 fails if `profile` is made required or default-on. Implementor MUST demonstrate: stash the `businessTodos.ts` band → `businessTodos.profile.test.ts` fails → restore → passes; record in the implementation report.
- **Protective comments:** band-6 comment (why tail + ORCH-1256), `isBlank` comment (F-2 address-untrimmed why), toggle maxHeight comment (F-4 why), BrandEditView anchor comment ("anchors only — PHYSICAL LOCATION block :501–539 owned by META-ORCH-1255, do not anchor or edit").
- **Tester's adversarial angle (different from happy path):** whitespace-only every field (predicate bypass hunt); exactly-one-social permutations; `links.custom`-only brand; resolving-window flicker (frame-capture on cold start + brand switch); `?section` injection (`bogus`, array form `?section=cover&section=about`, casing); keyboard-open + deep-link scroll interaction on native; 13-row capacity on smallest sim; and a diff-audit that :501–539 is byte-identical.

## 10. Open questions (for Seth — none block implementation; defaults bound below)

- **OQ-1 (address row vs ORCH-1040 no-nag philosophy):** spec ships `profile_add_address` for ALL brands per Seth's confirmed field list. Alternative (NOT implemented): gate it on `hasPhysicalLocation === true` to match the venue no-nag rule. Flip is a one-line predicate change if Seth prefers.
- **OQ-2 (socials aggregation):** implemented as confirmed interpretation — one row, shown only when ALL 8 networks empty. Please confirm at review.
- **OQ-3 (maxHeight 320):** chosen as ≈6 visible rows; designer eyeball optional, tune-only.

## 11. Downstream routing

REVIEW (orchestrator) → `mingla-implementor` in THIS worktree (`~/Desktop/mingla-orchs/orch-1256-[brand-profile-todos]`, branch `orch-1256-brand-profile-todos`) executing §8 exactly → `mingla-tester` (adversarial contract §9; runtime T-10/11/12 on iOS sim + web preview; biz-web authed runtime caps claims per `feedback_biz_web_authed_runtime_unreachable_cap_claims`) → orchestrator CLOSE (PR to main, all checks green, `[deploy]` tag for Vercel, flip I-PROPOSED-1256 → ACTIVE, reap worktree). Coordinate merge order with META-ORCH-1255 (shared file `BrandEditView.tsx`; whoever lands second rebases — conflicts, if any, are context-line only by construction).

## 12. Scoped allowlist + DO-NOT-TOUCH

**Allowlist (the implementor may change ONLY these):**
1. `mingla-business/src/utils/brandProfileCompleteness.ts` — NEW; predicates + `BusinessTodoProfileInput` + `BrandEditSection`-agnostic pure logic.
2. `mingla-business/src/utils/businessTodos.ts` — optional `profile` input + band 6 ONLY.
3. `mingla-business/src/hooks/useBusinessTodos.ts` — derive/pass `profile` + memo deps ONLY.
4. `mingla-business/src/components/home/BusinessTodoToggle.tsx` — bounded scrollable list ONLY.
5. `mingla-business/app/brand/[id]/edit.tsx` — `section` param read/validate/pass ONLY.
6. `mingla-business/src/components/brand/BrandEditView.tsx` — `BrandEditSection` export, `initialSection` prop, scroll ref, six `onLayout` anchors, fire-once scroll ONLY; **lines 501–539 byte-identical**.
7. NEW test files: `mingla-business/src/utils/__tests__/brandProfileCompleteness.test.ts`, `mingla-business/src/utils/__tests__/businessTodos.profile.test.ts`, `mingla-business/src/components/brand/__tests__/brandEditView.section.orch1256.test.ts`.
8. `.github/scripts/strict-grep/orch-1256-profile-todos-no-false-positive.mjs` — NEW.
9. `.github/workflows/strict-grep-mingla-business.yml` — append ONE job.

**DO-NOT-TOUCH (stop-and-amend before touching anything here or beyond):**
- `BrandEditView.tsx:501–539` (PHYSICAL LOCATION block — META-ORCH-1255).
- `app/(tabs)/home.tsx`, `app/(tabs)/hub/_layout.tsx` (dispatchers need no change).
- `src/services/brandMapping.ts`, `src/services/brandsService.ts`, `src/hooks/useBrands.ts`, `src/hooks/useCurrentBrand.ts`.
- ALL existing test files (append-only; this spec requires zero edits to them).
- `src/wrappers/SmartScrollView*` (ref already forwards).
- Anything in `app-mobile/`, `mingla-admin/`, `packages/`, `supabase/`.
- No `eas update` of any channel (COMMS-0052).

Amendments: append in-file here or as `Mingla_Artifacts/specs/SPEC_AMENDMENT_ORCH-1256_PROFILE_TODOS.md`.
