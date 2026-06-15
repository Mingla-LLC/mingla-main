# SPEC — ORCH-1144 Universal Experience-Parser Chooser

**Skill:** mingla-forensics · **Phase:** SPEC · **Date:** 2026-06-15
**Investigation:** `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1144_UNIVERSAL_EXPERIENCE_PARSER_CHOOSER.md`
**Copy doc (named slots — verbatim source of all strings):** `Mingla_Artifacts/design/ORCH-1144/COPY_ORCH-1144_EXPERIENCE_CREATE_CHOOSER.md`
**Surface:** Mingla Business app (`mingla-business/`, RN iOS + Android; business web preview adjacent)

> Decisions are LOCKED by the dispatch. This SPEC is a binding contract; the implementor builds exactly
> this. Strings are referenced as **named copy slots** (e.g. `COPY §2 Option1.label`) — do NOT invent or
> paraphrase; pull the Recommended-primary string from the copy doc.

---

## 1. Executive summary

Restructure how a business user creates an experience. Today the Hub Experiences tab shows a category-gated
"Snap your menu" banner and routes a brand to the Ve5 menu parser, the Ve6 activities parser, or neither —
based on `brand.venueCategory`. Restaurants reach Ve5, play venues reach Ve6, and everyone else (creative,
or no category) is **stranded** with no snap option at all.

ORCH-1144 makes both parsers universal. Tapping the top-bar **+** → **Create experience** now opens a
**3-option pre-step chooser** — *Snap a food menu* (Ve5), *Snap an activities menu* (Ve6), *Build it
yourself* (manual wizard) — shown flat, equal, and **unconditional** to every brand. The category router
and verification predicates are deleted; `parseMode` is chosen explicitly by the user. The Hub Experiences
tab is rebuilt into a plain drafts/live list at full parity with the Trips and Events tabs (filter pills,
buckets, empty states, multi-select), with the banner gone.

---

## 2. Scope & non-goals

**In scope:**
1. New `ExperienceCreateChooser` sheet (3 options, unconditional).
2. Intercept the `UniversalCreatorSheet` "Create experience" route so it opens the chooser instead of
   pushing `/experience/create` directly.
3. A shared snap-flow host reachable from chooser options 1 & 2, carrying an **explicit** `parseMode`.
4. Rebuild `app/(tabs)/hub/experiences.tsx` to the Trips/Events pill+bucket list pattern; delete the banner
   + `venueCategory` router + verification predicates.
5. Delete the two predicate util files + their unit tests; rewrite the contract test to a fails-on-revert
   guard.
6. Wire all copy from the named slots in the copy doc.

**Non-goals (explicitly OUT):**
- No change to the Gemini parsers or edge functions (`parse-restaurant-menu`, `parse-play-activities`,
  `_shared/geminiMenuParser.ts`, `_shared/geminiActivitiesParser.ts`) — they are ownership-gated and
  category-agnostic already (investigation Q5).
- No change to `usePendingExperiences` mutation logic (it already takes explicit `parseMode`).
- No change to the manual `ExperienceCreatorWizard` or `/experience/create` route behavior.
- No change to confirm/reject / `agent_pending_actions` / publish / checkout (money stays downstream-gated).
- No consumer-app (`app-mobile/`) work — parsers are business-only.
- No change to other `venueCategory` consumers (venue creation, public brand page, pool matching).
- `app/experience/coming-soon.tsx` retire is **OPEN QUESTION** (§10), not assumed.

**Assumptions:** `ExperienceListCard`, `useDraftMultiSelect`, `useDiscardOfferingDrafts`, `DraftSelectBar`,
`OfferingManageSheet`, `useExperiencesByBrand` are all already consumed by `experiences.tsx` and stay.

---

## 3. Cross-Surface Impact Declaration

| # | Surface | Covered? | User-visible behavior | Files touched here | Parity |
|---|---|---|---|---|---|
| 1 | Consumer iOS (`app-mobile/`) | NO | unchanged | none | — (parsers business-only) |
| 2 | Consumer Android (`app-mobile/`) | NO | unchanged | none | — |
| 3 | Buyer/anon Web | NO | unchanged | none | — (founder-only create flow) |
| 4 | Business iOS | YES | +→Create experience opens 3-option chooser; both parsers reachable; tab is a plain pilled list, no banner | all files in §"Allowlist" | shared RN code |
| 5 | Business Android | YES | same as iOS; new chooser sheet must honor the Android glass opaque-fallback policy (≥0.92 opaque fill + `overflow:'hidden'`, no Android shadow under rounded fill) | same | shared RN code, **manual** glass delta |
| 6 | Admin Web | NO | unchanged | none | — |
| 7 | Business Web preview (adjacent) | YES | same RN-web path; chooser + snap sheets render via RN-web; snap uses `browserFilePicker` (already web-aware) | same | shared RN-web, **manual** verify export |

---

## 4. Layered specification

This is a **front-end-only** change. No Database / Edge / Realtime layers. Service + hook layers are
**unchanged** (verified): `usePendingExperiences(brandId, parseMode)` already branches on the explicit
`parseMode` (`usePendingExperiences.ts:48-58`); `experienceGenerationService` parse/confirm/reject untouched.

### 4.1 Component — `ExperienceCreateChooser` (NEW)

**File:** `mingla-business/src/components/experience/ExperienceCreateChooser.tsx`
**Pattern source:** model on `UniversalCreatorSheet.tsx` (same `TopSheet heightMode="compact"`, same row
shape, same `handleSelect → onClose + setTimeout(50) → route/callback`). Reuse its row styling tokens so the
two chooser sheets feel identical.

**Props:**
```ts
interface ExperienceCreateChooserProps {
  visible: boolean;
  onClose: () => void;
  testID?: string;
}
```

**Behavior:** Renders `TopSheet heightMode="compact"` with a header (`COPY §1 title` / `COPY §1 subtitle`)
and exactly 3 `Pressable` rows in fixed order (NO conditional rendering of any row — every brand sees all
3). Each row: leading icon (`flash` for food, `list` for activities, `sparkle` for manual — reuse existing
`Icon` names), title + helper, trailing `chevR`. On tap, close the sheet then route:

| Order | Title slot | Helper slot | Icon | Action |
|---|---|---|---|---|
| 1 | `COPY §2 Option1.label` (`Snap a food menu`) | `COPY §2 Option1.helper` | `flash` | route to snap flow with `parseMode="menu"` (§4.2) |
| 2 | `COPY §2 Option2.label` (`Snap an activities menu`) | `COPY §2 Option2.helper` | `list` | route to snap flow with `parseMode="activities"` (§4.2) |
| 3 | `COPY §2 Option3.label` (`Build it yourself`) | `COPY §2 Option3.helper` | `sparkle` | `router.push("/experience/create")` |

**States:** the sheet has only visible/hidden (no async). Rows: default + pressed (`rowPressed`). Every row
has `accessibilityRole="button"`, `accessibilityLabel={title}`, `accessibilityHint={helper}`, a `testID`
(`experience-chooser-food`, `-activities`, `-manual`), and ≥44pt touch target (44×44 iconWrap as in
`UniversalCreatorSheet.tsx:184-191`).

**Android glass delta:** the row `backgroundColor` + sheet surface must use the opaque Android fallback
(`Platform.select`, ≥0.92 opaque fill, `overflow:'hidden'`, no Android shadow) per the
ANDROID_GLASS_USES_OPAQUE_FALLBACK policy. `UniversalCreatorSheet` rows already use `glass.tint.profileBase`
with `overflow:'hidden'` — match that exactly.

### 4.2 Snap-flow host — how options 1 & 2 reach the parser

The snap flow currently lives INSIDE `experiences.tsx` as `ExperienceGenerationSurface` (parse →
ExperienceReviewCards → confirm). After the rebuild the Experiences tab is a plain list, so the
parse/review machinery must live on a **dedicated route** reached by chooser options 1 & 2.

**File (NEW):** `mingla-business/app/experience/snap.tsx`
**Param:** `parseMode` via expo-router query param — `router.push("/experience/snap?mode=menu")` /
`?mode=activities`. The route reads `useLocalSearchParams<{ mode?: string }>()`, coerces to
`ExperienceParseMode` (`mode === "activities" ? "activities" : "menu"`), and renders the relocated
`ExperienceGenerationSurface` body (parse spinner + `ExperienceReviewCards` + the matching SnapInput +
toasts), passing the explicit `parseMode`, the correct `SnapInput` (`parseMode === "activities" ?
ActivitiesSnapInput : MenuSnapInput`), and the snap-screen copy (`COPY §3` food/play title+subtitle keyed by
mode). On a successful confirm it routes back to `/(tabs)/hub/experiences` (the brand finishes the draft
from the list). The snap sheet auto-opens on mount (the chooser already expressed intent — open the camera
immediately, no second banner tap).

> **Why a route, not an inline sheet:** the chooser closes on the `+` surface (Home/Hub/etc.), so the snap
> flow needs a navigable destination that mounts the parser + review independent of which screen opened the
> chooser. A route also gives the parse/review its own back-stack entry (cancel = back), matching
> `/experience/create`.

**Relocation contract:** move `ExperienceGenerationSurface` (`experiences.tsx:140-492` — the parse machinery
half: `handleFilesReady`, parsing spinner, `ExperienceReviewCards`, `<SnapInput>`, parse toasts) into
`snap.tsx`. Do NOT move the list/multi-select/manage half — that stays on the tab (§4.3). The bulk-delete +
manage-sheet + list-card rendering belong to the LIST, not the snap flow.

### 4.3 Component — `app/(tabs)/hub/experiences.tsx` rebuild (MODIFY → matches Trips)

Rebuild the route to the **Trips tab skeleton** (`trips.tsx` is the closest reference — experiences have no
"live" pulse, so 4 pills like Trips, not 5 like Events). Concretely:

1. **Delete** the `venueCategory`-branched `HubExperiencesRoute` (`experiences.tsx:494-575`), the banner
   `Pressable` (`:263-278`), `RESTAURANT_COPY`/`PLAY_COPY` (`:72-98`), the `canSnap` prop +
   `canGenerateExperiences*` imports/calls (`:52-53,520,533`), and the now-dead `cta*` styles
   (`:595-614`).
2. **New single component** (no category branch). Mirror `trips.tsx`:
   - `useCurrentBrand()`; if null → "Select a brand to see its experiences." state (keep
     `experiences.tsx:505-510`).
   - `useExperiencesByBrand(brand.id)` for the list (already imported).
   - Bucket `VenueExperience[]` into `draft` / `upcoming` / `past` via a `deriveExperienceFilterBucket`
     helper modeled on `deriveTripFilterBucket` (`trips.tsx:94-104`): `status === "draft"` → draft;
     `ended`/`cancelled` → past; else upcoming. (Experiences may lack a clean end date; if no date, treat
     non-draft/non-ended as `upcoming`.)
   - 4 filter pills All/Upcoming/Past/Drafts with counts, `defaultFilter` fallback chain, `pillsScroll`
     with **`flexGrow:0, flexShrink:0`** (copy `trips.tsx:537-543` verbatim — mandatory footgun guard).
   - List ScrollView with `paddingBottom: insets.bottom + 120`.
   - Empty state `GlassCard variant="elevated"`: headline `COPY §4 empty headline` (`No experiences yet`),
     body `COPY §4 empty body`, and an optional CTA button `COPY §4 empty button` (`New experience`) that
     opens the chooser via the **shared `hubCreatorStore`** path → then the chooser (see §4.4). Per-filter
     empty copy mirrors `trips.tsx:306-318`.
3. **Keep verbatim** (already at parity): the `ExperienceListCard` rows + `useDraftMultiSelect` +
   `useDiscardOfferingDrafts` + `DraftSelectBar` + `ConfirmDialog` bulk-delete + `OfferingManageSheet` +
   `ShareModal` + `bulkToastMessage`/`bulkDeleteErrorMessage` + `normalizeExperienceStatus`
   (`experiences.tsx:190-214,336-489`). These move into the rebuilt single component unchanged.

### 4.4 Wiring the chooser off BOTH entry points

The chooser must open from two places (the banner that used to host the tab's snap CTA is gone):

**(A) Off the `+` flow (`UniversalCreatorSheet`).** Today `UniversalCreatorSheet.tsx:71-73` routes the
experience row to `/experience/create`. **Change:** the experience row must open the
`ExperienceCreateChooser` instead of routing to the manual wizard. Two acceptable mechanisms — implementor
picks the lower-risk one:
   - **(A1, preferred)** Change the experience option's behavior in `UniversalCreatorSheet` from a route to
     a callback. Since `UniversalCreatorSheet` is mounted by ~5 layouts, the cleanest single-point change is
     to route the experience row to a dedicated `/experience/choose` route that mounts the chooser
     full-screen-modal-style (auto-visible), keeping `UniversalCreatorSheet` a pure router. This avoids
     adding chooser state to every consumer.
   - **(A2)** Add an `onChooseExperience?: () => void` prop to `UniversalCreatorSheet`; when present, the
     experience row calls it instead of routing; each consumer owns the chooser visibility state. Higher
     touch count (every consumer) — only if A1 is infeasible.

   **Decision rule:** prefer **A1** (a `/experience/choose` route that renders `ExperienceCreateChooser`
   with `visible` defaulting true, `onClose` = `router.back()`). Single change in `UniversalCreatorSheet`
   (route `/experience/create` → `/experience/choose`), zero per-consumer churn.

**(B) Off the Experiences-tab empty-state CTA.** The tab's "New experience" CTA opens the SAME chooser. Use
the existing `hubCreatorStore` indirection pattern, BUT note `hubCreatorStore` currently opens the
*UniversalCreatorSheet* (Event/Experience/Trip), not the experience chooser. Cleanest: the tab CTA routes
directly to `/experience/choose` (the A1 route) — no new store flag needed. (If A2 is chosen instead, add a
parallel `experienceChooserStore` flag mirroring `hubCreatorStore`.)

---

## 5. Success criteria (per-surface where parity is manual)

- **SC-1** — Tapping top-bar **+** then **Create experience** opens the 3-option chooser (NOT the manual
  wizard directly). *(SC-1-iOS / SC-1-Android / SC-1-Web each verified.)*
- **SC-2** — The chooser shows exactly 3 rows, flat equal order (food, activities, manual), for EVERY brand
  regardless of `venueCategory` (incl. `creative_and_arts` and null) and regardless of verification status.
- **SC-3** — Tapping "Snap a food menu" opens the Ve5 menu snap flow with `parseMode="menu"`; the snap sheet
  auto-opens; a successful parse lands draft proposals reviewable via `ExperienceReviewCards`.
- **SC-4** — Tapping "Snap an activities menu" opens the Ve6 activities snap flow with
  `parseMode="activities"`; same review path.
- **SC-5** — Tapping "Build it yourself" opens `/experience/create` (the existing `ExperienceCreatorWizard`),
  behavior unchanged.
- **SC-6** — The Experiences tab renders NO banner; it shows 4 filter pills (All/Upcoming/Past/Drafts) with
  live counts and bucketed list rows, structurally matching Trips. *(SC-6-iOS / SC-6-Android / SC-6-Web.)*
- **SC-7** — Empty state shows `COPY §4 empty headline` + body; its CTA opens the chooser.
- **SC-8** — A `creative_and_arts` or null-category brand (previously stranded) can now reach BOTH parsers
  via the chooser. (Adversarial regression target.)
- **SC-9** — Long-press multi-select + bulk delete of DRAFT experiences still works (no regression from the
  rebuild).
- **SC-10** — No dead taps: each of the 3 chooser rows routes/opens a real destination (Constitution #1).
- **SC-11** — Prices on experience rows remain currency-aware (rendered via the unchanged
  `ExperienceListCard`/`OfferingListCard` → `formatCurrency`).
- **SC-12-Android** — The chooser sheet + rows use the opaque Android glass fallback (no translucent fill,
  `overflow:'hidden'`, no Android shadow under rounded fill).
- **SC-13-Web** — `expo export` (web) succeeds and stays under the ORCH-1083 `__common` bundle budget; the
  chooser + snap route render in the business web preview without a Metro parse break.

---

## 6. Invariants

**Preserve:**
- **I-BRAND-UNIVERSAL-AUTHORING** (META-ORCH-0972): universal authoring; Stripe gates money not authoring.
  Preserved + strengthened — the category router (a violation of its spirit) is removed. *Test:* SC-2/SC-8.
- **Server ownership gate** (`account_id === userId`, `parse-restaurant-menu:155-157`) — untouched (no edge
  change). *Test:* parser still 403s a non-owner (existing behavior; not re-tested here, out of scope).
- **Draft-only parser contract** — proposals land in `agent_pending_actions` as `create_experience`; publish
  gated downstream. Untouched.
- **RN double-ScrollView footgun guard** (`feedback_rn_scrollview_flex_grow_default_one_silent_footgun.md`):
  the new pills ScrollView MUST carry `flexGrow:0, flexShrink:0`. *Test:* structural grep (§9).

**Propose (DRAFT — flips ACTIVE on CLOSE; orchestrator owns the flip):**
- **`I-PROPOSED-1144-PARSERS-CATEGORY-AGNOSTIC`** — "The experience snap parsers (Ve5 menu, Ve6 activities)
  are reachable by EVERY brand unconditionally. No `venueCategory` equality or verification predicate may
  gate *reaching* a parser in the create surface. `parseMode` is chosen explicitly by the user, never
  derived from the brand." *Enforced by:* the rewritten contract test (§9) asserting the create surface
  contains NO `venueCategory === "restaurant"` / `=== "play"` branch and NO `canGenerateExperiences*` import.

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-1 (happy) | + → Create experience | tap | chooser opens with 3 rows | component |
| T-2 (happy) | restaurant brand | open chooser | all 3 rows visible (food/activities/manual) | component |
| T-3 (edge) | `creative_and_arts` brand | open chooser | all 3 rows visible (was stranded) | component |
| T-4 (edge) | null-category brand | open chooser | all 3 rows visible | component |
| T-5 (happy) | tap "Snap a food menu" | tap | snap flow opens, `parseMode="menu"`, sheet auto-opens | route |
| T-6 (happy) | tap "Snap an activities menu" | tap | snap flow opens, `parseMode="activities"` | route |
| T-7 (happy) | tap "Build it yourself" | tap | `/experience/create` (manual wizard) | route |
| T-8 (error) | parse returns 0 items | empty result | toast `COPY §3 no-items` (food/play), phase resets | component |
| T-9 (happy) | tab with mixed drafts+live | render | 4 pills + bucketed rows, no banner | component |
| T-10 (edge) | tab empty | render | `COPY §4` empty state + CTA opens chooser | component |
| T-11 (regression) | long-press a draft row | long-press | multi-select enters; bulk delete works | component |
| T-12 (structural) | create surface source | grep | NO `venueCategory ===` branch, NO `canGenerateExperiences*` import (fails on revert) | static |
| T-13 (web) | `expo export` web | build | succeeds, under `__common` budget | build |

---

## 8. Implementation order

1. **New `ExperienceCreateChooser.tsx`** (§4.1) — copy the `UniversalCreatorSheet` structure; 3 unconditional
   rows; copy-doc strings.
2. **New `/experience/choose` route** mounting the chooser (A1) — `visible` true, `onClose=router.back()`,
   option handlers route to `/experience/snap?mode=menu`, `?mode=activities`, `/experience/create`.
3. **New `/experience/snap.tsx` route** (§4.2) — relocate `ExperienceGenerationSurface`'s parse/review half;
   read `mode` param → explicit `parseMode` + correct `SnapInput` + `COPY §3` headers; auto-open sheet;
   confirm → back to tab.
4. **Modify `UniversalCreatorSheet.tsx`** — experience option route `/experience/create` → `/experience/choose`
   (single line; update its docblock + the option subtitle if the copy doc supersedes it — keep within §1
   slots).
5. **Rebuild `app/(tabs)/hub/experiences.tsx`** (§4.3) — delete banner + category router + predicates; add the
   Trips-style pill/bucket skeleton; keep the multi-select/manage/list half; empty-state CTA → `/experience/choose`.
6. **Delete** `src/utils/canGenerateExperiencesFromMenu.ts` + `...Activities.ts` + their two unit tests
   (`src/utils/__tests__/canGenerateExperiencesFrom*.test.ts`).
7. **Rewrite** `app/(tabs)/hub/__tests__/hubExperiences.contract.test.ts` to the inverse fails-on-revert guard
   (§9).
8. Run gates (jest, the 4 business desktop-web jest gates per
   `feedback_mingla_business_desktop_web_contracts.md`, the ORCH-1083 web bundle budget, strict-grep).

---

## 9. Regression prevention (fails-on-revert contract)

**Structural safeguard:** rewrite `hubExperiences.contract.test.ts` so it asserts the NEW invariant and
FAILS if the category router is reintroduced:

```
// ORCH-1144 — experience parsers are venue-category-agnostic; both reachable by every brand.
// This test FAILS if the deleted venueCategory router or the canGenerate* predicates return.
const source = readFileSync(EXPERIENCES_ROUTE, "utf8");
test("create surface has NO venueCategory parser gate", () => {
  expect(source).not.toMatch(/venueCategory === "restaurant"/);
  expect(source).not.toMatch(/venueCategory === "play"/);
  expect(source).not.toMatch(/canGenerateExperiencesFrom/);
});
test("chooser surface offers all three options unconditionally", () => {
  const chooser = readFileSync(CHOOSER, "utf8");
  expect(chooser).toMatch(/parseMode/i); // or the route literals ?mode=menu / ?mode=activities
  expect(chooser).toMatch(/experience-chooser-food/);
  expect(chooser).toMatch(/experience-chooser-activities/);
  expect(chooser).toMatch(/experience-chooser-manual/);
});
```

**Proof obligation:** the implementor must show this test PASSES on the new code and FAILS when the
`venueCategory` router / predicate import is restored (revert one hunk → red). The `flexGrow:0` footgun
guard: add a grep assertion that the rebuilt tab's `pillsScroll` style carries `flexGrow: 0`.

**Protective comment** (top of the rebuilt `experiences.tsx`): "ORCH-1144 — venue-category-agnostic. Both
parsers reach every brand via the +→Create experience chooser. Do NOT reintroduce a `venueCategory` branch
or a `canGenerate*` predicate to gate reaching a parser — see I-PROPOSED-1144-PARSERS-CATEGORY-AGNOSTIC."

---

## 10. Open questions

1. **`app/experience/coming-soon.tsx`** — dead (nothing routes to it; copy markets an unshipped flow). Delete
   the route, or leave it untouched as off-scope? **Recommendation:** delete it (Constitution #8 subtract);
   but this is Seth's call — flag, do not assume.
2. **Snap-flow reach — route vs inline sheet.** SPEC specifies a `/experience/snap?mode=` route (§4.2) for a
   clean back-stack. If the implementor finds an existing modal pattern that's lower-risk, it must
   stop-and-amend rather than silently switch.
3. **Chooser wiring A1 vs A2** (§4.4) — SPEC recommends A1 (`/experience/choose` route, single
   `UniversalCreatorSheet` change). If A1 conflicts with an expo-router constraint, fall back to A2 with a
   parallel store flag — flag the switch.
4. **Copy primary vs alternate** — SPEC uses the Recommended-primary set (copy doc §"Recommended primary
   set"). If Seth prefers an alternate for any slot, that's a copy-only swap, no structural change.

---

## 11. Downstream routing

- **Next = mingla-implementor (business side).** Build per §4-§9; do NOT touch edge functions, the parse
  hook mutation, the manual wizard, or non-experience `venueCategory` consumers.
- **Then = mingla-tester (business side).** Verify SC-1..SC-13 on iOS sim + Android emulator + business web
  export; adversarial: a `creative_and_arts` / null-category brand reaching both parsers (SC-8), and a
  revert-the-router check (T-12 fails-on-revert).
- **Then = mingla-orchestrator CLOSE.** Flip `I-PROPOSED-1144-PARSERS-CATEGORY-AGNOSTIC` → ACTIVE; OTA the
  business `development`/`production` channels per the EAS OTA gotchas (heed COMMS-0027 cache-poisoning:
  isolated `TMPDIR`, clean detached checkout, per-platform, `--clear-cache`).

---

## Scoped allowlist (implementor may change ONLY these)

**Add:**
- `mingla-business/src/components/experience/ExperienceCreateChooser.tsx`
- `mingla-business/app/experience/choose.tsx`
- `mingla-business/app/experience/snap.tsx`

**Modify:**
- `mingla-business/app/(tabs)/hub/experiences.tsx` (full rebuild)
- `mingla-business/src/components/ui/UniversalCreatorSheet.tsx` (experience-option route → `/experience/choose`; docblock)
- `mingla-business/app/(tabs)/hub/__tests__/hubExperiences.contract.test.ts` (rewrite to fails-on-revert guard)

**Delete:**
- `mingla-business/src/utils/canGenerateExperiencesFromMenu.ts`
- `mingla-business/src/utils/canGenerateExperiencesFromActivities.ts`
- `mingla-business/src/utils/__tests__/canGenerateExperiencesFromMenu.test.ts`
- `mingla-business/src/utils/__tests__/canGenerateExperiencesFromActivities.test.ts`
- *(OPEN Q1)* `mingla-business/app/experience/coming-soon.tsx` — only if Seth approves the retire.

## DO-NOT-TOUCH (stop-and-amend before any edit)

- `supabase/functions/parse-restaurant-menu/**`, `supabase/functions/parse-play-activities/**`,
  `supabase/functions/_shared/geminiMenuParser.ts`, `_shared/geminiActivitiesParser.ts` (parsers — no change).
- `mingla-business/src/hooks/usePendingExperiences.ts` (parse mutation already explicit-`parseMode`).
- `mingla-business/src/services/experienceGenerationService.ts`,
  `mingla-business/src/services/experiencesService.ts` (parse/confirm/list — unchanged).
- `mingla-business/src/components/experience/ExperienceCreatorWizard.tsx`,
  `mingla-business/app/experience/create.tsx` (manual wizard — unchanged).
- `mingla-business/src/components/experience/MenuSnapInput.tsx`,
  `ActivitiesSnapInput.tsx`, `ExperienceReviewCards.tsx`, `ExperienceListCard.tsx` (reused as-is).
- `mingla-business/app/(tabs)/hub/trips.tsx`, `events.tsx` (parity reference — read, never edit).
- Any OTHER `venueCategory` consumer (`app/venue/create.tsx`, `src/components/brand/PublicBrandPage.tsx`,
  `src/services/poolSearchService.ts`, `brandMapping.ts`, `draftVenueStore.ts`, etc.) — UNRELATED, off-limits.
- `mingla-business/src/types/brand.ts` (`VenueCategory` stays — still used elsewhere).
