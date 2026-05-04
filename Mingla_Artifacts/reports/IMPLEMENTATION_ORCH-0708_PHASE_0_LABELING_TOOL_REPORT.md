# IMPLEMENTATION REPORT — ORCH-0708 Phase 0 Labeling Tool

**Status:** implemented and verified (build) · partially verified (UI runtime — needs operator hands-on)
**ORCH IDs closed in this work:** ORCH-0708 Phase 0, ORCH-0709 (Activity icon fold-in)
**Spec:** `Mingla_Artifacts/reports/SPEC_ORCH-0708_PHOTO_AESTHETIC_SCORING_INTEGRATION.md` §24
**Dispatch:** `Mingla_Artifacts/prompts/IMPL_ORCH-0708_PHASE_0_LABELING_TOOL.md`

---

## 1. Summary

Built the **Photo Labeling** admin page — a new top-level admin route (`#/photo-labeling`)
under the "Quality Gates" sidebar group. It gives the operator a structured workflow to
label real-world places with expected photo-aesthetic JSON outputs:

- **Anchors tab (6 slots, fixed categories)** — feeds Claude's calibration examples
- **Fixtures tab (30 slots, 10 per Raleigh/Cary/Durham)** — golden-test answer keys
- **Compare with Claude tab** — side-by-side diff between operator answer keys and
  Claude's actual `photo_aesthetic_data.aggregate` (activates post-backfill)
- **Export** — Anchors as system-prompt-injection text block; Fixtures as JSON matching
  the `photo_aesthetic_golden_fixtures.v1` schema

Database side: a new `photo_aesthetic_labels` table with anchor-category CHECK constraint,
a partial unique index that prevents duplicate committed anchors per category, and a
5-policy RLS gate (service_role full + admin CRUD via `admin_users`).

ORCH-0709 (Activity icon missing from Sidebar's `ICON_MAP`) was discovered during step 6
and folded into the same Sidebar.jsx edit alongside the `Camera` icon addition.

---

## 2. Old → New Receipts

### `supabase/migrations/20260503100002_orch_0708_photo_aesthetic_labels_table.sql` (NEW)
**What it did before:** N/A (new file).
**What it does now:** Creates `photo_aesthetic_labels` table (12 columns, 4 indexes, 2 CHECK
constraints, 2 FK constraints, updated_at trigger), enables RLS, defines 5 policies (service_role
all + admin CRUD via admin_users gate). Idempotent via `CREATE … IF NOT EXISTS`.
**Why:** Spec §24.2 — operator-labeled answer keys storage.
**Lines:** 145.

### `mingla-admin/src/constants/photoLabeling.js` (NEW)
**What it did before:** N/A.
**What it does now:** Single-source-of-truth constants for the labeling form: `MINGLA_SIGNAL_IDS`
(16), `ANCHOR_CATEGORIES` (6 with description copy), `FIXTURE_CITIES` (3), 5 form-field enums
(`LIGHTING_OPTIONS`, `COMPOSITION_OPTIONS`, `SUBJECT_CLARITY_OPTIONS`, `PRIMARY_SUBJECT_OPTIONS`,
`VIBE_TAG_OPTIONS`, `SAFETY_FLAG_OPTIONS`), aesthetic-score range constants,
`EMPTY_EXPECTED_AGGREGATE` default, and `ANCHOR_CANDIDATE_FILTERS` documenting each anchor
category's SQL filter intent.
**Why:** Spec §24.3 — form field schema.
**Lines:** ~150.

### `mingla-admin/src/components/photoLabeling/LabelEditor.jsx` (NEW)
**What it did before:** N/A.
**What it does now:** Controlled-component form with all 11 spec fields. Inline sub-components:
`ChipMultiselect` (4 tones — neutral/positive/negative/warning), `PhotoLightbox` (Esc/←/→
keyboard nav, click-outside close), `PlaceHeader`, `PhotoStrip`, `FieldDropdown`, `AestheticScoreSlider`.
Photo-quality-notes 300-char counter blocks Commit on overflow.
**Why:** Spec §24.3 — shared label form for Anchors + Fixtures.
**Lines:** ~370.

### `mingla-admin/src/components/photoLabeling/CandidatePicker.jsx` (NEW)
**What it did before:** N/A.
**What it does now:** Modal-based candidate picker. Two modes: `anchor` (per-category SQL filter
via `applyAnchorFilter()`, JS-builder rewrite of the WHERE strings; 10-result limit; `adult_venue`
swaps to debounced 250ms ilike name-search) and `fixture` (`is_servable=true AND is_active=true
AND city=$1 ORDER BY review_count DESC LIMIT 50`). All 5 async states explicit:
loading / error+retry / empty type-to-search / empty no-matches / populated.
**Why:** Spec §24.4 — anchor candidate queries + fixture broader query.
**Lines:** ~290.

### `mingla-admin/src/components/photoLabeling/labelsService.js` (NEW)
**What it did before:** N/A.
**What it does now:** Thin Supabase wrapper for `photo_aesthetic_labels` CRUD:
`fetchAnchorLabels()`, `fetchFixtureLabels()` (both join `place_pool` for the place context),
`insertAnchorLabel()`, `insertFixtureLabel()`, `updateLabel()`, `uncommitAnchorByCategory()`
(the swap-collision helper that flips an existing committed anchor to draft before a new
commit can land), `deleteLabel()`. All throw on error — no silent fallbacks.
**Why:** Shared service layer so AnchorsTab + FixturesTab + CompareWithClaudeTab speak the
same data shape and error contract.
**Lines:** ~95.

### `mingla-admin/src/components/photoLabeling/AnchorsTab.jsx` (NEW)
**What it did before:** N/A.
**What it does now:** Renders 6 anchor slots (one per `ANCHOR_CATEGORIES`). Empty slot → CTA
"Pick a candidate" → opens `CandidatePicker` (mode=anchor) → opens `LabelEditor` modal.
Filled slot shows place name, 5-photo thumbnail strip, rating, "committed" / "draft" badge,
Edit + Un-commit + Re-label buttons. **Anchor swap collision dialog**: when committing a 2nd
anchor for a category that already has one, opens a `Modal destructive` asking "Replace existing
anchor?". On confirm: calls `uncommitAnchorByCategory` first, then commits the new one
(matches the partial unique index `idx_photo_aesthetic_labels_anchor_category_unique`).
**Why:** Spec §24.3 — Anchors tab UX + collision-safe commit.
**Lines:** ~330.

### `mingla-admin/src/components/photoLabeling/FixturesTab.jsx` (NEW)
**What it did before:** N/A.
**What it does now:** 3-column grid (R/C/D), 10 slots per city. Compact slot rows:
index # + thumbnail + name + commit badge + Edit / Re-label buttons. Re-label uses
`window.confirm` + `deleteLabel` (slot empties; operator picks a new candidate). Per-city
header shows committed count ("3 / 10 committed").
**Why:** Spec §24.3 — Fixtures tab UX.
**Lines:** ~280.

### `mingla-admin/src/components/photoLabeling/CompareWithClaudeTab.jsx` (NEW)
**What it did before:** N/A.
**What it does now:** Computes per-fixture diff via `computeFixtureDiff(label)` using spec
§24.5 logic (numeric ±1.0 for aesthetic_score, exact match for enums, subset-match for
lists where Claude is allowed extras, exact-match for safety_flags). Aggregate stats panel
shows fixtures-pass count + per-field pass rate (color-coded green/amber/red). "Show only
failing" toggle filters the visible diff cards. Pre-backfill state shows the spec §24.5
placeholder copy.
**Why:** Spec §24.5 — diff view.
**Lines:** ~270.

### `mingla-admin/src/components/photoLabeling/exporters.js` (NEW)
**What it did before:** N/A.
**What it does now:** Browser-side download helpers. `exportAnchorsJson()` emits a markdown
text block listing each committed anchor with place context, expected_aggregate, and
operator notes — ready to paste into Claude's system prompt. `exportFixturesJson()` emits
JSON matching `photo_aesthetic_golden_fixtures.v1`. Both throw if no committed rows exist.
**Why:** Spec §24 — export buttons in page header.
**Lines:** ~100.

### `mingla-admin/src/pages/PhotoLabelingPage.jsx` (NEW → SHELL → FULL)
**What it did before:** Stub with "Coming together" placeholder.
**What it does now:** Full page: header (title + description + 2 export buttons with toast
feedback) + Tabs primitive + AnimatePresence framer-motion tab transition + three real tab
components (`AnchorsTab` / `FixturesTab` / `CompareWithClaudeTab`).
**Why:** Spec §24.3 — page architecture.
**Lines:** ~145 (final).

### `mingla-admin/src/App.jsx` (MODIFIED)
**What it did before:** PAGES object mapped 14 routes; no `photo-labeling`.
**What it does now:** Imports `PhotoLabelingPage`, registers `"photo-labeling": PhotoLabelingPage`
under `signals` in PAGES.
**Why:** Spec §24.3 — top-level route registration.
**Lines:** +2.

### `mingla-admin/src/lib/constants.js` (MODIFIED)
**What it did before:** Quality Gates group had only `signals`.
**What it does now:** Added `{ id: "photo-labeling", label: "Photo Labeling", icon: "Camera" }`
to Quality Gates group.
**Why:** Spec §24.3 — sidebar nav entry.
**Lines:** +1.

### `mingla-admin/src/components/layout/Sidebar.jsx` (MODIFIED — bundles ORCH-0709 fix)
**What it did before:** ICON_MAP whitelist missing both `Activity` (silent fallback to
LayoutDashboard for Signal Library) and `Camera` (would fail similarly for new entry).
**What it does now:** Adds `Activity` + `Camera` to lucide imports and ICON_MAP. Signal
Library now displays the correct icon (closes ORCH-0709). Photo Labeling displays Camera.
**Why:** ORCH-0708 (Camera) + ORCH-0709 (Activity backfill).
**Lines:** +4.

---

## 3. Spec Traceability — Acceptance Criteria

| AC | Criterion (spec §24.8) | Verification | Result |
|---|---|---|---|
| AC-16 | `photo_aesthetic_labels` table exists with documented schema + RLS policies | MCP `\d` + `pg_policies` probes (see migration validation step) | ✅ PASS |
| AC-17 | Anchors tab renders 6 fixed-category slots, empty → picker → editor flow works | Code review, build PASS | ⚠ UNVERIFIED runtime (needs operator) |
| AC-18 | Fixtures tab renders 30 slots organised 10/city × 3 cities | Code review (`Array.from({length: 10})` × `FIXTURE_CITIES`) | ✅ PASS structurally; runtime UNVERIFIED |
| AC-19 | LabelEditor surfaces all 11 spec fields with correct enum sets | Code review against constants/photoLabeling.js | ✅ PASS |
| AC-20 | Anchor swap collision shows confirmation dialog, never silently overwrites | Code review: handleCommit branches to setCollisionOpen + uncommitAnchorByCategory | ✅ PASS structurally; UNVERIFIED runtime |
| AC-21 | Compare with Claude tab activates post-backfill, shows pre-backfill placeholder otherwise | Code review: readyDiffs.length === 0 branch | ✅ PASS structurally; UNVERIFIED runtime (needs photo_aesthetic_data populated) |
| AC-22 | Export buttons download Anchors text + Fixtures JSON | Code review: exporters.js downloadFile() helper, MIME types correct | ⚠ UNVERIFIED runtime |
| AC-23 | RLS gates non-admin reads on photo_aesthetic_labels | Migration probe B verified `pg_policies` (5 policies, admin-gated) | ✅ PASS |
| AC-24 | All async surfaces handle loading / error+retry / empty / populated | Code review every Tab + CandidatePicker | ✅ PASS |
| AC-25 | Vite build EXIT=0, no new lint errors introduced | `npx vite build` → 16.98s, EXIT=0; eslint shows 1 pre-existing-pattern false-positive (motion JSX) matching App.jsx | ✅ PASS |

**5 ACs are structurally verified but await operator runtime testing (AC-17, AC-18, AC-20, AC-21, AC-22).** The code paths, state machines, and DB writes are correct on inspection; what remains is operator hands-on confirmation of the actual labeling UX velocity.

---

## 4. Invariant Verification

| Invariant | Preserved? |
|---|---|
| **I-PHOTO-AESTHETIC-DATA-SOLE-OWNER** (DRAFT) — only `place_pool.photo_aesthetic_data` is the canonical Claude output; operator labels live in a separate table | ✅ Yes — `photo_aesthetic_labels` is a sibling, not a replacement |
| **I-CATEGORY-SLUG-CANONICAL** — every category-slug helper must return values within `Object.values(DISPLAY_TO_SLUG)` | ✅ Not affected — labeling tool uses 16 SIGNAL IDs (different abstraction layer per spec patch §24.3); orchestrator-adjudicated |
| **I-FIELD-MASK-SINGLE-OWNER** — signal scoring field-weight prefixes have one source of truth | ✅ Not affected (Phase 0 doesn't touch signalScorer) |
| **No silent failures (Constitution #3)** | ✅ Every Supabase call has try/catch with `console.error` + `addToast({variant: "error"})` |
| **One owner per truth (Constitution #2)** | ✅ Parent (AnchorsTab/FixturesTab) owns persistence; LabelEditor is pure UI taking `value`+`onChange` |
| **Server state stays server-side (Constitution #5)** | ✅ No Zustand used — local component state only for UI flags (modal open, picker mode) |

---

## 5. Parity Check

N/A — admin-only feature. No solo/collab dichotomy.

---

## 6. Cache Safety

No React Query cache changes (admin uses direct Supabase calls, not React Query).
The labels-service helpers always re-fetch via `refresh()` after writes — no stale-cache risk.

---

## 7. Regression Surface (what tester should check)

The work is purely additive (new files + 3 single-line additions to existing files). Lowest-risk changes I'm aware of, but checking:

1. **Sidebar.jsx** — adding `Activity` + `Camera` to ICON_MAP shouldn't affect any existing entry. Verify Signal Library now shows the activity icon and Photo Labeling shows the camera icon.
2. **App.jsx PAGES object** — verify all 14 existing routes still load; new `#/photo-labeling` reaches the new page.
3. **lib/constants.js NAV_GROUPS** — verify the Quality Gates group renders both Signal Library and Photo Labeling, with Camera + Activity icons.
4. **No existing component imports any of the new photoLabeling/* files** — so no cascade risk.
5. **The new migration is purely additive** (CREATE TABLE) — no risk to existing tables, RLS, or RPCs.

---

## 8. Constitutional Compliance

| # | Principle | Status |
|---|---|---|
| 1 | No dead taps | ✅ — all Pick / Edit / Save / Commit / Cancel / Export buttons wired |
| 2 | One owner per truth | ✅ — parent owns persistence, LabelEditor is pure UI |
| 3 | No silent failures | ✅ — every catch logs to console + surfaces a toast |
| 4 | One query key per entity | N/A — admin uses direct Supabase, not React Query |
| 5 | Server state stays server-side | ✅ — no Zustand, no client cache of fetched rows |
| 7 | Label temporary fixes | ✅ — no `[TRANSITIONAL]` markers in shipped code (the only one was in the Phase-0 stub which was replaced) |
| 8 | Subtract before adding | ✅ — replaced placeholder shell wholesale before fleshing out |
| 9 | No fabricated data | ✅ — every shown field comes from DB (place_pool / photo_aesthetic_labels) |

---

## 9. Discoveries for Orchestrator

### ORCH-0709 — Sidebar ICON_MAP missing `Activity` (FOLDED INTO THIS COMMIT)
- **Status:** Closed in this same commit alongside ORCH-0708.
- **Evidence:** Sidebar.jsx now has `Activity` in both lucide imports and `ICON_MAP`.

### NEW — SignalLibraryPage uses `showToast` which doesn't exist on ToastContext
- **Severity:** S2-medium (silent failure of every Signal Library toast)
- **Classification:** `bug` + `regression` (likely regression — 10+ newer admin pages use `addToast`)
- **Where:** `mingla-admin/src/pages/SignalLibraryPage.jsx` lines 43, 158, 207, 387, 612 (5 places)
- **What's broken:** `const { showToast } = useToast();` returns `undefined` — context exposes
  `addToast` not `showToast`. Every Signal Library toast call (success notifications, error
  surfaces) silently throws TypeError that's swallowed by the synchronous call site.
- **Fix size:** trivial (5 destructure renames + 5 call-shape changes from `showToast(msg, variant)`
  to `addToast({variant, title})`).
- **Recommended:** ORCH-0710. Defer to a follow-on micro-dispatch — out of scope for ORCH-0708.

### NEW — Pre-existing eslint config flags `motion` as unused-but-used in JSX
- **Severity:** S3-low (false-positive lint, no runtime impact)
- **Where:** Affects every file using `<motion.X>` JSX (App.jsx pre-existing, my new PhotoLabelingPage.jsx)
- **Recommendation:** Live with it (codebase already tolerates it via App.jsx). Optional ORCH if eslint config tuning is wanted.

### NEW — Pre-existing eslint react-hooks/use-memo error in Sidebar.jsx
- **Severity:** S3-low
- **Where:** `Sidebar.jsx:50` — `const stableOnMobileClose = useCallback(onMobileClose, [onMobileClose])` flagged because the first arg isn't an inline function.
- **Recommendation:** Live with it OR fix as part of ORCH-0710.

---

## 10. Verification Matrix

| Action | Status | Evidence |
|---|---|---|
| Migration applied via `supabase db push` | ✅ PASS | User-pasted CLI output confirming "Finished supabase db push" |
| 3 RLS probes (schema, policies, behavioral) | ✅ ALL PASS | Recorded in conversation; 12 cols, 5 policies, all 3 CHECK/unique behaviors fire |
| Vite build | ✅ PASS | `npx vite build` → 16.98s, EXIT=0, 2932 modules transformed |
| ESLint on new files | ✅ PASS (1 pre-existing pattern false-positive on `motion`, matches App.jsx) | `npx eslint` clean except for the JSX-motion config quirk |
| ESLint on pre-existing files | 2 pre-existing errors (App.jsx motion, Sidebar.jsx use-memo) — confirmed via git stash baseline | Documented in Discoveries |

---

## 11. Files Changed Summary

**New files (8):**
- `supabase/migrations/20260503100002_orch_0708_photo_aesthetic_labels_table.sql`
- `mingla-admin/src/constants/photoLabeling.js`
- `mingla-admin/src/components/photoLabeling/LabelEditor.jsx`
- `mingla-admin/src/components/photoLabeling/CandidatePicker.jsx`
- `mingla-admin/src/components/photoLabeling/labelsService.js`
- `mingla-admin/src/components/photoLabeling/AnchorsTab.jsx`
- `mingla-admin/src/components/photoLabeling/FixturesTab.jsx`
- `mingla-admin/src/components/photoLabeling/CompareWithClaudeTab.jsx`
- `mingla-admin/src/components/photoLabeling/exporters.js`
- `mingla-admin/src/pages/PhotoLabelingPage.jsx`

**Modified files (3):**
- `mingla-admin/src/App.jsx` (+2 lines: import + PAGES entry)
- `mingla-admin/src/lib/constants.js` (+1 line: NAV_GROUPS Quality Gates entry)
- `mingla-admin/src/components/layout/Sidebar.jsx` (+4 lines: Activity + Camera in imports + ICON_MAP)

**Total lines added:** ~2,250 (migration + 9 JSX/JS files + 3 small edits)

---

## 12. What Comes Next

1. **Operator runtime testing** — open `#/photo-labeling`, click through Anchors → Pick a candidate → label → Commit; repeat for an "adult_venue" with name-search; verify swap-collision dialog by committing a second steakhouse anchor; check Fixtures grid empties + populates as expected; confirm Export Anchors / Fixtures buttons download files.
2. **Operator labeling session** — ~1.5 hours to commit 6 anchors + 30 fixtures (per dispatch estimate).
3. **Phase 1 dispatch** — operator hands the exported anchors text into the Claude system-prompt template; Phase 1 then ships the `score-place-photo-aesthetics` edge function (Phase 2 in spec terms — naming overlap with the dispatch's "Phase 0/1/2"). At that point, the Compare-with-Claude tab activates with real data.

---

## 13. Sign-off

- **Status:** implemented, build verified, runtime UNVERIFIED for the 5 ACs that require operator hands-on
- **Risk:** Low — purely additive changes; no existing surface modified except 3 single-line additions
- **Closes ORCH IDs (pending tester verification of runtime ACs):** ORCH-0708 Phase 0, ORCH-0709
- **Defers / reports back:** New ORCH-0710 candidate (SignalLibraryPage broken toasts)
