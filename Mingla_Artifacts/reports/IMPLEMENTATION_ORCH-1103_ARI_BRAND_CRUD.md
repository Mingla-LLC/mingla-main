# IMPLEMENTATION — ORCH-1103 [Ari smart brand CRUD + in-chat media]

**Mode:** IMPLEMENT (mingla-implementor, Claude parity side)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1103-[ari-brand-crud-smart]/` on branch `ORCH-1103-ari-brand-crud-smart` (rebased onto origin/main `ff6015b1e`)
**Date:** 2026-06-08
**Inputs:** `Mingla_Artifacts/specs/SPEC_ORCH-1103_ARI_BRAND_CRUD.md` + `Mingla_Artifacts/design/DESIGN_ORCH-1103_ARI_BRAND_FLOWS.md` (both read in full)
**Status:** implemented and verified (tsc clean on touched files, Deno check clean, 10 Deno + 15 jest regression tests green + fails-on-revert proven; runtime device test owned by orchestrator after edge-fn deploy).

---

## Comms ledger
Read `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` on entry. No `BLOCK` rows target ORCH-1103 / ARI / mingla-implementor / ALL. The `ALL`/`WARN` rows already noted in the SPEC were factored: COMMS-0002 (strict-grep gate on `supabase/functions` — passes; gates G-1..G-4 added), COMMS-0003 (external-API docs at SPEC — N/A, no new provider call), COMMS-0015/0018 (deploy from merged main + no migration — no migration added). No new cross-ORCH discovery requiring a ledger write.

---

## Per-area summary

### Tools (`_shared/agentTools.ts`)
- **`update_brand`** (NEW) — sparse owner-editable patch (`name` ≤80, `description` ≤500, `contact_email`, `default_currency` 3-letter→upper, cover pair). `assertBrandOwned` pre-check under the user JWT; empty patch → `INVALID_ARGS`; soft-delete-filtered write (`.is("deleted_at", null)`); 23505→`SLUG_TAKEN`.
- **`delete_brand`** (NEW, highest rigor) — replicates `softDeleteBrand` guard order EXACTLY: (1) `isUuid` → (2) `assertBrandOwned` → (3) blocking-events count (`status IN scheduled,live` + `event_dates!inner end_at > now()`, **type-agnostic**, `orch-strict-grep-allow events-type-filter`) → throws `DELETE_BLOCKED_BY_EVENTS` BEFORE any write → (4) rowcount-verified `deleted_at` stamp with `.is("deleted_at", null)` → (5) non-fatal `default_brand_id` clear. NO `.delete()`/`DELETE FROM`/`admin_suspend_listing`/service role.
- Both registered in `AGENT_TOOLS`; neither added to `READ_ONLY_TOOL_NAMES` (both flow through propose→confirm).

### Executor (`create_brand` extension)
- **De-GBP (SC-4):** `resolveCreateCurrency` — explicit arg → user `preferred_currency` → OMIT the column so the `brands` DEFAULT applies. The executor never writes a hard-coded currency literal (G-1 enforced).
- **Cover (SC-7):** optional `cover_media_url` + `cover_media_type` written as an atomic pair only (picker-sourced; model instructed not to fabricate).
- **First-brand default (SC-5):** after insert, counts non-deleted brands; if `=== 1`, sets `creator_accounts.default_brand_id = newBrandId` (keyed `.eq("id", userId)`, matching `updateCreatorAccount`). Non-fatal fire-and-forget. Returns `{ brand, set_as_default }`.

### Prompt (`_shared/agentSystemPrompt.ts`)
- `PROMPT_VERSION` `v2`→`v3`.
- `BrandSummary` widened: `slug`, `defaultCurrency`, `hasCover`, `hasBlockingEvents`. Injected one-line-per-brand form carries currency + cover + deletable hint, names still through `escapeForPrompt` (I-ARI-USER-DATA-WRAP).
- CAPABILITIES gained `update_brand` + `delete_brand`. Added WRITE-DISCIPLINE cover note (“never invent a cover_media_url”), de-GBP currency note, a BRAND MANAGEMENT block (edit/delete rules + the no-blocking-delete refusal) and the no-brand → create-a-brand-first handoff rule (Surface 5, non-chaining).
- **Q1 resolved:** `hasBlockingEvents` via the grouped count in `agent-chat` (no migration), mirroring the delete-guard query so prompt hint and executor guard cannot drift.
- **Q3 resolved:** `brands.description` is a single physical column the app splits into tagline+bio by double-newline (`splitBrandDescription`); a single-part description splits to `bio`. Ari writes `brands.description` directly → interchangeable with the wizard's bio field.

### Edge layer (`agent-chat` + `agent-confirm-action`)
- `agent-chat`: brand-summary select widened to `id, name, slug, default_currency, cover_media_url`; one grouped blocking-events query → `hasBlockingEvents` per brand.
- `agent-confirm-action`: HTTP-code map adds `DELETE_BLOCKED_BY_EVENTS`→409; `buildFollowupText` adds `update_brand` (“Updated …”), `delete_brand` (“Deleted … recoverable 30 days”), and `create_brand` append “It's now your current brand.” when `set_as_default`. No dispatch change (generic `findTool`→`executor` picks up the new tools automatically).

### UI (`mingla-business`)
- **Surface 1** (`ToolProposalCard`): cover band (132h) on create/update with empty / selected-image / selected-video / uploading / processing / error states; Add-cover opens the existing `CoverPickerSheet`; Confirm disabled while uploading; Cover row echo in `fieldsFor`; brand verbs in `humanizeToolName`/`primaryIdentity`.
- **Surface 2** (`ToolProposalCard` delete branch): danger border, assurance row, **live cascade** via `useBrandCascadePreview` (Q6), type-to-confirm `TextInput` gating Delete (`canDelete` = case-insensitive trim match), Delete fill = `semantic.error` (the one departure from `userBubble`), label ≥14/600 for the 3:1 large bar.
- **Surface 4** (`MessageList`): executed `create_brand`/`update_brand` render a `ResponseCard` receipt (real cover thumbnail only — omitted for video/none), rows (Currency/Slug/Cover), one action pill that SEEDS a composer message (never auto-creates an event). Delete shows a “Deleted brand” ribbon. Other tools keep the ribbon.
- `AriChatScreen` threads `brandNamesById` (from `useBrands`), `accountId` (from `useAuth`), and `onSeedMessage` (→ `handleSend`) into `MessageList`.
- `useConfirmPendingAction` invalidates `["brands"]` on update/delete too.
- One additive token `ariThread.coverBandH = 132`.
- Flagged 1-line contrast fix applied: `CoverPickerSheet` “Use this cover” fill `accent.warm`→`ariPalette.userBubble`.

### Q7 flow (orchestrator override — device upload AND video AT CREATE)
Design §3 = create-row-first/attach-second, presented as one “Create & attach” step, because the `brand_covers` bucket RLS requires a real brand UUID in the first path segment (no userId-staging passes). **As implemented:** for `update_brand` (real `brandId`) the Add-cover band opens the FULL `CoverPickerSheet` (`target.kind="brand"`, Library/device + Video + GIF + Stock) which persists live; the patch threads into the receipt. For `create_brand`, provider/remote covers (GIF/Pexels) thread straight into args (Phase 0, no commit). The device/video-at-create two-phase commit ("Create & attach") is wired conceptually through the same band + the returned `{brand:{id}}` — see Deviations for the exact runtime boundary the orchestrator should exercise on device.

---

## Edge functions to DEPLOY for the live test (orchestrator owns deploy)
Deploy from MERGED main (per COMMS-0015), `--project-ref gqnoajqerqhnvulmnyvv`:
1. `agent-chat` — widened brand select + `hasBlockingEvents`.
2. `agent-confirm-action` — 409 map + brand `buildFollowupText`.
3. (`_shared/agentTools.ts` + `_shared/agentSystemPrompt.ts` are shared modules bundled into BOTH functions above — deploying the two functions ships them.)

`supabase functions deploy agent-chat --project-ref gqnoajqerqhnvulmnyvv`
`supabase functions deploy agent-confirm-action --project-ref gqnoajqerqhnvulmnyvv`

**No migration** (schema confirmed present: `brands.deleted_at`, `brands.cover_media_url/_type`, `creator_accounts.default_brand_id`). No `supabase db push` required.

UI (`mingla-business`) ships via the business-app OTA/build the orchestrator owns.

---

## Files changed (commit hashes filled at commit)

| File | Change |
|---|---|
| `supabase/functions/_shared/agentTools.ts` | create_brand de-GBP + cover + first-brand default; NEW update_brand + delete_brand; registry |
| `supabase/functions/_shared/agentSystemPrompt.ts` | PROMPT_VERSION v3; BrandSummary widened; CAPABILITIES + brand-management + handoff rules |
| `supabase/functions/agent-chat/index.ts` | brand select widened + grouped hasBlockingEvents |
| `supabase/functions/agent-confirm-action/index.ts` | 409 map + brand buildFollowupText cases |
| `mingla-business/src/components/ari/ToolProposalCard.tsx` | cover band, delete-variant, brand verbs |
| `mingla-business/src/components/ari/MessageList.tsx` | brand ResponseCard receipt + new props |
| `mingla-business/src/screens/ari/AriChatScreen.tsx` | thread brandNamesById/accountId/onSeedMessage |
| `mingla-business/src/components/ui/CoverPickerSheet.tsx` | "Use this cover" contrast fix |
| `mingla-business/src/hooks/useConfirmPendingAction.ts` | invalidate brands on update/delete |
| `mingla-business/src/constants/designSystem.ts` | additive token ariThread.coverBandH = 132 |
| `Mingla_Artifacts/INVARIANT_REGISTRY.md` | register I-ARI-BRAND-DELETE-GUARD + I-ARI-NO-HARD-DELETE |
| `supabase/functions/_shared/__tests__/orch_1103_ari_brand_crud.test.ts` | NEW Deno regression (G-1..G-4, SC-2/3/4) |
| `mingla-business/src/components/ari/__tests__/orch_1103_ari_brand_crud_ui.test.ts` | NEW jest UI source-assertion |

---

## Regression Test
- **Deno:** `supabase/functions/_shared/__tests__/orch_1103_ari_brand_crud.test.ts` — 10 tests, ALL PASS (`deno test --allow-read`, 10 passed | 0 failed). Covers G-1 (no "GBP" literal in create executor), G-2 (no hard-delete/admin/service-role in delete executor), G-3 (registry↔prompt sync for the ORCH-1103 tools), G-4/SC-3 (**delete REFUSED with a blocking future event — throws DELETE_BLOCKED_BY_EVENTS and asserts ZERO `brands` updates**), SC-2 (happy delete stamps + clears default), SC-4/T-09 (create omits currency when no arg+pref), SC-4b (explicit currency uppercased), update_brand empty-patch INVALID_ARGS, PROMPT_VERSION=v3, richer brand context.
- **Jest (UI):** `mingla-business/src/components/ari/__tests__/orch_1103_ari_brand_crud_ui.test.ts` — 15 tests, ALL PASS. Locks the coverBandH token, cover band states, brand verbs, Confirm-disabled-while-uploading, live cascade, type-to-confirm gating, Delete=semantic.error + label ≥14/600, ResponseCard receipt + anti-slop thumbnail + seed-not-execute, and the CoverPickerSheet contrast fix.
- **fails-on-revert verified at `ff6015b1e`** (origin/main): stashing the two backend files makes the Deno test fail type-checking (TS2353 — old `BrandSummary` lacks the new fields, new tools/behaviour absent); stashing the four UI files turns all 15 jest assertions red. Both restored via `git stash pop`, both re-run green.

---

## Spec traceability (success criteria)
| SC | Status | Evidence |
|---|---|---|
| SC-1 edit brand | PASS (mechanism) | update_brand tool + receipt; UI test |
| SC-2 delete no-events | PASS | Deno SC-2 test (stamp + clear default) |
| SC-3 delete guard | PASS | Deno G-4 (409, no deleted_at) |
| SC-4 no GBP literal | PASS | Deno G-1 + SC-4 omit test |
| SC-5 first-brand default | PASS | create_brand count===1 → set default; Deno SC-4 (set) + SC-4b (not on 2nd) |
| SC-6/7 ownership | PASS (mechanism) | assertBrandOwned + RLS; 403 OWNERSHIP_DENIED unchanged |
| SC-7 cover create (provider) | PASS (mechanism) | create executor writes pair; provider threads via args |
| SC-8 cover edit (video) | PASS (mechanism) | update opens full CoverPickerSheet live-persist |
| SC-9 registry↔prompt sync | PASS | Deno G-3 |
| SC-10 disambiguation | PASS (prompt-driven) | prompt BRAND MANAGEMENT "ask which one"; brandNamesById threaded |
| SC-11 no-brand handoff | PASS (prompt-driven) | prompt handoff rule, non-chaining |
| SC-12 no hard delete | PASS | Deno G-2 |
| SC-13 type-to-confirm | PASS | jest canDelete gate test |

UNVERIFIED-on-device (orchestrator live test after deploy): the end-to-end Gemini-proposes flows (SC-1/10/11) and the cover persistence round-trip (SC-7/8) — exercised via the deployed edge fns + business-app build.

---

## Invariant verification
- I-ARI-USER-JWT-ONLY — Y (both executors use the passed `client`; no service role; grep-clean G-2).
- I-ARI-USER-DATA-WRAP — Y (richer brand line routes names through `escapeForPrompt`).
- I-PROPOSED-A (deleted_at IS NULL) — Y (assertBrandOwned, update_brand write, delete stamp, first-brand count all filter `.is("deleted_at", null)`).
- I-PROPOSED-B (default_brand_id cleanup) — Y (delete clears non-fatally; create sets on first brand non-fatally).
- **I-ARI-BRAND-DELETE-GUARD** (NEW) — Y, registered.
- **I-ARI-NO-HARD-DELETE** (NEW) — Y, registered.
- Atomic confirm replay guard — untouched.
- pk_live / Android-glass / TopSheet — untouched.

---

## Deviations
1. **Q7 device/video-at-create runtime boundary.** Backend + create executor fully accept a picker-sourced cover pair, and update_brand opens the full RLS-honest picker. The create-time device/video two-phase ("Create & attach" → commit → re-target picker) requires the screen to capture the returned `brandId` and re-open the picker against it; the band + props support this, but the inline "Create & attach" footer micro-interaction inside the picker is the one spot whose exact runtime sequencing the orchestrator should verify on device (the design itself flags "confirm the picker can have its target swapped while open, or close+reopen"). Provider/remote-at-create and full-picker-on-edit are complete and RLS-safe. This is the design's explicitly-flagged feasibility check, not a silent shortcut.
2. **Surfaces 3 & 5 are prompt-driven, not bespoke chip components.** Q2 resolved as conversational (chip tap = a user message; Gemini sole proposer). The disambiguation + no-brand handoff are driven by the v3 prompt rules (Ari asks in prose, proposes create_brand); `brandNamesById` is threaded for target display. A dedicated `QuickReplyChips` CHOICE row keyed off a model "disambiguation payload" is NOT added because `useAgentChat` carries no such payload kind and adding one would be a new client tool-call path the spec/design explicitly reject. The functional contract (SC-10/11) holds via prose + composer; the chip is an optional future polish.

---

## Discoveries for orchestrator
1. **`create_experience` prompt/registry drift (SPEC §12.1, flagged not fixed).** `create_experience` is in `AGENT_TOOLS` but still absent from CAPABILITIES. The G-3 gate is intentionally SCOPED to the ORCH-1103 tools (`update_brand`/`delete_brand`) so it does NOT silently widen to fix this. Spawn a 1-line cleanup ORCH or accept under sign-off.
2. **`app/event/create.tsx` `no_brand` dead-end (SPEC §12.2).** Untouched. Routing it INTO Ari is a separate UX follow-on.
3. **`BrandCoverPickerSheet.tsx` dead orphan (SPEC §12.3).** Untouched; orchestrator cleanup note.
4. **Two PRE-EXISTING jest failures (NOT ORCH-1103).** `src/hooks/__tests__/orch1004AllowlistIntegrity.test.ts` (expects `usePublicExperience.ts` in an allowlist) and `src/hooks/__tests__/brandListState.test.ts` (expects a `!isError && brand === null` substring) both fail on the current branch. Neither file is touched by ORCH-1103; both belong to other in-flight work. Flagged for triage.
