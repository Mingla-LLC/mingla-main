# INVESTIGATE — ORCH-1154 [snap suggestions auto-draft + navigate to drafts]

**Skill:** mingla-forensics · **Phase:** INVESTIGATE · **Date:** 2026-06-15
**Worktree:** `~/Desktop/mingla-orchs/orch-1154-[snap-autodraft-navigate]` · branch `orch-1154-snap-autodraft-navigate`
**Decision (LOCKED by Seth — not relitigated):** the moment the parser returns suggestions, EVERY suggestion auto-saves as a draft experience (no per-card Accept), then the user is navigated to the Hub Experiences (drafts) tab, where they curate via edit / publish / DELETE (DELETE = the new "reject"). The per-card Reject/Edit/Accept review screen is REPLACED.

This is an INVESTIGATION. It proposes NOTHING. The fix is defined in `SPEC_ORCH-1154_SNAP_AUTODRAFT_NAVIGATE.md`.

---

## Symptom summary (expected vs actual)

- **Today (actual):** After a brand snaps a food/activities menu, the parser persists N proposals and the snap route renders a transient "Suggested experiences" stack (`ExperienceReviewCards`) with per-card Reject/Edit/Accept. ONLY tapping Accept turns a proposal into a draft. If the brand leaves before accepting, the proposals are stranded — no list surfaces `agent_pending_actions` rows outside this one screen, so they are unreachable without re-uploading.
- **Wanted (expected):** auto-accept all proposals into drafts immediately on parse return, then land on the Hub Experiences drafts tab. Curation happens in the normal drafts list. No ephemeral AI-proposal surface.

---

## Investigation manifest (every file read, in trace order)

| # | File | Why |
|---|------|-----|
| 1 | `mingla-business/app/experience/snap.tsx` | the snap-result screen — parse trigger, phases, review render, current Accept handler |
| 2 | `mingla-business/src/hooks/usePendingExperiences.ts` | the hook: parse mutation, confirm/reject mutations, cache keys + invalidations |
| 3 | `mingla-business/src/services/experienceGenerationService.ts` | service: parse invoke, `confirmExperienceProposal` → `confirmAgentAction`, pending-row fetch |
| 4 | `mingla-business/src/components/experience/ExperienceReviewCards.tsx` | the per-card review component to be replaced/removed |
| 5 | `mingla-business/src/services/agentChatService.ts` | `confirmAgentAction`/`cancelAgentAction` → `agent-confirm-action` edge fn |
| 6 | `supabase/functions/agent-confirm-action/index.ts` | the SHARED confirm executor (Ari + Hub snap both hit it) |
| 7 | `supabase/functions/parse-restaurant-menu/index.ts` | how proposals are persisted as `agent_pending_actions` + the response shape |
| 8 | `supabase/functions/_shared/agentTools.ts` (createExperience executor) | the `create_experience` tool → confirms it inserts a `status:'draft'` event |
| 9 | `mingla-business/app/(tabs)/hub/experiences.tsx` | the drafts destination tab (ORCH-1144) — drafts bucket, route, query |
| 10 | `mingla-business/src/hooks/useExperiencesByBrand.ts` | the drafts list cache key (`experienceKeys.listByBrand`) |
| 11 | `mingla-business/src/services/experiencesService.ts` | `getExperiencesByBrand` — confirms drafts are in the list query |
| 12 | `mingla-business/src/screens/ari/AriChatScreen.tsx` | Ari's confirm path — to prove it is a SEPARATE hook/UI (auto-accept must not touch it) |

---

## Q-scorecard

### Q1 — What is the precise call that turns ONE proposal into ONE draft experience today?
**Verdict (proven):** `confirm({ id, edited_args })` on `usePendingExperiences` → `confirmExperienceProposal(id, editedArgs)` (`experienceGenerationService.ts:124`) → `confirmAgentAction({ pending_action_id, edited_args })` (`agentChatService.ts:124`) → POST `agent-confirm-action` with `action:"confirm"` → the shared `create_experience` executor inserts a `status:"draft", visibility:"draft", event_type:"experience"` row. THIS is the unit to auto-invoke for all proposals. See F-1.

### Q2 — Where do suggestions live, and is the snap screen the only surface?
**Verdict (proven):** Proposals are persisted server-side by the parser as `agent_pending_actions` rows (`source:"hub_experience"`, `conversation_id:null`, `tool_name:"create_experience"`, `status:"pending"`). The ONLY UI that surfaces these rows is the snap route's `ExperienceReviewCards` (fed by `fetchPendingExperiencesForBrand`). No drafts list, Hub tile, or Ari surface reads `source:"hub_experience"` pending rows. Hence "unreachable without re-uploading." See F-2.

### Q3 — Is the Hub Experiences tab the drafts list, and what is the exact route + cache key?
**Verdict (proven):** `app/(tabs)/hub/experiences.tsx` is the drafts/live list (ORCH-1144). A freshly-created draft appears via `useExperiencesByBrand(brandId)` → query key `experienceKeys.listByBrand(brandId)` (`useExperiencesByBrand.ts:15`), bucketed into "Drafts" on `status==="draft"`. The route is `"/(tabs)/hub/experiences"` (already used as the snap-route fallback at `snap.tsx:116` and the post-resolve nav at `snap.tsx:163`). See F-3.

### Q4 — Auto-confirm-all: CLIENT (A) or BACKEND (B)?
**Verdict (proven — recommend A, client auto-confirm):** Option A loops the EXISTING confirm path over the parser's returned `pending_actions[]` IDs, then navigates. It requires ZERO edge changes, reuses the already-correct draft executor + cache invalidation, and is provably isolated from Ari (Ari uses a different hook + UI; see F-5). Option B (parser creates drafts directly) duplicates the executor logic into the parser, risks Ari/executor drift, and is a larger blast radius for no benefit. See F-4 + F-5.

### Q5 — Edge cases (zero / partial-failure / large-N / idempotency / loading)?
**Verdict (proven, see F-6):** zero suggestions already short-circuits with a toast and never reaches review (`snap.tsx:130`); partial failure is possible because each confirm is an independent POST; large-N is N sequential POSTs (acceptable per Seth); idempotency is enforced server-side by the atomic `pending→executing` flip (`agent-confirm-action/index.ts:171–180`) — a re-confirmed/already-executed row returns 409/WRONG_STATE, so a double-submit cannot create duplicate drafts from the SAME proposal. A re-UPLOAD creates NEW proposals (a known, accepted property — re-snapping is a new generation).

### Q6 — Constitution: dead taps / fabrication / honest loading / no stale-cache absence?
**Verdict (proven, see F-7):** the executor carries over the ORCH-1146 parsed fields and leaves uninferable fields blank (no fabrication). The current loading state is honest. The risk to address in SPEC is the navigation landing on the drafts BEFORE the list cache reflects the new rows (stale-cache absence) — the confirm mutation already invalidates `experienceKeys.listByBrand` (`usePendingExperiences.ts:66`), but the SPEC must guarantee the navigation occurs AFTER invalidation so the tab refetches and shows the new drafts.

---

## Findings (six-field evidence)

### F-1 — The accept-one-draft call chain (the unit to auto-invoke for all)
- **Symptom:** tapping a card's Accept creates exactly one draft experience.
- **Layer:** code (client → edge → executor).
- **Probe:** read `snap.tsx:219–231`, `usePendingExperiences.ts:60–69`, `experienceGenerationService.ts:124–129`, `agentChatService.ts:124–137`, `agentTools.ts:683–843`.
- **Evidence (verbatim):**
  - `snap.tsx:219` `onAccept={async (id, editedArgs) => { const response = await confirm({ id, edited_args: editedArgs }); ... }`
  - `usePendingExperiences.ts:60-69` `confirmMutation = useMutation({ mutationFn: (args) => confirmExperienceProposal(args.id, args.edited_args), onSuccess: () => { qc.invalidateQueries({ queryKey: pendingExperienceKeys.byBrand(brandId) }); qc.invalidateQueries({ queryKey: experienceKeys.listByBrand(brandId) }); } })`
  - `experienceGenerationService.ts:124` `confirmExperienceProposal(pending_action_id, edited_args) => confirmAgentAction({ pending_action_id, edited_args })`
  - `agentChatService.ts:124-137` `confirmAgentAction` → `supabase.functions.invoke("agent-confirm-action", { body: { action: "confirm", ...args } })`
  - `agentTools.ts:808-810` (createExperience executor) `event_type: "experience", status: "draft", visibility: "draft"`
- **Mechanism:** `confirm({ id })` over a single proposal ID drives the shared executor which inserts one draft event. Auto-draft-all = invoke this once per proposal ID returned by the parser.
- **Severity:** CONFIRMED ROOT CAUSE (this is the mechanism the SPEC reuses; it is not a defect).

### F-2 — Proposals persist server-side; the snap screen is the only surface
- **Symptom:** suggestions are unreachable after leaving the snap screen without accepting.
- **Layer:** data + code.
- **Probe:** read `parse-restaurant-menu/index.ts:195–242`; grep for any other reader of `source = 'hub_experience'`.
- **Evidence (verbatim):**
  - `parse-restaurant-menu/index.ts:210-221` inserts into `agent_pending_actions` with `source: "hub_experience"`, `conversation_id: null`, `tool_name: "create_experience"`, `status: "pending"`, returns `pending_actions: rows` + `experiences_count`.
  - `experienceGenerationService.ts:91-108` `fetchPendingExperiencesForBrand` is the ONLY reader: `.eq("source","hub_experience").eq("status","pending")` — consumed only by `usePendingExperiences` → only mounted in `snap.tsx`.
  - grep: `ExperienceReviewCards` referenced only in `snap.tsx` + its own file (no other mount).
- **Mechanism:** proposals are durable rows, but the only UI that lists them is the transient snap screen; leaving it strands them until they expire (`HUB_EXPIRY_HOURS`) or are re-snapped.
- **Severity:** CONFIRMED ROOT CAUSE (the problem ORCH-1154 fixes).

### F-3 — Drafts destination: route, query, bucket
- **Symptom:** a created draft appears in the Hub Experiences "Drafts" pill.
- **Layer:** code.
- **Probe:** read `hub/experiences.tsx:122–165, 320–343`, `useExperiencesByBrand.ts:13–28`, `experiencesService.ts:161–166`.
- **Evidence (verbatim):**
  - `useExperiencesByBrand.ts:15` `listByBrand: (brandId) => [...experienceKeys.all, "list", brandId]`
  - `experiencesService.ts:161-166` `.from("events").select(...).eq("event_type","experience")` — no status filter, so drafts are included.
  - `hub/experiences.tsx:125` `deriveExperienceFilterBucket: if (exp.status === "draft") return "draft";`
  - `snap.tsx:116` / `snap.tsx:163` already navigate `router.replace("/(tabs)/hub/experiences")`.
- **Mechanism:** new `status:"draft"` event lands in `getExperiencesByBrand`, buckets into "Drafts", and the route already exists and is in use.
- **Severity:** CONFIRMED (destination is ready; no new route needed).

### F-4 — Option A (client auto-confirm) is the cleanest mechanism
- **Symptom:** N/A (design feasibility).
- **Layer:** code (architecture).
- **Probe:** compare the two mechanisms against blast radius + existing wiring.
- **Evidence:**
  - The parser already returns `pending_actions: PendingExperienceProposal[]` with `id` per proposal (`experienceGenerationService.ts:27-33`, `parse-restaurant-menu/index.ts:238-242`) — the client has every ID it needs WITHOUT a refetch.
  - `usePendingExperiences.confirm` is already mutateAsync and already invalidates `experienceKeys.listByBrand` on success (`usePendingExperiences.ts:66`).
  - Option B would require the parser to call (or duplicate) the `create_experience` executor — but the parser uses the user JWT client and the executor is in `_shared/agentTools.ts`; importing/invoking it from the parser doubles the write path and risks divergence from Ari's confirm semantics + the `agent_pending_actions` audit lifecycle.
- **Mechanism:** A reuses the exact tested unit (F-1) N times; B forks the write path.
- **Severity:** CONFIRMED ROOT CAUSE of the recommendation (A).

### F-5 — Ari's confirm UX is isolated from the snap confirm path
- **Symptom:** N/A (guard verification — auto-accept must not change Ari).
- **Layer:** code.
- **Probe:** read `AriChatScreen.tsx` confirm wiring; diff against `usePendingExperiences`.
- **Evidence (verbatim):**
  - `AriChatScreen.tsx:49` imports `useConfirmPendingAction` (a DIFFERENT hook) — `AriChatScreen.tsx:133` `const confirm = useConfirmPendingAction(chat.conversationId)`; confirm fired only on explicit user tap (`AriChatScreen.tsx:172`).
  - Ari does NOT import `usePendingExperiences` or `ExperienceReviewCards` (grep: neither appears in `AriChatScreen.tsx`).
  - The ONLY shared surface is the edge fn `agent-confirm-action` + the `create_experience` executor — neither of which Option A modifies.
- **Mechanism:** changing snap.tsx's client behavior to loop `usePendingExperiences.confirm` touches no Ari code path; Ari keeps manual per-action confirm.
- **Severity:** RULED OUT (no Ari regression under Option A).

### F-6 — Edge cases under auto-confirm-all
- **Symptom:** zero / partial-failure / large-N / double-submit behaviors.
- **Layer:** code + runtime.
- **Probe:** read `snap.tsx:124–139`, `agent-confirm-action/index.ts:140–180`.
- **Evidence (verbatim):**
  - Zero: `snap.tsx:130` `if (result.experiences_count === 0) { setToast(copy.emptyParseToast); setPhase("idle"); return; }` — auto-draft path is never entered on zero.
  - Idempotency: `agent-confirm-action/index.ts:171-180` atomic `.update({status:"executing"}).eq("status","pending")...maybeSingle()` → `if (!flipped) return errorResponse(409,"WRONG_STATE","Race detected — this action was already handled")`. A second confirm of the same row cannot create a second draft.
  - Partial failure: each confirm is an independent `functions.invoke`; one 4xx/5xx does not roll back the others. The current single-card path surfaces `response.message` as a toast (`snap.tsx:221-223`).
- **Mechanism:** the loop must tally successes/failures and report honestly; idempotency is already server-enforced per proposal ID; re-UPLOAD generates fresh proposals (new IDs) — accepted by Seth ("curate in the list").
- **Severity:** SECONDARY ROOT CAUSE (these are the behaviors the SPEC must specify; not defects).

### F-7 — Constitution: fabrication, loading honesty, stale-cache-absence
- **Symptom:** risk that the user lands on drafts that aren't yet in the list, or sees fabricated fields.
- **Layer:** code + runtime.
- **Probe:** read the executor field mapping + the confirm invalidation.
- **Evidence (verbatim):**
  - `parse-restaurant-menu/index.ts:196-208` carries the parsed fields (title, narrative, prices, currency, intent_tags, is_free, suggested_time_of_day, confidence); uninferable fields (stops, date, ticket) stay unset — the executor produces a draft SHELL (`agentTools.ts:648-656` comment). No fabrication.
  - `usePendingExperiences.ts:66` already invalidates `experienceKeys.listByBrand(brandId)` on each confirm success — but the navigation timing is the open risk: if `router.replace` fires before invalidation resolves and the destination has a 60s `staleTime` (`useExperiencesByBrand.ts:25`) cached EMPTY list, the drafts could momentarily not render.
- **Mechanism:** to honor "navigation must land on the drafts the user just created," the SPEC must invalidate `experienceKeys.listByBrand` (or `experienceKeys.all`) AND ensure the destination refetches (invalidate is sufficient since it marks the active query stale + triggers refetch on mount).
- **Severity:** SECONDARY ROOT CAUSE (cache-timing contract the SPEC must pin).

---

## Five-Truth-Layer reconciliation

| Layer | Finding | Contradiction? |
|-------|---------|----------------|
| Docs | `snap.tsx:11-19` header + ORCH-1144 SPEC describe accept→draft / reject as the model | Will be superseded by ORCH-1154; doc comment must update |
| Schema | `agent_pending_actions` (pending→executing→executed/cancelled/expired) + `events(status='draft')`; atomic flip enforces idempotency | none |
| Code | snap confirm path is isolated from Ari; parser returns proposal IDs; drafts query has no status filter | none |
| Runtime | confirm is N independent POSTs; 409 on replay | partial-failure + nav-timing are the two behaviors to pin (F-6/F-7) |
| Data | proposals are durable rows surfaced only by snap | the core gap (F-2) |

No layer contradiction blocks the locked design. The only open behavioral contracts are partial-failure UX, loading copy, and nav/cache timing — all SPEC-resolvable.

---

## Repro evidence

Source-traced, not sim-driven: this is a feature-redesign dispatch with a LOCKED design, not a reproducer-bound runtime bug. The current behavior (accept→draft, leave→stranded) is established by reading the mount graph (F-1/F-2) and is not in dispute. No sim run is required to define the contract; the tester will live-fire the implemented flow. Confidence on the current-state findings: **proven** (full call-chain read end to end). Confidence on the recommended mechanism: **proven** (Option A reuses an existing, tested unit with zero edge change and proven Ari isolation).

---

## Blast radius / cross-surface map

- **In scope:** Business iOS + Business Android (`app/experience/snap.tsx` + `src/hooks/usePendingExperiences.ts` + the drafts nav). Business Web preview inherits the same RN route (the snap flow renders on web preview; behavior identical — pure JS).
- **Out of scope (one-phrase reason each):**
  - Consumer iOS/Android — no snap/experience-parser flow exists in `app-mobile`.
  - Buyer/anonymous Web — public buyer routes, no authoring.
  - Admin Web — no experience authoring surface.
  - Ari chat (within Business) — explicitly DO-NOT-TOUCH; isolated per F-5.
  - `agent-confirm-action` edge fn + `create_experience` executor + parser Gemini cores — DO-NOT-TOUCH (Option A is client-only).

## Invariant impact

- Honors **I-PROPOSED-1144-PARSERS-CATEGORY-AGNOSTIC** (no `venueCategory` branch reintroduced; snap still derives parseMode from the URL `mode` param).
- Honors **I-BRAND-UNIVERSAL-AUTHORING** (executor unchanged).
- Honors **I-ARI-PENDING-STATE-MACHINE** (the atomic pending→executing→executed lifecycle is unchanged; auto-confirm just drives it programmatically per proposal).
- Honors the ORCH-1146 field-completeness invariants (executor untouched; parsed fields carry over, uninferable stay blank — no fabrication).
- **Proposes a NEW invariant** `I-PROPOSED-1150-SNAP-SUGGESTIONS-AUTO-DRAFT` (DRAFT): snap-parser suggestions auto-persist as draft experiences; there is no ephemeral-only AI-proposal review surface in the business snap flow (the per-card `ExperienceReviewCards`/`ExperienceConfirmationCard` accept/reject UI is removed). Flips ACTIVE on CLOSE (orchestrator owns the flip).

## Discoveries for Orchestrator

- **DISC-1150-1:** `ExperienceReviewCards.tsx` and `ExperienceConfirmationCard.tsx` become dead after this change (used only by snap.tsx). The SPEC deletes them; the regression gate forbids re-import. (No COMMS entry — no other in-flight ORCH touches these.)
- **DISC-1150-2:** the META-ORCH-1009 Sub-E "expired_regenerate" path (`agent-confirm-action/index.ts:143-168`) only triggers when a confirm hits an EXPIRED row. Under auto-confirm-all run immediately after parse, rows are fresh (expiry hours away), so this path is effectively dead for the snap flow but must NOT be removed (Ari/other callers rely on it). DO-NOT-TOUCH.
- **DISC-1150-3:** No new COMMS entries needed — none of the OPEN ledger entries (1119/1116-lineage/1117/1131) touch the snap/experience-parser client or `usePendingExperiences`.

## Confidence

**Proven.** Full end-to-end call-chain read; mechanism (A) reuses an existing tested unit; Ari isolation proven by hook/import diff; idempotency proven by the atomic-flip source; drafts destination + cache key proven.

## Recommended next phase + scope

SPEC (this dispatch) → IMPLEMENT. Scope = client-only (Option A) auto-confirm-all in `snap.tsx` + a small change in `usePendingExperiences` to expose a batch helper, the drafts navigation with cache invalidation, deletion of the two review components, copy for the auto-draft/partial-failure states, a strict-grep gate + jest regression suite. **Pure JS / OTA-able — no edge deploy, no migration.**
