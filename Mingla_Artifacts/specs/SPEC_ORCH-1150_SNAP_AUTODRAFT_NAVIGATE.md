# SPEC — ORCH-1150 [snap suggestions auto-draft + navigate to drafts]

**Skill:** mingla-forensics · **Phase:** SPEC · **Date:** 2026-06-15
**Worktree:** `~/Desktop/mingla-orchs/orch-1150-[snap-autodraft-navigate]` · branch `orch-1150-snap-autodraft-navigate`
**Investigation:** `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1150_SNAP_AUTODRAFT_NAVIGATE.md`
**Mechanism chosen (LOCKED):** Option A — CLIENT auto-confirm-all. No edge deploy, no migration. Pure JS / OTA-able.

This is a CONTRACT. The implementor builds exactly this. Snippets are illustrative (≤3 lines), not implementations.

---

## 1. Executive summary

Replace the per-card "Suggested experiences" review screen (Reject/Edit/Accept) in the business-app snap flow with **auto-draft-all + navigate to drafts**. The instant the menu/activities parser returns N suggestions, the client confirms EVERY proposal through the existing `agent-confirm-action` → `create_experience` draft path (looped over the proposal IDs the parser already returns), shows a brief honest "Creating N drafts…" state, invalidates the experiences-list cache, then navigates to the Hub Experiences tab where the brand curates via the normal drafts list (edit / publish / **delete = the new "reject"**). The transient AI-proposal surface is removed entirely.

## 2. Scope & non-goals

**In scope:**
- Rewrite `app/experience/snap.tsx` result behavior: parse → auto-confirm-all → progress state → invalidate → navigate to drafts.
- Add a batch confirm helper to `usePendingExperiences` (client-only; reuses the existing per-proposal confirm).
- Delete `ExperienceReviewCards.tsx` + `ExperienceConfirmationCard.tsx` (dead after this change; used only by snap.tsx — INVESTIGATE F-2/DISC-1150-1).
- Honest copy for: generating, created-N, partial-failure, zero (zero already short-circuits pre-draft), and all-failed.
- Strict-grep gate + jest regression suite + tester adversarial hook.

**Non-goals (explicitly NOT this ORCH):**
- NO change to the `agent-confirm-action` edge fn, the `create_experience` executor, or the parser Gemini cores (Option A is client-only — INVESTIGATE F-4/F-5).
- NO change to Ari chat's per-action confirm UX (`AriChatScreen.tsx` / `useConfirmPendingAction`) — Ari keeps MANUAL confirm (INVESTIGATE F-5).
- NO change to the drafts list / Hub Experiences tab rendering, bucketing, or multi-select (the destination is already correct — INVESTIGATE F-3). It is a navigation target only.
- NO new DB columns, RLS, or migration. NO consumer-app change.
- NO bulk "Accept all" button revival (the whole flow becomes implicitly "accept all").

**Assumptions:** the parser response `pending_actions[]` carries one `id` per suggestion (proven `parse-restaurant-menu/index.ts:238-242`); the drafts query has no status filter and includes drafts (proven `experiencesService.ts:161-166`).

## 3. Cross-Surface Impact Declaration

| # | Surface | Covered | User-visible behavior | Files touched there | Parity |
|---|---------|---------|----------------------|---------------------|--------|
| 1 | Consumer iOS (`app-mobile`) | NO | — | none | no snap/parser flow exists in consumer |
| 2 | Consumer Android (`app-mobile`) | NO | — | none | same |
| 3 | Buyer/anon Web | NO | — | none | public buyer routes, no authoring |
| 4 | Business iOS | YES | snap → "Creating N drafts…" → land on Hub Experiences (Drafts) with the N new drafts | `app/experience/snap.tsx`, `src/hooks/usePendingExperiences.ts`, (delete) review components | automatic (shared RN code) |
| 5 | Business Android | YES | identical to iOS | same files | automatic (shared RN code) |
| 6 | Admin Web | NO | — | none | no experience authoring |
| 7 | Business Web preview | YES | identical RN route renders on web; same behavior | same files | automatic (same JS) |

HARD GATE satisfied: every surface enumerated with covered/not-covered + reason.

## 4. Layered specification

### 4.1 Database — NONE
No schema, RLS, or migration change. The `agent_pending_actions` lifecycle + atomic idempotency flip are reused as-is.

### 4.2 Edge function — NONE (DO-NOT-TOUCH)
`agent-confirm-action`, `create_experience` executor, `parse-restaurant-menu`, `parse-play-activities` are unchanged. Option A drives them through the existing client.

### 4.3 Service — NO CHANGE
`experienceGenerationService.ts` (`confirmExperienceProposal`, parse invokers) is reused verbatim. The parse response already returns `pending_actions: PendingExperienceProposal[]` with `id`s — these are the inputs to the batch loop.

### 4.4 Hook — `src/hooks/usePendingExperiences.ts`
Add ONE method, `confirmAll`, that confirms an array of proposal IDs sequentially and returns a tally. It reuses the existing `confirmMutation.mutateAsync` so the existing `onSuccess` invalidation of `pendingExperienceKeys.byBrand` + `experienceKeys.listByBrand` fires per success. Signature (illustrative):

```ts
confirmAll(ids: string[]): Promise<{ created: number; failed: number; firstError: string | null }>
```

Contract:
- Iterate `ids` in order; for each, `await confirmMutation.mutateAsync({ id })` inside a try/catch. A `kind:"error"` response OR a thrown error counts as `failed` (capture `firstError` from the first failure's message).
- An `expired_regenerate` response (INVESTIGATE DISC-1150-2 — effectively dead for fresh rows but must be handled) counts as `failed` with a generic message; do NOT special-case a regenerate CTA in this flow.
- Expose `isConfirmingAll: boolean` (a `useState` toggled around the loop, OR derive from a dedicated mutation). The existing `confirm`, `reject`, `isConfirming` MUST remain exported (Ari does not use them, but other call sites and tests may — verify none break).
- Do NOT remove the existing `confirm`/`reject` exports in this ORCH (out of scope; they are now unused by snap but deletion is a separate cleanup).

### 4.5 Component / route — `app/experience/snap.tsx`
Rewrite the result behavior. The `SnapPhase` union becomes `"idle" | "parsing" | "drafting"` (the `"review"` phase is REMOVED).

Flow:
1. `handleFilesReady`: `setPhase("parsing")` → `await parseFiles(files)`.
2. On `result.kind === "error"` → toast + `setPhase("idle")` (unchanged).
3. On `result.experiences_count === 0` → toast `copy.emptyParseToast` + `setPhase("idle")` (unchanged — zero never enters drafting, INVESTIGATE F-6).
4. Otherwise: `setPhase("drafting")`; collect `ids = result.pending_actions.map(p => p.id)`; `const tally = await confirmAll(ids)`.
5. Navigate + toast per outcome (see §5 for exact copy):
   - `tally.created > 0` → `router.replace("/(tabs)/hub/experiences")` (the drafts tab). Set a one-shot toast that survives the navigation OR (preferred) show the toast on the snap screen for ~700ms THEN replace — recommend: invalidate, show the created-N toast inline briefly, then `router.replace`. The drafts that were just created MUST be present on arrival (see §4.6 cache contract).
   - `tally.created === 0` (all failed) → DO NOT navigate; `setPhase("idle")`; toast the all-failed message with `tally.firstError` appended if present, leaving the brand on the snap screen to retry (re-snap).
6. Remove `ExperienceReviewCards` import + render block entirely. Remove the `showReview`, `reviewResolvedToEmpty`, and the post-resolve `useEffect` nav (`snap.tsx:154-168`) — superseded by the explicit post-drafting nav.
7. Keep: the auto-open snap sheet (`snapSheetVisible`), `handleSnapCancel` (back-out when nothing pending), `TopBar`, the parsing spinner, the `Toast`.
8. Update the file header doc comment (`snap.tsx:11-19`) to describe auto-draft-all (remove "ExperienceReviewCards (accept → draft / reject)" language).

States (all must render honest copy — no dead taps, no silent failure):
- `parsing`: existing spinner + `copy.loadingText` ("Reading your menu…" / "Reading your activities…").
- `drafting`: spinner + new copy "Creating your experiences…" (SC-2). The TopBar back affordance MAY remain but tapping it mid-draft must not strand state — simplest: keep back enabled; if tapped mid-draft, the in-flight confirms still complete server-side and land in drafts (acceptable; the brand can pull-to-refresh). Recommend disabling back during `drafting` for a clean honest state.
- `idle` after all-failed: toast + the snap sheet can be re-opened (existing behavior).

### 4.6 Cache invalidation contract (INVESTIGATE F-7 — load-bearing)
The navigation MUST land on a drafts list that already includes the new drafts. Two-part guarantee:
1. Each `confirmMutation.mutateAsync` success already invalidates `experienceKeys.listByBrand(brandId)` (`usePendingExperiences.ts:66`) — this marks the Hub query stale.
2. After the loop, BEFORE `router.replace`, the snap route must `await qc.invalidateQueries({ queryKey: experienceKeys.listByBrand(brandId) })` once more (belt-and-braces; the per-item invalidations may have been deduped/in-flight). Expose `qc` via the hook OR add an explicit `invalidateExperienceList(brandId)` helper to `usePendingExperiences`. The destination `useExperiencesByBrand` has `staleTime: 60_000` but invalidation overrides staleness and refetches on mount — so the Drafts pill shows the N new rows.

Acceptance: navigating to `/(tabs)/hub/experiences` immediately after auto-draft shows the new drafts in the Drafts bucket without a manual refresh.

### 4.7 Realtime — N/A.

## 5. Success criteria (per-surface where parity is manual; here parity is automatic shared-JS, so iOS == Android == Web preview)

- **SC-1 (happy path):** snapping a menu that yields N≥1 suggestions creates exactly N draft experiences (one per suggestion) and navigates to `/(tabs)/hub/experiences`; the Drafts pill count increases by N and the N drafts are visible there without manual refresh.
- **SC-2 (honest loading):** during auto-draft the screen shows a spinner + "Creating your experiences…" (or equivalent locked copy); no blank screen, no dead tap.
- **SC-3 (created-N toast):** on success the user sees a toast reflecting the real count, e.g. `Created N draft experiences — add stops, a date and price to publish.` (singular "1 draft experience" when N==1). The count MUST equal the real `tally.created`, never a hardcoded number.
- **SC-4 (zero suggestions):** a parse that returns `experiences_count === 0` shows the existing empty-parse toast and stays on the snap screen at `idle`; the auto-draft path is NOT entered and no navigation occurs.
- **SC-5 (partial failure):** if some confirms succeed and some fail, the created drafts still land; the user is navigated to drafts (since `created > 0`) and the toast honestly states the partial outcome, e.g. `Created N drafts; M couldn't be created.` — no silent loss.
- **SC-6 (all failed):** if every confirm fails (`created === 0`), the user is NOT navigated, stays on the snap screen, and sees an honest error toast (with the first error message) so they can re-snap. No empty drafts navigation.
- **SC-7 (idempotency / no duplicate):** re-confirming an already-executed proposal ID returns 409/WRONG_STATE server-side and creates no second draft; the loop counts it as failed, not as a duplicate success. (A fresh re-UPLOAD legitimately creates NEW proposals — accepted.)
- **SC-8 (Ari unaffected):** Ari chat's pending-action confirm still requires an explicit user tap; no Ari code path auto-confirms. `AriChatScreen.tsx` and `useConfirmPendingAction` are unchanged.
- **SC-9 (review surface removed):** `ExperienceReviewCards` and `ExperienceConfirmationCard` are deleted and not imported anywhere; the snap screen no longer renders per-card Accept/Reject/Edit.
- **SC-10 (no fabrication):** created drafts carry only the parsed fields; uninferable fields (stops, date, ticket) remain unset (draft shell). No `?? fallback` invents display data.

## 6. Invariants

**Preserve:**
- `I-PROPOSED-1144-PARSERS-CATEGORY-AGNOSTIC` — snap still derives `parseMode` from the URL `mode` param only; no `venueCategory` branch reintroduced. Verified by the existing `orch1144Chooser` adversarial test + the new gate.
- `I-BRAND-UNIVERSAL-AUTHORING` — executor untouched.
- `I-ARI-PENDING-STATE-MACHINE` — the pending→executing→executed atomic lifecycle is driven programmatically, not modified. Verified by SC-7 + SC-8.
- ORCH-1146 field-completeness invariants — executor + parser untouched; SC-10.

**Establish (DRAFT — flips ACTIVE on CLOSE, orchestrator owns the flip):**
- `I-PROPOSED-1150-SNAP-SUGGESTIONS-AUTO-DRAFT`: snap-parser suggestions auto-persist as draft experiences; the business snap flow has NO ephemeral-only AI-proposal review surface (no per-card accept/reject component). Enforced by the strict-grep gate in §9.

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T1 happy | parse returns 3 suggestions | mock `parseFiles` → 3 `pending_actions` | `confirmAll` called with 3 ids; 3 confirm POSTs; `router.replace("/(tabs)/hub/experiences")`; toast count = 3 | hook+route |
| T2 zero | parse returns 0 | `experiences_count:0` | no `confirmAll`, no nav, empty-parse toast, phase idle | route |
| T3 partial | 3 ids, 2 ok 1 error | mock confirm: ok, error, ok | tally `{created:2,failed:1}`; navigate; partial toast | hook |
| T4 all-fail | 2 ids both error | mock confirm: error, error | tally `{created:0}`; NO nav; error toast; phase idle | hook+route |
| T5 idempotency | confirm an already-executed id | mock 409 WRONG_STATE | counted failed, not a 2nd draft | hook |
| T6 Ari-unaffected | grep guard | source | `AriChatScreen.tsx` does not import `usePendingExperiences`/`confirmAll`; uses `useConfirmPendingAction` | gate |
| T7 review-removed | grep guard | source tree | no `ExperienceReviewCards`/`ExperienceConfirmationCard` imports anywhere; files deleted | gate |
| T8 parseMode | category-agnostic | snap.tsx source | parseMode derived from `params.mode` only (existing orch1144 test still green) | gate+jest |
| T9 cache | nav after draft | mock | `experienceKeys.listByBrand` invalidated before `router.replace` | hook |
| T10 copy | singular/plural | N=1 vs N=3 | "1 draft experience" vs "3 draft experiences" | unit |

## 8. Implementation order

1. **Hook** — add `confirmAll(ids)` + `isConfirmingAll` (+ optional `invalidateExperienceList`) to `usePendingExperiences.ts`; keep existing exports.
2. **Route** — rewrite `app/experience/snap.tsx`: new `SnapPhase`, `handleFilesReady` auto-draft loop, progress state, post-draft navigate + cache invalidate, remove review render + the resolve-to-empty `useEffect`, update header doc.
3. **Delete** — `src/components/experience/ExperienceReviewCards.tsx` + `src/components/experience/ExperienceConfirmationCard.tsx`; remove any barrel/index exports.
4. **Gate** — add `.github/scripts/strict-grep/orch-1150-snap-auto-draft.mjs` (with `--self-test`).
5. **Tests** — `app/experience/__tests__/orch1150SnapAutoDraft.test.ts` (T1–T5,T9,T10) + extend/keep `orch1144Chooser` adversarial (T8). Add `test:orch-1150` script in `mingla-business/package.json` running the gate `--self-test` + gate + jest.
6. `npx tsc --noEmit` clean.

## 9. Regression prevention (fails-on-revert contract)

**Structural safeguard:** strict-grep gate `orch-1150-snap-auto-draft.mjs` asserts ALL of:
1. `app/experience/snap.tsx` does NOT import or reference `ExperienceReviewCards` (FAIL if reintroduced).
2. `ExperienceReviewCards.tsx` and `ExperienceConfirmationCard.tsx` do NOT exist on disk (FAIL if restored).
3. `app/experience/snap.tsx` references `confirmAll` AND `router.replace` to `"/(tabs)/hub/experiences"` (FAIL if the auto-draft+navigate is reverted to per-card review).
4. `AriChatScreen.tsx` does NOT import `usePendingExperiences`/`confirmAll` and still imports `useConfirmPendingAction` (FAIL if auto-confirm bleeds into Ari).

The gate must `--self-test` (run a synthetic violating + passing fixture). **Fails-on-revert proof required from the implementor:** reverting snap.tsx to the per-card review (re-adding the `ExperienceReviewCards` import) MUST make the gate exit non-zero AND make T1/T7 fail; restoring the auto-draft flow MUST make them pass.

Jest suite `orch1150SnapAutoDraft.test.ts` mocks `usePendingExperiences` (parseFiles + confirmAll) and the router, and asserts the navigation + toast outcomes per T1–T5/T9/T10 — failing when the auto-draft branch is removed.

## 10. Open questions

- **Loading/progress copy (Seth left open):** RECOMMENDED — single inline state "Creating your experiences…" (spinner) during the loop, then a created-N toast on the drafts tab. No per-item progress bar (N is small; sequential POSTs are fast enough). Implementor uses this unless Seth overrides.
- **Toast persistence across navigation:** RECOMMENDED — show the created-N toast briefly on the snap screen (~700ms) immediately after invalidation, then `router.replace`. If a cross-screen toast utility exists and is trivial, surfacing it on the drafts tab is nicer but NOT required. (No blocker either way.)
- **Back button during `drafting`:** RECOMMENDED disabled during the loop for a clean honest state (confirms still complete server-side). Implementor's call if disabling is awkward; default = disable.

None of these block IMPLEMENT.

## 11. File allowlist + DO-NOT-TOUCH + downstream routing

**ALLOWLIST (implementor may change ONLY these):**
- `mingla-business/app/experience/snap.tsx` (rewrite result behavior)
- `mingla-business/src/hooks/usePendingExperiences.ts` (add `confirmAll`/`isConfirmingAll`/`invalidateExperienceList`)
- DELETE `mingla-business/src/components/experience/ExperienceReviewCards.tsx`
- DELETE `mingla-business/src/components/experience/ExperienceConfirmationCard.tsx`
- `.github/scripts/strict-grep/orch-1150-snap-auto-draft.mjs` (new)
- `mingla-business/app/experience/__tests__/orch1150SnapAutoDraft.test.ts` (new)
- `mingla-business/app/experience/__tests__/orch1144Chooser.tester.adversarial.test.ts` (only if a route/import literal it greps changed)
- `mingla-business/package.json` (add `test:orch-1150` script)
- artifact docs under the worktree's `Mingla_Artifacts/`

**DO-NOT-TOUCH (stop-and-amend before any edit):**
- `supabase/functions/agent-confirm-action/index.ts` and `supabase/functions/_shared/agentTools.ts` (the `create_experience` executor) — Option A is client-only.
- `supabase/functions/parse-restaurant-menu/index.ts`, `parse-play-activities/index.ts` and their Gemini cores.
- `mingla-business/src/screens/ari/AriChatScreen.tsx`, `src/hooks/useConfirmPendingAction.ts` — Ari keeps MANUAL confirm.
- `mingla-business/app/(tabs)/hub/experiences.tsx`, `src/hooks/useExperiencesByBrand.ts`, `src/services/experiencesService.ts` — navigation target only; no rendering/bucket changes.
- `mingla-business/src/services/experienceGenerationService.ts` / `agentChatService.ts` — reused verbatim.

Amendments: append in-file or as `SPEC_AMENDMENT_ORCH-1150_SNAP_AUTODRAFT_NAVIGATE.md`. The implementor must stop-and-amend before touching anything outside the allowlist — never silently widen.

**Downstream routing:** next = **mingla-implementor (business side)** — build per this SPEC in `~/Desktop/mingla-orchs/orch-1150-[snap-autodraft-navigate]` on branch `orch-1150-snap-autodraft-navigate`; produce the implementation report + fails-on-revert proof. Then = **mingla-tester** (live-fire snap→N-drafts→drafts-tab on iOS sim + the adversarial set: zero, partial-failure, all-failed, Ari-unaffected, no-duplicate-on-resubmit). Then = **mingla-orchestrator CLOSE** (flip `I-PROPOSED-1150-SNAP-SUGGESTIONS-AUTO-DRAFT` ACTIVE; OTA the business dev channel per the EAS gotchas memory — pure JS, no edge deploy, no migration).

---
---

# AMENDMENT A — DRAFTS-VISIBILITY FIX (the real ORCH-1150 bug)

**Skill:** mingla-forensics · **Phase:** SPEC (amendment) · **Date:** 2026-06-15
**Investigation:** `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1150_DRAFTS_NOT_VISIBLE.md` (PROVEN; F-1 CONFIRMED ROOT CAUSE).
**Direction:** **A — LOCKED by Seth.** Draft offerings count toward Hub tab visibility for ALL three offering types (experiences, trips, events).
**This amendment is REQUIRED to ship.** The base SPEC above (auto-draft-all + navigate) shipped and merged, but the destination tab is UNREACHABLE for a draft-only brand: the snap navigates to `/hub/experiences`, the hub layout's nav-lock redirect bounces it straight off because the Experiences tab is not in `visibleTabs` (drafts don't count), and the 20 created drafts are real but invisible. Base SPEC SC-1 ("drafts visible on arrival") was verified only by a unit test asserting `router.replace` was *called* — the bounce slipped through (INVESTIGATE DISC-1150-D).

> **NOTE — this amendment REVISES two base-SPEC non-goals.** The base §2 said "NO new DB columns / migration" and "NO change to the drafts list / Hub tab." Direction A requires (a) a migration to `pg_brand_offering_counts` and (b) a one-line change to the `useHubTabs` gate. Those carve-outs are now IN scope under this amendment; everything else in the base non-goals still holds.

---

## A.1 Root cause (from INVESTIGATE, re-verified live)

`pg_brand_offering_counts` counts PUBLISHED offerings only. **Live prod body re-verified read-only this turn** (`pg_get_functiondef`, project `gqnoajqerqhnvulmnyvv`):

```
SELECT
  count(*) FILTER (WHERE event_type = 'event')      AS events,
  count(*) FILTER (WHERE event_type = 'trip')       AS trips,
  count(*) FILTER (WHERE event_type = 'experience') AS experiences
FROM public.events
WHERE brand_id = p_brand_id
  AND deleted_at IS NULL
  AND published_at IS NOT NULL;     -- ← drafts contribute 0
```

`SECURITY DEFINER`, `LANGUAGE sql`, `SET search_path TO 'public','pg_temp'`, `RETURNS TABLE(events bigint, trips bigint, experiences bigint)`. Chain: drafts → RPC `experiences=0` → `useHubTabs.ts:45` omits the tab → `_layout.tsx:178` redirect bounces off `/hub/experiences`.

## A.2 Design decision — ADD `*_draft` counts, do NOT change published-count meaning

**LOCKED:** the RPC keeps `events`/`trips`/`experiences` (published-only) UNCHANGED and ADDS three new columns `events_draft`/`trips_draft`/`experiences_draft` (non-deleted, `published_at IS NULL`). `useHubTabs` then ORs published+draft per type.

**Why additive, not "relax the published filter" (blast-driven — see A.3):** there is a SECOND consumer of the published-only semantics — `app/(tabs)/hub/events.tsx:186-190` `hasNoOfferingsAtAll` (switches the empty-state copy from event-specific to the universal offering-chooser when the brand has zero offerings *of any published type*). Relaxing the published filter in-place would silently change that copy switch's meaning for every draft-only brand. Keeping published columns intact + adding draft columns means: (1) the tab gate gets draft-inclusivity, (2) no other consumer's semantics move, (3) the change is provably non-regressive for the empty-state path. This is exactly the "add a `*_draft` count rather than changing the published count's meaning" guidance in the dispatch.

## A.3 Caller / blast map (grepped ALL consumers — complete)

Consumers of `pg_brand_offering_counts` / the `BrandOfferingCounts` shape (`grep -rln` across `mingla-business/src` + `app`, test files excluded):

| Consumer | path:line | Uses | Impact of this amendment |
|----------|-----------|------|--------------------------|
| `useBrandOfferingCounts` (the fetcher) | `src/hooks/useBrandOfferingCounts.ts:19-33` | maps RPC rows → `BrandOfferingCounts` | **MODIFY** — extend the type + mapper with the 3 new `*_draft` fields (default 0). |
| `useHubTabs` / `deriveHubVisibleTabs` | `src/hooks/useHubTabs.ts:43-45` | tab visibility | **MODIFY** — OR published+draft per type (A.5). The target fix. |
| `hub/events.tsx` `hasNoOfferingsAtAll` | `app/(tabs)/hub/events.tsx:186-190` | empty-state copy switch | **NO CHANGE** — keeps reading published-only `events/trips/experiences`; behavior identical (a draft-only brand still shows the universal "create your first offering" chooser copy, which is correct — it has no *published* offering yet). |
| `useDiscardOfferingDrafts` | `src/hooks/useDiscardOfferingDrafts.ts:107-108` | invalidates `brandKeys.offeringCounts` after discard | **NO CHANGE** — invalidation key is unchanged; the new draft columns simply refetch alongside. |

**NOT consumers (verified — false-positive greps that use unrelated `events`/`trips`/`experiences` fields, NOT this RPC):**
- `app/b/[brandSlug]/index.tsx:58-62` — reads `publicBrandQuery.data.{events,trips,experiences}` (the PUBLIC brand page query, a different RPC). **Must stay published-only; this amendment does not touch it.** (Critical: a draft-inclusive count must NEVER leak to the public brand page — the additive design guarantees it can't, since this RPC's published columns are untouched and the public page uses a different source entirely.)
- `src/lib/search/globalSearch.ts:74-77` — indexes already-fetched offering arrays; unrelated.

Blast verdict: with the additive design, the ONLY behavior that changes is Hub tab visibility. Empty-state copy, discard invalidation, the public brand page, and global search are all provably unaffected.

## A.4 Layer 1 — DATABASE (migration REQUIRED)

**New migration file** (next free version after the latest in `supabase/migrations/`): `supabase/migrations/<YYYYMMDDHHMMSS>_orch_1150_offering_counts_include_drafts.sql`. The implementor MUST pick the timestamp as `max(existing migration prefix) + 1 second` (read the directory; the current latest RPC-defining migration is `20260729000001_meta_orch_0972_pg_brand_offering_counts_grants.sql` but newer unrelated migrations exist — use a timestamp strictly greater than ALL existing files).

**Safe-migration protocol (MANDATORY):** the implementor MUST re-introspect the LIVE prod body (`SELECT pg_get_functiondef('pg_brand_offering_counts'::regproc);`) at implement-time and re-emit FROM THAT BODY (it may have changed since this SPEC). The migration is `CREATE OR REPLACE FUNCTION` preserving EVERY existing attribute: `LANGUAGE sql`, `SECURITY DEFINER`, `SET search_path TO 'public','pg_temp'`, `STABLE`-ness if present, and the SAME `GRANT`s (re-emit the grants from `20260729000001_*_grants.sql` if the `CREATE OR REPLACE` resets them — verify whether a bare replace drops grants on this object; if grants persist, do not re-grant).

**RETURNS-TABLE widening hazard (CI migration-baseline gate):** adding columns to a `RETURNS TABLE(...)` function REQUIRES a `DROP FUNCTION public.pg_brand_offering_counts(uuid);` BEFORE the `CREATE OR REPLACE` — Postgres rejects an in-place `CREATE OR REPLACE` that changes the OUT-parameter / return-row shape ("cannot change return type of existing function"). The migration MUST be: `DROP FUNCTION IF EXISTS public.pg_brand_offering_counts(uuid);` then `CREATE FUNCTION ...` then re-`GRANT EXECUTE` to the same roles the grants migration lists. (This matches the codified hazard: "DROP before widening RETURNS TABLE".) End the function body with `$function$;` before any `GRANT` (codified `$function$;`-before-GRANT hazard).

**New function body (contract — exact column set; implementor re-emits from live body + adds the 3 draft columns):**

```
RETURNS TABLE(
  events bigint, trips bigint, experiences bigint,
  events_draft bigint, trips_draft bigint, experiences_draft bigint
)
... SELECT
  count(*) FILTER (WHERE event_type='event'      AND published_at IS NOT NULL) AS events,
  count(*) FILTER (WHERE event_type='trip'       AND published_at IS NOT NULL) AS trips,
  count(*) FILTER (WHERE event_type='experience' AND published_at IS NOT NULL) AS experiences,
  count(*) FILTER (WHERE event_type='event'      AND published_at IS NULL)     AS events_draft,
  count(*) FILTER (WHERE event_type='trip'       AND published_at IS NULL)     AS trips_draft,
  count(*) FILTER (WHERE event_type='experience' AND published_at IS NULL)     AS experiences_draft
FROM public.events
WHERE brand_id = p_brand_id AND deleted_at IS NULL;
```

- The published columns retain IDENTICAL values to today (the `published_at IS NOT NULL` moves from the WHERE into each published FILTER; the draft columns use `published_at IS NULL`). **The `deleted_at IS NULL` exclusion is PRESERVED** for ALL six columns (it moves to the WHERE, applying to every count — verify no draft is `deleted_at`-stamped-but-counted).
- **Apply path:** migration applied to prod via the Supabase Management API (browser UA), NOT the CLI (drift-wedged) and NOT MCP (read-only) — per the codified edge/migration hazards. The migration file still lands in `supabase/migrations/` for git/CI baseline.

## A.5 Layer 2 — HOOK (`useBrandOfferingCounts.ts` + `useHubTabs.ts`)

**A.5.1 `src/hooks/useBrandOfferingCounts.ts`:**
- Extend `interface BrandOfferingCounts` (lines 7-11) with `events_draft: number; trips_draft: number; experiences_draft: number;`.
- Extend `EMPTY_COUNTS` (lines 13-17) with the 3 new fields = 0.
- Extend `fetchBrandOfferingCounts` mapper (lines 28-32) with `events_draft: Number(row?.events_draft ?? 0)` etc. (defensive `?? 0` so an old-RPC response during rollout never crashes — though backend-first ordering avoids that).
- **Query key UNCHANGED:** `brandKeys.offeringCounts(brandId)` = `["brand", brandId, "offeringCounts"]` (`src/hooks/useBrands.ts:79-82`). `staleTime: 30_000` unchanged.

**A.5.2 `src/hooks/useHubTabs.ts` — the gate fix (cite: lines 43-45):** change `deriveHubVisibleTabs` so each offering type is visible when published OR draft count > 0:

```
if (counts.events > 0 || counts.events_draft > 0) visible.push("events");
if (counts.trips > 0 || counts.trips_draft > 0) visible.push("trips");
if (counts.experiences > 0 || counts.experiences_draft > 0) visible.push("experiences");
```

The venue gate (line 49) and `pickHubInitialTab` are UNCHANGED.

## A.6 Layer 3 — IMMEDIATE APPEARANCE AFTER SNAP (DISC-1150-A)

After `confirmAll` creates the drafts, the snap success path MUST invalidate the offering-counts query BEFORE/with navigation, so the freshly-created drafts make the Experiences tab appear ON ARRIVAL (not one navigation later). Today `snap.tsx:154` awaits only `invalidateExperienceList()` which invalidates `experienceKeys.listByBrand` (`usePendingExperiences.ts:148-155`) — it does NOT invalidate `brandKeys.offeringCounts` (DISC-1150-A / INVESTIGATE F-2).

**Exact change — extend `invalidateExperienceList` in `src/hooks/usePendingExperiences.ts:148-155` to ALSO invalidate the offering-counts key:**
- Add an import of `brandKeys` from `./useBrands` (currently only `experienceKeys` is imported — `usePendingExperiences.ts:23`).
- Inside the callback, after the existing `experienceKeys.listByBrand` invalidation, add:
  `await qc.invalidateQueries({ queryKey: brandKeys.offeringCounts(brandId) });`
- **Invalidation key (cite):** `brandKeys.offeringCounts(brandId)` → `["brand", brandId, "offeringCounts"]` (`src/hooks/useBrands.ts:79-82`) — the SAME key `useBrandOfferingCounts` reads (`useBrandOfferingCounts.ts:44-45`) and `useDiscardOfferingDrafts.ts:107-108` already invalidates.

This makes `snap.tsx:154`'s existing `await invalidateExperienceList()` (already awaited before the `setTimeout(router.replace, 700)`) refetch BOTH the drafts list AND the counts, so by the time the hub layout's nav-lock effect evaluates `visibleTabs` on arrival, `experiences_draft > 0` and the redirect does NOT fire. **No change to `snap.tsx` call-site is required** (it already awaits `invalidateExperienceList`); the fix lives entirely inside the hook. (Implementor MAY alternatively add a dedicated `invalidateOfferingCounts` and call both from `snap.tsx` — but extending the already-awaited `invalidateExperienceList` is the minimal, lowest-risk change and is the SPEC's choice.)

## A.7 Nav-lock interaction (ORCH-1145) — CONFIRMED, do NOT disable

The ORCH-1145 nav-lock redirect (`app/(tabs)/hub/_layout.tsx:155-189`, guard at line 178 `if (!visibleTabs.data.includes(active))`) is **NOT touched**. It MUST keep bouncing off genuinely-nonexistent tabs (a brand with truly zero events/trips/experiences of a type still has no tab and is still correctly redirected). The fix works precisely because the Experiences tab now **EXISTS** in `visibleTabs` (since `experiences_draft > 0`), so `visibleTabs.data.includes("experiences")` is `true` → the guard short-circuits → no redirect → the experiences screen renders. **Confirmed:** this preserves I-PROPOSED-1145-VENUE-TAB-CONDITIONAL and the nav-away protection while making the snap destination reachable. The two adversarial cases the venue gate already guards (`pickHubInitialTab` stored-tab stale-pointer; OR-not-AND) are unaffected.

## A.8 Default bucket on arrival (CONFIRMED — no change)

INVESTIGATE Q4 RULED OUT a bucket-hiding defect; re-verified this turn against source: `experiences.tsx:122-129` `deriveExperienceFilterBucket` buckets on `status === 'draft'` FIRST (undated drafts → `draft` bucket); `defaultFilter` (`experiences.tsx:177-182`) resolves to `"draft"` when only drafts exist (`counts.upcoming===0 → counts.draft>0 → "draft"`); the `"all"` filter (`experiences.tsx:223-224`) also includes the draft bucket. So a draft-only brand landing fresh on `/hub/experiences` SHOWS the drafts under the default filter. **No change required.** (The `useState(defaultFilter)` mount-capture staleness, DISC-1150-C, is OUT OF SCOPE — see A.13.)

## A.9 Cross-Surface Impact (amendment delta)

| # | Surface | Covered | Behavior | Files | Parity |
|---|---------|---------|----------|-------|--------|
| 4 | Business iOS | YES | draft-only brand sees the offering tab; snap lands on `/hub/experiences` with N drafts | RPC (shared) + `useBrandOfferingCounts.ts` + `useHubTabs.ts` + `usePendingExperiences.ts` | shared client + shared RPC |
| 5 | Business Android | YES | identical | same files | automatic (shared RN code + shared RPC) |
| 1-3,6,7 | Consumer iOS/Android, Buyer Web, Admin, Biz Web preview | NO | — | none | no Hub tab gate / no snap flow on those surfaces; public brand page (`b/[brandSlug]`) is explicitly excluded (A.3) |

## A.10 Success criteria (amendment)

- **SC-A1 (DB):** `pg_brand_offering_counts('<draft-only brand>')` returns `experiences=0, experiences_draft=N (N>0)`; the published `events/trips/experiences` columns equal their pre-migration values for a control brand (Leggo This: `events=13, trips=0, experiences=0`). `deleted_at`-stamped rows are excluded from BOTH published and draft columns.
- **SC-A2-iOS / SC-A2-Android (gate):** `deriveHubVisibleTabs({experiences:0, experiences_draft:1, ...})` returns an array INCLUDING `"experiences"`. With all six counts 0 → `"experiences"` absent.
- **SC-A3 (invalidation):** after `confirmAll`, `invalidateExperienceList()` invalidates BOTH `experienceKeys.listByBrand(brandId)` AND `brandKeys.offeringCounts(brandId)`.
- **SC-A4 (live-fire — the bug-closing criterion, owned by mingla-tester):** on a brand whose ONLY experiences are unpublished drafts, snap→auto-draft→navigate LANDS on `/hub/experiences` (NOT bounced to `/hub/events`) with the N drafts RENDERED in the default (`draft`/`all`) bucket. Closes INVESTIGATE DISC-1150-D. This MUST be a live-fire sim/device assertion, not a unit test that only asserts `router.replace` was called.
- **SC-A5 (no public leak):** the public brand page (`/b/{slug}`) still shows ONLY published offerings — a draft-only brand exposes no draft tab/content publicly (regression guard for A.3).
- **SC-A6 (nav-lock preserved):** a brand with truly zero offerings of a type (0 published + 0 draft) is STILL redirected off that tab's route (ORCH-1145 unbroken).

## A.11 Invariants

- **PRESERVE** `I-PROPOSED-1145-VENUE-TAB-CONDITIONAL` + the hub nav-lock contract (`_layout.tsx:155-189`) — A.7. Test: SC-A6 + the existing `useHubTabs.venueGate.adversarial.test.ts` must still pass.
- **NEW (DRAFT, flips ACTIVE on CLOSE — orchestrator owns the flip):** `I-PROPOSED-1150-DRAFTS-COUNT-FOR-HUB-TAB-VISIBILITY` — a Hub offering tab (events/trips/experiences) is visible when the brand has ANY non-deleted row of that type, DRAFT or published; `pg_brand_offering_counts` exposes published-only AND draft counts as SEPARATE columns; the published columns NEVER include drafts (so public/published-only consumers — the public brand page, the events-screen empty-state copy — are unaffected). Enforced by the strict-grep gate (A.14) + the executed-gate jest test (A.14).

## A.12 Test cases (amendment)

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| TA-1 | draft-only brand → tab visible | `deriveHubVisibleTabs({events:0,trips:0,experiences:0,events_draft:0,trips_draft:0,experiences_draft:2})` | array includes `"experiences"`, NOT `"events"`/`"trips"` | hook (pure) |
| TA-2 | truly-empty brand → no tabs | all six counts 0 | `[]` (or venue-only) | hook (pure) |
| TA-3 | published + draft mix | `{experiences:3, experiences_draft:5,...}` | `"experiences"` present (not double-counted; presence only) | hook (pure) |
| TA-4 | invalidation fires both keys | run `invalidateExperienceList` with a spied `qc` | `invalidateQueries` called with `experienceKeys.listByBrand` AND `brandKeys.offeringCounts` | hook |
| TA-5 (adversarial, tester-owned) | `&&` instead of `||` typo in gate | `{experiences:0, experiences_draft:1}` | EXECUTED gate returns array WITH `"experiences"`; an `&&` mutation FAILS this | hook (executed) |
| TA-6 (DB) | published columns unchanged | control brand pre/post migration | identical published values; new draft columns populated; deleted rows excluded both | DB |
| TA-7 (live-fire, tester) | SC-A4 | draft-only brand, real snap on sim | lands on `/hub/experiences`, N drafts rendered, NOT bounced | runtime/device |
| TA-8 (adversarial) | public leak guard | draft-only brand `/b/{slug}` | no draft tab/content public | runtime/web |

## A.13 Out-of-scope hardening (flag only)

**DISC-1150-C** — `experiences.tsx:184` / `trips.tsx:156` / `events.tsx:253` `const [filter, setFilter] = useState(defaultFilter)` captures `defaultFilter` at first render only; no `useEffect` re-syncs it when async counts arrive. Not user-visible for THIS fix (the default still includes drafts via `"all"`/`"draft"`), but a latent staleness. **OUT OF SCOPE** for ORCH-1150 — flagged for a future hardening pass. The implementor must NOT touch these `useState` lines.

## A.14 Regression prevention (fails-on-revert)

**Structural safeguard 1 — DB-shape gate (jest, EXECUTED):** `useHubTabs.draftsCount.test.ts` (new) imports + RUNS `deriveHubVisibleTabs` with `experiences_draft:1, experiences:0` and asserts `"experiences"` ∈ result. **Fails-on-revert:** reverting the `|| counts.*_draft > 0` clauses in `useHubTabs.ts` flips TA-1/TA-5 to FAIL; restoring → PASS. This is the executed-gate companion to any string match (a `&&`/wrong-field mutation slips past regex but fails the executed test).

**Structural safeguard 2 — strict-grep gate:** EXTEND the existing `.github/scripts/strict-grep/orch-1150-snap-auto-draft.mjs` (already in the allowlist) with assertions that (a) `useHubTabs.ts` contains the draft-inclusive OR for all three types, (b) `useBrandOfferingCounts.ts` declares the 3 `*_draft` fields, (c) the migration file `*_orch_1150_offering_counts_include_drafts.sql` exists and contains both `DROP FUNCTION` and the `experiences_draft` column AND retains `deleted_at IS NULL`. Include `--self-test`. Keep it append-only with a protective comment explaining WHY (drafts must reach the Hub tab post-snap).

**Structural safeguard 3 — live-fire (tester-owned):** SC-A4 / TA-7 — the missing test class from DISC-1150-D. The tester drives snap→navigate on a draft-only brand and asserts the drafts RENDER (not merely that navigation was attempted).

## A.15 Implementation order (amendment)

1. **DB:** re-introspect live body → write migration `<ts>_orch_1150_offering_counts_include_drafts.sql` (DROP + CREATE + re-GRANT, `deleted_at IS NULL` preserved, `$function$;` before GRANT) → apply to prod via Management API (browser UA).
2. **Hook fetcher:** extend `BrandOfferingCounts` + `EMPTY_COUNTS` + `fetchBrandOfferingCounts` mapper (`useBrandOfferingCounts.ts`).
3. **Gate:** `useHubTabs.ts:43-45` → draft-inclusive OR (A.5.2).
4. **Invalidation:** `usePendingExperiences.ts` — import `brandKeys`, extend `invalidateExperienceList` to also invalidate `brandKeys.offeringCounts(brandId)` (A.6).
5. **Tests + gate:** TA-1..TA-8; extend the strict-grep gate.
6. Regenerate Supabase TS types if the repo commits generated types for this RPC (verify; if a generated `Database` type exists, update it).

## A.16 File allowlist (amendment — ADDITIVE to the base §11 allowlist)

**ALLOWLIST (implementor may change ONLY these, in addition to base §11):**
- `supabase/migrations/<YYYYMMDDHHMMSS>_orch_1150_offering_counts_include_drafts.sql` (NEW)
- `mingla-business/src/hooks/useBrandOfferingCounts.ts` (extend type + mapper)
- `mingla-business/src/hooks/useHubTabs.ts` (draft-inclusive gate, lines 43-45)
- `mingla-business/src/hooks/usePendingExperiences.ts` (import `brandKeys`; extend `invalidateExperienceList` — lines 23, 148-155)
- `mingla-business/src/hooks/__tests__/useHubTabs.draftsCount.test.ts` (NEW)
- `.github/scripts/strict-grep/orch-1150-snap-auto-draft.mjs` (EXTEND — already in base allowlist)
- generated Supabase types file IF the repo commits one for this RPC (verify first)
- artifact docs under the worktree's `Mingla_Artifacts/`

**DO-NOT-TOUCH (amendment — stop-and-amend before editing):**
- `mingla-business/app/(tabs)/hub/_layout.tsx` — the nav-lock redirect MUST NOT be disabled/weakened (A.7). The fix is upstream (tab now exists); the layout is untouched.
- `mingla-business/app/(tabs)/hub/events.tsx` — `hasNoOfferingsAtAll` keeps reading published-only columns; do NOT switch it to draft-inclusive.
- `mingla-business/app/(tabs)/hub/experiences.tsx` / `trips.tsx` — bucketing + the `useState(defaultFilter)` lines (DISC-1150-C is OUT OF SCOPE; do not "while-I'm-here" fix it).
- `mingla-business/app/b/[brandSlug]/index.tsx` + the public-brand RPC — published-only must NOT change (A.3 / SC-A5).
- `app/experience/snap.tsx` — no call-site change needed (the hook fix is sufficient); touch only if the implementor chooses the alternative dedicated-invalidator path in A.6, in which case it stays within the base-SPEC allowlist entry for snap.tsx.

## A.17 Open risk / questions

- **Rollout ordering (low risk):** backend-first (apply migration BEFORE the client OTA) so the client's `?? 0` defensive mapping never even triggers. If the client somehow ships first, the `?? 0` defaults mean draft counts read 0 and the tab simply stays hidden (degrades to today's behavior — no crash). Confirmed safe either way; recommend backend-first regardless.
- **Generated-types drift:** if the repo commits a generated `Database` type for `pg_brand_offering_counts`, it MUST be regenerated or TS will error on the new columns. Implementor verifies at step 6.
- **No other open question.** Direction A is LOCKED; the additive-column design resolves the DISC-1150-B product decision (drafts count for tab visibility but NOT for any published-only consumer).

## A.18 Platform deltas + downstream routing (amendment)

- **Backend (migration):** prod-applied via Supabase Management API; file committed for CI baseline. NOT OTA-able — must land before/with the client.
- **Client (hook + gate + invalidation):** pure JS / RN → **OTA-able** on the business dev channel per the EAS OTA gotchas memory (`npx -y eas-cli@latest update`, per-platform, runtime biz 1.0.0). No native rebuild.
- **Downstream:** next = **mingla-implementor (business side)** — build A.4–A.16 in `~/Desktop/mingla-orchs/orch-1150-[snap-autodraft-navigate]` on branch `orch-1150-snap-autodraft-navigate`; apply the migration to prod (Management API) + write the client changes + extend tests/gate; produce the report + fails-on-revert proof (TA-1/TA-5 revert demo). Then = **mingla-tester** — the SC-A4 / TA-7 live-fire (snap on a draft-only brand → lands on `/hub/experiences` with drafts rendered, NOT bounced) + SC-A5 public-leak guard + SC-A6 nav-lock-preserved. Then = **mingla-orchestrator CLOSE** — flip `I-PROPOSED-1150-DRAFTS-COUNT-FOR-HUB-TAB-VISIBILITY` ACTIVE, OTA the business dev channel.
