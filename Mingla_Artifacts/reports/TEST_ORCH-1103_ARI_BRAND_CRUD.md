# TEST — ORCH-1103 [Ari smart brand CRUD + in-chat media]

**Mode:** TARGETED (mingla-tester, independent verification)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1103-[ari-brand-crud-smart]/` on branch `ORCH-1103-ari-brand-crud-smart` (commits `9883624d2` backend + `4493cb91d` UI on `origin/main ff6015b1e`)
**Date:** 2026-06-08
**Inputs:** `specs/SPEC_ORCH-1103_ARI_BRAND_CRUD.md` (SC-1..13, G-1..4, T-01..20), `design/DESIGN_ORCH-1103_ARI_BRAND_FLOWS.md`, `reports/IMPLEMENTATION_ORCH-1103_ARI_BRAND_CRUD.md`
**Scope per dispatch:** source/test-level (no deploy — orchestrator owns edge-fn deploy, pending operator authorization).

## Verdict: CONDITIONAL PASS

- **P0: 0 | P1: 0 | P2: 0 | P3: 1 | P4: 2**
- Source + test layer fully PROVEN. The on-device Gemini-proposes round-trip is an **explicit, dispatch-baked operator deferral** (requires the new edge functions deployed; deploy is out of tester authority and pending authorization). This is the ONLY reason the verdict is CONDITIONAL rather than PASS — there is no open defect.

## Comms ledger
Read `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` on entry. No `BLOCK` rows target ORCH-1103 / mingla-tester / ARI / ALL. `WARN` rows already factored by SPEC + IMPLEMENT (COMMS-0002 strict-grep gate — passes via G-1..G-4; COMMS-0003 external-API docs — N/A no new provider call; COMMS-0015/0018 deploy-from-merged-main + no migration — honored, no migration added). No new cross-ORCH discovery requiring a ledger write.

---

## 1. Priority verification — zero-bypass delete guard (HIGHEST)

`supabase/functions/_shared/agentTools.ts` `deleteBrand.executor` (lines 562-633). Guard order read line-by-line:

1. `isUuid(args.brand_id)` shape check → `INVALID_ARGS`.
2. `assertBrandOwned(client, brandId, userId)` — owner-scoped, `.is("deleted_at", null)`, under the user JWT.
3. **Blocking-events count BEFORE any write** (lines 576-593): counts `events` where `status IN BRAND_DELETE_BLOCKING_EVENT_STATUSES` (`["scheduled","live"]`) joined `event_dates!inner` with `end_at > now()`, `head:true` + `count:'exact'`. **No `event_type` filter** → type-agnostic (trips/experiences also block). If `count > 0` → `throw ToolError("DELETE_BLOCKED_BY_EVENTS", …)` carrying the count. NO `deleted_at` write on this path.
4. Soft-delete only AFTER count===0: `.update({deleted_at}).is("deleted_at", null).select("id").maybeSingle()`. Rowcount-verified (`!data → WRITE_FAILED`); idempotent by the `deleted_at IS NULL` filter.
5. `default_brand_id` cleared non-fatally (try/catch, log-and-continue).

**Forbidden-pattern grep of the executor body** (`.delete(`, `DELETE FROM`, `admin_suspend_listing`, `service.?role`/`SERVICE_ROLE`): all absent (only appear in explanatory comments). VERIFIED.

- **I-ARI-BRAND-DELETE-GUARD** — ENFORCED. Count runs before stamp (proven behaviourally by my ADV-A2 call-order test). Registered in `INVARIANT_REGISTRY.md:12`.
- **I-ARI-NO-HARD-DELETE** — ENFORCED. Soft-delete only; registered `INVARIANT_REGISTRY.md:17`.
- **G-1** (no `"GBP"` in create executor) — real + enforced; the only `"GBP"` literal in the file is at line 706 inside `create_experience` (pre-existing, out of scope).
- **G-2** (no hard-delete/admin/service-role in delete executor) — real + enforced.
- **G-3** (registry↔prompt sync, ORCH-1103-scoped) — real + enforced.
- **G-4** (delete with blocking event → 409, no stamp) — real + enforced.

The `agent-chat` `hasBlockingEvents` prompt hint (index.ts:205-224) mirrors the SAME query (status IN scheduled/live + `event_dates!inner end_at > now`, no event_type filter) so the advisory deletable hint and the executor guard cannot drift. VERIFIED.

## 2. de-GBP create — VERIFIED
`resolveCreateCurrency` (agentTools.ts:128-146): explicit valid 3-letter arg (uppercased) → `agent_user_profile.preferred_currency` → `null` (column OMITTED so the `brands` DEFAULT applies). Never writes the literal `"GBP"`. First brand: post-insert count of non-deleted brands; `=== 1` → `creator_accounts.update({default_brand_id}).eq("id", userId)`, non-fatal. VERIFIED (Deno SC-4/SC-4b + my ADV-A5 prove explicit non-GBP arg wins over a GBP pref).

## 3. update_brand — VERIFIED
Sparse owner-scoped patch (agentTools.ts:467-535): `isUuid` → `assertBrandOwned` → only keys present in `args` (name ≤80, description ≤500, contact_email, default_currency 3-letter→upper, cover atomic pair) → empty patch → `INVALID_ARGS` → write `.eq("id").is("deleted_at", null)` (cannot patch a soft-deleted brand — proven by my ADV-A3). 23505→SLUG_TAKEN. VERIFIED.

## 4. Registry↔prompt sync — VERIFIED
Both `updateBrand` + `deleteBrand` in `AGENT_TOOLS` (agentTools.ts:819-828); neither in `READ_ONLY_TOOL_NAMES` (both flow through propose→confirm). Both in CAPABILITIES (agentSystemPrompt.ts:102-103). `PROMPT_VERSION = "v3"` (line 16). Names escaped via `escapeForPrompt` in the richer brand line. `agent-confirm-action`: `DELETE_BLOCKED_BY_EVENTS`→409 (line 232), `OWNERSHIP_DENIED`→403, `INVALID_ARGS`/`SLUG_TAKEN`→400; `buildFollowupText` cases for create/update/delete brand (lines 293-308). VERIFIED.

## 5. UI surfaces — VERIFIED (source + jest)
`ToolProposalCard.tsx`: brand verbs in `humanizeToolName`/`primaryIdentity`; cover band (`coverBandH=132` token) with empty/selected-image/selected-video/uploading/error states + accessibility labels; Add-cover opens the EXISTING `CoverPickerSheet` (no new sheet); Confirm disabled while uploading. Delete variant: danger border, live cascade via `useBrandCascadePreview`, type-to-confirm `TextInput` gating Delete (`canDelete` = case-insensitive trim match + non-empty), Delete fill `semantic.error`. `MessageList.tsx`: executed create/update render `ResponseCard` receipt (real cover thumbnail only — omitted for video/none, anti-slop), action SEEDS a composer message (never auto-creates an event). `CoverPickerSheet.tsx`: "Use this cover" fill `accent.warm`→`ariPalette.userBubble` (#a85a44 over white clears the 3:1 large-text bar; #eb7825 was 2.90:1). Accessibility labels preserved throughout. ANDROID_GLASS_USES_OPAQUE_FALLBACK honored via existing ORCH-1101 tokens (no new translucent Android fills introduced). VERIFIED at source; 15/15 ORCH-1103 jest UI tests green; full ari folder 100/100 (no ORCH-1101 regression).

## 6. No leaks / user-JWT-only — VERIFIED
`I-ARI-USER-JWT-ONLY`: both executors use the passed `client` only; no service-role anywhere (G-2 grep clean). `I-ARI-USER-DATA-WRAP`: brand names routed through `escapeForPrompt`. No migration added (diff confirms only the 3 `_shared` files + UI + edge fns + 2 tests + registry + report). No out-of-scope edits (`create_experience` drift intentionally LEFT for §12 cleanup; G-3 scoped to ORCH-1103 tools).

## 7. Test suites
- **Deno backend** (`orch_1103_ari_brand_crud.test.ts`): 10/10 PASS. Fails-on-revert independently verified by me (`git checkout origin/main -- agentTools.ts agentSystemPrompt.ts` → type-check failure / tools absent; restored → green).
- **Jest UI** (`orch_1103_ari_brand_crud_ui.test.ts`): 15/15 PASS. Fails-on-revert independently verified (revert 6 UI files → 15/15 red; restored → green).
- **Full ari jest folder**: 100/100 PASS (no ORCH-1101 regression).
- **tsc --noEmit (mingla-business)**: ZERO errors in any ORCH-1103-touched file. The repo's pre-existing baseline tsc noise lives entirely in unrelated files (checkout/marketing/payments/`packages/phone-input`).
- **Pre-existing unrelated failures** (NOT ORCH-1103): `ticketPdf.test.ts`, `stripeWebhookRouter_disputeAdversarial.test.ts` (Deno) and `orch1004AllowlistIntegrity.test.ts`, `brandListState.test.ts` (jest) — none touched by this branch; Implementor Discovery #4 confirmed accurate.

## 8. Adversarial regression test (tester-authored)
`supabase/functions/_shared/__tests__/orch_1103_ari_brand_crud.tester-adversarial.test.ts` — 7 tests, ALL PASS, attacks angles the implementor's happy-path suite does NOT:
- **ADV-A1** — source: the delete-guard query carries NO `event_type` filter (comment-stripped slice scoped to the delete executor); the SOLE mechanism making trips/experiences block delete. Guards SC-3/T-05 against a "narrow to plain events" regression.
- **ADV-A1b** — behaviour: a brand whose ONLY blocking row is a trip/experience (count=1, no type discrimination) is still REFUSED, zero brands update.
- **ADV-A2** — ordering: instrumented call-order mock proves the `events` count terminal resolves BEFORE the `brands` UPDATE is issued (I-ARI-BRAND-DELETE-GUARD).
- **ADV-A3** — update_brand write carries `.is("deleted_at", null)` → a soft-deleted brand cannot be patched back to life.
- **ADV-A4** — both update_brand + delete_brand on a non-owned brand → OWNERSHIP_DENIED with ZERO writes (SC-6/7).
- **ADV-A5** — create_brand with explicit `"ngn"` over a GBP user-pref writes `"NGN"` — de-GBP is an honest explicit-first resolver, not a GBP fallback.
- **ADV-A6** — re-deleting an already-soft-deleted brand fails safely (WRITE_FAILED/OWNERSHIP_DENIED), no crash, no second stamp.

Fails-on-revert verified by me: reverting `agentTools.ts` to origin/main → 0/7 pass; restored → 7/7. Both tests appear in `git diff origin/main...HEAD --name-only` (implementor's) + working tree (mine, to be committed with the PR).

## 9. Constitution (relevant rules)
- R1 no dead taps — N/A backend; UI Add-cover/Delete/Confirm all wired. PASS.
- R2 one owner per truth — delete replicates `softDeleteBrand` exactly, no competing owner. PASS.
- R3 no silent failures — DELETE_BLOCKED_BY_EVENTS surfaces as 409→Ari message; WRITE_FAILED surfaced. PASS.
- R9 no fabricated data — receipt thumbnail real-URI-only (omitted for video/none). PASS.
- R10 currency-aware — de-GBP resolver honors user/explicit currency. PASS.
- R13 exclusion consistency — `agent-chat` hasBlockingEvents query mirrors the delete guard exactly. PASS.

## 10. Live-fire sim gate (Phase 0.A) — DEFERRED (named blocker, operator-accepted by dispatch)
The end-to-end runtime (Ari Gemini-proposes → confirm executes) is gated on the NEW edge functions (`agent-chat`, `agent-confirm-action` carrying the new tools + v3 prompt) being DEPLOYED. Deploy is explicitly the orchestrator's, pending operator authorization, and the dispatch scopes this verification as source/test-level "no deploy needed." A business-app sim launch against the CURRENT (undeployed) backend would exercise the OLD tools/v2 prompt and cannot reproduce the fix — so a sim run now would be a false negative, not evidence. This is a genuine blocker outside tester authority (I may not deploy edge fns). The UI components are proven at source + 15 green jest assertions + fails-on-revert; the runtime leg is the operator-accepted deferral. No iOS sim was booted; one Android device is attached but the runtime path is unreachable without deploy.

## Findings
- **P3-1** — `agent-chat` brand-summary select is capped at `.limit(20)` (index.ts:203); the `hasBlockingEvents` grouped query then runs over those ≤20 brand IDs. A user with >20 brands would have the 21st+ omitted from Ari's prompt context (cannot be targeted by name for edit/delete). Matches the pre-existing `list_brands` 20-cap behaviour; low impact (few users exceed 20 brands), flagged for awareness, not a blocker.
- **P4-1** — Praise: the `agent-chat` hasBlockingEvents query deliberately mirrors the delete-guard query (same statuses, same `event_dates!inner end_at` date filter, same no-event_type) so the advisory prompt hint and the hard executor guard provably cannot drift — exactly the drift-prevention the SPEC asked for.
- **P4-2** — Praise: clean guard-order replication of `softDeleteBrand` with the correct throw-vs-return adaptation (ToolError→409) for the agent-confirm-action error path.

## Discoveries for orchestrator
1. `create_experience` prompt/registry drift (SPEC §12.1) — still in AGENT_TOOLS, absent from CAPABILITIES. G-3 intentionally scoped to ORCH-1103 tools so it does not silently widen. Spawn a 1-line cleanup ORCH or accept under sign-off.
2. `app/event/create.tsx` `no_brand` dead-end (SPEC §12.2) — untouched; routing it INTO Ari is a separate UX follow-on.
3. `BrandCoverPickerSheet.tsx` dead orphan (SPEC §12.3) — untouched cleanup note.
4. Two pre-existing jest failures + two pre-existing Deno failures unrelated to ORCH-1103 (Implementor Discovery #4 confirmed). Triage separately.

## Re-dispatch / next gate
No rework needed. Route to the orchestrator REVIEW gate. To upgrade CONDITIONAL→PASS: orchestrator deploys `agent-chat` + `agent-confirm-action` from merged main, then a runtime device pass exercises SC-1/10/11 (Gemini proposes) + SC-7/8 (cover persistence round-trip).
