# INVESTIGATION — ORCH-1256 [brand profile completion to-dos]

**Date:** 2026-07-01
**Phase:** INVESTIGATE (feature-scoping code audit — no reproducer-bound bug; live-fire exemption per skill Prime Directive 7 "code audit only". All findings are source-proven static facts, verifiable by opening the cited file:line.)
**Worktree:** `~/Desktop/mingla-orchs/orch-1256-[brand-profile-todos]` on branch `orch-1256-brand-profile-todos` (rebased on `origin/main`, head `74e2e12e2`).
**Comms ledger:** scanned on entry. COMMS-0052 (BLOCK, ALL — business-app OTA frozen until next native build) acknowledged by compliance: this ORCH's ship path is Vercel web + next native build, NO `eas update`. No 1255/1256 row exists in the ledger; the 1255 boundary is bound in the SPEC instead (see Discoveries D-3 for why no ledger write was made this turn).

---

## 1. Symptom summary (expected vs actual)

- **Expected (Seth-confirmed feature):** after creating a brand in mingla-business, the business to-do list shows ONE ROW PER EMPTY PROFILE FIELD — cover (`coverMediaUrl`), profile photo (`photo`), tagline, description (`bio`), address, contact email, contact phone, and one aggregated "add social links" row when ALL `links.*` networks are empty. Each row deep-links into the matching section of the brand edit page.
- **Actual (today):** `buildBusinessTodos()` emits only structural rows (invites → brand gate → venue → claim review → first offering → Stripe → finish draft). No profile-completeness rows exist anywhere. The brand edit page has NO scroll-to-section / anchor mechanism.
- **Boundary (Seth-confirmed):** the venue-toggle removal from `BrandEditView` belongs to **META-ORCH-1255**, NOT this ORCH. 1255 edits `BrandEditView.tsx` lines ~501–539 (the `PHYSICAL LOCATION` block). This ORCH MUST NOT touch that region.

## 2. Investigation manifest (every file read, in order)

| # | File | Layer | Why |
|---|------|-------|-----|
| 1 | `mingla-business/src/utils/businessTodos.ts` (275 lines, verbatim) | code | to-do derivation + priority philosophy |
| 2 | `mingla-business/src/hooks/useBusinessTodos.ts` (183 lines, verbatim) | code | input assembly + gating/flash guards |
| 3 | `mingla-business/src/hooks/useCurrentBrand.ts` (verbatim) | code | what brand record the hook sees |
| 4 | `mingla-business/src/types/brand.ts` (verbatim) | code/schema | field shapes: photo, coverMediaUrl, tagline, bio, address, contact, links |
| 5 | `mingla-business/src/services/brandMapping.ts` (verbatim) | code/schema | DB row → Brand mapping; trim/normalization behavior |
| 6 | `mingla-business/src/hooks/useBrands.ts` (`useBrand` 255–309) | code | detail query: full row vs projection |
| 7 | `mingla-business/src/services/brandsService.ts` (560–625 + select sites) | code | `select("*")` on brands (list + owned union + detail) |
| 8 | `mingla-business/src/components/home/BusinessTodoToggle.tsx` (211 lines, verbatim) | code | renderer contract: rows, badge, a11y, NO per-row icon, collapse |
| 9 | `mingla-business/app/(tabs)/home.tsx` (460–505, 640–675, todoWrap) | code | dispatcher + mount position (outside ScrollView) |
| 10 | `mingla-business/app/(tabs)/hub/_layout.tsx` (220–295) | code | second dispatcher + mount position |
| 11 | `mingla-business/app/brand/[id]/edit.tsx` (130 lines, verbatim) | code | route wrapper: params read, brand resolution, save path |
| 12 | `mingla-business/src/components/brand/BrandEditView.tsx` (1112 lines, verbatim) | code | section layout, 1255 boundary, absence of scroll mechanism |
| 13 | `mingla-business/src/wrappers/SmartScrollView.tsx` + `.native.tsx` (verbatim) | code | ScrollView ref/scrollTo availability per platform |
| 14 | `mingla-business/app/brand/[id]/listing.tsx` + `app/(tabs)/hub/listing.tsx` (focus lines) | code | house precedent for to-do deep-link query params (`?focus=feedback`, ORCH-1064/1145) |
| 15 | `mingla-business/src/utils/__tests__/businessTodos.test.ts` (376 lines, verbatim) | test | existing assertions the new input must not break (append-only) |
| 16 | `mingla-business/src/components/home/__tests__/BusinessTodoToggle.test.ts` (verbatim) | test | renderer source-contract locks (`no .sort/.filter`) |
| 17 | `.github/workflows/tests-append-only.yml` (1–40) | CI | append-only rules + override token grammar |
| 18 | `.github/workflows/strict-grep-mingla-business.yml` (1–50) + `.github/scripts/strict-grep/` listing + `orch-1253-*.mjs` (1–30) | CI | registry pattern for the regression gate |
| 19 | `.github/workflows/production-readiness-audit.yml` (full) | CI | which jest tests actually run in CI |
| 20 | `COMMS_LEDGER.md` (active rows) | docs | COMMS-0052 OTA block + ID-space warnings |

## 3. Q-scorecard

### Q1 — How is `buildBusinessTodos` input assembled, and is the FULL brand record (incl. contact/links) available there?

**Verdict: FULL record available. Proven (source).**

- Assembly point: `useBusinessTodos()` — `mingla-business/src/hooks/useBusinessTodos.ts:39-182`; the single `buildBusinessTodos({...})` call is at **lines 134–165**.
- Brand data: `const currentBrand = useCurrentBrand()` (line 43) → `useBrand(currentBrandId)` (`src/hooks/useCurrentBrand.ts:45`) → React Query `brandKeys.detail(brandId)` → `getBrand(brandId)` (`src/hooks/useBrands.ts:299-307`).
- The service fetch is `select("*")` on `brands` (detail at `src/services/brandsService.ts:573`; list membership `select("role, brand:brands!inner(*)")` at `:547`; owner-union backstop `select("*")` at `:572` region) → `mapBrandRowToUi` (`src/services/brandMapping.ts:235-318`) maps **every profile field**: `photo` (:266), `coverMediaUrl` (:263), `tagline`/`bio` (:270-271 via `splitBrandDescription`), `address` (:261), `contact` (:272-277), `links` (:278 via `socialJsonToLinks`).
- **So there is NO slim projection problem.** `currentBrand` inside `useBusinessTodos` is the full `Brand` with contact + links.
- **Normalization already applied at the mapping layer** (matters for emptiness predicates):
  - `contact` → `hasContact = !!(row.contact_email?.trim() || row.contact_phone?.trim())` (:238); fields become `trim() || undefined` (:274-275). Whitespace-only email/phone arrive as `undefined`.
  - `links` → `socialJsonToLinks` keeps a key only if `typeof v === "string" && v.trim().length > 0` (:217); zero kept keys → `links === undefined` (:223).
  - `tagline`/`bio` → `splitBrandDescription` trims and filters empty blocks (:159-168). Whitespace-only description → both `undefined`.
  - `photo` → `row.profile_photo_url ?? undefined` (:266) — **NOT trimmed** at map time (write path trims: `mapUiToBrandInsert` :335, `mapUiToBrandUpdatePatch` :421).
  - `coverMediaUrl` → `row.cover_media_url ?? undefined` (:263) — **NOT trimmed**.
  - `address` → `row.address` **raw, untrimmed, `string | null`** (:261) — a whitespace-only address is representable (BrandEditView's address input only nulls on `v.length === 0`, `BrandEditView.tsx:639-644`).
  - ⇒ predicates must trim defensively (see F-2).

### Q2 — How do existing to-do actions route (dispatcher contract)?

**Verdict: closed union `BusinessTodoAction`; profile rows fit the existing `{ kind: "route" }` arm with ZERO dispatcher changes. Proven (source).**

- Contract: `BusinessTodoAction` (`src/utils/businessTodos.ts:18-23`) = `open_brand_switcher | open_universal_creator | route (string) | open_pending_invite`.
- Two dispatchers, both exhaustive switches ending in a `never` check:
  - Home: `app/(tabs)/home.tsx:468-494` — `case "route": router.push(todo.action.route as never)` (:477-479).
  - Hub: `app/(tabs)/hub/_layout.tsx:224-250` — identical `route` arm (:233-235).
- Route strings are **precomputed by the caller** (hook), never built inside `businessTodos.ts` (file-header contract, `businessTodos.ts:7-8`: "no Brand/DraftEvent type coupling (route strings are precomputed by the caller)").
- House precedent for a query-param deep-link carried by a to-do row: `venueFeedbackRoute = /brand/{id}/listing?focus=feedback` (`useBusinessTodos.ts:161-164`), consumed via `useLocalSearchParams` and forwarded (`app/brand/[id]/listing.tsx:27-57`, `app/(tabs)/hub/listing.tsx:31-35`).

### Q3 — Does BrandEditView support scroll-to-section, or must a mechanism be added?

**Verdict: NO mechanism exists — must be added (query param + onLayout anchor map + fire-once `scrollTo`). Proven (source).**

- `BrandEditView.tsx` (all 1112 lines read): zero `scrollTo`, zero section refs, zero `onLayout` anchors, no route-param consumption (it's a pure component; params live in the route wrapper).
- `app/brand/[id]/edit.tsx:42` reads ONLY `{ id }` from `useLocalSearchParams`.
- The ScrollView is `SmartScrollView` (`BrandEditView.tsx:41,451`):
  - web variant = re-export of RN `ScrollView` (`src/wrappers/SmartScrollView.tsx:11`) — `scrollTo` supported (react-native-web).
  - native variant = `KeyboardAwareScrollView` wrapped in `forwardRef<RNScrollView>` (`src/wrappers/SmartScrollView.native.tsx:33-39`) — **already forwards a ScrollView-typed ref**, so `ref.current?.scrollTo({ y })` is available on both platforms with no wrapper change.
- Section landmarks in the populated state (post-rebase line numbers, head `74e2e12e2`):
  - Photo card (no label): `GlassCard` at **:464**
  - `PHYSICAL LOCATION` label **:505** — ⚠️ inside the 1255-owned region :501–539, NOT an anchor target
  - `ABOUT` label **:542** (tagline input :552, bio textarea :560)
  - `BRAND COVER` label **:573**
  - `PUBLIC PAGE THEME` label **:626** (not a target)
  - `ADDRESS` label **:634**
  - `CONTACT` label **:656** (email :658, phone :669)
  - `SOCIAL LINKS` label **:688** (8 inputs :690-777)
  - `DISPLAY` :781, danger zone :801 (not targets)
- House precedent for "param → on-mount behavior": `?focus=feedback` (ORCH-1064/1145) — read param, normalize array form, act once. The SPEC mirrors it as `?section=<key>`.

### Q4 — What happens to the to-do UI with 8+ extra rows (capacity / collapse / count label)?

**Verdict: real capacity problem — the toggle is mounted OUTSIDE the screen's ScrollView, so a long expanded list pushes the dashboard below the fold with no way to scroll the rows. A minimal bounded-height fix in the renderer is required. Proven (source).**

- Mounts: Home `app/(tabs)/home.tsx:654-660` and Hub `app/(tabs)/hub/_layout.tsx:278-284` — both inside a plain `View style={styles.todoWrap}` that sits ABOVE the screen's ScrollView/content, flush under the top bar. The row list itself is a plain `View` (`BusinessTodoToggle.tsx:97`) — **no internal scrolling, no maxHeight**.
- Row height ≈ 48–52pt (paddingVertical `spacing.sm` ×2 + label + sublabel). A fresh brand post-creation can now hit: `add_venue` + `create_offering` + `connect_stripe` + 8 profile rows = **11 rows ≈ 560–620pt** — on a phone the entire dashboard disappears and the rows themselves can run off-screen unscrollably.
- Collapse: exists (header Pressable, default OPEN `useState<boolean>(true)`, `BusinessTodoToggle.tsx:59`), collapse state is NOT persisted.
- Count label: header auto-adapts — `headerCountLabel(n)` = "1 thing to do" / "N things to do" (:51-52). No change needed.
- Renderer has NO per-row icon field and renders none (`BusinessTodo` interface :25-36 — id/label/sublabel/action/badge only). The dispatch's "icon suggestions from the existing icon set used in businessTodos.ts" resolves to: **businessTodos.ts uses no icons; rows render no icons; adding an icon field would be a renderer redesign — out of scope** (SPEC states this explicitly).
- Contract locks on the renderer (source test `BusinessTodoToggle.test.ts`): must keep `if (count === 0) return null;`, `useState<boolean>(true)`, `todos.map(`, `onPress={() => onAction(todo)}`, and must NOT contain `.sort(` / `.filter(` — any capacity fix must respect these.

### Q5 — What tests cover businessTodos.ts, and what does the append-only CI gate imply?

**Verdict: three existing test files; the append-only gate + their exact-array assertions FORCE the new profile input to be OPTIONAL (absent ⇒ zero profile rows). CI does NOT run the jest suite — the CI-enforced guard must be a strict-grep registry gate. Proven (source).**

- Tests today:
  - `src/utils/__tests__/businessTodos.test.ts` (376 lines) — pure-function matrix. Load-bearing assertions that must survive UNMODIFIED: "fully healthy brand → empty list" `expect(buildBusinessTodos(base)).toEqual([])` (:265-267); exact ordering array `["get_venue_live","connect_stripe","finish_draft"]` (:253-263); brand-gate `toHaveLength(1)` (:44, :56). `base` does NOT include a profile key → if the new input were required or defaulted to "emit rows", these tests break and CANNOT be edited without a `[TEST-MOD-APPROVED ORCH-1256]` token (deletions unoverridable).
  - `src/utils/__tests__/businessTodos.invite.test.ts` (91 lines) — invite rows; same optionality logic protects it.
  - `src/components/home/__tests__/BusinessTodoToggle.test.ts` (59 lines) — source-contract locks listed under Q4.
- Append-only gate: `.github/workflows/tests-append-only.yml` (ORCH-0840) — existing test files: additions OK, any deleted line needs `[TEST-MOD-APPROVED ORCH-NNNN]` in the commit body, renames need `[TEST-RENAME-APPROVED ...]`, deletions cannot be overridden. ⇒ new coverage goes in **NEW test files**.
- CI reality: `production-readiness-audit.yml` runs ONLY `npx jest src/config/__tests__/featureFlags.test.ts` (:63); no workflow runs the businessTodos suite. ⇒ per `feedback_close_tester_regression_protection_hard_must`, the CI-enforced regression guard for this ORCH must be a **strict-grep registry gate** (`.github/scripts/strict-grep/*.mjs` + one job appended to `strict-grep-mingla-business.yml`, DEC-101 D-17b-5 pattern; live exemplar `orch-1253-biz-location-purpose-string.mjs`).

### Q6 — Where should profile rows sit in the priority order?

**Verdict: at the TAIL — new priority band 6, after `finish_draft`. Recommended from the code's own philosophy.**

- The priority order is operator-locked and criticality-ranked (`businessTodos.ts:12-13` "Priority order (operator-locked 2026-06-01): brand → venue (add/finish, then get-live) → first offering → Stripe → finish draft"), and each band's comment justifies rank by **business-outcome blockage**: invites are "a one-tap relationship decision" (band 0), brand gate blocks everything (1), venue = "get discovered" (2/2b), first offering = inventory (3), Stripe = "can't take payments yet" (4), finish_draft = "nothing live yet" (5).
- Profile fields block NO transaction: a brand can get discovered, list, sell and get paid with an empty tagline. They are presentation polish → they rank BELOW everything that gates revenue/liveness, i.e. after `finish_draft`.
- "Before finish_draft" was considered and rejected: `finish_draft` is the last step of the go-live chain ("Publish it to go live") — interleaving 8 polish rows above it buries the single action that makes the brand live.
- Internal order (fixed, mirrors Seth's confirmed enumeration): cover → photo → tagline → description → address → email → phone → socials.

## 4. Findings (six-field evidence)

### F-1 — Full brand record (incl. contact/links) is already present at the to-do assembly point; no data-layer work is needed. (answers Q1)
1. **Symptom:** n/a (capability finding).
2. **Layer:** code.
3. **Probe:** read `useBusinessTodos.ts:39-165`, `useCurrentBrand.ts:40-75`, `useBrands.ts:255-309`, `brandsService.ts:547,573`, `brandMapping.ts:235-318`.
4. **Evidence:** `brandsService.ts:573` `.select("*")`; `brandMapping.ts:263-278` maps `coverMediaUrl`, `photo`, `bio`, `tagline`, `contact`, `links`; `useBusinessTodos.ts:43` `const currentBrand = useCurrentBrand();`.
5. **Mechanism:** detail + list brand queries both select full rows and map every profile field, so the hook can derive all 8 emptiness predicates from `currentBrand` locally.
6. **Severity:** CONFIRMED (capability) — no blocker.

### F-2 — Emptiness predicates must trim; `address` (and, defensively, `photo`/`coverMediaUrl`) can be whitespace-only on the mapped Brand. (answers Q1, feeds SPEC predicates)
1. **Symptom:** a brand with address `"   "` would wrongly count as "filled" under a naive `!= null` predicate → violates the no-false-positive... inverse: it would wrongly HIDE the to-do row (false negative on the row; false "complete" signal).
2. **Layer:** code.
3. **Probe:** read `brandMapping.ts:261-266` vs `:238,274-275,217`; `BrandEditView.tsx:636-649`.
4. **Evidence:** `address: row.address,` (`brandMapping.ts:261` — raw); address input nulls only on `v.length === 0` (`BrandEditView.tsx:642` `address: v.length === 0 ? null : v`), so `"  "` persists; contrast `contact_email?.trim() || undefined` (:274).
5. **Mechanism:** trim-less predicate + untrimmed field ⇒ whitespace counts as content ⇒ wrong row visibility. Contact/links/tagline/bio are pre-trimmed at map time, so trimming there is belt-and-braces, not load-bearing.
6. **Severity:** SUSPECTED CONTRIBUTOR (pre-empted — becomes a real bug only if the implementor skips trimming; SPEC binds `isBlank = (s) => s == null || s.trim().length === 0` for ALL fields).

### F-3 — No deep-link/scroll mechanism exists on the brand edit page; the ref plumbing is already compatible. (answers Q3)
Fields: see Q3. **Severity: CONFIRMED (gap to fill).** Key evidence: zero `scrollTo|onLayout|section` hits in `BrandEditView.tsx`/`edit.tsx` (repo-wide grep for `scrollTo` shows the pattern used elsewhere: `TicketQrCarousel.tsx:105` `scrollRef.current?.scrollTo({...})`); `SmartScrollView.native.tsx:33` `forwardRef<RNScrollView, ...>` proves `ref` passes through to a scrollable on native; web wrapper is RN `ScrollView` verbatim.

### F-4 — Capacity hazard: the toggle's row list is unbounded and mounted outside any scrollable area. (answers Q4)
Fields: see Q4. **Severity: SECONDARY (must be addressed in the same ORCH or the feature degrades the Home/Hub screens).** Evidence: `home.tsx:654` `<View style={styles.todoWrap}>` is a sibling ABOVE the screen ScrollView (:663+); `BusinessTodoToggle.tsx:96-139` renders rows in a plain `View`.

### F-5 — Existing test corpus + append-only gate constrain the input shape to an OPTIONAL `profile` key. (answers Q5)
Fields: see Q5. **Severity: CONFIRMED (design constraint).** Evidence: `businessTodos.test.ts:265-267` `expect(buildBusinessTodos(base)).toEqual([]);` with `base` lacking any profile key; `tests-append-only.yml:4-12`.

### F-6 — META-ORCH-1255 collision boundary is confined to `BrandEditView.tsx:501-539`; this ORCH's edit-view touches avoid it entirely. (scope safety)
1. **Symptom:** two in-flight ORCHs editing the same 1112-line file.
2. **Layer:** code.
3. **Probe:** read `BrandEditView.tsx:501-539` (PHYSICAL LOCATION block: label :505, GlassCard :506, `InlineToggle` on `hasPhysicalLocation` :515-524, claim CTA :526-538).
4. **Evidence:** none of this ORCH's anchor targets (Photo card :464, ABOUT :542, BRAND COVER :573, ADDRESS :634, CONTACT :656, SOCIAL LINKS :688) fall inside :501-539; the ScrollView open tag (:451) and imports (:24) are outside it.
5. **Mechanism:** 1255 removes/reworks the venue toggle block; if 1256 anchored or reformatted inside :501-539 the later merge would conflict or silently resurrect removed UI. Keeping 1256's diff to the six anchor sites + ref + one new prop confines any overlap to git context lines only.
6. **Severity:** CONFIRMED (boundary, bound as DO-NOT-TOUCH in the SPEC).

### F-7 — `BusinessTodo` has no icon field and rows render no icons; tagline/bio share one DB column. (feeds SPEC copy + predicates)
1. **Symptom:** n/a (contract findings).
2. **Layer:** code/schema.
3. **Probe:** read `businessTodos.ts:25-36`, `BusinessTodoToggle.tsx:96-139`, `brandMapping.ts:12-13,158-181`.
4. **Evidence:** interface fields = `id,label,sublabel?,action,badge?`; only icons in the renderer are the header `list` icon and chevrons; "Bio + tagline share `brands.description` using a double-newline split (tagline first block, bio rest). Single-paragraph description maps to bio only." (`brandMapping.ts:12-13`).
5. **Mechanism:** (a) per-row icons would require widening the renderer contract → excluded; (b) a brand whose description is a single paragraph has `bio` set and `tagline` undefined → the tagline row correctly shows (that IS an empty tagline in the data model) — documented so the tester doesn't misread it as a false positive.
6. **Severity:** CONFIRMED (contract facts).

## 5. Five-Truth-Layer reconciliation

| Layer | State | Contradictions |
|-------|-------|----------------|
| Docs | Seth-confirmed scope (dispatch) = one row per empty field, socials aggregated, deep-link per section, no edit-page redesign, 1255 owns :501-539 | none |
| Schema | `brands` carries all fields (`description` split-shared by tagline/bio; `social_links` JSON; `address` nullable text) — `brandMapping.ts` BrandRow :29-87 | tagline/bio share one column (F-7) — flagged, not a bug |
| Code | derivation `businessTodos.ts`, assembly `useBusinessTodos.ts`, renderer `BusinessTodoToggle.tsx`, edit page `BrandEditView.tsx` — no profile rows, no anchors | address untrimmed at map time (F-2) vs trimmed siblings — flagged |
| Runtime | not exercised this turn (code-audit exemption); flash-gating already proven by ORCH-1100/1111 gates in `useBusinessTodos.ts:44-97` and locked by existing tests | none new |
| Data | read-only prod probes not needed — predicates operate on the mapped `Brand`, whose normalization is fully source-visible | none |

## 6. Repro evidence

Not applicable — new-feature scoping audit, no bug to reproduce. No simulator run performed (exemption: "code audit only"; nothing here is a reproducer-bound defect claim). Everything asserted is file:line-citable source fact.

## 7. Blast radius / cross-surface map

- **In scope:** mingla-business only — Business iOS, Business Android, Business Web preview (one shared RN codebase → parity automatic). Surfaces touched: Home to-do list, Hub to-do list (same component + hook), brand edit page (additive anchors only).
- **Out of scope:** Consumer iOS/Android (`app-mobile` — no businessTodos, no BrandEditView), Buyer/anonymous web (anon routes `/checkout/*`, `/e/*`, `/b/*`, `/t/*` never mount `(tabs)` home/hub or `/brand/[id]/edit`; per `feedback_anon_buyer_routes` they live outside (tabs)), Admin web (`mingla-admin` — separate app, no shared to-do code).
- Call sites of `buildBusinessTodos`: exactly one (`useBusinessTodos.ts:136`). Call sites of `useBusinessTodos`: `app/(tabs)/home.tsx:467`, `app/(tabs)/hub/_layout.tsx:79`. Consumers of `/brand/[id]/edit`: profile/account navigation pushes — all id-only; an added optional `?section=` param is backward-compatible.

## 8. Invariant impact

- No existing registry invariant is violated by the planned scope. Relevant ACTIVE guards honored: renderer source-contract test (no `.sort`/`.filter` in toggle), I-17 slug immutability (untouched), ORCH-1040 physical-location no-nag philosophy (see Open Question OQ-1 in the SPEC re: address row), I-38/I-39 a11y (rows already Pressable+label; new rows inherit).
- New invariant proposed in the SPEC: **I-PROPOSED-1256-PROFILE-TODOS-NO-FALSE-POSITIVE** (DRAFT) — a filled profile field NEVER shows its to-do row.

## 9. Discoveries for Orchestrator

- **D-1 (pre-existing, not this ORCH):** `brands.address` is persisted untrimmed (`BrandEditView.tsx:642` nulls only on length 0; `mapUiToBrandUpdatePatch` passes `patch.address` raw at `brandMapping.ts:438`) — whitespace-only addresses can exist in prod data. Cosmetic data-hygiene candidate.
- **D-2 (pre-existing):** CI runs only the featureFlags jest test for mingla-business (`production-readiness-audit.yml:63`) — the whole 376-line businessTodos matrix never runs in CI. Program-level gap worth a dedicated ORCH (add a `jest` job); this ORCH covers itself via a strict-grep gate per house pattern.
- **D-3 (process):** No COMMS ledger row exists for the 1255↔1256 BrandEditView co-edit. I did NOT write one this turn: the shared anchor's `COMMS_LEDGER.md` is already dirty with another session's uncommitted modification (git status shows ` M COMMS_LEDGER.md` on the anchor), so a direct-to-main one-file commit would capture a foreign in-flight edit (the exact `feedback_shared_anchor_checkout_staging_hazard` trap). The boundary is instead bound as a DO-NOT-TOUCH contract in the SPEC, and the orchestrator (who supplied the 1255 line range, i.e. already coordinates both) should relay or write the ledger row from a clean anchor state.

## 10. Confidence level

**Proven (source-conclusive)** for every static fact above (Q1–Q6 all answer from verbatim reads with file:line evidence). No runtime claims are made; the one behavioral prediction (capacity overflow, F-4) is geometric arithmetic from source constants and is marked for tester runtime verification.

## 11. Recommended next phase + scope

SPEC (written alongside this report, same worktree): additive profile band in `businessTodos.ts` behind an OPTIONAL input key; pure predicate util; hook wiring; `?section=` deep-link param + onLayout anchor map + fire-once scrollTo in `BrandEditView`; minimal bounded-height scrollable row list in the toggle; new test files only; strict-grep registry gate. Nothing else — explicitly NOT the venue toggle (1255), NOT edit-page redesign, NOT per-row icons, NOT dispatcher changes.
