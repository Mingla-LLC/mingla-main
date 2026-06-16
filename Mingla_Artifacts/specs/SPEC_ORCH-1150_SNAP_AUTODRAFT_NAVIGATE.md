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
